import { routePointsEqual, type RoutePoint } from "@/lib/graph-editor-core/routing";
import type { RepairCaseFlowchartNodeType, RepairCaseFlowchartBranchType } from "@/lib/domain/repair-case-flowchart-types";

/**
 * Pure draft/render/dirty/save-ordering logic for CaseFlowchartEditorScreen
 * (5C-6D follow-up #2 — the "live preview + explicit commit" editor model).
 * Extracted out of the screen component specifically so it can be unit-
 * tested: a component importing "use server" action modules can't be
 * statically rendered by this project's node:test harness (confirmed
 * during 6D — see this module's sibling test file's own doc comment), but
 * this module holds no server-action import, no React, and no persistence
 * of its own — CaseFlowchartEditorScreen is the only caller, and it uses
 * these exact functions rather than a parallel duplicate.
 *
 * Editor model:
 *   SERVER BASELINE (nodes/edges props) + LOCAL DRAFT OVERRIDES
 *   (nodeDraftsById / nodePositionsById / edgeDraftsById / routePointsByEdgeId)
 *   = RENDERED GRAPH (mergeNodeForRender / mergeEdgeForRender)
 *   DIRTY = rendered draft differs from baseline (computeDirty*)
 *   SAVE = diff local draft vs baseline, run mutations in deterministic
 *          order (planSaveSteps + runSaveSequence), clear only what
 *          actually persisted.
 *
 * Node/edge CREATION and DELETION remain immediate server mutations in this
 * checkpoint (see CaseFlowchartEditorScreen's own SAVE CONTRACT doc comment
 * for why) — everything else a user can edit on an EXISTING node/edge
 * (title, description, type, branch type/label, retarget, route, position)
 * goes through this draft/render/save model.
 */

export type CaseFlowchartNodeDraft = { title: string; description: string; nodeType: RepairCaseFlowchartNodeType };
export type CaseFlowchartEdgeDraft = { branchType: RepairCaseFlowchartBranchType; branchLabel: string; fromNodeId: string; toNodeId: string };
export type Position = { x: number; y: number };

export type ServerNodeSnapshot = {
  id: string;
  title: string;
  description: string | null;
  nodeType: RepairCaseFlowchartNodeType;
  positionX: number;
  positionY: number;
};
export type ServerEdgeSnapshot = {
  id: string;
  branchType: RepairCaseFlowchartBranchType;
  branchLabel: string | null;
  fromNodeId: string;
  toNodeId: string;
  routePoints: RoutePoint[] | null;
};

// ==================== RENDER (baseline + drafts → rendered graph) ====================

/** Applies a pending node draft/position (if any) on top of the server baseline — this is what the graph canvas renders, always, so an edit is visible the instant it's made, never only after Save. */
export function mergeNodeForRender(server: ServerNodeSnapshot, pendingDraft: CaseFlowchartNodeDraft | undefined, pendingPosition: Position | undefined): ServerNodeSnapshot {
  return {
    id: server.id,
    nodeType: pendingDraft?.nodeType ?? server.nodeType,
    title: pendingDraft?.title ?? server.title,
    description: pendingDraft ? (pendingDraft.description.length > 0 ? pendingDraft.description : null) : server.description,
    positionX: pendingPosition?.x ?? server.positionX,
    positionY: pendingPosition?.y ?? server.positionY,
  };
}

/**
 * Same principle for edges. `pendingRoutePoints` must be the raw
 * `Map.get(edgeId)` result (not pre-resolved) — `undefined` means "no route
 * override pending" (fall back to the server's route), while an explicit
 * `null` means "pending reset to automatic routing," a real, meaningful
 * override in its own right, not the same as "nothing pending."
 */
export function mergeEdgeForRender(server: ServerEdgeSnapshot, pendingDraft: CaseFlowchartEdgeDraft | undefined, pendingRoutePoints: RoutePoint[] | null | undefined): ServerEdgeSnapshot {
  return {
    id: server.id,
    fromNodeId: pendingDraft?.fromNodeId ?? server.fromNodeId,
    toNodeId: pendingDraft?.toNodeId ?? server.toNodeId,
    branchType: pendingDraft?.branchType ?? server.branchType,
    branchLabel: pendingDraft ? (pendingDraft.branchLabel.length > 0 ? pendingDraft.branchLabel : null) : server.branchLabel,
    routePoints: pendingRoutePoints !== undefined ? pendingRoutePoints : server.routePoints,
  };
}

// ==================== DIRTY (rendered draft vs baseline) ====================

export function isNodeDraftDirty(draft: CaseFlowchartNodeDraft, server: ServerNodeSnapshot): boolean {
  return draft.title !== server.title || draft.description !== (server.description ?? "") || draft.nodeType !== server.nodeType;
}

