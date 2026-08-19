"use client";

import { useMemo, useRef } from "react";
import { Handle, MarkerType, Position, type Edge, type Node, type NodeProps, type ReactFlowInstance } from "@xyflow/react";
import GraphCanvas from "@/components/graph-editor-core/GraphCanvas";
import { DefaultStraightOrStepEdge, ManualRouteEdge, type ManualRouteEdgeData } from "@/components/graph-editor-core/GraphEdges";
import { computeConnectedIds } from "@/lib/graph-editor-core/selection";
import type { RoutePoint } from "@/lib/graph-editor-core/routing";
import { resolveDragAxis, applyAxisLock, type DragAxis, type Point } from "@/lib/graph-editor-core/axis-lock";
import { resolveConnectionHandles, HORIZONTAL_HANDLE_IDS, type ConnectedNodeGeometry } from "@/lib/graph-editor-core/layout";
import { EDGE_VISUAL_CONFIG, NODE_VISUAL_CONFIG, computeNodeDimensions, getNodeChipVisual } from "@/lib/domain/procedure-visual-language";
import { repairCaseFlowchartBranchTypeLabels, type RepairCaseFlowchartNodeType, type RepairCaseFlowchartBranchType } from "@/lib/domain/repair-case-flowchart-types";
import ProcedureNodeChip from "@/components/procedures/visual/ProcedureNodeChip";

/**
 * Case-flowchart graph adapter (Phase 5C-6D) — converts
 * repair_case_flowchart_* domain nodes/edges into GraphCanvas/React Flow
 * models. Deliberately much smaller than ProcedureFlowGraph.tsx: case
 * flowcharts have no SOURCE/USER/STAGE_SORTED layout-mode distinction (only
 * one positionX/positionY pair — see repair-case-flowchart-nodes.ts's own
 * doc comment), no worksheet bands, no issue badges, no search, no outer-
 * lane routing for cross-worksheet/LOOP_BACK edges. Every node renders at
 * its stored positionX/positionY directly; every edge renders as a plain
 * top/bottom connection, through ManualRouteEdge when it has a saved
 * routePoints override, DefaultStraightOrStepEdge otherwise — both reused
 * unchanged from graph-editor-core/GraphEdges.tsx (Phase 5C-4/6D
 * extraction), never duplicated here.
 *
 * Reuses ProcedureNodeChip + NODE_VISUAL_CONFIG/getNodeChipVisual +
 * EDGE_VISUAL_CONFIG directly: RepairCaseFlowchartNodeType (7 values) and
 * RepairCaseFlowchartBranchType (8 values) are both structurally
 * assignable subtypes of ProcedureNodeType/ProcedureBranchType (identical
 * string literals for every value each domain shares), so the same visual
 * config/shape/color system applies without any case-specific fork — only
 * the branch-type LABEL text uses this domain's own
 * repairCaseFlowchartBranchTypeLabels, never procedure's.
 *
 * Performs zero DB queries and holds zero repair-case authorization logic
 * — purely a presentation adapter over already-loaded domain data, exactly
 * like ProcedureFlowGraph.
 *
 * onEdgeDoubleClick (5C-6D follow-up #6, "double-click an edge to
 * straighten it") is a thin passthrough only — this component holds no
 * straighten/alignment logic itself; CaseFlowchartEditorScreen computes
 * and applies the result. GraphCanvas's own onEdgeDoubleClick already
 * existed (used elsewhere for waypoint insertion); this is simply the
 * first time CaseFlowchartGraph itself wires it through.
 */

export type CaseFlowchartGraphNode = {
  id: string;
  nodeType: RepairCaseFlowchartNodeType;
  title: string;
  description: string | null;
  instructions: string | null;
  positionX: number;
  positionY: number;
};

export type CaseFlowchartGraphEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  branchType: RepairCaseFlowchartBranchType;
  branchLabel: string | null;
  routePoints: RoutePoint[] | null;
};

