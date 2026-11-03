"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
  resolveExternalEdgeHighlight,
  GRAPH_VISIBILITY_MODES,
  GRAPH_VISIBILITY_MODE_LABELS,
  type GraphVisibilityMode,
  type RoutableNode,
  type EdgeRouteAssignment,
} from "@/lib/domain/procedure-edge-routing";
import {
  resolveEffectiveNodePosition,
  hasUserLayoutOverride,
  computeLayeredGraphLayout,
  resolveConnectionHandles,
  HORIZONTAL_HANDLE_IDS,
  type ConnectedNodeGeometry,
} from "@/lib/graph-editor-core/layout";
import { resolveEffectiveEdgeRoute, type RoutePoint } from "@/lib/graph-editor-core/routing";
import { resolveDragAxis, applyAxisLock, type DragAxis, type Point } from "@/lib/graph-editor-core/axis-lock";
import { DefaultStraightOrStepEdge, ManualRouteEdge, type ManualRouteEdgeData } from "@/components/graph-editor-core/GraphEdges";
import ProcedureNodeChip from "./visual/ProcedureNodeChip";
import ProcedureGraphLegend from "./visual/ProcedureGraphLegend";

/** Outer-lane routing constants (Problem 1, part D) — presentation-only, how far past the layout's own rightmost content the shared lane pool starts, and how far apart parallel lanes sit. */
const LANE_BASE_GAP = 60;
const LANE_WIDTH = 28;

/**
 * 2026-11-02(조각 10) — 노드 칸에 **바깥에서 붙이는 딱지** 하나. 이 그림은
 * 무엇으로 쓰이는지 모르므로 세기만 받는다:
 *
 *  - STRONG … 지금 눈이 가야 하는 것
 *  - PLAIN  … 보통
 *  - MUTED  … 지나간 것(흐리게)
 *  - WARN   … 막힌 것 · 손이 가야 하는 것
 *
 * 🔴 실행 상태 이름(진행 중·완료·차단됨)을 여기에 적지 않는다 — 그 낱말은 이
 * 그림이 모르는 것이고, 절차 편집기에서도 같은 자리에 다른 뜻의 딱지를 붙이게
 * 되는 날이 온다. 상태 → 세기로 옮기는 일은 쓰는 쪽이 한다
 * (ExecutionStepsGraph — procedure-execution-jump.ts 의 JumpStatusTone).
 */
export type ProcedureFlowGraphNodeMark = { label: string; tone: "STRONG" | "PLAIN" | "MUTED" | "WARN" };

const NODE_MARK_CLASS: Record<ProcedureFlowGraphNodeMark["tone"], string> = {
  STRONG: "border-primary-900 bg-primary-900 text-white dark:border-primary-50 dark:bg-primary-50 dark:text-zinc-900",
  PLAIN: "border-zinc-300 bg-white text-zinc-700 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300",
  MUTED: "border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
  WARN: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300",
};