export function isEdgeDraftDirty(draft: CaseFlowchartEdgeDraft, server: ServerEdgeSnapshot): boolean {
  return (
    draft.branchType !== server.branchType ||
    draft.branchLabel !== (server.branchLabel ?? "") ||
    draft.fromNodeId !== server.fromNodeId ||
    draft.toNodeId !== server.toNodeId
  );
}

/** Entries whose draft genuinely differs from its last-known server value — an orphaned draft (id no longer present, e.g. deleted meanwhile) never counts as pending. */
export function computeDirtyNodeEntries(draftsById: Map<string, CaseFlowchartNodeDraft>, serverNodesById: Map<string, ServerNodeSnapshot>): [string, CaseFlowchartNodeDraft][] {
  const result: [string, CaseFlowchartNodeDraft][] = [];
  for (const [id, draft] of draftsById) {
    const server = serverNodesById.get(id);
    if (server && isNodeDraftDirty(draft, server)) result.push([id, draft]);
  }
  return result;
}

export function computeDirtyEdgeEntries(draftsById: Map<string, CaseFlowchartEdgeDraft>, serverEdgesById: Map<string, ServerEdgeSnapshot>): [string, CaseFlowchartEdgeDraft][] {
  const result: [string, CaseFlowchartEdgeDraft][] = [];
  for (const [id, draft] of draftsById) {
    const server = serverEdgesById.get(id);
    if (server && isEdgeDraftDirty(draft, server)) result.push([id, draft]);
  }
  return result;
}

export function computeDirtyRouteEdgeIds(pendingRoutesById: Map<string, RoutePoint[] | null>, serverEdgesById: Map<string, ServerEdgeSnapshot>): string[] {
  const result: string[] = [];
  for (const [id, points] of pendingRoutesById) {
    const server = serverEdgesById.get(id);
    if (server && !routePointsEqual(points, server.routePoints)) result.push(id);
  }
  return result;
}

/** A pending position that round-trips back to the server's own value (e.g. dragged out and back) stops counting as dirty on its own — same "compare current draft to baseline" rule as every other field, never a sticky "was dragged" boolean. */
export function computeDirtyPositionNodeIds(pendingPositionsById: Map<string, Position>, serverNodesById: Map<string, ServerNodeSnapshot>): string[] {
  const result: string[] = [];
  for (const [id, pos] of pendingPositionsById) {
    const server = serverNodesById.get(id);
    if (server && (pos.x !== server.positionX || pos.y !== server.positionY)) result.push(id);
  }
  return result;
}

// ==================== SAVE (plan + sequence) ====================

export type SaveStep =
  | { kind: "NODE_FIELDS"; nodeId: string }
  | { kind: "NODE_TYPE"; nodeId: string }
  | { kind: "NODE_POSITIONS"; nodeIds: string[] }
  | { kind: "EDGE_FIELDS"; edgeId: string }
  | { kind: "EDGE_RETARGET"; edgeId: string }
  | { kind: "EDGE_ROUTE"; edgeId: string };

/**
 * Deterministic save order: node property/type changes, then node
 * positions (ALL dirty positions in one batched step — the existing
 * `saveRepairCaseFlowchartLayoutAction` already accepts an array, so this
 * mirrors that mutation's own natural shape rather than one call per
 * node), then edge property/retarget changes, then route changes. Planning
 * only — never calls a mutation; the caller executes each step and feeds
 * the result back into `runSaveSequence`.
 */
export function planSaveSteps(input: {
  dirtyNodes: [string, CaseFlowchartNodeDraft][];
  serverNodesById: Map<string, ServerNodeSnapshot>;
  dirtyPositionNodeIds: string[];
  dirtyEdges: [string, CaseFlowchartEdgeDraft][];
  serverEdgesById: Map<string, ServerEdgeSnapshot>;
  dirtyRouteEdgeIds: string[];
}): SaveStep[] {
  const steps: SaveStep[] = [];
  for (const [nodeId, draft] of input.dirtyNodes) {
    const server = input.serverNodesById.get(nodeId);
    if (!server) continue;
    if (draft.title !== server.title || draft.description !== (server.description ?? "")) steps.push({ kind: "NODE_FIELDS", nodeId });
    if (draft.nodeType !== server.nodeType) steps.push({ kind: "NODE_TYPE", nodeId });
  }
  if (input.dirtyPositionNodeIds.length > 0) {
    steps.push({ kind: "NODE_POSITIONS", nodeIds: [...input.dirtyPositionNodeIds] });
  }
  for (const [edgeId, draft] of input.dirtyEdges) {
    const server = input.serverEdgesById.get(edgeId);
    if (!server) continue;
    if (draft.branchType !== server.branchType || draft.branchLabel !== (server.branchLabel ?? "")) steps.push({ kind: "EDGE_FIELDS", edgeId });
    if (draft.fromNodeId !== server.fromNodeId || draft.toNodeId !== server.toNodeId) steps.push({ kind: "EDGE_RETARGET", edgeId });
  }
  for (const edgeId of input.dirtyRouteEdgeIds) {
    steps.push({ kind: "EDGE_ROUTE", edgeId });
  }
  return steps;
}

