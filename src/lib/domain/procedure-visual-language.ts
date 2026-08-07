import type { ProcedureBranchType, ProcedureNodeType } from "./procedure-template-types";

/**
 * Phase 3B — the single shared, deterministic visual language for every
 * screen that shows a procedure node or edge (the read-only graph, the
 * validation-resolution screens, and eventually the workflow editor and
 * Repair Case execution screen). Everything here is derived purely from
 * data already stored (`procedure_template_nodes.node_type`,
 * `procedure_template_edges.branch_type`) — nothing here is user-chosen,
 * and the same semantic type always produces the same shape/color/icon.
 *
 * No schema change backs this: the mapping from the existing 9-value
 * `procedure_template_node_type` enum to these 9 semantic visual types is
 * fully deterministic (a fixed lookup, never per-instance judgment), so a
 * pure function is sufficient — see getSemanticNodeVisualType below.
 */

export const SEMANTIC_NODE_VISUAL_TYPES = [
  "START",
  "END",
  "TASK",
  "DECISION",
  "CHECKLIST",
  "TROUBLESHOOTING",
  "REFERENCE",
  "HOLD_OR_REVIEW",
  "SUBPROCESS_OR_STAGE",
] as const;
export type SemanticNodeVisualType = (typeof SEMANTIC_NODE_VISUAL_TYPES)[number];

/**
 * Deterministic lookup — every one of the 9 stored ProcedureNodeType
 * values maps to exactly one semantic visual type. INSPECTION and
 * CORRECTIVE_ACTION share TASK's shape/color family (they are both
 * "ordinary work steps" at the visual-language level) but get a distinct
 * icon via getNodeIconKey below, so they stay individually recognizable
 * without inventing new top-level shapes beyond the 9 required here.
 * HOLD_OR_REVIEW and SUBPROCESS_OR_STAGE have no current stored
 * ProcedureNodeType mapping to them by design — see the module doc for
 * where each is actually used today.
 */
const NODE_TYPE_TO_SEMANTIC_VISUAL: Record<ProcedureNodeType, SemanticNodeVisualType> = {
  START: "START",
  END: "END",
  TASK: "TASK",
  INSPECTION: "TASK",
  CORRECTIVE_ACTION: "TASK",
  DECISION: "DECISION",
  CHECKLIST: "CHECKLIST",
  TROUBLESHOOTING: "TROUBLESHOOTING",
  DOCUMENT_REFERENCE: "REFERENCE",
};

export function getSemanticNodeVisualType(nodeType: ProcedureNodeType): SemanticNodeVisualType {
  return NODE_TYPE_TO_SEMANTIC_VISUAL[nodeType];
}

export type NodeShapeKind = "capsule" | "rect" | "diamond" | "double-border-rect" | "document" | "pentagon-warning";

export type IconKey =
  | "start"
  | "end"
  | "task"
  | "inspection"
  | "wrench"
  | "decision"
  | "checklist"
  | "troubleshooting"
  | "document"
  | "hold";

export type NodeVisualConfig = {
  shape: NodeShapeKind;
  bgLight: string;
  bgDark: string;
  borderLight: string;
  borderDark: string;
  textLight: string;
  textDark: string;
  label: string;
  iconKey: IconKey;
};

