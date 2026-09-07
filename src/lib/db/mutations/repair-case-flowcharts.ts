import "server-only";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../client";
import {
  repairCases,
  repairCaseFlowcharts,
  repairCaseFlowchartEditHistory,
  repairCaseFlowchartNodes,
  repairCaseFlowchartEdges,
} from "../schema";
import { resolveEligibleActor, type Tx } from "./procedure-templates";
import { hasPermission } from "@/lib/auth/permission-resolver";

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
 *  - shipment-lock removal policy: repair_cases.is_locked no longer blocks
 *    any of these mutations (canMutateRepairCaseFlowchart ignores it) — a
 *    shipped case's flowcharts stay fully manageable, see
 *    isBlockedByShipmentLock (repair-case-edit-authorization.ts).
 *
 * Deliberately independent of procedure_template_edit_history: every
 * history row this module writes goes into
 * repair_case_flowchart_edit_history (0019), never the template table —
 * case-flowchart audit data stays fully isolated from template audit data.
 */

export type CreateFlowchartResultCode = "FORBIDDEN" | "NOT_FOUND" | "CASE_LOCKED" | "INVALID_INPUT" | "BILLING_DECISION_REQUIRED";
export type UpdateFlowchartMetadataResultCode = "FORBIDDEN" | "NOT_FOUND" | "CASE_LOCKED" | "INVALID_INPUT" | "STALE_REVISION" | "BILLING_DECISION_REQUIRED";
export type SoftDeleteFlowchartResultCode = "FORBIDDEN" | "NOT_FOUND" | "CASE_LOCKED" | "STALE_REVISION";
export type RestoreFlowchartResultCode = "FORBIDDEN" | "NOT_FOUND" | "CASE_LOCKED" | "STALE_REVISION";
export type PermanentlyDeleteFlowchartResultCode = "FORBIDDEN" | "NOT_FOUND" | "STALE_REVISION";

type CreateFailure = { ok: false; code: CreateFlowchartResultCode; message: string };
type UpdateFailure = { ok: false; code: UpdateFlowchartMetadataResultCode; message: string };
type SoftDeleteFailure = { ok: false; code: SoftDeleteFlowchartResultCode; message: string };
type RestoreFailure = { ok: false; code: RestoreFlowchartResultCode; message: string };
type PermanentlyDeleteFailure = { ok: false; code: PermanentlyDeleteFlowchartResultCode; message: string };

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

class RestoreFlowchartMutationError extends Error {
  result: RestoreFailure;
  constructor(result: RestoreFailure) {
    super(result.message);
    this.result = result;
  }
}

