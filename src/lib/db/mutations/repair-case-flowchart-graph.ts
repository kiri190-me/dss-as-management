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

type EligibleActor = { id: string; role: Awaited<ReturnType<typeof resolveEligibleActor>>["role"]; isDeveloper: boolean };

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

  if (!(await hasPermission(actor, "diagnosisFlowcharts.edit", "WRITE"))) {
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
  // 이 파일에서 흐름도 행 자체를 만드는 것은
  // createRepairCaseFlowchartWithGraph 하나뿐이다(파일 맨 아래) — 흐름도 한
  // 장을 칸·연결선까지 한 트랜잭션으로 통째로 만드는 그 mutation 은 자기
  // CREATE_FLOWCHART 이력도 같은 changeGroupId 로 남겨야 하므로 여기 있다.
  // 그 밖의 흐름도 객체 관리(이름 바꾸기·휴지통·영구 삭제)는 여전히
  // repair-case-flowcharts.ts 의 몫이다.
  | "CREATE_FLOWCHART"
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

// =====================================================================
// 흐름도 한 장을 통째로 (WHOLE-FLOWCHART CREATE — 한 번의 트랜잭션)
// =====================================================================

/**
 * 만들 칸 하나. `key` 는 **DB uuid 가 아니다** — 부르는 쪽이 지은 임시 이름이고
 * (「작업 기록 흐름도」의 경우 work-record-flowchart.ts 가 짓는
 * `work-record-flowchart:record:<기록 uuid>` 같은 것), 이 mutation 안에서
 * 진짜 uuid 로 갈린다. 연결선은 그 `key` 로만 칸을 가리킨다.
 */
export type NewFlowchartNodeInput = {
  key: string;
  nodeType: string;
  title: string;
  description: string | null;
  instructions: string | null;
  positionX: number;
  positionY: number;
};

/**
 * 만들 연결선 하나. routePoints 가 없는 것은 일부러다 — 통째로 만드는 흐름도는
 * 아직 아무도 손으로 선을 끌어 본 적이 없으므로 남길 「사람이 정한 경로」가
 * 없다. 만든 뒤 편집기에서 끌면 saveRepairCaseFlowchartEdgeRoute 가 받는다.
 */
export type NewFlowchartEdgeInput = {
  fromKey: string;
  toKey: string;
  branchType: string;
  branchLabel: string | null;
};

export type CreateFlowchartWithGraphResult =
  | { ok: true; flowchartId: string; nodeCount: number; edgeCount: number; updatedAt: string }
  | Failure;

/**
 * 연결선 중복(같은 시작·대상·분기 유형)을 가려내는 열쇠의 구분자.
 *
 * NUL 을 쓰는 까닭은 `fromKey`·`toKey`·`branchType` 어디에도 나올 수 없는
 * 글자라, 이어 붙인 열쇠가 서로 섞이지 않기 때문이다(구분자가 될 수 있는
 * 보통 글자를 쓰면 `a|b` + `c` 와 `a` + `b|c` 가 같은 열쇠가 된다).
 *
 * 🔴 **소스에 진짜 제어문자를 넣지 않는다** — 넣으면 git 이 이 파일을 이진
 * 파일로 보아 diff 가 통째로 사라지고(`Binary file … matches`), grep 도 이
 * 파일을 건너뛴다. 눈에 보이지 않는 글자라 다음 사람이 원인을 찾지 못한다.
 * 실제로 한 번 그렇게 박혔다가 되돌린 자리다. 이 저장소가 같은 함정을 겪고
 * 남긴 경고가 `domain/service-report-file-name.ts` 머리말에 있다 — "정규식에
 * 적은 유니코드 이스케이프는 편집기·도구를 거치는 동안 조용히 진짜
 * 제어문자로 풀려 소스에 박히는 일이 있다".
 */
const EDGE_DEDUPE_SEPARATOR = "\u0000";

/**
 * 흐름도 한 장 + 칸 전부 + 연결선 전부 + 그 모두의 편집 이력을 **한 번의
 * 트랜잭션으로** 만든다.
 *
 * 왜 기존 mutation 을 칸 수만큼 부르지 않는가: createRepairCaseFlowchartNode /
 * …Edge 는 각자 자기 트랜잭션을 열고, 낙관적 잠금 토큰
 * (expectedFlowchartUpdatedAt)을 요구하고, 끝날 때마다 touchFlowchart 로 그
 * 토큰을 바꿔 버린다. 그래서 스무 개를 만들려면 스무 번 커밋해야 하는데, 그러면
 * 열두 번째에서 실패했을 때 **칸 열한 개만 있는 반쪽 흐름도**가 남아 사람이
 * 손으로 치워야 한다. 여기서는 하나라도 실패하면 아무것도 남지 않는다.
 * 낙관적 잠금 토큰을 받지 않는 것도 같은 이유다 — 지금 막 만드는 빈 흐름도라
 * 「다른 사람이 그 사이에 고쳤을 흐름도」가 아직 없다.
 *
 * 관문은 createRepairCaseFlowchart(repair-case-flowcharts.ts) 가 하는 그대로,
 * 같은 차례로 한다 — requireActor → loadCaseForUpdate → 유·무상 확정 확인 →
 * diagnosisFlowcharts.edit(WRITE). 새 규칙을 만들지 않는다. 특히
 * repair_cases.is_locked 는 **여기서도 막지 않는다**: 이 저장소의 확정된
 * shipment-lock 제거 정책(repair-case-flowcharts.ts 머리말)대로 출하로 잠긴
 * 건의 흐름도도 계속 관리할 수 있어야 하고, 손으로 만드는 길이 허용하는 것을
 * 이 길만 막으면 두 길의 규칙이 서로 달라진다.
 *
 * 🔴 편집 이력은 **하나의 changeGroupId** 로 묶인다. 사람이 단추를 한 번 누른
 * 한 번의 행동이므로 이력에서도 한 묶음이어야 하고, 나중에 6E 의 Undo/Redo
 * 접기가 이것을 되돌릴 수 없는 스무 개의 남남으로 보면 안 된다 —
 * insertRepairCaseFlowchartNodeOnEdge 가 CREATE_NODE + RETARGET_EDGE +
 * CREATE_EDGE 를 한 묶음으로 두는 것과 같은 판단이다.
 *
 * 칸·연결선의 uuid 는 INSERT 가 지어 주기를 기다리지 않고 여기서 미리 짓는다.
 * 그래야 임시 key → 진짜 uuid 대응표가 INSERT 전에 완성되어, 연결선을 한 번에
 * 넣을 수 있고 「여러 행 INSERT 의 RETURNING 순서가 넣은 순서와 같은가」라는
 * 물음에 기대지 않아도 된다.
 */
export async function createRepairCaseFlowchartWithGraph(params: {
  repairCaseId: string;
  actorUserId: string;
  title: string;
  description: string | null;
  nodes: readonly NewFlowchartNodeInput[];
  edges: readonly NewFlowchartEdgeInput[];
}): Promise<CreateFlowchartWithGraphResult> {
  const title = params.title.trim();
  if (title.length === 0) return { ok: false, code: "INVALID_INPUT", message: "Flowchart 제목을 입력해 주세요." };
  if (params.nodes.length === 0) return { ok: false, code: "INVALID_INPUT", message: "만들 노드가 없습니다." };

  // 모양 검사는 트랜잭션 밖에서 먼저 끝낸다 — 잘못된 요청 때문에 접수 건 행을
  // 잠그고 있을 이유가 없다. 개별 mutation 들이 하는 검사와 같은 것들이다.
  const nodeKeys = new Set<string>();
  for (const node of params.nodes) {
    if (nodeKeys.has(node.key)) return { ok: false, code: "INVALID_INPUT", message: "노드 식별자가 중복되었습니다." };
    nodeKeys.add(node.key);
    if (node.title.trim().length === 0) return { ok: false, code: "INVALID_INPUT", message: "노드 제목을 입력해 주세요." };
    if (!(REPAIR_CASE_FLOWCHART_NODE_TYPE_CODES as readonly string[]).includes(node.nodeType)) {
      return { ok: false, code: "INVALID_INPUT", message: "지원되지 않는 노드 유형입니다." };
    }
    if (!Number.isFinite(node.positionX) || !Number.isFinite(node.positionY)) {
      return { ok: false, code: "INVALID_INPUT", message: "노드 위치가 올바르지 않습니다." };
    }
  }

  const seenEdgeKeys = new Set<string>();
  for (const edge of params.edges) {
    if (!nodeKeys.has(edge.fromKey) || !nodeKeys.has(edge.toKey)) {
      // 이 묶음 안에 없는 칸을 가리키는 연결선. 바깥 흐름도의 칸을 가리킬 길
      // 자체가 없으므로(가리키는 수단이 key 뿐이다) CROSS_FLOWCHART 가 아니라
      // NOT_FOUND 다.
      return { ok: false, code: "NOT_FOUND", message: "분기가 가리키는 노드가 목록에 없습니다." };
    }
    if (edge.fromKey === edge.toKey) return { ok: false, code: "SELF_EDGE", message: "분기의 시작과 대상 노드는 같을 수 없습니다." };
    if (!(REPAIR_CASE_FLOWCHART_BRANCH_TYPE_CODES as readonly string[]).includes(edge.branchType)) {
      return { ok: false, code: "INVALID_INPUT", message: "지원되지 않는 분기 유형입니다." };
    }
    if (edge.branchType === "CUSTOM" && isBlank(edge.branchLabel)) {
      return { ok: false, code: "INVALID_INPUT", message: "사용자 정의(CUSTOM) 분기에는 라벨이 필요합니다." };
    }
    const dedupeKey = `${edge.fromKey}${EDGE_DEDUPE_SEPARATOR}${edge.toKey}${EDGE_DEDUPE_SEPARATOR}${edge.branchType}`;
    if (seenEdgeKeys.has(dedupeKey)) return { ok: false, code: "DUPLICATE_EDGE", message: "동일한 시작/대상/분기 유형을 가진 분기가 이미 존재합니다." };
    seenEdgeKeys.add(dedupeKey);
  }

  try {
    return await db.transaction(async (tx) => {
      const actor = await requireActor(tx, params.actorUserId);

      const repairCase = await loadCaseForUpdate(tx, params.repairCaseId);
      if (!repairCase) fail("NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");
      if (repairCase.billingType === "PENDING_DECISION") {
        fail("BILLING_DECISION_REQUIRED", "유·무상을 확정한 후 Case Flowchart를 생성할 수 있습니다.");
      }

      if (!(await hasPermission(actor, "diagnosisFlowcharts.edit", "WRITE"))) {
        fail("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
      }

      const [flowchart] = await tx
        .insert(repairCaseFlowcharts)
        .values({
          repairCaseId: params.repairCaseId,
          title,
          description: params.description,
          createdBy: actor.id,
          updatedBy: actor.id,
        })
        .returning();

      // 이 저장 전체가 사람의 한 번의 행동이다 — 행마다 새 uuid 를 짓지 않는다.
      const changeGroupId = randomUUID();

      await insertGraphEditHistory(tx, {
        flowchartId: flowchart.id,
        actionType: "CREATE_FLOWCHART",
        beforeState: null,
        afterState: {
          id: flowchart.id,
          repairCaseId: flowchart.repairCaseId,
          title: flowchart.title,
          description: flowchart.description,
        },
        actorUserId: actor.id,
        changeGroupId,
      });

      const nodeIdByKey = new Map<string, string>(params.nodes.map((node) => [node.key, randomUUID()]));

      const insertedNodes = await tx
        .insert(repairCaseFlowchartNodes)
        .values(
          params.nodes.map((node) => ({
            id: nodeIdByKey.get(node.key)!,
            flowchartId: flowchart.id,
            nodeType: node.nodeType as RepairCaseFlowchartNodeType,
            title: node.title.trim(),
            description: node.description,
            instructions: node.instructions,
            positionX: node.positionX,
            positionY: node.positionY,
          }))
        )
        .returning();

      const insertedEdges =
        params.edges.length === 0
          ? []
          : await tx
              .insert(repairCaseFlowchartEdges)
              .values(
                params.edges.map((edge) => ({
                  id: randomUUID(),
                  flowchartId: flowchart.id,
                  fromNodeId: nodeIdByKey.get(edge.fromKey)!,
                  toNodeId: nodeIdByKey.get(edge.toKey)!,
                  branchType: edge.branchType as RepairCaseFlowchartBranchType,
                  branchLabel: edge.branchLabel,
                }))
              )
              .returning();

      // 이력은 칸·연결선마다 한 줄씩, 그러나 changeGroupId 는 위의 하나 그대로.
      // 다른 mutation 들과 똑같은 insertGraphEditHistory 를 지나가므로 감사
      // 자료의 모양(origin=USER_EDIT, before/after 스냅숏)이 어긋날 수 없다.
      for (const node of insertedNodes) {
        await insertGraphEditHistory(tx, {
          flowchartId: flowchart.id,
          actionType: "CREATE_NODE",
          nodeId: node.id,
          beforeState: null,
          afterState: serializeNodeSnapshot(node),
          actorUserId: actor.id,
          changeGroupId,
        });
      }

      for (const edge of insertedEdges) {
        await insertGraphEditHistory(tx, {
          flowchartId: flowchart.id,
          actionType: "CREATE_EDGE",
          edgeId: edge.id,
          beforeState: null,
          afterState: serializeEdgeSnapshot(edge),
          actorUserId: actor.id,
          changeGroupId,
        });
      }

      // 마지막에 한 번만. 칸마다 부르면 같은 행을 뜻 없이 수십 번 고치게 된다.
      const updatedAt = await touchFlowchart(tx, flowchart.id, actor.id);
      return { ok: true, flowchartId: flowchart.id, nodeCount: insertedNodes.length, edgeCount: insertedEdges.length, updatedAt };
    });
  } catch (err) {
    if (err instanceof GraphMutationError) return err.result;
    throw err;
  }
}
