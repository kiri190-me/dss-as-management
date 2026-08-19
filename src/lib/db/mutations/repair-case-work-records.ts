import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../client";
import { repairCases, repairCaseWorkRecords, procedureCaseExecutionNodes, procedureCaseExecutions } from "../schema";
import { resolveEligibleActor, type Tx } from "./procedure-templates";
import { workRecordRequiresOwnAssignment } from "@/lib/auth/repair-case-work-record-authorization";
import { hasPermission } from "@/lib/auth/permission-resolver";
import type { WorkRecordKind } from "@/lib/domain/types";

/**
 * Phase 5C-2 — repair-case work record mutations. Same conventions as
 * procedure-case-execution.ts:
 *  - re-checks the actor from the live DB (resolveEligibleActor, shared);
 *  - every write re-verifies its preconditions inside its own transaction,
 *    never trusting that the UI already checked them;
 *  - locks the row(s) being read/mutated with `.for("update")`;
 *  - locked-case behavior (repair_cases.is_locked) is unconditional for
 *    every role, including SUPER_ADMIN — no exception.
 *
 * Deliberately only two mutations exist: createWorkRecord and
 * invalidateWorkRecord. There is no updateWorkRecord / editWorkRecord
 * mutation anywhere in this module, and none should ever be added — a work
 * record's memo/author/created_at are immutable for the lifetime of the
 * row; the only allowed change is the one-way invalidation below.
 */

export type CreateWorkRecordMutationResultCode = "FORBIDDEN" | "NOT_FOUND" | "CASE_LOCKED" | "INVALID_INPUT" | "IDEMPOTENCY_CONFLICT" | "BILLING_DECISION_REQUIRED";
export type InvalidateWorkRecordMutationResultCode = "FORBIDDEN" | "NOT_FOUND" | "CASE_LOCKED" | "ALREADY_INVALIDATED" | "BILLING_DECISION_REQUIRED";

type CreateFailure = { ok: false; code: CreateWorkRecordMutationResultCode; message: string };
type InvalidateFailure = { ok: false; code: InvalidateWorkRecordMutationResultCode; message: string };

class CreateWorkRecordMutationError extends Error {
  result: CreateFailure;
  constructor(result: CreateFailure) {
    super(result.message);
    this.result = result;
  }
}

class InvalidateWorkRecordMutationError extends Error {
  result: InvalidateFailure;
  constructor(result: InvalidateFailure) {
    super(result.message);
    this.result = result;
  }
}

function failCreate(code: CreateWorkRecordMutationResultCode, message: string): never {
  throw new CreateWorkRecordMutationError({ ok: false, code, message });
}

function failInvalidate(code: InvalidateWorkRecordMutationResultCode, message: string): never {
  throw new InvalidateWorkRecordMutationError({ ok: false, code, message });
}

async function requireActorOrFailCreate(tx: Tx, actorUserId: string) {
  try {
    return await resolveEligibleActor(tx, actorUserId);
  } catch {
    return failCreate("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");
  }
}

async function requireActorOrFailInvalidate(tx: Tx, actorUserId: string) {
  try {
    return await resolveEligibleActor(tx, actorUserId);
  } catch {
    return failInvalidate("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");
  }
}

// ---- 작업 기록 생성 (create) ----

export type CreateWorkRecordResult =
  | { ok: true; id: string; createdAt: string; replayed: boolean }
  | CreateFailure;

/**
 * Idempotency design (Phase 5C-2 §4): a single INSERT ... ON CONFLICT
 * (repair_case_id, client_request_id) DO NOTHING RETURNING. Postgres's own
 * conflict-wait semantics (a second concurrent inserter of the same key
 * waits for the first to commit/rollback before resolving the conflict —
 * same property documented in inventory-request-idempotency.ts) is what
 * guarantees "concurrent duplicate submits cannot create two rows," with
 * no extra locking needed beyond the unique index itself.
 *
 * When the INSERT is skipped (0 rows returned), the already-committed
 * conflicting row is fetched and compared against the incoming
 * client-controlled fields (author, memo, node link) — NOT the
 * server-derived related_workflow_step_id, which may legitimately differ
 * on a retry after the case has advanced (that must still replay the
 * original row, never be treated as a payload mismatch). A match returns
 * the existing row as a replay; a mismatch is rejected as
 * IDEMPOTENCY_CONFLICT — the old row is never silently treated as if the
 * new, different request had succeeded.
 */