class PermanentlyDeleteFlowchartMutationError extends Error {
  result: PermanentlyDeleteFailure;
  constructor(result: PermanentlyDeleteFailure) {
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
function failRestore(code: RestoreFlowchartResultCode, message: string): never {
  throw new RestoreFlowchartMutationError({ ok: false, code, message });
}
function failPermanentlyDelete(code: PermanentlyDeleteFlowchartResultCode, message: string): never {
  throw new PermanentlyDeleteFlowchartMutationError({ ok: false, code, message });
}

async function requireActor(tx: Tx, actorUserId: string, onForbidden: (code: "FORBIDDEN", message: string) => never) {
  try {
    return await resolveEligibleActor(tx, actorUserId);
  } catch {
    return onForbidden("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");
  }
}

/** flowchart_id + a fresh change_group_id per call — never shared across two separate insertFlowchartEditHistory calls (each 6B action is one row, one group; compound multi-row groups are a 6C+ concern once node/edge CRUD exists). `reason` is optional and only ever populated by permanentlyDeleteRepairCaseFlowchart below (the mandatory permanent-delete reason) — every other action type here has never used this column and keeps passing nothing, defaulting to null. */
async function insertFlowchartEditHistory(
  tx: Tx,
  row: {
    flowchartId: string;
    actionType: "CREATE_FLOWCHART" | "UPDATE_FLOWCHART_METADATA" | "SOFT_DELETE_FLOWCHART" | "RESTORE_FLOWCHART" | "PURGE_FLOWCHART";
    beforeState?: unknown;
    afterState?: unknown;
    reason?: string | null;
    actorUserId: string;
    changeGroupId: string;
  }
): Promise<void> {
  await tx.insert(repairCaseFlowchartEditHistory).values({
    flowchartId: row.flowchartId,
    actionType: row.actionType,
    beforeState: row.beforeState ?? null,
    afterState: row.afterState ?? null,
    reason: row.reason ?? null,
    actorUserId: row.actorUserId,
    changeGroupId: row.changeGroupId,
    origin: "USER_EDIT",
  });
}

/** Exported for reuse by repair-case-flowchart-graph.ts (5C-6C) — the graph-editing gate locks/re-checks the same case row this file's own mutations always have, never a second/looser copy of the query. */
export async function loadCaseForUpdate(tx: Tx, repairCaseId: string) {
  const [repairCase] = await tx
    .select({ id: repairCases.id, isLocked: repairCases.isLocked, assignedEngineerId: repairCases.assignedEngineerId, billingType: repairCases.billingType })
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
      if (repairCase.billingType === "PENDING_DECISION") {
        failCreate("BILLING_DECISION_REQUIRED", "유·무상을 확정한 후 Case Flowchart를 생성할 수 있습니다.");
      }

      if (!(await hasPermission(actor, "diagnosisFlowcharts.edit", "WRITE"))) {
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
      if (repairCase.billingType === "PENDING_DECISION") {
        failUpdate("BILLING_DECISION_REQUIRED", "유·무상을 확정한 후 Case Flowchart를 변경할 수 있습니다.");
      }

      if (!(await hasPermission(actor, "diagnosisFlowcharts.edit", "WRITE"))) {
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
 * soft-delete columns change. Restore-from-soft-delete is implemented
 * separately below (restoreRepairCaseFlowchart, Checkpoint 3B).
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

      if (!(await hasPermission(actor, "diagnosisFlowcharts.edit", "WRITE"))) {
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

// ---- 복원 (restore from trash) ----

export type RestoreRepairCaseFlowchartResult =
  | { ok: true; id: string; updatedAt: string }
  | RestoreFailure;

/**
 * Checkpoint 3B — un-deletes a soft-deleted flowchart: clears all 4
 * soft-delete columns (is_deleted/deleted_at/deleted_by/delete_reason),
 * never touches nodes/edges/history (identical non-cascading guarantee as
 * softDeleteRepairCaseFlowchart — restore is symmetric with delete at
 * exactly this table's level, nothing more).
 *
 * Reuses canMutateRepairCaseFlowchart unchanged — same role set
 * (SUPER_ADMIN/ADMIN/AS_ENGINEER) and the same unconditional case-lock gate
 * as create/update/soft-delete, so a flowchart belonging to a
 * since-relocked case cannot be restored either. The 15-day retention
 * window is eligibility-display only (getFlowchartRetentionStatus) and is
 * never checked here — no purge exists yet, so nothing is ever too old to
 * restore in this checkpoint.
 */
export async function restoreRepairCaseFlowchart(params: {
  repairCaseId: string;
  flowchartId: string;
  actorUserId: string;
  expectedUpdatedAt: string;
}): Promise<RestoreRepairCaseFlowchartResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, params.actorUserId, failRestore);

      const [flowchart] = await tx
        .select()
        .from(repairCaseFlowcharts)
        .where(
          and(
            eq(repairCaseFlowcharts.id, params.flowchartId),
            eq(repairCaseFlowcharts.repairCaseId, params.repairCaseId),
            eq(repairCaseFlowcharts.isDeleted, true)
          )
        )
        .for("update");
      // Same deliberate NOT_FOUND-for-everything convention as the other
      // mutations here: "doesn't exist," "not actually deleted," and
      // "belongs to a different repair case" are indistinguishable to the
      // caller.
      if (!flowchart) failRestore("NOT_FOUND", "해당 Flowchart를 찾을 수 없습니다.");

      const repairCase = await loadCaseForUpdate(tx, params.repairCaseId);
      if (!repairCase) failRestore("NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");

      if (!(await hasPermission(actor, "diagnosisFlowcharts.edit", "WRITE"))) {
        failRestore("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
      }

      if (flowchart.updatedAt.toISOString() !== params.expectedUpdatedAt) {
        failRestore("STALE_REVISION", "다른 사용자가 이 Flowchart를 수정했습니다. 새로고침 후 다시 시도하세요.");
      }

      const beforeState = {
        id: flowchart.id,
        repairCaseId: flowchart.repairCaseId,
        title: flowchart.title,
        description: flowchart.description,
        isDeleted: flowchart.isDeleted,
        deletedAt: flowchart.deletedAt!.toISOString(),
        deletedBy: flowchart.deletedBy,
        deleteReason: flowchart.deleteReason,
      };

      const now = new Date();
      const [updated] = await tx
        .update(repairCaseFlowcharts)
        .set({
          isDeleted: false,
          deletedAt: null,
          deletedBy: null,
          deleteReason: null,
          updatedBy: actor.id,
          updatedAt: now,
        })
        .where(eq(repairCaseFlowcharts.id, flowchart.id))
        .returning();

      await insertFlowchartEditHistory(tx, {
        flowchartId: flowchart.id,
        actionType: "RESTORE_FLOWCHART",
        beforeState,
        afterState: {
          id: updated.id,
          repairCaseId: updated.repairCaseId,
          title: updated.title,
          description: updated.description,
          isDeleted: updated.isDeleted,
        },
        actorUserId: actor.id,
        changeGroupId: randomUUID(),
      });

      return { ok: true, id: updated.id, updatedAt: updated.updatedAt.toISOString() };
    });
  } catch (err) {
    if (err instanceof RestoreFlowchartMutationError) return err.result;
    throw err;
  }
}

// ---- 영구 삭제 (permanent delete) ----

export type PermanentlyDeleteRepairCaseFlowchartResult =
  | { ok: true; id: string }
  | PermanentlyDeleteFailure;

/**
 * Irreversible hard delete of an already-soft-deleted (휴지통) flowchart.
 * SUPER_ADMIN/ADMIN only (canPermanentlyDeleteRepairCaseFlowchart) — a
 * genuinely narrower, separate rule from canMutateRepairCaseFlowchart
 * (which also allows AS_ENGINEER for create/update/soft-delete/restore).
 * No case-lock check at all: the shipment-lock removal policy already
 * means repair_cases.is_locked never gates flowchart mutations, and this
 * target row is already soft-deleted regardless.
 *
 * Delete order is explicit, never left to ON DELETE CASCADE timing across
 * the edges→nodes sideways RESTRICT constraint (see this checkpoint's own
 * schema audit):
 *  1. write the PURGE_FLOWCHART history row FIRST, while flowchart_id is
 *     still a valid reference — this row (and every prior history row for
 *     this flowchart) survives the delete via flowchart_id ON DELETE SET
 *     NULL (migration 0026); before_state permanently preserves the
 *     flowchart's identity/title/description/soft-delete state, and
 *     `reason` carries the mandatory operator-supplied justification.
 *  2. delete edges (their ownership FK to nodes is RESTRICT, so they must
 *     go before nodes).
 *  3. delete nodes.
 *  4. delete the flowchart row itself.
 * All in one transaction with the flowchart row locked FOR UPDATE from the
 * start — a concurrent restore/purge attempt either blocks until this
 * commits (then sees NOT_FOUND, since the row and its lock target are both
 * gone) or this blocks on theirs.
 */
export async function permanentlyDeleteRepairCaseFlowchart(params: {
  repairCaseId: string;
  flowchartId: string;
  actorUserId: string;
  deleteReason: string;
  expectedUpdatedAt: string;
}): Promise<PermanentlyDeleteRepairCaseFlowchartResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, params.actorUserId, failPermanentlyDelete);