export const NODE_VISUAL_CONFIG: Record<SemanticNodeVisualType, NodeVisualConfig> = {
  START: {
    shape: "capsule",
    bgLight: "#ECFDF5",
    bgDark: "#052e1f",
    borderLight: "#0D9488",
    borderDark: "#2dd4bf",
    textLight: "#065F46",
    textDark: "#6ee7b7",
    label: "시작",
    iconKey: "start",
  },
  END: {
    shape: "capsule",
    bgLight: "#F4F4F5",
    bgDark: "#27272a",
    borderLight: "#16A34A",
    borderDark: "#4ade80",
    textLight: "#166534",
    textDark: "#86efac",
    label: "완료",
    iconKey: "end",
  },
  TASK: {
    shape: "rect",
    bgLight: "#FAFAFA",
    bgDark: "#18181b",
    borderLight: "#475569",
    borderDark: "#94a3b8",
    textLight: "#27272A",
    textDark: "#e4e4e7",
    label: "작업",
    iconKey: "task",
  },
  DECISION: {
    shape: "diamond",
    bgLight: "#FFFBEB",
    bgDark: "#451a03",
    borderLight: "#D97706",
    borderDark: "#f59e0b",
    textLight: "#92400E",
    textDark: "#fcd34d",
    label: "판단",
    iconKey: "decision",
  },
  CHECKLIST: {
    shape: "double-border-rect",
    bgLight: "#EEF2FF",
    bgDark: "#1e1b4b",
    borderLight: "#4F46E5",
    borderDark: "#818cf8",
    textLight: "#3730A3",
    textDark: "#c7d2fe",
    label: "체크리스트",
    iconKey: "checklist",
  },
  TROUBLESHOOTING: {
    shape: "double-border-rect",
    bgLight: "#F5F3FF",
    bgDark: "#2e1065",
    borderLight: "#7C3AED",
    borderDark: "#a78bfa",
    textLight: "#5B21B6",
    textDark: "#ddd6fe",
    label: "트러블슈팅",
    iconKey: "troubleshooting",
  },
  REFERENCE: {
    shape: "document",
    bgLight: "#F8FAFC",
    bgDark: "#0f172a",
    borderLight: "#0E7490",
    borderDark: "#22d3ee",
    textLight: "#155E75",
    textDark: "#a5f3fc",
    label: "참조",
    iconKey: "document",
  },
  HOLD_OR_REVIEW: {
    shape: "pentagon-warning",
    bgLight: "#FFF7ED",
    bgDark: "#431407",
    borderLight: "#EA580C",
    borderDark: "#fb923c",
    textLight: "#9A3412",
    textDark: "#fed7aa",
    label: "보류/검토",
    iconKey: "hold",
  },
  SUBPROCESS_OR_STAGE: {
    shape: "rect",
    bgLight: "#F1F5F9",
    bgDark: "#1e293b",
    borderLight: "#334155",
    borderDark: "#64748b",
    textLight: "#0F172A",
    textDark: "#e2e8f0",
    label: "단계",
    iconKey: "task",
  },
};

/**
 * Single source of truth for node-outline pixel widths — consumed via
 * inline `style` in ProcedureNodeChip (Tailwind arbitrary-value classes
 * can't read a JS constant at build time, so anything that must vary by
 * this exact number goes through `style`, not a className string).
 */
export const NODE_BORDER = {
  /** single-border shapes' border-width, and the inset used for the clip-path shapes' layered border (outer border-color fill minus this inset = inner bg-color fill) */
  NORMAL_WIDTH: 2,
  /** CHECKLIST/TROUBLESHOOTING's existing inner CSS border */
  DOUBLE_INNER_WIDTH: 1,
  /** background gap in the double-border box-shadow ring */
  DOUBLE_GAP: 2,
  /** outer ring thickness in the double-border box-shadow, beyond the gap */
  DOUBLE_OUTER_WIDTH: 2,
} as const;

/** Icon override for stored node types that share a semantic shape/color family but must stay individually recognizable (TASK vs INSPECTION vs CORRECTIVE_ACTION all render as the TASK rect). */
const NODE_TYPE_ICON_OVERRIDE: Partial<Record<ProcedureNodeType, IconKey>> = {
  INSPECTION: "inspection",
  CORRECTIVE_ACTION: "wrench",
};

export function getNodeIconKey(nodeType: ProcedureNodeType): IconKey {
  return NODE_TYPE_ICON_OVERRIDE[nodeType] ?? NODE_VISUAL_CONFIG[getSemanticNodeVisualType(nodeType)].iconKey;
}

