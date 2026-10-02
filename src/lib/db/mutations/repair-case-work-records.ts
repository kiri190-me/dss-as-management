import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../client";
import {
  repairCases,
  repairCaseWorkRecords,
  repairCaseWorkRecordEdits,
  procedureCaseExecutionNodes,
  procedureCaseExecutions,
} from "../schema";
import { resolveEligibleActor, type Tx } from "./procedure-templates";
import { canEditWorkRecord, workRecordRequiresOwnAssignment } from "@/lib/auth/repair-case-work-record-authorization";
import { actorMay } from "@/lib/auth/developer-promotion";
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
 * 🔴 2026-10-02 — 쓰기가 **셋**이 되었다: createWorkRecord ·
 * invalidateWorkRecord · editWorkRecord. 이 자리에는 예전에 「고치는
 * mutation 은 없고 앞으로도 있어서는 안 된다」고 적혀 있었다 — 사용자
 * 결정(「올리고 다시 쓰기」가 아니라 「글을 진짜로 고치기」)으로 그 불변식이
 * 바뀌었다. 지금 사실은 이렇다:
 *  · 고칠 수 있는 칸은 **memo 와 record_kind 둘뿐**이고, **작성자 본인만**
 *    고친다(canEditWorkRecord). 고치기 전 값은
 *    repair_case_work_record_edits 에 한 줄씩 남는다.
 *  · author_user_id · created_at · 맥락 칸들(related_*) · client_request_id ·
 *    무효 처리 세 칸은 **여전히 어떤 길로도 바뀌지 않는다.**
 *  · 이미 무효 처리된 기록은 고칠 수 없다.
 * 같은 내용이 표 쪽 주석(vendor/dss-core 의 repair-case-work-records.ts)에도
 * 적혀 있다 — 둘 중 하나만 고치지 말 것.
 *
 * 🔴 2026-09-21 — createWorkRecord 의 몸통을 `createWorkRecordInTx` 로 뽑아
 * 두었다(교산 연락서 이식이 첨부 · 사용 부품 · 이식 흔적과 **한 트랜잭션**으로
 * 작업 기록을 넣어야 하기 때문이다). **쓰기의 수는 그대로 둘이다** — 뽑아낸
 * 함수는 같은 INSERT 의 몸통이고, createWorkRecord 는 그것을 트랜잭션으로 감싼
 * 껍데기가 되었다. 검사도 그대로다(한 갈래만 밝혀 나뉜다 —
 * `WorkRecordWriteOrigin`).
 */

export type CreateWorkRecordMutationResultCode = "FORBIDDEN" | "NOT_FOUND" | "CASE_LOCKED" | "INVALID_INPUT" | "IDEMPOTENCY_CONFLICT" | "BILLING_DECISION_REQUIRED";
export type InvalidateWorkRecordMutationResultCode = "FORBIDDEN" | "NOT_FOUND" | "CASE_LOCKED" | "ALREADY_INVALIDATED" | "BILLING_DECISION_REQUIRED";
/** NO_CHANGE 는 거절이 아니라 「할 일이 없다」다 — 빈 이력 줄을 쌓지 않으려고 돌려보낸다. */
export type EditWorkRecordMutationResultCode = "FORBIDDEN" | "NOT_FOUND" | "ALREADY_INVALIDATED" | "BILLING_DECISION_REQUIRED" | "NO_CHANGE";

type CreateFailure = { ok: false; code: CreateWorkRecordMutationResultCode; message: string };
type InvalidateFailure = { ok: false; code: InvalidateWorkRecordMutationResultCode; message: string };
type EditFailure = { ok: false; code: EditWorkRecordMutationResultCode; message: string };

/**
 * Exported so an in-transaction caller (createWorkRecordInTx) can turn a
 * failure back into its own abort/result shape. The throw itself is what
 * rolls the caller's transaction back, so it must stay a throw — see
 * createWorkRecordInTx's doc comment.
 */
