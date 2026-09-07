import "server-only";
import { and, desc, eq, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../client";
import {
  procedureTemplates,
  procedureTemplateNodes,
  procedureTemplateEdges,
  procedureCaseExecutionNodes,
  procedureTemplateEditHistory,
  procedureTemplateEditActionTypeEnum,
} from "../schema";
import type { Tx } from "./procedure-templates";
import {
  EditorMutationError,
  requireEditor,
  assertTechnicalGraphEditable,
  touchTemplate,
  insertEditHistory,
  serializeNodeSnapshot,
  serializeEdgeSnapshot,
  type NodeSnapshot,
  type EdgeSnapshot,
  type EditorMutationResultCode,
} from "./procedure-template-editor";
import {
  foldProcedureTemplateEditHistory,
  EventFoldError,
  type HistoryGroupEvent,
  type ProcedureTemplateEditHistoryOrigin,
} from "@/lib/domain/procedure-template-edit-history-fold";
import type { ProcedureNodeType, ProcedureBranchType } from "@/lib/domain/procedure-template-types";

/**
 * Phase 5C-5C — server-authoritative Undo/Redo core. Historical Restore and
 * every UI surface (buttons, restore picker) are explicitly OUT of scope
 * for this checkpoint — see HANDOFF.md.
 *
 * Identity note: every writer (procedure-template-editor.ts) now embeds
 * `id` directly in UPDATE_NODE/CHANGE_NODE_TYPE/UPDATE_EDGE/RETARGET_EDGE/
 * CREATE_EDGE's beforeState/afterState, so a row stays self-identifying
 * forever, immune to node_id/edge_id (the FK column) ever being nulled by
 * a later delete (ON DELETE SET NULL, migration 0017) — see
 * resolveNodeId/resolveEdgeId's own doc comment for the full priority
 * order. This closes the general version of the gap for all NEW rows.
 * Older/incomplete rows (or the CREATE_EDGE case specifically, whose
 * afterState historically had no id at all — a pre-existing Phase 5C-5B-1
 * shape) still fall back to the live FK column and then, for CREATE_EDGE
 * only, to the most recent UNDO-mirror row this module itself wrote for
 * that group (findMostRecentUndoMirrorEdgeSnapshot) — kept for
 * compatibility, no longer the primary path. Exhausting every fallback
 * fails explicitly (IDENTITY_UNRESOLVABLE) rather than guessing.
 */

type EditActionType = (typeof procedureTemplateEditActionTypeEnum.enumValues)[number];

export type UndoRedoResultCode =
  | Exclude<EditorMutationResultCode, "EDGE_HAS_CLONE_DEPENDENTS" | "NODE_HAS_CONNECTED_EDGES" | "NODE_HAS_DEPENDENT_CONTENT">
  | "NO_UNDO_AVAILABLE"
  | "NO_REDO_AVAILABLE"
  | "UNSUPPORTED_ACTION"
  | "IDENTITY_UNRESOLVABLE"
  | "REVERSAL_BLOCKED"
  | "HISTORY_INCONSISTENT";

export type UndoRedoResult = { ok: true; updatedAt: string } | { ok: false; code: UndoRedoResultCode; message: string };

/** Exported for reuse by procedure-template-restore.ts — Restore shares this exact error/result shape rather than defining a parallel one. */
export class UndoRedoError extends Error {
  code: UndoRedoResultCode;
  constructor(code: UndoRedoResultCode, message: string) {
    super(message);
    this.code = code;
  }
}

function fail(code: UndoRedoResultCode, message: string): never {
  throw new UndoRedoError(code, message);
}

// ---- 2. Group-level history reader ----

export type HistoryGroupRow = {
  id: string;
  actionType: EditActionType;
  nodeId: string | null;
  edgeId: string | null;
  beforeState: unknown;
  afterState: unknown;
  sequenceNumber: number;
};

export type HistoryGroup = {
  changeGroupId: string;
  origin: ProcedureTemplateEditHistoryOrigin;
  sourceGroupId: string | null;
  restoreTargetGroupId: string | null;
  minSequenceNumber: number;
  rows: HistoryGroupRow[];
};

/**
 * Groups one template's full edit history by change_group_id — deterministic
 * order by MIN(sequence_number) per group, rows within a group ordered by
 * sequence_number. Never uses created_at. Never uses node_id/edge_id as
 * entity identity by itself (see module doc comment) — callers extract
 * identity from beforeState/afterState snapshots where the FK column may
 * have been nulled by a later delete.
 */
/** Exported for reuse by procedure-template-restore.ts. */
export async function loadTemplateHistoryGroups(tx: Tx, templateId: string): Promise<HistoryGroup[]> {
  const rows = await tx
    .select({
      id: procedureTemplateEditHistory.id,
      actionType: procedureTemplateEditHistory.actionType,
      nodeId: procedureTemplateEditHistory.nodeId,
      edgeId: procedureTemplateEditHistory.edgeId,
      beforeState: procedureTemplateEditHistory.beforeState,
      afterState: procedureTemplateEditHistory.afterState,
      sequenceNumber: procedureTemplateEditHistory.sequenceNumber,
      changeGroupId: procedureTemplateEditHistory.changeGroupId,
      origin: procedureTemplateEditHistory.origin,
      sourceGroupId: procedureTemplateEditHistory.sourceGroupId,
      restoreTargetGroupId: procedureTemplateEditHistory.restoreTargetGroupId,
    })
    .from(procedureTemplateEditHistory)
    .where(eq(procedureTemplateEditHistory.procedureTemplateId, templateId))
    .orderBy(procedureTemplateEditHistory.sequenceNumber);

  const groups = new Map<string, HistoryGroup>();
  for (const row of rows) {
    let group = groups.get(row.changeGroupId);
    if (!group) {
      group = {
        changeGroupId: row.changeGroupId,
        origin: row.origin,
        sourceGroupId: row.sourceGroupId,
        restoreTargetGroupId: row.restoreTargetGroupId,
        minSequenceNumber: row.sequenceNumber,
        rows: [],
      };
      groups.set(row.changeGroupId, group);
    }
    group.rows.push({
      id: row.id,
      actionType: row.actionType,
      nodeId: row.nodeId,
      edgeId: row.edgeId,
      beforeState: row.beforeState,
      afterState: row.afterState,
      sequenceNumber: row.sequenceNumber,
    });
  }
  return [...groups.values()].sort((a, b) => a.minSequenceNumber - b.minSequenceNumber);
}

async function findMostRecentUndoMirrorEdgeSnapshot(tx: Tx, originalGroupId: string): Promise<EdgeSnapshot | null> {
  const [mirrorRow] = await tx
    .select({ beforeState: procedureTemplateEditHistory.beforeState })
    .from(procedureTemplateEditHistory)
    // A compound Undo group can carry several rows for several different
    // entities (e.g. the route-point split's DELETE_EDGE+RETARGET_EDGE+
    // DELETE_NODE) — actionType=DELETE_EDGE picks the one that's actually
    // this edge's mirror, not merely "the last row written in that group".
    // Safe because no current writer ever puts two CREATE_EDGE rows in one
    // group (see module doc comment).
    .where(and(eq(procedureTemplateEditHistory.sourceGroupId, originalGroupId), eq(procedureTemplateEditHistory.origin, "UNDO"), eq(procedureTemplateEditHistory.actionType, "DELETE_EDGE")))
    .orderBy(desc(procedureTemplateEditHistory.sequenceNumber))
    .limit(1);
  return mirrorRow ? (mirrorRow.beforeState as EdgeSnapshot) : null;
}

// ---- identity resolution (state.id preferred; live node_id/edge_id FK fallback) ----

function extractIdFromState(state: unknown): string | null {
  if (state && typeof state === "object" && "id" in state) {
    const id = (state as { id: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

/**
 * Phase 5C-5C — normalized identity-resolution priority, used everywhere a
 * history row's target entity must be identified:
 *   1. beforeState.id / afterState.id — every writer now carries this
 *      going forward (see procedure-template-editor.ts's own comments),
 *      so it's permanent and immune to the node_id/edge_id FK column ever
 *      being nulled by a later delete (ON DELETE SET NULL, migration
 *      0017).
 *   2. the live node_id/edge_id FK column — still correct for rows
 *      written before this invariant existed, as long as the entity was
 *      never independently deleted since.
 *   3. (edges only, at the CREATE_EDGE call sites) the approved
 *      UNDO-mirror / content-match fallback, kept for compatibility with
 *      older/incomplete rows — never the primary path anymore.
 *   4. explicit IDENTITY_UNRESOLVABLE — never a silently generated id,
 *      never a guess among ambiguous candidates.
 */
function resolveNodeId(row: HistoryGroupRow): string {
  const id = extractIdFromState(row.beforeState) ?? extractIdFromState(row.afterState);
  if (id) return id;
  if (row.nodeId) return row.nodeId;
  fail("IDENTITY_UNRESOLVABLE", `노드 식별자를 확인할 수 없습니다 (history row ${row.id}, ${row.actionType}).`);
}

function resolveEdgeId(row: HistoryGroupRow): string {
  const id = extractIdFromState(row.beforeState) ?? extractIdFromState(row.afterState);
  if (id) return id;
  if (row.edgeId) return row.edgeId;
  fail("IDENTITY_UNRESOLVABLE", `분기 식별자를 확인할 수 없습니다 (history row ${row.id}, ${row.actionType}).`);
}

// ---- 3. Reversible operation primitives (transaction-scoped, internal only) ----

export type NodeUpdateFields = { title: string; description: string | null; instructions: string | null; sortOrder: number; isActive: boolean };
export type EdgeUpdateFields = { branchType: ProcedureBranchType; branchLabel: string | null };
export type RetargetFields = { fromNodeId: string; toNodeId: string };
export type LayoutPositionState = { nodeId: string; x: number | null; y: number | null };
export type EdgeRouteState = { edgeId: string; points: { x: number; y: number }[] | null };

/** Exported for reuse by procedure-template-restore.ts. */
export async function insertNodeFromSnapshot(tx: Tx, snapshot: NodeSnapshot): Promise<typeof procedureTemplateNodes.$inferSelect> {
  const [inserted] = await tx
    .insert(procedureTemplateNodes)
    .values({
      id: snapshot.id,
      procedureTemplateId: snapshot.procedureTemplateId,
      nodeCode: snapshot.nodeCode,
      nodeType: snapshot.nodeType,
      title: snapshot.title,
      description: snapshot.description,
      objective: snapshot.objective,
      preparation: snapshot.preparation,
      toolsAndEquipment: snapshot.toolsAndEquipment,
      safetyCaution: snapshot.safetyCaution,
      instructions: snapshot.instructions,
      expectedNormalResult: snapshot.expectedNormalResult,
      ngSymptoms: snapshot.ngSymptoms,
      recommendedCorrectiveAction: snapshot.recommendedCorrectiveAction,
      acceptanceCriteria: snapshot.acceptanceCriteria,
      workerMayAddNextTask: snapshot.workerMayAddNextTask,
      positionX: snapshot.positionX,
      positionY: snapshot.positionY,
      userPositionX: snapshot.userPositionX,
      userPositionY: snapshot.userPositionY,
      sortOrder: snapshot.sortOrder,
      sourceWorksheet: snapshot.sourceWorksheet,
      sourceShapeId: snapshot.sourceShapeId,
      sourceCellRange: snapshot.sourceCellRange,
      isActive: snapshot.isActive,
      createdAt: new Date(snapshot.createdAt),
      updatedAt: new Date(),
    })
    .returning();
  return inserted;
}

/**
 * Same dependency invariants as deleteProcedureTemplateNode (connected
 * edges, execution reference) — never weakened for Undo/Redo. Checklist/
 * troubleshooting-content dependents are out of scope: that content isn't
 * part of this history table's tracked action set.
 *
 * Deliberately does NOT delete the row — same ordering constraint every
 * existing DELETE_NODE writer already follows (see
 * deleteProcedureTemplateNode's own doc comment): the history row
 * referencing this node_id must be INSERTed while the node still exists,
 * then the actual DELETE runs afterward (which cascades ON DELETE SET NULL
 * onto that same just-inserted row as a DB-level side effect). Callers run
 * the returned `finalize` only after inserting their history row.
 */
/** Exported for reuse by procedure-template-restore.ts. */
export async function loadNodeForDeletion(tx: Tx, nodeId: string): Promise<{ node: typeof procedureTemplateNodes.$inferSelect; finalize: (tx: Tx) => Promise<void> }> {
  const [node] = await tx.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, nodeId)).for("update");
  if (!node) fail("NOT_FOUND", `되돌리려는 노드(${nodeId})를 찾을 수 없습니다.`);
  const connectedEdges = await tx
    .select({ id: procedureTemplateEdges.id })
    .from(procedureTemplateEdges)
    .where(or(eq(procedureTemplateEdges.fromNodeId, nodeId), eq(procedureTemplateEdges.toNodeId, nodeId)));
  if (connectedEdges.length > 0) {
    fail("REVERSAL_BLOCKED", `노드(${nodeId})에 연결된 분기가 있어 되돌릴 수 없습니다.`);
  }
  const [executionRef] = await tx
    .select({ id: procedureCaseExecutionNodes.id })
    .from(procedureCaseExecutionNodes)
    .where(eq(procedureCaseExecutionNodes.procedureTemplateNodeId, nodeId))
    .limit(1);
  if (executionRef) fail("REVERSAL_BLOCKED", `노드(${nodeId})가 실행 기록에서 참조되고 있어 되돌릴 수 없습니다.`);
  return {
    node,
    finalize: async (finalizeTx: Tx) => {
      await finalizeTx.delete(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, nodeId));
    },
  };
}

/** Exported for reuse by procedure-template-restore.ts. */
export async function setNodeFields(tx: Tx, nodeId: string, fields: NodeUpdateFields): Promise<void> {
  const updated = await tx
    .update(procedureTemplateNodes)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(procedureTemplateNodes.id, nodeId))
    .returning({ id: procedureTemplateNodes.id });
  if (updated.length === 0) fail("NOT_FOUND", `되돌리려는 노드(${nodeId})를 찾을 수 없습니다.`);
}

/** Exported for reuse by procedure-template-restore.ts. */
export async function setNodeType(tx: Tx, nodeId: string, nodeType: ProcedureNodeType): Promise<void> {
  const updated = await tx
    .update(procedureTemplateNodes)
    .set({ nodeType, updatedAt: new Date() })
    .where(eq(procedureTemplateNodes.id, nodeId))
    .returning({ id: procedureTemplateNodes.id });
  if (updated.length === 0) fail("NOT_FOUND", `되돌리려는 노드(${nodeId})를 찾을 수 없습니다.`);
}

/** Exported for reuse by procedure-template-restore.ts — only the columns this insert actually writes, so a caller building one from a reconstructed (non-DB-sourced) state never needs to fabricate EdgeSnapshot's display-only fromNodeCode/fromNodeTitle/toNodeCode/toNodeTitle. */
export type EdgeInsertFields = Pick<EdgeSnapshot, "id" | "procedureTemplateId" | "fromNodeId" | "toNodeId" | "branchType" | "branchLabel" | "conditionDefinition" | "sortOrder" | "sourceConnectorId" | "clonedFromEdgeId" | "userRoutePoints">;

/** Exported for reuse by procedure-template-restore.ts. */
export async function insertEdgeFromSnapshot(tx: Tx, snapshot: EdgeInsertFields): Promise<typeof procedureTemplateEdges.$inferSelect> {
  const [inserted] = await tx
    .insert(procedureTemplateEdges)
    .values({
      id: snapshot.id,
      procedureTemplateId: snapshot.procedureTemplateId,
      fromNodeId: snapshot.fromNodeId,
      toNodeId: snapshot.toNodeId,
      branchType: snapshot.branchType,
      branchLabel: snapshot.branchLabel,
      conditionDefinition: snapshot.conditionDefinition,
      sortOrder: snapshot.sortOrder,
      sourceConnectorId: snapshot.sourceConnectorId,
      clonedFromEdgeId: snapshot.clonedFromEdgeId,
      userRoutePoints: snapshot.userRoutePoints,
    })
    .returning();
  return inserted;
}

/**
 * Same dependency invariants as deleteProcedureTemplateEdge (clone
 * dependents, execution reference) — never weakened for Undo/Redo.
 * Deliberately does NOT delete the row — see loadNodeForDeletion's own doc
 * comment for why; callers run the returned `finalize` only after
 * inserting their history row.
 */
/** Exported for reuse by procedure-template-restore.ts. */
export async function loadEdgeForDeletion(tx: Tx, edgeId: string): Promise<{ snapshot: EdgeSnapshot; finalize: (tx: Tx) => Promise<void> }> {
  const [edge] = await tx.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, edgeId)).for("update");
  if (!edge) fail("NOT_FOUND", `되돌리려는 분기(${edgeId})를 찾을 수 없습니다.`);
  const dependents = await tx.select({ id: procedureTemplateEdges.id }).from(procedureTemplateEdges).where(eq(procedureTemplateEdges.clonedFromEdgeId, edgeId));
  if (dependents.length > 0) fail("REVERSAL_BLOCKED", `분기(${edgeId})를 다른 초안 버전이 복제 참조하고 있어 되돌릴 수 없습니다.`);
  const [executionRef] = await tx
    .select({ id: procedureCaseExecutionNodes.id })
    .from(procedureCaseExecutionNodes)
    .where(eq(procedureCaseExecutionNodes.selectedOutgoingEdgeId, edgeId))
    .limit(1);
  if (executionRef) fail("REVERSAL_BLOCKED", `분기(${edgeId})가 실행 기록에서 참조되고 있어 되돌릴 수 없습니다.`);
  const endpointNodes = await tx
    .select({ id: procedureTemplateNodes.id, nodeCode: procedureTemplateNodes.nodeCode, title: procedureTemplateNodes.title })
    .from(procedureTemplateNodes)
    .where(or(eq(procedureTemplateNodes.id, edge.fromNodeId), eq(procedureTemplateNodes.id, edge.toNodeId)));
  const fromNode = endpointNodes.find((n) => n.id === edge.fromNodeId);
  const toNode = endpointNodes.find((n) => n.id === edge.toNodeId);
  if (!fromNode || !toNode) fail("NOT_FOUND", `분기(${edgeId})의 시작 또는 대상 노드를 찾을 수 없습니다.`);
  const snapshot = serializeEdgeSnapshot(edge, fromNode, toNode);
  return {
    snapshot,
    finalize: async (finalizeTx: Tx) => {
      await finalizeTx.delete(procedureTemplateEdges).where(eq(procedureTemplateEdges.id, edgeId));
    },
  };
}

