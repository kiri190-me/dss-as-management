import "server-only";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../client";
import { repairCases, repairCaseFlowcharts, repairCaseFlowchartEditHistory } from "../schema";
import { resolveEligibleActor, type Tx } from "./procedure-templates";
import { canMutateRepairCaseFlowchart } from "@/lib/auth/repair-case-flowchart-authorization";

/**
 * Phase 5C-6B — repair-case flowchart OBJECT management (create/rename/
 * soft-delete). Node/edge graph CRUD is explicitly out of scope here (see
 * HANDOFF.md) — this module only ever touches repair_case_flowcharts and
 * repair_case_flowchart_edit_history, never
 * repair_case_flowchart_nodes/edges.
 *
 * Same conventions as repair-case-work-records.ts / procedure-templates.ts:
 *  - re-checks the actor from the live DB (resolveEligibleActor, shared);
 *  - every write re-verifies its preconditions inside its own transaction,
 *    never trusting that the UI/server-action layer already checked them;
 *  - locks the row(s) being read/mutated with `.for("update")`;
 *  - locked-case behavior (repair_cases.is_locked) is unconditional for
 *    every role, including SUPER_ADMIN — no exception
 *    (canMutateRepairCaseFlowchart checks it first, unconditionally).
 *
 * Deliberately independent of procedure_template_edit_history: every
 * history row this module writes goes into
 * repair_case_flowchart_edit_history (0019), never the template table —
 * case-flowchart audit data stays fully isolated from template audit data.
 */

export type CreateFlowchartResultCode = "FORBIDDEN" | "NOT_FOUND" | "CASE_LOCKED" | "INVALID_INPUT";
export type UpdateFlowchartMetadataResultCode = "FORBIDDEN" | "NOT_FOUND" | "CASE_LOCKED" | "INVALID_INPUT" | "STALE_REVISION";
export type SoftDeleteFlowchartResultCode = "FORBIDDEN" | "NOT_FOUND" | "CASE_LOCKED" | "STALE_REVISION";

type CreateFailure = { ok: false; code: CreateFlowchartResultCode; message: string };
type UpdateFailure = { ok: false; code: UpdateFlowchartMetadataResultCode; message: string };
type SoftDeleteFailure = { ok: false; code: SoftDeleteFlowchartResultCode; message: string };

class CreateFlowchartMutationError extends Error {
  result: CreateFailure;
  constructor(result: CreateFailure) {
    super(result.message);
    this.result = result;
  }
}

class UpdateFlowchartMutationError extends Error {
  result: UpdateFailure;
  constructor(result: UpdateFailure) {
    super(result.message);
    this.result = result;
  }
}

class SoftDeleteFlowchartMutationError extends Error {
  result: SoftDeleteFailure;
  constructor(result: SoftDeleteFailure) {
    super(result.message);
    this.result = result;
  }
}

function failCreate(code: CreateFlowchartResultCode, message: string): never {
  throw new CreateFlowchartMutationError({ ok: false, code, message });
}
function failUpdate(code: UpdateFlowchartMetadataResultCode, message: string): never {
  throw new UpdateFlowchartMutationError({ ok: false, code, message });
}
function failSoftDelete(code: SoftDeleteFlowchartResultCode, message: string): never {
  throw new SoftDeleteFlowchartMutationError({ ok: false, code, message });
}

async function requireActor(tx: Tx, actorUserId: string, onForbidden: (code: "FORBIDDEN", message: string) => never) {
  try {
    return await resolveEligibleActor(tx, actorUserId);
  } catch {
    return onForbidden("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");
  }
}

/** flowchart_id + a fresh change_group_id per call — never shared across two separate insertFlowchartEditHistory calls (each 6B action is one row, one group; compound multi-row groups are a 6C+ concern once node/edge CRUD exists). */
async function insertFlowchartEditHistory(
  tx: Tx,
  row: {
    flowchartId: string;
    actionType: "CREATE_FLOWCHART" | "UPDATE_FLOWCHART_METADATA" | "SOFT_DELETE_FLOWCHART";
    beforeState?: unknown;
    afterState?: unknown;
    actorUserId: string;
    changeGroupId: string;
  }
): Promise<void> {
  await tx.insert(repairCaseFlowchartEditHistory).values({
    flowchartId: row.flowchartId,
    actionType: row.actionType,
    beforeState: row.beforeState ?? null,
    afterState: row.afterState ?? null,
    actorUserId: row.actorUserId,
    changeGroupId: row.changeGroupId,
    origin: "USER_EDIT",
  });
}