export class CreateWorkRecordMutationError extends Error {
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

class EditWorkRecordMutationError extends Error {
  result: EditFailure;
  constructor(result: EditFailure) {
    super(result.message);
    this.result = result;
  }
}

function failInvalidate(code: InvalidateWorkRecordMutationResultCode, message: string): never {
  throw new InvalidateWorkRecordMutationError({ ok: false, code, message });
}

function failEdit(code: EditWorkRecordMutationResultCode, message: string): never {
  throw new EditWorkRecordMutationError({ ok: false, code, message });
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

async function requireActorOrFailEdit(tx: Tx, actorUserId: string) {
  try {
    return await resolveEligibleActor(tx, actorUserId);
  } catch {
    return failEdit("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");
  }
}

// ---- 작업 기록 생성 (create) ----

export type CreateWorkRecordResult =
  | { ok: true; id: string; createdAt: string; replayed: boolean }
  | CreateFailure;

/**
 * 🔴 누가 이 줄을 쓰는가 — **검사 갈래**다. 뜻이 다른 두 통로가 같은 INSERT 를
 * 쓰기 때문에, 어느 검사를 이미 거쳤는지를 호출자가 밝혀야 한다.
 *
 *  · `"screen"`        사람이 작업 기록 화면에서 적는다. **지금까지의 검사 전부**
 *                      (역할 권한 `repairCases.workRecords` WRITE + 담당 여부).
 *                      값을 안 주면 이쪽이다 — 닫히는 쪽이 기본값이어야 한다.
 *  · `"server-import"` 서버가 도는 이식(교산 연락서)이다. 그 통로는 화면 칸이
 *                      아니라 **더 무거운 권한**(`kyosanIntakeImport` MANAGE)을
 *                      액션에서 이미 판정했고, 이식하는 사람이 그 건의 담당
 *                      엔지니어일 이유가 없다. 사용 부품 이식이 이미 같은
 *                      판단을 한다(services/kyosan-report-import.ts 의
 *                      appendUsedParts 주석 — `canWriteUsedParts: true`).
 *
 * 🔴 **갈라지는 것은 이 둘뿐이다.** 살아 있는 계정 확인 · 접수 건 존재 ·
 * 유·무상 확정 · 절차 항목 연결 · 멱등 판정은 **두 갈래 다** 그대로 받는다.
 */
export type WorkRecordWriteOrigin = "screen" | "server-import";

export type CreateWorkRecordParams = {
  repairCaseId: string;
  actorUserId: string;
  /** Already validated/trimmed by repair-case-work-record-input.ts. */
  memo: string;
  /** Already validated/defaulted to "GENERAL" by validateWorkRecordKind. */
  recordKind: WorkRecordKind;
  relatedProcedureExecutionNodeId: string | null;
  clientRequestId: string;
  /** 위 갈래. 안 주면 `"screen"` — 검사를 다 하는 쪽이다. */
  origin?: WorkRecordWriteOrigin;
};

/**
 * 🔴 **트랜잭션을 열지 않는다** — 이미 열려 있는 트랜잭션 안에서 도는 몸통이다.
 * 연락서 이식은 첨부 · 사용 부품 · 이식 흔적과 **한 트랜잭션**이라 작업 기록도
 * 같은 통 안에 들어가야 하고, 그러려면 이 함수가 따로 있어야 한다.
 *
 * 🔴 실패하면 **던진다**(`CreateWorkRecordMutationError`). 돌려주면 부르는 쪽
 * 트랜잭션이 커밋되어 버린다 — 던지는 것이 롤백을 만드는 힘이다. 아래
 * `createWorkRecord` 가 그 던짐을 받아 지금까지와 **똑같은 결과 객체**로 바꾼다.
 *
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
export async function createWorkRecordInTx(
  tx: Tx,
  params: CreateWorkRecordParams
): Promise<{ ok: true; id: string; createdAt: string; replayed: boolean }> {
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
  // 🔴 이 두 검사만 갈래를 탄다(`WorkRecordWriteOrigin` 의 주석). 서버가 도는
  //    이식은 더 무거운 권한을 액션이 이미 판정했고, 이식하는 사람이 그 건의
  //    담당 엔지니어일 이유가 없다. 화면 통로(기본값)는 아래 판정을 그대로 받는다.
  //
  // 담당 조건은 엔지니어에게만 붙는다 — 역할은 설정이, 담당 여부는 여기가 본다.
  //
  // ⚠️ 승격은 **담당을 요구하는가**라는 역할 쪽 판정에만 더한다. 배정 사실
  // (isAssignedToCase)은 손대지 않는다 — 개발자라고 해서 그 사람이 이 건에
  // 배정된 것이 되지는 않는다. 최고관리자는 담당을 요구받지 않으므로, 더한
  // 결과 개발자도 요구받지 않는다(「최고관리자 동급」).
  //
  // 형제 함수 executionRequiresOwnAssignment 와 **같은 모양**이다
  // (mutations/procedure-case-execution.ts). 두 기능이 다르게 동작하면
  // 「작업 실행은 되는데 작업 기록은 거절」이 된다.
  //
  // 화면(app/(app)/repair-cases/[id]/execution/page.tsx)도 같은 판정을 한다 —
  // 한쪽만 고치면 「보이는데 저장은 거절」 또는 그 반대가 된다.
  if (params.origin !== "server-import") {
    const assignmentOk = actorMay(
      actor,
      (role) => !workRecordRequiresOwnAssignment(role) || isAssignedToCase
    );
    if (!assignmentOk || !(await hasPermission(actor, "repairCases.workRecords", "WRITE"))) {
      failCreate("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
    }
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
}

/**
 * 🔴 **동작이 한 글자도 달라지지 않았다.** 예전의 몸통이 위
 * `createWorkRecordInTx` 로 옮겨 갔을 뿐이고, 이 함수는 트랜잭션을 열고 그
 * 던짐을 결과 객체로 바꾸는 껍데기다(기존 호출부가 그대로 돈다).
 */
export async function createWorkRecord(params: CreateWorkRecordParams): Promise<CreateWorkRecordResult> {
  try {
    return await db.transaction((tx) => createWorkRecordInTx(tx, params));
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

      if (!(await hasPermission(actor, "repairCases.workRecords", "MANAGE"))) {
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

// ---- 고치기 (edit) ----

export type EditWorkRecordResult =
  | { ok: true; id: string; editedAt: string }
  | EditFailure;

/**
 * 작업 기록의 **글과 기록 구분**을 고친다(2026-10-02). 바로 위
 * invalidateWorkRecord 와 **같은 모양**이다 — 같은 순서로 집고, 같은 오류
 * 문구를 쓰고, 마지막 UPDATE 에 같은 겹막이(`WHERE invalidated_at IS NULL`)를
 * 둔다. 다른 점은 하나뿐이다: 무효 처리는 한 줄에 대한 단 한 번의 사실이라
 * 세 칸으로 끝나지만, 고치기는 되풀이되므로 **고치기 전 값을
 * repair_case_work_record_edits 에 한 줄 남긴 다음** 본 표를 덮어쓴다.
 * 두 쓰기는 한 트랜잭션 안이다 — 흔적 없이 덮이는 일은 없다.
 *
 * 🔴 고쳐지는 칸은 memo 와 record_kind 둘뿐이다. author_user_id · created_at ·
 * related_* · client_request_id · 무효 처리 세 칸은 이 함수가 건드리지 않는다.
 *
 * 🔴 record_kind 도 함께 고치는 까닭: 「고장 및 서비스 정보」 요약이 **그
 * 구분의 가장 최근 유효 기록**을 읽는다(queries 의
 * getDerivedServiceSummaryForCase). 구분을 못 고치면 잘못 고른 구분을
 * 바로잡을 길이 없어 고치기가 반쪽이 된다.
 */
export async function editWorkRecord(params: {
  workRecordId: string;
  actorUserId: string;
  /** Already validated/trimmed by repair-case-work-record-input.ts. */
  memo: string;
  /** Already validated/defaulted to "GENERAL" by validateWorkRecordKind. */
  recordKind: WorkRecordKind;
}): Promise<EditWorkRecordResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActorOrFailEdit(tx, params.actorUserId);

      const [record] = await tx
        .select({
          id: repairCaseWorkRecords.id,
          repairCaseId: repairCaseWorkRecords.repairCaseId,
          authorUserId: repairCaseWorkRecords.authorUserId,
          memo: repairCaseWorkRecords.memo,
          recordKind: repairCaseWorkRecords.recordKind,
          invalidatedAt: repairCaseWorkRecords.invalidatedAt,
        })
        .from(repairCaseWorkRecords)
        .where(eq(repairCaseWorkRecords.id, params.workRecordId))
        .for("update");
      if (!record) failEdit("NOT_FOUND", "해당 작업 기록을 찾을 수 없습니다.");
      // 🔴 무효 처리된 기록은 고칠 수 없다 — 무효 처리는 「이 기록은 없던
      //    것으로 본다」는 되돌릴 수 없는 판단이고, 그 뒤에 글이 바뀌면 무엇을
      //    무효로 했는지가 흐려진다.
      if (record.invalidatedAt !== null) {
        failEdit("ALREADY_INVALIDATED", "이미 무효 처리된 작업 기록입니다.");
      }

      // repair_case_id 가 NULL 인 줄은 접수 건이 영구 삭제된 과거 기록이다 —
      // invalidateWorkRecord 와 같은 판단으로 NOT_FOUND 다.
      if (!record.repairCaseId) failEdit("NOT_FOUND", "이 작업 기록과 연결된 접수 건이 더 이상 존재하지 않습니다.");
      const recordRepairCaseId = record.repairCaseId;

      const [repairCase] = await tx
        .select({
          id: repairCases.id,
          isLocked: repairCases.isLocked,
          assignedEngineerId: repairCases.assignedEngineerId,
          billingType: repairCases.billingType,
        })
        .from(repairCases)
        .where(and(eq(repairCases.id, recordRepairCaseId), eq(repairCases.isDeleted, false)))
        .for("update");
      if (!repairCase) failEdit("NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");
      if (repairCase.billingType === "PENDING_DECISION") {
        // 무효 처리와 **같은 문구**다 — 같은 조건으로 막는 같은 종류의 일이다.
        failEdit("BILLING_DECISION_REQUIRED", "유·무상을 확정한 후 작업 기록을 변경할 수 있습니다.");
      }

      // 역할은 설정(role_permissions)이, 작성자 본인 여부와 담당 여부는 여기가
      // 본다. 권한 영역은 **WRITE** — manage(무효 처리)를 엔지니어에게 열지
      // 않는다(canEditWorkRecord 주석).
      //
      // ⚠️ 승격(개발자 = 최고관리자 동급)은 createWorkRecord 와 같은 자리에만
      // 더한다 — 역할 쪽 판정이다. 작성자 본인 여부(isAuthor)는 승격으로
      // 넘을 수 없다: canEditWorkRecord 가 역할을 보기 전에 먼저 막는다.
      const isAuthor = record.authorUserId === actor.id;
      const isAssignedToCase = repairCase.assignedEngineerId === actor.id;
      const roleOk = actorMay(actor, (role) =>
        canEditWorkRecord(role, { isAuthor, isAssignedToCase, isCaseLocked: repairCase.isLocked })
      );
      if (!roleOk || !(await hasPermission(actor, "repairCases.workRecords", "WRITE"))) {
        failEdit("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
      }

      // 둘 다 그대로면 아무것도 하지 않는다 — 빈 이력 줄을 쌓지 않는다.
      // (글은 액션 층에서 이미 다듬어져 들어온다. 비교도 다듬어진 값끼리다.)
      if (record.memo === params.memo && record.recordKind === params.recordKind) {
        failEdit("NO_CHANGE", "변경된 내용이 없습니다.");
      }

      const [editRow] = await tx
        .insert(repairCaseWorkRecordEdits)
        .values({
          workRecordId: record.id,
          previousMemo: record.memo,
          previousRecordKind: record.recordKind,
          editedBy: actor.id,
        })
        .returning({ id: repairCaseWorkRecordEdits.id, editedAt: repairCaseWorkRecordEdits.editedAt });

      // WHERE 의 invalidated_at IS NULL 은 위 FOR UPDATE + 선검사 위에 겹친
      // 막이다(invalidateWorkRecord 가 쓰는 것과 같은 수법) — 무효 처리된
      // 기록이 고쳐지는 길을 두 겹으로 막는다.
      const updatedRows = await tx
        .update(repairCaseWorkRecords)
        .set({ memo: params.memo, recordKind: params.recordKind })
        .where(and(eq(repairCaseWorkRecords.id, record.id), sql`${repairCaseWorkRecords.invalidatedAt} is null`))
        .returning({ id: repairCaseWorkRecords.id });

      if (updatedRows.length === 0) {
        // 여기 오면 위에서 넣은 이력 줄도 함께 되돌아간다(한 트랜잭션).
        failEdit("ALREADY_INVALIDATED", "이미 무효 처리된 작업 기록입니다.");
      }

      return { ok: true, id: updatedRows[0].id, editedAt: editRow.editedAt.toISOString() };
    });
  } catch (err) {
    if (err instanceof EditWorkRecordMutationError) return err.result;
    throw err;
  }
}
