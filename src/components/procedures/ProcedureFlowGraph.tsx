"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MarkerType,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  useReactFlow,
  getStraightPath,
  getSmoothStepPath,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import GraphCanvas from "@/components/graph-editor-core/GraphCanvas";
import { procedureBranchTypeLabels, type ProcedureNodeType } from "@/lib/domain/procedure-template-types";
import type { ProcedureTemplateEdgeRow, ProcedureTemplateNodeRow } from "@/lib/db/queries/procedure-templates";
import {
  NODE_VISUAL_CONFIG,
  EDGE_VISUAL_CONFIG,
  GRAPH_SPACING,
  getNodeChipVisual,
  searchNodes,
  groupNodesByWorksheet,
  computeStageSortedLayout,
  computeNodeDimensions,
  type NodeIssueBadge,
} from "@/lib/domain/procedure-visual-language";
import { computeConnectedIds } from "@/lib/graph-editor-core/selection";
import {
  classifyAndAssignEdgeRoute,
  assignEdgeLanes,
  buildOuterLanePath,
  computeEdgeVisibility,
  GRAPH_VISIBILITY_MODES,
  GRAPH_VISIBILITY_MODE_LABELS,
  type GraphVisibilityMode,
  type RoutableNode,
  type EdgeRouteAssignment,
} from "@/lib/domain/procedure-edge-routing";
import { resolveEffectiveNodePosition, hasUserLayoutOverride, computeLayeredGraphLayout, isAlignedVerticalConnection } from "@/lib/graph-editor-core/layout";
import { releasePointerCaptureSafely, createCaptureBlurGuard } from "@/lib/graph-editor-core/pointer";
import { resolveEffectiveEdgeRoute, type RoutePoint } from "@/lib/graph-editor-core/routing";
import ProcedureNodeChip from "./visual/ProcedureNodeChip";
import ProcedureGraphLegend from "./visual/ProcedureGraphLegend";

/** Outer-lane routing constants (Problem 1, part D) — presentation-only, how far past the layout's own rightmost content the shared lane pool starts, and how far apart parallel lanes sit. */
const LANE_BASE_GAP = 60;
const LANE_WIDTH = 28;

type ProcedureNodeData = {
  title: string;
  nodeType: ProcedureNodeType;
  sourceWorksheet: string | null;
  sourceShapeId: string | null;
  templateId: string;
  issueBadge: NodeIssueBadge | null;
  isSelected: boolean;
  isDimmed: boolean;
  isSeverelyDimmed: boolean;
};

/** Every named handle a node can be wired up through (Problem 1 revision) — always present, always invisible (a read-only chart has no reason to show connection dots), so an edge can attach at whichever specific side its route classification calls for. See procedure-edge-routing.ts for how an edge picks a source/target pair from these ids. */
const HIDDEN_HANDLE_STYLE = { opacity: 0, width: 6, height: 6, pointerEvents: "none" as const };

function ProcedureNodeHandles() {
  return (
    <>
      <Handle id="top-in" type="target" position={Position.Top} style={HIDDEN_HANDLE_STYLE} />
      <Handle id="bottom-out" type="source" position={Position.Bottom} style={HIDDEN_HANDLE_STYLE} />
      <Handle id="right-out" type="source" position={Position.Right} style={HIDDEN_HANDLE_STYLE} />
      <Handle id="left-in" type="target" position={Position.Left} style={HIDDEN_HANDLE_STYLE} />
      <Handle id="left-out" type="source" position={Position.Left} style={{ ...HIDDEN_HANDLE_STYLE, top: "70%" }} />
      <Handle id="loop-out" type="source" position={Position.Bottom} style={{ ...HIDDEN_HANDLE_STYLE, left: "85%" }} />
      <Handle id="loop-in" type="target" position={Position.Top} style={{ ...HIDDEN_HANDLE_STYLE, left: "85%" }} />
      <Handle id="cross-out" type="source" position={Position.Right} style={{ ...HIDDEN_HANDLE_STYLE, top: "80%" }} />
      <Handle id="cross-in" type="target" position={Position.Left} style={{ ...HIDDEN_HANDLE_STYLE, top: "80%" }} />
    </>
  );
}

/** Real graph nodes — reuses the shared ProcedureNodeChip so this is visually identical to every other screen that shows a node (Phase 3B). */
function ProcedureNode({ data }: NodeProps & { data: ProcedureNodeData }) {
  const { semanticType, iconKey } = getNodeChipVisual(data.nodeType);
  return (
    <div className="relative">
      <ProcedureNodeHandles />
      <ProcedureNodeChip
        semanticType={semanticType}
        iconKey={iconKey}
        title={data.title}
        subtitle={data.sourceShapeId ? `${data.sourceWorksheet} · shape#${data.sourceShapeId}` : data.sourceWorksheet}
        size="graph"
        issueBadge={data.issueBadge}
        issueHref={data.issueBadge ? `/procedures/${data.templateId}/validation/${data.issueBadge.issueId}` : undefined}
        isSelected={data.isSelected}
        isDimmed={data.isDimmed}
        isSeverelyDimmed={data.isSeverelyDimmed}
      />
    </div>
  );
}

type OuterLaneEdgeData = { path: string; labelX: number; labelY: number };

