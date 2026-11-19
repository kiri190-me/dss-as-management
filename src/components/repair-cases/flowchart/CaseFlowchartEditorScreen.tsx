"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReactFlowInstance } from "@xyflow/react";
import CaseFlowchartGraph, { type CaseFlowchartGraphNode, type CaseFlowchartGraphEdge } from "./CaseFlowchartGraph";
import UndoRedoControls from "@/components/graph-editor-core/UndoRedoControls";
import {
  createUndoStack,
  pushUndoStep,
  undoStep,
  redoStep,
  canUndo as canUndoStack,
  canRedo as canRedoStack,
  type UndoStack,
} from "@/lib/graph-editor-core/undo-stack";
import CaseFlowchartCreateNodePanel from "./CaseFlowchartCreateNodePanel";
import CaseFlowchartNodePropertyPanel, { type CaseFlowchartNodeDraft } from "./CaseFlowchartNodePropertyPanel";
import CaseFlowchartCreateEdgePanel from "./CaseFlowchartCreateEdgePanel";
import CaseFlowchartEdgePropertyPanel, { type CaseFlowchartEdgeDraft } from "./CaseFlowchartEdgePropertyPanel";
import type { RepairCaseFlowchartBranchType, RepairCaseFlowchartNodeType } from "@/lib/domain/repair-case-flowchart-types";
import { updateRepairCaseFlowchartMetadataAction } from "@/lib/server/actions/repair-case-flowcharts";
// 고장 개소 태그 — 다듬는 규칙은 서버와 **같은 함수**를 쓴다. 화면이 제 손으로
// 다듬으면 알약으로 보이는 것과 저장되는 값이 어긋날 수 있고, 그 어긋남은 오류
// 없이 조용하다. 저장되는 값은 늘 서버가 같은 함수로 **다시** 다듬은 것이다.
import {
  addFlowchartFaultTag,
  availableFaultTagSuggestions,
  filterFaultTagOptions,
  normalizeFlowchartFaultTag,
  faultTagsEqual,
} from "@/lib/validation/repair-case-flowchart-input";
import FaultTagSuggestionList from "./FaultTagSuggestionList";
import {
  createRepairCaseFlowchartEdgeAction,
  createRepairCaseFlowchartNodeAction,
  saveRepairCaseFlowchartLayoutAction,
  saveRepairCaseFlowchartEdgeRouteAction,
  updateRepairCaseFlowchartNodeAction,
  changeRepairCaseFlowchartNodeTypeAction,
  updateRepairCaseFlowchartEdgeAction,
  retargetRepairCaseFlowchartEdgeAction,
} from "@/lib/server/actions/repair-case-flowchart-graph";
import { addWaypointAtDefaultPosition, removeWaypoint, moveWaypoint, type RoutePoint } from "@/lib/graph-editor-core/routing";
import { resolveEffectiveNodeDimensions, computeStraightenedConnectedNodePosition } from "@/lib/graph-editor-core/layout";
import { NODE_VISUAL_CONFIG, getNodeChipVisual, computeNodeDimensions } from "@/lib/domain/procedure-visual-language";
import {
  mergeNodeForRender,
  mergeEdgeForRender,
  computeDirtyNodeEntries,
  computeDirtyEdgeEntries,
  computeDirtyRouteEdgeIds,
  computeDirtyPositionNodeIds,
  planSaveSteps,
  runSaveSequence,
  fullySucceededNodeIds,
  fullySucceededEdgeIds,
  succeededRouteEdgeIds,
  succeededPositionNodeIds,
  type SaveStep,
  type SaveStepResult,
  type Position,
} from "@/lib/domain/repair-case-flowchart-editor-save-state";

export type CaseFlowchartMetadata = {
  id: string;
  repairCaseId: string;
  title: string;
  description: string | null;
  /** 고장 개소 태그 — 조회가 NULL 을 [] 로 맞춰 주므로 여기서는 늘 배열이다(repair-case-flowchart-graph.ts). */
  faultTags: string[];
  updatedAt: string;
};

type CaseRightPanelTab = "properties" | "addNode" | "createEdge";

/**
 * Case-flowchart graph editor screen (Phase 5C-6D, editor model corrected
 * in 5C-6D follow-up #2). Deliberately not a clone of
 * ProcedureTemplateEditorScreen.tsx — no template category, no DRAFT/
 * PUBLISHED lifecycle, no validation-issue panel, no version controls, no
 * publish controls, no procedure-template history UI, no Undo/Redo/Restore
 * (6E). Uses the existing 6B/6C query/action layers exclusively.
 *
 * canEdit is a prop computed server-side (the page) from session role +
 * repair-case assignment/lock — a UX convenience only. Every mutation
 * called below independently re-verifies authority server-side; this
 * screen never passes a trusted role/assignment boolean INTO a mutation.
 *
 * ================================ EDITOR MODEL ================================
 *   SERVER BASELINE (nodes/edges props)
 *     + LOCAL DRAFT OVERRIDES (pendingNodeDraftsById / pendingNodePositionsById /
 *       pendingEdgeDraftsById / pendingRoutePointsByEdgeId — all keyed
 *       per-entity, so editing/dragging node A then selecting node B never
 *       loses A's in-progress edit or leaks it into B's display)
 *     = RENDERED GRAPH (renderedNodes/renderedEdges below, via
 *       mergeNodeForRender/mergeEdgeForRender — repair-case-flowchart-
 *       editor-save-state.ts)
 *
 * EVERY editable property (node title/description/type, node position, edge
 * branchType/branchLabel/retarget, edge routePoints) is visible on the
 * canvas THE INSTANT it changes — typing a new title, dragging a node,
 * changing an edge's branch type — with zero server round-trip and no
 * "press Save to see it" step. The canvas always renders from baseline +
 * pending drafts, never from baseline alone; there is exactly one rendered
 * graph, not a separate "visual state" the draft maps have to stay in sync
 * with.
 *
 * DIRTY is always derived by comparing the current draft/position against
 * the live `nodes`/`edges` props (never a separately-tracked boolean) — an
 * entry that round-trips back to its original value (e.g. dragged out and
 * back) stops counting as pending on its own, and a router.refresh()
 * bringing fresh server props automatically re-bases the comparison
 * without discarding any draft the user hasn't saved yet (pending state
 * lives in this component's own React state, which router.refresh()
 * re-renders around, never resets).
 *
 * [저장] is a COMMIT of exactly the rendered state, not a preview trigger:
 * it persists what's already on screen. Node position no longer
 * auto-saves on drag-stop or from the property panel's "상대 위치로
 * 이동" buttons — ALL position changes are pending/dirty like every other
 * field, and only [저장] ever calls saveRepairCaseFlowchartLayoutAction.
 * On success: pending state clears, server baseline catches up (via
 * router.refresh()), button reads 저장할 변경 없음 again. On failure: the
 * canvas keeps showing the local pending state (never snaps back to
 * server values), dirty state remains, retry is just clicking again. A
 * page refresh BEFORE Save can lose unsaved local edits — acceptable for
 * this checkpoint; no browser-local persistence/autosave is added.
 *
 * handleGlobalSave flushes everything in one deterministic sequence: (1)
 * node property/type changes, (2) node positions (one batched layout
 * call), (3) edge property/retarget changes, (4) route changes — chaining
 * each mutation's returned `updatedAt` into the next call's
 * `expectedFlowchartUpdatedAt` (every successful save bumps the token, so
 * concurrent/stale calls would otherwise corrupt each other). Stops at the
 * FIRST failure anywhere in the sequence; already-flushed entries are
 * removed from their pending maps, everything from the failure point
 * onward stays pending for a retry. Never reports 저장 완료 unless the
 * entire sequence succeeded. This is NOT one atomic DB transaction across
 * every change — the underlying server APIs are separate mutations — so a
 * partial failure is a real, surfaced possibility, not something hidden
 * from the user.
 *
 * Relative-position ("상대 위치로 이동") Y-center/X-column alignment (5C-6D
 * follow-up #4/#5) is computed from each node's REAL measured dimensions
 * (React Flow's own `getInternalNode(id)?.measured`, surfaced here via
 * CaseFlowchartGraph's onInstanceReady into reactFlowInstanceRef) rather
 * than a size estimate — see resolveMeasuredNodeDimensions below,
 * graph-editor-core/layout.ts's resolveEffectiveNodeDimensions (the one
 * shared measured-vs-fallback priority rule), and
 * CaseFlowchartNodePropertyPanel's own doc comment for the full story.
 * Root cause (two layers, both real): (1) computeNodeDimensions never
 * accounted for a node's description/subtitle line, so the fallback
 * estimate silently under-measured any node with a description; (2)
 * follow-up #4's first attempt at using measured dimensions called
 * `getNode(id)`, which React Flow resolves to the ORIGINAL unmeasured
 * object this component itself passed in — never the internally-measured
 * node — so `.measured` was undefined on every call and the fix had zero
 * runtime effect despite passing its own tests. `getInternalNode(id)` is
 * the actual fix.
 *
 * Double-click an edge → "straighten this connection" (5C-6D follow-up
 * #6): computeStraightenedConnectedNodePosition (graph-editor-core/
 * layout.ts) moves only the TARGET node's pending position to align
 * visual centers with the fixed SOURCE node, and — if the edge has a
 * manual route — resets it to automatic (`routePoints: null`) as a second
 * pending change. Uses the exact same `resolveNodeDimensions` function
 * instance as the relative-position feature (see handleEdgeDoubleClick's
 * own doc comment below), never a separate geometry path. Both writes are
 * ordinary pending-map updates, so they participate in the normal dirty/
 * Save flow with no special-casing.
 *
 * Node/edge CREATE and DELETE remain immediate server mutations in this
 * checkpoint (not deferred into this draft model) — converting them would
 * mean rendering not-yet-persisted nodes/edges with client-only ids and
 * reconciling them against server ids on save, materially expanding scope
 * beyond "editing existing visible graph properties/positions/routes."
 * =================================================================================
 */