/** Exported for reuse by procedure-template-restore.ts. */
export async function setEdgeFields(tx: Tx, edgeId: string, fields: EdgeUpdateFields): Promise<void> {
  const updated = await tx.update(procedureTemplateEdges).set(fields).where(eq(procedureTemplateEdges.id, edgeId)).returning({ id: procedureTemplateEdges.id });
  if (updated.length === 0) fail("NOT_FOUND", `되돌리려는 분기(${edgeId})를 찾을 수 없습니다.`);
}

/** Exported for reuse by procedure-template-restore.ts. */
export async function retargetEdgeFields(tx: Tx, edgeId: string, fields: RetargetFields): Promise<void> {
  const updated = await tx
    .update(procedureTemplateEdges)
    .set({ fromNodeId: fields.fromNodeId, toNodeId: fields.toNodeId })
    .where(eq(procedureTemplateEdges.id, edgeId))
    .returning({ id: procedureTemplateEdges.id });
  if (updated.length === 0) fail("NOT_FOUND", `되돌리려는 분기(${edgeId})를 찾을 수 없습니다.`);
}

/** Cosmetic-only (user_position_x/y) — a position targeting an entity deleted since is silently a no-op, same as it would be for the original saveProcedureTemplateLayout's own per-row diffing intent; nothing structurally invariant depends on this. */
/** Exported for reuse by procedure-template-restore.ts. */
export async function applyPositions(tx: Tx, positions: LayoutPositionState[]): Promise<void> {
  for (const p of positions) {
    await tx.update(procedureTemplateNodes).set({ userPositionX: p.x, userPositionY: p.y, updatedAt: new Date() }).where(eq(procedureTemplateNodes.id, p.nodeId));
  }
}