export type SaveStepResult = { ok: true; updatedAt: string } | { ok: false; message: string };

export type SaveSequenceOutcome = {
  succeededSteps: SaveStep[];
  failedAtStep: SaveStep | null;
  failureMessage: string | null;
  finalUpdatedAt: string;
};

/**
 * Runs `steps` strictly in order, feeding each successful step's returned
 * `updatedAt` into the next step's `expectedUpdatedAt` (never sends two
 * mutations concurrently against one stale token). Stops at the FIRST
 * failure — every step from that point on is left un-run, so its owning
 * draft stays pending for a retry. `finalUpdatedAt` is always the latest
 * token actually confirmed by the server, whether the sequence fully
 * succeeded or stopped partway.
 */
export async function runSaveSequence(steps: SaveStep[], initialUpdatedAt: string, executeStep: (step: SaveStep, expectedUpdatedAt: string) => Promise<SaveStepResult>): Promise<SaveSequenceOutcome> {
  let updatedAt = initialUpdatedAt;
  const succeededSteps: SaveStep[] = [];
  for (const step of steps) {
    const result = await executeStep(step, updatedAt);
    if (!result.ok) {
      return { succeededSteps, failedAtStep: step, failureMessage: result.message, finalUpdatedAt: updatedAt };
    }
    updatedAt = result.updatedAt;
    succeededSteps.push(step);
  }
  return { succeededSteps, failedAtStep: null, failureMessage: null, finalUpdatedAt: updatedAt };
}

/** A node's PROPERTY draft (title/description/type) counts as fully flushed only when EVERY step planned for it (fields and/or type) succeeded — a node with a succeeded fields-update but a failed type-change must stay pending (its recomputed dirty state naturally narrows to just the type field on retry). Position is tracked separately — see `succeededPositionNodeIds`. */
export function fullySucceededNodeIds(plannedSteps: SaveStep[], succeededSteps: SaveStep[]): string[] {
  return fullySucceededIds(plannedSteps, succeededSteps, ["NODE_FIELDS", "NODE_TYPE"], (s) => (s as { nodeId: string }).nodeId);
}

/** Same rule as `fullySucceededNodeIds`, for EDGE_FIELDS/EDGE_RETARGET. */
export function fullySucceededEdgeIds(plannedSteps: SaveStep[], succeededSteps: SaveStep[]): string[] {
  return fullySucceededIds(plannedSteps, succeededSteps, ["EDGE_FIELDS", "EDGE_RETARGET"], (s) => (s as { edgeId: string }).edgeId);
}

export function succeededRouteEdgeIds(succeededSteps: SaveStep[]): string[] {
  return succeededSteps.filter((s): s is Extract<SaveStep, { kind: "EDGE_ROUTE" }> => s.kind === "EDGE_ROUTE").map((s) => s.edgeId);
}

/** The single NODE_POSITIONS step is one batched mutation call — it either fully succeeds (every listed node's position persisted) or never completes (the step failed or never ran), so there is no partial-per-node case to reconcile here, unlike node property drafts. */
export function succeededPositionNodeIds(succeededSteps: SaveStep[]): string[] {
  const step = succeededSteps.find((s): s is Extract<SaveStep, { kind: "NODE_POSITIONS" }> => s.kind === "NODE_POSITIONS");
  return step ? step.nodeIds : [];
}

function fullySucceededIds(plannedSteps: SaveStep[], succeededSteps: SaveStep[], kinds: SaveStep["kind"][], idOf: (step: SaveStep) => string): string[] {
  const plannedCount = new Map<string, number>();
  for (const s of plannedSteps) {
    if (!kinds.includes(s.kind)) continue;
    const id = idOf(s);
    plannedCount.set(id, (plannedCount.get(id) ?? 0) + 1);
  }
  const succeededCount = new Map<string, number>();
  for (const s of succeededSteps) {
    if (!kinds.includes(s.kind)) continue;
    const id = idOf(s);
    succeededCount.set(id, (succeededCount.get(id) ?? 0) + 1);
  }
  return [...plannedCount.entries()].filter(([id, count]) => succeededCount.get(id) === count).map(([id]) => id);
}
