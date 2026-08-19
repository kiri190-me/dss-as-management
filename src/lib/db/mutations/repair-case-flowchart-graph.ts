import "server-only";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../client";
import {
  repairCaseFlowcharts,
  repairCaseFlowchartNodes,
  repairCaseFlowchartEdges,
  repairCaseFlowchartEditHistory,
} from "../schema";
import { resolveEligibleActor, type Tx } from "./procedure-templates";
import { loadCaseForUpdate } from "./repair-case-flowcharts";
import { hasPermission } from "@/lib/auth/permission-resolver";
import {
  REPAIR_CASE_FLOWCHART_NODE_TYPE_CODES,
  REPAIR_CASE_FLOWCHART_BRANCH_TYPE_CODES,
  type RepairCaseFlowchartNodeType,
  type RepairCaseFlowchartBranchType,
} from "@/lib/domain/repair-case-flowchart-types";
import { sanitizeRoutePoints, routePointsEqual } from "@/lib/graph-editor-core/routing";

/**
 * Phase 5C-6C — graph (node/edge) CRUD for case-owned diagnostic
 * flowcharts. Deliberately a separate file from repair-case-flowcharts.ts
 * (5C-6B, object-level create/rename/soft-delete) — same separation as
 * procedure-templates.ts (object-level) vs procedure-template-editor.ts
 * (graph-level). Reuses 5C-6B's `canMutateRepairCaseFlowchart` and
 * `loadCaseForUpdate` directly rather than duplicating the authorization
 * rule or the case-locking query; everything else here is new, adapted from
 * procedure-template-editor.ts's proven CONCEPTS (gate ordering, snapshot-
 * before-delete, no-op suppression, duplicate/self-edge rules, SET NULL
 * history survival) — never its storage. This module never writes to
 * procedure_template_nodes/edges/edit_history, and procedure-template-
 * editor.ts is never imported here.
 *
 * Every mutation:
 *  - re-checks the actor from the live DB (resolveEligibleActor);
 *  - locks the flowchart row FOR UPDATE, scoped by (id, repairCaseId,
 *    isDeleted=false) — a soft-deleted or cross-case flowchart is NOT_FOUND;
 *  - locks the repair case row and re-evaluates
 *    canMutateRepairCaseFlowchart (role + case-lock — no assignment
 *    scoping as of Checkpoint 3A), unconditional for every role including
 *    SUPER_ADMIN;
 *  - verifies expectedFlowchartUpdatedAt against the flowchart row (never a
 *    per-node/per-edge token);
 *  - writes exactly one repair_case_flowchart_edit_history group per
 *    logical mutation, origin=USER_EDIT, sourceGroupId=null,
 *    restoreTargetGroupId=null — Undo/Redo/Restore do not exist yet (6E);
 *  - bumps flowchart.updatedAt/updatedBy on success only.
 */

export type GraphMutationResultCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CASE_LOCKED"
  | "STALE_REVISION"
  | "INVALID_INPUT"
  | "SELF_EDGE"
  | "DUPLICATE_EDGE"
  | "CROSS_FLOWCHART"
  | "BILLING_DECISION_REQUIRED";

type Failure = { ok: false; code: GraphMutationResultCode; message: string };

export type BlockingEdgeSummary = { edgeId: string; direction: "INCOMING" | "OUTGOING"; otherNodeId: string };
export type NodeHasConnectedEdgesFailure = {
  ok: false;
  code: "NODE_HAS_CONNECTED_EDGES";
  message: string;
  blockingEdgeCount: number;
  blockingEdgeIds: string[];
  blockingEdges: BlockingEdgeSummary[];
};

class GraphMutationError extends Error {
  result: Failure;
  constructor(result: Failure) {
    super(result.message);
    this.result = result;
  }
}
class DetailedGraphMutationError extends Error {
  result: NodeHasConnectedEdgesFailure;
  constructor(result: NodeHasConnectedEdgesFailure) {
    super(result.message);
    this.result = result;
  }
}

function fail(code: GraphMutationResultCode, message: string): never {
  throw new GraphMutationError({ ok: false, code, message });
}

function isBlank(s: string | null | undefined): boolean {
  return s === null || s === undefined || s.trim().length === 0;
}

// ---- shared gate: actor + flowchart (locked) + case (locked, authorized) + concurrency ----

type EligibleActor = { id: string; role: Awaited<ReturnType<typeof resolveEligibleActor>>["role"] };

async function requireActor(tx: Tx, actorUserId: string): Promise<EligibleActor> {
  try {
    return await resolveEligibleActor(tx, actorUserId);
  } catch {
    return fail("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");
  }
}

/**
 * The one authoritative gate every graph mutation in this file calls first.
 * Sequence: resolve actor -> lock+load flowchart (scoped by
 * repairCaseId+isDeleted=false) -> lock+load case -> authorize (role + lock,
 * unconditional — Checkpoint 3A removed AS_ENGINEER's assignment scoping) ->
 * verify expectedFlowchartUpdatedAt. Returns the locked flowchart row so
 * callers never re-query it.
 */