/** Exported for reuse by procedure-template-restore.ts. */
export async function applyRoutes(tx: Tx, routes: EdgeRouteState[]): Promise<void> {
  for (const r of routes) {
    await tx.update(procedureTemplateEdges).set({ userRoutePoints: r.points }).where(eq(procedureTemplateEdges.id, r.edgeId));
  }
}

/** Exported for reuse by procedure-template-restore.ts. */
export async function setTemplateName(tx: Tx, templateId: string, name: string): Promise<void> {
  await tx.update(procedureTemplates).set({ name }).where(eq(procedureTemplates.id, templateId));
}

// ---- inverse / forward-replay dispatch ----

type ReplayResult = {
  actionType: EditActionType;
  nodeId: string | null;
  edgeId: string | null;
  beforeState: unknown;
  afterState: unknown;
  // Same insert-history-then-delete ordering every existing DELETE_NODE/
  // DELETE_EDGE writer already follows (see loadNodeForDeletion's own doc
  // comment) — set only for a DELETE-producing replay step, run by the
  // caller strictly after insertEditHistory.
  finalize?: (tx: Tx) => Promise<void>;
};

/** Applies the opposite of what `row` represents (used by Undo). */
async function applyInverse(tx: Tx, row: HistoryGroupRow, templateId: string): Promise<ReplayResult> {
  switch (row.actionType) {
    case "CREATE_NODE": {
      const nodeId = resolveNodeId(row);
      const { node, finalize } = await loadNodeForDeletion(tx, nodeId);
      return { actionType: "DELETE_NODE", nodeId, edgeId: null, beforeState: serializeNodeSnapshot(node), afterState: null, finalize };
    }
    case "DELETE_NODE": {
      const snapshot = row.beforeState as NodeSnapshot;
      const inserted = await insertNodeFromSnapshot(tx, snapshot);
      return { actionType: "CREATE_NODE", nodeId: inserted.id, edgeId: null, beforeState: null, afterState: serializeNodeSnapshot(inserted) };
    }
    case "UPDATE_NODE": {
      const nodeId = resolveNodeId(row);
      await setNodeFields(tx, nodeId, row.beforeState as NodeUpdateFields);
      return { actionType: "UPDATE_NODE", nodeId, edgeId: null, beforeState: row.afterState, afterState: row.beforeState };
    }
    case "CHANGE_NODE_TYPE": {
      const nodeId = resolveNodeId(row);
      const { nodeType } = row.beforeState as { nodeType: ProcedureNodeType };
      await setNodeType(tx, nodeId, nodeType);
      return { actionType: "CHANGE_NODE_TYPE", nodeId, edgeId: null, beforeState: row.afterState, afterState: row.beforeState };
    }
    case "CREATE_EDGE": {
      const edgeId = resolveEdgeId(row);
      const { snapshot, finalize } = await loadEdgeForDeletion(tx, edgeId);
      return { actionType: "DELETE_EDGE", nodeId: null, edgeId, beforeState: snapshot, afterState: null, finalize };
    }
    case "DELETE_EDGE": {
      const snapshot = row.beforeState as EdgeSnapshot;
      const inserted = await insertEdgeFromSnapshot(tx, snapshot);
      // Phase 5C-5C — `id` included so this new CREATE_EDGE-shaped row stays self-identifying going forward.
      return { actionType: "CREATE_EDGE", nodeId: null, edgeId: inserted.id, beforeState: null, afterState: { id: inserted.id, fromNodeId: inserted.fromNodeId, toNodeId: inserted.toNodeId, branchType: inserted.branchType, branchLabel: inserted.branchLabel } };
    }
    case "UPDATE_EDGE": {
      const edgeId = resolveEdgeId(row);
      await setEdgeFields(tx, edgeId, row.beforeState as EdgeUpdateFields);
      return { actionType: "UPDATE_EDGE", nodeId: null, edgeId, beforeState: row.afterState, afterState: row.beforeState };
    }
    case "RETARGET_EDGE": {
      const edgeId = resolveEdgeId(row);
      const before = row.beforeState as RetargetFields & { branchType: ProcedureBranchType };
      await retargetEdgeFields(tx, edgeId, before);
      return { actionType: "RETARGET_EDGE", nodeId: null, edgeId, beforeState: row.afterState, afterState: row.beforeState };
    }
    case "SAVE_LAYOUT": {
      const positions = row.beforeState as LayoutPositionState[];
      await applyPositions(tx, positions);
      return { actionType: "SAVE_LAYOUT", nodeId: null, edgeId: null, beforeState: row.afterState, afterState: row.beforeState };
    }
    case "SAVE_EDGE_ROUTE": {
      const routes = row.beforeState as EdgeRouteState[];
      await applyRoutes(tx, routes);
      return { actionType: "SAVE_EDGE_ROUTE", nodeId: null, edgeId: null, beforeState: row.afterState, afterState: row.beforeState };
    }
    case "UPDATE_TEMPLATE_METADATA": {
      const { name } = row.beforeState as { name: string };
      await setTemplateName(tx, templateId, name);
      return { actionType: "UPDATE_TEMPLATE_METADATA", nodeId: null, edgeId: null, beforeState: row.afterState, afterState: row.beforeState };
    }
    default:
      fail("UNSUPPORTED_ACTION", `${row.actionType}은(는) 되돌릴 수 없는 작업입니다.`);
  }
}

