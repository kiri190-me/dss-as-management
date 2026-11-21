"use client";

import { useMemo, useRef } from "react";
import { Handle, MarkerType, Position, type Edge, type Node, type NodeProps, type ReactFlowInstance } from "@xyflow/react";
import GraphCanvas from "@/components/graph-editor-core/GraphCanvas";
import { DefaultStraightOrStepEdge, ManualRouteEdge, type ManualRouteEdgeData } from "@/components/graph-editor-core/GraphEdges";
import { computeConnectedIds } from "@/lib/graph-editor-core/selection";
import type { RoutePoint } from "@/lib/graph-editor-core/routing";
import { resolveDragAxis, applyAxisLock, applyAxisLockToMoves, type AxisLockMove, type DragAxis, type Point } from "@/lib/graph-editor-core/axis-lock";
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

/**
 * 한 번의 끌기가 옮긴 칸 하나 — id 와 놓인 자리(2026-11-21, 조각 B1′).
 *
 * `GraphCanvasDragMove`(캔버스) · `ProcedureNodeDragMove`(절차 그림)와 **같은
 * 모양이지만 이름을 따로 둔다.** 이 파일의 기존 경계 그대로다: 편집기 화면은
 * React Flow 도 graph-editor-core 의 캔버스 부품도 몰라야 하고, 두 그림(절차 ·
 * 진단)은 서로를 import 하지 않는다.
 */