async function loadFlowchartForGraphEdit(
  tx: Tx,
  repairCaseId: string,
  flowchartId: string,
  expectedFlowchartUpdatedAt: string,
  actor: EligibleActor
) {
  const [flowchart] = await tx
    .select()
    .from(repairCaseFlowcharts)
    .where(and(eq(repairCaseFlowcharts.id, flowchartId), eq(repairCaseFlowcharts.repairCaseId, repairCaseId), eq(repairCaseFlowcharts.isDeleted, false)))
    .for("update");
  if (!flowchart) fail("NOT_FOUND", "해당 Flowchart를 찾을 수 없습니다.");

  const repairCase = await loadCaseForUpdate(tx, repairCaseId);
  if (!repairCase) fail("NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");
  if (repairCase.billingType === "PENDING_DECISION") {
    fail("BILLING_DECISION_REQUIRED", "유·무상을 확정한 후 Case Flowchart를 진행할 수 있습니다.");
  }

  if (!(await hasPermission(actor.role, "diagnosisFlowcharts.edit", "WRITE"))) {
    fail("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  }

  if (flowchart.updatedAt.toISOString() !== expectedFlowchartUpdatedAt) {
    fail("STALE_REVISION", "다른 사용자가 이 Flowchart를 수정했습니다. 새로고침 후 다시 시도하세요.");
  }

  return flowchart;
}

async function touchFlowchart(tx: Tx, flowchartId: string, actorId: string): Promise<string> {
  const now = new Date();
  await tx.update(repairCaseFlowcharts).set({ updatedAt: now, updatedBy: actorId }).where(eq(repairCaseFlowcharts.id, flowchartId));
  return now.toISOString();
}

type GraphEditActionType =
  | "CREATE_NODE"
  | "UPDATE_NODE"
  | "CHANGE_NODE_TYPE"
  | "DELETE_NODE"
  | "CREATE_EDGE"
  | "UPDATE_EDGE"
  | "RETARGET_EDGE"
  | "DELETE_EDGE"
  | "SAVE_LAYOUT"
  | "SAVE_EDGE_ROUTE";

async function insertGraphEditHistory(
  tx: Tx,
  row: {
    flowchartId: string;
    actionType: GraphEditActionType;
    nodeId?: string | null;
    edgeId?: string | null;
    beforeState?: unknown;
    afterState?: unknown;
    actorUserId: string;
    changeGroupId: string;
  }
): Promise<void> {
  await tx.insert(repairCaseFlowchartEditHistory).values({
    flowchartId: row.flowchartId,
    actionType: row.actionType,
    nodeId: row.nodeId ?? null,
    edgeId: row.edgeId ?? null,
    beforeState: row.beforeState ?? null,
    afterState: row.afterState ?? null,
    actorUserId: row.actorUserId,
    changeGroupId: row.changeGroupId,
    origin: "USER_EDIT",
  });
}

// ---- snapshots (self-identifying — survive a later hard delete's SET NULL) ----

export type RepairCaseFlowchartNodeSnapshot = {
  id: string;
  flowchartId: string;
  nodeType: RepairCaseFlowchartNodeType;
  title: string;
  description: string | null;
  instructions: string | null;
  positionX: number;
  positionY: number;
};

function serializeNodeSnapshot(node: typeof repairCaseFlowchartNodes.$inferSelect): RepairCaseFlowchartNodeSnapshot {
  return {
    id: node.id,
    flowchartId: node.flowchartId,
    nodeType: node.nodeType,
    title: node.title,
    description: node.description,
    instructions: node.instructions,
    positionX: node.positionX,
    positionY: node.positionY,
  };
}

export type RepairCaseFlowchartEdgeSnapshot = {
  id: string;
  flowchartId: string;
  fromNodeId: string;
  toNodeId: string;
  branchType: RepairCaseFlowchartBranchType;
  branchLabel: string | null;
  routePoints: { x: number; y: number }[] | null;
};

function serializeEdgeSnapshot(edge: typeof repairCaseFlowchartEdges.$inferSelect): RepairCaseFlowchartEdgeSnapshot {
  return {
    id: edge.id,
    flowchartId: edge.flowchartId,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
    branchType: edge.branchType,
    branchLabel: edge.branchLabel,
    routePoints: edge.routePoints,
  };
}

/** Loaded once by createEdge/retargetEdge for each endpoint — NOT_FOUND if the id has no row at all, CROSS_FLOWCHART if it exists but belongs to a different flowchart (never conflated, same distinction procedure-template-editor.ts's loadNodeInTemplate makes). */
async function loadNodeInFlowchart(tx: Tx, flowchartId: string, nodeId: string) {
  const [node] = await tx.select().from(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.id, nodeId));
  if (!node) fail("NOT_FOUND", `노드 ${nodeId}을(를) 찾을 수 없습니다.`);
  if (node.flowchartId !== flowchartId) fail("CROSS_FLOWCHART", "다른 Flowchart에 속한 노드는 참조할 수 없습니다.");
  return node;
}

async function assertNoDuplicateEdge(
  tx: Tx,
  flowchartId: string,
  fromNodeId: string,
  toNodeId: string,
  branchType: RepairCaseFlowchartBranchType,
  excludeEdgeId?: string
) {
  const rows = await tx
    .select({ id: repairCaseFlowchartEdges.id })
    .from(repairCaseFlowchartEdges)
    .where(
      and(
        eq(repairCaseFlowchartEdges.flowchartId, flowchartId),
        eq(repairCaseFlowchartEdges.fromNodeId, fromNodeId),
        eq(repairCaseFlowchartEdges.toNodeId, toNodeId),
        eq(repairCaseFlowchartEdges.branchType, branchType)
      )
    );
  const conflicting = excludeEdgeId ? rows.filter((r) => r.id !== excludeEdgeId) : rows;
  if (conflicting.length > 0) fail("DUPLICATE_EDGE", "동일한 시작/대상/분기 유형을 가진 분기가 이미 존재합니다.");
}

// =====================================================================
// NODE
// =====================================================================

export type CreateNodeResult = { ok: true; nodeId: string; updatedAt: string } | Failure;

export async function createRepairCaseFlowchartNode(params: {
  repairCaseId: string;
  flowchartId: string;
  actorUserId: string;
  nodeType: string;
  title: string;
  description: string | null;
  position?: { x: number; y: number } | null;
  expectedFlowchartUpdatedAt: string;
}): Promise<CreateNodeResult> {
  const title = params.title.trim();
  if (title.length === 0) return { ok: false, code: "INVALID_INPUT", message: "노드 제목을 입력해 주세요." };
  if (!(REPAIR_CASE_FLOWCHART_NODE_TYPE_CODES as readonly string[]).includes(params.nodeType)) {
    return { ok: false, code: "INVALID_INPUT", message: "지원되지 않는 노드 유형입니다." };
  }
  if (params.position && (!Number.isFinite(params.position.x) || !Number.isFinite(params.position.y))) {
    return { ok: false, code: "INVALID_INPUT", message: "노드 위치가 올바르지 않습니다." };
  }

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, params.actorUserId);
      await loadFlowchartForGraphEdit(tx, params.repairCaseId, params.flowchartId, params.expectedFlowchartUpdatedAt, actor);

      let positionX = 0;
      let positionY = 0;
      if (params.position) {
        positionX = params.position.x;
        positionY = params.position.y;
      } else {
        const [maxPositionYRow] = await tx
          .select({ positionY: repairCaseFlowchartNodes.positionY })
          .from(repairCaseFlowchartNodes)
          .where(eq(repairCaseFlowchartNodes.flowchartId, params.flowchartId))
          .orderBy(desc(repairCaseFlowchartNodes.positionY))
          .limit(1);
        positionY = maxPositionYRow ? maxPositionYRow.positionY + 150 : 0;
      }

      const [inserted] = await tx
        .insert(repairCaseFlowchartNodes)
        .values({
          flowchartId: params.flowchartId,
          nodeType: params.nodeType as RepairCaseFlowchartNodeType,
          title,
          description: params.description,
          positionX,
          positionY,
        })
        .returning();

      await insertGraphEditHistory(tx, {
        flowchartId: params.flowchartId,
        actionType: "CREATE_NODE",
        nodeId: inserted.id,
        beforeState: null,
        afterState: serializeNodeSnapshot(inserted),
        actorUserId: actor.id,
        changeGroupId: randomUUID(),
      });

      const updatedAt = await touchFlowchart(tx, params.flowchartId, actor.id);
      return { ok: true, nodeId: inserted.id, updatedAt };
    });
  } catch (err) {
    if (err instanceof GraphMutationError) return err.result;
    throw err;
  }
}

