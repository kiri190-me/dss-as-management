"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReactFlowInstance } from "@xyflow/react";
import ProcedureFlowGraph, { type LayoutMode } from "./ProcedureFlowGraph";
import ProcedureGraphLegend from "./visual/ProcedureGraphLegend";
import NodePropertyPanel from "./editor/NodePropertyPanel";
import EdgePropertyPanel from "./editor/EdgePropertyPanel";
import CreateEdgePanel from "./editor/CreateEdgePanel";
import CreateNodePanel from "./editor/CreateNodePanel";
import EditHistoryPanel from "./editor/EditHistoryPanel";
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
import type { ProcedureTemplateForEditor, DraftParentComparisonResult, EditorNodeRow, EditorEdgeRow } from "@/lib/db/queries/procedure-template-editor";
import type { TemplateHistoryView } from "@/lib/db/queries/procedure-template-history";
import { resolveInitialGraphTarget, parseSourceReference } from "@/lib/domain/procedure-graph-navigation";
import { resolveEffectiveNodePosition, resolveEffectiveNodeDimensions, computeStraightenedConnectedNodePosition } from "@/lib/graph-editor-core/layout";
import { NODE_VISUAL_CONFIG, getNodeChipVisual, computeNodeDimensions } from "@/lib/domain/procedure-visual-language";
import {
  saveProcedureTemplateLayoutAction,
  validateProcedureTemplateAction,
  updateProcedureTemplateNodeAction,
  updateProcedureTemplateEdgeAction,
} from "@/lib/server/actions/procedure-template-editor";
import { renameTechnicalProcedureTemplateAction } from "@/lib/server/actions/procedure-templates";
import { undoProcedureTemplateChangeAction, redoProcedureTemplateChangeAction } from "@/lib/server/actions/procedure-template-undo-redo";
import { procedureValidationIssueTypeLabels, procedureValidationSeverityLabels, procedureBranchTypeLabels, procedureNodeTypeLabels, procedureTemplateStatusLabels } from "@/lib/domain/procedure-template-types";
import type { StructuralValidationSummary, EdgeRouteInput } from "@/lib/db/mutations/procedure-template-editor";
import { addWaypointAtDefaultPosition, moveWaypoint, removeWaypoint, type RoutePoint } from "@/lib/graph-editor-core/routing";
import {
  mergeProcedureNodeForRender,
  mergeProcedureEdgeForRender,
  computeDirtyProcedureNodeFieldEntries,
  computeDirtyProcedureEdgeFieldEntries,
  computeDirtyProcedurePositionNodeIds,
  computeDirtyProcedureRouteEdgeIds,
  planProcedureSaveSteps,
  runProcedureSaveSequence,
  succeededProcedureNodeFieldIds,
  succeededProcedureEdgeFieldIds,
  succeededProcedureLayoutNodeIds,
  succeededProcedureRouteEdgeIds,
  type ProcedureNodeFieldDraft,
  type ProcedureEdgeFieldDraft,
  type ProcedureServerNodeSnapshot,
  type ProcedureServerEdgeSnapshot,
  type ProcedureSaveStep,
  type ProcedureSaveStepResult,
  type Position,
} from "@/lib/domain/procedure-editor-save-state";

type RightPanelTab = "properties" | "validation" | "history" | "compare" | "createEdge" | "addNode";

/**
 * The Phase 4A controlled workflow editor — deliberately a thin shell
 * around the exact same ProcedureFlowGraph/ProcedureGraphLegend Phase 3B
 * built (node shapes, edge routing, layout modes, error-focus, selection
 * highlighting are all reused verbatim via `editable`), never a second
 * visual language. Everything mutating lives in the right panel's three
 * focused forms (node/edge property, create-connection); this shell only
 * owns layout drag-batching (the one genuinely "continuous" editing
 * surface) and which panel is showing.
 *
 * ================================ SAVE CONTRACT (5C-6D-1C) ================================
 * Adopts the same live-preview + explicit-global-Save model the Repair
 * Case Flowchart editor already established, but SCOPED to exactly the
 * safe-to-defer fields audited in 5C-6D-1B: node title/description/
 * instructions/sortOrder/isActive, node position (drag only — "상대 위치로
 * 이동" stays its own immediate action, see NodePropertyPanel, per 1D's
 * scope), edge branchType/branchLabel, edge route (waypoints). STRUCTURAL/
 * REVIEWED operations — node type change, edge retarget, edge/node create,
 * edge/node delete, node-on-edge insertion, validation, publish/version,
 * Undo/Redo itself — remain their own immediate, separately-reasoned/
 * confirmed actions, entirely untouched by this contract.
 *
 * SERVER BASELINE (template.nodes/edges) + LOCAL DRAFT OVERRIDES
 * (pendingNodeFieldDraftsById / pendingLayoutMoves / pendingEdgeFieldDraftsById /
 * pendingEdgeRouteMoves) = RENDERED GRAPH (renderedNodes/renderedEdges,
 * via procedure-editor-save-state.ts's merge helpers — used directly, not
 * duplicated here). Editing a safe field updates the canvas immediately;
 * no server call happens until the global [저장] button runs.
 *
 * PARTIAL-FAILURE REBASE (the one piece with no Case Flowchart precedent
 * to copy — see this checkpoint's own explicit requirement): a step that
 * succeeds mid-sequence must stop being "pending" (so a retry never
 * re-sends it, which would create a spurious duplicate history row — see
 * updateProcedureTemplateNode's own lack of a no-op guard) while STILL
 * rendering its just-persisted value, even though no router.refresh() has
 * happened yet (this screen deliberately avoids refreshing on anything
 * short of full success — see handleGlobalSave's own doc comment).
 * justSaved{NodeFields,Positions,EdgeFields,Routes}ById hold exactly that:
 * a shadow, folded into the SAME baseline serverNodesById/serverEdgesById
 * that dirty-detection and rendering both already use, so no new merge
 * logic is invented — mergeProcedureNodeForRender/mergeProcedureEdgeForRender
 * are simply called twice (once to fold the shadow into the baseline, once
 * to fold the current pending draft on top). Cleared automatically the
 * moment a real refresh brings a fresh template.updatedAt (same adjust-
 * state-during-render convention currentUpdatedAt already used).
 * ============================================================================================
 */
/**
 * 저장 전(아직 서버에 보내지 않은) 편집 상태 전부. [이전]/[앞으로]는 이 묶음을
 * 통째로 갈아끼우는 방식으로 동작한다.
 */
type PendingSnapshot = {
  layoutMoves: Map<string, Position>;
  edgeRouteMoves: Map<string, RoutePoint[] | null>;
  nodeFieldDrafts: Map<string, ProcedureNodeFieldDraft>;
  edgeFieldDrafts: Map<string, ProcedureEdgeFieldDraft>;
  edgeSaveNotes: Map<string, string>;
};