/** Custom edge for LOOP_BACK/RETRY and cross-worksheet routes (Problem 1, parts A and D) — the path is fully precomputed in ProcedureFlowGraph's flowEdges memo via buildOuterLanePath (same pure function the routing tests verify), so this component only draws it and places its label on the shared lane. */
function ProcedureOuterLaneEdge({ data, style, markerEnd, label, labelStyle, labelBgStyle, labelBgPadding }: EdgeProps & { data?: OuterLaneEdgeData }) {
  if (!data) return null;
  const bg = (labelBgStyle as React.CSSProperties | undefined) ?? {};
  const fg = (labelStyle as React.CSSProperties | undefined) ?? {};
  return (
    <>
      <BaseEdge path={data.path} style={style} markerEnd={markerEnd} />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${data.labelX}px, ${data.labelY}px)`,
              background: (bg.fill as string) ?? "#ffffff",
              opacity: bg.fillOpacity ?? 1,
              padding: labelBgPadding ? `${labelBgPadding[1]}px ${labelBgPadding[0]}px` : "2px 3px",
              borderRadius: 3,
              fontSize: fg.fontSize ?? 10,
              fontWeight: fg.fontWeight ?? 700,
              color: (fg.fill as string) ?? undefined,
              pointerEvents: "none",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/**
 * Round-2 straight-edge fix — extracted as a plain function (no JSX/React)
 * specifically so it's unit-testable on its own: given the exact
 * EdgeProps geometry React Flow passes to a custom edge renderer, decide
 * straight-vs-smoothstep from `sourceX`/`targetX` DIRECTLY — never from
 * this codebase's own node-position/width estimate. See
 * ProcedureDefaultEdge's own doc comment for why that distinction matters.
 */
export function computeDefaultEdgePath(params: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
}): [string, number, number] {
  const [path, labelX, labelY] = isAlignedVerticalConnection(params.sourceX, params.targetX)
    ? getStraightPath({ sourceX: params.sourceX, sourceY: params.sourceY, targetX: params.targetX, targetY: params.targetY })
    : getSmoothStepPath(params);
  return [path, labelX, labelY];
}

/**
 * Round-2 straight-edge fix — the ordinary (원본/사용자 배치, non-manual-
 * route, non-LOOP_BACK) edge type. Earlier, the caller decided `type:
 * "straight" | "smoothstep"` ahead of time from its OWN estimate of each
 * node's center x (nodeCenterXById, built from computeNodeDimensions +
 * node.position) — if that estimate ever disagreed with what React Flow
 * actually measured/rendered, the decision would be wrong regardless of
 * how correct the layout math itself was. This component instead decides
 * INSIDE the renderer (via computeDefaultEdgePath above), using
 * `sourceX`/`targetX` — React Flow's own authoritative, live handle
 * coordinates (computed from the real `internals.positionAbsolute` and
 * the handle's own measured DOM position, not anything this codebase
 * estimates) — so the straight-vs-bent choice can never drift from what's
 * actually on screen.
 */
function ProcedureDefaultEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, label, labelStyle, labelBgStyle, labelBgPadding }: EdgeProps) {
  const [path, labelX, labelY] = computeDefaultEdgePath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return (
    <BaseEdge
      path={path}
      labelX={labelX}
      labelY={labelY}
      style={style}
      markerEnd={markerEnd}
      label={label}
      labelStyle={labelStyle}
      labelBgStyle={labelBgStyle}
      labelBgPadding={labelBgPadding}
    />
  );
}

type ManualRouteEdgeData = {
  points: RoutePoint[];
  /** Only the currently-selected edge, in editable+USER layout, renders draggable handles — every other edge with a manual route still renders the correct polyline shape, just without the interactive overlay. */
  isInteractive: boolean;
  selectedWaypointIndex: number | null;
  onWaypointSelect?: (index: number | null) => void;
  onWaypointMove?: (index: number, point: RoutePoint) => void;
};

/**
 * Phase 4B — renders an edge as an explicit polyline through its manual
 * waypoints (source -> points... -> target), the same "render from a
 * precomputed path string" technique ProcedureOuterLaneEdge already proves
 * out. sourceX/Y and targetX/Y come from ReactFlow itself (computed from
 * the node's actual rendered position + this edge's sourceHandle/
 * targetHandle, same handles the deterministic edges use) — waypoints and
 * these coordinates already share one coordinate space, so no conversion
 * is needed to build the path.
 *
 * Dragging a handle uses setPointerCapture so pointermove/pointerup keep
 * firing on the same element regardless of where the cursor physically
 * ends up — no window-level listener bookkeeping required. Every drag only
 * ever calls onWaypointMove(index, point), which the editor screen wires
 * to pendingEdgeRouteMoves only — it can never touch this edge's own
 * source/target node ids, satisfying "route-point dragging must never
 * retarget the edge endpoints" structurally, not by a separate check.
 *
 * Phase 5C-5B bugfix (cursor-disappearing investigation, round 1) — the
 * original version only released capture on `onPointerUp`. A drag
 * interrupted any other way (Alt+Tab, a system/browser dialog stealing
 * focus, a right-click context menu, losing touch/pen contact) fires
 * `pointercancel` instead, which this element never handled — the pointer
 * stayed captured by this 10x10px handle indefinitely. While the pointer
 * remains captured, every subsequent pointer event keeps routing to (and
 * being cursor-styled by) this off-screen/stale element instead of
 * whatever the OS pointer is actually over, which is exactly what made the
 * cursor appear to "vanish" even after moving off the graph entirely onto
 * a property panel — the capture, not the panel, was the actual site of
 * the bug. Released on both `onPointerUp` and `onPointerCancel`,
 * defensively (see releasePointerCaptureSafely, graph-editor-core/pointer.ts).
 *
 * Round 2 (the fix above wasn't sufficient) — two more release paths were
 * still missing:
 *  - `onLostPointerCapture`, the one event the Pointer Capture spec
 *    actually *guarantees* fires on every release, implicit or explicit
 *    (disabled/removed element, capture reassigned elsewhere, etc.) —
 *    `pointerup`/`pointercancel` cover the common cases but not all of
 *    them.
 *  - A window `blur` (Alt+Tab, a dialog, switching to another app) or the
 *    tab going hidden: pointer capture is defined to be independent of
 *    window focus, so losing focus mid-drag releases neither the capture
 *    nor fires `pointercancel`/`lostpointercapture` — the handle can keep
 *    controlling the page's rendered cursor until an actual `pointerup`
 *    eventually arrives, which may never happen if the button was released
 *    while a different window had OS focus. `createCaptureBlurGuard`
 *    (graph-editor-core/pointer.ts) proactively releases the capture it's
 *    tracking the moment that happens.
 */
function ProcedureManualRouteEdge({ id, sourceX, sourceY, targetX, targetY, style, markerEnd, label, labelStyle, labelBgStyle, labelBgPadding, data }: EdgeProps & { data?: ManualRouteEdgeData }) {
  const { screenToFlowPosition } = useReactFlow();
  const captureGuardRef = useRef<ReturnType<typeof createCaptureBlurGuard> | null>(null);
  useEffect(() => {
    const guard = createCaptureBlurGuard(window, document);
    captureGuardRef.current = guard;
    return () => {
      guard.dispose();
      captureGuardRef.current = null;
    };
  }, []);
  if (!data) return null;

  const chain = [{ x: sourceX, y: sourceY }, ...data.points, { x: targetX, y: targetY }];
  const path = chain.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  // BaseEdge needs an explicit label position for a multi-point path (it
  // can only infer one from a single getXxxPath() call, which this
  // hand-built polyline never goes through) — the chain's centroid is a
  // simple, always-on-the-line-ish default; it doesn't need to be exact.
  const labelX = chain.reduce((sum, p) => sum + p.x, 0) / chain.length;
  const labelY = chain.reduce((sum, p) => sum + p.y, 0) / chain.length;

  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} label={label} labelX={labelX} labelY={labelY} labelStyle={labelStyle} labelBgStyle={labelBgStyle} labelBgPadding={labelBgPadding} />
      {data.isInteractive && (
        <EdgeLabelRenderer>
          {data.points.map((p, index) => (
            <div
              key={index}
              className="nodrag nopan"
              onPointerDown={(e) => {
                e.stopPropagation();
                data.onWaypointSelect?.(index);
                const el = e.currentTarget as HTMLElement;
                el.setPointerCapture(e.pointerId);
                captureGuardRef.current?.track(el, e.pointerId);
              }}
              onPointerMove={(e) => {
                if (e.buttons !== 1) return;
                data.onWaypointMove?.(index, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
              }}
              onPointerUp={(e) => {
                releasePointerCaptureSafely(e.currentTarget as HTMLElement, e.pointerId);
                captureGuardRef.current?.untrack();
              }}
              onPointerCancel={(e) => {
                releasePointerCaptureSafely(e.currentTarget as HTMLElement, e.pointerId);
                captureGuardRef.current?.untrack();
              }}
              onLostPointerCapture={() => captureGuardRef.current?.untrack()}
              style={{
                position: "absolute",
                transform: `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)`,
                width: 10,
                height: 10,
                borderRadius: "9999px",
                background: index === data.selectedWaypointIndex ? "#2563eb" : "#ffffff",
                border: "2px solid #2563eb",
                cursor: "grab",
                pointerEvents: "all",
                zIndex: 20,
              }}
            />
          ))}
        </EdgeLabelRenderer>
      )}
    </>
  );
}

type StageHeaderData = { worksheet: string; count: number };

/** SUBPROCESS_OR_STAGE-styled band header (Phase 3B) — a presentation-only label above each worksheet's node cluster, never a real procedure_template_nodes row. */
function ProcedureStageHeaderNode({ data }: NodeProps & { data: StageHeaderData }) {
  return (
    <ProcedureNodeChip
      semanticType="SUBPROCESS_OR_STAGE"
      iconKey={NODE_VISUAL_CONFIG.SUBPROCESS_OR_STAGE.iconKey}
      title={data.worksheet}
      subtitle={`${data.count}개 노드`}
      size="graph"
    />
  );
}

const nodeTypes = { procedureNode: ProcedureNode, procedureStageHeader: ProcedureStageHeaderNode };
const edgeTypes = { procedureOuterLane: ProcedureOuterLaneEdge, procedureManualRoute: ProcedureManualRouteEdge, procedureDefault: ProcedureDefaultEdge };

const ALL_WORKSHEETS = "ALL";

/** Exported for reuse by ProcedureTemplateEditorScreen.tsx, which lifts and controls this value — see this component's own layoutMode/onLayoutModeChange prop doc comment for why. */
export type LayoutMode = "SOURCE" | "USER" | "STAGE_SORTED";

export type ProcedureFlowGraphOpenIssue = { nodeId: string; issueId: string; severity: "ERROR" | "WARNING" };

/** Phase 5C-5B — ProcedureTemplateNodeRow itself now carries userPositionX/Y (previously editor-only, added to the read-only detail query's row shape too so both screens can resolve the same saved override — see this file's own layout-unification notes). EditorNodeRow (a structural superset) satisfies this type as-is. */
type ProcedureFlowGraphNode = ProcedureTemplateNodeRow;

/**
 * Flowchart viewer (Phase 3B: standardized visual language; Phase 4A:
 * optional controlled-editor affordances). Read-only by default — no
 * editing (no onNodesChange/onEdgesChange wired up, nodes/edges are not
 * draggable-and-persisted) unless `editable` is set, in which case node
 * drag is allowed only in the 사용자 배치 layout and only ever reported
 * back via callbacks; this component itself never persists anything. Node
 * shape/color/icon, edge style, and layout spacing come entirely from
 * procedure-visual-language.ts, the same config every other screen
 * (validation-resolution, editor) reuses — never invented locally here.
 */
export default function ProcedureFlowGraph({
  templateId,
  nodes: nodeRows,
  edges: edgeRows,
  openIssuesByNodeId = [],
  initialWorksheet = null,
  initialSelectedNodeId = null,
  errorFocusMode = false,
  editable = false,
  useAutoLayoutForUnpositionedNodes = false,
  onNodeSelectionChange,
  onEdgeSelectionChange,
  onNodeDragStop,
  selectedEdgeId = null,
  edgeRoutesByEdgeId,
  selectedWaypointIndex = null,
  onWaypointSelectionChange,
  onWaypointMove,
  onEdgeDoubleClickInsert,
  layoutMode: controlledLayoutMode,
  onLayoutModeChange,
}: {
  templateId: string;
  nodes: ProcedureFlowGraphNode[];
  edges: ProcedureTemplateEdgeRow[];
  openIssuesByNodeId?: ProcedureFlowGraphOpenIssue[];
  /** Error-to-node navigation (Phase 3B revision): the worksheet to auto-select on first render, resolved server/screen-side from a validation issue's stable source identity — read once as initial state, not kept in sync afterward (a fresh navigation always remounts this component with fresh values). */
  initialWorksheet?: string | null;
  /** The node id to select and fit the camera to on first render, same one-shot semantics as initialWorksheet. */
  initialSelectedNodeId?: string | null;
  /** Problem 2 revision (오류 집중 보기) — when true and initialSelectedNodeId resolved to a real node, the first camera fit targets the node's immediate connected neighborhood (not just the single node), and unrelated nodes/edges dim much more strongly than an ordinary manual node selection does. */
  errorFocusMode?: boolean;
  /** Phase 4A — enables the 사용자 배치 layout option and node-drag reporting. Never enables editing of any other kind by itself (no free-form add/delete, no direct persistence) — the editor screen owns all of that via its own side panels and Server Actions. */
  editable?: boolean;
  /**
   * Phase 5C-5B — true for a manually-authored (never Excel-imported)
   * template, i.e. `sourceType === "MANUAL"` (in practice: every
   * TECHNICAL_TASK template) — its raw position_x/position_y are only ever
   * the synthetic creation-order stack createProcedureTemplateNode assigns,
   * never a real drawn layout, so they are not a meaningful "readable"
   * fallback the way an EXCEL_IMPORT template's imported coordinates are.
   * When true, any node with no saved user-position override falls back to
   * the same topological/row-packed computation STAGE_SORTED already uses,
   * instead of its raw (meaningless) position_x/position_y. Used by BOTH
   * the read-only detail view and the editor, identically — see
   * resolveBaselinePosition below — so the two screens never disagree
   * about where an unpositioned node belongs, and a saved user-position
   * override is honored the same way in both places too (see this file's
   * own Phase 5C-5B usability-correction notes). Defaults false, so
   * FULL_SERVICE/REFERENCE keep their exact existing fallback (raw
   * position_x/position_y).
   */
  useAutoLayoutForUnpositionedNodes?: boolean;
  /** Fires whenever the selected node changes (including deselection), in addition to this component's own path-highlight/dim behavior — lets the editor open/close its node property panel in lockstep. */
  onNodeSelectionChange?: (nodeId: string | null) => void;
  /** Fires when an edge is clicked — this component has no built-in edge-selection visual state of its own, this is purely a notification for the editor's edge property panel. */
  onEdgeSelectionChange?: (edgeId: string | null) => void;
  /** Fires once a drag gesture ends, in 사용자 배치 layout only — the editor accumulates these client-side and persists them only on an explicit Save, never here. */
  onNodeDragStop?: (nodeId: string, position: { x: number; y: number }) => void;
  /** Phase 4B — the editor's currently-selected edge id (lifted to the parent, unlike selectedNodeId which stays local here) — only this edge ever gets draggable waypoint handles. */
  selectedEdgeId?: string | null;
  /** Phase 4B — the editor's *working* (saved + pending-merged) manual route per edge id; absent/undefined for a read-only viewer that never passes this prop at all. Only ever rendered/interactive in 사용자 배치 — see resolveEffectiveEdgeRoute. */
  edgeRoutesByEdgeId?: Map<string, RoutePoint[] | null>;
  /** Phase 4B — which waypoint index (within the selected edge's route) is selected, for the "선택 경로점 삭제" button/keyboard shortcut, owned by the parent so both the graph's handles and the side panel's delete button agree. */
  selectedWaypointIndex?: number | null;
  onWaypointSelectionChange?: (index: number | null) => void;
  /** Fires on every waypoint drag frame — client-state only, same "no auto-save" contract as onNodeDragStop. */
  onWaypointMove?: (edgeId: string, index: number, point: { x: number; y: number }) => void;
  /** The double-click-on-an-edge shortcut (never the only way to add a waypoint — see the editor's own "경로점 추가" button) — fires with the click position already converted to flow coordinates. */
  onEdgeDoubleClickInsert?: (edgeId: string, point: { x: number; y: number }) => void;
  /**
   * Phase 5C-5B usability bugfix — 원본 배치/사용자 배치 view mode, optionally
   * controlled by the caller. Route-point markers are only ever rendered/
   * interactive in USER mode (resolveEffectiveEdgeRoute returns null for
   * every other mode) — the editor screen needs to force USER mode the
   * moment a route point is added via its side panel's "경로점 추가" button
   * (a completely separate component from this graph), or the newly-added
   * point can never be clicked/selected, permanently blocking "이 위치에
   * 노드 추가". Uncontrolled (internal useState, defaulting to "SOURCE",
   * unchanged from before) when omitted — ProcedureTemplateDetailScreen's
   * read-only usage never passes these and is completely unaffected.
   */
  layoutMode?: LayoutMode;
  onLayoutModeChange?: (mode: LayoutMode) => void;
}) {
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
  // Fires the camera fit exactly once, the first time the instance for the
  // initial target becomes ready — cleared immediately after so a later
  // manual worksheet-filter change (which remounts <ReactFlow> via its
  // `key`) never re-triggers the original error's auto-fit.
  const initialFitNodeIdRef = useRef<string | null>(initialSelectedNodeId);

  const issueBadgeByNodeId = useMemo(() => {
    const map = new Map<string, NodeIssueBadge>();
    for (const o of openIssuesByNodeId) map.set(o.nodeId, { severity: o.severity, issueId: o.issueId });
    return map;
  }, [openIssuesByNodeId]);

  // Worksheet filter (Phase 2.5 read-only perf work) — a combined
  // multi-sheet template (e.g. rfg-full-lifecycle, ~10 source sheets) can
  // have hundreds of nodes; letting a reviewer isolate one source sheet at
  // a time is a pure client-side view filter, no editing capability.
  const worksheets = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const n of nodeRows) {
      if (n.sourceWorksheet && !seen.has(n.sourceWorksheet)) {
        seen.add(n.sourceWorksheet);
        ordered.push(n.sourceWorksheet);
      }
    }
    return ordered;
  }, [nodeRows]);

  const [worksheetFilter, setWorksheetFilter] = useState<string>(() => initialWorksheet ?? ALL_WORKSHEETS);
  // Controlled-with-uncontrolled-fallback: ProcedureTemplateEditorScreen
  // passes both props and drives this value; every other caller (e.g.
  // ProcedureTemplateDetailScreen's read-only view) omits them and keeps
  // the exact original self-contained behavior.
  const [internalLayoutMode, setInternalLayoutMode] = useState<LayoutMode>("SOURCE");
  const layoutMode = controlledLayoutMode ?? internalLayoutMode;
  const setLayoutMode = onLayoutModeChange ?? setInternalLayoutMode;
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(() => initialSelectedNodeId);
  const [searchQuery, setSearchQuery] = useState("");
  // Graph visibility mode (Problem 1, part B) — only meaningful in the
  // compact STAGE_SORTED layout, where hundreds of same-style edges are the
  // actual noise problem; 원본 배치 keeps its original, unfiltered rendering.
  const [visibilityMode, setVisibilityMode] = useState<GraphVisibilityMode>("ALL");

  const filteredNodeRows = useMemo(
    () => (worksheetFilter === ALL_WORKSHEETS ? nodeRows : nodeRows.filter((n) => n.sourceWorksheet === worksheetFilter)),
    [nodeRows, worksheetFilter]
  );

  // 원본 배치 (SOURCE): stacks each worksheet's *stored* source coordinates
  // into its own non-overlapping vertical band — position_x/position_y are
  // never touched, this only changes where this read-only viewer draws
  // them (Phase 2.5). Promoted into the shared, unit-tested
  // groupNodesByWorksheet so the graph and its tests share one
  // implementation.
  const { bands } = useMemo(() => groupNodesByWorksheet(nodeRows), [nodeRows]);

  // 단계별 정렬 (STAGE_SORTED): a compact, deterministic row-packing layout
  // (Phase 3B revision) — replaces a fixed-column grid that forced every
  // node into the same oversized cell and produced a very tall, sparse
  // canvas at 400+ nodes. Computed once over every node/edge (not just the
  // currently filtered subset) so a node's position never shifts when the
  // worksheet filter changes. Never persisted, never touches stored
  // position_x/position_y.
  const stageSortedLayout = useMemo(
    () => computeStageSortedLayout(nodeRows, edgeRows, worksheets),
    [nodeRows, edgeRows, worksheets]
  );

  /**
   * Phase 5C-5B — the auto-layout fallback for a MANUAL template's
   * unpositioned nodes (useAutoLayoutForUnpositionedNodes), deliberately
   * NOT stageSortedLayout above: that's a row-*wrapping* flow layout with
   * no concept of graph depth at all, so a straight linear A->B->C chain
   * could land side by side in one row purely because it fits under
   * ROW_MAX_WIDTH — the opposite of "vertical continuation forms a
   * column." computeLayeredGraphLayout is a real depth-based layout
   * instead. Only computed when actually needed (guarded, not just
   * memoized) — this is graph-editor-core's own concern, no reason to pay
   * for it on a 400+ node FULL_SERVICE template that will never use it.
   */
  const layeredLayout = useMemo(
    () =>
      useAutoLayoutForUnpositionedNodes
        ? computeLayeredGraphLayout(
            nodeRows.map((n) => ({
              id: n.id,
              sortOrder: n.sortOrder,
              // Round-3 usability fix — center-based alignment: a
              // multiline title can make one node wider than its neighbor,
              // so aligning by left-edge x (the old behavior) no longer
              // guarantees the same CENTER x, which is what actually
              // determines whether the bottom/top handles line up into a
              // straight connector. computeLayeredGraphLayout now needs
              // each node's real width to align by center instead.
              width: computeNodeDimensions({ title: n.title, shape: NODE_VISUAL_CONFIG[getNodeChipVisual(n.nodeType).semanticType].shape }).width,
              // Round-2 usability fix — "layout and line geometry must
              // agree": an unpositioned child under a manually-dragged
              // parent must center on the parent's REAL rendered x, not a
              // synthetic depth-based one this function would otherwise
              // invent for it in isolation (see computeLayeredGraphLayout's
              // own doc comment on pinnedX).
              pinnedX: hasUserLayoutOverride({ userPositionX: n.userPositionX, userPositionY: n.userPositionY })
                ? resolveEffectiveNodePosition({ positionX: n.positionX, positionY: n.positionY, userPositionX: n.userPositionX, userPositionY: n.userPositionY }, "USER").x
                : undefined,
            })),
            edgeRows.map((e) => ({ fromNodeId: e.fromNodeId, toNodeId: e.toNodeId })),
            { horizontal: 280, vertical: 150 }
          )
        : new Map<string, { x: number; y: number }>(),
    [useAutoLayoutForUnpositionedNodes, nodeRows, edgeRows]
  );

  // Problem 1 revision — semantic edge routing, computed only for the
  // compact layout (원본 배치 keeps its pre-existing top/bottom-only
  // rendering untouched). nodeInfoById/outgoingCountByNodeId are derived
  // from the full, unfiltered node/edge lists so an edge's classification
  // never shifts when the worksheet filter changes — same invariant
  // stageSortedLayout itself already keeps.
  const nodeInfoById = useMemo(() => {
    const map = new Map<string, { nodeType: ProcedureNodeType; sourceWorksheet: string | null }>();
    for (const n of nodeRows) map.set(n.id, { nodeType: n.nodeType, sourceWorksheet: n.sourceWorksheet });
    return map;
  }, [nodeRows]);

  const outgoingCountByNodeId = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of edgeRows) map.set(e.fromNodeId, (map.get(e.fromNodeId) ?? 0) + 1);
    return map;
  }, [edgeRows]);

  const routeAssignments = useMemo(() => {
    const map = new Map<string, EdgeRouteAssignment>();
    if (layoutMode !== "STAGE_SORTED") return map;
    for (const e of edgeRows) {
      const fromInfo = nodeInfoById.get(e.fromNodeId);
      const toInfo = nodeInfoById.get(e.toNodeId);
      if (!fromInfo || !toInfo) continue;
      const fromNode: RoutableNode = {
        id: e.fromNodeId,
        nodeType: fromInfo.nodeType,
        sourceWorksheet: fromInfo.sourceWorksheet,
        rowIndex: stageSortedLayout.rowIndexByNodeId.get(e.fromNodeId) ?? 0,
      };
      const toNode: RoutableNode = {
        id: e.toNodeId,
        nodeType: toInfo.nodeType,
        sourceWorksheet: toInfo.sourceWorksheet,
        rowIndex: stageSortedLayout.rowIndexByNodeId.get(e.toNodeId) ?? 0,
      };
      map.set(e.id, classifyAndAssignEdgeRoute(e, fromNode, toNode, outgoingCountByNodeId.get(e.fromNodeId) ?? 0));
    }
    return map;
  }, [layoutMode, edgeRows, nodeInfoById, stageSortedLayout, outgoingCountByNodeId]);

  // Shared outer-lane assignment (Problem 1, part D) for every LOOP_BACK/
  // RETRY and cross-worksheet edge — deterministic interval partitioning
  // keyed by each edge's own row-Y span, so parallel long edges bundle into
  // as few lanes as their spans allow.
  const laneAssignment = useMemo(() => {
    if (layoutMode !== "STAGE_SORTED") return new Map<string, number>();
    const longDistanceEdges = edgeRows
      .filter((e) => {
        const kind = routeAssignments.get(e.id)?.kind;
        return kind === "loopback" || kind === "cross-worksheet";
      })
      .map((e) => ({
        id: e.id,
        fromY: stageSortedLayout.positions.get(e.fromNodeId)?.y ?? 0,
        toY: stageSortedLayout.positions.get(e.toNodeId)?.y ?? 0,
      }));
    return assignEdgeLanes(longDistanceEdges);
  }, [layoutMode, edgeRows, routeAssignments, stageSortedLayout]);

  const nodeDimsById = useMemo(() => {
    const map = new Map<string, { width: number; height: number }>();
    for (const n of filteredNodeRows) {
      const { semanticType } = getNodeChipVisual(n.nodeType);
      map.set(n.id, computeNodeDimensions({ title: n.title, shape: NODE_VISUAL_CONFIG[semanticType].shape }));
    }
    return map;
  }, [filteredNodeRows]);

  const searchMatches = useMemo(
    () => searchNodes(filteredNodeRows, searchQuery).slice(0, 8),
    [filteredNodeRows, searchQuery]
  );

  const minimalEdges = useMemo(() => edgeRows.map((e) => ({ id: e.id, source: e.fromNodeId, target: e.toNodeId })), [edgeRows]);
  const { nodeIds: connectedNodeIds, edgeIds: connectedEdgeIds } = useMemo(
    () => computeConnectedIds(selectedNodeId, minimalEdges),
    [selectedNodeId, minimalEdges]
  );

  useEffect(() => {
    onNodeSelectionChange?.(selectedNodeId);
  }, [selectedNodeId, onNodeSelectionChange]);

  function selectAndFit(nodeId: string) {
    setSelectedNodeId(nodeId);
    reactFlowInstanceRef.current?.fitView({ nodes: [{ id: nodeId }], duration: 300, padding: 1.5 });
  }

  // ---- GraphCanvas interaction wiring (Phase 5C-4) — GraphCanvas itself
  // knows nothing about worksheets, layout modes, or editability; every one
  // of these handlers carries exactly the domain-conditional behavior the
  // canvas's own onNodeClick/onPaneClick/onEdgeDoubleClick JSX props used to
  // apply inline, unchanged. ----

  function handleCanvasNodeClick(nodeId: string) {
    onEdgeSelectionChange?.(null);
    setSelectedNodeId((current) => (current === nodeId ? null : nodeId));
  }

  function handleCanvasPaneClick() {
    setSelectedNodeId(null);
    onEdgeSelectionChange?.(null);
  }

  /** The double-click shortcut for inserting a waypoint — never the only way to add one (see the editor's "경로점 추가" button) — only meaningful in editable 사용자 배치, same gate node dragging and the waypoint handles themselves use. Edge selection itself always happens on any double click, regardless of mode. */
  function handleCanvasEdgeDoubleClick(edgeId: string, point: { x: number; y: number }) {
    onEdgeSelectionChange?.(edgeId);
    if (!editable || layoutMode !== "USER") return;
    onEdgeDoubleClickInsert?.(edgeId, point);
  }

  function handleCanvasInit(instance: ReactFlowInstance) {
    reactFlowInstanceRef.current = instance;
    const targetId = initialFitNodeIdRef.current;
    if (targetId) {
      initialFitNodeIdRef.current = null;
      // 오류 집중 보기: fit the focused region (the issue node plus its
      // immediate connected neighborhood), not the whole graph — an
      // ordinary node-click fit still targets just the one node.
      const fitTargets = errorFocusMode ? [targetId, ...connectedNodeIds].map((id) => ({ id })) : [{ id: targetId }];
      requestAnimationFrame(() => {
        instance.fitView({ nodes: fitTargets, duration: 300, padding: 1.5 });
      });
    }
  }

  /**
   * Phase 5C-5B — the ONE non-STAGE_SORTED position resolution, shared by
   * every non-preview layoutMode ("SOURCE" and "USER" used to disagree
   * here — "SOURCE" ignored a saved userPosition override entirely, which
   * is exactly the detail-vs-editor mismatch this phase's usability
   * correction fixes). Priority: (1) a saved user-position override, if
   * both coordinates are present and valid, wins unconditionally — this is
   * also the drag-persisted position, so free node dragging round-trips
   * correctly on refresh; (2) otherwise, a manually-authored template
   * (useAutoLayoutForUnpositionedNodes) falls back to the same topological/
   * row-packed computation STAGE_SORTED renders, since its raw
   * position_x/position_y are only ever a meaningless creation-order stack;
   * (3) otherwise, the real imported (or worksheet-band-adjusted) source
   * coordinates, unchanged from this file's original behavior.
   */
  const resolveBaselinePosition = useCallback(
    (n: ProcedureFlowGraphNode): { x: number; y: number } => {
      if (hasUserLayoutOverride({ userPositionX: n.userPositionX, userPositionY: n.userPositionY })) {
        return resolveEffectiveNodePosition({ positionX: n.positionX, positionY: n.positionY, userPositionX: n.userPositionX, userPositionY: n.userPositionY }, "USER");
      }
      const bandOffsetY = n.sourceWorksheet ? (bands.get(n.sourceWorksheet)?.yOffset ?? 0) : 0;
      if (useAutoLayoutForUnpositionedNodes) return layeredLayout.get(n.id) ?? { x: n.positionX, y: n.positionY + bandOffsetY };
      return { x: n.positionX, y: n.positionY + bandOffsetY };
    },
    [bands, useAutoLayoutForUnpositionedNodes, layeredLayout]
  );

  const flowNodes = useMemo<Node[]>(() => {
    const result: Node[] = filteredNodeRows.map((n) => {
      const sourcePos = layoutMode === "STAGE_SORTED" ? (stageSortedLayout.positions.get(n.id) ?? { x: n.positionX, y: n.positionY }) : resolveBaselinePosition(n);
      return {
        id: n.id,
        type: "procedureNode",
        position: sourcePos,
        data: {
          title: n.title,
          nodeType: n.nodeType,
          sourceWorksheet: n.sourceWorksheet,
          sourceShapeId: n.sourceShapeId,
          templateId,
          issueBadge: issueBadgeByNodeId.get(n.id) ?? null,
          isSelected: n.id === selectedNodeId,
          isDimmed: selectedNodeId !== null && !connectedNodeIds.has(n.id),
          isSeverelyDimmed: errorFocusMode && selectedNodeId !== null && !connectedNodeIds.has(n.id),
        } satisfies ProcedureNodeData,
      };
    });

    // SUBPROCESS_OR_STAGE band headers — only meaningful across multiple
    // worksheets; a single-worksheet filtered view already has its own
    // label in the filter control, so headers stay hidden there.
    if (worksheetFilter === ALL_WORKSHEETS && worksheets.length > 1) {
      for (const ws of worksheets) {
        const band = bands.get(ws);
        if (!band) continue;
        const headerHeight = computeNodeDimensions({ title: ws, shape: NODE_VISUAL_CONFIG.SUBPROCESS_OR_STAGE.shape }).height;
        const headerPos =
          layoutMode === "STAGE_SORTED"
            ? stageSortedLayout.headerPositions.get(ws) ?? { x: 0, y: 0 }
            : { x: 0, y: band.minY + band.yOffset - headerHeight - GRAPH_SPACING.HEADER_GAP };
        result.push({
          id: `stage-header::${ws}`,
          type: "procedureStageHeader",
          position: headerPos,
          data: { worksheet: ws, count: band.nodes.length } satisfies StageHeaderData,
          selectable: false,
          draggable: false,
          connectable: false,
        });
      }
    }
    return result;
  }, [
    filteredNodeRows,
    bands,
    layoutMode,
    stageSortedLayout,
    resolveBaselinePosition,
    worksheetFilter,
    worksheets,
    templateId,
    issueBadgeByNodeId,
    selectedNodeId,
    connectedNodeIds,
    errorFocusMode,
  ]);

  const flowEdges = useMemo<Edge[]>(() => {
    const visibleNodeIds = new Set(filteredNodeRows.map((n) => n.id));
    const visibleEdgeRows = edgeRows.filter((e) => visibleNodeIds.has(e.fromNodeId) && visibleNodeIds.has(e.toNodeId));

    if (layoutMode !== "STAGE_SORTED") {
      // 원본 배치 / 사용자 배치 — unchanged from Phase 3B: every edge is a
      // plain top/bottom smoothstep (or a bezier for LOOP_BACK/RETRY), no
      // semantic routing — UNLESS (Phase 4B) it has a manual route override
      // and we're actually in 사용자 배치, in which case it renders through
      // ProcedureManualRouteEdge instead. resolveEffectiveEdgeRoute already
      // encodes "only USER layout" — 원본 배치 never sees a manual route
      // even if one is stored, by construction, not by an extra check here.
      return visibleEdgeRows.map((e) => {
        const config = EDGE_VISUAL_CONFIG[e.branchType];
        const isHighlighted = connectedEdgeIds.has(e.id);
        const isDimmed = selectedNodeId !== null && !isHighlighted;
        const dimOpacity = errorFocusMode ? 0.08 : 0.25;
        const effectiveRoute = resolveEffectiveEdgeRoute({ userRoutePoints: edgeRoutesByEdgeId?.get(e.id) ?? null }, layoutMode);

        const style = {
          stroke: config.strokeLight,
          strokeWidth: isHighlighted ? config.strokeWidth + 1.5 : config.strokeWidth,
          strokeDasharray: config.dashPattern,
          opacity: isDimmed ? dimOpacity : 1,
        };
        const labelStyle = { fill: config.strokeLight, fontWeight: 700, fontSize: 10 };
        const labelBgStyle = { fill: "#ffffff", fillOpacity: isDimmed ? (errorFocusMode ? 0.15 : 0.3) : 1 };
        const label = e.branchLabel ?? (config.defaultLabel ? procedureBranchTypeLabels[e.branchType] : undefined);
        const markerEnd = { type: config.markerShape === "arrow-open" ? MarkerType.Arrow : MarkerType.ArrowClosed, color: config.strokeLight };

        if (effectiveRoute) {
          const isSelectedEdge = editable && layoutMode === "USER" && e.id === selectedEdgeId;
          return {
            id: e.id,
            source: e.fromNodeId,
            target: e.toNodeId,
            sourceHandle: "bottom-out",
            targetHandle: "top-in",
            type: "procedureManualRoute",
            data: {
              points: effectiveRoute,
              isInteractive: isSelectedEdge,
              selectedWaypointIndex: isSelectedEdge ? selectedWaypointIndex : null,
              onWaypointSelect: onWaypointSelectionChange,
              onWaypointMove: (index: number, point: RoutePoint) => onWaypointMove?.(e.id, index, point),
            } satisfies ManualRouteEdgeData,
            label,
            labelStyle,
            labelBgStyle,
            labelBgPadding: [3, 2] as [number, number],
            style,
            markerEnd,
            animated: config.animated,
            zIndex: isHighlighted ? 10 : 0,
          } satisfies Edge;
        }

        return {
          id: e.id,
          source: e.fromNodeId,
          target: e.toNodeId,
          sourceHandle: "bottom-out",
          targetHandle: "top-in",
          // LOOP_BACK/RETRY get a curved bezier (`type: "default"`) so a
          // big cross-stage jump reads visually differently from ordinary
          // local smoothstep flow — the two verified RFG LOOP_BACK edges
          // must be "especially easy to identify." Every other edge here
          // renders through ProcedureDefaultEdge, which decides straight-
          // vs-smoothstep itself, live, from React Flow's own authoritative
          // sourceX/targetX (see that component's own doc comment) — never
          // a pre-computed guess based on this file's own position/width
          // estimates.
          type: config.routeStyle === "loopback-curve" ? "default" : "procedureDefault",
          label,
          labelStyle,
          labelBgStyle,
          labelBgPadding: [3, 2] as [number, number],
          style,
          markerEnd,
          animated: config.animated,
          zIndex: isHighlighted ? 10 : 0,
        } satisfies Edge;
      });
    }

    // 단계별 정렬 (컴팩트) — Problem 1 revision: each edge leaves/enters
    // through the handle its route classification assigned, LOOP_BACK/
    // RETRY and cross-worksheet edges draw a precomputed outer-lane path
    // instead of the generic smoothstep, and the active visibility mode
    // decides whether an edge renders at all and how strongly.
    const result: Edge[] = [];
    for (const e of visibleEdgeRows) {
      const assignment = routeAssignments.get(e.id);
      if (!assignment) continue;
      const config = EDGE_VISUAL_CONFIG[e.branchType];
      const isHighlighted = connectedEdgeIds.has(e.id);
      const hasOpenIssueOnEndpoint = issueBadgeByNodeId.has(e.fromNodeId) || issueBadgeByNodeId.has(e.toNodeId);
      const visibility = computeEdgeVisibility(visibilityMode, {
        hasSelection: selectedNodeId !== null,
        isConnectedToSelected: isHighlighted,
        isCrossWorksheet: assignment.kind === "cross-worksheet",
        isLoopback: assignment.kind === "loopback",
        isDecisionBranch: assignment.kind === "decision-branch",
        hasOpenIssueOnEndpoint,
      });
      if (visibility.hidden) continue;

      const style = {
        stroke: config.strokeLight,
        strokeWidth: isHighlighted ? config.strokeWidth + 1.5 : config.strokeWidth,
        strokeDasharray: config.dashPattern,
        opacity: visibility.opacity,
      };
      const labelBgStyle = { fill: "#ffffff", fillOpacity: visibility.opacity < 1 ? Math.max(visibility.opacity, 0.3) : 1 };
      const label = e.branchLabel ?? (config.defaultLabel ? procedureBranchTypeLabels[e.branchType] : undefined);
      const markerEnd = { type: config.markerShape === "arrow-open" ? MarkerType.Arrow : MarkerType.ArrowClosed, color: config.strokeLight };

      if (assignment.kind === "loopback" || assignment.kind === "cross-worksheet") {
        const sourceDims = nodeDimsById.get(e.fromNodeId);
        const targetDims = nodeDimsById.get(e.toNodeId);
        const sourcePos = stageSortedLayout.positions.get(e.fromNodeId);
        const targetPos = stageSortedLayout.positions.get(e.toNodeId);
        if (!sourceDims || !targetDims || !sourcePos || !targetPos) continue;
        const exitPoint = { x: sourcePos.x + sourceDims.width, y: sourcePos.y + sourceDims.height / 2 };
        const entryPoint = { x: targetPos.x, y: targetPos.y + targetDims.height / 2 };
        const laneX = stageSortedLayout.canvasMaxX + LANE_BASE_GAP + (laneAssignment.get(e.id) ?? 0) * LANE_WIDTH;
        const { path, labelPosition } = buildOuterLanePath(exitPoint, entryPoint, laneX);
        result.push({
          id: e.id,
          source: e.fromNodeId,
          target: e.toNodeId,
          sourceHandle: assignment.sourceHandle,
          targetHandle: assignment.targetHandle,
          type: "procedureOuterLane",
          data: { path, labelX: labelPosition.x, labelY: labelPosition.y } satisfies OuterLaneEdgeData,
          label,
          labelStyle: { fill: config.strokeLight, fontWeight: 700, fontSize: 10 },
          labelBgStyle,
          labelBgPadding: [3, 2] as [number, number],
          style,
          markerEnd,
          animated: config.animated,
          zIndex: isHighlighted ? 10 : 5,
        } satisfies Edge);
        continue;
      }

      result.push({
        id: e.id,
        source: e.fromNodeId,
        target: e.toNodeId,
        sourceHandle: assignment.sourceHandle,
        targetHandle: assignment.targetHandle,
        type: "smoothstep",
        label,
        labelStyle: { fill: config.strokeLight, fontWeight: 700, fontSize: 10 },
        labelBgStyle,
        labelBgPadding: [3, 2] as [number, number],
        style,
        markerEnd,
        animated: config.animated,
        zIndex: isHighlighted ? 10 : 0,
      } satisfies Edge);
    }
    return result;
  }, [
    layoutMode,
    edgeRows,
    filteredNodeRows,
    connectedEdgeIds,
    selectedNodeId,
    errorFocusMode,
    routeAssignments,
    visibilityMode,
    issueBadgeByNodeId,
    nodeDimsById,
    stageSortedLayout,
    laneAssignment,
    editable,
    edgeRoutesByEdgeId,
    selectedEdgeId,
    selectedWaypointIndex,
    onWaypointSelectionChange,
    onWaypointMove,
  ]);

  if (nodeRows.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {worksheets.length > 1 && (
          <div className="flex items-center gap-2">
            <label htmlFor="procedure-flow-worksheet-filter" className="text-zinc-500 dark:text-zinc-400">
              현재 시트 보기:
            </label>
            <select
              id="procedure-flow-worksheet-filter"
              value={worksheetFilter}
              onChange={(e) => {
                setWorksheetFilter(e.target.value);
                setSelectedNodeId(null);
              }}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            >
              <option value={ALL_WORKSHEETS}>전체 보기 ({nodeRows.length}개 노드)</option>
              {worksheets.map((ws) => (
                <option key={ws} value={ws}>
                  {ws} ({nodeRows.filter((n) => n.sourceWorksheet === ws).length}개 노드)
                </option>
              ))}
            </select>
            {worksheetFilter !== ALL_WORKSHEETS && (
              <span className="text-zinc-400 dark:text-zinc-600">— 다른 시트로 이어지는 분기는 이 필터에서 숨겨질 수 있습니다.</span>
            )}
          </div>
        )}
        <div className="flex items-center gap-2">
          <label htmlFor="procedure-flow-layout-mode" className="text-zinc-500 dark:text-zinc-400">
            배치:
          </label>
          <select
            id="procedure-flow-layout-mode"
            value={layoutMode}
            onChange={(e) => setLayoutMode(e.target.value as LayoutMode)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          >
            <option value="SOURCE">원본 배치</option>
            {editable && <option value="USER">사용자 배치</option>}
            <option value="STAGE_SORTED">단계별 정렬 {editable ? "미리보기" : "(컴팩트)"}</option>
          </select>
        </div>
        {layoutMode === "STAGE_SORTED" && (
          <div className="flex items-center gap-2">
            <label htmlFor="procedure-flow-visibility-mode" className="text-zinc-500 dark:text-zinc-400">
              연결 표시:
            </label>
            <select
              id="procedure-flow-visibility-mode"
              value={visibilityMode}
              onChange={(e) => setVisibilityMode(e.target.value as GraphVisibilityMode)}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            >
              {GRAPH_VISIBILITY_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {GRAPH_VISIBILITY_MODE_LABELS[mode]}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="relative flex items-center gap-2">
          <label htmlFor="procedure-flow-search" className="text-zinc-500 dark:text-zinc-400">
            검색:
          </label>
          <input
            id="procedure-flow-search"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="노드 제목, 코드, shape#"
            className="w-56 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          />
          {searchQuery.trim().length > 0 && (
            <div className="absolute top-full left-0 z-10 mt-1 max-h-56 w-80 overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {searchMatches.length === 0 ? (
                <p className="px-3 py-2 text-zinc-400 dark:text-zinc-600">일치하는 노드가 없습니다.</p>
              ) : (
                searchMatches.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => selectAndFit(n.id)}
                    className="block w-full truncate px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    {n.title} <span className="text-zinc-400 dark:text-zinc-600">({n.nodeCode})</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        {selectedNodeId && (
          <button
            type="button"
            onClick={() => selectAndFit(selectedNodeId)}
            className="rounded-md border border-blue-300 px-2 py-1 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-950"
          >
            선택한 노드로 이동
          </button>
        )}
        {selectedNodeId && (
          <button
            type="button"
            onClick={() => setSelectedNodeId(null)}
            className="rounded-md border border-zinc-300 px-2 py-1 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            선택 해제
          </button>
        )}
      </div>

      <ProcedureGraphLegend />

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {editable
          ? "편집 모드 — 사용자 배치에서는 노드를 드래그해 위치를 조정하고, 분기를 선택한 뒤 경로점을 추가/이동/삭제해 연결선 경로를 조정할 수 있습니다 (명시적으로 저장하기 전까지 반영되지 않습니다). 노드/분기를 클릭하면 연결된 경로가 강조되고 나머지는 흐리게 표시됩니다."
          : "읽기 전용 — 마우스 휠로 확대/축소, 드래그로 이동, 노드를 클릭하면 연결된 경로가 강조되고 나머지는 흐리게 표시됩니다."}
      </p>

      <GraphCanvas
        remountKey={`${worksheetFilter}-${layoutMode}`}
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={editable && layoutMode === "USER"}
        nodesConnectable={false}
        elementsSelectable={true}
        minZoom={0.02}
        onNodeDragStop={onNodeDragStop}
        onEdgeClick={onEdgeSelectionChange}
        onEdgeDoubleClick={handleCanvasEdgeDoubleClick}
        onInit={handleCanvasInit}
        onNodeClick={handleCanvasNodeClick}
        onPaneClick={handleCanvasPaneClick}
      />
    </div>
  );
}
