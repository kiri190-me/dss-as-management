import type { ProcedureBranchType, ProcedureNodeType } from "./procedure-template-types";
import { EDGE_VISUAL_CONFIG } from "./procedure-visual-language";

/**
 * Phase 3B revision (Problem 1) — presentation-only edge routing for the
 * "단계별 정렬 (컴팩트)" layout. The compact layout already spaces nodes
 * deterministically (see computeStageSortedLayout); this module decides,
 * for each edge, *which side of the node it leaves/enters from* and *how
 * far it has to travel outside the ordinary row flow* — so a same-row
 * hand-off, a decision branch, a LOOP_BACK, and a cross-worksheet jump each
 * read as visually distinct instead of every edge rendering as the same
 * overlapping curve. Pure functions only: no DOM, no React, no xyflow
 * types — ProcedureFlowGraph.tsx is the only caller and owns turning this
 * into actual <Handle>/<Edge> props.
 *
 * Never touches stored position_x/position_y — this only decides how an
 * already-computed layout's edges are drawn.
 */

export type EdgeRouteKind = "loopback" | "decision-branch" | "cross-worksheet" | "same-row" | "next-row";

/** The node-side <Handle id="..."> pair an edge should attach to — see the matching handle ids rendered on ProcedureNode in ProcedureFlowGraph.tsx. */
export type HandleIds = { sourceHandle: string; targetHandle: string };

export type EdgeRouteAssignment = HandleIds & { kind: EdgeRouteKind };

export type RoutableEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  branchType: ProcedureBranchType;
};

export type RoutableNode = {
  id: string;
  nodeType: ProcedureNodeType;
  sourceWorksheet: string | null;
  /** row index within its own worksheet band, as packed by computeStageSortedLayout — same row number means two nodes sit on the same visual row. */
  rowIndex: number;
};

/**
 * Deterministic decision-branch handle assignment (Problem 1, part C):
 * YES/NORMAL/DEFAULT always leave from the same side (right), NO/NG always
 * leave from the other side (left), RETRY/LOOP_BACK always use the
 * dedicated loop-out direction — never a per-instance/random choice, so a
 * reviewer learns the convention once and it holds for every DECISION node
 * in the graph.
 */
export function decisionBranchSourceHandle(branchType: ProcedureBranchType): "right-out" | "left-out" | "loop-out" {
  if (branchType === "RETRY" || branchType === "LOOP_BACK") return "loop-out";
  if (branchType === "NO" || branchType === "NG") return "left-out";
  return "right-out";
}

/**
 * Classifies one edge and assigns its source/target handle ids. Priority
 * order (an edge can only be one kind, but could plausibly qualify for
 * more than one — e.g. a LOOP_BACK that also crosses worksheets, which is
 * exactly what both real RFG LOOP_BACK edges do):
 *   1. loopback — RETRY/LOOP_BACK always routes around the outside,
 *      regardless of whether it also happens to change worksheet;
 *   2. decision-branch — the source is a DECISION node with more than one
 *      outgoing edge, so which side it leaves from is meaningful;
 *   3. cross-worksheet — different worksheets, neither of the above;
 *   4. same-row — same worksheet band, same packed row;
 *   5. next-row — the ordinary sequential fallback.
 */
export function classifyAndAssignEdgeRoute(
  edge: RoutableEdge,
  fromNode: RoutableNode,
  toNode: RoutableNode,
  fromNodeOutgoingCount: number
): EdgeRouteAssignment {
  const isLoopback = EDGE_VISUAL_CONFIG[edge.branchType]?.routeStyle === "loopback-curve";
  if (isLoopback) {
    return { kind: "loopback", sourceHandle: "loop-out", targetHandle: "loop-in" };
  }

  if (fromNode.nodeType === "DECISION" && fromNodeOutgoingCount > 1) {
    return { kind: "decision-branch", sourceHandle: decisionBranchSourceHandle(edge.branchType), targetHandle: "top-in" };
  }

  if (fromNode.sourceWorksheet !== toNode.sourceWorksheet) {
    return { kind: "cross-worksheet", sourceHandle: "cross-out", targetHandle: "cross-in" };
  }

  if (fromNode.rowIndex === toNode.rowIndex) {
    return { kind: "same-row", sourceHandle: "right-out", targetHandle: "left-in" };
  }

  return { kind: "next-row", sourceHandle: "bottom-out", targetHandle: "top-in" };
}

export type Point = { x: number; y: number };

/**
 * Deterministic interval-partitioning lane assignment (Problem 1, part D)
 * for the long-distance edges (loopback + cross-worksheet) that need an
 * outer routing lane — the same greedy algorithm used for meeting-room
 * scheduling. Edges are sorted by their vertical span's start so the
 * assignment never depends on input order, and each edge reuses the
 * lowest-numbered lane whose previous occupant's span has already ended,
 * so parallel long edges bundle into as few shared lanes as their spans
 * allow instead of each claiming its own.
 */