export async function createWorkRecord(params: {
  repairCaseId: string;
  actorUserId: string;
  /** Already validated/trimmed by repair-case-work-record-input.ts. */
  memo: string;
  /** Already validated/defaulted to "GENERAL" by validateWorkRecordKind. */
  recordKind: WorkRecordKind;
  relatedProcedureExecutionNodeId: string | null;
  clientRequestId: string;
}): Promise<CreateWorkRecordResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActorOrFailCreate(tx, params.actorUserId);

      const [repairCase] = await tx
        .select({
          id: repairCases.id,
          isLocked: repairCases.isLocked,
          assignedEngineerId: repairCases.assignedEngineerId,
          currentWorkflowStepId: repairCases.currentWorkflowStepId,
          billingType: repairCases.billingType,
        })
        .from(repairCases)
        .where(and(eq(repairCases.id, params.repairCaseId), eq(repairCases.isDeleted, false)))
        .for("update");
      if (!repairCase) failCreate("NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");
      if (repairCase.billingType === "PENDING_DECISION") {
        failCreate("BILLING_DECISION_REQUIRED", "유·무상을 확정한 후 작업 기록을 작성할 수 있습니다.");
      }

      const isAssignedToCase = repairCase.assignedEngineerId === actor.id;
      // 담당 조건은 엔지니어에게만 붙는다 — 역할은 설정이, 담당 여부는 여기가 본다.
      const assignmentOk = !workRecordRequiresOwnAssignment(actor.role) || isAssignedToCase;
      if (!assignmentOk || !(await hasPermission(actor.role, "repairCases.workRecords", "WRITE"))) {
        failCreate("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
      }

      // Optional procedure-execution-node linkage: must belong to a
      // non-deleted execution of THIS repair case — the client-supplied id
      // is never trusted beyond "which row to look up." params.repairCaseId
      // is always a live case id (verified above), while
      // executionRepairCaseId is nullable (repair-case permanent-delete
      // schema foundation checkpoint) — an execution whose own case has
      // since been purged has executionRepairCaseId=null, which this
      // `!==` comparison already correctly treats as a mismatch (null can
      // never equal params.repairCaseId's real uuid), so it's rejected by
      // the same branch as any other cross-case node, with no special
      // handling needed.
      if (params.relatedProcedureExecutionNodeId !== null) {
        const [node] = await tx
          .select({
            id: procedureCaseExecutionNodes.id,
            executionRepairCaseId: procedureCaseExecutions.repairCaseId,
            executionIsDeleted: procedureCaseExecutions.isDeleted,
          })
          .from(procedureCaseExecutionNodes)
          .innerJoin(procedureCaseExecutions, eq(procedureCaseExecutions.id, procedureCaseExecutionNodes.executionId))
          .where(eq(procedureCaseExecutionNodes.id, params.relatedProcedureExecutionNodeId));
        if (!node || node.executionIsDeleted || node.executionRepairCaseId !== params.repairCaseId) {
          failCreate("INVALID_INPUT", "선택한 절차 항목을 확인할 수 없습니다.");
        }
      }

      const inserted = await tx
        .insert(repairCaseWorkRecords)
        .values({
          repairCaseId: params.repairCaseId,
          authorUserId: actor.id,
          memo: params.memo,
          recordKind: params.recordKind,
          // Server-derived context, captured now — never re-derived later
          // from the case's (possibly since-moved) current step.
          relatedWorkflowStepId: repairCase.currentWorkflowStepId,
          relatedProcedureExecutionNodeId: params.relatedProcedureExecutionNodeId,
          clientRequestId: params.clientRequestId,
        })
        .onConflictDoNothing({
          target: [repairCaseWorkRecords.repairCaseId, repairCaseWorkRecords.clientRequestId],
          where: sql`${repairCaseWorkRecords.clientRequestId} is not null`,
        })
        .returning({ id: repairCaseWorkRecords.id, createdAt: repairCaseWorkRecords.createdAt });

      if (inserted.length > 0) {
        return { ok: true, id: inserted[0].id, createdAt: inserted[0].createdAt.toISOString(), replayed: false };
      }

      // Conflict: a row with this (repair_case_id, client_request_id) is
      // already committed (Postgres's conflict-wait guarantees this, not a
      // PROCESSING/in-flight state — see module doc comment).
      const [existing] = await tx
        .select({
          id: repairCaseWorkRecords.id,
          createdAt: repairCaseWorkRecords.createdAt,
          authorUserId: repairCaseWorkRecords.authorUserId,
          memo: repairCaseWorkRecords.memo,
          recordKind: repairCaseWorkRecords.recordKind,
          relatedProcedureExecutionNodeId: repairCaseWorkRecords.relatedProcedureExecutionNodeId,
        })
        .from(repairCaseWorkRecords)
        .where(
          and(
            eq(repairCaseWorkRecords.repairCaseId, params.repairCaseId),
            eq(repairCaseWorkRecords.clientRequestId, params.clientRequestId)
          )
        );

      if (!existing) {
        // Not expected to be reachable under Postgres's own ON CONFLICT
        // guarantees — fail safe rather than assume success.
        failCreate("IDEMPOTENCY_CONFLICT", "요청을 처리할 수 없습니다. 다시 시도해 주세요.");
      }

      const isSameClientPayload =
        existing.authorUserId === actor.id &&
        existing.memo === params.memo &&
        existing.recordKind === params.recordKind &&
        existing.relatedProcedureExecutionNodeId === params.relatedProcedureExecutionNodeId;

      if (!isSameClientPayload) {
        failCreate("IDEMPOTENCY_CONFLICT", "동일한 요청 식별자로 다른 내용이 이미 제출되었습니다.");
      }

      return { ok: true, id: existing.id, createdAt: existing.createdAt.toISOString(), replayed: true };
    });
  } catch (err) {
    if (err instanceof CreateWorkRecordMutationError) return err.result;
    throw err;
  }
}