export type UpdateNodeResult = { ok: true; updatedAt: string; changed: boolean } | Failure;

export async function updateRepairCaseFlowchartNode(params: {
  repairCaseId: string;
  flowchartId: string;
  nodeId: string;
  actorUserId: string;
  title: string;
  description: string | null;
  instructions: string | null;
  expectedFlowchartUpdatedAt: string;
}): Promise<UpdateNodeResult> {
  const title = params.title.trim();
  if (title.length === 0) return { ok: false, code: "INVALID_INPUT", message: "노드 제목을 입력해 주세요." };

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, params.actorUserId);
      const flowchart = await loadFlowchartForGraphEdit(tx, params.repairCaseId, params.flowchartId, params.expectedFlowchartUpdatedAt, actor);

      const [node] = await tx.select().from(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.id, params.nodeId)).for("update");
      if (!node) fail("NOT_FOUND", "해당 노드를 찾을 수 없습니다.");
      if (node.flowchartId !== flowchart.id) fail("CROSS_FLOWCHART", "다른 Flowchart에 속한 노드는 수정할 수 없습니다.");

      const changed = node.title !== title || node.description !== params.description || node.instructions !== params.instructions;
      if (!changed) {
        return { ok: true, updatedAt: flowchart.updatedAt.toISOString(), changed: false };
      }

      const beforeState = { id: node.id, title: node.title, description: node.description, instructions: node.instructions };
      const afterState = { id: node.id, title, description: params.description, instructions: params.instructions };

      await tx
        .update(repairCaseFlowchartNodes)
        .set({ title, description: params.description, instructions: params.instructions, updatedAt: new Date() })
        .where(eq(repairCaseFlowchartNodes.id, node.id));

      await insertGraphEditHistory(tx, {
        flowchartId: flowchart.id,
        actionType: "UPDATE_NODE",
        nodeId: node.id,
        beforeState,
        afterState,
        actorUserId: actor.id,
        changeGroupId: randomUUID(),
      });

      const updatedAt = await touchFlowchart(tx, flowchart.id, actor.id);
      return { ok: true, updatedAt, changed: true };
    });
  } catch (err) {
    if (err instanceof GraphMutationError) return err.result;
    throw err;
  }
}

export type ChangeNodeTypeResult = { ok: true; updatedAt: string; changed: boolean } | Failure;