const HIDDEN_HANDLE_STYLE = { opacity: 0, width: 6, height: 6, pointerEvents: "none" as const };

function CaseFlowchartNodeHandles() {
  return (
    <>
      <Handle id="top-in" type="target" position={Position.Top} style={HIDDEN_HANDLE_STYLE} />
      <Handle id="bottom-out" type="source" position={Position.Bottom} style={HIDDEN_HANDLE_STYLE} />
      {/* 가로 직선 연결선 전용 — 절차 편집기와 같은 id/같은 위치(옆면 세로 중앙)다. */}
      <Handle id={HORIZONTAL_HANDLE_IDS.rightOut} type="source" position={Position.Right} style={HIDDEN_HANDLE_STYLE} />
      <Handle id={HORIZONTAL_HANDLE_IDS.leftIn} type="target" position={Position.Left} style={HIDDEN_HANDLE_STYLE} />
      <Handle id={HORIZONTAL_HANDLE_IDS.leftOut} type="source" position={Position.Left} style={HIDDEN_HANDLE_STYLE} />
      <Handle id={HORIZONTAL_HANDLE_IDS.rightIn} type="target" position={Position.Right} style={HIDDEN_HANDLE_STYLE} />
    </>
  );
}

type CaseFlowchartNodeData = {
  title: string;
  description: string | null;
  nodeType: RepairCaseFlowchartNodeType;
  isSelected: boolean;
  isDimmed: boolean;
};

function CaseFlowchartNode({ data }: NodeProps & { data: CaseFlowchartNodeData }) {
  const { semanticType, iconKey } = getNodeChipVisual(data.nodeType);
  return (
    <div className="relative">
      <CaseFlowchartNodeHandles />
      <ProcedureNodeChip
        semanticType={semanticType}
        iconKey={iconKey}
        title={data.title}
        subtitle={data.description}
        size="graph"
        isSelected={data.isSelected}
        isDimmed={data.isDimmed}
      />
    </div>
  );
}

const nodeTypes = { caseFlowchartNode: CaseFlowchartNode };
const edgeTypes = { caseFlowchartManualRoute: ManualRouteEdge, caseFlowchartDefault: DefaultStraightOrStepEdge };