export function assignEdgeLanes(edges: { id: string; fromY: number; toY: number }[]): Map<string, number> {
  const laneAssignment = new Map<string, number>();
  const laneLastEnd: number[] = [];

  const normalized = edges.map((e) => ({ id: e.id, top: Math.min(e.fromY, e.toY), bottom: Math.max(e.fromY, e.toY) }));
  const ordered = [...normalized].sort((a, b) => a.top - b.top || a.id.localeCompare(b.id));

  for (const e of ordered) {
    let assignedLane = -1;
    for (let lane = 0; lane < laneLastEnd.length; lane++) {
      if (laneLastEnd[lane] < e.top) {
        assignedLane = lane;
        break;
      }
    }
    if (assignedLane === -1) {
      assignedLane = laneLastEnd.length;
      laneLastEnd.push(e.bottom);
    } else {
      laneLastEnd[assignedLane] = e.bottom;
    }
    laneAssignment.set(e.id, assignedLane);
  }

  return laneAssignment;
}

/**
 * Builds a 4-segment outer-lane SVG path: out from the source handle to a
 * shared vertical lane strictly outside every node's horizontal extent
 * (laneX), down/up the lane, then into the target handle. Used for both
 * LOOP_BACK/RETRY and cross-worksheet edges (Problem 1, parts A and D) —
 * as long as laneX sits to the right of every node the edge would
 * otherwise cross, the path never passes through an unrelated node's box,
 * which is the concrete, testable form of "route around the outside" /
 * "do not pass through unrelated nodes".
 */
export function buildOuterLanePath(source: Point, target: Point, laneX: number): { path: string; labelPosition: Point } {
  const path = `M ${source.x} ${source.y} L ${laneX} ${source.y} L ${laneX} ${target.y} L ${target.x} ${target.y}`;
  // Midpoint of the vertical lane segment — always readable next to the
  // lane itself, never overlapping either endpoint node.
  const labelPosition = { x: laneX, y: (source.y + target.y) / 2 };
  return { path, labelPosition };
}

// ---- Problem 1, part B — graph-wide visibility modes ----

export const GRAPH_VISIBILITY_MODES = ["ALL", "SELECTED_FLOW", "STAGE_INTERNAL", "ERROR_RELATED"] as const;
export type GraphVisibilityMode = (typeof GRAPH_VISIBILITY_MODES)[number];

export const GRAPH_VISIBILITY_MODE_LABELS: Record<GraphVisibilityMode, string> = {
  ALL: "전체 연결",
  SELECTED_FLOW: "선택 흐름만",
  STAGE_INTERNAL: "단계 내부 연결",
  ERROR_RELATED: "오류 관련 연결",
};

export type EdgeVisibilityContext = {
  hasSelection: boolean;
  isConnectedToSelected: boolean;
  isCrossWorksheet: boolean;
  isLoopback: boolean;
  isDecisionBranch: boolean;
  /** either endpoint node carries an unresolved ERROR/WARNING validation issue badge */
  hasOpenIssueOnEndpoint: boolean;
};

export type EdgeVisibilityResult = { opacity: number; hidden: boolean };

/**
 * Presentation-only edge visibility (Problem 1, part B) — never removes
 * data, only how densely it's drawn at once. "hidden" edges are omitted
 * from rendering entirely (not just faded), which is what lets
 * SELECTED_FLOW/STAGE_INTERNAL/ERROR_RELATED cut through hundreds of
 * DEFAULT edges instead of merely dimming them; ALL mode never hides
 * anything, only varies opacity, so switching back to it always recovers
 * every connection.
 */
export function computeEdgeVisibility(mode: GraphVisibilityMode, ctx: EdgeVisibilityContext): EdgeVisibilityResult {
  // A LOOP_BACK/RETRY edge touching the selected node stays fully visible
  // in every mode — "keep LOOP_BACK edges visible if they involve the
  // selected node" is a hard requirement, not just an ALL-mode default.
  if (ctx.hasSelection && ctx.isConnectedToSelected && ctx.isLoopback) {
    return { opacity: 1, hidden: false };
  }

  if (ctx.hasSelection) {
    if (ctx.isConnectedToSelected) return { opacity: 1, hidden: false };
    if (mode === "SELECTED_FLOW") return { opacity: 0, hidden: true };
    // Selecting a node dims unrelated edges "much more strongly" than the
    // mode's own no-selection baseline, in every other mode.
    return { opacity: 0.08, hidden: false };
  }

  switch (mode) {
    case "SELECTED_FLOW":
      // Nothing selected yet — there is no "selected flow" to show.
      return { opacity: 0, hidden: true };
    case "STAGE_INTERNAL":
      if (ctx.isCrossWorksheet) return { opacity: 0, hidden: true };
      return { opacity: ctx.isDecisionBranch || ctx.hasOpenIssueOnEndpoint ? 0.9 : 0.5, hidden: false };
    case "ERROR_RELATED":
      if (!ctx.hasOpenIssueOnEndpoint) return { opacity: 0, hidden: true };
      return { opacity: 1, hidden: false };
    case "ALL":
    default:
      if (ctx.isDecisionBranch || ctx.hasOpenIssueOnEndpoint || ctx.isLoopback) return { opacity: 0.9, hidden: false };
      if (ctx.isCrossWorksheet) return { opacity: 0.25, hidden: false };
      return { opacity: 0.45, hidden: false };
  }
}
