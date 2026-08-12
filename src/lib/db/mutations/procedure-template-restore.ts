import "server-only";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../client";
import { procedureTemplateNodes, procedureTemplateEdges } from "../schema";
import { EditorMutationError, requireEditor, assertTechnicalGraphEditable, touchTemplate, insertEditHistory, serializeNodeSnapshot, type NodeSnapshot } from "./procedure-template-editor";
import {
  UndoRedoError,
  loadTemplateHistoryGroups,
  insertNodeFromSnapshot,
  loadNodeForDeletion,
  setNodeFields,
  setNodeType,
  insertEdgeFromSnapshot,
  loadEdgeForDeletion,
  setEdgeFields,
  retargetEdgeFields,
  applyPositions,
  applyRoutes,
  setTemplateName,
  type UndoRedoResultCode,
  type NodeUpdateFields,
  type EdgeUpdateFields,
  type RetargetFields,
  type LayoutPositionState,
  type EdgeRouteState,
  type EdgeInsertFields,
} from "./procedure-template-undo-redo";
import { reconstructStateAtSequenceNumber, ReplayError, type ReplayHistoryRow, type ReplayNodeState, type ReplayEdgeState } from "@/lib/domain/procedure-template-edit-history-replay";
import type { ProcedureNodeType, ProcedureBranchType } from "@/lib/domain/procedure-template-types";

/**
 * Phase 5C-5C — server-authoritative Historical Restore core. Restore is a
 * NEW forward, reversible operation (origin=RESTORE) that brings the
 * live graph/template-metadata to exactly the state implied by a chosen
 * past forward group — WITHOUT rewriting or removing any prior history
 * row. It computes a minimal entity-level diff between the live current
 * state and a purely-replayed target state, then applies that diff in one
 * transaction, writing one new RESTORE group whose rows reuse the exact
 * same action types/shapes every other writer already uses (never
 * marker-only rows) — see reconstructStateAtSequenceNumber's own doc
 * comment for why a full forward replay (not a live-FK read) is required,
 * and procedure-template-undo-redo.ts's own doc comment for the identity
 * gaps this shares with Undo/Redo.
 *
 * Restore-picker UI, the editor buttons, and any execution-related
 * behavior are explicitly out of scope here — see HANDOFF.md.
 */

export type RestoreResultCode = UndoRedoResultCode | "INVALID_RESTORE_TARGET";

export type RestoreResult = { ok: true; updatedAt: string } | { ok: false; code: RestoreResultCode; message: string };

class RestoreError extends Error {
  code: RestoreResultCode;
  constructor(code: RestoreResultCode, message: string) {
    super(message);
    this.code = code;
  }
}

function fail(code: RestoreResultCode, message: string): never {
  throw new RestoreError(code, message);
}

const ELIGIBLE_RESTORE_TARGET_ORIGINS = new Set(["USER_EDIT", "REDO", "RESTORE"]);

/**
 * Exported for reuse by the read-only history query layer (src/lib/db/
 * queries/procedure-template-history.ts) — the UI must never decide restore
 * eligibility with its own separate copy of this rule; this is the single
 * source of truth, and the mutation above remains the authoritative
 * enforcement regardless of what the UI renders.
 */
export function isEligibleRestoreTargetOrigin(origin: string): boolean {
  return ELIGIBLE_RESTORE_TARGET_ORIGINS.has(origin);
}

function toNodeSnapshot(templateId: string, n: ReplayNodeState): NodeSnapshot {
  return {
    id: n.id,
    procedureTemplateId: templateId,
    nodeCode: n.nodeCode,
    nodeType: n.nodeType as ProcedureNodeType,
    title: n.title,
    description: n.description,
    objective: n.objective,
    preparation: n.preparation,
    toolsAndEquipment: n.toolsAndEquipment,
    safetyCaution: n.safetyCaution,
    instructions: n.instructions,
    expectedNormalResult: n.expectedNormalResult,
    ngSymptoms: n.ngSymptoms,
    recommendedCorrectiveAction: n.recommendedCorrectiveAction,
    acceptanceCriteria: n.acceptanceCriteria,
    workerMayAddNextTask: n.workerMayAddNextTask,
    positionX: n.positionX,
    positionY: n.positionY,
    userPositionX: n.userPositionX,
    userPositionY: n.userPositionY,
    sortOrder: n.sortOrder,
    sourceWorksheet: n.sourceWorksheet,
    sourceShapeId: n.sourceShapeId,
    sourceCellRange: n.sourceCellRange,
    isActive: n.isActive,
    createdAt: n.createdAt,
    updatedAt: new Date().toISOString(),
  };
}