/** Exported for reuse by repair-case-flowchart-graph.ts (5C-6C) — the graph-editing gate locks/re-checks the same case row this file's own mutations always have, never a second/looser copy of the query. */
export async function loadCaseForUpdate(tx: Tx, repairCaseId: string) {
  const [repairCase] = await tx
    .select({ id: repairCases.id, isLocked: repairCases.isLocked, assignedEngineerId: repairCases.assignedEngineerId })
    .from(repairCases)
    .where(and(eq(repairCases.id, repairCaseId), eq(repairCases.isDeleted, false)))
    .for("update");
  return repairCase ?? null;
}

// ---- 생성 (create) ----

export type CreateRepairCaseFlowchartResult =
  | { ok: true; id: string; createdAt: string; updatedAt: string }
  | CreateFailure;

export async function createRepairCaseFlowchart(params: {
  repairCaseId: string;
  actorUserId: string;
  title: string;
  description: string | null;
}): Promise<CreateRepairCaseFlowchartResult> {
  const title = params.title.trim();
  if (title.length === 0) return { ok: false, code: "INVALID_INPUT", message: "Flowchart 제목을 입력해 주세요." };

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, params.actorUserId, failCreate);

      const repairCase = await loadCaseForUpdate(tx, params.repairCaseId);
      if (!repairCase) failCreate("NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");

      const isAssignedToCase = repairCase.assignedEngineerId === actor.id;
      if (!canMutateRepairCaseFlowchart(actor.role, { isAssignedToCase, isCaseLocked: repairCase.isLocked })) {
        if (repairCase.isLocked) failCreate("CASE_LOCKED", "잠금된 접수 건입니다. 이 작업을 수행할 수 없습니다.");
        failCreate("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
      }

      const [inserted] = await tx
        .insert(repairCaseFlowcharts)
        .values({
          repairCaseId: params.repairCaseId,
          title,
          description: params.description,
          createdBy: actor.id,
          updatedBy: actor.id,
        })
        .returning();

      await insertFlowchartEditHistory(tx, {
        flowchartId: inserted.id,
        actionType: "CREATE_FLOWCHART",
        afterState: {
          id: inserted.id,
          repairCaseId: inserted.repairCaseId,
          title: inserted.title,
          description: inserted.description,
        },
        actorUserId: actor.id,
        changeGroupId: randomUUID(),
      });

      return { ok: true, id: inserted.id, createdAt: inserted.createdAt.toISOString(), updatedAt: inserted.updatedAt.toISOString() };
    });
  } catch (err) {
    if (err instanceof CreateFlowchartMutationError) return err.result;
    throw err;
  }
}

// ---- 메타데이터 수정 (update) ----

export type UpdateRepairCaseFlowchartMetadataResult =
  | { ok: true; id: string; updatedAt: string; changed: boolean }
  | UpdateFailure;

export async function updateRepairCaseFlowchartMetadata(params: {
  repairCaseId: string;
  flowchartId: string;
  actorUserId: string;
  title: string;
  description: string | null;
  expectedUpdatedAt: string;
}): Promise<UpdateRepairCaseFlowchartMetadataResult> {
  const title = params.title.trim();
  if (title.length === 0) return { ok: false, code: "INVALID_INPUT", message: "Flowchart 제목을 입력해 주세요." };

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, params.actorUserId, failUpdate);

      const [flowchart] = await tx
        .select()
        .from(repairCaseFlowcharts)
        .where(
          and(
            eq(repairCaseFlowcharts.id, params.flowchartId),
            eq(repairCaseFlowcharts.repairCaseId, params.repairCaseId),
            eq(repairCaseFlowcharts.isDeleted, false)
          )
        )
        .for("update");
      // Deliberately the same NOT_FOUND for "doesn't exist," "already
      // soft-deleted," and "belongs to a different repair case" — never
      // distinguishes a cross-case mismatch from a genuine absence (IDOR
      // defense-in-depth, see repair-case-flowcharts.integration.test.ts's
      // ownership tests).
      if (!flowchart) failUpdate("NOT_FOUND", "해당 Flowchart를 찾을 수 없습니다.");

      const repairCase = await loadCaseForUpdate(tx, params.repairCaseId);
      if (!repairCase) failUpdate("NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");

      const isAssignedToCase = repairCase.assignedEngineerId === actor.id;
      if (!canMutateRepairCaseFlowchart(actor.role, { isAssignedToCase, isCaseLocked: repairCase.isLocked })) {
        if (repairCase.isLocked) failUpdate("CASE_LOCKED", "잠금된 접수 건입니다. 이 작업을 수행할 수 없습니다.");
        failUpdate("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
      }

      if (flowchart.updatedAt.toISOString() !== params.expectedUpdatedAt) {
        failUpdate("STALE_REVISION", "다른 사용자가 이 Flowchart를 수정했습니다. 새로고침 후 다시 시도하세요.");
      }

      const nextDescription = params.description;
      const changed = flowchart.title !== title || flowchart.description !== nextDescription;

      if (!changed) {
        // Clean no-op: never bump updated_at/updated_by, never write a
        // meaningless history row for a request that changed nothing.
        return { ok: true, id: flowchart.id, updatedAt: flowchart.updatedAt.toISOString(), changed: false };
      }

      const beforeState = { id: flowchart.id, title: flowchart.title, description: flowchart.description };

      const [updated] = await tx
        .update(repairCaseFlowcharts)
        .set({ title, description: nextDescription, updatedBy: actor.id, updatedAt: new Date() })
        .where(eq(repairCaseFlowcharts.id, flowchart.id))
        .returning();

      await insertFlowchartEditHistory(tx, {
        flowchartId: flowchart.id,
        actionType: "UPDATE_FLOWCHART_METADATA",
        beforeState,
        afterState: { id: updated.id, title: updated.title, description: updated.description },
        actorUserId: actor.id,
        changeGroupId: randomUUID(),
      });

      return { ok: true, id: updated.id, updatedAt: updated.updatedAt.toISOString(), changed: true };
    });
  } catch (err) {
    if (err instanceof UpdateFlowchartMutationError) return err.result;
    throw err;
  }
}