export async function changeRepairCaseFlowchartNodeType(params: {
  repairCaseId: string;
  flowchartId: string;
  nodeId: string;
  actorUserId: string;
  nodeType: string;
  expectedFlowchartUpdatedAt: string;
}): Promise<ChangeNodeTypeResult> {
  if (!(REPAIR_CASE_FLOWCHART_NODE_TYPE_CODES as readonly string[]).includes(params.nodeType)) {
    return { ok: false, code: "INVALID_INPUT", message: "지원되지 않는 노드 유형입니다." };
  }
  const nodeType = params.nodeType as RepairCaseFlowchartNodeType;

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, params.actorUserId);
      const flowchart = await loadFlowchartForGraphEdit(tx, params.repairCaseId, params.flowchartId, params.expectedFlowchartUpdatedAt, actor);

      const [node] = await tx.select().from(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.id, params.nodeId)).for("update");
      if (!node) fail("NOT_FOUND", "해당 노드를 찾을 수 없습니다.");
      if (node.flowchartId !== flowchart.id) fail("CROSS_FLOWCHART", "다른 Flowchart에 속한 노드는 수정할 수 없습니다.");

      if (node.nodeType === nodeType) {
        return { ok: true, updatedAt: flowchart.updatedAt.toISOString(), changed: false };
      }

      const beforeState = { id: node.id, nodeType: node.nodeType };
      const afterState = { id: node.id, nodeType };

      await tx.update(repairCaseFlowchartNodes).set({ nodeType, updatedAt: new Date() }).where(eq(repairCaseFlowchartNodes.id, node.id));

      await insertGraphEditHistory(tx, {
        flowchartId: flowchart.id,
        actionType: "CHANGE_NODE_TYPE",
        nodeId: node.id,
        beforeState,
        afterState,
        actorUserId: actor.id,
        changeGroupId: randomUUID(),
      });

      const updatedAt = await touchFlowchart(tx, flowchart.id, actor.id);
      return { ok: true, updatedAt, changed: true };
    });
  } catch (err) {
    if (err instanceof GraphMutationError) return err.result;
    throw err;
  }
}

// ---- layout (batched positions — one SAVE_LAYOUT row per call, array payload) ----
//
// Representation choice (5C-6C §13): a single SAVE_LAYOUT history row per
// call, whose before/afterState is an ARRAY of {id, positionX, positionY}
// covering only the nodes whose position actually changed — identical to
// procedure_template_edit_history's own proven SAVE_LAYOUT shape
// (saveProcedureTemplateLayout). Not one row per node: a batched layout
// save is one logical user action ("드래그 후 저장"), and the array-payload
// form already lets 6E's Undo/Redo fold treat it as a single reversible
// group without inventing a second representation.

export type SaveLayoutResult = { ok: true; updatedAt: string; changed: boolean } | Failure;

export async function saveRepairCaseFlowchartLayout(params: {
  repairCaseId: string;
  flowchartId: string;
  actorUserId: string;
  positions: { id: string; positionX: number; positionY: number }[];
  expectedFlowchartUpdatedAt: string;
}): Promise<SaveLayoutResult> {
  for (const p of params.positions) {
    if (!Number.isFinite(p.positionX) || !Number.isFinite(p.positionY)) {
      return { ok: false, code: "INVALID_INPUT", message: "노드 위치가 올바르지 않습니다." };
    }
  }

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, params.actorUserId);
      const flowchart = await loadFlowchartForGraphEdit(tx, params.repairCaseId, params.flowchartId, params.expectedFlowchartUpdatedAt, actor);

      if (params.positions.length === 0) {
        return { ok: true, updatedAt: flowchart.updatedAt.toISOString(), changed: false };
      }

      const nodeIds = params.positions.map((p) => p.id);
      const existingNodes = await tx
        .select({ id: repairCaseFlowchartNodes.id, flowchartId: repairCaseFlowchartNodes.flowchartId, positionX: repairCaseFlowchartNodes.positionX, positionY: repairCaseFlowchartNodes.positionY })
        .from(repairCaseFlowchartNodes)
        .where(inArray(repairCaseFlowchartNodes.id, nodeIds));
      const existingById = new Map(existingNodes.map((n) => [n.id, n]));

      // Every referenced node must belong to THIS flowchart — checked before
      // any write, so a payload mixing in a sibling flowchart's node id
      // (accidental or IDOR attempt) rejects the whole call atomically.
      for (const p of params.positions) {
        const existing = existingById.get(p.id);
        if (!existing || existing.flowchartId !== params.flowchartId) {
          fail("NOT_FOUND", `노드 ${p.id}이(가) 이 Flowchart에 존재하지 않습니다.`);
        }
      }

      const changedPositions = params.positions.filter((p) => {
        const existing = existingById.get(p.id)!;
        return existing.positionX !== p.positionX || existing.positionY !== p.positionY;
      });

      if (changedPositions.length === 0) {
        return { ok: true, updatedAt: flowchart.updatedAt.toISOString(), changed: false };
      }

      const beforeState = changedPositions.map((p) => {
        const existing = existingById.get(p.id)!;
        return { id: p.id, positionX: existing.positionX, positionY: existing.positionY };
      });
      const afterState = changedPositions.map((p) => ({ id: p.id, positionX: p.positionX, positionY: p.positionY }));

      for (const p of changedPositions) {
        await tx
          .update(repairCaseFlowchartNodes)
          .set({ positionX: p.positionX, positionY: p.positionY, updatedAt: new Date() })
          .where(eq(repairCaseFlowchartNodes.id, p.id));
      }

      await insertGraphEditHistory(tx, {
        flowchartId: flowchart.id,
        actionType: "SAVE_LAYOUT",
        beforeState,
        afterState,
        actorUserId: actor.id,
        changeGroupId: randomUUID(),
      });

      const updatedAt = await touchFlowchart(tx, flowchart.id, actor.id);
      return { ok: true, updatedAt, changed: true };
    });
  } catch (err) {
    if (err instanceof GraphMutationError) return err.result;
    throw err;
  }
}