/** Replays what `row` originally represents, forward (used by Redo). */
async function applyForward(tx: Tx, row: HistoryGroupRow, templateId: string, groupId: string): Promise<ReplayResult> {
  switch (row.actionType) {
    case "CREATE_NODE": {
      const snapshot = row.afterState as NodeSnapshot;
      const inserted = await insertNodeFromSnapshot(tx, snapshot);
      return { actionType: "CREATE_NODE", nodeId: inserted.id, edgeId: null, beforeState: null, afterState: serializeNodeSnapshot(inserted) };
    }
    case "DELETE_NODE": {
      const nodeId = resolveNodeId(row);
      const { node, finalize } = await loadNodeForDeletion(tx, nodeId);
      return { actionType: "DELETE_NODE", nodeId, edgeId: null, beforeState: serializeNodeSnapshot(node), afterState: null, finalize };
    }
    case "UPDATE_NODE": {
      const nodeId = resolveNodeId(row);
      await setNodeFields(tx, nodeId, row.afterState as NodeUpdateFields);
      return { actionType: "UPDATE_NODE", nodeId, edgeId: null, beforeState: row.beforeState, afterState: row.afterState };
    }
    case "CHANGE_NODE_TYPE": {
      const nodeId = resolveNodeId(row);
      const { nodeType } = row.afterState as { nodeType: ProcedureNodeType };
      await setNodeType(tx, nodeId, nodeType);
      return { actionType: "CHANGE_NODE_TYPE", nodeId, edgeId: null, beforeState: row.beforeState, afterState: row.afterState };
    }
    case "CREATE_EDGE": {
      const after = row.afterState as { id?: string; fromNodeId: string; toNodeId: string; branchType: ProcedureBranchType; branchLabel: string | null };
      // Priority: afterState.id (every new-format row) -> live edge_id FK
      // (older rows, entity never independently deleted) -> UNDO-mirror
      // fallback (older rows only — see module doc comment).
      let edgeId: string | null = after.id ?? row.edgeId;
      let conditionDefinition: unknown = null;
      let sortOrder = 0;
      let sourceConnectorId: string | null = null;
      let clonedFromEdgeId: string | null = null;
      let userRoutePoints: { x: number; y: number }[] | null = null;
      if (!edgeId) {
        const mirror = await findMostRecentUndoMirrorEdgeSnapshot(tx, groupId);
        if (!mirror) fail("IDENTITY_UNRESOLVABLE", `분기 생성 기록(${row.id})의 원래 식별자를 복구할 수 없습니다.`);
        edgeId = mirror.id;
        conditionDefinition = mirror.conditionDefinition;
        sortOrder = mirror.sortOrder;
        sourceConnectorId = mirror.sourceConnectorId;
        clonedFromEdgeId = mirror.clonedFromEdgeId;
        userRoutePoints = mirror.userRoutePoints;
      }
      const [inserted] = await tx
        .insert(procedureTemplateEdges)
        .values({
          id: edgeId,
          procedureTemplateId: templateId,
          fromNodeId: after.fromNodeId,
          toNodeId: after.toNodeId,
          branchType: after.branchType,
          branchLabel: after.branchLabel,
          conditionDefinition,
          sortOrder,
          sourceConnectorId,
          clonedFromEdgeId,
          userRoutePoints,
        })
        .returning();
      // Guarantees `id` is present even when replaying an older row whose
      // own afterState never carried one.
      return { actionType: "CREATE_EDGE", nodeId: null, edgeId: inserted.id, beforeState: null, afterState: { ...after, id: inserted.id } };
    }
    case "DELETE_EDGE": {
      const edgeId = resolveEdgeId(row);
      const { snapshot, finalize } = await loadEdgeForDeletion(tx, edgeId);
      return { actionType: "DELETE_EDGE", nodeId: null, edgeId, beforeState: snapshot, afterState: null, finalize };
    }
    case "UPDATE_EDGE": {
      const edgeId = resolveEdgeId(row);
      await setEdgeFields(tx, edgeId, row.afterState as EdgeUpdateFields);
      return { actionType: "UPDATE_EDGE", nodeId: null, edgeId, beforeState: row.beforeState, afterState: row.afterState };
    }
    case "RETARGET_EDGE": {
      const edgeId = resolveEdgeId(row);
      const after = row.afterState as RetargetFields & { branchType: ProcedureBranchType };
      await retargetEdgeFields(tx, edgeId, after);
      return { actionType: "RETARGET_EDGE", nodeId: null, edgeId, beforeState: row.beforeState, afterState: row.afterState };
    }
    case "SAVE_LAYOUT": {
      const positions = row.afterState as LayoutPositionState[];
      await applyPositions(tx, positions);
      return { actionType: "SAVE_LAYOUT", nodeId: null, edgeId: null, beforeState: row.beforeState, afterState: row.afterState };
    }
    case "SAVE_EDGE_ROUTE": {
      const routes = row.afterState as EdgeRouteState[];
      await applyRoutes(tx, routes);
      return { actionType: "SAVE_EDGE_ROUTE", nodeId: null, edgeId: null, beforeState: row.beforeState, afterState: row.afterState };
    }
    case "UPDATE_TEMPLATE_METADATA": {
      const { name } = row.afterState as { name: string };
      await setTemplateName(tx, templateId, name);
      return { actionType: "UPDATE_TEMPLATE_METADATA", nodeId: null, edgeId: null, beforeState: row.beforeState, afterState: row.afterState };
    }
    default:
      fail("UNSUPPORTED_ACTION", `${row.actionType}은(는) 다시 실행할 수 없는 작업입니다.`);
  }
}

