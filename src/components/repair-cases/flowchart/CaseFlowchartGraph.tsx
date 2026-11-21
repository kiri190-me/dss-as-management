"use client";

import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Handle, MarkerType, Position, type Edge, type Node, type NodeProps, type ReactFlowInstance } from "@xyflow/react";
import GraphCanvas from "@/components/graph-editor-core/GraphCanvas";
import { DefaultStraightOrStepEdge, ManualRouteEdge, type ManualRouteEdgeData } from "@/components/graph-editor-core/GraphEdges";
import { computeConnectedIds } from "@/lib/graph-editor-core/selection";
import type { RoutePoint } from "@/lib/graph-editor-core/routing";
import { resolveDragAxis, applyAxisLock, applyAxisLockToMoves, type AxisLockMove, type DragAxis, type Point } from "@/lib/graph-editor-core/axis-lock";
import {
  resolveConnectionHandles,
  resolveEffectiveNodeDimensions,
  HORIZONTAL_HANDLE_IDS,
  type ConnectedNodeGeometry,
} from "@/lib/graph-editor-core/layout";
import { findNodeIdsInSelectionBox, toggleNodeInSelection, type BoxSelectableNode, type SelectionBox } from "@/lib/graph-editor-core/box-selection";
import { EDGE_VISUAL_CONFIG, NODE_VISUAL_CONFIG, computeNodeDimensions, getNodeChipVisual } from "@/lib/domain/procedure-visual-language";
import { repairCaseFlowchartBranchTypeLabels, type RepairCaseFlowchartNodeType, type RepairCaseFlowchartBranchType } from "@/lib/domain/repair-case-flowchart-types";
import ProcedureNodeChip from "@/components/procedures/visual/ProcedureNodeChip";
import ProcedureCanvasToolPicker, { type ProcedureCanvasTool } from "@/components/procedures/visual/ProcedureCanvasToolPicker";

/**
 * 🔵 도구 단추 부품을 **절차 쪽에서 그대로 들여온다**(2026-11-21, 조각 B2′).
 * 베껴 오지 않는 까닭은 그 파일 머리말에 적혀 있다 — 화면에 나가는 글자가
 * 거기 TOOLS 의 `label`·`title` **한 곳뿐**임을 시험이 지키고 있어서, 복사하면
 * 그 보증이 깨지고 두 화면의 글자가 갈리는 날이 온다.
 * 🔵 이름이 `Procedure*` 인 채로 쓰는 것도 이 파일의 전례 그대로다 — 이 그림은
 *    이미 `ProcedureNodeChip` · `procedure-visual-language` 를 그대로 쓴다
 *    (두 도메인의 노드 유형이 글자까지 같은 부분집합이라서다, 위 머리말 참조).
 *    이름을 바꾸는 일은 이 조각의 일이 아니다.
 */
export type { ProcedureCanvasTool };

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

/**
 * 이 그림이 칸을 **실제로 그리는 자리** — 그림(flow) 좌표계다(2026-11-21, 조각 B2′).
 *
 * 🔴 **한 벌만 있어야 한다.** 아래 두 곳이 이것을 함께 쓴다: React Flow 에 넘기는
 * `position`(= 화면에 그려지는 자리)과, [범위 선택]이 「네모에 닿았는가」를 재는
 * 자리. 한쪽만 제 손으로 `positionX/positionY` 를 읽기 시작하면 **그린 네모와
 * 골라진 칸이 갈리고**, 그것은 오류를 한 번도 안 내고 눈으로만 잡힌다.
 * 🔵 진단 그림에는 절차 쪽 같은 자동 배치가 없다(저장된 좌표 한 쌍뿐 —
 *    repair-case-flowchart-nodes.ts 의 머리말). 그래서 「그린 자리」가 곧 저장된
 *    좌표이고, 이 함수는 오늘 한 줄짜리다. 그래도 **이름을 붙여 한곳에 두는** 까닭은
 *    위 ①이다 — 자리를 바꾸는 날 고칠 곳이 하나여야 한다.
 */
function renderedPosition(n: CaseFlowchartGraphNode): { x: number; y: number } {
  return { x: n.positionX, y: n.positionY };
}