export type DeleteNodeResult = { ok: true; updatedAt: string } | Failure | NodeHasConnectedEdgesFailure;

/**
 * Hard-deletes a node row. Never cascade-deletes its edges — the DB itself
 * enforces this (0019's composite RESTRICT FK), but this check runs first
 * so a connected node's delete is rejected with structured, actionable
 * detail rather than surfacing as a raw FK violation. The DELETE_NODE
 * history row is inserted BEFORE the DELETE statement, inside the same
 * transaction — 0019's node_id FK is ON DELETE SET NULL, so the DELETE
 * automatically nulls it out on this row (and any earlier row referencing
 * this node) as a DB-level side effect, never a second application UPDATE.
 */
export async function deleteRepairCaseFlowchartNode(params: {
  repairCaseId: string;
  flowchartId: string;
  nodeId: string;
  actorUserId: string;
  expectedFlowchartUpdatedAt: string;
}): Promise<DeleteNodeResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, params.actorUserId);
      const flowchart = await loadFlowchartForGraphEdit(tx, params.repairCaseId, params.flowchartId, params.expectedFlowchartUpdatedAt, actor);

      const [node] = await tx.select().from(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.id, params.nodeId)).for("update");
      if (!node) fail("NOT_FOUND", "해당 노드를 찾을 수 없습니다.");
      if (node.flowchartId !== flowchart.id) fail("CROSS_FLOWCHART", "다른 Flowchart에 속한 노드는 삭제할 수 없습니다.");

      const connectedEdges = await tx
        .select({ id: repairCaseFlowchartEdges.id, fromNodeId: repairCaseFlowchartEdges.fromNodeId, toNodeId: repairCaseFlowchartEdges.toNodeId })
        .from(repairCaseFlowchartEdges)
        .where(or(eq(repairCaseFlowchartEdges.fromNodeId, node.id), eq(repairCaseFlowchartEdges.toNodeId, node.id)));
      if (connectedEdges.length > 0) {
        const blockingEdges: BlockingEdgeSummary[] = connectedEdges.map((e) => ({
          edgeId: e.id,
          direction: e.fromNodeId === node.id ? "OUTGOING" : "INCOMING",
          otherNodeId: e.fromNodeId === node.id ? e.toNodeId : e.fromNodeId,
        }));
        throw new DetailedGraphMutationError({
          ok: false,
          code: "NODE_HAS_CONNECTED_EDGES",
          message: "이 노드에 연결된 분기가 있어 삭제할 수 없습니다. 먼저 분기를 삭제하세요.",
          blockingEdgeCount: connectedEdges.length,
          blockingEdgeIds: connectedEdges.map((e) => e.id),
          blockingEdges,
        });
      }

      const beforeState = serializeNodeSnapshot(node);

      await insertGraphEditHistory(tx, {
        flowchartId: flowchart.id,
        actionType: "DELETE_NODE",
        nodeId: node.id,
        beforeState,
        afterState: null,
        actorUserId: actor.id,
        changeGroupId: randomUUID(),
      });

      await tx.delete(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.id, node.id));

      const updatedAt = await touchFlowchart(tx, flowchart.id, actor.id);
      return { ok: true, updatedAt };
    });
  } catch (err) {
    if (err instanceof GraphMutationError) return err.result;
    if (err instanceof DetailedGraphMutationError) return err.result;
    throw err;
  }
}

// =====================================================================
// EDGE
// =====================================================================

export type CreateEdgeResult = { ok: true; edgeId: string; updatedAt: string } | Failure;

export async function createRepairCaseFlowchartEdge(params: {
  repairCaseId: string;
  flowchartId: string;
  actorUserId: string;
  fromNodeId: string;
  toNodeId: string;
  branchType: string;
  branchLabel: string | null;
  expectedFlowchartUpdatedAt: string;
}): Promise<CreateEdgeResult> {
  if (params.fromNodeId === params.toNodeId) return { ok: false, code: "SELF_EDGE", message: "분기의 시작과 대상 노드는 같을 수 없습니다." };
  if (!(REPAIR_CASE_FLOWCHART_BRANCH_TYPE_CODES as readonly string[]).includes(params.branchType)) {
    return { ok: false, code: "INVALID_INPUT", message: "지원되지 않는 분기 유형입니다." };
  }
  if (params.branchType === "CUSTOM" && isBlank(params.branchLabel)) {
    return { ok: false, code: "INVALID_INPUT", message: "사용자 정의(CUSTOM) 분기에는 라벨이 필요합니다." };
  }
  const branchType = params.branchType as RepairCaseFlowchartBranchType;

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, params.actorUserId);
      const flowchart = await loadFlowchartForGraphEdit(tx, params.repairCaseId, params.flowchartId, params.expectedFlowchartUpdatedAt, actor);

      await loadNodeInFlowchart(tx, flowchart.id, params.fromNodeId);
      await loadNodeInFlowchart(tx, flowchart.id, params.toNodeId);
      await assertNoDuplicateEdge(tx, flowchart.id, params.fromNodeId, params.toNodeId, branchType);

      const [inserted] = await tx
        .insert(repairCaseFlowchartEdges)
        .values({
          flowchartId: flowchart.id,
          fromNodeId: params.fromNodeId,
          toNodeId: params.toNodeId,
          branchType,
          branchLabel: params.branchLabel,
        })
        .returning();

      await insertGraphEditHistory(tx, {
        flowchartId: flowchart.id,
        actionType: "CREATE_EDGE",
        edgeId: inserted.id,
        beforeState: null,
        afterState: serializeEdgeSnapshot(inserted),
        actorUserId: actor.id,
        changeGroupId: randomUUID(),
      });

      const updatedAt = await touchFlowchart(tx, flowchart.id, actor.id);
      return { ok: true, edgeId: inserted.id, updatedAt };
    });
  } catch (err) {
    if (err instanceof GraphMutationError) return err.result;
    throw err;
  }
}