/** Convenience for callers rendering a ProcedureNodeChip from a real stored ProcedureNodeType (the graph, validation screens) — bundles the two lookups every such call site needs. */
export function getNodeChipVisual(nodeType: ProcedureNodeType): { semanticType: SemanticNodeVisualType; iconKey: IconKey } {
  return { semanticType: getSemanticNodeVisualType(nodeType), iconKey: getNodeIconKey(nodeType) };
}

export type EdgeRouteStyle = "straight" | "smoothstep" | "loopback-curve";
export type EdgeMarkerShape = "arrow-closed" | "arrow-open";

export type EdgeVisualConfig = {
  strokeLight: string;
  strokeDark: string;
  /** SVG dasharray, e.g. "6 4" — undefined means a solid line. Never rely on color alone: every non-DEFAULT branch type has either a dash pattern, a distinct marker, or both. */
  dashPattern?: string;
  strokeWidth: number;
  animated: boolean;
  routeStyle: EdgeRouteStyle;
  /** shown when the stored branch_label is null */
  defaultLabel: string | null;
  markerShape: EdgeMarkerShape;
};

export const EDGE_VISUAL_CONFIG: Record<ProcedureBranchType, EdgeVisualConfig> = {
  DEFAULT: {
    strokeLight: "#A1A1AA",
    strokeDark: "#a1a1aa",
    strokeWidth: 1.25,
    animated: false,
    routeStyle: "smoothstep",
    defaultLabel: null,
    markerShape: "arrow-closed",
  },
  NORMAL: {
    strokeLight: "#10B981",
    strokeDark: "#34d399",
    strokeWidth: 1.75,
    animated: false,
    routeStyle: "smoothstep",
    defaultLabel: "정상",
    markerShape: "arrow-closed",
  },
  NG: {
    strokeLight: "#DC2626",
    strokeDark: "#f87171",
    dashPattern: "4 2",
    strokeWidth: 1.75,
    animated: false,
    routeStyle: "smoothstep",
    defaultLabel: "NG",
    markerShape: "arrow-closed",
  },
  YES: {
    strokeLight: "#2563EB",
    strokeDark: "#60a5fa",
    strokeWidth: 1.75,
    animated: false,
    routeStyle: "smoothstep",
    defaultLabel: "YES",
    markerShape: "arrow-closed",
  },
  NO: {
    strokeLight: "#71717A",
    strokeDark: "#d4d4d8",
    dashPattern: "2 3",
    strokeWidth: 1.75,
    animated: false,
    routeStyle: "smoothstep",
    defaultLabel: "NO",
    markerShape: "arrow-open",
  },
  RETRY: {
    strokeLight: "#EA580C",
    strokeDark: "#fb923c",
    dashPattern: "6 3",
    strokeWidth: 1.75,
    animated: false,
    routeStyle: "loopback-curve",
    defaultLabel: "재측정",
    markerShape: "arrow-closed",
  },
  LOOP_BACK: {
    strokeLight: "#7C3AED",
    strokeDark: "#a78bfa",
    dashPattern: "8 4",
    strokeWidth: 2,
    animated: true,
    routeStyle: "loopback-curve",
    defaultLabel: "재진행",
    markerShape: "arrow-closed",
  },
  CUSTOM: {
    strokeLight: "#0EA5E9",
    strokeDark: "#38bdf8",
    strokeWidth: 1.5,
    animated: false,
    routeStyle: "smoothstep",
    defaultLabel: null,
    markerShape: "arrow-closed",
  },
};

// ---- Phase 3B revision: shared spacing/sizing config + layout ----
//
// Centralizing every spacing/sizing number here (rather than scattering
// hardcoded pixel values through ProcedureFlowGraph.tsx and
// ProcedureNodeChip.tsx) is what lets the "단계별 정렬" layout, the node
// chip's own rendered size, and future editor/execution screens all agree
// on the same numbers instead of drifting apart.