type ProcedureNodeData = {
  title: string;
  nodeType: ProcedureNodeType;
  sourceWorksheet: string | null;
  sourceShapeId: string | null;
  templateId: string;
  issueBadge: NodeIssueBadge | null;
  mark: ProcedureFlowGraphNodeMark | null;
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
      {/* 가로 직선 연결선 전용(HORIZONTAL_HANDLE_IDS) — 옆면 세로 중앙에 붙어야
          나란히 놓인 두 노드 사이가 진짜 수평선이 된다. 기존 옆면 핸들들
          (left-out 70%, cross-* 80%)은 각자 다른 라우팅이 쓰고 있어 건드리지 않는다. */}
      <Handle id={HORIZONTAL_HANDLE_IDS.rightOut} type="source" position={Position.Right} style={HIDDEN_HANDLE_STYLE} />
      <Handle id={HORIZONTAL_HANDLE_IDS.leftIn} type="target" position={Position.Left} style={HIDDEN_HANDLE_STYLE} />
      <Handle id={HORIZONTAL_HANDLE_IDS.leftOut} type="source" position={Position.Left} style={HIDDEN_HANDLE_STYLE} />
      <Handle id={HORIZONTAL_HANDLE_IDS.rightIn} type="target" position={Position.Right} style={HIDDEN_HANDLE_STYLE} />
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
      {/* 딱지 층 — 모양 층(clip-path) 바깥이라 마름모·문서 꼴에서도 안 잘린다.
          오류 배지가 오른쪽 위에 붙으므로 **왼쪽 위**에 세운다(둘이 한 노드에
          함께 뜰 수 있다). 흐려진 노드에서는 딱지도 같이 흐려져야 한다 —
          혼자 또렷하면 흐리기가 「무엇이 걸렸나」를 가리키는 뜻을 잃는다. */}
      {data.mark && (
        <span
          data-node-mark
          data-node-mark-tone={data.mark.tone}
          className={[
            "pointer-events-none absolute -top-2 -left-2 z-10 rounded-full border px-1.5 py-px text-[9px] font-semibold whitespace-nowrap",
            NODE_MARK_CLASS[data.mark.tone],
            data.isDimmed ? (data.isSeverelyDimmed ? "opacity-15" : "opacity-35") : "opacity-100",
          ].join(" ")}
        >
          {data.mark.label}
        </span>
      )}
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
const edgeTypes = { procedureOuterLane: ProcedureOuterLaneEdge, procedureManualRoute: ManualRouteEdge, procedureDefault: DefaultStraightOrStepEdge };

const ALL_WORKSHEETS = "ALL";

/** Exported for reuse by ProcedureTemplateEditorScreen.tsx, which lifts and controls this value — see this component's own layoutMode/onLayoutModeChange prop doc comment for why. */
export type LayoutMode = "SOURCE" | "USER" | "STAGE_SORTED";

export type ProcedureFlowGraphOpenIssue = { nodeId: string; issueId: string; severity: "ERROR" | "WARNING" };

/**
 * Phase 5C-5B — ProcedureTemplateNodeRow itself now carries userPositionX/Y
 * (previously editor-only, added to the read-only detail query's row shape
 * too so both screens can resolve the same saved override — see this file's
 * own layout-unification notes). EditorNodeRow (a structural superset)
 * satisfies this type as-is.
 *
 * 2026-11-02(조각 7) — `ProcedureTemplateNodeRow` 통째가 아니라 **이 그림이
 * 실제로 읽는 칸만** 받는다. 받는 칸을 줄인 것이라 기존 호출부(절차 상세 ·
 * 편집기)는 그대로 통과한다 — 더 많이 가진 것을 넘기는 쪽은 언제나 맞다.
 *
 * 🔴 까닭은 **실행 화면이 절차를 고를 때 게시된 절차를 전부 실어 보내기**
 * 때문이다(ExecutionStartCard). 전체 행에는 instructions·ngSymptoms 같은 긴 글이
 * 딸려 있어서, 실측으로 게시된 둘만 해도 57KB 가 28KB 로 반이 된다. 지금은
 * 23·28 노드라 어느 쪽이든 싸지만, 개발 DB 에는 **노드 403개짜리 초안**
 * (「RF Generator 전체 표준 절차」)이 있다 — 그것이 게시되는 날 접수 건 화면이
 * 매번 수백 KB 를 더 싣게 된다.
 */
type ProcedureFlowGraphNode = Pick<
  ProcedureTemplateNodeRow,
  | "id"
  | "nodeCode"
  | "nodeType"
  | "title"
  | "positionX"
  | "positionY"
  | "userPositionX"
  | "userPositionY"
  | "sortOrder"
  | "sourceWorksheet"
  | "sourceShapeId"
>;

/**
 * Flowchart viewer (Phase 3B: standardized visual language; Phase 4A:
 * optional controlled-editor affordances). Read-only by default — no
 * editing (no onNodesChange/onEdgesChange wired up, nodes/edges are not
 * draggable-and-persisted) unless `editable` is set, in which case node
 * drag is allowed only in the 사용자 배치 layout and only ever reported
 * back via callbacks; this component itself never persists anything.
 *
 * 🔵 2026-11-03(조각 14) — 끌기를 여는 길이 하나 더 있다: `draggableNodeIds`
 * 는 **그 칸들만** 배치 모드와 무관하게 끌리게 한다. `editable` 과 달리 경로점
 * 편집·배치 드롭다운·「연결선 펴기」는 **같이 안 열린다** — 그 프롭의 주석에
 * 까닭이 있다. 여기서도 저장은 안 한다(onNodeDragStop 으로 알려 줄 뿐이다). Node
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
  onNodeClickIntercept,
  onEdgeSelectionChange,
  onNodeDragStop,
  onNodeDragStart,
  selectedEdgeId = null,
  edgeRoutesByEdgeId,
  selectedWaypointIndex = null,
  onWaypointSelectionChange,
  onWaypointMove,
  onEdgeDoubleClick,
  layoutMode: controlledLayoutMode,
  onLayoutModeChange,
  onInstanceReady,
  showChrome = true,
  highlightedNodeIds = null,
  highlightedEdgeIds = null,
  nodeMarks = null,
  draggableNodeIds = null,
  graphHeight,
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
  /** 노드를 누른 순간, 선택 토글이 일어나기 전에 그 id를 그대로 받는다. true를 돌려주면 "이 클릭은 내가 썼다"는 뜻이며 선택 상태는 바뀌지 않는다(편집기의 "화면에서 선택" 모드용). */
  onNodeClickIntercept?: (nodeId: string) => boolean;
  /** Fires when an edge is clicked — this component has no built-in edge-selection visual state of its own, this is purely a notification for the editor's edge property panel. */
  onEdgeSelectionChange?: (edgeId: string | null) => void;
  /** Fires once a drag gesture ends, in 사용자 배치 layout only — the editor accumulates these client-side and persists them only on an explicit Save, never here. */
  onNodeDragStop?: (nodeId: string, position: { x: number; y: number }) => void;
  /** 드래그가 시작되는 순간 한 번 — 편집기가 "이 드래그 직전 상태"를 되돌리기 단계로 기록할 수 있게 한다(위치 자체는 Stop에서만 넘어온다). */
  onNodeDragStart?: (nodeId: string) => void;
  /** Phase 4B — the editor's currently-selected edge id (lifted to the parent, unlike selectedNodeId which stays local here) — only this edge ever gets draggable waypoint handles. */
  selectedEdgeId?: string | null;
  /** Phase 4B — the editor's *working* (saved + pending-merged) manual route per edge id; absent/undefined for a read-only viewer that never passes this prop at all. Only ever rendered/interactive in 사용자 배치 — see resolveEffectiveEdgeRoute. */
  edgeRoutesByEdgeId?: Map<string, RoutePoint[] | null>;
  /** Phase 4B — which waypoint index (within the selected edge's route) is selected, for the "선택 경로점 삭제" button/keyboard shortcut, owned by the parent so both the graph's handles and the side panel's delete button agree. */
  selectedWaypointIndex?: number | null;
  onWaypointSelectionChange?: (index: number | null) => void;
  /** Fires on every waypoint drag frame — client-state only, same "no auto-save" contract as onNodeDragStop. */
  onWaypointMove?: (edgeId: string, index: number, point: { x: number; y: number }) => void;

  /** 5C-6D-1E — the double-click-on-an-edge shortcut, now "straighten this connection" (aligns the connected nodes; parity with CaseFlowchartGraph's own onEdgeDoubleClick) rather than waypoint insertion — see this component's own handleCanvasEdgeDoubleClick doc comment for the full rationale. Only the edge id is needed; the click position is no longer used. */
  onEdgeDoubleClick?: (edgeId: string) => void;
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
  /** 5C-6D-1D — forwards the live React Flow instance up to the editor screen (same purpose/timing as CaseFlowchartGraph's own onInstanceReady) so a sibling component (NodePropertyPanel, CreateNodePanel) can read each node's REAL measured dimensions (`instance.getInternalNode(id)?.measured`) for relative-position math, rather than a duplicated size estimate. Optional — ProcedureTemplateDetailScreen's read-only usage has no relative-position feature and never passes this. */
  onInstanceReady?: (instance: ReactFlowInstance) => void;
  /**
   * 2026-11-02(조각 7) — 그림 **둘레의 조작 줄**(시트 필터 · 배치 · 연결 표시 ·
   * 검색 · 선택 단추)과 범례, 그리고 「읽기 전용 …」 안내 한 줄을 통째로 그릴지.
   * 기본은 true — 지금까지의 두 호출부(절차 상세 · 편집기)는 아무것도 안 넘기고
   * 글자 하나 안 바뀐다.
   *
   * 🔴 false 로 두는 자리는 **「기술 절차 불러오기」 창** 하나다. 그 창에는 이미
   * 제 절차 드롭다운과 제 노드 검색이 있어서, 이 줄을 함께 그리면 **검색 칸이 둘**
   * 나란히 서고 어느 쪽이 무엇을 하는지 사람이 알 수 없다.
   *
   * 조작 줄을 숨기면 배치는 「원본 배치」에 머문다 — 실측 두 절차는 노드마다
   * user_position 이 전부 차 있어서(23/23 · 28/28) 그것이 사람이 그린 그대로다.
   */
  showChrome?: boolean;
  /**
   * 2026-11-02(조각 7) — **바깥에서 건 강조**. null 이면 지금까지와 똑같다(아무
   * 영향 없음). 배열을 주면 **그 안에 없는 노드가 흐려진다** — 불러오기 창에서
   * 노드 이름을 검색할 때, 맞는 노드가 그림 어디에 있는지 한눈에 보이게 하는 데
   * 쓴다.
   *
   * 선택에 따른 흐리기(선택한 노드의 이웃만 환하게)와 **함께** 걸린다. 다만 고른
   * 노드 자신은 어느 쪽으로도 안 흐려진다 — 고른 것이 흐려지면 무엇을 골랐는지
   * 그림에서 사라진다.
   */
  highlightedNodeIds?: readonly string[] | null;
  /**
   * 2026-11-03(줄기 B-③) — **연결선 쪽의 같은 것.** null 이면 지금까지와
   * 똑같다(아무 영향 없음). 배열을 주면 **그 안에 없는 연결선이 흐려지고**,
   * 안에 있는 연결선은 선택으로 강조될 때와 **같은 모양**(굵기 +1.5, 위로
   * 올라옴)이 된다 — 사람이 새로 배울 것이 없게 위의 highlightedNodeIds 와
   * 짝을 맞춘 것이다.
   *
   * 🔴 쓰는 자리는 **편집기 [검증] 탭**이다. 오류·경고 줄을 누르면 그 줄이
   * 가리키는 노드·연결선만 환하게 남는다. 그 전까지 이 그림에는 「바깥에서
   * 연결선 하나를 짚는」 길이 아예 없었다 — 노드 쪽만 있었다.
   *
   * 🔵 빈 배열은 **전부 흐려진다**는 뜻이다(노드 쪽과 같은 약속). 그래서
   * 「노드만 가리키는 오류」는 이 프롭을 null 로 넘겨야 한다 —
   * procedure-validation-issue-focus.ts 의 focusHighlightProps 가 그 접기를
   * 한 곳에서 한다.
   */
  highlightedEdgeIds?: readonly string[] | null;
  /**
   * 2026-11-02(조각 10) — 노드 id → **그 칸에 붙일 딱지**. null 이거나 지도에
   * 없는 노드에는 아무것도 안 붙는다(지금까지의 호출부 셋은 안 넘기므로 글자
   * 하나 안 바뀐다).
   *
   * 🔴 쓰는 자리는 **「전체 단계 보기」 팝업** 하나다. 실행 중에는 같은 그림을
   * 봐도 「이 노드가 지금 어떤 상태인가」가 함께 보여야 고를 수 있는데,
   * highlightedNodeIds 만으로는 그게 안 된다 — 그쪽은 **환하냐 흐리냐** 둘뿐이라
   * 다섯 상태(대기·진행 중·완료·건너뜀·차단됨)를 실을 칸이 없다.
   */
  nodeMarks?: ReadonlyMap<string, ProcedureFlowGraphNodeMark> | null;
  /**
   * 2026-11-03(조각 14) — **이 칸들만 끌 수 있다.** null 이면 지금까지와 똑같다
   * (끌 수 있는지는 `editable && layoutMode === "USER"` 하나가 정한다). 그래서
   * 이 프롭을 안 넘기는 호출부 셋(절차 상세 · 편집기 · 「전체 단계 보기」 팝업)은
   * 동작이 글자 하나 안 바뀐다.
   *
   * ──────────────────────────────────────────────────────────────────
   * 🔴 왜 `editable` 로는 안 되는가
   * ──────────────────────────────────────────────────────────────────
   * `editable` 하나가 **드래그와 경로점 편집을 함께** 연다(배치 드롭다운의
   * 「사용자 배치」, 분기 더블클릭의 「연결선 펴기」, 선택한 분기의 경로점
   * 손잡이). 「추가 작업 등록」 창이 필요한 것은 **끌기 하나**다 — 거기서 경로점을
   * 손대면 그 값은 procedure_template_edges.user_route_points 로 가서 **원본
   * 절차가 바뀐다.** 이 창의 전제가 「원본은 한 글자도 안 바꾼다」이므로, 끌기만
   * 따로 열 길이 있어야 한다.
   *
   * 🔵 배치 모드도 안 건드린다. 이 프롭만으로는 layoutMode 가 그대로 "SOURCE"
   * 이고, 거기서도 저장된 사용자 배치는 그대로 이긴다(resolveBaselinePosition).
   *
   * 🔴 끌 수 있는 **칸을 목록으로** 받는 까닭: 그림 위에서 원본 절차의 칸과 이
   * 건에서 더한 칸은 **똑같이 생겼다.** 전부 끌리게 열면 사람이 원본 칸을 끌고,
   * 서버가 거절하는 그 순간까지 화면에서는 움직인 것으로 보인다.
   */
  draggableNodeIds?: readonly string[] | null;
  /** 2026-11-02(조각 7) — 캔버스 높이(px). 생략하면 GraphCanvas 의 기본값(600). 창 안에 들어갈 때는 화면이 좁아 더 낮게 잡는다. */
  graphHeight?: number;
}) {
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
  // Fires the camera fit exactly once, the first time the instance for the
  // initial target becomes ready — cleared immediately after so a later
  // manual worksheet-filter change (which remounts <ReactFlow> via its
  // `key`) never re-triggers the original error's auto-fit.
  const initialFitNodeIdRef = useRef<string | null>(initialSelectedNodeId);

  // 5C-6D-1D — Shift+drag axis lock, ported verbatim from CaseFlowchartGraph
  // (graph-editor-core/axis-lock.ts's own pure resolveDragAxis/applyAxisLock,
  // no second implementation here).
  //
  // 🔵 2026-11-03(조각 14)에 **드래그가 들어오는 길이 둘**이 됐다: 전역 설정
  // (editable && layoutMode === "USER")과, 칸마다 열어 주는 draggableNodeIds 다.
  // 뒤쪽은 어느 배치 모드에서도 열릴 수 있으므로 **이 손잡이들이 모드를 가린다고
  // 적어 두면 거짓**이 된다 — 전에는 앞쪽 하나뿐이라 그렇게 적혀 있었다.
  // 그래도 여기서 모드를 다시 가릴 일은 없다: 축 잠금은 끌 수 있는 칸이면
  // 어디서나 똑같이 들어야 하는 보조 조작이다.
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

  function handleNodeDragStopWithAxisLock(nodeId: string, position: Point) {
    const drag = activeDragRef.current;
    const finalPosition = drag && drag.nodeId === nodeId && drag.shiftHeld && drag.axis !== null ? applyAxisLock(drag.start, position, drag.axis) : position;
    activeDragRef.current = null;
    onNodeDragStop?.(nodeId, finalPosition);
  }

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
    // "화면에서 선택" 같은 고르기 모드가 이 클릭을 가져갈 수 있다. 이 그래프는
    // 선택 상태를 스스로 들고 있고, 이미 선택된 노드를 다시 누르면 선택을
    // 해제(toggle)하므로 — 고르기를 선택 변경 통지(onNodeSelectionChange)로
    // 받으면 "같은 노드를 다시 고르기"가 선택 해제로 둔갑한다. 그래서 누른
    // 노드 id를 있는 그대로 먼저 넘기고, 소비되면 선택은 건드리지 않는다.
    if (onNodeClickIntercept?.(nodeId)) return;
    onEdgeSelectionChange?.(null);
    setSelectedNodeId((current) => (current === nodeId ? null : nodeId));
  }

  function handleCanvasPaneClick() {
    setSelectedNodeId(null);
    onEdgeSelectionChange?.(null);
  }

  /**
   * 5C-6D-1E — double-click now selects the edge AND (in editable 사용자
   * 배치 only) requests a "straighten this connection" alignment —
   * parity with CaseFlowchartGraph's own double-click meaning. No longer
   * inserts a waypoint (that conflicting meaning is retired per the
   * approved 1E decision); explicit waypoint add/remove/reset stays fully
   * available via the edge panel's own controls (onAddWaypoint etc.,
   * unchanged). Edge selection itself always happens on any double click,
   * regardless of mode — only the straighten REQUEST is gated to editable
   * USER mode, same gate node dragging and the waypoint handles use. The
   * actual straighten math/state lives in the screen
   * (ProcedureTemplateEditorScreen), never here — this component only
   * forwards the click.
   */
  function handleCanvasEdgeDoubleClick(edgeId: string) {
    onEdgeSelectionChange?.(edgeId);
    if (!editable || layoutMode !== "USER") return;
    onEdgeDoubleClick?.(edgeId);
  }

  function handleCanvasInit(instance: ReactFlowInstance) {
    reactFlowInstanceRef.current = instance;
    onInstanceReady?.(instance);
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

  // 바깥에서 건 강조(highlightedNodeIds)를 빠른 조회로. null 이면 아예 안 만든다 —
  // 「걸지 않았다」와 「하나도 안 걸렸다(빈 배열)」는 뜻이 정반대다: 전자는 아무것도
  // 안 흐려지고, 후자는 전부 흐려진다(검색어는 쳤는데 맞는 것이 없는 상태).
  const highlightedNodeIdSet = useMemo(
    () => (highlightedNodeIds === null ? null : new Set(highlightedNodeIds)),
    [highlightedNodeIds]
  );

  // 연결선 쪽의 같은 것(줄기 B-③). 위와 똑같이 null 과 빈 배열이 다른 뜻이다.
  const highlightedEdgeIdSet = useMemo(
    () => (highlightedEdgeIds === null ? null : new Set(highlightedEdgeIds)),
    [highlightedEdgeIds]
  );

  // 끌 수 있는 칸(조각 14). null 이면 아예 안 만든다 — 그래야 아래에서
  // 「안 넘겼다」와 「하나도 못 끈다(빈 배열)」가 갈린다. 앞은 React Flow 의
  // 전역 설정(nodesDraggable)에 맡기는 것이고, 뒤는 **전부 못 끄게** 하는 것이다.
  const draggableNodeIdSet = useMemo(
    () => (draggableNodeIds === null ? null : new Set(draggableNodeIds)),
    [draggableNodeIds]
  );

  const flowNodes = useMemo<Node[]>(() => {
    const result: Node[] = filteredNodeRows.map((n) => {
      const sourcePos = layoutMode === "STAGE_SORTED" ? (stageSortedLayout.positions.get(n.id) ?? { x: n.positionX, y: n.positionY }) : resolveBaselinePosition(n);
      const isSelected = n.id === selectedNodeId;
      const dimmedBySelection = selectedNodeId !== null && !connectedNodeIds.has(n.id);
      const dimmedByHighlight = highlightedNodeIdSet !== null && !highlightedNodeIdSet.has(n.id);
      return {
        id: n.id,
        type: "procedureNode",
        position: sourcePos,
        // 🔴 React Flow 는 **칸마다 적힌 draggable 이 전역 설정보다 먼저**다.
        //    그래서 nodesDraggable 이 false 인 읽기 전용 그림에서도 여기 적힌
        //    칸만 끌 수 있다(바로 아래 단계 머리띠가 draggable: false 로
        //    고정돼 있는 것과 같은 길이다). 안 넘겼으면 undefined 를 둬서
        //    전역 설정이 그대로 정하게 한다 — false 를 넣으면 편집기에서
        //    아무것도 못 끌게 된다.
        draggable: draggableNodeIdSet === null ? undefined : draggableNodeIdSet.has(n.id),
        data: {
          title: n.title,
          nodeType: n.nodeType,
          sourceWorksheet: n.sourceWorksheet,
          sourceShapeId: n.sourceShapeId,
          templateId,
          issueBadge: issueBadgeByNodeId.get(n.id) ?? null,
          mark: nodeMarks?.get(n.id) ?? null,
          isSelected,
          isDimmed: !isSelected && (dimmedBySelection || dimmedByHighlight),
          isSeverelyDimmed: errorFocusMode && dimmedBySelection,
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
    highlightedNodeIdSet,
    nodeMarks,
    draggableNodeIdSet,
  ]);

  const flowEdges = useMemo<Edge[]>(() => {
    const visibleNodeIds = new Set(filteredNodeRows.map((n) => n.id));
    const visibleEdgeRows = edgeRows.filter((e) => visibleNodeIds.has(e.fromNodeId) && visibleNodeIds.has(e.toNodeId));

    // 가로/세로 중 어느 쪽으로 붙일지는 두 노드의 실제 배치로 정한다 —
    // resolveConnectionHandles가 판단하고, 여기서는 그 판단에 필요한 기하만
    // 모아 넘긴다. STAGE_SORTED(아래 분기)는 자체 라우팅 규칙이 있어 쓰지 않는다.
    const nodeGeometryById = new Map<string, ConnectedNodeGeometry>();
    for (const n of filteredNodeRows) {
      const position = resolveBaselinePosition(n);
      const dims = nodeDimsById.get(n.id);
      if (!dims) continue;
      nodeGeometryById.set(n.id, { x: position.x, y: position.y, width: dims.width, height: dims.height });
    }

    if (layoutMode !== "STAGE_SORTED") {
      // 원본 배치 / 사용자 배치 — unchanged from Phase 3B: every edge is a
      // plain top/bottom smoothstep (or a bezier for LOOP_BACK/RETRY), no
      // semantic routing — UNLESS (Phase 4B) it has a manual route override
      // and we're actually in 사용자 배치, in which case it renders through
      // ManualRouteEdge (graph-editor-core/GraphEdges.tsx) instead. resolveEffectiveEdgeRoute already
      // encodes "only USER layout" — 원본 배치 never sees a manual route
      // even if one is stored, by construction, not by an extra check here.
      return visibleEdgeRows.map((e) => {
        const config = EDGE_VISUAL_CONFIG[e.branchType];
        const isHighlighted = connectedEdgeIds.has(e.id);
        const isDimmed = selectedNodeId !== null && !isHighlighted;
        const dimOpacity = errorFocusMode ? 0.08 : 0.25;
        // 바깥에서 건 강조(줄기 B-③) — 선택에 따른 강조/흐리기와 **함께** 걸린다.
        // 🔴 짚힌 선은 어느 쪽으로도 안 흐려진다. 노드 쪽에서 "고른 것은 안
        //    흐려진다"로 이미 정해 둔 규칙과 같다 — 짚어 준 것이 흐려지면
        //    무엇을 짚었는지가 그림에서 사라진다.
        const external = resolveExternalEdgeHighlight(e.id, highlightedEdgeIdSet);
        const isEmphasized = isHighlighted || external.pinned;
        const isFaded = !external.pinned && (isDimmed || external.muted);
        const effectiveRoute = resolveEffectiveEdgeRoute({ userRoutePoints: edgeRoutesByEdgeId?.get(e.id) ?? null }, layoutMode);

        const style = {
          stroke: config.strokeLight,
          strokeWidth: isEmphasized ? config.strokeWidth + 1.5 : config.strokeWidth,
          strokeDasharray: config.dashPattern,
          opacity: isFaded ? dimOpacity : 1,
        };
        const labelStyle = { fill: config.strokeLight, fontWeight: 700, fontSize: 10 };
        const labelBgStyle = { fill: "#ffffff", fillOpacity: isFaded ? (errorFocusMode ? 0.15 : 0.3) : 1 };
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
            zIndex: isEmphasized ? 10 : 0,
          } satisfies Edge;
        }

        // LOOP_BACK/RETRY(아래 bezier)는 크게 도는 곡선이 그 자체로 의미라
        // 항상 아래→위로 둔다 — 옆면에 붙이면 그 구분이 사라진다.
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
          // LOOP_BACK/RETRY get a curved bezier (`type: "default"`) so a
          // big cross-stage jump reads visually differently from ordinary
          // local smoothstep flow — the two verified RFG LOOP_BACK edges
          // must be "especially easy to identify." Every other edge here
          // renders through DefaultStraightOrStepEdge (graph-editor-core/GraphEdges.tsx), which decides straight-
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
          zIndex: isEmphasized ? 10 : 0,
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

      // 바깥에서 건 강조(줄기 B-③). 위 분기와 같은 규칙이되, 이 배치에서는
      // 흐리기의 기준값을 「연결 표시」 모드가 이미 정해 두었다(visibility.opacity).
      // 🔴 그래서 짚힌 선은 그 값을 **덮어쓰고** 1 로 올린다 — 그 모드가 흐리게
      //    잡아 놓은 선이라도 짚어 준 이상 보여야 한다. 반대로 짚기 밖의 선은
      //    모드가 정한 값보다 더 흐려지기만 한다(더 진해지지 않는다).
      // 🔵 visibility.hidden 은 건드리지 않는다. 그건 사람이 직접 고른 「연결
      //    표시」 필터이고, 여기서 되살리면 고른 적 없는 선이 되살아난다.
      const external = resolveExternalEdgeHighlight(e.id, highlightedEdgeIdSet);
      const isEmphasized = isHighlighted || external.pinned;
      const effectiveOpacity = external.pinned ? 1 : external.muted ? Math.min(visibility.opacity, 0.25) : visibility.opacity;

      const style = {
        stroke: config.strokeLight,
        strokeWidth: isEmphasized ? config.strokeWidth + 1.5 : config.strokeWidth,
        strokeDasharray: config.dashPattern,
        opacity: effectiveOpacity,
      };
      const labelBgStyle = { fill: "#ffffff", fillOpacity: effectiveOpacity < 1 ? Math.max(effectiveOpacity, 0.3) : 1 };
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
          zIndex: isEmphasized ? 10 : 5,
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
        zIndex: isEmphasized ? 10 : 0,
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
    resolveBaselinePosition,
    stageSortedLayout,
    laneAssignment,
    editable,
    edgeRoutesByEdgeId,
    selectedEdgeId,
    selectedWaypointIndex,
    onWaypointSelectionChange,
    onWaypointMove,
    highlightedEdgeIdSet,
  ]);

  if (nodeRows.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {showChrome && (
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
      )}

      {showChrome && <ProcedureGraphLegend />}

      {showChrome && (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {editable
          ? "편집 모드 — 사용자 배치에서는 노드를 드래그해 위치를 조정하고, 분기를 선택한 뒤 경로점을 추가/이동/삭제해 연결선 경로를 조정할 수 있습니다 (명시적으로 저장하기 전까지 반영되지 않습니다). 노드/분기를 클릭하면 연결된 경로가 강조되고 나머지는 흐리게 표시됩니다."
          : "읽기 전용 — 마우스 휠로 확대/축소, 드래그로 이동, 노드를 클릭하면 연결된 경로가 강조되고 나머지는 흐리게 표시됩니다."}
      </p>
      )}

      <GraphCanvas
        remountKey={`${worksheetFilter}-${layoutMode}`}
        height={graphHeight}
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={editable && layoutMode === "USER"}
        nodesConnectable={false}
        elementsSelectable={true}
        minZoom={0.02}
        // Procedure has no multi-select workflow (confirmed by the 5C-6D-1
        // architecture audit) — Shift is reserved for axis-locked dragging
        // in editable 사용자 배치, same as Case Flowchart's own
        // CaseFlowchartGraph. React Flow's default selectionKeyCode
        // ("Shift") would otherwise pre-empt a Shift-held node drag
        // entirely and start a box-selection gesture instead.
        selectionKeyCode={null}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStopWithAxisLock}
        onEdgeClick={onEdgeSelectionChange}
        onEdgeDoubleClick={handleCanvasEdgeDoubleClick}
        onInit={handleCanvasInit}
        onNodeClick={handleCanvasNodeClick}
        onPaneClick={handleCanvasPaneClick}
      />
    </div>
  );
}