// ---- 무효 처리 (invalidate) ----

export type InvalidateWorkRecordResult =
  | { ok: true; id: string; invalidatedAt: string }
  | InvalidateFailure;

/**
 * At-most-once, one-way invalidation. A second attempt against an
 * already-invalidated record is rejected with ALREADY_INVALIDATED — never
 * a silent no-op, and never an overwrite of the original reason/actor/time
 * (Phase 5C-2 §3's explicit preference).
 */
export async function invalidateWorkRecord(params: {
  workRecordId: string;
  actorUserId: string;
  /** Already validated/trimmed by repair-case-work-record-input.ts. */
  reason: string;
}): Promise<InvalidateWorkRecordResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActorOrFailInvalidate(tx, params.actorUserId);

      const [record] = await tx
        .select({
          id: repairCaseWorkRecords.id,
          repairCaseId: repairCaseWorkRecords.repairCaseId,
          invalidatedAt: repairCaseWorkRecords.invalidatedAt,
        })
        .from(repairCaseWorkRecords)
        .where(eq(repairCaseWorkRecords.id, params.workRecordId))
        .for("update");
      if (!record) failInvalidate("NOT_FOUND", "해당 작업 기록을 찾을 수 없습니다.");
      if (record.invalidatedAt !== null) {
        failInvalidate("ALREADY_INVALIDATED", "이미 무효 처리된 작업 기록입니다.");
      }

      // repair_case_id is nullable (repair-case permanent-delete schema
      // foundation checkpoint): a work record whose case has since been
      // permanently purged is a legitimate historical row. This mirrors
      // the pre-existing behavior for a merely soft-deleted case, which
      // this same `eq(repairCases.isDeleted, false)` check already turned
      // into NOT_FOUND before this checkpoint — a purged case is just a
      // more final version of "not live," so it gets the identical
      // response, not new/different behavior.
      if (!record.repairCaseId) failInvalidate("NOT_FOUND", "이 작업 기록과 연결된 접수 건이 더 이상 존재하지 않습니다.");
      const recordRepairCaseId = record.repairCaseId;

      const [repairCase] = await tx
        .select({ id: repairCases.id, isLocked: repairCases.isLocked, billingType: repairCases.billingType })
        .from(repairCases)
        .where(and(eq(repairCases.id, recordRepairCaseId), eq(repairCases.isDeleted, false)))
        .for("update");
      if (!repairCase) failInvalidate("NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");
      if (repairCase.billingType === "PENDING_DECISION") {
        failInvalidate("BILLING_DECISION_REQUIRED", "유·무상을 확정한 후 작업 기록을 변경할 수 있습니다.");
      }

      if (!(await hasPermission(actor.role, "repairCases.workRecords", "MANAGE"))) {
        failInvalidate("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
      }

      // WHERE invalidated_at IS NULL is defense-in-depth on top of the
      // FOR UPDATE + pre-check above (which already make a race here
      // unreachable within this transaction) — never overwrite an existing
      // invalidation.
      const updatedRows = await tx
        .update(repairCaseWorkRecords)
        .set({
          invalidatedAt: sql`now()`,
          invalidatedBy: actor.id,
          invalidationReason: params.reason,
        })
        .where(and(eq(repairCaseWorkRecords.id, params.workRecordId), sql`${repairCaseWorkRecords.invalidatedAt} is null`))
        .returning({ id: repairCaseWorkRecords.id, invalidatedAt: repairCaseWorkRecords.invalidatedAt });

      if (updatedRows.length === 0) {
        failInvalidate("ALREADY_INVALIDATED", "이미 무효 처리된 작업 기록입니다.");
      }

      const updated = updatedRows[0];
      return { ok: true, id: updated.id, invalidatedAt: updated.invalidatedAt!.toISOString() };
    });
  } catch (err) {
    if (err instanceof InvalidateWorkRecordMutationError) return err.result;
    throw err;
  }
}