export const GRAPH_SPACING = {
  /** horizontal gap between adjacent nodes packed into the same row */
  NODE_H_GAP: 20,
  /** vertical gap between rows within one worksheet band (replaces the old fixed 130px row pitch) */
  NODE_V_GAP: 22,
  /** once a row's accumulated node width would exceed this, wrap to a new row — replaces a fixed N-column grid so short titles pack densely and long ones don't force extra-wide columns on every node */
  ROW_MAX_WIDTH: 1400,
  /** vertical gap between one worksheet band and the next (replaces the old fixed 150px margin) */
  BAND_GAP: 56,
  /** gap from a stage header down to its first row of nodes */
  HEADER_GAP: 32,
  /** extra horizontal gap appended after a DECISION node, multiplied by (outgoing branch count - 1) so nodes with more branches get proportionally more room for their edge labels */
  DECISION_BRANCH_GAP: 16,
  /** extra vertical gap appended below a row containing a LOOP_BACK/RETRY endpoint, giving the curved route room without crossing into the next row */
  LOOPBACK_ROW_EXTRA_GAP: 36,
} as const;

/** icon row + type-label overhead sitting above the title's own wrapped lines */
const NODE_CHROME_HEIGHT = 37;
const NODE_TITLE_LINE_HEIGHT = 15;
const NODE_MAX_VISIBLE_TITLE_LINES = 4;

export const NODE_SIZE = {
  MIN_WIDTH: 132,
  MAX_WIDTH: 240,
  /** DECISION gets wider bounds than other shapes — the hexagon clip-path needs more raw width to keep a usable safe text zone (see ProcedureNodeChip's SHAPE_CLIP_PATH) */
  DECISION_MIN_WIDTH: 172,
  DECISION_MAX_WIDTH: 300,
  /** = CHROME_HEIGHT + one title line — derived, not independently tunable, so it can never drift out of sync with the line-wrapping formula below */
  MIN_HEIGHT: NODE_CHROME_HEIGHT + NODE_TITLE_LINE_HEIGHT,
  /** = CHROME_HEIGHT + MAX_VISIBLE_LINES title lines — same derivation guarantee as MIN_HEIGHT */
  MAX_HEIGHT: NODE_CHROME_HEIGHT + NODE_MAX_VISIBLE_TITLE_LINES * NODE_TITLE_LINE_HEIGHT,
  /** px per wrapped line at the graph chip's fixed 13px title font */
  LINE_HEIGHT: NODE_TITLE_LINE_HEIGHT,
  /** beyond this many wrapped lines, the title is clamped and the full text relies on the tooltip instead */
  MAX_VISIBLE_LINES: NODE_MAX_VISIBLE_TITLE_LINES,
  /** rough estimate of characters (mixed Korean/Latin/digits) per 100px of width at the chip's font size — sizes the box only, never used to actually cut text (CSS wrapping does that) */
  CHARS_PER_100PX: 13,
} as const;

export type NodeDimensions = {
  width: number;
  height: number;
  visibleLines: number;
  /** true only once estimated content exceeds MAX_VISIBLE_LINES — the chip then clamps and leans on its tooltip for the rest, per "extremely long text -> concise visible title plus full text in tooltip" */
  isTruncated: boolean;
};

/**
 * Deterministic, presentation-only sizing for a graph node chip — grows
 * with title length up to a shape-specific maximum width, then wraps
 * additional lines (growing height) up to MAX_VISIBLE_LINES before finally
 * clamping. The same numbers drive both the chip's own rendered size and
 * computeStageSortedLayout's row packing below, so layout and rendering can
 * never disagree about how much room a node needs.
 */
