"use client";

import { useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { procedureBranchTypeLabels, type ProcedureNodeType } from "@/lib/domain/procedure-template-types";
import type { ProcedureTemplateEdgeRow, ProcedureTemplateNodeRow } from "@/lib/db/queries/procedure-templates";
import {
  NODE_VISUAL_CONFIG,
  EDGE_VISUAL_CONFIG,
  GRAPH_SPACING,
  getNodeChipVisual,
  computeConnectedIds,
  searchNodes,
  groupNodesByWorksheet,
  computeStageSortedLayout,
  computeNodeDimensions,
  type NodeIssueBadge,
} from "@/lib/domain/procedure-visual-language";
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
const edgeTypes = { procedureOuterLane: ProcedureOuterLaneEdge };

const ALL_WORKSHEETS = "ALL";

type LayoutMode = "SOURCE" | "STAGE_SORTED";

export type ProcedureFlowGraphOpenIssue = { nodeId: string; issueId: string; severity: "ERROR" | "WARNING" };

/**
 * Read-only flowchart viewer (Phase 3B: standardized visual language) — no
 * editing (no onNodesChange/onEdgesChange wired up, nodes/edges are not
 * draggable-and-persisted). Node shape/color/icon, edge style, and layout
 * spacing come entirely from procedure-visual-language.ts, the same config
 * every other screen (validation-resolution, future editor) reuses — never
 * invented locally here.
 */
export default function ProcedureFlowGraph({
  templateId,
  nodes: nodeRows,
  edges: edgeRows,
  openIssuesByNodeId = [],
  initialWorksheet = null,
  initialSelectedNodeId = null,
  errorFocusMode = false,
}: {
  templateId: string;
  nodes: ProcedureTemplateNodeRow[];
  edges: ProcedureTemplateEdgeRow[];
  openIssuesByNodeId?: ProcedureFlowGraphOpenIssue[];
  /** Error-to-node navigation (Phase 3B revision): the worksheet to auto-select on first render, resolved server/screen-side from a validation issue's stable source identity — read once as initial state, not kept in sync afterward (a fresh navigation always remounts this component with fresh values). */
  initialWorksheet?: string | null;
  /** The node id to select and fit the camera to on first render, same one-shot semantics as initialWorksheet. */
  initialSelectedNodeId?: string | null;
  /** Problem 2 revision (오류 집중 보기) — when true and initialSelectedNodeId resolved to a real node, the first camera fit targets the node's immediate connected neighborhood (not just the single node), and unrelated nodes/edges dim much more strongly than an ordinary manual node selection does. */
  errorFocusMode?: boolean;
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
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("SOURCE");
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

  function selectAndFit(nodeId: string) {
    setSelectedNodeId(nodeId);
    reactFlowInstanceRef.current?.fitView({ nodes: [{ id: nodeId }], duration: 300, padding: 1.5 });
  }

  const flowNodes = useMemo<Node[]>(() => {
    const result: Node[] = filteredNodeRows.map((n) => {
      const sourcePos =
        layoutMode === "STAGE_SORTED"
          ? stageSortedLayout.positions.get(n.id) ?? { x: n.positionX, y: n.positionY }
          : { x: n.positionX, y: n.positionY + (n.sourceWorksheet ? bands.get(n.sourceWorksheet)?.yOffset ?? 0 : 0) };
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
      // 원본 배치 — unchanged from Phase 3B: every edge is a plain top/bottom
      // smoothstep (or a bezier for LOOP_BACK/RETRY), no semantic routing.
      return visibleEdgeRows.map((e) => {
        const config = EDGE_VISUAL_CONFIG[e.branchType];
        const isHighlighted = connectedEdgeIds.has(e.id);
        const isDimmed = selectedNodeId !== null && !isHighlighted;
        const dimOpacity = errorFocusMode ? 0.08 : 0.25;
        return {
          id: e.id,
          source: e.fromNodeId,
          target: e.toNodeId,
          sourceHandle: "bottom-out",
          targetHandle: "top-in",
          // LOOP_BACK/RETRY get a curved bezier (`type: "default"`) so a
          // big cross-stage jump reads visually differently from ordinary
          // local smoothstep flow — the two verified RFG LOOP_BACK edges
          // must be "especially easy to identify."
          type: config.routeStyle === "loopback-curve" ? "default" : "smoothstep",
          label: e.branchLabel ?? (config.defaultLabel ? procedureBranchTypeLabels[e.branchType] : undefined),
          labelStyle: { fill: config.strokeLight, fontWeight: 700, fontSize: 10 },
          labelBgStyle: { fill: "#ffffff", fillOpacity: isDimmed ? (errorFocusMode ? 0.15 : 0.3) : 1 },
          labelBgPadding: [3, 2] as [number, number],
          style: {
            stroke: config.strokeLight,
            strokeWidth: isHighlighted ? config.strokeWidth + 1.5 : config.strokeWidth,
            strokeDasharray: config.dashPattern,
            opacity: isDimmed ? dimOpacity : 1,
          },
          markerEnd: { type: config.markerShape === "arrow-open" ? MarkerType.Arrow : MarkerType.ArrowClosed, color: config.strokeLight },
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
            <option value="STAGE_SORTED">단계별 정렬 (컴팩트)</option>
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
        읽기 전용 — 마우스 휠로 확대/축소, 드래그로 이동, 노드를 클릭하면 연결된 경로가 강조되고 나머지는 흐리게
        표시됩니다.
      </p>

      <div style={{ height: 600 }} className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <ReactFlow
          key={`${worksheetFilter}-${layoutMode}`}
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={true}
          onlyRenderVisibleElements
          onInit={(instance) => {
            reactFlowInstanceRef.current = instance;
            const targetId = initialFitNodeIdRef.current;
            if (targetId) {
              initialFitNodeIdRef.current = null;
              // 오류 집중 보기: fit the focused region (the issue node plus
              // its immediate connected neighborhood), not the whole graph —
              // an ordinary node-click fit still targets just the one node.
              const fitTargets = errorFocusMode
                ? [targetId, ...connectedNodeIds].map((id) => ({ id }))
                : [{ id: targetId }];
              requestAnimationFrame(() => {
                instance.fitView({ nodes: fitTargets, duration: 300, padding: 1.5 });
              });
            }
          }}
          onNodeClick={(_, node) => {
            if (node.type === "procedureStageHeader") return;
            setSelectedNodeId((current) => (current === node.id ? null : node.id));
          }}
          onPaneClick={() => setSelectedNodeId(null)}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.02}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable className="!hidden sm:!block" />
        </ReactFlow>
      </div>
    </div>
  );
}