export type UpdateEdgeResult = { ok: true; updatedAt: string; changed: boolean } | Failure;

export async function updateRepairCaseFlowchartEdge(params: {
  repairCaseId: string;
  flowchartId: string;
  edgeId: string;
  actorUserId: string;
  branchType: string;
  branchLabel: string | null;
  expectedFlowchartUpdatedAt: string;
}): Promise<UpdateEdgeResult> {
  if (!(REPAIR_CASE_FLOWCHART_BRANCH_TYPE_CODES as readonly string[]).includes(params.branchType)) {
    return { ok: false, code: "INVALID_INPUT", message: "지원되지 않는 분기 유형입니다." };
  }
  if (params.branchType === "CUSTOM" && isBlank(params.branchLabel)) {
    return { ok: false, code: "INVALID_INPUT", message: "사용자 정의(CUSTOM) 분기에는 라벨이 필요합니다." };
  }
  const branchType = params.branchType as RepairCaseFlowchartBranchType;

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, params.actorUserId);
      const flowchart = await loadFlowchartForGraphEdit(tx, params.repairCaseId, params.flowchartId, params.expectedFlowchartUpdatedAt, actor);

      const [edge] = await tx.select().from(repairCaseFlowchartEdges).where(eq(repairCaseFlowchartEdges.id, params.edgeId)).for("update");
      if (!edge) fail("NOT_FOUND", "해당 분기를 찾을 수 없습니다.");
      if (edge.flowchartId !== flowchart.id) fail("CROSS_FLOWCHART", "다른 Flowchart에 속한 분기는 수정할 수 없습니다.");

      const changed = edge.branchType !== branchType || edge.branchLabel !== params.branchLabel;
      if (!changed) {
        return { ok: true, updatedAt: flowchart.updatedAt.toISOString(), changed: false };
      }

      const beforeState = { id: edge.id, branchType: edge.branchType, branchLabel: edge.branchLabel };
      const afterState = { id: edge.id, branchType, branchLabel: params.branchLabel };

      await tx.update(repairCaseFlowchartEdges).set({ branchType, branchLabel: params.branchLabel }).where(eq(repairCaseFlowchartEdges.id, edge.id));

      await insertGraphEditHistory(tx, {
        flowchartId: flowchart.id,
        actionType: "UPDATE_EDGE",
        edgeId: edge.id,
        beforeState,
        afterState,
        actorUserId: actor.id,
        changeGroupId: randomUUID(),
      });

      const updatedAt = await touchFlowchart(tx, flowchart.id, actor.id);
      return { ok: true, updatedAt, changed: true };
    });
  } catch (err) {
    if (err instanceof GraphMutationError) return err.result;
    throw err;
  }
}

export type RetargetEdgeResult = { ok: true; updatedAt: string } | Failure;

/**
 * Preserves branchType/branchLabel/routePoints — only fromNodeId/toNodeId
 * change. routePoints is deliberately NOT cleared on retarget, matching
 * procedure-template-editor.ts's retargetProcedureTemplateEdge's own proven
 * behavior (it never touches userRoutePoints either); 6C never sets
 * routePoints in the first place (createEdge always leaves it null), so
 * this is currently a no-op distinction in practice, but the rule is
 * carried forward explicitly for when 6D starts writing routePoints.
 */
export async function retargetRepairCaseFlowchartEdge(params: {
  repairCaseId: string;
  flowchartId: string;
  edgeId: string;
  actorUserId: string;
  newFromNodeId: string;
  newToNodeId: string;
  expectedFlowchartUpdatedAt: string;
}): Promise<RetargetEdgeResult> {
  if (params.newFromNodeId === params.newToNodeId) return { ok: false, code: "SELF_EDGE", message: "분기의 시작과 대상 노드는 같을 수 없습니다." };

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, params.actorUserId);
      const flowchart = await loadFlowchartForGraphEdit(tx, params.repairCaseId, params.flowchartId, params.expectedFlowchartUpdatedAt, actor);

      const [edge] = await tx.select().from(repairCaseFlowchartEdges).where(eq(repairCaseFlowchartEdges.id, params.edgeId)).for("update");
      if (!edge) fail("NOT_FOUND", "해당 분기를 찾을 수 없습니다.");
      if (edge.flowchartId !== flowchart.id) fail("CROSS_FLOWCHART", "다른 Flowchart에 속한 분기는 수정할 수 없습니다.");

      await loadNodeInFlowchart(tx, flowchart.id, params.newFromNodeId);
      await loadNodeInFlowchart(tx, flowchart.id, params.newToNodeId);
      await assertNoDuplicateEdge(tx, flowchart.id, params.newFromNodeId, params.newToNodeId, edge.branchType, edge.id);

      const beforeState = { id: edge.id, fromNodeId: edge.fromNodeId, toNodeId: edge.toNodeId };
      const afterState = { id: edge.id, fromNodeId: params.newFromNodeId, toNodeId: params.newToNodeId };

      await tx
        .update(repairCaseFlowchartEdges)
        .set({ fromNodeId: params.newFromNodeId, toNodeId: params.newToNodeId })
        .where(eq(repairCaseFlowchartEdges.id, edge.id));

      await insertGraphEditHistory(tx, {
        flowchartId: flowchart.id,
        actionType: "RETARGET_EDGE",
        edgeId: edge.id,
        beforeState,
        afterState,
        actorUserId: actor.id,
        changeGroupId: randomUUID(),
      });

      const updatedAt = await touchFlowchart(tx, flowchart.id, actor.id);
      return { ok: true, updatedAt };
    });
  } catch (err) {
    if (err instanceof GraphMutationError) return err.result;
    throw err;
  }
}