export function computeNodeDimensions(params: { title: string; shape: NodeShapeKind }): NodeDimensions {
  const title = params.title.trim();
  const len = title.length;
  const isDecision = params.shape === "diamond";
  const minWidth = isDecision ? NODE_SIZE.DECISION_MIN_WIDTH : NODE_SIZE.MIN_WIDTH;
  const maxWidth = isDecision ? NODE_SIZE.DECISION_MAX_WIDTH : NODE_SIZE.MAX_WIDTH;

  const targetWidth = minWidth + Math.min(len * 4.2, maxWidth - minWidth);
  const width = Math.round(Math.max(minWidth, Math.min(maxWidth, targetWidth)));

  const charsPerLine = Math.max(6, Math.round((width / 100) * NODE_SIZE.CHARS_PER_100PX));
  const estimatedLines = len === 0 ? 1 : Math.max(1, Math.ceil(len / charsPerLine));
  const visibleLines = Math.min(estimatedLines, NODE_SIZE.MAX_VISIBLE_LINES);
  const isTruncated = estimatedLines > NODE_SIZE.MAX_VISIBLE_LINES;

  const height = NODE_CHROME_HEIGHT + visibleLines * NODE_SIZE.LINE_HEIGHT;

  return { width, height, visibleLines, isTruncated };
}

/**
 * Extra horizontal breathing room a node's centered content stack needs
 * beyond the chip's ordinary padding, so a title never crowds a shape's
 * decorative clipped edges (this UI-stabilization pass's "keep enough
 * left/right padding for the angled edges" requirement). Only the diamond
 * (DECISION) shape clips inward on both sides at 10%/90% width — every
 * other shape either doesn't clip horizontally at all (capsule/rect/
 * double-border-rect) or only clips a small corner that sits outside the
 * centered content area already (document's folded corner, pentagon's
 * top point), so they keep the chip's normal padding.
 */
export function getNodeContentExtraHorizontalPadding(shape: NodeShapeKind): number {
  return shape === "diamond" ? 10 : 0;
}

/**
 * "For very compact nodes, the icon may be omitted before sacrificing
 * title readability" — isTruncated already means the title is at its
 * maximum allowed line count (MAX_VISIBLE_LINES) and still doesn't fully
 * fit, i.e. the box is as generous as this node's title will ever get.
 * Dropping the icon at that point trades a purely decorative element for
 * a little more of the box's vertical room going to the title instead.
 * Never applies to the compact (validation-screen pill) size, which has
 * no icon-vs-title space contention to begin with (single truncated
 * line).
 */
export function shouldShowNodeIcon(dims: NodeDimensions | null): boolean {
  if (!dims) return true;
  return !dims.isTruncated;
}

export type IssueBadgeSeverity = "ERROR" | "WARNING";

export type NodeIssueBadge = { severity: IssueBadgeSeverity; issueId: string };

/**
 * Never rely on color alone (task requirement): ERROR and WARNING differ in
 * outline style (solid vs. dashed) in addition to color, and both carry a
 * distinct aria-label for screen readers / tooltips.
 */
export const ISSUE_BADGE_STYLES: Record<IssueBadgeSeverity, { badgeBgClass: string; outlineClass: string; label: string }> = {
  ERROR: {
    badgeBgClass: "bg-red-600",
    outlineClass: "outline outline-[3px] outline-offset-2 outline-red-600 dark:outline-red-500",
    label: "미해결 오류",
  },
  WARNING: {
    badgeBgClass: "bg-amber-500",
    outlineClass: "outline outline-2 outline-dashed outline-offset-1 outline-amber-500 dark:outline-amber-400",
    label: "미해결 경고",
  },
};

export type StageSortedLayoutNode = {
  id: string;
  title: string;
  nodeType: ProcedureNodeType;
  sortOrder: number;
  sourceWorksheet: string | null;
};

export type StageSortedLayoutEdge = { fromNodeId: string; toNodeId: string; branchType: ProcedureBranchType };