/**
 * 칸 크기의 **추정값** — 화면에 그려 보기 전에 쓰는 결정적 셈이다.
 *
 * 🔵 전에는 아래 `flowEdges` 안에 같은 두 줄이 인라인으로 있었다. [범위 선택]이
 * 같은 추정값을 쓰게 되면서 **이름을 붙여 한곳으로 모았다**(2026-11-21, 조각 B2′) —
 * 두 벌이 되면 「연결선이 붙는 자리」와 「네모에 닿는 자리」가 서로 다른 크기를
 * 보게 된다. 셈 자체는 한 글자도 안 바뀌었다.
 * 🔴 이것은 **추정값일 뿐**이라 제목만 보고 재며 설명(subtitle) 줄을 모른다.
 *    실제로 그려진 크기가 필요한 자리는 아래 `resolveNodeDimensions` 를 쓴다.
 */
function estimatedNodeDimensions(n: CaseFlowchartGraphNode): { width: number; height: number } {
  const { semanticType } = getNodeChipVisual(n.nodeType);
  return computeNodeDimensions({ title: n.title, shape: NODE_VISUAL_CONFIG[semanticType].shape });
}

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
  onNodeClickIntercept,
  onEdgeClick,
  onPaneClick,
  onNodeDragStop,
  onNodeDragStart,
  selectedWaypointIndex = null,
  onWaypointSelectionChange,
  onWaypointMove,
  onInstanceReady,
  onEdgeDoubleClick,
  canvasTool: controlledCanvasTool,
  onCanvasToolChange,
  boxSelectedNodeIds: controlledBoxSelectedNodeIds,
  onBoxSelectionChange,
}: {
  nodes: CaseFlowchartGraphNode[];
  edges: CaseFlowchartGraphEdge[];
  /** Read-only rendering (no drag, no selectable interaction chrome) for viewers without mutation authority — server authorization remains the real boundary regardless of this flag. */
  editable: boolean;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  onNodeClick?: (nodeId: string) => void;
  /**
   * 🔴 **칸을 누른 그 순간, 아무것도 일어나기 전에** 그 id 를 그대로 받는다
   * (2026-11-21, 조각 B3′). `true` 를 돌려주면 「이 클릭은 내가 썼다」는 뜻이고,
   * 그때는 [범위 선택]의 넣기/빼기도 `onNodeClick` 도 **한 글자도 안 돈다.**
   *
   * 🔴 이것이 있어야 하는 까닭은 「화면에서 선택」 둘이다 — [연결 추가]의 **대상
   * 노드 고르기**와 [상대 위치로 이동]의 **기준 노드 고르기**. 그 둘은 고르는
   * 동안 **선택을 옮기면 안 된다**(선택이 옮겨가면 패널이 시작 노드가 바뀐 것으로
   * 보고 작성 중이던 내용을 비운다). 그래서 「고르기가 썼다」와 「선택을 바꿔라」가
   * 한 손잡이에 섞이면 안 되고, 소비 여부를 **돌려받는 길**이 따로 필요하다.
   *
   * 🔴 그리고 이 자리가 [범위 선택]보다 **앞**이어야 한다. 뒤에 두면 그 모드에서
   * 칸을 누를 때 넣기/빼기가 클릭을 먼저 가져가, [화면에서 선택]을 켜고 칸을 눌러도
   * **아무 일도 안 일어난다**(오류도 안 난다 — 2026-11-21 B2′ 가 알고 남겨 둔
   * 자리였고, 이 조각이 그것을 뚫었다). 절차 그림의 `onNodeClickIntercept` 가 같은
   * 뜻·같은 차례다(ProcedureFlowGraph 의 handleCanvasNodeClick).
   *
   * 🔵 안 넘기면 아무 일도 안 한다 — 읽기 전용 그림(작업 기록 흐름도)은 전과 똑같다.
   */
  onNodeClickIntercept?: (nodeId: string) => boolean;
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
  /**
   * 2026-11-21(조각 B2′) — 그림 위에서 **마우스가 하는 일**([선택·이동] / [범위 선택]).
   * 안 넘기면 이 컴포넌트가 제 안에 들고 "POINTER" 로 시작한다. 그래서 이 프롭을
   * 안 넘기는 호출부(작업 기록 흐름도의 읽기 전용 그림)는 글자 하나 안 바뀐다.
   *
   * 🔴 도구 단추 자체는 **끌 수 있는 그림에만** 선다(`editable`) — 끌 수 없는
   * 그림에서 여럿을 골라 봐야 할 수 있는 일이 없고, 거기서 빈 바탕 끌기를 뺏으면
   * **화면을 옮길 길만 사라진다.**
   *
   * 🔴 **모드를 바꾸는 길은 아래 changeCanvasTool 하나**여야 한다. 그 함수가 바꾸는
   * 김에 고른 것을 비운다(두 모드는 선택을 나눠 가진다). 바깥에서 이 값을 제 손으로
   * 갈아 끼우면 **앞 모드에서 고른 것이 그대로 남아** 엉뚱한 칸이 함께 끌린다.
   */
  canvasTool?: ProcedureCanvasTool;
  onCanvasToolChange?: (tool: ProcedureCanvasTool) => void;
  /**
   * [범위 선택]으로 고른 칸들(2026-11-21, 조각 B2′). 안 넘기면 이 컴포넌트가 제
   * 안에 들고 돈다 — 위 canvasTool 과 똑같은 통제형-내부값 겹침이다.
   *
   * 🔴 **올려 보내는 까닭은 다음 조각의 [Delete] 하나**다(B3′). 고른 여럿을 한 번에
   * 지우는 일은 편집기 화면이 맡는다 — 지우기는 「모아 두는 목록에 쌓고 되돌리기 한
   * 칸을 찍는」 일이라 그림이 할 수 있는 일이 아니고, 그림이 키를 들으면 등록이 둘이
   * 되어 한 번 누른 키에 둘이 반응한다.
   *
   * 🔴 **비우는 길은 이 안에 둘뿐**이어야 한다 — changeCanvasTool(모드 전환)과
   * handleCanvasPaneClick(빈 바탕 누르기). 바깥이 제 손으로 비우기 시작하면 「언제
   * 비워지는가」가 두 곳에 적히고, 앞 모드에서 고른 칸이 남아 엉뚱한 칸이 함께 끌린다.
   *
   * 🔵 바꾸는 쪽을 `Dispatch<SetStateAction<…>>` 로 받는 까닭: 아래 두 자리가 **앞
   * 값을 보고 다음 값을 정한다**(누르면 넣기/빼기 · 이미 비었으면 같은 집합 그대로).
   * 값만 받는 콜백으로 좁히면 그 둘이 렌더 시점의 옛 집합을 읽게 된다.
   */
  boxSelectedNodeIds?: ReadonlySet<string>;
  onBoxSelectionChange?: Dispatch<SetStateAction<ReadonlySet<string>>>;
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
  // 🔴 2026-11-21(조각 B2′) — **그 목록이 실제로 길어졌다.** B1′ 때는 「이 그림이
  //    칸에 selected 를 안 실어서 늘 길이 1」이라고 적혀 있었는데, 이 조각이 [범위
  //    선택]을 붙이면서 칸에 싣기 시작했다(아래 flowNodes 의 `selected:`). 그래서
  //    여기 받침 지도가 칸 여럿을 담는 일이 이제 실제로 일어난다 — B1′ 이 미리
  //    깔아 둔 길이 그대로 쓰이는 것이고, 셈은 한 글자도 안 고쳤다.
  const activeDragRef = useRef<{ nodeId: string; start: Point; startById: Map<string, Point>; axis: DragAxis; shiftHeld: boolean } | null>(null);

  /**
   * ──────────────────────────────────────────────────────────────────────
   * [범위 선택] 도구 (2026-11-21, 조각 B2′) — 절차 편집기가 같은 순서로 먼저 갔다
   * (B1 `b4ee0166` → B2 `ced82c74`, 이 집은 B1′ `f7e6d87d` → 이 조각).
   * ──────────────────────────────────────────────────────────────────────
   * 🔴 **두 모드가 선택을 나눠 가진다.** 아래 집합은 [범위 선택] 전용이고, 지금의
   * 단수 선택(`selectedNodeId` — 편집기가 들고 내려보낸다)은 **한 글자도 안 건드린다.**
   * 단수 선택을 쓰는 자리가 많기 때문이다: 속성 패널 · [연결 추가]의 대상 고르기 ·
   * [상대 위치로 이동]의 기준 · [Delete] 키 · 이웃 강조/흐리기. 이 모드에서 하는
   * 일은 **옮기기(와 다음 조각의 지우기)뿐**이라 그 자리들을 하나도 안 고쳐도 된다.
   * 🔵 그래서 모드를 바꾸면 **양쪽 다 비운다**(changeCanvasTool).
   */
  const [internalCanvasTool, setInternalCanvasTool] = useState<ProcedureCanvasTool>("POINTER");
  const canvasTool = controlledCanvasTool ?? internalCanvasTool;
  const [internalBoxSelectedNodeIds, setInternalBoxSelectedNodeIds] = useState<ReadonlySet<string>>(() => new Set<string>());
  const boxSelectedNodeIds = controlledBoxSelectedNodeIds ?? internalBoxSelectedNodeIds;
  const setBoxSelectedNodeIds = onBoxSelectionChange ?? setInternalBoxSelectedNodeIds;
  /**
   * 🔴 [범위 선택]을 **쓸 수 있는 그림인가.** 끌기를 여는 관문(`nodesDraggable={editable}`)과
   * **일부러 같은 값**이다:
   *  - 끌 수 없는 그림에서 여럿을 골라 봐야 할 수 있는 일이 없고,
   *  - 거기서 빈 바탕 끌기를 뺏으면 **화면을 옮길 길만 사라진다**(읽기 전용 화면에서
   *    그림을 보는 방법이 휠과 그 끌기뿐이다).
   * 🔵 절차 그림은 같은 자리가 `editable && layoutMode === "USER"` 다 — 이 그림에는
   *    배치 모드라는 개념이 없어(저장된 좌표 한 쌍뿐) 관문도 그만큼 짧다.
   */
  const canUseBoxSelect = editable;
  const boxSelectActive = canUseBoxSelect && canvasTool === "BOX_SELECT";

  /**
   * 🔴 **도구를 바꾸는 단 하나의 길** — 바꾸는 김에 **고른 것을 비운다.** 안 비우면:
   *  ㉠ [범위 선택]에서 고른 칸이 [선택·이동] 으로 돌아와서도 `selected` 를 단 채
   *     남아, 칸 하나를 끌었을 뿐인데 **보이지 않는 짝들이 함께 끌린다.**
   *  ㉡ 단수 선택이 [범위 선택] 모드까지 따라와, 고르지도 않은 칸의 이웃만 환하고
   *     나머지는 흐린 화면에서 네모를 치게 된다.
   *
   * 🔴 **단수 선택은 이 그림이 안 들고 있다** — 편집기가 들고, 그것을 비우는 한 줄을
   * `onPaneClick`(빈 바탕 누르기)에 걸어 두었다(노드 · 연결선 · 경로점 셋을 한 번에
   * 푼다). 그래서 여기서도 **그 한 줄을 그대로 부른다.** 비우기 전용 프롭을 새로
   * 만들면 「선택을 비운다」가 편집기에 두 벌로 적히고, 어느 날 한쪽만 고쳐진다.
   * 🔵 절차 그림은 단수 선택을 제가 들고 있어 `setSelectedNodeId(null)` 를 직접
   *    부른다 — 하는 일은 같고, 들고 있는 자리만 다르다.
   */
  function changeCanvasTool(nextTool: ProcedureCanvasTool) {
    setBoxSelectedNodeIds(new Set<string>());
    onPaneClick?.();
    (onCanvasToolChange ?? setInternalCanvasTool)(nextTool);
  }

  /**
   * 🔴 [범위 선택] 모드에서는 **칸을 누르는 것이 곧 넣기/빼기**다 — 보조키를 안
   * 쓴다(Shift 는 축 잠금 드래그가 이미 쓰고 있어서, 모드로 갈랐다).
   * 🔵 그 가지는 위로 아무것도 안 알린다 — 편집기의 단수 선택 · 「화면에서 선택」
   *    고르기 모드 · 오른쪽 패널 탭이 전부 `onNodeClick` 에 매달려 있어서, 알리면
   *    고르기만 했는데 패널이 통째로 바뀐다.
   *
   * 🔴 **그래서 차례가 중요하다 — 「화면에서 선택」이 먼저 이긴다**(2026-11-21,
   *    조각 B3′). B2′ 때는 이 가지가 맨 앞이어서, [연결 추가]의 대상 고르기와
   *    [상대 위치로 이동]의 기준 고르기가 이 모드에서 **아무 일도 안 했다**(단추를
   *    누르고 칸을 눌러도 조용했다 — 오류조차 안 났다). 「누르면 아무 일도 안
   *    일어나는 단추」는 이 저장소가 싫어하는 모양이라, 절차 그림과 **같게** 고쳤다:
   *    가로채기가 먼저고, 그것이 클릭을 쓰면 넣기/빼기는 아예 안 돈다
   *    (ProcedureFlowGraph 의 handleCanvasNodeClick 도 같은 차례다).
   * 🔵 가로채기가 **소비하면 아래로 한 글자도 안 흘린다** — 고르는 동안 선택이
   *    옮겨가면 패널이 「시작 노드가 바뀌었다」로 보고 작성 중이던 내용을 비운다.
   */
  function handleCanvasNodeClick(nodeId: string) {
    if (onNodeClickIntercept?.(nodeId)) return;
    if (boxSelectActive) {
      setBoxSelectedNodeIds((current) => toggleNodeInSelection(current, nodeId));
      return;
    }
    onNodeClick?.(nodeId);
  }

  /**
   * 🔵 **빈 바탕을 누르면 고른 것도 비운다.** 끌지 않고 누르기만 한 손짓은 넓이 0
   * 짜리 네모라 캔버스가 아예 안 알리고(box-selection.ts), 그래서 「비우기」는 이
   * 길 하나로 들어온다. 이미 비어 있으면 **같은 집합을 그대로** 돌려줘서 쓸데없이
   * 다시 그리지 않는다.
   */
  function handleCanvasPaneClick() {
    onPaneClick?.();
    setBoxSelectedNodeIds((current) => (current.size === 0 ? current : new Set<string>()));
  }

  /**
   * 칸 크기 — **React Flow 가 실제로 잰 값 우선, 없으면 추정값**(resolveEffectiveNodeDimensions).
   *
   * 🔴 [범위 선택]이 「네모에 닿았는가」를 재는 크기가 이것이다. 새로 추정하지
   * 않는다 — 한 벌이라도 더 만들면 **그린 네모와 골라진 칸이 갈리고**, 그 어긋남은
   * 오류를 한 번도 안 내서 눈으로만 잡힌다.
   * 🔵 CaseFlowchartEditorScreen 에 **같은 조합의 쌍둥이**가 있다(거기 이름도
   *    `resolveNodeDimensions` 다 — 속성 패널의 상대 위치 셈과 [연결선 곧게 펴기]가
   *    쓴다). 그 함수를 프롭으로 받아 쓰지 않은 까닭: 이 그림은 편집기 없이도 서는
   *    화면이 있고(작업 기록 흐름도), 프롭을 선택으로 두면 **안 넘겼을 때 크기가
   *    0×0 으로 떨어져 아무것도 안 골라지는** 조용한 고장이 생긴다. 셈의 규칙 자체는
   *    `resolveEffectiveNodeDimensions` 한 곳에 있으므로 두 조합은 같은 답을 낸다.
   */
  function resolveNodeDimensions(n: CaseFlowchartGraphNode): { width: number; height: number } {
    return resolveEffectiveNodeDimensions(reactFlowInstanceRef.current?.getInternalNode(n.id)?.measured, estimatedNodeDimensions(n));
  }

  /**
   * 점선 네모 하나에 **닿은 칸**을 고른다. 「닿으면 고른다」의 셈 자체는
   * graph-editor-core 의 순수 함수가 한다 — 두 편집기(절차 · 진단)가 같은 답을
   * 내야 해서 거기 있다(box-selection.ts 머리말).
   *
   * 🔴 **좌표계** — 네모는 **그림 좌표**로 들어온다(GraphCanvas 가
   *    `screenToFlowPosition` 으로 옮겨서 넘긴다). 여기서 칸 자리를 재는
   *    `renderedPosition` 도 같은 좌표계다(그 값이 곧 React Flow 에 넘기는
   *    `position` 이다). 한쪽만 화면 px 로 재면 **확대를 바꾸는 순간 어긋나는데**
   *    오류는 안 난다.
   * 🔵 크기를 아직 못 잰 칸은 추정값으로 떨어지고, 0×0 이 되는 칸은 **절대 안
   *    골라진다**(겹침 넓이가 0이다 — box-selection.ts). 화면에 아직 없는 것이 함께
   *    끌리지 않게 하는 쪽이 안전하다.
   */
  function handleBoxSelect(box: SelectionBox) {
    const candidates: BoxSelectableNode[] = nodeRows.map((n) => {
      const position = renderedPosition(n);
      const dimensions = resolveNodeDimensions(n);
      return { id: n.id, x: position.x, y: position.y, width: dimensions.width, height: dimensions.height };
    });
    setBoxSelectedNodeIds(findNodeIdsInSelectionBox(box, candidates));
  }

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

  const flowNodes = useMemo<Node[]>(() => {
    return nodeRows.map((n) => {
      const isBoxSelected = boxSelectActive && boxSelectedNodeIds.has(n.id);
      // 🔵 **고른 것이 눈에 보여야 한다.** 이 그림의 「고름」은 React Flow 기본
      //    `.selected` 스타일이 아니라 칸이 제 손으로 그리는 파란 테두리다
      //    (ProcedureNodeChip 의 `isSelected` → ring). 그래서 [범위 선택]으로 고른
      //    칸도 **같은 칸에 같은 값으로** 실어 준다 — 아래 `selected` 와는 쓰임이
      //    다르다(그쪽은 엔진에게, 이쪽은 사람에게).
      const isSelected = n.id === selectedNodeId || isBoxSelected;
      const isDimmed = selectedNodeId !== null && !isSelected && !connectedNodeIds.has(n.id);
      return {
        id: n.id,
        type: "caseFlowchartNode",
        position: renderedPosition(n),
        data: { title: n.title, description: n.description, nodeType: n.nodeType, isSelected, isDimmed } satisfies CaseFlowchartNodeData,
        // 🔴 **엔진이 함께 끌어 주는 열쇠가 이 한 줄이다**(2026-11-21, 조각 B2′).
        //    React Flow 는 `selected === true` 인 칸을 전부 함께 끌고
        //    (@xyflow/system v0.0.79 의 `getDragItems`), 우리가 넘긴 칸을
        //    `{...userNode}` 로 그대로 복사해 제 안에 둔다(`adoptUserNodes`).
        //    🔵 그래서 **여기 싣는 것만으로** 복수 이동이 되고, 끌어 놓은 자리는
        //       B1′ 이 넓혀 둔 길(movingNodes → onNodeDragStop)로 전부 올라간다.
        //    🔴 바탕 제 선택 기능으로는 이것을 못 만든다 — 이 그림은 칸 목록을
        //       통째로 제가 만들어 넘기고(controlled) `onNodesChange` 를 안 붙여서,
        //       바탕 안에서 일어난 선택 변화는 갈 곳이 없어 그대로 버려진다
        //       (GraphCanvasBoxSelection 의 머리말에 값으로 확인한 경위).
        //    🔵 모드를 벗어나면(`boxSelectActive` 가 거짓) 집합에 무엇이 남아 있든
        //       안 싣는다 — 「[선택·이동] 인데 여럿이 함께 끌리는」 일이 없다.
        selected: isBoxSelected,
        selectable: true,
        draggable: editable,
      } satisfies Node;
    });
    // 🔴 뒤의 둘이 빠지면 **골라도 화면이 그대로다** — 칸 목록이 다시 안 만들어지면
    //    React Flow 는 같은 객체를 그대로 들고 있어(`adoptUserNodes` 가 신원이 같은
    //    칸은 건너뛴다) `selected` 가 영영 참이 되지 않는다.
  }, [nodeRows, selectedNodeId, connectedNodeIds, editable, boxSelectActive, boxSelectedNodeIds]);

  const flowEdges = useMemo<Edge[]>(() => {
    // 절차 편집기와 같은 규칙 — 나란히 놓인 관계는 옆면끼리 붙어 수평 직선이
    // 된다. 크기는 렌더링과 같은 추정치(computeNodeDimensions)를 쓴다.
    const nodeGeometryById = new Map<string, ConnectedNodeGeometry>();
    for (const n of nodeRows) {
      const dims = estimatedNodeDimensions(n);
      const position = renderedPosition(n);
      nodeGeometryById.set(n.id, { x: position.x, y: position.y, width: dims.width, height: dims.height });
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
    // 🔵 조작줄이 생기면서 바깥에 상자 하나가 생겼다 — 전에는 이 컴포넌트가
    //    GraphCanvas 를 그대로 돌려줬다. 절차 그림과 같은 모양이다
    //    (`flex flex-col gap-2` 안에 조작줄 + 그림).
    <div className="flex flex-col gap-2">
      {/*
        🔴 도구 단추는 **끌 수 있는 그림에만** 선다(canUseBoxSelect 의 주석에 까닭 둘).
        읽기 전용으로 그리는 화면(작업 기록 흐름도)은 그 값이 거짓이라 전과 똑같다 —
        조작줄 자체가 안 그려진다.
      */}
      {canUseBoxSelect && (
        <div className="flex flex-wrap items-center gap-3 px-2 pt-2 text-xs">
          <ProcedureCanvasToolPicker tool={canvasTool} onToolChange={changeCanvasTool} selectedCount={boxSelectedNodeIds.size} />
        </div>
      )}
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
        //
        // 🔴 2026-11-21(조각 B2′) — **이 줄은 [범위 선택]이 붙은 뒤에도 그대로다.**
        //    위 문단의 「Case Flowchart has no multi-select feature today」만 옛말이
        //    됐을 뿐, Shift 를 비워 두어야 하는 까닭은 한 치도 안 바뀌었다. 우리
        //    네모는 바탕 제 선택 기능을 아예 안 쓰고 캔버스가 직접 그리기 때문에 둘이
        //    부딪히지 않는다 — 값으로 확인했다(@xyflow/react 12.11.2): `useKeyPress`
        //    는 keyCode 가 null 이면 **듣는 사람을 아예 안 붙여** selectionKeyPressed
        //    가 영영 거짓이고, `isSelecting = selectionKeyPressed || userSelectionActive
        //    || (selectionOnDrag && panOnDrag !== true)` 인데 우리는 `selectionOnDrag`
        //    를 안 넘긴다. 그래서 [범위 선택] 모드에서 panOnDrag 를 끄더라도 바탕 제
        //    선택은 **켜지지 않고**, Shift+끌기는 두 모드 모두에서 전처럼 축 잠금이다.
        //    🔴 거꾸로 말하면 `selectionOnDrag` 를 넘기는 날 그 식이 참이 되어 바탕이
        //       제 네모를 함께 그리기 시작한다 — 넘기지 말 것.
        selectionKeyCode={null}
        // 🔴 **선택 상자를 직접 그린다**(2026-11-21, 조각 B2′) — 바탕 제 선택
        //    기능(위 selectionKeyCode)은 이 그림에서 쓸 수 없다: 선택 변화를 받을
        //    `onNodesChange` 가 없어 **네모만 그려지고 아무것도 안 골라진다.** 까닭
        //    전부는 GraphCanvasBoxSelection 의 머리말에.
        // 🔵 안 켜면([선택·이동] · 읽기 전용 그림) 빈 바탕 끌기는 전과 같은
        //    「화면 옮기기」다.
        boxSelection={{ active: boxSelectActive, onSelect: handleBoxSelect }}
        onInit={(instance) => {
          reactFlowInstanceRef.current = instance;
          onInstanceReady?.(instance);
        }}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onNodeClick={handleCanvasNodeClick}
        onEdgeClick={onEdgeClick}
        onEdgeDoubleClick={(edgeId) => onEdgeDoubleClick?.(edgeId)}
        onPaneClick={handleCanvasPaneClick}
      />
    </div>
  );
}
