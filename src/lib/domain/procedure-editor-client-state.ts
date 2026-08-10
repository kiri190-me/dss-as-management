import type { ProcedureBranchType, ProcedureNodeType } from "./procedure-template-types";
import { routePointsEqual, type RoutePoint } from "@/lib/graph-editor-core/routing";

/**
 * Phase 4A — pure client-side editor state helpers. Nothing here touches
 * the DB or React; the editor UI (ProcedureTemplateEditorScreen) is the
 * only caller, and owns turning these into actual component state. Kept
 * separate from procedure-template-diff.ts (which compares two already-
 * *persisted* versions) — this module is about the gap between "last
 * saved" and "currently being edited in the browser, not yet saved."
 */

export type EditableNodeFields = {
  title: string;
  description: string | null;
  instructions: string | null;
  sortOrder: number;
  isActive: boolean;
  nodeType: ProcedureNodeType;
};

export type EditableEdgeFields = {
  fromNodeId: string;
  toNodeId: string;
  branchType: ProcedureBranchType;
  branchLabel: string | null;
};

const NODE_FIELD_KEYS = ["title", "description", "instructions", "sortOrder", "isActive", "nodeType"] as const;
const EDGE_FIELD_KEYS = ["fromNodeId", "toNodeId", "branchType", "branchLabel"] as const;

function shallowFieldsEqual<T extends object>(a: T, b: T, keys: readonly (keyof T)[]): boolean {
  return keys.every((k) => a[k] === b[k]);
}

/** Which node ids currently differ from their last-saved snapshot — property edits only, not position (see hasUnsavedLayoutMoves below, tracked separately since it saves through a different action). */
export function computeUnsavedNodeIds(saved: Map<string, EditableNodeFields>, working: Map<string, EditableNodeFields>): Set<string> {
  const unsaved = new Set<string>();
  for (const [id, workingFields] of working) {
    const savedFields = saved.get(id);
    if (!savedFields || !shallowFieldsEqual(savedFields, workingFields, NODE_FIELD_KEYS)) unsaved.add(id);
  }
  return unsaved;
}

export function computeUnsavedEdgeIds(saved: Map<string, EditableEdgeFields>, working: Map<string, EditableEdgeFields>): Set<string> {
  const unsaved = new Set<string>();
  for (const [id, workingFields] of working) {
    const savedFields = saved.get(id);
    if (!savedFields || !shallowFieldsEqual(savedFields, workingFields, EDGE_FIELD_KEYS)) unsaved.add(id);
  }
  return unsaved;
}

/** A node's position (in 사용자 배치) differs from what's currently persisted in user_position_x/y (or, if never overridden, from position_x/y) — drag movement only becomes "unsaved" the moment it actually moves, not merely by entering edit mode. */
export function computeUnsavedLayoutNodeIds(saved: Map<string, { x: number; y: number }>, working: Map<string, { x: number; y: number }>): Set<string> {
  const unsaved = new Set<string>();
  for (const [id, pos] of working) {
    const savedPos = saved.get(id);
    if (!savedPos || savedPos.x !== pos.x || savedPos.y !== pos.y) unsaved.add(id);
  }
  return unsaved;
}

/**
 * Phase 4B — which edge ids currently have a manual-route override that
 * differs from what's last saved. Structurally identical to
 * computeUnsavedLayoutNodeIds (a Map-diff against a "saved" baseline), just
 * comparing an ordered point array instead of an x/y pair — reuses
 * routePointsEqual so this can never disagree with the mutation layer's
 * own no-op detection about what counts as "actually changed." A pure
 * selection/zoom/pan (which never touches this map at all) can never mark
 * anything dirty — only an actual add/move/remove/reset does.
 */
export function computeUnsavedEdgeRouteIds(saved: Map<string, RoutePoint[] | null>, working: Map<string, RoutePoint[] | null>): Set<string> {
  const unsaved = new Set<string>();
  for (const [id, points] of working) {
    const savedPoints = saved.get(id) ?? null;
    if (!routePointsEqual(savedPoints, points)) unsaved.add(id);
  }
  return unsaved;
}

export type EditorSaveState = "SAVED" | "UNSAVED" | "SAVING" | "SAVE_FAILED";

/** Single source of truth for the toolbar's saved/unsaved/saving/failed indicator — never infers this from scattered ad-hoc booleans. */
export function computeEditorSaveState(params: {
  isSaving: boolean;
  lastSaveFailed: boolean;
  unsavedNodeIds: Set<string>;
  unsavedEdgeIds: Set<string>;
  unsavedLayoutNodeIds: Set<string>;
  unsavedEdgeRouteIds: Set<string>;
}): EditorSaveState {
  if (params.isSaving) return "SAVING";
  if (params.lastSaveFailed) return "SAVE_FAILED";
  if (params.unsavedNodeIds.size > 0 || params.unsavedEdgeIds.size > 0 || params.unsavedLayoutNodeIds.size > 0 || params.unsavedEdgeRouteIds.size > 0) return "UNSAVED";
  return "SAVED";
}

// ---- edge retarget / create preview ----

export type EdgeEndpointPreview = { nodeId: string; title: string; nodeCode: string };
export type EdgeRoutePreview = { from: EdgeEndpointPreview; to: EdgeEndpointPreview; branchType: ProcedureBranchType; branchLabel: string | null };

export type NodeLookup = { id: string; title: string; nodeCode: string };

function lookupEndpoint(nodeId: string, nodesById: Map<string, NodeLookup>): EdgeEndpointPreview {
  const node = nodesById.get(nodeId);
  return { nodeId, title: node?.title ?? "(알 수 없는 노드)", nodeCode: node?.nodeCode ?? nodeId };
}

/**
 * Builds the "current edge" vs "proposed edge" preview pair a retarget
 * confirmation dialog shows before any mutation is called — this task's
 * explicit requirement that retargeting "must never silently replace an
 * edge." Never mutates anything itself; purely a display-data builder.
 */
export function buildEdgeRetargetPreview(
  current: { fromNodeId: string; toNodeId: string; branchType: ProcedureBranchType; branchLabel: string | null },
  proposed: { fromNodeId: string; toNodeId: string },
  nodesById: Map<string, NodeLookup>
): { current: EdgeRoutePreview; proposed: EdgeRoutePreview } {
  return {
    current: {
      from: lookupEndpoint(current.fromNodeId, nodesById),
      to: lookupEndpoint(current.toNodeId, nodesById),
      branchType: current.branchType,
      branchLabel: current.branchLabel,
    },
    proposed: {
      from: lookupEndpoint(proposed.fromNodeId, nodesById),
      to: lookupEndpoint(proposed.toNodeId, nodesById),
      branchType: current.branchType,
      branchLabel: current.branchLabel,
    },
  };
}

/** Same preview shape for a brand-new connection (no "current" side) — used by the create-connection confirmation dialog. */
export function buildNewEdgePreview(
  input: { fromNodeId: string; toNodeId: string; branchType: ProcedureBranchType; branchLabel: string | null },
  nodesById: Map<string, NodeLookup>
): EdgeRoutePreview {
  return {
    from: lookupEndpoint(input.fromNodeId, nodesById),
    to: lookupEndpoint(input.toNodeId, nodesById),
    branchType: input.branchType,
    branchLabel: input.branchLabel,
  };
}