export type CaseFlowchartNodeDragMove = { nodeId: string; position: { x: number; y: number } };

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
  /**
   * 🔴 `moves` 는 **이 손짓이 옮긴 칸 전부**다(2026-11-21, 조각 B1′). 자리를
   * 저장하는 쪽은 앞의 `nodeId`/`position`(끄는 칸 하나)이 아니라 **이것**을
   * 읽어야 한다 — 그러지 않으면 여럿을 함께 끌었을 때 화면은 전부 움직여 놓고
   * [저장]을 누르면 하나만 옮겨져 있는, 오류가 안 나는 결함이 된다.
   * 🔵 오늘은 늘 길이가 1 이고 그 한 칸이 곧 `nodeId` 다(아래 selected 주석).
   */
  onNodeDragStop?: (nodeId: string, position: { x: number; y: number }, moves: readonly CaseFlowchartNodeDragMove[]) => void;
  /** 드래그가 시작되는 순간 한 번 — 편집기가 "이 드래그 직전 상태"를 되돌리기 단계로 기록할 수 있게 한다(절차 편집기와 같은 규약). 🔴 칸이 몇이든 **손짓당 한 번**이다: 칸마다 부르면 [이전]이 칸 수만큼 쌓여 한 번 눌러서는 안 돌아간다. */
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
  // imperatively snap every node this gesture moves back onto the locked
  // axis on every frame (2026-11-21 까지는 「끄는 칸 하나」였다 — 아래 🔴)
  // — GraphCanvas renders React Flow uncontrolled-during-drag
  // by design (no onNodesChange), so visually constraining the path
  // requires reasserting the position through React Flow's own instance
  // API, not this component's own (unchanged, stale-during-the-drag)
  // `nodes` prop.
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
  // 🔴 2026-11-21(조각 B1′) — **한 손짓이 칸 여럿을 옮길 수 있다.** React Flow 는
  // `selected === true` 인 칸을 전부 함께 끌고(@xyflow/system 의 `getDragItems`),
  // GraphCanvas 가 그 목록(`movingNodes`)을 세 손잡이에 넘겨준다
  // (GraphCanvasDragMove 의 머리말에 까닭). 그래서 여기도 「끄는 칸 하나」가
  // 아니라 **움직이는 칸 전부**의 시작 자리를 들고 있는다 — 축 잠금이 각 칸을
  // 제 시작 자리에 걸어야 하기 때문이다(applyAxisLockToMoves 의 결정 ②).
  // 🔵 오늘 이 그림은 칸에 `selected` 를 안 싣는다(아래 flowNodes) — 그래서 그
  //    목록은 늘 길이 1 이고, 아래 셈은 전과 한 치도 다르지 않다. 여럿 고르기
  //    ([범위 선택] 도구)는 다음 조각이 붙인다.
  const activeDragRef = useRef<{ nodeId: string; start: Point; startById: Map<string, Point>; axis: DragAxis; shiftHeld: boolean } | null>(null);

  function handleNodeDragStart(nodeId: string, position: Point, shiftKey: boolean, movingNodes: readonly CaseFlowchartNodeDragMove[]) {
    const startById = new Map<string, Point>(movingNodes.map((m) => [m.nodeId, { x: m.position.x, y: m.position.y }]));
    // 끄는 칸의 받침만은 손잡이가 준 값으로 못 박는다 — 목록에 그 칸이 빠지는
    // 일은 GraphCanvas 가 이미 막지만, 받침이 전과 똑같은 값이어야 축 잠금의
    // 답도 전과 똑같다.
    startById.set(nodeId, position);
    activeDragRef.current = { nodeId, start: position, startById, axis: null, shiftHeld: shiftKey };
    onNodeDragStart?.(nodeId);
  }

  function handleNodeDrag(nodeId: string, position: Point, _shiftKey: boolean, movingNodes: readonly CaseFlowchartNodeDragMove[]) {
    const drag = activeDragRef.current;
    if (!drag || drag.nodeId !== nodeId || !drag.shiftHeld) return;
    if (drag.axis === null) {
      // 🔴 축은 **끄는 칸 하나**로 정한다 — 칸마다 따로 정하면 문턱
      //    (AXIS_LOCK_THRESHOLD)을 넘는 순간이 갈려 어떤 칸은 가로로, 어떤 칸은
      //    세로로 묶일 수 있다. 한 손짓은 한 축이다.
      drag.axis = resolveDragAxis(drag.start, position);
      if (drag.axis === null) return; // still below the commit threshold — let it move freely for now
    }
    const constrained = applyAxisLockToMoves(movingNodes, drag.startById, drag.axis);
    // 실제로 **어긋난 칸만** 다시 꽂는다. 전에는 칸 하나를 두고 「잠근 자리가
    // 지금 자리와 같으면 아무것도 안 한다」였고, 그 아낌을 칸마다 그대로 둔다 —
    // 프레임마다 도는 자리라 헛된 setNodes 는 그림 전체를 다시 그리게 한다.
    const changedById = new Map<string, Point>();
    for (const [index, move] of constrained.entries()) {
      const live = movingNodes[index].position;
      if (move.position.x !== live.x || move.position.y !== live.y) changedById.set(move.nodeId, move.position);
    }
    if (changedById.size === 0) return;
    reactFlowInstanceRef.current?.setNodes((nds) =>
      nds.map((n) => {
        const next = changedById.get(n.id);
        return next ? { ...n, position: next } : n;
      })
    );
  }

  function handleNodeDragStop(nodeId: string, position: Point, movingNodes: readonly CaseFlowchartNodeDragMove[]) {
    const drag = activeDragRef.current;
    const lockedAxis = drag && drag.nodeId === nodeId && drag.shiftHeld ? drag.axis : null;
    const finalMoves: AxisLockMove[] =
      drag && lockedAxis !== null
        ? applyAxisLockToMoves(movingNodes, drag.startById, lockedAxis)
        : movingNodes.map((m) => ({ nodeId: m.nodeId, position: { x: m.position.x, y: m.position.y } }));
    // 끄는 칸 자신의 자리는 전과 똑같은 값이어야 한다 — 목록에서 찾아 쓰되,
    // 못 찾으면 전에 쓰던 셈(칸 하나짜리 applyAxisLock)으로 떨어진다.
    const finalPosition =
      finalMoves.find((m) => m.nodeId === nodeId)?.position ?? (drag && lockedAxis !== null ? applyAxisLock(drag.start, position, lockedAxis) : position);
    activeDragRef.current = null;
    // 🔴 **손짓 한 번에 한 번**이다. 칸마다 부르는 꼴로 고치면 편집기의 되돌리기
    //    단계가 칸 수만큼 쌓여 [이전] 한 번으로는 안 돌아간다.
    onNodeDragStop?.(nodeId, finalPosition, finalMoves);
  }

  const minimalEdges = useMemo(() => edgeRows.map((e) => ({ id: e.id, source: e.fromNodeId, target: e.toNodeId })), [edgeRows]);
  const { nodeIds: connectedNodeIds, edgeIds: connectedEdgeIds } = useMemo(
    () => computeConnectedIds(selectedNodeId ?? null, minimalEdges),
    [selectedNodeId, minimalEdges]
  );

  // 🔴 **칸에 React Flow 의 선택 표시를 안 싣는다**(2026-11-21, 조각 B1′ 현재).
  // 여럿이 함께 끌리는 열쇠가 바로 그 한 줄이다 — React Flow 의 「함께 끌기」는
  // 칸의 그 값이 참이어야 돌고, 이 저장소의 그림들은 칸 목록을 통째로 제가 만들어
  // 넘기면서(controlled) `onNodesChange` 를 안 붙였기에 **바탕 제 선택 기능으로는
  // 그 값을 참으로 만들 길이 없다**(GraphCanvasBoxSelection 의 머리말에 값으로
  // 확인한 경위). 그래서 안 싣는 지금은 한 손짓이 늘 칸 하나만 옮긴다 — 위
  // activeDragRef 가 받는 목록의 길이가 늘 1 인 까닭이고, **이번 조각이 화면
  // 동작을 한 치도 안 바꾸는 까닭**이다. 싣는 일은 [범위 선택]을 붙이는 조각의
  // 몫이다(절차 그림은 그 조각에서 실었다).
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