      const [flowchart] = await tx
        .select()
        .from(repairCaseFlowcharts)
        .where(
          and(
            eq(repairCaseFlowcharts.id, params.flowchartId),
            eq(repairCaseFlowcharts.repairCaseId, params.repairCaseId),
            eq(repairCaseFlowcharts.isDeleted, true)
          )
        )
        .for("update");
      // Same deliberate NOT_FOUND-for-everything convention as every other
      // mutation here: "doesn't exist," "not soft-deleted yet" (must be
      // trashed first), and "belongs to a different repair case" are all
      // indistinguishable to the caller.
      if (!flowchart) failPermanentlyDelete("NOT_FOUND", "해당 Flowchart를 찾을 수 없습니다.");

      if (!(await hasPermission(actor, "diagnosisFlowcharts.permanentDelete", "MANAGE"))) {
        failPermanentlyDelete("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
      }

      if (flowchart.updatedAt.toISOString() !== params.expectedUpdatedAt) {
        failPermanentlyDelete("STALE_REVISION", "다른 사용자가 이 Flowchart를 수정했습니다. 새로고침 후 다시 시도하세요.");
      }

      await insertFlowchartEditHistory(tx, {
        flowchartId: flowchart.id,
        actionType: "PURGE_FLOWCHART",
        beforeState: {
          id: flowchart.id,
          repairCaseId: flowchart.repairCaseId,
          title: flowchart.title,
          description: flowchart.description,
          isDeleted: flowchart.isDeleted,
          deletedAt: flowchart.deletedAt!.toISOString(),
          deletedBy: flowchart.deletedBy,
          deleteReason: flowchart.deleteReason,
        },
        afterState: null,
        reason: params.deleteReason,
        actorUserId: actor.id,
        changeGroupId: randomUUID(),
      });

      await tx.delete(repairCaseFlowchartEdges).where(eq(repairCaseFlowchartEdges.flowchartId, flowchart.id));
      await tx.delete(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.flowchartId, flowchart.id));
      await tx.delete(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, flowchart.id));

      return { ok: true, id: flowchart.id };
    });
  } catch (err) {
    if (err instanceof PermanentlyDeleteFlowchartMutationError) return err.result;
    throw err;
  }
}