// ---- 소프트 삭제 (soft delete) ----

export type SoftDeleteRepairCaseFlowchartResult =
  | { ok: true; id: string; deletedAt: string }
  | SoftDeleteFailure;

/**
 * Never hard-deletes, never cascades to nodes/edges/history — those rows
 * remain exactly as they were, only the parent flowchart row's own 4
 * soft-delete columns change. Restore-from-soft-delete is deliberately not
 * implemented here: no existing product convention in this codebase
 * currently supports undeleting a soft-deleted case-owned row (customers/
 * end_users have no restore path either), so 6B does not invent one.
 */
export async function softDeleteRepairCaseFlowchart(params: {
  repairCaseId: string;
  flowchartId: string;
  actorUserId: string;
  deleteReason: string | null;
  expectedUpdatedAt: string;
}): Promise<SoftDeleteRepairCaseFlowchartResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, params.actorUserId, failSoftDelete);

      const [flowchart] = await tx
        .select()
        .from(repairCaseFlowcharts)
        .where(
          and(
            eq(repairCaseFlowcharts.id, params.flowchartId),
            eq(repairCaseFlowcharts.repairCaseId, params.repairCaseId),
            eq(repairCaseFlowcharts.isDeleted, false)
          )
        )
        .for("update");
      if (!flowchart) failSoftDelete("NOT_FOUND", "해당 Flowchart를 찾을 수 없습니다.");

      const repairCase = await loadCaseForUpdate(tx, params.repairCaseId);
      if (!repairCase) failSoftDelete("NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");

      const isAssignedToCase = repairCase.assignedEngineerId === actor.id;
      if (!canMutateRepairCaseFlowchart(actor.role, { isAssignedToCase, isCaseLocked: repairCase.isLocked })) {
        if (repairCase.isLocked) failSoftDelete("CASE_LOCKED", "잠금된 접수 건입니다. 이 작업을 수행할 수 없습니다.");
        failSoftDelete("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
      }

      if (flowchart.updatedAt.toISOString() !== params.expectedUpdatedAt) {
        failSoftDelete("STALE_REVISION", "다른 사용자가 이 Flowchart를 수정했습니다. 새로고침 후 다시 시도하세요.");
      }

      const beforeState = {
        id: flowchart.id,
        repairCaseId: flowchart.repairCaseId,
        title: flowchart.title,
        description: flowchart.description,
        isDeleted: flowchart.isDeleted,
      };

      const now = new Date();
      const [updated] = await tx
        .update(repairCaseFlowcharts)
        .set({
          isDeleted: true,
          deletedAt: now,
          deletedBy: actor.id,
          deleteReason: params.deleteReason,
          updatedBy: actor.id,
          updatedAt: now,
        })
        .where(eq(repairCaseFlowcharts.id, flowchart.id))
        .returning();

      await insertFlowchartEditHistory(tx, {
        flowchartId: flowchart.id,
        actionType: "SOFT_DELETE_FLOWCHART",
        beforeState,
        afterState: {
          id: updated.id,
          repairCaseId: updated.repairCaseId,
          title: updated.title,
          description: updated.description,
          isDeleted: updated.isDeleted,
          deletedAt: updated.deletedAt!.toISOString(),
          deleteReason: updated.deleteReason,
        },
        actorUserId: actor.id,
        changeGroupId: randomUUID(),
      });

      return { ok: true, id: updated.id, deletedAt: updated.deletedAt!.toISOString() };
    });
  } catch (err) {
    if (err instanceof SoftDeleteFlowchartMutationError) return err.result;
    throw err;
  }
}