/** 저장 전(아직 서버에 보내지 않은) 편집 상태 전부 — [이전]/[앞으로]가 통째로 갈아끼우는 단위다. */
type CasePendingSnapshot = {
  nodeDrafts: Map<string, CaseFlowchartNodeDraft>;
  nodePositions: Map<string, Position>;
  edgeDrafts: Map<string, CaseFlowchartEdgeDraft>;
  routePoints: Map<string, RoutePoint[] | null>;
};

/**
 * 되돌리기 한 단계. 대부분은 저장 전 상태 스냅샷 하나면 충분하지만, 연결선
 * 삭제는 이미 서버에 반영된 뒤라 화면 상태만 되돌려서는 되살아나지 않는다 —
 * 그런 단계는 무엇을 다시 만들어야 하는지(restoreEdge)를 함께 들고 있다가,
 * 되돌릴 때 서버에 다시 만든다.
 */
type CaseUndoStep = {
  snapshot: CasePendingSnapshot;
  /**
   * 삭제된 노드를 되살리는 단계. 노드 삭제는 연결선이 하나도 남지 않은
   * 노드에서만 허용되므로(deleteRepairCaseFlowchartNodeAction), 되살릴 때
   * 함께 복구할 연결선은 없다 — 노드 하나만 다시 만들면 된다.
   */
  restoreNode?: {
    nodeType: RepairCaseFlowchartNodeType;
    title: string;
    description: string | null;
    instructions: string | null;
    position: { x: number; y: number };
  };
  restoreEdge?: {
    fromNodeId: string;
    toNodeId: string;
    branchType: RepairCaseFlowchartBranchType;
    branchLabel: string | null;
    /** 삭제 시점의 경로점 — 되살린 연결선은 새 id를 받으므로, 그 id로 저장 전 변경에 다시 얹는다. */
    routePoints: RoutePoint[] | null;
  };
};

