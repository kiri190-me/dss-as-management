import type { ProcedureBranchType, ProcedureNodeType } from "./procedure-template-types";

/**
 * Phase 4A — pure DRAFT-vs-parent comparison. Operates on two already-
 * loaded node/edge snapshots (never touches the DB itself — see
 * src/lib/db/queries/procedure-template-editor.ts for the caller that
 * loads both sides and calls this). No visual merge tool: this produces a
 * flat list of differences a side panel/table can render directly.
 *
 * Nodes are matched across versions by nodeCode (stable across a clone —
 * see createNewDraftVersion). Edges are matched by clonedFromEdgeId (the
 * exact parent edge a DRAFT edge was cloned from — edges get a fresh id on
 * every clone, so nodeCode-style matching isn't available for them); a
 * DRAFT edge with no clonedFromEdgeId is always genuinely new (created via
 * the editor's "add connection" feature, since Phase 4A never deletes an
 * edge, every cloned edge always keeps its lineage pointer).
 */

export type DiffNode = {
  id: string;
  nodeCode: string;
  title: string;
  nodeType: ProcedureNodeType;
  description: string | null;
  instructions: string | null;
  sortOrder: number;
  isActive: boolean;
  effectiveX: number;
  effectiveY: number;
};

export type DiffEdge = {
  id: string;
  clonedFromEdgeId: string | null;
  fromNodeCode: string;
  toNodeCode: string;
  branchType: ProcedureBranchType;
  branchLabel: string | null;
};

export type FieldChange = { field: string; before: unknown; after: unknown };

export type DraftParentComparison = {
  changedNodes: { nodeCode: string; changes: FieldChange[] }[];
  movedNodes: { nodeCode: string; before: { x: number; y: number }; after: { x: number; y: number } }[];
  changedNodeTypes: { nodeCode: string; before: ProcedureNodeType; after: ProcedureNodeType }[];
  changedEdges: { draftEdgeId: string; fromNodeCode: string; toNodeCode: string; before: { branchType: ProcedureBranchType; branchLabel: string | null }; after: { branchType: ProcedureBranchType; branchLabel: string | null } }[];
  retargetedEdges: { draftEdgeId: string; before: { fromNodeCode: string; toNodeCode: string }; after: { fromNodeCode: string; toNodeCode: string } }[];
  newlyAddedEdges: { draftEdgeId: string; fromNodeCode: string; toNodeCode: string; branchType: ProcedureBranchType; branchLabel: string | null }[];
};

const NODE_COMPARE_FIELDS = ["title", "description", "instructions", "sortOrder", "isActive"] as const;

export function compareDraftAndParentGraphs(draftNodes: DiffNode[], draftEdges: DiffEdge[], parentNodes: DiffNode[], parentEdges: DiffEdge[]): DraftParentComparison {
  const parentNodeByCode = new Map(parentNodes.map((n) => [n.nodeCode, n]));
  const parentEdgeById = new Map(parentEdges.map((e) => [e.id, e]));

  const changedNodes: DraftParentComparison["changedNodes"] = [];
  const movedNodes: DraftParentComparison["movedNodes"] = [];
  const changedNodeTypes: DraftParentComparison["changedNodeTypes"] = [];

  for (const draftNode of draftNodes) {
    const parentNode = parentNodeByCode.get(draftNode.nodeCode);
    if (!parentNode) continue; // Phase 4A never adds nodes — every draft node has a parent counterpart once cloned from a published version.

    const changes: FieldChange[] = [];
    for (const field of NODE_COMPARE_FIELDS) {
      if (draftNode[field] !== parentNode[field]) {
        changes.push({ field, before: parentNode[field], after: draftNode[field] });
      }
    }
    if (changes.length > 0) changedNodes.push({ nodeCode: draftNode.nodeCode, changes });

    if (draftNode.nodeType !== parentNode.nodeType) {
      changedNodeTypes.push({ nodeCode: draftNode.nodeCode, before: parentNode.nodeType, after: draftNode.nodeType });
    }

    if (draftNode.effectiveX !== parentNode.effectiveX || draftNode.effectiveY !== parentNode.effectiveY) {
      movedNodes.push({
        nodeCode: draftNode.nodeCode,
        before: { x: parentNode.effectiveX, y: parentNode.effectiveY },
        after: { x: draftNode.effectiveX, y: draftNode.effectiveY },
      });
    }
  }

  const changedEdges: DraftParentComparison["changedEdges"] = [];
  const retargetedEdges: DraftParentComparison["retargetedEdges"] = [];
  const newlyAddedEdges: DraftParentComparison["newlyAddedEdges"] = [];

  for (const draftEdge of draftEdges) {
    if (!draftEdge.clonedFromEdgeId) {
      newlyAddedEdges.push({
        draftEdgeId: draftEdge.id,
        fromNodeCode: draftEdge.fromNodeCode,
        toNodeCode: draftEdge.toNodeCode,
        branchType: draftEdge.branchType,
        branchLabel: draftEdge.branchLabel,
      });
      continue;
    }

    const parentEdge = parentEdgeById.get(draftEdge.clonedFromEdgeId);
    if (!parentEdge) continue; // Should not happen (Phase 4A never deletes edges), but never assume — skip rather than fabricate a diff entry.

    const endpointsChanged = draftEdge.fromNodeCode !== parentEdge.fromNodeCode || draftEdge.toNodeCode !== parentEdge.toNodeCode;
    const labelOrTypeChanged = draftEdge.branchType !== parentEdge.branchType || draftEdge.branchLabel !== parentEdge.branchLabel;

    if (endpointsChanged) {
      retargetedEdges.push({
        draftEdgeId: draftEdge.id,
        before: { fromNodeCode: parentEdge.fromNodeCode, toNodeCode: parentEdge.toNodeCode },
        after: { fromNodeCode: draftEdge.fromNodeCode, toNodeCode: draftEdge.toNodeCode },
      });
    }
    if (labelOrTypeChanged) {
      changedEdges.push({
        draftEdgeId: draftEdge.id,
        fromNodeCode: draftEdge.fromNodeCode,
        toNodeCode: draftEdge.toNodeCode,
        before: { branchType: parentEdge.branchType, branchLabel: parentEdge.branchLabel },
        after: { branchType: draftEdge.branchType, branchLabel: draftEdge.branchLabel },
      });
    }
  }

  return { changedNodes, movedNodes, changedNodeTypes, changedEdges, retargetedEdges, newlyAddedEdges };
}