// ---- 접수 건 영구 삭제 시 flowchart 일괄 정리 (cascade purge from repair case) ----

/**
 * Repair Case Permanent Delete checkpoint — called from
 * permanentlyDeleteRepairCase (repair-cases.ts) as one step inside that
 * mutation's own transaction, immediately before the repair_cases row
 * itself is deleted. repair_case_flowcharts.repair_case_id was
 * deliberately kept NOT NULL + RESTRICT by migration 0031 (unlike the 6
 * history/accounting tables, which became nullable + SET NULL) — the
 * approved policy is "no orphan flowcharts survive a case purge," so every
 * flowchart belonging to this case (active OR already individually
 * soft-deleted — a case can be purged while its flowcharts were never
 * individually trashed) is force-purged here, ignoring each flowchart's
 * own 15-day retention timer entirely: the parent case's own purge decision
 * is authoritative and final.
 *
 * Same delete order as permanentlyDeleteRepairCaseFlowchart (edges → nodes
 * → flowchart, PURGE_FLOWCHART history written first while flowchart_id is
 * still a valid reference), looped over every flowchart row for this case.
 * No per-flowchart expectedUpdatedAt/staleness check — unlike the
 * standalone single-flowchart 완전 삭제 action (a human reacting to
 * possibly-stale browser state), this is a system-cascade step already
 * covered by the caller's own lock on the parent repair_cases row, and
 * additionally locks each flowchart row here with its own `.for("update")`
 * before touching it.
 */
export async function purgeAllRepairCaseFlowchartsForCase(
  tx: Tx,
  params: { repairCaseId: string; actorUserId: string; reason: string }
): Promise<void> {
  const flowcharts = await tx
    .select()
    .from(repairCaseFlowcharts)
    .where(eq(repairCaseFlowcharts.repairCaseId, params.repairCaseId))
    .for("update");

  for (const flowchart of flowcharts) {
    await insertFlowchartEditHistory(tx, {
      flowchartId: flowchart.id,
      actionType: "PURGE_FLOWCHART",
      beforeState: {
        id: flowchart.id,
        repairCaseId: flowchart.repairCaseId,
        title: flowchart.title,
        description: flowchart.description,
        isDeleted: flowchart.isDeleted,
        // Unlike the standalone permanent-delete action above, a flowchart
        // reaching this loop may never have been individually soft-deleted
        // at all (isDeleted=false, deletedAt=null) — its own case being
        // purged is what's forcing this, not its own trash lifecycle.
        deletedAt: flowchart.deletedAt ? flowchart.deletedAt.toISOString() : null,
        deletedBy: flowchart.deletedBy,
        deleteReason: flowchart.deleteReason,
      },
      afterState: null,
      reason: params.reason,
      actorUserId: params.actorUserId,
      changeGroupId: randomUUID(),
    });

    await tx.delete(repairCaseFlowchartEdges).where(eq(repairCaseFlowchartEdges.flowchartId, flowchart.id));
    await tx.delete(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.flowchartId, flowchart.id));
    await tx.delete(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, flowchart.id));
  }
}