// ---- 5/6. Undo / Redo mutations ----

function foldOrFail(groups: HistoryGroup[]) {
  const events: HistoryGroupEvent[] = groups.map((g) => ({
    changeGroupId: g.changeGroupId,
    origin: g.origin,
    sourceGroupId: g.sourceGroupId,
    restoreTargetGroupId: g.restoreTargetGroupId,
    sequenceNumber: g.minSequenceNumber,
  }));
  try {
    return foldProcedureTemplateEditHistory(events);
  } catch (err) {
    if (err instanceof EventFoldError) fail("HISTORY_INCONSISTENT", err.message);
    throw err;
  }
}

/**
 * Undoes the top of the appliedStack (the most recently applied USER_EDIT
 * or RESTORE group). Rejects cleanly (NO_UNDO_AVAILABLE) if nothing is
 * applied. Applies the target group's rows' inverse in sequence_number
 * DESC — required for compound-group correctness (e.g. the route-point
 * split's CREATE_NODE+RETARGET_EDGE+CREATE_EDGE must undo edge-first,
 * node-last, or the node-delete step would violate the no-connected-edges
 * invariant). Writes exactly one new UNDO group (origin=UNDO,
 * source_group_id=target) whose rows describe the actual inverse edits
 * performed — never a marker-only row.
 */