export type StageSortedLayoutResult = {
  positions: Map<string, { x: number; y: number }>;
  headerPositions: Map<string, { x: number; y: number }>;
  /** Problem 1 revision — 0-based row index within the node's own worksheet band (resets per worksheet), the input procedure-edge-routing.ts needs to tell a same-row hand-off from an ordinary next-row one. */
  rowIndexByNodeId: Map<string, number>;
  /** Problem 1 revision — the rightmost x any node/header reaches across the whole layout, plus its width. The shared outer routing lane for LOOP_BACK/RETRY and cross-worksheet edges starts just past this, so it can never overlap a node regardless of which bands it spans. */
  canvasMaxX: number;
};

/**
 * Compact, deterministic row-packing layout for the "단계별 정렬"
 * presentation mode — replaces a fixed N-column grid (which forced every
 * node into one oversized cell regardless of content and produced a very
 * tall, sparse canvas at 400+ nodes) with rows that pack as many nodes as
 * fit within ROW_MAX_WIDTH, each sized via computeNodeDimensions. DECISION
 * nodes get extra trailing gap proportional to their outgoing branch count;
 * rows touching a LOOP_BACK/RETRY endpoint get extra vertical clearance.
 * Never persisted, never reads or writes stored position_x/position_y.
 */
export function computeStageSortedLayout(
  nodes: StageSortedLayoutNode[],
  edges: StageSortedLayoutEdge[],
  orderedWorksheets: string[]
): StageSortedLayoutResult {
  const positions = new Map<string, { x: number; y: number }>();
  const headerPositions = new Map<string, { x: number; y: number }>();
  const rowIndexByNodeId = new Map<string, number>();
  let canvasMaxX = 0;

  const outgoingCountByNode = new Map<string, number>();
  const loopBackEndpointIds = new Set<string>();
  for (const e of edges) {
    outgoingCountByNode.set(e.fromNodeId, (outgoingCountByNode.get(e.fromNodeId) ?? 0) + 1);
    if (EDGE_VISUAL_CONFIG[e.branchType]?.routeStyle === "loopback-curve") {
      loopBackEndpointIds.add(e.fromNodeId);
      loopBackEndpointIds.add(e.toNodeId);
    }
  }

  let cursorY = 0;
  for (const ws of orderedWorksheets) {
    const wsNodes = nodes.filter((n) => n.sourceWorksheet === ws).sort((a, b) => a.sortOrder - b.sortOrder);
    if (wsNodes.length === 0) continue;

    headerPositions.set(ws, { x: 0, y: cursorY });
    // The header itself has real height (same adaptive sizing as any other
    // node) — without accounting for it here, a long worksheet name would
    // render a header tall enough to visually overlap the first row.
    const headerDims = computeNodeDimensions({ title: ws, shape: NODE_VISUAL_CONFIG.SUBPROCESS_OR_STAGE.shape });
    canvasMaxX = Math.max(canvasMaxX, headerDims.width);
    let rowY = cursorY + headerDims.height + GRAPH_SPACING.HEADER_GAP;
    let x = 0;
    let rowMaxHeight = 0;
    let rowHasLoopBack = false;
    let rowIndex = 0;

    for (const n of wsNodes) {
      const { shape } = NODE_VISUAL_CONFIG[getSemanticNodeVisualType(n.nodeType)];
      const dims = computeNodeDimensions({ title: n.title, shape });

      if (x > 0 && x + dims.width > GRAPH_SPACING.ROW_MAX_WIDTH) {
        rowY += rowMaxHeight + GRAPH_SPACING.NODE_V_GAP + (rowHasLoopBack ? GRAPH_SPACING.LOOPBACK_ROW_EXTRA_GAP : 0);
        x = 0;
        rowMaxHeight = 0;
        rowHasLoopBack = false;
        rowIndex += 1;
      }

      positions.set(n.id, { x, y: rowY });
      rowIndexByNodeId.set(n.id, rowIndex);

      let advance = dims.width + GRAPH_SPACING.NODE_H_GAP;
      if (shape === "diamond") {
        const branches = outgoingCountByNode.get(n.id) ?? 0;
        advance += GRAPH_SPACING.DECISION_BRANCH_GAP * Math.max(0, branches - 1);
      }
      x += advance;
      canvasMaxX = Math.max(canvasMaxX, x - GRAPH_SPACING.NODE_H_GAP);
      rowMaxHeight = Math.max(rowMaxHeight, dims.height);
      if (loopBackEndpointIds.has(n.id)) rowHasLoopBack = true;
    }

    const bandHeight = rowY + rowMaxHeight - cursorY;
    cursorY += bandHeight + GRAPH_SPACING.BAND_GAP;
  }

  return { positions, headerPositions, rowIndexByNodeId, canvasMaxX };
}