export type DeleteEdgeResult = { ok: true; updatedAt: string } | Failure;

export async function deleteRepairCaseFlowchartEdge(params: {
  repairCaseId: string;
  flowchartId: string;
  edgeId: string;
  actorUserId: string;
  expectedFlowchartUpdatedAt: string;
}): Promise<DeleteEdgeResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, params.actorUserId);
      const flowchart = await loadFlowchartForGraphEdit(tx, params.repairCaseId, params.flowchartId, params.expectedFlowchartUpdatedAt, actor);

      const [edge] = await tx.select().from(repairCaseFlowchartEdges).where(eq(repairCaseFlowchartEdges.id, params.edgeId)).for("update");
      if (!edge) fail("NOT_FOUND", "해당 분기를 찾을 수 없습니다.");
      if (edge.flowchartId !== flowchart.id) fail("CROSS_FLOWCHART", "다른 Flowchart에 속한 분기는 삭제할 수 없습니다.");

      const beforeState = serializeEdgeSnapshot(edge);

      await insertGraphEditHistory(tx, {
        flowchartId: flowchart.id,
        actionType: "DELETE_EDGE",
        edgeId: edge.id,
        beforeState,
        afterState: null,
        actorUserId: actor.id,
        changeGroupId: randomUUID(),
      });

      await tx.delete(repairCaseFlowchartEdges).where(eq(repairCaseFlowchartEdges.id, edge.id));

      const updatedAt = await touchFlowchart(tx, flowchart.id, actor.id);
      return { ok: true, updatedAt };
    });
  } catch (err) {
    if (err instanceof GraphMutationError) return err.result;
    throw err;
  }
}

// =====================================================================
// EDGE ROUTING (5C-6D — waypoint/route-point persistence)
// =====================================================================

export type SaveEdgeRouteResult = { ok: true; updatedAt: string; changed: boolean } | Failure;

/**
 * Persists a single edge's manual route (its ordered waypoint chain, or
 * null to restore automatic routing). Single-edge scoped, unlike
 * saveRepairCaseFlowchartLayout's batched-array-of-nodes shape — routing
 * UX naturally edits one selected edge's route at a time (add/move/remove
 * waypoint), so a dedicated per-edge mutation is the right granularity
 * here rather than forcing route saves through the layout batch. Every
 * input passes through sanitizeRoutePoints (graph-editor-core/routing.ts)
 * server-side, regardless of what the client already validated — the same
 * gate saveProcedureTemplateLayout's edge-route half uses.
 */
export async function saveRepairCaseFlowchartEdgeRoute(params: {
  repairCaseId: string;
  flowchartId: string;
  edgeId: string;
  actorUserId: string;
  routePoints: unknown;
  expectedFlowchartUpdatedAt: string;
}): Promise<SaveEdgeRouteResult> {
  const sanitized = sanitizeRoutePoints(params.routePoints);
  if (!sanitized.ok) return { ok: false, code: "INVALID_INPUT", message: sanitized.message };

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, params.actorUserId);
      const flowchart = await loadFlowchartForGraphEdit(tx, params.repairCaseId, params.flowchartId, params.expectedFlowchartUpdatedAt, actor);

      const [edge] = await tx.select().from(repairCaseFlowchartEdges).where(eq(repairCaseFlowchartEdges.id, params.edgeId)).for("update");
      if (!edge) fail("NOT_FOUND", "해당 분기를 찾을 수 없습니다.");
      if (edge.flowchartId !== flowchart.id) fail("CROSS_FLOWCHART", "다른 Flowchart에 속한 분기는 수정할 수 없습니다.");

      if (routePointsEqual(edge.routePoints ?? null, sanitized.points)) {
        return { ok: true, updatedAt: flowchart.updatedAt.toISOString(), changed: false };
      }

      const beforeState = { id: edge.id, points: edge.routePoints ?? null };
      const afterState = { id: edge.id, points: sanitized.points };

      await tx.update(repairCaseFlowchartEdges).set({ routePoints: sanitized.points }).where(eq(repairCaseFlowchartEdges.id, edge.id));

      await insertGraphEditHistory(tx, {
        flowchartId: flowchart.id,
        actionType: "SAVE_EDGE_ROUTE",
        edgeId: edge.id,
        beforeState,
        afterState,
        actorUserId: actor.id,
        changeGroupId: randomUUID(),
      });

      const updatedAt = await touchFlowchart(tx, flowchart.id, actor.id);
      return { ok: true, updatedAt, changed: true };
    });
  } catch (err) {
    if (err instanceof GraphMutationError) return err.result;
    throw err;
  }
}