export async function undoProcedureTemplateChange(templateId: string, actorUserId: string, expectedTemplateUpdatedAt: string): Promise<UndoRedoResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireEditor(tx, actorUserId);
      await assertTechnicalGraphEditable(tx, templateId, expectedTemplateUpdatedAt, actor);

      const groups = await loadTemplateHistoryGroups(tx, templateId);
      const fold = foldOrFail(groups);

      const targetGroupId = fold.appliedStack[fold.appliedStack.length - 1];
      if (!targetGroupId) fail("NO_UNDO_AVAILABLE", "되돌릴 작업이 없습니다.");

      const targetGroup = groups.find((g) => g.changeGroupId === targetGroupId);
      if (!targetGroup) fail("HISTORY_INCONSISTENT", `appliedStack top ${targetGroupId} has no matching history group`);

      const newChangeGroupId = randomUUID();
      const rowsDesc = [...targetGroup.rows].sort((a, b) => b.sequenceNumber - a.sequenceNumber);
      for (const row of rowsDesc) {
        const result = await applyInverse(tx, row, templateId);
        await insertEditHistory(tx, {
          procedureTemplateId: templateId,
          actionType: result.actionType,
          nodeId: result.nodeId,
          edgeId: result.edgeId,
          beforeState: result.beforeState,
          afterState: result.afterState,
          actorUserId: actor.id,
          changeGroupId: newChangeGroupId,
          origin: "UNDO",
          sourceGroupId: targetGroupId,
        });
        // A DELETE-producing step's actual DELETE must run strictly after
        // its own history row is inserted — see loadNodeForDeletion's doc
        // comment (same ordering every existing DELETE_NODE/DELETE_EDGE
        // writer already follows).
        if (result.finalize) await result.finalize(tx);
      }

      const updatedAt = await touchTemplate(tx, templateId);
      return { ok: true, updatedAt };
    });
  } catch (err) {
    if (err instanceof UndoRedoError) return { ok: false, code: err.code, message: err.message };
    if (err instanceof EditorMutationError) return err.result;
    throw err;
  }
}