export default function CaseFlowchartGraph({
  nodes: nodeRows,
  edges: edgeRows,
  editable,
  selectedNodeId,
  selectedEdgeId,
  onNodeClick,
  onEdgeClick,
  onPaneClick,
  onNodeDragStop,
  onNodeDragStart,
  selectedWaypointIndex = null,
  onWaypointSelectionChange,
  onWaypointMove,
  onInstanceReady,
  onEdgeDoubleClick,
}: {
  nodes: CaseFlowchartGraphNode[];
  edges: CaseFlowchartGraphEdge[];
  /** Read-only rendering (no drag, no selectable interaction chrome) for viewers without mutation authority — server authorization remains the real boundary regardless of this flag. */
  editable: boolean;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  onNodeClick?: (nodeId: string) => void;
  onEdgeClick?: (edgeId: string) => void;
  onPaneClick?: () => void;
  onNodeDragStop?: (nodeId: string, position: { x: number; y: number }) => void;
  /** 드래그가 시작되는 순간 한 번 — 편집기가 "이 드래그 직전 상태"를 되돌리기 단계로 기록할 수 있게 한다(절차 편집기와 같은 규약). */
  onNodeDragStart?: (nodeId: string) => void;
  selectedWaypointIndex?: number | null;
  onWaypointSelectionChange?: (index: number | null) => void;
  onWaypointMove?: (edgeId: string, index: number, point: RoutePoint) => void;

  /** Forwards the live React Flow instance up to the screen (5C-6D follow-up #4/#5) — lets a sibling component (the node property panel, and the screen itself) read each node's REAL measured dimensions (`instance.getInternalNode(id)?.measured`) for relative-position/straighten-connection math, rather than a duplicated size estimate that can drift from what's actually rendered. Fired once, same timing as GraphCanvas's own onInit. */
  onInstanceReady?: (instance: ReactFlowInstance) => void;
  /** Fires on an edge double-click, with just the case-flowchart edge id (GraphCanvas's own onEdgeDoubleClick also carries a flow-space click point, unused by this checkpoint's "double-click straightens the connection" feature — see CaseFlowchartEditorScreen's own doc comment). */
  onEdgeDoubleClick?: (edgeId: string) => void;
}) {
  // Shift+drag axis lock (5C-6D follow-up #2) — whether Shift was held at
  // drag-start decides whether this WHOLE drag gesture is axis-constrained
  // (see axis-lock.ts's own doc comment for why mid-drag toggling was
  // deliberately not attempted). The instance ref lets onNodeDrag
  // imperatively snap the live-dragged node back onto the locked axis on
  // every frame — GraphCanvas renders React Flow uncontrolled-during-drag
  // by design (no onNodesChange), so visually constraining the path
  // requires reasserting the position through React Flow's own instance
  // API, not this component's own (unchanged, stale-during-the-drag)
  // `nodes` prop.
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const activeDragRef = useRef<{ nodeId: string; start: Point; axis: DragAxis; shiftHeld: boolean } | null>(null);

  function handleNodeDragStart(nodeId: string, position: Point, shiftKey: boolean) {
    activeDragRef.current = { nodeId, start: position, axis: null, shiftHeld: shiftKey };
    onNodeDragStart?.(nodeId);
  }

  function handleNodeDrag(nodeId: string, position: Point) {
    const drag = activeDragRef.current;
    if (!drag || drag.nodeId !== nodeId || !drag.shiftHeld) return;
    if (drag.axis === null) {
      drag.axis = resolveDragAxis(drag.start, position);
      if (drag.axis === null) return; // still below the commit threshold — let it move freely for now
    }
    const constrained = applyAxisLock(drag.start, position, drag.axis);
    if (constrained.x === position.x && constrained.y === position.y) return;
    reactFlowInstanceRef.current?.setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, position: constrained } : n)));
  }

  function handleNodeDragStop(nodeId: string, position: Point) {
    const drag = activeDragRef.current;
    const finalPosition = drag && drag.nodeId === nodeId && drag.shiftHeld && drag.axis !== null ? applyAxisLock(drag.start, position, drag.axis) : position;
    activeDragRef.current = null;
    onNodeDragStop?.(nodeId, finalPosition);
  }

  const minimalEdges = useMemo(() => edgeRows.map((e) => ({ id: e.id, source: e.fromNodeId, target: e.toNodeId })), [edgeRows]);
  const { nodeIds: connectedNodeIds, edgeIds: connectedEdgeIds } = useMemo(
    () => computeConnectedIds(selectedNodeId ?? null, minimalEdges),
    [selectedNodeId, minimalEdges]
  );

  const flowNodes = useMemo<Node[]>(() => {
    return nodeRows.map((n) => {
      const isSelected = n.id === selectedNodeId;
      const isDimmed = selectedNodeId !== null && !isSelected && !connectedNodeIds.has(n.id);
      return {
        id: n.id,
        type: "caseFlowchartNode",
        position: { x: n.positionX, y: n.positionY },
        data: { title: n.title, description: n.description, nodeType: n.nodeType, isSelected, isDimmed } satisfies CaseFlowchartNodeData,
        selectable: true,
        draggable: editable,
      } satisfies Node;
    });
  }, [nodeRows, selectedNodeId, connectedNodeIds, editable]);

  const flowEdges = useMemo<Edge[]>(() => {
    // 절차 편집기와 같은 규칙 — 나란히 놓인 관계는 옆면끼리 붙어 수평 직선이
    // 된다. 크기는 렌더링과 같은 추정치(computeNodeDimensions)를 쓴다.
    const nodeGeometryById = new Map<string, ConnectedNodeGeometry>();
    for (const n of nodeRows) {
      const { semanticType } = getNodeChipVisual(n.nodeType);
      const dims = computeNodeDimensions({ title: n.title, shape: NODE_VISUAL_CONFIG[semanticType].shape });
      nodeGeometryById.set(n.id, { x: n.positionX, y: n.positionY, width: dims.width, height: dims.height });
    }

    return edgeRows.map((e) => {
      const config = EDGE_VISUAL_CONFIG[e.branchType];
      const isHighlighted = connectedEdgeIds.has(e.id);
      const isDimmed = selectedNodeId !== null && !isHighlighted;
      const style = {
        stroke: config.strokeLight,
        strokeWidth: isHighlighted ? config.strokeWidth + 1.5 : config.strokeWidth,
        strokeDasharray: config.dashPattern,
        opacity: isDimmed ? 0.25 : 1,
      };
      const labelStyle = { fill: config.strokeLight, fontWeight: 700, fontSize: 10 };
      const labelBgStyle = { fill: "#ffffff", fillOpacity: isDimmed ? 0.3 : 1 };
      const label = e.branchLabel ?? (config.defaultLabel ? repairCaseFlowchartBranchTypeLabels[e.branchType] : undefined);
      const markerEnd = { type: config.markerShape === "arrow-open" ? MarkerType.Arrow : MarkerType.ArrowClosed, color: config.strokeLight };
      if (e.routePoints && e.routePoints.length > 0) {
        const isSelectedEdge = editable && e.id === selectedEdgeId;
        return {
          id: e.id,
          source: e.fromNodeId,
          target: e.toNodeId,
          sourceHandle: "bottom-out",
          targetHandle: "top-in",
          type: "caseFlowchartManualRoute",
          data: {
            points: e.routePoints,
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

      // LOOP_BACK/RETRY의 곡선은 그 자체가 구분 표시라 항상 아래→위로 둔다.
      const handles =
        config.routeStyle === "loopback-curve"
          ? { sourceHandle: "bottom-out", targetHandle: "top-in" }
          : resolveConnectionHandles(nodeGeometryById.get(e.fromNodeId), nodeGeometryById.get(e.toNodeId));

      return {
        id: e.id,
        source: e.fromNodeId,
        target: e.toNodeId,
        sourceHandle: handles.sourceHandle,
        targetHandle: handles.targetHandle,
        type: config.routeStyle === "loopback-curve" ? "default" : "caseFlowchartDefault",
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
  }, [edgeRows, nodeRows, connectedEdgeIds, selectedNodeId, editable, selectedEdgeId, selectedWaypointIndex, onWaypointSelectionChange, onWaypointMove]);

  return (
    <GraphCanvas
      remountKey="case-flowchart"
      nodes={flowNodes}
      edges={flowEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      nodesDraggable={editable}
      nodesConnectable={false}
      elementsSelectable={true}
      minZoom={0.05}
      // React Flow's default selectionKeyCode ("Shift") pre-empts a
      // Shift-held node drag entirely — starting a drag on a node while
      // Shift is held is instead treated as a selection-box gesture,
      // which is exactly the "Shift triggers multi-select instead of
      // axis-locked movement" bug reported after manual verification.
      // Case Flowchart has no multi-select feature today, so box-select
      // is disabled outright here, freeing Shift for axis-lock dragging
      // (handleNodeDragStart/handleNodeDrag above). ProcedureFlowGraph is
      // intentionally left unchanged — GraphCanvas's new selectionKeyCode
      // prop defaults to undefined (React Flow's own default) unless a
      // caller opts in, exactly as here.
      selectionKeyCode={null}
      onInit={(instance) => {
        reactFlowInstanceRef.current = instance;
        onInstanceReady?.(instance);
      }}
      onNodeDragStart={handleNodeDragStart}
      onNodeDrag={handleNodeDrag}
      onNodeDragStop={handleNodeDragStop}
      onNodeClick={onNodeClick}
      onEdgeClick={onEdgeClick}
      onEdgeDoubleClick={(edgeId) => onEdgeDoubleClick?.(edgeId)}
      onPaneClick={onPaneClick}
    />
  );
}