/** 스냅샷 두 개가 같은 상태인지 — 키 순서를 고정해 직렬화한 뒤 비교한다(작은 Map 몇 개라 비용이 문제되지 않는다). */
function pendingSnapshotSignature(snapshot: PendingSnapshot): string {
  const dump = (map: Map<string, unknown>) => [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([
    dump(snapshot.layoutMoves),
    dump(snapshot.edgeRouteMoves),
    dump(snapshot.nodeFieldDrafts),
    dump(snapshot.edgeFieldDrafts),
    dump(snapshot.edgeSaveNotes),
  ]);
}

function pendingSnapshotsEqual(a: PendingSnapshot, b: PendingSnapshot): boolean {
  return pendingSnapshotSignature(a) === pendingSnapshotSignature(b);
}

export default function ProcedureTemplateEditorScreen({
  template,
  historyView,
  comparison,
  canEdit,
}: {
  template: ProcedureTemplateForEditor;
  historyView: TemplateHistoryView;
  comparison: DraftParentComparisonResult | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const issueParam = searchParams.get("issue");
  const navigationTarget = resolveInitialGraphTarget(
    {
      nodeParam: searchParams.get("node"),
      worksheetParam: searchParams.get("worksheet"),
      shapeParam: searchParams.get("shape"),
      connectorParam: searchParams.get("connector"),
      fallbackParam: searchParams.get("fallback"),
      modeParam: searchParams.get("mode"),
    },
    template.nodes,
    template.edges
  );
  const errorFocusMode = navigationTarget.errorFocus && navigationTarget.nodeId !== null;

  // Adjust-state-during-render (React's documented alternative to a
  // synchronizing effect for "reset local state when a prop changes") —
  // currentUpdatedAt can also be advanced directly by a successful
  // mutation (handleSaved), so it can't just be derived from the prop on
  // every render; it only needs to resync when the prop itself changes
  // (e.g. after router.refresh() brings a fresh template). The four
  // justSaved* shadows (5C-6D-1C) are cleared in the same block — the
  // moment a real refresh arrives, whatever they were shadowing is now
  // genuinely reflected in `template` itself, so the shadow is redundant.
  const [prevTemplateUpdatedAt, setPrevTemplateUpdatedAt] = useState(template.updatedAt);
  const [currentUpdatedAt, setCurrentUpdatedAt] = useState(template.updatedAt);
  const [justSavedNodeFieldsById, setJustSavedNodeFieldsById] = useState<Map<string, ProcedureNodeFieldDraft>>(new Map());
  const [justSavedPositionsById, setJustSavedPositionsById] = useState<Map<string, Position>>(new Map());
  const [justSavedEdgeFieldsById, setJustSavedEdgeFieldsById] = useState<Map<string, ProcedureEdgeFieldDraft>>(new Map());
  const [justSavedRoutesById, setJustSavedRoutesById] = useState<Map<string, RoutePoint[] | null>>(new Map());
  if (template.updatedAt !== prevTemplateUpdatedAt) {
    setPrevTemplateUpdatedAt(template.updatedAt);
    setCurrentUpdatedAt(template.updatedAt);
    setJustSavedNodeFieldsById(new Map());
    setJustSavedPositionsById(new Map());
    setJustSavedEdgeFieldsById(new Map());
    setJustSavedRoutesById(new Map());
  }

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(navigationTarget.nodeId);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  /**
   * "화면에서 선택" — 연결 추가 패널의 대상 노드를 캔버스 클릭으로 고르는 모드.
   * 고르는 동안 화면 선택은 전혀 바뀌지 않는다(그래프가 클릭을 우리에게 넘기고
   * 자기 선택은 건드리지 않는다 — handleNodeClickIntercept 참고). 그래서 연결
   * 추가 패널은 시작 노드가 그대로라 작성 중이던 내용을 잃지 않는다.
   *
   * 모드 플래그를 ref로도 들고 있는 이유는 이 콜백들이 반드시 안정된 참조여야
   * 하기 때문이다(ProcedureFlowGraph의 선택 동기화 effect가 의존성으로 갖는다).
   */
  const isPickingEdgeTargetRef = useRef(false);
  const [isPickingEdgeTarget, setIsPickingEdgeTarget] = useState(false);
  const [pickedEdgeTarget, setPickedEdgeTarget] = useState<{ nodeId: string; seq: number } | null>(null);
  /**
   * "상대 위치로 이동"의 기준 노드를 캔버스에서 고르는 모드. 대상 노드 고르기와
   * 다른 점이 하나 있다: 여기서는 선택을 절대 옮기지 않는다 — 선택이 옮겨가면
   * 속성 패널 자체가 다른 노드로 바뀌어, 방금 고른 기준을 쓸 화면이 사라진다.
   */
  const isPickingReferenceNodeRef = useRef(false);
  const [isPickingReferenceNode, setIsPickingReferenceNode] = useState(false);
  const [pickedReferenceNode, setPickedReferenceNode] = useState<{ nodeId: string; seq: number } | null>(null);
  // Phase 5C-5B usability bugfix — lifted (was ProcedureFlowGraph's own
  // internal state) so handleAddWaypoint can force USER mode the instant a
  // route point is added: route-point markers only render/are clickable in
  // USER mode (resolveEffectiveEdgeRoute), and EdgePropertyPanel's "경로점
  // 추가" button — a completely separate component from the graph — had no
  // way to request that switch, permanently blocking "이 위치에 노드 추가"
  // for anyone starting from the default 원본 배치 view.
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("SOURCE");
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>(navigationTarget.nodeId ? "properties" : "validation");
  const [lastStructuralValidation, setLastStructuralValidation] = useState<StructuralValidationSummary | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  // 5C-6D-1D — the live React Flow instance, captured once via
  // ProcedureFlowGraph's onInstanceReady (same mechanism/timing as
  // CaseFlowchartGraph's own onInstanceReady). A ref, not state — the
  // instance itself never changes after mount and must never trigger a
  // re-render on its own. Real measured node dimensions come from its
  // `getInternalNode(id)?.measured`, used by NodePropertyPanel's and
  // CreateNodePanel's relative-position math so Y-center/X-column
  // alignment is based on what's actually on screen (a description/
  // subtitle line the presentation-only computeNodeDimensions estimate
  // never accounts for) rather than a second, potentially-drifting size
  // estimator — ported directly from CaseFlowchartEditorScreen's own
  // resolveMeasuredNodeDimensions/estimatedNodeDimensions/
  // resolveNodeDimensions trio, not reinvented here.
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);

  function resolveMeasuredNodeDimensions(nodeId: string): { width?: number; height?: number } | null {
    return reactFlowInstanceRef.current?.getInternalNode(nodeId)?.measured ?? null;
  }

  function estimatedNodeDimensions(n: EditorNodeRow) {
    return computeNodeDimensions({ title: n.title, shape: NODE_VISUAL_CONFIG[getNodeChipVisual(n.nodeType).semanticType].shape });
  }

  /** THE single, shared effective-dimension resolver (measured-first, estimate-fallback) — passed down to NodePropertyPanel and CreateNodePanel identically, so both read the same runtime geometry. */
  function resolveNodeDimensions(n: EditorNodeRow): { width: number; height: number } {
    return resolveEffectiveNodeDimensions(resolveMeasuredNodeDimensions(n.id), estimatedNodeDimensions(n));
  }

  // Same sourceWorksheet+sourceShapeId matching technique
  // getProcedureTemplateDetail's openIssuesByNodeId already uses — the
  // editor's read-model doesn't pre-join this since not every caller of
  // getProcedureTemplateForEditor needs it (e.g. the DRAFT-vs-parent
  // comparison, which loads both sides of a template).
  const openIssuesByNodeId = useMemo(() => {
    const nodeByShapeAndSheet = new Map<string, string>();
    for (const n of template.nodes) {
      if (n.sourceShapeId && n.sourceWorksheet) nodeByShapeAndSheet.set(`${n.sourceWorksheet}::${n.sourceShapeId}`, n.id);
    }
    const result: { nodeId: string; issueId: string; severity: "ERROR" | "WARNING" }[] = [];
    for (const issue of template.unresolvedIssues) {
      if (issue.severity !== "ERROR" && issue.severity !== "WARNING") continue;
      const { shapeId } = parseSourceReference(issue.sourceReference);
      if (!shapeId || !issue.sourceWorksheet) continue;
      const nodeId = nodeByShapeAndSheet.get(`${issue.sourceWorksheet}::${shapeId}`);
      if (nodeId) result.push({ nodeId, issueId: issue.id, severity: issue.severity });
    }
    return result;
  }, [template.nodes, template.unresolvedIssues]);

  // ---- position (drag) pending state — UNCHANGED from before 1C, per this
  // checkpoint's own scope boundary ("if position is already pending
  // today, preserve its existing behavior"; the relative-position BUTTON
  // in NodePropertyPanel stays its own immediate action until 1D). ----
  const savedLayoutPositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const n of template.nodes) map.set(n.id, resolveEffectiveNodePosition(n, "USER"));
    return map;
  }, [template.nodes]);
  const [pendingLayoutMoves, setPendingLayoutMoves] = useState<Map<string, Position>>(new Map());
  const workingLayoutPositions = useMemo(() => {
    const map = new Map(savedLayoutPositions);
    for (const [id, pos] of pendingLayoutMoves) map.set(id, pos);
    return map;
  }, [savedLayoutPositions, pendingLayoutMoves]);

  // Phase 4B — 사용자 배치 manual edge-route (waypoint) pending state, the
  // edge-level sibling of pendingLayoutMoves above. A map *entry with
  // `null`* means "explicitly restored to automatic routing this session"
  // (distinct from *no entry*, meaning "untouched").
  const savedEdgeRoutes = useMemo(() => {
    const map = new Map<string, RoutePoint[] | null>();
    for (const e of template.edges) map.set(e.id, e.userRoutePoints && e.userRoutePoints.length > 0 ? e.userRoutePoints : null);
    return map;
  }, [template.edges]);
  const [pendingEdgeRouteMoves, setPendingEdgeRouteMoves] = useState<Map<string, RoutePoint[] | null>>(new Map());
  const workingEdgeRoutes = useMemo(() => {
    const map = new Map(savedEdgeRoutes);
    for (const [id, points] of pendingEdgeRouteMoves) map.set(id, points);
    return map;
  }, [savedEdgeRoutes, pendingEdgeRouteMoves]);
  /**
   * A waypoint selection only ever makes sense for the currently-selected
   * edge, so the edge it belongs to is stored *with* the index and the index
   * itself is derived at render time. Nothing has to clear it after the fact:
   * the instant the selected edge changes (or is cleared) the stored edgeId
   * stops matching and the derived index is already null, so a stale index
   * can never point at the wrong edge's route array — not even for the one
   * render an after-the-fact reset would have left it wrong.
   */
  const [selectedWaypoint, setSelectedWaypoint] = useState<{ edgeId: string; index: number } | null>(null);
  const selectedWaypointIndex: number | null =
    selectedWaypoint && selectedWaypoint.edgeId === selectedEdgeId ? selectedWaypoint.index : null;

  // ---- 5C-6D-1C: node/edge SAFE-FIELD pending drafts ----
  const [pendingNodeFieldDraftsById, setPendingNodeFieldDraftsById] = useState<Map<string, ProcedureNodeFieldDraft>>(new Map());
  const [pendingEdgeFieldDraftsById, setPendingEdgeFieldDraftsById] = useState<Map<string, ProcedureEdgeFieldDraft>>(new Map());
  /** The edge "검토자 메모" — a write-only per-save audit annotation (see procedure-editor-save-state.ts's own doc comment on why it's excluded from ProcedureEdgeFieldDraft entirely). Lifted here, alongside pendingEdgeFieldDraftsById, so it survives an edge-selection change (EdgePropertyPanel remounts via `key=`) until the deferred EDGE_FIELDS step actually runs. */
  const [pendingEdgeSaveNoteById, setPendingEdgeSaveNoteById] = useState<Map<string, string>>(new Map());

  // ---- 저장 전 되돌리기(클라이언트 스냅샷 스택) ----
  //
  // [이전]은 이제 두 체계를 순서대로 쓴다: 저장하지 않은 변경이 있으면 그것부터
  // 한 단계씩 되돌리고, 다 되돌린 뒤에야 서버 이력을 되돌린다. 예전에는 저장 전
  // 변경이 하나라도 있으면 버튼 자체가 꺼져 있어서, 노드를 옮긴 뒤에는 되돌릴
  // 방법이 "모두 취소"밖에 없었다.
  //
  // 스냅샷은 저장 전 상태 다섯 가지를 통째로 담는다 — 조작마다 역연산을 따로
  // 만들면 조작이 늘 때마다 짝을 맞춰야 해서 어긋나기 쉽다(undo-stack.ts 주석 참고).
  const [pendingUndoStack, setPendingUndoStack] = useState<UndoStack<PendingSnapshot>>(() => createUndoStack<PendingSnapshot>());
  /**
   * 항상 "가장 최근에 렌더링된" 저장 전 상태를 가리킨다 — 스냅샷을 찍는 쪽은
   * 이벤트 핸들러(드래그 시작, 버튼 클릭)라 렌더 이후에 실행되므로 이 값이
   * 최신이다. 상태 다섯 개를 의존성으로 끌고 다니면 콜백 신원이 매번 바뀌어
   * 그래프의 선택 동기화 effect까지 흔들리므로 ref로 둔다.
   */
  const pendingSnapshotRef = useRef<PendingSnapshot>({
    layoutMoves: new Map(),
    edgeRouteMoves: new Map(),
    nodeFieldDrafts: new Map(),
    edgeFieldDrafts: new Map(),
    edgeSaveNotes: new Map(),
  });
  useEffect(() => {
    pendingSnapshotRef.current = {
      layoutMoves: pendingLayoutMoves,
      edgeRouteMoves: pendingEdgeRouteMoves,
      nodeFieldDrafts: pendingNodeFieldDraftsById,
      edgeFieldDrafts: pendingEdgeFieldDraftsById,
      edgeSaveNotes: pendingEdgeSaveNoteById,
    };
  }, [pendingLayoutMoves, pendingEdgeRouteMoves, pendingNodeFieldDraftsById, pendingEdgeFieldDraftsById, pendingEdgeSaveNoteById]);

  /** 드래그 중에는 프레임마다 스냅샷을 찍지 않는다 — 한 번의 드래그가 한 단계다(시작할 때만 찍는다). */
  const isNodeDraggingRef = useRef(false);
  /**
   * 글자 입력은 "입력칸 단위로 한 단계"다. 직전에 손댄 칸과 같은 칸이면 새 단계를
   * 만들지 않고, 다른 칸(또는 다른 노드/연결)으로 옮겨가거나 다른 조작을 하면
   * 그때 한 단계가 끊긴다 — 한 글자마다 단계가 쌓이는 것을 막는다.
   */
  const lastFieldEditKeyRef = useRef<string | null>(null);

  const pushPendingUndoStep = useCallback((fieldEditKey: string | null = null) => {
    if (fieldEditKey !== null && lastFieldEditKeyRef.current === fieldEditKey) return;
    lastFieldEditKeyRef.current = fieldEditKey;
    setPendingUndoStack((prev) => pushUndoStep(prev, pendingSnapshotRef.current, pendingSnapshotsEqual));
  }, []);

  const applyPendingSnapshot = useCallback((snapshot: PendingSnapshot) => {
    setPendingLayoutMoves(new Map(snapshot.layoutMoves));
    setPendingEdgeRouteMoves(new Map(snapshot.edgeRouteMoves));
    setPendingNodeFieldDraftsById(new Map(snapshot.nodeFieldDrafts));
    setPendingEdgeFieldDraftsById(new Map(snapshot.edgeFieldDrafts));
    setPendingEdgeSaveNoteById(new Map(snapshot.edgeSaveNotes));
    lastFieldEditKeyRef.current = null;
  }, []);

  const [globalSaveStatus, setGlobalSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [globalSaveError, setGlobalSaveError] = useState<string | null>(null);

  // "저장 완료" is a transient confirmation, not a permanent state — reverts
  // to idle on its own so the button doesn't get stuck claiming a save
  // that already happened minutes ago (same convention the Repair Case
  // Flowchart editor's own global Save button uses).
  useEffect(() => {
    if (globalSaveStatus !== "saved") return;
    const timer = setTimeout(() => setGlobalSaveStatus("idle"), 2500);
    return () => clearTimeout(timer);
  }, [globalSaveStatus]);

  // ---- rendered graph (server baseline + justSaved shadow + pending drafts, merged) ----

  const serverNodesById = useMemo(() => {
    const map = new Map<string, ProcedureServerNodeSnapshot>();
    for (const n of template.nodes) {
      const effectivePos = resolveEffectiveNodePosition(n, "USER");
      const raw: ProcedureServerNodeSnapshot = {
        id: n.id,
        title: n.title,
        description: n.description,
        instructions: n.instructions,
        sortOrder: n.sortOrder,
        isActive: n.isActive,
        positionX: effectivePos.x,
        positionY: effectivePos.y,
      };
      map.set(n.id, mergeProcedureNodeForRender(raw, justSavedNodeFieldsById.get(n.id), justSavedPositionsById.get(n.id)));
    }
    return map;
  }, [template.nodes, justSavedNodeFieldsById, justSavedPositionsById]);

  const serverEdgesById = useMemo(() => {
    const map = new Map<string, ProcedureServerEdgeSnapshot>();
    for (const e of template.edges) {
      const raw: ProcedureServerEdgeSnapshot = {
        id: e.id,
        branchType: e.branchType,
        branchLabel: e.branchLabel,
        routePoints: e.userRoutePoints && e.userRoutePoints.length > 0 ? e.userRoutePoints : null,
      };
      map.set(e.id, mergeProcedureEdgeForRender(raw, justSavedEdgeFieldsById.get(e.id), justSavedRoutesById.get(e.id)));
    }
    return map;
  }, [template.edges, justSavedEdgeFieldsById, justSavedRoutesById]);

  function nodeFieldDraft(nodeId: string): ProcedureNodeFieldDraft {
    const pending = pendingNodeFieldDraftsById.get(nodeId);
    if (pending) return pending;
    const server = serverNodesById.get(nodeId);
    return { title: server?.title ?? "", description: server?.description ?? "", instructions: server?.instructions ?? "", sortOrder: server?.sortOrder ?? 0, isActive: server?.isActive ?? true };
  }
  function updateNodeFieldDraft(nodeId: string, patch: Partial<ProcedureNodeFieldDraft>) {
    pushPendingUndoStep(`node:${nodeId}:${Object.keys(patch).sort().join(",")}`);
    setPendingNodeFieldDraftsById((prev) => {
      const next = new Map(prev);
      next.set(nodeId, { ...nodeFieldDraft(nodeId), ...patch });
      return next;
    });
  }

  function edgeFieldDraft(edgeId: string): ProcedureEdgeFieldDraft {
    const pending = pendingEdgeFieldDraftsById.get(edgeId);
    if (pending) return pending;
    const server = serverEdgesById.get(edgeId);
    return { branchType: server?.branchType ?? "DEFAULT", branchLabel: server?.branchLabel ?? "" };
  }
  function updateEdgeFieldDraft(edgeId: string, patch: Partial<ProcedureEdgeFieldDraft>) {
    pushPendingUndoStep(`edge:${edgeId}:${Object.keys(patch).sort().join(",")}`);
    setPendingEdgeFieldDraftsById((prev) => {
      const next = new Map(prev);
      next.set(edgeId, { ...edgeFieldDraft(edgeId), ...patch });
      return next;
    });
  }
  function edgeSaveNote(edgeId: string): string {
    return pendingEdgeSaveNoteById.get(edgeId) ?? "";
  }
  function updateEdgeSaveNote(edgeId: string, note: string) {
    pushPendingUndoStep(`edgeNote:${edgeId}`);
    setPendingEdgeSaveNoteById((prev) => {
      const next = new Map(prev);
      next.set(edgeId, note);
      return next;
    });
  }

  const dirtyNodeFieldEntries = computeDirtyProcedureNodeFieldEntries(pendingNodeFieldDraftsById, serverNodesById);
  const dirtyEdgeFieldEntries = computeDirtyProcedureEdgeFieldEntries(pendingEdgeFieldDraftsById, serverEdgesById);
  const dirtyPositionNodeIds = computeDirtyProcedurePositionNodeIds(pendingLayoutMoves, serverNodesById);
  const dirtyRouteEdgeIds = computeDirtyProcedureRouteEdgeIds(pendingEdgeRouteMoves, serverEdgesById);
  const totalPendingCount = dirtyNodeFieldEntries.length + dirtyEdgeFieldEntries.length + dirtyPositionNodeIds.length + dirtyRouteEdgeIds.length;
  const hasAnyPendingChanges = totalPendingCount > 0;

  /** Full EditorNodeRow rows, safe-to-defer fields overridden by live drafts — passed to ProcedureFlowGraph/panels so there is exactly one rendered graph, never a separate copy for the canvas and another for Save. userPositionX/Y is only ever touched when THIS session actually has a position override pending or just-saved for that node — otherwise the original row's own value (null, or a real prior override) passes through untouched, preserving SOURCE-mode/layered-layout fallback behavior for every node this session never dragged. */
  const renderedNodes: EditorNodeRow[] = useMemo(
    () =>
      template.nodes.map((n) => {
        const baseline = serverNodesById.get(n.id)!;
        const merged = mergeProcedureNodeForRender(baseline, pendingNodeFieldDraftsById.get(n.id), pendingLayoutMoves.get(n.id));
        const hasSessionPositionOverride = pendingLayoutMoves.has(n.id) || justSavedPositionsById.has(n.id);
        return {
          ...n,
          title: merged.title,
          description: merged.description,
          instructions: merged.instructions,
          sortOrder: merged.sortOrder,
          isActive: merged.isActive,
          userPositionX: hasSessionPositionOverride ? merged.positionX : n.userPositionX,
          userPositionY: hasSessionPositionOverride ? merged.positionY : n.userPositionY,
        };
      }),
    [template.nodes, serverNodesById, pendingNodeFieldDraftsById, pendingLayoutMoves, justSavedPositionsById]
  );

  const renderedEdges: EditorEdgeRow[] = useMemo(
    () =>
      template.edges.map((e) => {
        const baseline = serverEdgesById.get(e.id)!;
        const merged = mergeProcedureEdgeForRender(baseline, pendingEdgeFieldDraftsById.get(e.id), pendingEdgeRouteMoves.get(e.id));
        return { ...e, branchType: merged.branchType, branchLabel: merged.branchLabel, userRoutePoints: merged.routePoints };
      }),
    [template.edges, serverEdgesById, pendingEdgeFieldDraftsById, pendingEdgeRouteMoves]
  );

  // Unsaved-navigation guard (Phase 4A, widened Phase 4B, extended 5C-6D-1C
  // to every safe-to-defer category, not just layout/route) — covers
  // browser close/refresh; the editor's own "나가기" link separately
  // confirms via window.confirm before navigating away in-app. Does not
  // intercept every possible in-app link (e.g. the global sidebar) — see
  // the final report's documented limitation.
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!hasAnyPendingChanges) return;
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasAnyPendingChanges]);

  function handleSaved(newUpdatedAt: string, structuralValidation?: StructuralValidationSummary) {
    setCurrentUpdatedAt(newUpdatedAt);
    if (structuralValidation) setLastStructuralValidation(structuralValidation);
    router.refresh();
  }

  // Phase 5C-5B — the new TECHNICAL_TASK-only node/edge structural CRUD.
  // canActorManageTechnicalTemplateGraph (the mutation layer's real
  // authorization boundary) is category-locked to TECHNICAL_TASK for every
  // role, including SUPER_ADMIN — this UI gate mirrors that exactly, so
  // FULL_SERVICE/REFERENCE never even render the add-node tab or delete
  // sections, regardless of canEdit.
  const isTechnical = template.category === "TECHNICAL_TASK";
  const canDeleteGraph = isTechnical && canEdit;

  // Phase 5C-5C — Undo/Redo controls share canDeleteGraph's exact gate
  // (TECHNICAL_TASK + ADMIN/SUPER_ADMIN): FULL_SERVICE/REFERENCE never see
  // these buttons, regardless of canEdit. canUndo/canRedo come from
  // historyView (server-derived from the live 0018 fold model on every
  // load/refresh) — never client-memory state that could diverge from the
  // server. 5C-6D-1C adds a client-side guard on TOP of that: Undo/Redo is
  // additionally disabled whenever any safe-to-defer draft is pending,
  // since applying a historical Undo/Redo underneath an in-progress,
  // unsaved local edit would silently rebase that edit against a state the
  // user never asked it to apply to. No such guard existed before this
  // checkpoint (audited directly — handleUndo/handleRedo had no
  // hasPendingLayoutChanges check at all); this is a genuinely new, but
  // explicitly requested, safety behavior, not a preserved one.
  const [isUndoing, setIsUndoing] = useState(false);
  const [isRedoing, setIsRedoing] = useState(false);
  const [undoRedoError, setUndoRedoError] = useState<string | null>(null);

  /**
   * [이전] — 저장하지 않은 변경이 남아 있으면 그것부터 한 단계씩 되돌리고,
   * 다 되돌린 뒤에야 서버 이력을 되돌린다. 사용자에게는 버튼 하나로 보이지만
   * 대상이 둘이며, 순서가 뒤바뀌면 아직 저장도 안 된 화면 상태 위에 서버
   * 되돌리기가 겹쳐 무엇이 남았는지 알 수 없게 된다 — 그래서 저장 전 변경이
   * 하나라도 남아 있는 동안에는 서버 이력에 손대지 않는다.
   */
  async function handleUndo() {
    if (canUndoStack(pendingUndoStack)) {
      const result = undoStep(pendingUndoStack, pendingSnapshotRef.current, pendingSnapshotsEqual);
      setPendingUndoStack(result.stack);
      if (result.restored) {
        applyPendingSnapshot(result.restored);
        return;
      }
    }
    if (hasAnyPendingChanges) return;
    setIsUndoing(true);
    setUndoRedoError(null);
    const result = await undoProcedureTemplateChangeAction({ templateId: template.id, expectedTemplateUpdatedAt: currentUpdatedAt });
    setIsUndoing(false);
    if (!result.ok) {
      setUndoRedoError(result.message);
      return;
    }
    handleSaved(result.updatedAt);
  }

  /** [앞으로] — handleUndo와 정확히 대칭이다(저장 전 단계를 먼저, 그다음 서버 이력). */
  async function handleRedo() {
    if (canRedoStack(pendingUndoStack)) {
      const result = redoStep(pendingUndoStack, pendingSnapshotRef.current, pendingSnapshotsEqual);
      setPendingUndoStack(result.stack);
      if (result.restored) {
        applyPendingSnapshot(result.restored);
        return;
      }
    }
    if (hasAnyPendingChanges) return;
    setIsRedoing(true);
    setUndoRedoError(null);
    const result = await redoProcedureTemplateChangeAction({ templateId: template.id, expectedTemplateUpdatedAt: currentUpdatedAt });
    setIsRedoing(false);
    if (!result.ok) {
      setUndoRedoError(result.message);
      return;
    }
    handleSaved(result.updatedAt);
  }

  function handleNodeDeleted(newUpdatedAt: string) {
    if (selectedNodeId) {
      setPendingNodeFieldDraftsById((prev) => {
        if (!prev.has(selectedNodeId)) return prev;
        const next = new Map(prev);
        next.delete(selectedNodeId);
        return next;
      });
      setPendingLayoutMoves((prev) => {
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
      setPendingEdgeFieldDraftsById((prev) => {
        if (!prev.has(selectedEdgeId)) return prev;
        const next = new Map(prev);
        next.delete(selectedEdgeId);
        return next;
      });
      setPendingEdgeRouteMoves((prev) => {
        if (!prev.has(selectedEdgeId)) return prev;
        const next = new Map(prev);
        next.delete(selectedEdgeId);
        return next;
      });
      setPendingEdgeSaveNoteById((prev) => {
        if (!prev.has(selectedEdgeId)) return prev;
        const next = new Map(prev);
        next.delete(selectedEdgeId);
        return next;
      });
    }
    setSelectedEdgeId(null);
    setSelectedWaypoint(null);
    handleSaved(newUpdatedAt);
  }

  // Phase 5C-5B usability item 5 — inline rename, TECHNICAL_TASK DRAFT only
  // (canDeleteGraph already encodes exactly this eligibility: isTechnical &&
  // canEdit, and canEdit only reaches this screen for a DRAFT template).
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(template.name);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  function startEditingName() {
    setNameDraft(template.name);
    setRenameError(null);
    setIsEditingName(true);
  }
  function cancelEditingName() {
    setIsEditingName(false);
    setRenameError(null);
  }
  async function handleRenameSubmit() {
    const trimmed = nameDraft.trim();
    if (trimmed.length === 0 || trimmed === template.name) {
      setIsEditingName(false);
      return;
    }
    setIsRenaming(true);
    setRenameError(null);
    const result = await renameTechnicalProcedureTemplateAction({
      templateId: template.id,
      name: trimmed,
      expectedTemplateUpdatedAt: currentUpdatedAt,
    });
    setIsRenaming(false);
    if (!result.ok) {
      setRenameError(result.message);
      return;
    }
    setIsEditingName(false);
    handleSaved(result.updatedAt);
  }

  /** Reads a route's current *working* points (pending override if this session touched it, else the last-saved value) — the one baseline every waypoint mutation below builds its next array from. Unchanged from before 1C. */
  function currentWorkingRoutePoints(pending: Map<string, RoutePoint[] | null>, edgeId: string): RoutePoint[] {
    const points = pending.has(edgeId) ? pending.get(edgeId) : savedEdgeRoutes.get(edgeId);
    return points ?? [];
  }

  /**
   * Maps each ProcedureSaveStep to its EXISTING server action (5C-6D-1C
   * §10 audit): NODE_FIELDS -> updateProcedureTemplateNodeAction,
   * EDGE_FIELDS -> updateProcedureTemplateEdgeAction,
   * LAYOUT_AND_ROUTES -> saveProcedureTemplateLayoutAction (already the
   * single combined mutation both drag-position and route changes go
   * through, unchanged). No new "save whole procedure" mutation exists or
   * is needed. `capturedStructuralValidation` is a plain local variable —
   * the generic runSaveSequence executor only ever sees `{ok, updatedAt}`;
   * this auxiliary result is captured here, in the screen's own closure,
   * per this checkpoint's explicit instruction not to pollute
   * graph-editor-core with Procedure-specific data.
   */
  async function handleGlobalSave() {
    if (!hasAnyPendingChanges) return;
    setGlobalSaveStatus("saving");
    setGlobalSaveError(null);

    const steps = planProcedureSaveSteps({ dirtyNodeFieldEntries, dirtyEdgeFieldEntries, dirtyPositionNodeIds, dirtyRouteEdgeIds });

    let capturedStructuralValidation: StructuralValidationSummary | null = null;

    async function executeStep(step: ProcedureSaveStep, expectedUpdatedAt: string): Promise<ProcedureSaveStepResult> {
      if (step.kind === "NODE_FIELDS") {
        const draft = nodeFieldDraft(step.nodeId);
        const result = await updateProcedureTemplateNodeAction({
          nodeId: step.nodeId,
          patch: { title: draft.title, description: draft.description.trim() || null, instructions: draft.instructions.trim() || null, sortOrder: draft.sortOrder, isActive: draft.isActive },
          expectedTemplateUpdatedAt: expectedUpdatedAt,
        });
        return result.ok ? { ok: true, updatedAt: result.updatedAt } : { ok: false, message: result.message };
      }
      if (step.kind === "EDGE_FIELDS") {
        const draft = edgeFieldDraft(step.edgeId);
        const note = edgeSaveNote(step.edgeId).trim() || null;
        const result = await updateProcedureTemplateEdgeAction({
          edgeId: step.edgeId,
          patch: { branchType: draft.branchType, branchLabel: draft.branchLabel.trim() || null },
          expectedTemplateUpdatedAt: expectedUpdatedAt,
          note,
        });
        if (!result.ok) return { ok: false, message: result.message };
        // EDGE_FIELDS is the one step kind whose mutation always re-runs
        // structural validation, even for a plain branchType/label edit
        // (5C-6D-1B audit finding) — never silently dropped.
        capturedStructuralValidation = result.structuralValidation;
        return { ok: true, updatedAt: result.updatedAt };
      }
      // LAYOUT_AND_ROUTES
      const positions = step.nodeIds.map((nodeId) => {
        const pos = pendingLayoutMoves.get(nodeId)!;
        return { nodeId, x: pos.x, y: pos.y };
      });
      const edgeRoutes: EdgeRouteInput[] = step.edgeIds.map((edgeId) => ({ edgeId, points: pendingEdgeRouteMoves.has(edgeId) ? (pendingEdgeRouteMoves.get(edgeId) ?? null) : null }));
      const result = await saveProcedureTemplateLayoutAction({ templateId: template.id, positions, edgeRoutes, expectedTemplateUpdatedAt: expectedUpdatedAt });
      return result.ok ? { ok: true, updatedAt: result.updatedAt } : { ok: false, message: result.message };
    }

    const outcome = await runProcedureSaveSequence(steps, currentUpdatedAt, executeStep);

    const flushedNodeFieldIds = succeededProcedureNodeFieldIds(outcome.succeededSteps);
    const flushedEdgeFieldIds = succeededProcedureEdgeFieldIds(outcome.succeededSteps);
    const flushedLayoutNodeIds = succeededProcedureLayoutNodeIds(outcome.succeededSteps);
    const flushedRouteEdgeIds = succeededProcedureRouteEdgeIds(outcome.succeededSteps);

    // Shadow every just-persisted value BEFORE clearing its pending entry,
    // so the canvas keeps showing the correct (just-saved) result even
    // though no refresh has happened yet — see this file's own SAVE
    // CONTRACT doc comment.
    if (flushedNodeFieldIds.length > 0) {
      setJustSavedNodeFieldsById((prev) => {
        const next = new Map(prev);
        for (const id of flushedNodeFieldIds) next.set(id, nodeFieldDraft(id));
        return next;
      });
      setPendingNodeFieldDraftsById((prev) => {
        const next = new Map(prev);
        for (const id of flushedNodeFieldIds) next.delete(id);
        return next;
      });
    }
    if (flushedEdgeFieldIds.length > 0) {
      setJustSavedEdgeFieldsById((prev) => {
        const next = new Map(prev);
        for (const id of flushedEdgeFieldIds) next.set(id, edgeFieldDraft(id));
        return next;
      });
      setPendingEdgeFieldDraftsById((prev) => {
        const next = new Map(prev);
        for (const id of flushedEdgeFieldIds) next.delete(id);
        return next;
      });
      setPendingEdgeSaveNoteById((prev) => {
        const next = new Map(prev);
        for (const id of flushedEdgeFieldIds) next.delete(id);
        return next;
      });
    }
    if (flushedLayoutNodeIds.length > 0) {
      setJustSavedPositionsById((prev) => {
        const next = new Map(prev);
        for (const id of flushedLayoutNodeIds) {
          const pos = pendingLayoutMoves.get(id);
          if (pos) next.set(id, pos);
        }
        return next;
      });
      setPendingLayoutMoves((prev) => {
        const next = new Map(prev);
        for (const id of flushedLayoutNodeIds) next.delete(id);
        return next;
      });
    }
    if (flushedRouteEdgeIds.length > 0) {
      setJustSavedRoutesById((prev) => {
        const next = new Map(prev);
        for (const id of flushedRouteEdgeIds) next.set(id, pendingEdgeRouteMoves.has(id) ? (pendingEdgeRouteMoves.get(id) ?? null) : null);
        return next;
      });
      setPendingEdgeRouteMoves((prev) => {
        const next = new Map(prev);
        for (const id of flushedRouteEdgeIds) next.delete(id);
        return next;
      });
    }

    setCurrentUpdatedAt(outcome.finalUpdatedAt);
    if (capturedStructuralValidation) setLastStructuralValidation(capturedStructuralValidation);

    if (outcome.failedAtStep) {
      // PARTIAL FAILURE: retain failed/unrun drafts (never touched above),
      // rebase the concurrency token, but do NOT refresh — a refresh here
      // would fetch a server state that doesn't yet include enough of this
      // save to be safely reconciled against the drafts that are still
      // pending, and none of that reconciliation is needed anyway: the
      // justSaved shadows already make the canvas correct without it.
      setGlobalSaveStatus("failed");
      setGlobalSaveError(outcome.failureMessage);
      return;
    }

    // FULL SUCCESS: every pending category is now empty, so a refresh is
    // both safe and useful (fresh unresolvedIssues, node codes for a
    // freshly-inserted node from an unrelated action, etc.) — the
    // justSaved shadows built above become redundant the instant this
    // refresh lands and are cleared by the adjust-state-during-render
    // block at the top of this component.
    setSelectedWaypoint(null);
    setGlobalSaveStatus("saved");
    // 저장에 성공한 변경은 이제 서버 이력의 몫이다 — 클라이언트 스택을 비워
    // 같은 변경이 두 체계에 중복으로 남지 않게 한다([이전]을 누르면 서버
    // 이력으로 곧바로 넘어간다).
    setPendingUndoStack(createUndoStack<PendingSnapshot>());
    lastFieldEditKeyRef.current = null;
    router.refresh();
  }

  function handleDiscardAllPending() {
    // "모두 취소"도 한 단계다 — 실수로 눌렀다면 [이전]으로 통째로 되살릴 수 있다.
    pushPendingUndoStep();
    // Client-only — nothing was ever persisted for anything still pending
    // at this point, so there is no server call and no DISCARD_DRAFT_CHANGES
    // audit row (that action type is reserved for a case where server
    // state actually changed, which never applies here).
    setPendingNodeFieldDraftsById(new Map());
    setPendingEdgeFieldDraftsById(new Map());
    setPendingEdgeSaveNoteById(new Map());
    setPendingLayoutMoves(new Map());
    setPendingEdgeRouteMoves(new Map());
    setSelectedWaypoint(null);
    setGlobalSaveStatus("idle");
    setGlobalSaveError(null);
  }

  async function handleValidate() {
    setIsValidating(true);
    const result = await validateProcedureTemplateAction({ templateId: template.id });
    setIsValidating(false);
    if (result.ok) {
      setLastStructuralValidation(result.structuralValidation);
      switchRightPanelTab("validation");
      router.refresh();
    }
  }

  function handleExit() {
    if (hasAnyPendingChanges && !window.confirm("저장하지 않은 변경사항이 있습니다. 나가시겠습니까?")) {
      return;
    }
    router.push(`/procedures/${template.id}`);
  }

  // Stable references (useCallback) are required here, not just tidiness —
  // ProcedureFlowGraph's own selection-sync effect depends on
  // [selectedNodeId, onNodeSelectionChange]; an inline arrow function would
  // get a new identity on every render of *this* component (e.g. every
  // right-panel tab click), re-firing that effect and silently resetting
  // rightPanelTab back to "properties" even though the selected node never
  // actually changed.
  const handleNodeSelectionChange = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    if (nodeId) setRightPanelTab("properties");
  }, []);

  /**
   * "화면에서 선택" 모드의 클릭 처리. 그래프의 선택 변경 통지가 아니라 누른
   * 노드 id를 그대로 받는다 — 그래프는 이미 선택된 노드를 다시 누르면 선택을
   * 해제하므로, 선택 변경으로 받으면 "같은 노드를 다시 고르기"가 통하지 않는다.
   * true를 돌려주면 그래프는 선택을 건드리지 않는다: 고르는 동안 화면 선택이
   * 그대로 유지돼야 오른쪽 패널(연결 추가 / 속성)이 사라지지 않는다.
   */
  const handleNodeClickIntercept = useCallback((nodeId: string) => {
    if (isPickingEdgeTargetRef.current) {
      isPickingEdgeTargetRef.current = false;
      setIsPickingEdgeTarget(false);
      setPickedEdgeTarget((prev) => ({ nodeId, seq: (prev?.seq ?? 0) + 1 }));
      return true;
    }
    if (isPickingReferenceNodeRef.current) {
      isPickingReferenceNodeRef.current = false;
      setIsPickingReferenceNode(false);
      setPickedReferenceNode((prev) => ({ nodeId, seq: (prev?.seq ?? 0) + 1 }));
      return true;
    }
    return false;
  }, []);
  /** 오른쪽 패널 탭을 바꾸는 단일 경로 — 탭을 떠나면 선택 대기와 시작 노드 고정을 함께 푼다(모드가 켜진 채로 남아 다음 클릭을 가로채지 않게). */
  const switchRightPanelTab = useCallback((tab: RightPanelTab) => {
    isPickingEdgeTargetRef.current = false;
    setIsPickingEdgeTarget(false);
    isPickingReferenceNodeRef.current = false;
    setIsPickingReferenceNode(false);
    setRightPanelTab(tab);
  }, []);
  const handleEdgeSelectionChange = useCallback((edgeId: string | null) => {
    // 분기를 고르는 것은 대상 노드 고르기가 아니다 — 선택 대기 중이었다면
    // 여기서 함께 해제한다(모드가 남아 다음 노드 클릭을 가로채지 않게).
    isPickingEdgeTargetRef.current = false;
    setIsPickingEdgeTarget(false);
    isPickingReferenceNodeRef.current = false;
    setIsPickingReferenceNode(false);
    setSelectedEdgeId(edgeId);
    if (edgeId) setRightPanelTab("properties");
  }, []);
  /** 5C-6D-1D — the ONE place both a canvas drag-stop and NodePropertyPanel's "상대 위치로 이동" buttons funnel through, mirroring CaseFlowchartEditorScreen's own setPendingNodePosition. No mutation call here; position is dirty/pending like every other field, only global [저장] persists it. */
  // pushPendingUndoStep는 useCallback([])으로 신원이 고정돼 있어 의존성에 넣어도
  // 이 콜백의 신원이 흔들리지 않는다(그래프 선택 동기화 effect 참고).
  const setPendingPosition = useCallback((nodeId: string, position: Position) => {
    // 드래그는 시작할 때 이미 한 단계를 찍었다 — 프레임마다 또 찍지 않는다.
    // 버튼(상대 위치로 이동)으로 온 호출은 여기서 한 단계가 된다.
    if (!isNodeDraggingRef.current) pushPendingUndoStep();
    setPendingLayoutMoves((prev) => {
      const next = new Map(prev);
      next.set(nodeId, position);
      return next;
    });
  }, [pushPendingUndoStep]);

  /** 드래그 한 번이 되돌리기 한 단계다 — 시작할 때 직전 상태를 찍고, 끝날 때까지 더 찍지 않는다. */
  const handleNodeDragStart = useCallback(() => {
    pushPendingUndoStep();
    isNodeDraggingRef.current = true;
  }, [pushPendingUndoStep]);

  const handleNodeDragStop = useCallback(
    (nodeId: string, position: Position) => {
      setPendingPosition(nodeId, position);
      isNodeDraggingRef.current = false;
    },
    [setPendingPosition]
  );

  // ---- Phase 4B: manual edge-route (waypoint) editing — UNCHANGED from
  // before 1C. Every one of these only ever touches pendingEdgeRouteMoves —
  // client state only, never a Server Action call, same as before. ----

  const handleWaypointSelectionChange = useCallback(
    (index: number | null) => {
      // 경로점을 누른 시점(=끌기 시작)에 한 단계를 찍는다. 끌지 않고 고르기만
      // 했다면 상태가 그대로라, 그 단계는 [이전]을 누를 때 조용히 버려진다
      // (undo-stack.ts의 "헛도는 단계는 건너뛴다" 규칙).
      if (index !== null) pushPendingUndoStep();
      // The selection is stored with the edge it belongs to (see selectedWaypoint
      // above) — with no selected edge there is no edge for it to belong to.
      setSelectedWaypoint(index === null || !selectedEdgeId ? null : { edgeId: selectedEdgeId, index });
    },
    [pushPendingUndoStep, selectedEdgeId]
  );

  const handleWaypointMove = useCallback(
    (edgeId: string, index: number, point: RoutePoint) => {
      setPendingEdgeRouteMoves((prev) => {
        const next = new Map(prev);
        next.set(edgeId, moveWaypoint(currentWorkingRoutePoints(prev, edgeId), index, point));
        return next;
      });
    },
    [savedEdgeRoutes]
  );

  /**
   * 5C-6D-1E — double-click "straighten this connection", ported from
   * CaseFlowchartEditorScreen's own handleEdgeDoubleClick (same
   * computeStraightenedConnectedNodePosition call, same source-fixed/
   * target-moves rule, same route-reset-to-automatic behavior). Replaces
   * the retired waypoint-insert-on-double-click meaning — explicit
   * waypoint add/remove/reset stays fully available via handleAddWaypoint/
   * handleRemoveSelectedWaypoint/handleResetEdgeRoute, untouched below.
   *
   * Also the handler behind EdgePropertyPanel's new "연결 정렬" button
   * (canStraighten below) — one function, no duplicated math, no
   * duplicated save path, called identically from either entry point.
   *
   * Position/dimension sources match 1D exactly: workingLayoutPositions
   * (server baseline + pendingLayoutMoves merged — the CURRENT visible
   * position, including any unsaved drag) and resolveNodeDimensions
   * (measured-first via the React Flow instance, estimate-fallback) on
   * renderedNodes (baseline + pending-draft-merged rows). No no-op
   * position guard here — matching Case's own precedent exactly:
   * computeStraightenedConnectedNodePosition already returns the target's
   * unchanged position when already aligned, and
   * computeDirtyProcedurePositionNodeIds already excludes an entry that
   * equals the server baseline from dirty/Save — no separate check is
   * needed. The route reset IS guarded (only when a manual route actually
   * exists) so an already-automatic edge never gets a meaningless pending
   * entry.
   */
  const handleEdgeDoubleClick = useCallback(
    (edgeId: string) => {
      const edge = template.edges.find((e) => e.id === edgeId);
      if (!edge) return;
      const sourceNode = renderedNodes.find((n) => n.id === edge.fromNodeId);
      const targetNode = renderedNodes.find((n) => n.id === edge.toNodeId);
      const sourcePos = workingLayoutPositions.get(edge.fromNodeId);
      const targetPos = workingLayoutPositions.get(edge.toNodeId);
      if (!sourceNode || !targetNode || !sourcePos || !targetPos) return;

      const sourceDims = resolveNodeDimensions(sourceNode);
      const targetDims = resolveNodeDimensions(targetNode);
      const straightened = computeStraightenedConnectedNodePosition(
        { x: sourcePos.x, y: sourcePos.y, width: sourceDims.width, height: sourceDims.height },
        { x: targetPos.x, y: targetPos.y, width: targetDims.width, height: targetDims.height }
      );
      setPendingPosition(targetNode.id, straightened.position);

      const currentRoute = currentWorkingRoutePoints(pendingEdgeRouteMoves, edgeId);
      if (currentRoute.length > 0) {
        setPendingEdgeRouteMoves((prev) => {
          const next = new Map(prev);
          next.set(edgeId, null);
          return next;
        });
      }
    },
    [template.edges, renderedNodes, workingLayoutPositions, pendingEdgeRouteMoves, savedEdgeRoutes, setPendingPosition, resolveNodeDimensions]
  );

  /**
   * "경로점 추가" — the primary insertion method, no click position
   * required: inserts at the midpoint of the selected edge's longest
   * current segment. Forces USER (사용자 배치) mode — the newly-added point
   * is otherwise invisible/unclickable (see this file's own layoutMode
   * doc comment), silently blocking the very next step the side panel
   * asks for ("선택된 경로점 위치에 새 노드를 삽입"). Unchanged from before 1C.
   */
  const handleAddWaypoint = useCallback(() => {
    if (!selectedEdgeId) return;
    pushPendingUndoStep();
    const edge = template.edges.find((e) => e.id === selectedEdgeId);
    const source = edge ? workingLayoutPositions.get(edge.fromNodeId) : undefined;
    const target = edge ? workingLayoutPositions.get(edge.toNodeId) : undefined;
    if (!edge || !source || !target) return;
    setLayoutMode("USER");
    setPendingEdgeRouteMoves((prev) => {
      const next = new Map(prev);
      next.set(selectedEdgeId, addWaypointAtDefaultPosition(currentWorkingRoutePoints(prev, selectedEdgeId), source, target));
      return next;
    });
  }, [selectedEdgeId, template.edges, workingLayoutPositions, savedEdgeRoutes, pushPendingUndoStep]);

  /** "선택 경로점 삭제" (button and Delete/Backspace) — removing the last remaining point restores automatic routing, per removeWaypoint's own semantics. Unchanged from before 1C. */
  const handleRemoveSelectedWaypoint = useCallback(() => {
    if (!selectedEdgeId || selectedWaypointIndex === null) return;
    pushPendingUndoStep();
    setPendingEdgeRouteMoves((prev) => {
      const next = new Map(prev);
      next.set(selectedEdgeId, removeWaypoint(currentWorkingRoutePoints(prev, selectedEdgeId), selectedWaypointIndex));
      return next;
    });
    setSelectedWaypoint(null);
  }, [selectedEdgeId, selectedWaypointIndex, savedEdgeRoutes, pushPendingUndoStep]);

  /** "자동 경로로 초기화" — explicit restore, discoverable beyond deleting every point one at a time. Unchanged from before 1C. */
  const handleResetEdgeRoute = useCallback((edgeId: string) => {
    pushPendingUndoStep();
    setPendingEdgeRouteMoves((prev) => {
      const next = new Map(prev);
      next.set(edgeId, null);
      return next;
    });
    setSelectedWaypoint(null);
  }, [pushPendingUndoStep]);

  // Delete/Backspace removes the selected waypoint — only when a waypoint
  // is actually selected and focus isn't inside a text input/textarea/
  // select/contenteditable element (never hijack ordinary text editing
  // elsewhere in the editor, e.g. the property panels' own fields).
  // Unchanged from before 1C.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (!canEdit || !selectedEdgeId || selectedWaypointIndex === null) return;
      const active = document.activeElement;
      const tag = active?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (active instanceof HTMLElement && active.isContentEditable)) return;
      e.preventDefault();
      handleRemoveSelectedWaypoint();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canEdit, selectedEdgeId, selectedWaypointIndex, handleRemoveSelectedWaypoint]);

  const selectedNode = selectedNodeId ? renderedNodes.find((n) => n.id === selectedNodeId) ?? null : null;
  const selectedEdge = selectedEdgeId ? renderedEdges.find((e) => e.id === selectedEdgeId) ?? null : null;

  /** 5C-6D-1E — same gate ProcedureFlowGraph's own double-click handler already applies before requesting a straighten (editable + 사용자 배치 only); the explicit "연결 정렬" button in EdgePropertyPanel must never offer an action the canvas gesture itself wouldn't currently allow. */
  const canStraighten = canEdit && layoutMode === "USER";

  return (
    <div className="flex flex-col gap-4">
      {issueParam && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs dark:border-blue-900 dark:bg-blue-950">
          <p className="text-blue-800 dark:text-blue-300">
            검증 이슈에서 편집기로 이동했습니다.
            {!navigationTarget.nodeId && " 정확한 노드가 아직 연결되지 않았습니다. 후보 위치를 확인하세요."}
            {navigationTarget.nodeId && navigationTarget.isFallback && " 정확히 일치하는 노드가 없어 가장 가까운 연결된 노드로 이동했습니다."}
          </p>
          <Link href={`/procedures/${template.id}/validation/${issueParam}`} className="shrink-0 rounded-md border border-blue-300 px-2 py-1 font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:text-blue-300">
            ← 오류 상세로 돌아가기
          </Link>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {isEditingName ? (
            <span className="flex items-center gap-1">
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                disabled={isRenaming}
                autoFocus
                className="rounded-md border border-zinc-300 px-2 py-1 text-sm font-semibold text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
              <button
                type="button"
                onClick={() => void handleRenameSubmit()}
                disabled={isRenaming || nameDraft.trim().length === 0}
                className="rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
              >
                저장
              </button>
              <button type="button" onClick={cancelEditingName} disabled={isRenaming} className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300">
                취소
              </button>
              {renameError && <span className="text-xs text-red-600 dark:text-red-400">{renameError}</span>}
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <span className="font-semibold text-zinc-900 dark:text-zinc-50">{template.name}</span>
              {canDeleteGraph && (
                <button type="button" onClick={startEditingName} className="rounded-md border border-zinc-300 px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400">
                  이름 변경
                </button>
              )}
            </span>
          )}
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">v{template.version}</span>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{procedureTemplateStatusLabels[template.status]}</span>
          {!canEdit && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
              읽기 전용{isTechnical ? "" : " (SUPER_ADMIN만 편집 가능)"}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <>
              <button
                type="button"
                onClick={() => void handleGlobalSave()}
                disabled={!hasAnyPendingChanges || globalSaveStatus === "saving"}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
              >
                {globalSaveStatus === "saving"
                  ? "저장 중..."
                  : !hasAnyPendingChanges
                    ? "저장할 변경 없음"
                    : globalSaveStatus === "failed"
                      ? "저장 실패 - 다시 시도"
                      : "저장"}
              </button>
              <button type="button" onClick={handleDiscardAllPending} disabled={!hasAnyPendingChanges} className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300">
                취소
              </button>
              {globalSaveStatus === "saved" && <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">저장 완료</span>}
              {hasAnyPendingChanges && globalSaveStatus === "idle" && <span className="text-xs text-zinc-500 dark:text-zinc-400">변경사항 {totalPendingCount}건 저장 대기 중</span>}
            </>
          )}
          {canDeleteGraph && (
            <UndoRedoControls
              canUndo={canUndoStack(pendingUndoStack) || (historyView.canUndo && !hasAnyPendingChanges)}
              canRedo={canRedoStack(pendingUndoStack) || (historyView.canRedo && !hasAnyPendingChanges)}
              isUndoing={isUndoing}
              isRedoing={isRedoing}
              onUndo={() => void handleUndo()}
              onRedo={() => void handleRedo()}
            />
          )}
          <button type="button" onClick={() => void handleValidate()} disabled={isValidating} className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300">
            {isValidating ? "검증 중..." : "검증"}
          </button>
          <button type="button" onClick={() => switchRightPanelTab("compare")} disabled={!comparison} className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300">
            부모 버전과 비교
          </button>
          <button type="button" onClick={handleExit} className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300">
            편집기 나가기
          </button>
        </div>
      </div>
      {globalSaveStatus === "failed" && globalSaveError && <p className="text-xs text-red-600 dark:text-red-400">{globalSaveError}</p>}
      {undoRedoError && <p className="text-xs text-red-600 dark:text-red-400">{undoRedoError}</p>}
      {canDeleteGraph && hasAnyPendingChanges && (historyView.canUndo || historyView.canRedo) && (
        <p className="text-xs text-amber-700 dark:text-amber-400">저장하지 않은 변경사항이 있어 실행 취소/다시 실행을 사용할 수 없습니다. 먼저 저장하거나 취소하세요.</p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-2">
          <ProcedureFlowGraph
            templateId={template.id}
            nodes={renderedNodes}
            edges={renderedEdges}
            openIssuesByNodeId={openIssuesByNodeId}
            initialWorksheet={navigationTarget.worksheetFilter}
            initialSelectedNodeId={navigationTarget.nodeId}
            errorFocusMode={errorFocusMode}
            editable={canEdit}
            useAutoLayoutForUnpositionedNodes={isTechnical}
            onNodeSelectionChange={handleNodeSelectionChange}
            onNodeClickIntercept={handleNodeClickIntercept}
            onEdgeSelectionChange={handleEdgeSelectionChange}
            onNodeDragStart={handleNodeDragStart}
            onNodeDragStop={handleNodeDragStop}
            selectedEdgeId={selectedEdgeId}
            edgeRoutesByEdgeId={workingEdgeRoutes}
            selectedWaypointIndex={selectedWaypointIndex}
            onWaypointSelectionChange={handleWaypointSelectionChange}
            onWaypointMove={handleWaypointMove}

            onEdgeDoubleClick={handleEdgeDoubleClick}
            layoutMode={layoutMode}
            onLayoutModeChange={setLayoutMode}
            onInstanceReady={(instance) => {
              reactFlowInstanceRef.current = instance;
            }}
          />
          <ProcedureGraphLegend />
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap gap-1 border-b border-zinc-200 pb-2 text-xs dark:border-zinc-800">
            {(["properties", "validation", "history", "createEdge", ...(canDeleteGraph ? (["addNode"] as const) : [])] as RightPanelTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => switchRightPanelTab(tab)}
                className={`rounded-md px-2 py-1 ${rightPanelTab === tab ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}
              >
                {tab === "properties" ? "속성" : tab === "validation" ? "검증" : tab === "history" ? "이력" : tab === "createEdge" ? "연결 추가" : "노드 추가"}
              </button>
            ))}
          </div>

          {rightPanelTab === "properties" && selectedNode && (
            <NodePropertyPanel
              node={selectedNode}
              allNodes={renderedNodes}
              isPickingReference={isPickingReferenceNode}
              onStartPickReference={() => {
                isPickingReferenceNodeRef.current = true;
                setIsPickingReferenceNode(true);
              }}
              onCancelPickReference={() => {
                isPickingReferenceNodeRef.current = false;
                setIsPickingReferenceNode(false);
              }}
              pickedReferenceNode={pickedReferenceNode}
              canEdit={canEdit}
              expectedTemplateUpdatedAt={currentUpdatedAt}
              draft={nodeFieldDraft(selectedNode.id)}
              onDraftChange={(patch) => updateNodeFieldDraft(selectedNode.id, patch)}
              onPositionDraftChange={(position) => setPendingPosition(selectedNode.id, position)}
              resolveNodeDimensions={resolveNodeDimensions}
              onSaved={handleSaved}
              canDelete={canDeleteGraph}
              onDeleted={handleNodeDeleted}
              canPosition={canDeleteGraph}
              isTechnical={isTechnical}
            />
          )}
          {rightPanelTab === "properties" && !selectedNode && selectedEdge && (
            <EdgePropertyPanel
              edge={selectedEdge}
              nodes={renderedNodes}
              canEdit={canEdit}
              expectedTemplateUpdatedAt={currentUpdatedAt}
              draft={edgeFieldDraft(selectedEdge.id)}
              onDraftChange={(patch) => updateEdgeFieldDraft(selectedEdge.id, patch)}
              note={edgeSaveNote(selectedEdge.id)}
              onNoteChange={(note) => updateEdgeSaveNote(selectedEdge.id, note)}
              onSaved={handleSaved}
              routePoints={workingEdgeRoutes.get(selectedEdge.id) ?? null}
              selectedWaypointIndex={selectedWaypointIndex}
              onAddWaypoint={handleAddWaypoint}
              onRemoveSelectedWaypoint={handleRemoveSelectedWaypoint}
              onResetRoute={() => handleResetEdgeRoute(selectedEdge.id)}
              onStraighten={canStraighten ? () => handleEdgeDoubleClick(selectedEdge.id) : null}
              canDelete={canDeleteGraph}
              onDeleted={handleEdgeDeleted}
              canInsertNode={canDeleteGraph}
              isTechnical={isTechnical}
            />
          )}
          {rightPanelTab === "properties" && !selectedNode && !selectedEdge && <p className="text-xs text-zinc-400 dark:text-zinc-600">그래프에서 노드나 분기를 선택하세요.</p>}

          {rightPanelTab === "createEdge" && (
            <CreateEdgePanel
              templateId={template.id}
              nodes={renderedNodes}
              canEdit={canEdit}
              expectedTemplateUpdatedAt={currentUpdatedAt}
              prefillFromNodeId={selectedNodeId}
              isPickingTarget={isPickingEdgeTarget}
              onStartPickTarget={() => {
                isPickingEdgeTargetRef.current = true;
                setIsPickingEdgeTarget(true);
              }}
              onCancelPickTarget={() => {
                isPickingEdgeTargetRef.current = false;
                setIsPickingEdgeTarget(false);
              }}
              pickedTarget={pickedEdgeTarget}
              onSaved={handleSaved}
              isTechnical={isTechnical}
            />
          )}

          {rightPanelTab === "addNode" && canDeleteGraph && (
            <CreateNodePanel templateId={template.id} expectedTemplateUpdatedAt={currentUpdatedAt} onSaved={handleSaved} selectedNode={selectedNode} resolveNodeDimensions={resolveNodeDimensions} />
          )}

          {rightPanelTab === "validation" && (
            <div className="flex flex-col gap-3 text-xs">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">가져오기 시점 검증 이슈 (미해결)</h3>
                {template.unresolvedIssues.length === 0 ? (
                  <p className="mt-1 text-zinc-400 dark:text-zinc-600">없음</p>
                ) : (
                  <ul className="mt-1 flex flex-col gap-1">
                    {template.unresolvedIssues.map((i) => (
                      <li key={i.id} className="rounded border border-zinc-100 p-1.5 dark:border-zinc-800">
                        <span className={i.severity === "ERROR" ? "font-medium text-red-600 dark:text-red-400" : "font-medium text-amber-600 dark:text-amber-400"}>
                          {procedureValidationSeverityLabels[i.severity]}
                        </span>{" "}
                        {procedureValidationIssueTypeLabels[i.issueType] ?? i.issueType}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">구조 검증 결과 {lastStructuralValidation ? "" : "(아직 실행하지 않음 — 검증 버튼을 눌러 실행)"}</h3>
                {lastStructuralValidation && (
                  <>
                    <p className="mt-1">
                      오류 <span className="font-semibold text-red-600 dark:text-red-400">{lastStructuralValidation.errorCount}</span>건 · 경고{" "}
                      <span className="font-semibold text-amber-600 dark:text-amber-400">{lastStructuralValidation.warningCount}</span>건
                    </p>
                    {lastStructuralValidation.errorCount > 0 && <p className="mt-1 text-red-600 dark:text-red-400">오류가 있으면 이 초안을 게시할 수 없습니다.</p>}
                    <ul className="mt-1 flex flex-col gap-1">
                      {lastStructuralValidation.issues.map((issue, idx) => (
                        <li key={idx} className="rounded border border-zinc-100 p-1.5 dark:border-zinc-800">
                          <span className={issue.severity === "ERROR" ? "font-medium text-red-600 dark:text-red-400" : "font-medium text-amber-600 dark:text-amber-400"}>
                            {procedureValidationSeverityLabels[issue.severity]}
                          </span>{" "}
                          {issue.message}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          )}

          {rightPanelTab === "history" && (
            <EditHistoryPanel templateId={template.id} historyView={historyView} canManage={canDeleteGraph} expectedTemplateUpdatedAt={currentUpdatedAt} onRestored={handleSaved} />
          )}

          {rightPanelTab === "compare" && comparison && comparison.ok && (
            <div className="flex flex-col gap-3 text-xs">
              <p className="text-zinc-500 dark:text-zinc-400">
                부모 버전 v{comparison.parentVersion}과 비교 — 오류/경고 차이: {comparison.draftUnresolvedCount.errorCount - comparison.parentUnresolvedCount.errorCount >= 0 ? "+" : ""}
                {comparison.draftUnresolvedCount.errorCount - comparison.parentUnresolvedCount.errorCount} / {comparison.draftUnresolvedCount.warningCount - comparison.parentUnresolvedCount.warningCount >= 0 ? "+" : ""}
                {comparison.draftUnresolvedCount.warningCount - comparison.parentUnresolvedCount.warningCount}
              </p>
              <CompareSection title={`변경된 노드 (${comparison.comparison.changedNodes.length})`}>
                {comparison.comparison.changedNodes.map((n) => (
                  <li key={n.nodeCode}>
                    {n.nodeCode}: {n.changes.map((c) => c.field).join(", ")}
                  </li>
                ))}
              </CompareSection>
              <CompareSection title={`이동한 노드 (${comparison.comparison.movedNodes.length})`}>
                {comparison.comparison.movedNodes.map((n) => (
                  <li key={n.nodeCode}>
                    {n.nodeCode}: ({n.before.x}, {n.before.y}) → ({n.after.x}, {n.after.y})
                  </li>
                ))}
              </CompareSection>
              <CompareSection title={`노드 유형 변경 (${comparison.comparison.changedNodeTypes.length})`}>
                {comparison.comparison.changedNodeTypes.map((n) => (
                  <li key={n.nodeCode}>
                    {n.nodeCode}: {procedureNodeTypeLabels[n.before]} → {procedureNodeTypeLabels[n.after]}
                  </li>
                ))}
              </CompareSection>
              <CompareSection title={`분기 대상 변경 (${comparison.comparison.retargetedEdges.length})`}>
                {comparison.comparison.retargetedEdges.map((e) => (
                  <li key={e.draftEdgeId}>
                    {e.before.fromNodeCode}→{e.before.toNodeCode} ⇒ {e.after.fromNodeCode}→{e.after.toNodeCode}
                  </li>
                ))}
              </CompareSection>
              <CompareSection title={`분기 속성 변경 (${comparison.comparison.changedEdges.length})`}>
                {comparison.comparison.changedEdges.map((e) => (
                  <li key={e.draftEdgeId}>
                    {e.fromNodeCode}→{e.toNodeCode}: {procedureBranchTypeLabels[e.before.branchType]} → {procedureBranchTypeLabels[e.after.branchType]}
                  </li>
                ))}
              </CompareSection>
              <CompareSection title={`새로 추가된 연결 (${comparison.comparison.newlyAddedEdges.length})`}>
                {comparison.comparison.newlyAddedEdges.map((e) => (
                  <li key={e.draftEdgeId}>
                    {e.fromNodeCode}→{e.toNodeCode} ({procedureBranchTypeLabels[e.branchType]})
                  </li>
                ))}
              </CompareSection>
              <CompareSection title={`연결선 경로 수동 조정 (${comparison.comparison.routeChangedEdges.length})`}>
                {comparison.comparison.routeChangedEdges.map((e) => (
                  <li key={e.draftEdgeId}>
                    {e.fromNodeCode}→{e.toNodeCode}: {e.before.isManual ? `수동 (경로점 ${e.before.pointCount}개)` : "자동"} → {e.after.isManual ? `수동 (경로점 ${e.after.pointCount}개)` : "자동"}
                  </li>
                ))}
              </CompareSection>
            </div>
          )}
          {rightPanelTab === "compare" && comparison && !comparison.ok && <p className="text-xs text-zinc-400 dark:text-zinc-600">비교할 부모 버전이 없습니다 (이 템플릿의 첫 버전).</p>}
        </div>
      </div>
    </div>
  );
}

function CompareSection({ title, children }: { title: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  const hasItems = items.some((c) => c !== null && c !== undefined && c !== false);
  return (
    <div>
      <h4 className="font-semibold text-zinc-700 dark:text-zinc-300">{title}</h4>
      {hasItems ? <ul className="mt-1 flex flex-col gap-0.5">{children}</ul> : <p className="text-zinc-400 dark:text-zinc-600">없음</p>}
    </div>
  );
}