/** 절차 편집기의 pendingSnapshotSignature와 같은 방식 — 키 순서를 고정해 직렬화한 뒤 비교한다. */
function casePendingSnapshotSignature(snapshot: CasePendingSnapshot): string {
  const dump = (map: Map<string, unknown>) => [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([
    dump(snapshot.nodeDrafts),
    dump(snapshot.nodePositions),
    dump(snapshot.edgeDrafts),
    dump(snapshot.routePoints),
  ]);
}

/**
 * 서버 되살리기가 딸린 단계는 어떤 것과도 같지 않다고 본다 — 화면 상태가
 * 우연히 같더라도 "지워진 연결선을 되살린다"는 할 일이 남아 있어, 합치거나
 * 건너뛰면 그 일이 통째로 사라진다.
 */
function caseUndoStepsEqual(a: CaseUndoStep, b: CaseUndoStep): boolean {
  if (a.restoreEdge || b.restoreEdge || a.restoreNode || b.restoreNode) return false;
  return casePendingSnapshotSignature(a.snapshot) === casePendingSnapshotSignature(b.snapshot);
}

export default function CaseFlowchartEditorScreen({
  repairCaseId,
  flowchart,
  nodes,
  edges,
  canEdit,
  faultTagSuggestions = [],
}: {
  repairCaseId: string;
  flowchart: CaseFlowchartMetadata;
  nodes: CaseFlowchartGraphNode[];
  edges: CaseFlowchartGraphEdge[];
  canEdit: boolean;
  /**
   * 고장 개소 태그의 **고를 목록** — 지금까지 어느 Flowchart 에든 달린 태그를
   * 많이 쓰인 순으로 페이지가 읽어 넘긴다(listUsedRepairCaseFaultTags).
   * 🔵 기본값 `[]` 를 두는 까닭은 목록이 비어도 **적어서 더하는 길이 그대로**
   * 살아 있기 때문이다 — 이 칸은 목록이 없으면 못 쓰는 칸이 아니다.
   */
  faultTagSuggestions?: string[];
}) {
  const router = useRouter();

  // Adjust-state-during-render (same convention as
  // ProcedureTemplateEditorScreen's own currentUpdatedAt/prevTemplateUpdatedAt
  // pair) — resyncs only when the prop itself changes (e.g. after
  // router.refresh() brings a fresh flowchart).
  const [prevFlowchartUpdatedAt, setPrevFlowchartUpdatedAt] = useState(flowchart.updatedAt);
  const [currentUpdatedAt, setCurrentUpdatedAt] = useState(flowchart.updatedAt);
  if (flowchart.updatedAt !== prevFlowchartUpdatedAt) {
    setPrevFlowchartUpdatedAt(flowchart.updatedAt);
    setCurrentUpdatedAt(flowchart.updatedAt);
  }

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedWaypointIndex, setSelectedWaypointIndex] = useState<number | null>(null);
  /**
   * "화면에서 선택" — 연결 추가 패널의 대상 노드를 캔버스 클릭으로 고르는
   * 모드다(ProcedureTemplateEditorScreen과 같은 규칙). 여기 캔버스 콜백은
   * 인라인 함수라 참조 안정성 제약이 없어 ref 없이 state만으로 충분하다.
   *
   * 고르는 동안 화면 선택은 전혀 바뀌지 않는다 — 선택이 옮겨가면 패널이 시작
   * 노드가 바뀐 것으로 보고 작성 중이던 내용을 초기화한다(절차 편집기와 같은 규칙).
   */
  const [isPickingEdgeTarget, setIsPickingEdgeTarget] = useState(false);
  const [pickedEdgeTarget, setPickedEdgeTarget] = useState<{ nodeId: string; seq: number } | null>(null);
  /**
   * "상대 위치로 이동"의 기준 노드를 캔버스에서 고르는 모드 — 대상 노드
   * 고르기와 달리 선택을 옮기지 않는다(선택이 옮겨가면 속성 패널이 다른 노드로
   * 바뀌어, 방금 고른 기준을 쓸 화면이 사라진다).
   */
  const [isPickingReferenceNode, setIsPickingReferenceNode] = useState(false);
  const [pickedReferenceNode, setPickedReferenceNode] = useState<{ nodeId: string; seq: number } | null>(null);

  // Phase B (5C-6D-1F design pass) — right-panel tabs, mirroring
  // ProcedureTemplateEditorScreen's rightPanelTab pattern at the IA level
  // only (no 검증/이력 tabs — Case has neither). Selecting a node or edge on
  // the canvas always jumps to "properties", same as the Procedure screen.
  const [rightPanelTab, setRightPanelTab] = useState<CaseRightPanelTab>("properties");

  const [pendingNodeDraftsById, setPendingNodeDraftsById] = useState<Map<string, CaseFlowchartNodeDraft>>(new Map());
  const [pendingNodePositionsById, setPendingNodePositionsById] = useState<Map<string, Position>>(new Map());
  const [pendingEdgeDraftsById, setPendingEdgeDraftsById] = useState<Map<string, CaseFlowchartEdgeDraft>>(new Map());
  const [pendingRoutePointsByEdgeId, setPendingRoutePointsByEdgeId] = useState<Map<string, RoutePoint[] | null>>(new Map());

  // ---- 저장 전 되돌리기(클라이언트 스냅샷 스택) ----
  //
  // 이 편집기에는 서버 편집 이력이 없다(절차 템플릿과 달리 케이스 Flowchart는
  // 발행/이력 개념이 없는 작업 문서다) — 그래서 [이전]/[앞으로]는 저장하지 않은
  // 변경만 다룬다. 스냅샷 방식과 한 단계의 단위는 절차 편집기와 같다
  // (graph-editor-core/undo-stack.ts 주석 참고).
  const [pendingUndoStack, setPendingUndoStack] = useState<UndoStack<CaseUndoStep>>(() => createUndoStack<CaseUndoStep>());
  const [isUndoing, setIsUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const pendingSnapshotRef = useRef<CasePendingSnapshot>({
    nodeDrafts: new Map(),
    nodePositions: new Map(),
    edgeDrafts: new Map(),
    routePoints: new Map(),
  });
  useEffect(() => {
    pendingSnapshotRef.current = {
      nodeDrafts: pendingNodeDraftsById,
      nodePositions: pendingNodePositionsById,
      edgeDrafts: pendingEdgeDraftsById,
      routePoints: pendingRoutePointsByEdgeId,
    };
  }, [pendingNodeDraftsById, pendingNodePositionsById, pendingEdgeDraftsById, pendingRoutePointsByEdgeId]);

  /** 드래그 한 번이 한 단계다 — 시작할 때만 찍는다. */
  const isNodeDraggingRef = useRef(false);
  /** 글자 입력은 입력칸 단위로 한 단계 — 같은 칸을 계속 고치는 동안에는 단계가 늘지 않는다. */
  const lastFieldEditKeyRef = useRef<string | null>(null);

  function pushPendingUndoStep(fieldEditKey: string | null = null) {
    if (!canEdit) return;
    if (fieldEditKey !== null && lastFieldEditKeyRef.current === fieldEditKey) return;
    lastFieldEditKeyRef.current = fieldEditKey;
    setPendingUndoStack((prev) => pushUndoStep(prev, { snapshot: pendingSnapshotRef.current }, caseUndoStepsEqual));
  }

  /**
   * 연결선 삭제 단계 — 이미 서버에 반영된 삭제라, 되돌리려면 같은 연결선을
   * 다시 만들어야 한다. 그 재료를 이 단계에 함께 담는다.
   */
  function pushEdgeDeletionUndoStep(restoreEdge: NonNullable<CaseUndoStep["restoreEdge"]>) {
    if (!canEdit) return;
    lastFieldEditKeyRef.current = null;
    setPendingUndoStack((prev) => pushUndoStep(prev, { snapshot: pendingSnapshotRef.current, restoreEdge }, caseUndoStepsEqual));
  }

  /** 노드 삭제 단계 — 연결선 삭제와 같은 원리로, 되살릴 재료를 단계에 담아 둔다. */
  function pushNodeDeletionUndoStep(restoreNode: NonNullable<CaseUndoStep["restoreNode"]>) {
    if (!canEdit) return;
    lastFieldEditKeyRef.current = null;
    setPendingUndoStack((prev) => pushUndoStep(prev, { snapshot: pendingSnapshotRef.current, restoreNode }, caseUndoStepsEqual));
  }

  function applyPendingSnapshot(snapshot: CasePendingSnapshot) {
    setPendingNodeDraftsById(new Map(snapshot.nodeDrafts));
    setPendingNodePositionsById(new Map(snapshot.nodePositions));
    setPendingEdgeDraftsById(new Map(snapshot.edgeDrafts));
    setPendingRoutePointsByEdgeId(new Map(snapshot.routePoints));
    lastFieldEditKeyRef.current = null;
  }

  /**
   * [이전] — 저장하지 않은 변경을 한 단계씩 되돌린다. 그 단계가 "삭제된 연결선"
   * 이면 서버에 같은 연결선을 다시 만든다. 되살린 연결선은 새 id를 받으므로
   * 삭제 전 경로점은 그 새 id로 저장 전 변경에 얹어 둔다([저장]으로 확정된다).
   *
   * 서버 작업이 낀 단계는 [앞으로](다시 적용) 대상에서 뺀다 — 되살린 것을 다시
   * 지우는 동작까지 자동으로 해주면, 실수로 한 번 더 눌렀을 때 방금 되살린 것이
   * 조용히 사라진다. 지우려면 삭제 버튼을 다시 누르는 편이 분명하다.
   */
  async function handleUndo() {
    const result = undoStep(pendingUndoStack, { snapshot: pendingSnapshotRef.current }, caseUndoStepsEqual);
    setUndoError(null);
    if (!result.restored) {
      setPendingUndoStack(result.stack);
      return;
    }
    const step = result.restored;
    if (step.restoreNode) {
      setIsUndoing(true);
      const created = await createRepairCaseFlowchartNodeAction({
        repairCaseId,
        flowchartId: flowchart.id,
        nodeType: step.restoreNode.nodeType,
        title: step.restoreNode.title,
        description: step.restoreNode.description,
        position: step.restoreNode.position,
        expectedFlowchartUpdatedAt: currentUpdatedAt,
      });
      if (!created.ok) {
        setIsUndoing(false);
        setUndoError(created.message);
        return;
      }
      // 작업 내용(instructions)은 생성 액션이 받지 않는다 — 만든 직후 한 번 더
      // 채워 넣어야 삭제 전 노드와 같아진다. 이 두 번째 호출이 실패해도 노드
      // 자체는 이미 되살아났으므로, 되돌리기를 무르지 않고 사유만 알린다.
      let latestUpdatedAt = created.updatedAt;
      if (step.restoreNode.instructions && step.restoreNode.instructions.trim().length > 0) {
        const filled = await updateRepairCaseFlowchartNodeAction({
          repairCaseId,
          flowchartId: flowchart.id,
          nodeId: created.nodeId,
          title: step.restoreNode.title,
          description: step.restoreNode.description,
          instructions: step.restoreNode.instructions,
          expectedFlowchartUpdatedAt: latestUpdatedAt,
        });
        if (filled.ok) latestUpdatedAt = filled.updatedAt;
        else setUndoError(`노드는 되살렸지만 작업 내용을 복원하지 못했습니다: ${filled.message}`);
      }
      setIsUndoing(false);
      setPendingUndoStack({ past: result.stack.past, future: [] });
      applyPendingSnapshot(step.snapshot);
      handleSaved(latestUpdatedAt);
      return;
    }

    if (!step.restoreEdge) {
      setPendingUndoStack(result.stack);
      applyPendingSnapshot(step.snapshot);
      return;
    }

    setIsUndoing(true);
    const created = await createRepairCaseFlowchartEdgeAction({
      repairCaseId,
      flowchartId: flowchart.id,
      fromNodeId: step.restoreEdge.fromNodeId,
      toNodeId: step.restoreEdge.toNodeId,
      branchType: step.restoreEdge.branchType,
      branchLabel: step.restoreEdge.branchLabel,
      expectedFlowchartUpdatedAt: currentUpdatedAt,
    });
    setIsUndoing(false);
    if (!created.ok) {
      // 스택은 건드리지 않는다 — 되돌리기가 일어나지 않았으므로 그 단계는 그대로 남아야 한다.
      setUndoError(created.message);
      return;
    }

    setPendingUndoStack({ past: result.stack.past, future: [] });
    applyPendingSnapshot(step.snapshot);
    const restoredRoute = step.restoreEdge.routePoints;
    if (restoredRoute && restoredRoute.length > 0) {
      setPendingRoutePointsByEdgeId((prev) => {
        const next = new Map(prev);
        next.set(created.edgeId, restoredRoute);
        return next;
      });
    }
    handleSaved(created.updatedAt);
  }

  function handleRedo() {
    const result = redoStep(pendingUndoStack, { snapshot: pendingSnapshotRef.current }, caseUndoStepsEqual);
    setPendingUndoStack(result.stack);
    if (result.restored) applyPendingSnapshot(result.restored.snapshot);
  }

  const [titleDraft, setTitleDraft] = useState(flowchart.title);
  const [descriptionDraft, setDescriptionDraft] = useState(flowchart.description ?? "");
  /**
   * 고장 개소 태그 — 저장된 **배열 그대로**를 쥔다(2026-11-19 에 적는 방식이
   * 뒤집혔다: 한 칸에 길게 적는 것이 아니라 고객사 칸처럼 하나씩 더한다).
   * 적는 칸(faultTagInput)은 **아직 더하지 않은 글자**라 이 묶음과 별개다 —
   * 적다 만 글자가 저장될 길은 없다.
   */
  const [faultTagsDraft, setFaultTagsDraft] = useState<string[]>(flowchart.faultTags);
  const [faultTagInput, setFaultTagInput] = useState("");
  /** 방금 **더하려다 안 된** 까닭(중복·상한) — 저장을 막는 값이 아니라 그 자리에서만 읽히는 안내다. */
  const [faultTagError, setFaultTagError] = useState<string | null>(null);
  /**
   * 후보 목록이 펴져 있는가 — 부품 고르개와 같은 방식이다(UsedPartsEditForm 의
   * pickerKey). 칸에 들어오면 펴고, 나가면 접고, Escape 로도 접는다.
   */
  const [isFaultTagPickerOpen, setIsFaultTagPickerOpen] = useState(false);
  const [isSavingMetadata, setIsSavingMetadata] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);

  const [globalSaveStatus, setGlobalSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [globalSaveError, setGlobalSaveError] = useState<string | null>(null);

  // 5C-6D follow-up #4/#5 — the live React Flow instance, captured once via
  // CaseFlowchartGraph's onInstanceReady. Real measured node dimensions
  // come from its `getInternalNode(id)?.measured` — used by the relative-
  // position math in CaseFlowchartNodePropertyPanel so Y-center/X-column
  // alignment is based on what's actually on screen (including a
  // subtitle/description line, which the presentation-only
  // computeNodeDimensions ESTIMATE never accounted for) rather than a
  // second, potentially-drifting size estimator. A ref, not state — the
  // instance itself never changes after mount, and this must never trigger
  // a re-render on its own.
  //
  // Root-cause note (5C-6D follow-up #5): `getNode(id)` — used here in
  // follow-up #4 — is NOT the internally-measured node. Per React Flow's
  // own source (@xyflow/react's useReactFlow hook), `getNode(id)` resolves
  // to `getInternalNode(id)?.internals.userNode` — literally the raw
  // object this component itself passed into the `nodes` prop via
  // CaseFlowchartGraph's `flowNodes`, which never carries a `measured`
  // field at all. `.measured` is undefined there ALWAYS, not merely before
  // the first paint — so follow-up #4's fix silently fell back to the
  // description-blind estimate on every single call, changing nothing at
  // runtime despite type-checking and its own unit tests passing (the
  // tests exercised the pure math with fabricated-correct inputs; the bug
  // was entirely in how this caller obtained its input). `getInternalNode`
  // (also exposed directly on ReactFlowInstance) resolves to React Flow's
  // own `nodeLookup` — the same internal, ResizeObserver-measured node
  // store React Flow's own geometry functions (e.g. evaluateAbsolutePosition)
  // read from — which is the correct, authoritative source.
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);

  /** Raw measured dimensions straight from React Flow's internal node store — each axis independently `number | undefined` until actually measured; `null` only when the node isn't in the RF instance at all. Never finite-checked or defaulted here — resolveEffectiveNodeDimensions (graph-editor-core/layout.ts) is the one place that priority rule lives, applied identically for every node a caller resolves. */
  function resolveMeasuredNodeDimensions(nodeId: string): { width?: number; height?: number } | null {
    return reactFlowInstanceRef.current?.getInternalNode(nodeId)?.measured ?? null;
  }

  /** DETERMINISTIC FALLBACK ONLY, used when a node hasn't been measured yet — presentation-only and, notably, blind to a node's description/subtitle line (only `title` drives it). This is the estimator whose gap with real rendering root-caused the follow-up #5 misalignment bug; kept unchanged here, not patched, since the actual fix is preferring real measured size over it (see resolveNodeDimensions below), not making the estimate itself smarter. */
  function estimatedNodeDimensions(n: CaseFlowchartGraphNode) {
    return computeNodeDimensions({ title: n.title, shape: NODE_VISUAL_CONFIG[getNodeChipVisual(n.nodeType).semanticType].shape });
  }

  /**
   * THE single, shared effective-dimension resolver — measured-first,
   * estimate-fallback (resolveEffectiveNodeDimensions), used identically
   * by CaseFlowchartNodePropertyPanel's relative-position math (passed
   * down as a prop) AND this screen's own handleEdgeDoubleClick straighten
   * logic below. One function instance, not a duplicated composition per
   * caller — this is what guarantees both features read the same runtime
   * geometry (5C-6D follow-up #6's explicit requirement).
   */
  function resolveNodeDimensions(n: CaseFlowchartGraphNode): { width: number; height: number } {
    return resolveEffectiveNodeDimensions(resolveMeasuredNodeDimensions(n.id), estimatedNodeDimensions(n));
  }

  // "저장 완료" is a transient confirmation, not a permanent state — reverts
  // to idle on its own so the button doesn't get stuck claiming a save
  // that already happened minutes ago.
  useEffect(() => {
    if (globalSaveStatus !== "saved") return;
    const timer = setTimeout(() => setGlobalSaveStatus("idle"), 2500);
    return () => clearTimeout(timer);
  }, [globalSaveStatus]);

  function handleSaved(newUpdatedAt: string) {
    setCurrentUpdatedAt(newUpdatedAt);
    router.refresh();
  }

  function handleNodeDeleted(newUpdatedAt: string) {
    if (selectedNodeId) {
      // 삭제 직전 상태를 되돌리기 단계로 남긴다 — 화면에 보이던 값(저장 전
      // 수정/이동이 있었다면 그것) 기준으로 되살린다.
      const deleted = nodes.find((n) => n.id === selectedNodeId);
      const draft = pendingNodeDraftsById.get(selectedNodeId);
      const pendingPosition = pendingNodePositionsById.get(selectedNodeId);
      if (deleted) {
        pushNodeDeletionUndoStep({
          nodeType: draft?.nodeType ?? deleted.nodeType,
          title: (draft ? draft.title.trim() : deleted.title) || deleted.title,
          description: (draft ? draft.description.trim() || null : deleted.description) ?? null,
          instructions: (draft ? draft.instructions.trim() || null : deleted.instructions) ?? null,
          position: pendingPosition ?? { x: deleted.positionX, y: deleted.positionY },
        });
      }
      setPendingNodeDraftsById((prev) => {
        if (!prev.has(selectedNodeId)) return prev;
        const next = new Map(prev);
        next.delete(selectedNodeId);
        return next;
      });
      setPendingNodePositionsById((prev) => {
        if (!prev.has(selectedNodeId)) return prev;
        const next = new Map(prev);
        next.delete(selectedNodeId);
        return next;
      });
    }
    setSelectedNodeId(null);
    handleSaved(newUpdatedAt);
  }

  function handleEdgeDeleted(newUpdatedAt: string) {
    if (selectedEdgeId) {
      // 삭제 직전 상태를 되돌리기 단계로 남긴다 — 화면에 보이던 값(저장 전
      // 수정이 있었다면 그것)을 기준으로, 되살릴 때 같은 연결선이 되도록.
      const deleted = edges.find((e) => e.id === selectedEdgeId);
      const draft = pendingEdgeDraftsById.get(selectedEdgeId);
      if (deleted) {
        pushEdgeDeletionUndoStep({
          fromNodeId: draft?.fromNodeId ?? deleted.fromNodeId,
          toNodeId: draft?.toNodeId ?? deleted.toNodeId,
          branchType: draft?.branchType ?? deleted.branchType,
          branchLabel: (draft ? draft.branchLabel.trim() || null : deleted.branchLabel) ?? null,
          routePoints: pendingRoutePointsByEdgeId.has(selectedEdgeId)
            ? pendingRoutePointsByEdgeId.get(selectedEdgeId) ?? null
            : deleted.routePoints,
        });
      }
      setPendingEdgeDraftsById((prev) => {
        if (!prev.has(selectedEdgeId)) return prev;
        const next = new Map(prev);
        next.delete(selectedEdgeId);
        return next;
      });
      setPendingRoutePointsByEdgeId((prev) => {
        if (!prev.has(selectedEdgeId)) return prev;
        const next = new Map(prev);
        next.delete(selectedEdgeId);
        return next;
      });
    }
    setSelectedEdgeId(null);
    setSelectedWaypointIndex(null);
    handleSaved(newUpdatedAt);
  }

  /** Sets (or replaces) a node's pending position — the ONE place both canvas drag-stop and the property panel's "상대 위치로 이동" buttons funnel through. No mutation call here; position is dirty/pending like every other field, only [저장] persists it. */
  function setPendingNodePosition(nodeId: string, position: Position) {
    // 드래그는 시작할 때 이미 한 단계를 찍었다 — 버튼(상대 위치로 이동)으로 온
    // 호출만 여기서 한 단계가 된다.
    if (!isNodeDraggingRef.current) pushPendingUndoStep();
    setPendingNodePositionsById((prev) => {
      const next = new Map(prev);
      next.set(nodeId, position);
      return next;
    });
  }

  function handleNodeDragStop(nodeId: string, position: Position) {
    if (!canEdit) return;
    setPendingNodePosition(nodeId, position);
    isNodeDraggingRef.current = false;
  }

  /** 드래그 한 번이 되돌리기 한 단계다 — 시작할 때 직전 상태를 찍는다. */
  function handleNodeDragStart() {
    if (!canEdit) return;
    pushPendingUndoStep();
    isNodeDraggingRef.current = true;
  }

  /** 경로점을 누른 시점(=끌기 시작)에 한 단계. 고르기만 하고 끝났다면 상태가 그대로라 [이전]을 누를 때 조용히 버려진다. */
  function handleWaypointSelectionChange(index: number | null) {
    if (index !== null) pushPendingUndoStep();
    setSelectedWaypointIndex(index);
  }

  // ---- node draft (title/description/nodeType) ----

  function nodeDraft(nodeId: string): CaseFlowchartNodeDraft {
    const pending = pendingNodeDraftsById.get(nodeId);
    if (pending) return pending;
    const serverNode = nodes.find((n) => n.id === nodeId);
    return {
      title: serverNode?.title ?? "",
      description: serverNode?.description ?? "",
      instructions: serverNode?.instructions ?? "",
      nodeType: serverNode?.nodeType ?? "TASK",
    };
  }

  function updateNodeDraft(nodeId: string, patch: Partial<CaseFlowchartNodeDraft>) {
    pushPendingUndoStep(`node:${nodeId}:${Object.keys(patch).sort().join(",")}`);
    setPendingNodeDraftsById((prev) => {
      const next = new Map(prev);
      next.set(nodeId, { ...nodeDraft(nodeId), ...patch });
      return next;
    });
  }

  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const dirtyNodeEntries = computeDirtyNodeEntries(pendingNodeDraftsById, nodesById);
  const dirtyPositionNodeIds = computeDirtyPositionNodeIds(pendingNodePositionsById, nodesById);

  // ---- edge draft (branchType/branchLabel/fromNodeId/toNodeId) ----

  function edgeDraft(edgeId: string): CaseFlowchartEdgeDraft {
    const pending = pendingEdgeDraftsById.get(edgeId);
    if (pending) return pending;
    const serverEdge = edges.find((e) => e.id === edgeId);
    return {
      branchType: serverEdge?.branchType ?? "DEFAULT",
      branchLabel: serverEdge?.branchLabel ?? "",
      fromNodeId: serverEdge?.fromNodeId ?? "",
      toNodeId: serverEdge?.toNodeId ?? "",
    };
  }

  function updateEdgeDraft(edgeId: string, patch: Partial<CaseFlowchartEdgeDraft>) {
    pushPendingUndoStep(`edge:${edgeId}:${Object.keys(patch).sort().join(",")}`);
    setPendingEdgeDraftsById((prev) => {
      const next = new Map(prev);
      next.set(edgeId, { ...edgeDraft(edgeId), ...patch });
      return next;
    });
  }

  const edgesById = new Map(edges.map((e) => [e.id, e]));
  const dirtyEdgeEntries = computeDirtyEdgeEntries(pendingEdgeDraftsById, edgesById);

  // ---- route draft (waypoints) ----

  function workingRoutePoints(edgeId: string): RoutePoint[] | null {
    if (pendingRoutePointsByEdgeId.has(edgeId)) return pendingRoutePointsByEdgeId.get(edgeId) ?? null;
    return edges.find((e) => e.id === edgeId)?.routePoints ?? null;
  }

  function handleWaypointMove(edgeId: string, index: number, point: RoutePoint) {
    if (!canEdit) return;
    setPendingRoutePointsByEdgeId((prev) => {
      const next = new Map(prev);
      next.set(edgeId, moveWaypoint(workingRoutePoints(edgeId) ?? [], index, point));
      return next;
    });
  }

  function handleAddWaypoint() {
    if (!canEdit || !selectedEdgeId || !selectedEdge) return;
    const fromNode = renderedNodes.find((n) => n.id === selectedEdge.fromNodeId);
    const toNode = renderedNodes.find((n) => n.id === selectedEdge.toNodeId);
    if (!fromNode || !toNode) return;
    setPendingRoutePointsByEdgeId((prev) => {
      const next = new Map(prev);
      const points = workingRoutePoints(selectedEdgeId) ?? [];
      next.set(selectedEdgeId, addWaypointAtDefaultPosition(points, { x: fromNode.positionX, y: fromNode.positionY }, { x: toNode.positionX, y: toNode.positionY }));
      return next;
    });
  }

  function handleRemoveSelectedWaypoint() {
    if (!canEdit || !selectedEdgeId || selectedWaypointIndex === null) return;
    pushPendingUndoStep();
    setPendingRoutePointsByEdgeId((prev) => {
      const next = new Map(prev);
      next.set(selectedEdgeId, removeWaypoint(workingRoutePoints(selectedEdgeId) ?? [], selectedWaypointIndex));
      return next;
    });
    setSelectedWaypointIndex(null);
  }

  function handleResetRoute() {
    if (!canEdit || !selectedEdgeId) return;
    pushPendingUndoStep();
    setPendingRoutePointsByEdgeId((prev) => {
      const next = new Map(prev);
      next.set(selectedEdgeId, null);
      return next;
    });
    setSelectedWaypointIndex(null);
  }

  /**
   * Double-click an edge → "straighten this connection" (5C-6D follow-up
   * #6). SOURCE (fromNodeId) stays fixed; only TARGET (toNodeId) moves —
   * see computeStraightenedConnectedNodePosition's own doc comment for why
   * only one node moves: it keeps the operation predictable and preserves
   * the upstream layout, rather than averaging/splitting the move across
   * both nodes. A LOCAL pending-position update only — no server mutation,
   * [저장] becomes dirty exactly like a manual drag.
   *
   * If the edge currently has a manual route, it also resets to automatic
   * (`routePoints: null`) as a second pending change from the same click.
   * This applies uniformly across every branch type, INCLUDING RETRY/
   * LOOP_BACK — audited explicitly, not assumed: CaseFlowchartGraph's own
   * `flowEdges` memo already renders a null-routePoints RETRY/LOOP_BACK
   * edge through React Flow's own curved `"default"` type
   * (`config.routeStyle === "loopback-curve"`), its correct semantic
   * rendering — so resetting to null RESTORES that curve rather than
   * fighting it. No branch-type special-casing is needed here as a result.
   *
   * Both writes go through the same pending-map + dirty-comparison
   * machinery as every other draft change, so an already-aligned/already-
   * automatic edge naturally produces no new dirty state on its own (the
   * computed position already equals the current one; a null-vs-null route
   * compares as unchanged) — no separate no-op check needed here.
   */
  function handleEdgeDoubleClick(edgeId: string) {
    if (!canEdit) return;
    const edge = renderedEdges.find((e) => e.id === edgeId);
    if (!edge) return;
    const sourceNode = renderedNodes.find((n) => n.id === edge.fromNodeId);
    const targetNode = renderedNodes.find((n) => n.id === edge.toNodeId);
    if (!sourceNode || !targetNode) return;

    const sourceDims = resolveNodeDimensions(sourceNode);
    const targetDims = resolveNodeDimensions(targetNode);
    const straightened = computeStraightenedConnectedNodePosition(
      { x: sourceNode.positionX, y: sourceNode.positionY, width: sourceDims.width, height: sourceDims.height },
      { x: targetNode.positionX, y: targetNode.positionY, width: targetDims.width, height: targetDims.height }
    );
    setPendingNodePosition(targetNode.id, straightened.position);

    const currentRoute = workingRoutePoints(edgeId);
    if (currentRoute && currentRoute.length > 0) {
      setPendingRoutePointsByEdgeId((prev) => {
        const next = new Map(prev);
        next.set(edgeId, null);
        return next;
      });
    }
  }

  /** Ids whose pending route actually differs from the last-saved edge (so re-adding then removing the same waypoint, ending up back where it started, doesn't count as "pending"). */
  const dirtyRouteEdgeIds = computeDirtyRouteEdgeIds(pendingRoutePointsByEdgeId, edgesById);

  const totalPendingCount = dirtyNodeEntries.length + dirtyPositionNodeIds.length + dirtyEdgeEntries.length + dirtyRouteEdgeIds.length;
  const hasAnyPendingChanges = totalPendingCount > 0;

  // Unsaved-navigation guard (parity with ProcedureTemplateEditorScreen) —
  // covers browser close/refresh; this screen is embedded in a tab (no
  // dedicated "나가기" link of its own to separately confirm).
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!hasAnyPendingChanges) return;
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasAnyPendingChanges]);

  // ---- rendered graph (server baseline + pending drafts, merged) ----

  const renderedNodes: CaseFlowchartGraphNode[] = nodes.map((n) => mergeNodeForRender(n, pendingNodeDraftsById.get(n.id), pendingNodePositionsById.get(n.id)));
  const renderedEdges: CaseFlowchartGraphEdge[] = edges.map((e) => mergeEdgeForRender(e, pendingEdgeDraftsById.get(e.id), pendingRoutePointsByEdgeId.get(e.id)));

  const selectedNode = renderedNodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedEdge = renderedEdges.find((e) => e.id === selectedEdgeId) ?? null;

  /** Executes exactly one planned step against the real mutation layer — the only place in this component that knows which server action a given SaveStep maps to. Ordering, chaining, and stop-on-first-failure all live in runSaveSequence (repair-case-flowchart-editor-save-state.ts), unit-tested there. */
  async function executeSaveStep(step: SaveStep, expectedUpdatedAt: string): Promise<SaveStepResult> {
    if (step.kind === "NODE_FIELDS") {
      const draft = nodeDraft(step.nodeId);
      const result = await updateRepairCaseFlowchartNodeAction({
        repairCaseId,
        flowchartId: flowchart.id,
        nodeId: step.nodeId,
        title: draft.title,
        description: draft.description.trim() || null,
        instructions: draft.instructions.trim() || null,
        expectedFlowchartUpdatedAt: expectedUpdatedAt,
      });
      return result.ok ? { ok: true, updatedAt: result.updatedAt } : { ok: false, message: result.message };
    }
    if (step.kind === "NODE_TYPE") {
      const draft = nodeDraft(step.nodeId);
      const result = await changeRepairCaseFlowchartNodeTypeAction({
        repairCaseId,
        flowchartId: flowchart.id,
        nodeId: step.nodeId,
        nodeType: draft.nodeType,
        expectedFlowchartUpdatedAt: expectedUpdatedAt,
      });
      return result.ok ? { ok: true, updatedAt: result.updatedAt } : { ok: false, message: result.message };
    }
    if (step.kind === "NODE_POSITIONS") {
      const positions = step.nodeIds.map((id) => {
        const pos = pendingNodePositionsById.get(id);
        return { id, positionX: pos?.x ?? 0, positionY: pos?.y ?? 0 };
      });
      const result = await saveRepairCaseFlowchartLayoutAction({
        repairCaseId,
        flowchartId: flowchart.id,
        positions,
        expectedFlowchartUpdatedAt: expectedUpdatedAt,
      });
      return result.ok ? { ok: true, updatedAt: result.updatedAt } : { ok: false, message: result.message };
    }
    if (step.kind === "EDGE_FIELDS") {
      const draft = edgeDraft(step.edgeId);
      const result = await updateRepairCaseFlowchartEdgeAction({
        repairCaseId,
        flowchartId: flowchart.id,
        edgeId: step.edgeId,
        branchType: draft.branchType,
        branchLabel: draft.branchLabel.trim() || null,
        expectedFlowchartUpdatedAt: expectedUpdatedAt,
      });
      return result.ok ? { ok: true, updatedAt: result.updatedAt } : { ok: false, message: result.message };
    }
    if (step.kind === "EDGE_RETARGET") {
      const draft = edgeDraft(step.edgeId);
      const result = await retargetRepairCaseFlowchartEdgeAction({
        repairCaseId,
        flowchartId: flowchart.id,
        edgeId: step.edgeId,
        newFromNodeId: draft.fromNodeId,
        newToNodeId: draft.toNodeId,
        expectedFlowchartUpdatedAt: expectedUpdatedAt,
      });
      return result.ok ? { ok: true, updatedAt: result.updatedAt } : { ok: false, message: result.message };
    }
    // EDGE_ROUTE
    const result = await saveRepairCaseFlowchartEdgeRouteAction({
      repairCaseId,
      flowchartId: flowchart.id,
      edgeId: step.edgeId,
      routePoints: workingRoutePoints(step.edgeId),
      expectedFlowchartUpdatedAt: expectedUpdatedAt,
    });
    return result.ok ? { ok: true, updatedAt: result.updatedAt } : { ok: false, message: result.message };
  }

  /**
   * The editor's SOLE save action — commits exactly what's currently
   * rendered (see this file's own EDITOR MODEL doc comment above).
   * Deterministic order: node property/type changes, then node positions
   * (one batched layout call), then edge property/retarget changes, then
   * route changes — no known dependency forces a different order (a
   * retarget's new endpoints are always EXISTING nodes, never ones created
   * in this same save batch, since node CREATION stays its own immediate
   * action outside this dirty-state model entirely).
   */
  async function handleGlobalSave() {
    if (!hasAnyPendingChanges) return;
    setGlobalSaveStatus("saving");
    setGlobalSaveError(null);

    const steps = planSaveSteps({
      dirtyNodes: dirtyNodeEntries,
      serverNodesById: nodesById,
      dirtyPositionNodeIds,
      dirtyEdges: dirtyEdgeEntries,
      serverEdgesById: edgesById,
      dirtyRouteEdgeIds,
    });

    const outcome = await runSaveSequence(steps, currentUpdatedAt, executeSaveStep);

    const flushedNodeIds = fullySucceededNodeIds(steps, outcome.succeededSteps);
    const flushedPositionNodeIds = succeededPositionNodeIds(outcome.succeededSteps);
    const flushedEdgeIds = fullySucceededEdgeIds(steps, outcome.succeededSteps);
    const flushedRouteEdgeIds = succeededRouteEdgeIds(outcome.succeededSteps);

    setPendingNodeDraftsById((prev) => {
      if (flushedNodeIds.length === 0) return prev;
      const next = new Map(prev);
      for (const id of flushedNodeIds) next.delete(id);
      return next;
    });
    setPendingNodePositionsById((prev) => {
      if (flushedPositionNodeIds.length === 0) return prev;
      const next = new Map(prev);
      for (const id of flushedPositionNodeIds) next.delete(id);
      return next;
    });
    setPendingEdgeDraftsById((prev) => {
      if (flushedEdgeIds.length === 0) return prev;
      const next = new Map(prev);
      for (const id of flushedEdgeIds) next.delete(id);
      return next;
    });
    setPendingRoutePointsByEdgeId((prev) => {
      if (flushedRouteEdgeIds.length === 0) return prev;
      const next = new Map(prev);
      for (const id of flushedRouteEdgeIds) next.delete(id);
      return next;
    });
    setCurrentUpdatedAt(outcome.finalUpdatedAt);

    if (outcome.failedAtStep) {
      setGlobalSaveStatus("failed");
      setGlobalSaveError(outcome.failureMessage);
      return;
    }

    setSelectedWaypointIndex(null);
    setGlobalSaveStatus("saved");
    // 저장된 변경은 더 이상 "저장 전"이 아니다 — 스택을 비운다.
    setPendingUndoStack(createUndoStack<CaseUndoStep>());
    lastFieldEditKeyRef.current = null;
    router.refresh();
  }

  /** Client-only reset of every pending draft/position/route map — mirrors ProcedureTemplateEditorScreen's handleDiscardAllPending. Nothing here was ever persisted, so there is no server call and no audit row. */
  function handleDiscardAllPending() {
    // "모두 취소"도 한 단계다 — 실수로 눌렀다면 [이전]으로 통째로 되살릴 수 있다.
    pushPendingUndoStep();
    setPendingNodeDraftsById(new Map());
    setPendingNodePositionsById(new Map());
    setPendingEdgeDraftsById(new Map());
    setPendingRoutePointsByEdgeId(new Map());
    setSelectedWaypointIndex(null);
    setGlobalSaveStatus("idle");
    setGlobalSaveError(null);
  }

  async function handleSaveMetadata() {
    setIsSavingMetadata(true);
    setMetadataError(null);
    const result = await updateRepairCaseFlowchartMetadataAction({
      repairCaseId,
      flowchartId: flowchart.id,
      title: titleDraft,
      description: descriptionDraft.trim() || null,
      // 쌓아 둔 태그 배열을 그대로 보낸다 — 서버가 같은 함수로 다시 다듬고
      // 상한·중복을 다시 센다(위 import 주석).
      faultTags: faultTagsDraft,
      expectedUpdatedAt: currentUpdatedAt,
    });
    setIsSavingMetadata(false);
    if (!result.ok) {
      setMetadataError(result.message);
      return;
    }
    handleSaved(result.updatedAt);
  }

  /**
   * 적거나 고른 태그 하나를 더한다 — **[추가] 단추와 Enter 가 이 하나를 부른다**.
   * 더해졌으면 칸을 비운다(다음 것을 바로 적을 수 있게). 더할 것이 없으면
   * (빈 칸) 조용히 아무 일도 안 일어난다 — 규칙은 addFlowchartFaultTag 에 있다.
   */
  function handleAddFaultTag() {
    const result = addFlowchartFaultTag(faultTagsDraft, faultTagInput);
    if (!result.ok) {
      setFaultTagError(result.error);
      return;
    }
    setFaultTagsDraft(result.tags);
    setFaultTagInput("");
    setFaultTagError(null);
  }

  /**
   * 후보를 눌러 고른 길 — **더하는 규칙은 Enter·[추가]와 같은 하나**를 지난다
   * (addFlowchartFaultTag). 고르개 전용 갈래를 따로 두면 「고르면 되는데 쳐서는 안
   * 되는」 태그가 생긴다.
   *
   * 🔵 고른 뒤 **목록을 닫지 않는다** — 부품 고르개는 줄마다 값이 하나라 고르면
   * 닫지만, 고장 개소는 여럿을 잇달아 고르는 칸이다. 고른 태그는 이 자리에서 바로
   * 후보에서 빠지고 알약으로 내려가므로(아래 faultTagOptions), 열린 채로 두는 쪽이
   * 「무엇이 남았는지」를 계속 보여 준다.
   */
  function handlePickFaultTag(tag: string) {
    const result = addFlowchartFaultTag(faultTagsDraft, tag);
    if (!result.ok) {
      setFaultTagError(result.error);
      return;
    }
    setFaultTagsDraft(result.tags);
    setFaultTagInput("");
    setFaultTagError(null);
  }

  /** 알약의 ✕ — 뺀 자리는 다시 고를 목록으로 돌아간다(아래 faultTagOptions). */
  function handleRemoveFaultTag(tag: string) {
    setFaultTagsDraft((prev) => prev.filter((t) => t !== tag));
    setFaultTagError(null);
  }

  // 🔴 후보는 두 겹을 지난다: ① **이미 단 태그를 뺀다**(고를 수 있는데 골라도 안
  // 더해지면 고장으로 보인다) ② **적는 글로 좁힌다**(사용자가 말한 「바로바로 검색」).
  const faultTagOptions = filterFaultTagOptions(availableFaultTagSuggestions(faultTagSuggestions, faultTagsDraft), faultTagInput);
  // 지금 칸에 적힌 글을 **더할 때와 같은 규칙으로** 다듬어 둔다 — [추가] 를 켜고
  // 끄는 조건과 「새 태그입니다」 안내가 같은 값을 봐야, 눌리는데 새것이 아니라고
  // 적히는 어긋남이 안 생긴다.
  const typedFaultTag = normalizeFlowchartFaultTag(faultTagInput);
  /** 목록에 없는 값 — 고객사 칸의 「새 고객사로 등록」과 같은 안내를 띄운다. */
  const isNewFaultTag =
    typedFaultTag.length > 0 &&
    !faultTagsDraft.includes(typedFaultTag) &&
    !faultTagSuggestions.some((tag) => normalizeFlowchartFaultTag(tag) === typedFaultTag);

  // 🔴 고장 개소도 이 판정에 들어간다. 빠지면 **태그만 바꿨을 때 저장 단추가
  // 영영 안 켜진다** — 아래 단추의 disabled 가 이 값을 본다.
  // 🔵 적다 만 글자(faultTagInput)는 여기에 **일부러 안 넣는다** — 더하지 않은
  // 글자는 저장될 값이 아니라서, 그것으로 단추가 켜지면 「누르면 들어가겠거니」로
  // 읽힌다. 대신 아래에 [추가] 를 눌러 달라는 안내를 띄운다.
  const hasMetadataChanges =
    titleDraft !== flowchart.title ||
    descriptionDraft !== (flowchart.description ?? "") ||
    !faultTagsEqual(faultTagsDraft, flowchart.faultTags);

  return (
    <div className="flex flex-col gap-4">
      {!canEdit && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          읽기 전용 — 이 Flowchart를 수정할 권한이 없거나 접수 건이 잠겨 있습니다.
        </p>
      )}

      {canEdit && (
        <div className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900">
          <button
            type="button"
            disabled={!hasAnyPendingChanges || globalSaveStatus === "saving"}
            onClick={() => void handleGlobalSave()}
            className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900"
          >
            {globalSaveStatus === "saving"
              ? "저장 중..."
              : !hasAnyPendingChanges
                ? "저장할 변경 없음"
                : globalSaveStatus === "failed"
                  ? "저장 실패 - 다시 시도"
                  : "저장"}
          </button>
          <button
            type="button"
            onClick={handleDiscardAllPending}
            disabled={!hasAnyPendingChanges}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
          >
            취소
          </button>
          {/* 저장 전 변경만 다룬다 — 이 편집기에는 서버 편집 이력이 없다.
              진행 중 표시(isUndoing/isRedoing)는 서버 요청이 없으므로 항상 false다. */}
          <UndoRedoControls
            canUndo={canUndoStack(pendingUndoStack)}
            canRedo={canRedoStack(pendingUndoStack)}
            isUndoing={isUndoing}
            isRedoing={false}
            onUndo={() => void handleUndo()}
            onRedo={handleRedo}
          />
          {undoError && <span className="text-red-600 dark:text-red-400">{undoError}</span>}
          {globalSaveStatus === "saved" && <span className="text-emerald-700 dark:text-emerald-400">저장 완료</span>}
          {globalSaveStatus === "failed" && globalSaveError && <span className="text-red-600 dark:text-red-400">{globalSaveError}</span>}
          {hasAnyPendingChanges && globalSaveStatus === "idle" && (
            <span className="text-zinc-500 dark:text-zinc-400">변경사항 {totalPendingCount}건 저장 대기 중</span>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <label className="flex flex-col gap-1 text-xs">
          Flowchart 제목
          <input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            disabled={!canEdit}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          설명 (선택)
          <textarea
            rows={2}
            value={descriptionDraft}
            onChange={(e) => setDescriptionDraft(e.target.value)}
            disabled={!canEdit}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        {/* 고장 개소 태그(2026-11-19) — **부품요청에서 부품을 찾을 때와 같은 방식**이다
            (사용자 결정: 「태그 목록은 부품요청에서 부품을 검색할 때 처럼 만들어줘.」).
            칸에 들어오면 후보가 칸 밑에 뜨고, 적는 대로 좁혀지고(「바로바로 검색」),
            목록에 없으면 그냥 적어서 더한다. 본보기는 수리 건 상세의 사용 부품 칸
            (detail/edit/UsedPartsEditForm.tsx)과 그 고르개(vendor/dss-core 의
            ui/inventory/part-picker.tsx)이고, **왜 그 부품을 그대로 못 쓰는지**는
            ./FaultTagSuggestionList.tsx 머리말에 적어 두었다.
            🔴 쉼표·줄바꿈·대괄호는 **아무 경계도 아니다** — 적은 글자가 통째로 한
            태그다(「코일, 변색」을 그냥 적으면 된다). */}
        <div className="flex flex-col gap-1 text-xs">
          <label htmlFor="faultTagInput">고장 개소 (선택)</label>
          <div className="flex items-start gap-2">
            {/* 🔴 `relative` — 후보 목록이 이 칸 **바로 밑에** 떠야 한다. 흐름 안에
                두면 목록이 뜰 때마다 밑의 알약과 단추가 밀려 내려가, 고르려던 자리가
                눈앞에서 움직인다(본보기와 같은 까닭). */}
            <div className="relative min-w-0 flex-1">
              <input
                id="faultTagInput"
                // 🔴 브라우저 자체 기억(이전에 친 값)으로 만든 목록이 후보 위에
                // 겹쳐 뜨지 않게 끈다 — 본보기가 주석으로 까닭을 적어 둔 자리다.
                autoComplete="off"
                value={faultTagInput}
                onChange={(e) => {
                  setFaultTagInput(e.target.value);
                  // 치기 시작하면 후보를 편다 — 한 번 닫은 뒤 이어 치는 동안
                  // 아무것도 안 뜨면 목록이 사라진 것으로 보인다.
                  setIsFaultTagPickerOpen(true);
                  // 다시 치기 시작하면 방금 못 더한 까닭은 지운다 — 고친 뒤에도
                  // 빨간 글이 남아 있으면 아직 안 되는 줄 안다.
                  setFaultTagError(null);
                }}
                onFocus={() => setIsFaultTagPickerOpen(true)}
                onBlur={() => setIsFaultTagPickerOpen(false)}
                onKeyDown={(e) => {
                  // 🔴 Escape 로 접는다 — 끄는 길이 없으면 목록에 갇힌다(본보기와 같다).
                  if (e.key === "Escape") {
                    setIsFaultTagPickerOpen(false);
                    return;
                  }
                  if (e.key !== "Enter") return;
                  // 🔴 **Enter 는 더하기다.** preventDefault 는 이 화면에 <form> 이
                  // 생기는 날을 대비한 울타리다 — 지금은 form·onSubmit 이 하나도
                  // 없어 제출될 길이 없지만(아래 시험이 그것을 지킨다), 폼이 생기면
                  // Enter 가 조용히 제출로 바뀐다.
                  e.preventDefault();
                  handleAddFaultTag();
                }}
                disabled={!canEdit}
                placeholder="고장 개소를 입력하거나 목록에서 고르세요"
                className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
              />
              {isFaultTagPickerOpen && canEdit && (
                <FaultTagSuggestionList options={faultTagOptions} onPick={handlePickFaultTag} listLabel="고장 개소 후보" />
              )}
            </div>
            <button
              type="button"
              onClick={handleAddFaultTag}
              disabled={!canEdit || typedFaultTag.length === 0}
              className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              추가
            </button>
          </div>
          {isNewFaultTag ? (
            // 본보기의 「마스터에 없으면 그냥 적으세요」와 같은 결 — 목록에 없는
            // 값을 적고 있다는 것과, **아직 안 더해졌다**는 것을 함께 알린다.
            // 🔵 부품 칸은 그 말을 placeholder 에 두지만, 여기서는 적은 뒤에도 한
            // 번 더 손을 써야(Enter·[추가]) 들어가므로 그때 보이는 자리에 둔다.
            <span className="text-[11px] font-normal text-emerald-600 dark:text-emerald-400">
              ✓ 「{typedFaultTag}」 는 새 태그로 추가됩니다 — Enter 를 누르거나 [추가] 를 누르세요.
            </span>
          ) : (
            <span className="text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
              적으면 목록이 좁혀집니다. 목록에 없는 개소는 그대로 적어 추가할 수 있고, 추가한 태그는 ✕ 로 뺄 수 있습니다.
            </span>
          )}
        </div>
        {faultTagsDraft.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {faultTagsDraft.map((tag) => (
              // 🔴 색이 상태 배지와 다르다 — 고장 개소는 **값**이지 상태가
              // 아니다. 상태 배지와 같은 색을 쓰면 「무슨 상태인가」로 읽히고,
              // 상태 배지 색이 바뀌는 날 이 값까지 따라 바뀐 것처럼 보인다.
              // 테두리만 있는 중립 회색은 이 저장소가 이미 쓰는 「값 알약」의
              // 모양이다(ProductModelEditForm 의 태그 칩 · 내자 머리 카드의 값
              // 알약 넷). 🔴 공용 부품으로 빼지 않는다 — 이 저장소는 알약 글자를
              // 쓰는 자리마다 적는 방식이고, 여기만 부품을 만들면 둘이 된다.
              <span
                key={tag}
                className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap border border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {tag}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => handleRemoveFaultTag(tag)}
                    // 글자가 ✕ 하나뿐이라 읽는 장치에는 아무 말도 안 들린다 —
                    // 어느 태그를 빼는 단추인지 이름을 달아 둔다.
                    aria-label={`${tag} 빼기`}
                    className="ml-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-100"
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        {faultTagError && <p className="text-xs text-red-600 dark:text-red-400">{faultTagError}</p>}
        {canEdit && (
          <button
            type="button"
            // 🔴 못 더한 까닭(faultTagError)은 저장을 막지 않는다 — 더하려다 만
            // 글자일 뿐, 쌓아 둔 태그는 늘 규칙을 지난 값이다.
            disabled={!hasMetadataChanges || titleDraft.trim().length === 0 || isSavingMetadata}
            onClick={() => void handleSaveMetadata()}
            className="self-start rounded-md bg-primary-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900"
          >
            {/* 🔴 「제목/설명 저장」이었다 — 고장 개소까지 함께 저장하므로 옛
                글자는 실제와 어긋난다(2026-11-19 사용자 결정). */}
            {isSavingMetadata ? "저장 중..." : "저장"}
          </button>
        )}
        {metadataError && <p className="text-xs text-red-600 dark:text-red-400">{metadataError}</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-2">
          <div className="min-h-[500px] rounded-lg border border-zinc-200 dark:border-zinc-800">
            {nodes.length === 0 ? (
              <p className="p-6 text-sm text-zinc-500 dark:text-zinc-400">아직 노드가 없습니다. 오른쪽 패널에서 첫 노드를 추가하세요.</p>
            ) : (
              <CaseFlowchartGraph
                nodes={renderedNodes}
                edges={renderedEdges}
                editable={canEdit}
                selectedNodeId={selectedNodeId}
                selectedEdgeId={selectedEdgeId}
                onNodeClick={(nodeId) => {
                  if (isPickingEdgeTarget) {
                    // 선택 대기 중의 클릭은 "대상 노드 지정"이다 — 선택은 그대로
                    // 두어(연결 추가 패널이 초기화되지 않게) 대상만 바꾼다.
                    setIsPickingEdgeTarget(false);
                    setPickedEdgeTarget((prev) => ({ nodeId, seq: (prev?.seq ?? 0) + 1 }));
                    return;
                  }
                  if (isPickingReferenceNode) {
                    // 기준 노드만 바꾸고 선택은 그대로 둔다.
                    setIsPickingReferenceNode(false);
                    setPickedReferenceNode((prev) => ({ nodeId, seq: (prev?.seq ?? 0) + 1 }));
                    return;
                  }
                  setSelectedNodeId(nodeId);
                  setSelectedEdgeId(null);
                  setSelectedWaypointIndex(null);
                  setRightPanelTab("properties");
                }}
                onEdgeClick={(edgeId) => {
                  setIsPickingEdgeTarget(false);
                  setIsPickingReferenceNode(false);
                  setSelectedEdgeId(edgeId);
                  setSelectedNodeId(null);
                  setSelectedWaypointIndex(null);
                  setRightPanelTab("properties");
                }}
                onEdgeDoubleClick={handleEdgeDoubleClick}
                onPaneClick={() => {
                  setSelectedNodeId(null);
                  setSelectedEdgeId(null);
                  setSelectedWaypointIndex(null);
                }}
                onNodeDragStop={handleNodeDragStop}
                selectedWaypointIndex={selectedWaypointIndex}
                onWaypointSelectionChange={handleWaypointSelectionChange}
                onNodeDragStart={handleNodeDragStart}
                onWaypointMove={handleWaypointMove}

                onInstanceReady={(instance) => {
                  reactFlowInstanceRef.current = instance;
                }}
              />
            )}
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {canEdit
              ? "편집 모드 — 노드를 드래그해 위치를 조정하고, 분기를 선택한 뒤 경로점을 추가/이동/삭제해 연결선 경로를 조정할 수 있습니다 (명시적으로 저장하기 전까지 반영되지 않습니다). 노드/분기를 클릭하면 연결된 경로가 강조되고 나머지는 흐리게 표시됩니다."
              : "읽기 전용 — 마우스 휠로 확대/축소, 드래그로 이동, 노드를 클릭하면 연결된 경로가 강조되고 나머지는 흐리게 표시됩니다."}
          </p>
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap gap-1 border-b border-zinc-200 pb-2 text-xs dark:border-zinc-800">
            {(canEdit ? (["properties", "addNode", "createEdge"] as const) : (["properties"] as const)).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  // 탭을 떠나면 선택 대기와 시작 노드 고정을 함께 푼다.
                  setIsPickingEdgeTarget(false);
                  setIsPickingReferenceNode(false);
                  setRightPanelTab(tab);
                }}
                className={`rounded-md px-2 py-1 ${rightPanelTab === tab ? "bg-primary-900 text-white dark:bg-primary-50 dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}
              >
                {tab === "properties" ? "속성" : tab === "addNode" ? "노드 추가" : "연결 추가"}
              </button>
            ))}
          </div>

          {rightPanelTab === "properties" && (
            <>
              {selectedNode && (
                <CaseFlowchartNodePropertyPanel
                  node={selectedNode}
                  allNodes={renderedNodes}
                  isPickingReference={isPickingReferenceNode}
                  onStartPickReference={() => setIsPickingReferenceNode(true)}
                  onCancelPickReference={() => setIsPickingReferenceNode(false)}
                  pickedReferenceNode={pickedReferenceNode}
                  repairCaseId={repairCaseId}
                  flowchartId={flowchart.id}
                  canEdit={canEdit}
                  expectedFlowchartUpdatedAt={currentUpdatedAt}
                  draft={nodeDraft(selectedNode.id)}
                  onDraftChange={(patch) => updateNodeDraft(selectedNode.id, patch)}
                  onPositionDraftChange={(position) => setPendingNodePosition(selectedNode.id, position)}
                  onDeleted={handleNodeDeleted}
                  resolveNodeDimensions={resolveNodeDimensions}
                />
              )}
              {selectedEdge && (
                <CaseFlowchartEdgePropertyPanel
                  edge={selectedEdge}
                  nodes={renderedNodes}
                  repairCaseId={repairCaseId}
                  flowchartId={flowchart.id}
                  canEdit={canEdit}
                  expectedFlowchartUpdatedAt={currentUpdatedAt}
                  draft={edgeDraft(selectedEdge.id)}
                  onDraftChange={(patch) => updateEdgeDraft(selectedEdge.id, patch)}
                  onSaved={handleSaved}
                  onDeleted={handleEdgeDeleted}
                  routePoints={workingRoutePoints(selectedEdge.id)}
                  selectedWaypointIndex={selectedWaypointIndex}
                  onAddWaypoint={handleAddWaypoint}
                  onRemoveSelectedWaypoint={handleRemoveSelectedWaypoint}
                  onResetRoute={handleResetRoute}
                  onStraighten={() => handleEdgeDoubleClick(selectedEdge.id)}
                />
              )}
              {!selectedNode && !selectedEdge && <p className="text-xs text-zinc-500 dark:text-zinc-400">노드 또는 분기를 선택하면 상세 정보가 표시됩니다.</p>}
            </>
          )}

          {rightPanelTab === "addNode" && canEdit && (
            <CaseFlowchartCreateNodePanel
              repairCaseId={repairCaseId}
              flowchartId={flowchart.id}
              expectedFlowchartUpdatedAt={currentUpdatedAt}
              onSaved={handleSaved}
              selectedNode={selectedNode}
            />
          )}

          {rightPanelTab === "createEdge" && canEdit && nodes.length > 0 && (
            <CaseFlowchartCreateEdgePanel
              repairCaseId={repairCaseId}
              flowchartId={flowchart.id}
              nodes={renderedNodes}
              canEdit={canEdit}
              expectedFlowchartUpdatedAt={currentUpdatedAt}
              prefillFromNodeId={selectedNodeId}
              isPickingTarget={isPickingEdgeTarget}
              onStartPickTarget={() => setIsPickingEdgeTarget(true)}
              onCancelPickTarget={() => setIsPickingEdgeTarget(false)}
              pickedTarget={pickedEdgeTarget}
              onSaved={handleSaved}
            />
          )}
        </div>
      </div>
    </div>
  );
}