// =====================================================================
// NODE-ON-EDGE INSERTION (5C-6D — route-point split)
// =====================================================================

export type InsertNodeOnEdgeResult =
  | { ok: true; nodeId: string; firstEdgeId: string; secondEdgeId: string; updatedAt: string }
  | Failure;

/**
 * Splits an existing edge (A -[branch]-> B) at a chosen waypoint into two:
 * A -[the exact same branchType/branchLabel, untouched]-> NEW, and
 * NEW -[a plain DEFAULT continuation, never a copy of A's branch]-> B. A
 * route point is a routing/geometry detail, not a second decision —
 * duplicating A's branch semantics onto the new edge would silently change
 * the graph's meaning. Same pattern as
 * insertProcedureTemplateNodeOnEdge (procedure-template-editor.ts): one
 * transaction, one authoritative mutation — create the node, retarget the
 * first edge's toNodeId (inline, not via retargetRepairCaseFlowchartEdge,
 * which opens its own transaction), create the second edge, all under one
 * changeGroupId (CREATE_NODE + RETARGET_EDGE + CREATE_EDGE) so a future
 * Undo/Redo fold (6E) treats this as one atomic reversible unit, never
 * three independent steps. Never a client-side three-call sequence.
 */
export async function insertRepairCaseFlowchartNodeOnEdge(params: {
  repairCaseId: string;
  flowchartId: string;
  edgeId: string;
  actorUserId: string;
  nodeType: string;
  title: string;
  position: { x: number; y: number };
  expectedFlowchartUpdatedAt: string;
}): Promise<InsertNodeOnEdgeResult> {
  const title = params.title.trim();
  if (title.length === 0) return { ok: false, code: "INVALID_INPUT", message: "노드 제목을 입력해 주세요." };
  if (!(REPAIR_CASE_FLOWCHART_NODE_TYPE_CODES as readonly string[]).includes(params.nodeType)) {
    return { ok: false, code: "INVALID_INPUT", message: "지원되지 않는 노드 유형입니다." };
  }
  if (!Number.isFinite(params.position.x) || !Number.isFinite(params.position.y)) {
    return { ok: false, code: "INVALID_INPUT", message: "노드 위치가 올바르지 않습니다." };
  }
  const nodeType = params.nodeType as RepairCaseFlowchartNodeType;

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, params.actorUserId);
      const flowchart = await loadFlowchartForGraphEdit(tx, params.repairCaseId, params.flowchartId, params.expectedFlowchartUpdatedAt, actor);

      const [edge] = await tx.select().from(repairCaseFlowchartEdges).where(eq(repairCaseFlowchartEdges.id, params.edgeId)).for("update");
      if (!edge) fail("NOT_FOUND", "해당 분기를 찾을 수 없습니다.");
      if (edge.flowchartId !== flowchart.id) fail("CROSS_FLOWCHART", "다른 Flowchart에 속한 분기에는 노드를 삽입할 수 없습니다.");

      const [insertedNode] = await tx
        .insert(repairCaseFlowchartNodes)
        .values({
          flowchartId: flowchart.id,
          nodeType,
          title,
          description: null,
          positionX: params.position.x,
          positionY: params.position.y,
        })
        .returning();

      const originalToNodeId = edge.toNodeId;

      await tx.update(repairCaseFlowchartEdges).set({ toNodeId: insertedNode.id }).where(eq(repairCaseFlowchartEdges.id, edge.id));

      const [secondEdge] = await tx
        .insert(repairCaseFlowchartEdges)
        .values({
          flowchartId: flowchart.id,
          fromNodeId: insertedNode.id,
          toNodeId: originalToNodeId,
          branchType: "DEFAULT",
          branchLabel: null,
        })
        .returning();

      // One shared change_group_id for all three rows — a single logical
      // "split" operation, so a future Undo/Redo fold treats CREATE_NODE +
      // RETARGET_EDGE + CREATE_EDGE as one atomic unit.
      const changeGroupId = randomUUID();

      await insertGraphEditHistory(tx, {
        flowchartId: flowchart.id,
        actionType: "CREATE_NODE",
        nodeId: insertedNode.id,
        beforeState: null,
        afterState: serializeNodeSnapshot(insertedNode),
        actorUserId: actor.id,
        changeGroupId,
      });

      await insertGraphEditHistory(tx, {
        flowchartId: flowchart.id,
        actionType: "RETARGET_EDGE",
        edgeId: edge.id,
        beforeState: { id: edge.id, fromNodeId: edge.fromNodeId, toNodeId: originalToNodeId },
        afterState: { id: edge.id, fromNodeId: edge.fromNodeId, toNodeId: insertedNode.id },
        actorUserId: actor.id,
        changeGroupId,
      });

      await insertGraphEditHistory(tx, {
        flowchartId: flowchart.id,
        actionType: "CREATE_EDGE",
        edgeId: secondEdge.id,
        beforeState: null,
        afterState: serializeEdgeSnapshot(secondEdge),
        actorUserId: actor.id,
        changeGroupId,
      });

      const updatedAt = await touchFlowchart(tx, flowchart.id, actor.id);
      return { ok: true, nodeId: insertedNode.id, firstEdgeId: edge.id, secondEdgeId: secondEdge.id, updatedAt };
    });
  } catch (err) {
    if (err instanceof GraphMutationError) return err.result;
    throw err;
  }
}