// ---- pure, unit-testable interaction helpers (no DOM/React dependency) ----

export type MinimalEdge = { id: string; source: string; target: string };

/** 1-hop incoming+outgoing node/edge ids for the selected node — the basis for path highlighting and dimming everything else. Returns empty sets when nothing is selected. */
export function computeConnectedIds(
  selectedNodeId: string | null,
  edges: MinimalEdge[]
): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  if (!selectedNodeId) return { nodeIds, edgeIds };
  nodeIds.add(selectedNodeId);
  for (const e of edges) {
    if (e.source === selectedNodeId) {
      nodeIds.add(e.target);
      edgeIds.add(e.id);
    }
    if (e.target === selectedNodeId) {
      nodeIds.add(e.source);
      edgeIds.add(e.id);
    }
  }
  return { nodeIds, edgeIds };
}

export type SearchableNode = {
  id: string;
  title: string;
  nodeCode: string;
  sourceShapeId: string | null;
};

/** Matches by title, node code, or source shape id — case-insensitive substring match, deterministic ordering (input order preserved). */
export function searchNodes<T extends SearchableNode>(nodes: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return nodes.filter(
    (n) =>
      n.title.toLowerCase().includes(q) ||
      n.nodeCode.toLowerCase().includes(q) ||
      (n.sourceShapeId ?? "").toLowerCase().includes(q)
  );
}

export type WorksheetBand<T> = {
  worksheet: string;
  nodes: T[];
  yOffset: number;
  minY: number;
  maxY: number;
};

/**
 * Stacks each worksheet's nodes into its own non-overlapping vertical band
 * — promoted from the inline logic Phase 2.5 added to ProcedureFlowGraph.tsx
 * (different sheets' shapes reuse overlapping source coordinates once
 * combined into one template) so it's shared and independently testable.
 * Presentation-only: callers add `yOffset` to a node's stored `positionY`
 * for rendering; the stored value itself is never touched.
 */
export function groupNodesByWorksheet<T extends { sourceWorksheet: string | null; positionY: number }>(
  nodes: T[],
  margin: number = GRAPH_SPACING.BAND_GAP
): { orderedWorksheets: string[]; bands: Map<string, WorksheetBand<T>> } {
  const orderedWorksheets: string[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    if (n.sourceWorksheet && !seen.has(n.sourceWorksheet)) {
      seen.add(n.sourceWorksheet);
      orderedWorksheets.push(n.sourceWorksheet);
    }
  }

  const bands = new Map<string, WorksheetBand<T>>();
  let cursorY = 0;
  for (const ws of orderedWorksheets) {
    const wsNodes = nodes.filter((n) => n.sourceWorksheet === ws);
    if (wsNodes.length === 0) continue;
    const minY = Math.min(...wsNodes.map((n) => n.positionY));
    const maxY = Math.max(...wsNodes.map((n) => n.positionY));
    const yOffset = cursorY - minY;
    bands.set(ws, { worksheet: ws, nodes: wsNodes, yOffset, minY, maxY });
    cursorY += maxY - minY + margin;
  }
  return { orderedWorksheets, bands };
}