function toEdgeInsertFields(templateId: string, e: ReplayEdgeState): EdgeInsertFields {
  return {
    id: e.id,
    procedureTemplateId: templateId,
    fromNodeId: e.fromNodeId,
    toNodeId: e.toNodeId,
    branchType: e.branchType as ProcedureBranchType,
    branchLabel: e.branchLabel,
    conditionDefinition: e.conditionDefinition,
    sortOrder: e.sortOrder,
    sourceConnectorId: e.sourceConnectorId,
    clonedFromEdgeId: e.clonedFromEdgeId,
    userRoutePoints: e.userRoutePoints,
  };
}

type RetargetDiff = { id: string; before: RetargetFields & { branchType: ProcedureBranchType }; after: RetargetFields & { branchType: ProcedureBranchType } };

/**
 * Server-authoritative — actor eligibility, TECHNICAL_TASK-only,
 * DRAFT-only, ADMIN/SUPER_ADMIN-only, and optimistic concurrency all
 * reuse the exact same gate as every other TECHNICAL_TASK-graph mutation
 * (assertTechnicalGraphEditable) — FULL_SERVICE stays hard-denied even for
 * SUPER_ADMIN, PUBLISHED stays immutable, REFERENCE stays denied.
 */
export async function restoreProcedureTemplateChange(templateId: string, actorUserId: string, targetChangeGroupId: string, expectedTemplateUpdatedAt: string): Promise<RestoreResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await requireEditor(tx, actorUserId);
      const templateRow = await assertTechnicalGraphEditable(tx, templateId, expectedTemplateUpdatedAt, actor.role);

      const groups = await loadTemplateHistoryGroups(tx, templateId);
      const targetGroup = groups.find((g) => g.changeGroupId === targetChangeGroupId);
      if (!targetGroup) fail("NOT_FOUND", "복원 대상 이력을 찾을 수 없습니다.");
      if (!ELIGIBLE_RESTORE_TARGET_ORIGINS.has(targetGroup.origin)) {
        fail("INVALID_RESTORE_TARGET", "되돌리기(UNDO) 지점 또는 지원되지 않는 이력 지점으로는 복원할 수 없습니다.");
      }

      const flatRows: ReplayHistoryRow[] = groups.flatMap((g) =>
        g.rows.map((r) => ({
          id: r.id,
          changeGroupId: g.changeGroupId,
          origin: g.origin,
          sourceGroupId: g.sourceGroupId,
          sequenceNumber: r.sequenceNumber,
          actionType: r.actionType,
          nodeId: r.nodeId,
          edgeId: r.edgeId,
          beforeState: r.beforeState,
          afterState: r.afterState,
        }))
      );

      const targetCutoff = Math.max(...targetGroup.rows.map((r) => r.sequenceNumber));

      let targetState;
      try {
        targetState = reconstructStateAtSequenceNumber(flatRows, targetCutoff, templateRow.name);
      } catch (err) {
        if (err instanceof ReplayError) fail("IDENTITY_UNRESOLVABLE", `복원 대상 상태를 재구성할 수 없습니다: ${err.message}`);
        throw err;
      }

      const currentNodeRows = await tx.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.procedureTemplateId, templateId));
      const currentEdgeRows = await tx.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.procedureTemplateId, templateId));
      const currentNodes = new Map(currentNodeRows.map((n) => [n.id, n]));
      const currentEdges = new Map(currentEdgeRows.map((e) => [e.id, e]));
      const currentName = templateRow.name;

      // ---- C. compute the minimal entity-level diff ----
      const nodesToCreate: ReplayNodeState[] = [];
      const nodesToDelete: string[] = [];
      const nodeUpdates: { id: string; before: NodeUpdateFields; after: NodeUpdateFields }[] = [];
      const nodeTypeChanges: { id: string; before: string; after: string }[] = [];
      const layoutBefore: LayoutPositionState[] = [];
      const layoutAfter: LayoutPositionState[] = [];

      for (const [id, targetNode] of targetState.nodes) {
        if (!currentNodes.has(id)) nodesToCreate.push(targetNode);
      }
      for (const id of currentNodes.keys()) {
        if (!targetState.nodes.has(id)) nodesToDelete.push(id);
      }
      for (const [id, targetNode] of targetState.nodes) {
        const cur = currentNodes.get(id);
        if (!cur) continue;
        const curFields: NodeUpdateFields = { title: cur.title, description: cur.description, instructions: cur.instructions, sortOrder: cur.sortOrder, isActive: cur.isActive };
        const targetFields: NodeUpdateFields = { title: targetNode.title, description: targetNode.description, instructions: targetNode.instructions, sortOrder: targetNode.sortOrder, isActive: targetNode.isActive };
        if (JSON.stringify(curFields) !== JSON.stringify(targetFields)) nodeUpdates.push({ id, before: curFields, after: targetFields });
        if (cur.nodeType !== targetNode.nodeType) nodeTypeChanges.push({ id, before: cur.nodeType, after: targetNode.nodeType });
        if (cur.userPositionX !== targetNode.userPositionX || cur.userPositionY !== targetNode.userPositionY) {
          layoutBefore.push({ nodeId: id, x: cur.userPositionX, y: cur.userPositionY });
          layoutAfter.push({ nodeId: id, x: targetNode.userPositionX, y: targetNode.userPositionY });
        }
      }

      const edgesToCreate: ReplayEdgeState[] = [];
      const edgesToDelete: string[] = [];
      const edgeUpdates: { id: string; before: EdgeUpdateFields; after: EdgeUpdateFields }[] = [];
      const edgeRetargets: RetargetDiff[] = [];
      const routeBefore: EdgeRouteState[] = [];
      const routeAfter: EdgeRouteState[] = [];

      for (const [id, targetEdge] of targetState.edges) {
        if (!currentEdges.has(id)) edgesToCreate.push(targetEdge);
      }
      for (const id of currentEdges.keys()) {
        if (!targetState.edges.has(id)) edgesToDelete.push(id);
      }
      for (const [id, targetEdge] of targetState.edges) {
        const cur = currentEdges.get(id);
        if (!cur) continue;
        if (cur.fromNodeId !== targetEdge.fromNodeId || cur.toNodeId !== targetEdge.toNodeId) {
          edgeRetargets.push({ id, before: { fromNodeId: cur.fromNodeId, toNodeId: cur.toNodeId, branchType: cur.branchType }, after: { fromNodeId: targetEdge.fromNodeId, toNodeId: targetEdge.toNodeId, branchType: targetEdge.branchType as ProcedureBranchType } });
        }
        if (cur.branchType !== targetEdge.branchType || cur.branchLabel !== targetEdge.branchLabel) {
          edgeUpdates.push({ id, before: { branchType: cur.branchType, branchLabel: cur.branchLabel }, after: { branchType: targetEdge.branchType as ProcedureBranchType, branchLabel: targetEdge.branchLabel } });
        }
        if (JSON.stringify(cur.userRoutePoints) !== JSON.stringify(targetEdge.userRoutePoints)) {
          routeBefore.push({ edgeId: id, points: cur.userRoutePoints });
          routeAfter.push({ edgeId: id, points: targetEdge.userRoutePoints });
        }
      }

      const nameChanged = currentName !== targetState.templateName;

      // ---- 5. safe application order ----
      // Edges whose endpoints changed and whose OLD endpoint is about to be
      // deleted must retarget away BEFORE that node's delete; edges whose
      // NEW endpoint doesn't exist yet must retarget AFTER that node's
      // create. The rare case where both apply (old endpoint doomed AND
      // new endpoint not yet created) can't be expressed as a single safe
      // RETARGET_EDGE step, so it's decomposed into DELETE_EDGE (early) +
      // CREATE_EDGE (late) instead — same end state, still id-preserving.
      const nodeIdsToDelete = new Set(nodesToDelete);
      const nodeIdsToCreate = new Set(nodesToCreate.map((n) => n.id));
      const earlyRetargets: RetargetDiff[] = [];
      const lateRetargets: RetargetDiff[] = [];
      for (const r of edgeRetargets) {
        const oldTouchesDoomed = nodeIdsToDelete.has(r.before.fromNodeId) || nodeIdsToDelete.has(r.before.toNodeId);
        const newNeedsCreate = nodeIdsToCreate.has(r.after.fromNodeId) || nodeIdsToCreate.has(r.after.toNodeId);
        if (oldTouchesDoomed && newNeedsCreate) {
          edgesToDelete.push(r.id);
          edgesToCreate.push(targetState.edges.get(r.id)!);
        } else if (newNeedsCreate) {
          lateRetargets.push(r);
        } else {
          earlyRetargets.push(r);
        }
      }

      const anyChange =
        earlyRetargets.length > 0 ||
        lateRetargets.length > 0 ||
        edgesToDelete.length > 0 ||
        nodesToDelete.length > 0 ||
        nodesToCreate.length > 0 ||
        edgesToCreate.length > 0 ||
        nodeUpdates.length > 0 ||
        nodeTypeChanges.length > 0 ||
        edgeUpdates.length > 0 ||
        layoutAfter.length > 0 ||
        routeAfter.length > 0 ||
        nameChanged;

      if (!anyChange) {
        return { ok: true, updatedAt: expectedTemplateUpdatedAt };
      }

      const changeGroupId = randomUUID();
      const historyBase = { procedureTemplateId: templateId, actorUserId: actor.id, changeGroupId, origin: "RESTORE" as const, restoreTargetGroupId: targetChangeGroupId };

      // 1. early retargets — vacate edges from nodes about to be deleted.
      for (const r of earlyRetargets) {
        await retargetEdgeFields(tx, r.id, r.after);
        await insertEditHistory(tx, { ...historyBase, actionType: "RETARGET_EDGE", edgeId: r.id, beforeState: { id: r.id, ...r.before }, afterState: { id: r.id, ...r.after } });
      }

      // 2. delete edges no longer present in target.
      for (const edgeId of edgesToDelete) {
        const { snapshot, finalize } = await loadEdgeForDeletion(tx, edgeId);
        await insertEditHistory(tx, { ...historyBase, actionType: "DELETE_EDGE", edgeId, beforeState: snapshot, afterState: null });
        await finalize(tx);
      }

      // 3. delete nodes no longer present in target (now safe — edges gone/retargeted).
      for (const nodeId of nodesToDelete) {
        const { node, finalize } = await loadNodeForDeletion(tx, nodeId);
        await insertEditHistory(tx, { ...historyBase, actionType: "DELETE_NODE", nodeId, beforeState: serializeNodeSnapshot(node), afterState: null });
        await finalize(tx);
      }

      // 4. create nodes present in target but not current — before any edge that needs them.
      for (const targetNode of nodesToCreate) {
        const inserted = await insertNodeFromSnapshot(tx, toNodeSnapshot(templateId, targetNode));
        await insertEditHistory(tx, { ...historyBase, actionType: "CREATE_NODE", nodeId: inserted.id, beforeState: null, afterState: serializeNodeSnapshot(inserted) });
      }

      // 5. late retargets — endpoints that needed a just-created node.
      for (const r of lateRetargets) {
        await retargetEdgeFields(tx, r.id, r.after);
        await insertEditHistory(tx, { ...historyBase, actionType: "RETARGET_EDGE", edgeId: r.id, beforeState: { id: r.id, ...r.before }, afterState: { id: r.id, ...r.after } });
      }

      // 6. create edges present in target but not current — endpoints now exist.
      for (const targetEdge of edgesToCreate) {
        const inserted = await insertEdgeFromSnapshot(tx, toEdgeInsertFields(templateId, targetEdge));
        await insertEditHistory(tx, {
          ...historyBase,
          actionType: "CREATE_EDGE",
          edgeId: inserted.id,
          beforeState: null,
          afterState: { id: inserted.id, fromNodeId: inserted.fromNodeId, toNodeId: inserted.toNodeId, branchType: inserted.branchType, branchLabel: inserted.branchLabel },
        });
      }

      // 7. node property updates.
      for (const u of nodeUpdates) {
        await setNodeFields(tx, u.id, u.after);
        await insertEditHistory(tx, { ...historyBase, actionType: "UPDATE_NODE", nodeId: u.id, beforeState: { id: u.id, ...u.before }, afterState: { id: u.id, ...u.after } });
      }

      // 8. node type changes.
      for (const c of nodeTypeChanges) {
        await setNodeType(tx, c.id, c.after as ProcedureNodeType);
        await insertEditHistory(tx, { ...historyBase, actionType: "CHANGE_NODE_TYPE", nodeId: c.id, beforeState: { id: c.id, nodeType: c.before }, afterState: { id: c.id, nodeType: c.after } });
      }

      // 9. edge branch/label updates.
      for (const u of edgeUpdates) {
        await setEdgeFields(tx, u.id, u.after);
        await insertEditHistory(tx, { ...historyBase, actionType: "UPDATE_EDGE", edgeId: u.id, beforeState: { id: u.id, ...u.before }, afterState: { id: u.id, ...u.after } });
      }

      // 10. batched layout (same array-shaped convention as saveProcedureTemplateLayout).
      if (layoutAfter.length > 0) {
        await applyPositions(tx, layoutAfter);
        await insertEditHistory(tx, { ...historyBase, actionType: "SAVE_LAYOUT", beforeState: layoutBefore, afterState: layoutAfter });
      }

      // 11. batched edge routes.
      if (routeAfter.length > 0) {
        await applyRoutes(tx, routeAfter);
        await insertEditHistory(tx, { ...historyBase, actionType: "SAVE_EDGE_ROUTE", beforeState: routeBefore, afterState: routeAfter });
      }

      // 12. template metadata.
      if (nameChanged) {
        await setTemplateName(tx, templateId, targetState.templateName);
        await insertEditHistory(tx, { ...historyBase, actionType: "UPDATE_TEMPLATE_METADATA", beforeState: { name: currentName }, afterState: { name: targetState.templateName } });
      }

      const updatedAt = await touchTemplate(tx, templateId);
      return { ok: true, updatedAt };
    });
  } catch (err) {
    if (err instanceof RestoreError) return { ok: false, code: err.code, message: err.message };
    if (err instanceof UndoRedoError) return { ok: false, code: err.code, message: err.message };
    if (err instanceof EditorMutationError) return err.result;
    throw err;
  }
}