/**
 * Redoes the top of the redoStack (the most recently undone group).
 * Rejects cleanly (NO_REDO_AVAILABLE) if nothing is available. A new
 * USER_EDIT/RESTORE naturally clears redoStack via the fold itself — no
 * mutable redo-depth/cursor is ever maintained. Replays the ORIGINAL
 * forward group's own rows in sequence_number ASC. Writes exactly one new
 * REDO group (origin=REDO, source_group_id=target).
 */
export async function redoProcedureTemplateChange(templateId: string, actorUserId: string, expectedTemplateUpdatedAt: string): Promise<UndoRedoResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireEditor(tx, actorUserId);
      await assertTechnicalGraphEditable(tx, templateId, expectedTemplateUpdatedAt, actor);

      const groups = await loadTemplateHistoryGroups(tx, templateId);
      const fold = foldOrFail(groups);

      const targetGroupId = fold.redoStack[fold.redoStack.length - 1];
      if (!targetGroupId) fail("NO_REDO_AVAILABLE", "다시 실행할 작업이 없습니다.");

      const targetGroup = groups.find((g) => g.changeGroupId === targetGroupId);
      if (!targetGroup) fail("HISTORY_INCONSISTENT", `redoStack top ${targetGroupId} has no matching history group`);

      const newChangeGroupId = randomUUID();
      const rowsAsc = [...targetGroup.rows].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
      for (const row of rowsAsc) {
        const result = await applyForward(tx, row, templateId, targetGroupId);
        await insertEditHistory(tx, {
          procedureTemplateId: templateId,
          actionType: result.actionType,
          nodeId: result.nodeId,
          edgeId: result.edgeId,
          beforeState: result.beforeState,
          afterState: result.afterState,
          actorUserId: actor.id,
          changeGroupId: newChangeGroupId,
          origin: "REDO",
          sourceGroupId: targetGroupId,
        });
        if (result.finalize) await result.finalize(tx);
      }

      const updatedAt = await touchTemplate(tx, templateId);
      return { ok: true, updatedAt };
    });
  } catch (err) {
    if (err instanceof UndoRedoError) return { ok: false, code: err.code, message: err.message };
    if (err instanceof EditorMutationError) return err.result;
    throw err;
  }
}
