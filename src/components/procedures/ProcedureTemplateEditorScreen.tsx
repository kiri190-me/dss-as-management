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
import FieldAddedStepsPanel from "./editor/FieldAddedStepsPanel";
import PublishTemplateButton from "./editor/PublishTemplateButton";
import DiscardDraftButton from "./editor/DiscardDraftButton";
import UndoRedoControls from "@/components/graph-editor-core/UndoRedoControls";
import {
  createProcedureEditorUndoStack,
  pushPendingUndoEntry,
  pushStructuralUndoEntry,
  planProcedureUndo,
  planProcedureRedo,
  canRunUndoPlan,
  type ProcedureEditorUndoStack,
} from "@/lib/domain/procedure-editor-undo-plan";
import type { ProcedureTemplateForEditor, DraftParentComparisonResult, EditorNodeRow, EditorEdgeRow } from "@/lib/db/queries/procedure-template-editor";
import type { TemplateHistoryView } from "@/lib/db/queries/procedure-template-history";
import { resolveInitialGraphTarget, parseSourceReference } from "@/lib/domain/procedure-graph-navigation";
import {
  buildValidationIssueFocusMap,
  describeValidationIssueTarget,
  focusHighlightProps,
  resolveFocusFitNodeIds,
  structuralIssueFocusKey,
  importedIssueFocusKey,
  toggleIssueFocusKey,
} from "@/lib/domain/procedure-validation-issue-focus";
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
import { procedureValidationIssueTypeLabels, procedureValidationSeverityLabels, procedureBranchTypeLabels, procedureNodeTypeLabels, procedureTemplateStatusLabels, type ProcedureValidationSeverity } from "@/lib/domain/procedure-template-types";
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
import {
  buildFieldStepGhostGraph,
  pendingFieldSteps,
  EMPTY_FIELD_STEP_GHOST_GRAPH,
  type FieldAddedStep,
} from "@/lib/domain/procedure-field-added-steps";
import { useFieldStepGhostVisibility } from "./editor/use-field-step-ghost-visibility";

type RightPanelTab = "properties" | "validation" | "history" | "compare" | "createEdge" | "addNode" | "fieldSteps";

/**
 * 2026-11-03(줄기 B-⑤) — **편집기의 「배치」는 「사용자 배치」 하나뿐이다.**
 * 사용자가 말한 것: "[배치]도 [사용자 배치]만 있으면 될 것 같아."
 *
 * 🔴 셋이 뜨던 것이 뜻을 잃은 까닭은 **고를 것이 실제로 하나**이기 때문이다.
 * 「원본 배치」는 노드가 그려지는 자리가 「사용자 배치」와 똑같고
 * (resolveBaselinePosition 이 두 모드를 한 줄기로 합쳤다), 편집기에서 갈리는
 * 것은 끌 수 있느냐·경로점이 보이느냐뿐이라 **편집기에서는 언제나 열려 있어야
 * 하는 쪽**이다. 「단계별 정렬」은 끌 수도 저장할 수도 없는 미리보기다.
 *
 * 🔵 읽기 전용 화면들은 이 상수를 안 쓴다 — 거기서는 셋 그대로다(특히
 * 「단계별 정렬」은 노드가 많은 절차를 좁게 보는 유일한 모드라 남겨야 한다).
 *
 * 🔴 모듈 바깥에 두는 까닭: 렌더마다 새 배열을 만들면 아래 그림의 프롭이 매번
 * 바뀐 것이 된다.
 */
const EDITOR_LAYOUT_MODES: readonly LayoutMode[] = ["USER"];

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
  canPublish = false,
  canDiscardDraft = false,
  fieldAddedSteps = [],
}: {
  template: ProcedureTemplateForEditor;
  historyView: TemplateHistoryView;
  comparison: DraftParentComparisonResult | null;
  canEdit: boolean;
  /**
   * 편집기 안에서 게시할 수 있는가(줄기 B-④).
   *
   * 🔴 **기본값이 false 다** — 넘기는 것을 잊은 호출부는 단추가 아예 없다.
   * 절차 상세 화면의 같은 단추가 쓰는 규약 그대로다(권한은 fail-closed).
   *
   * 🔵 값은 edit/page.tsx 가 **상세 page.tsx 와 똑같은 세 관문**으로 계산해서
   * 넘긴다. 화면이 제 나름대로 다시 판정하지 않는 까닭은, 서버
   * (publishProcedureTemplate)가 거절할 단추를 내면 "보이는데 늘 실패"가
   * 되기 때문이다.
   */
  canPublish?: boolean;
  /**
   * 잘못 만든 이 초안을 **그 자리에서 버릴 수 있는가**(2026-11-04, 줄기 B-⑥).
   *
   * 🔴 **기본값이 false 다** — canPublish 와 같은 fail-closed 규약이다.
   *
   * 🔵 값은 edit/page.tsx 가 **서버가 실제로 보는 관문 그대로** 계산해 넘긴다
   * (역할 고정 canDeleteTechnicalTemplates + 설정
   * technicalProcedures.lifecycle). 화면이 제 나름대로 판정하지 않는다 —
   * 서버가 거절할 단추를 내면 "보이는데 늘 실패"가 된다.
   */
  canDiscardDraft?: boolean;
  /**
   * 이 초안의 줄기(같은 `code` 의 모든 판본)를 돌리다 **현장에서 더한 단계**
   * (2026-11-03, 줄기 B-⑧). 사용자 결정 — 「원본 절차를 편집할 때, 이번에
   * 만들었던 단계를 희미하게 표시해주고, 적용할 것인지 묻도록 하자」.
   *
   * 🔴 **기본값이 빈 목록이다** — 넘기는 것을 잊은 호출부는 탭도 유령도 없다.
   * 이 저장소의 fail-closed 규약 그대로다(canPublish 와 같은 길).
   */
  fieldAddedSteps?: readonly FieldAddedStep[];
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
  //
  // 🔴 2026-11-03(줄기 B-⑤) — **편집기의 기본 배치가 「사용자 배치」가 됐다.**
  // 고를 수 있는 것을 그 하나로 좁혔으므로(EDITOR_LAYOUT_MODES), 기본값을
  // 그대로 두면 **고를 수 없는 모드로 떠 있는** 화면이 된다.
  // 🔵 노드가 그려지는 자리는 안 바뀐다 — resolveBaselinePosition 이
  // "SOURCE"/"USER" 를 한 줄기로 합쳐 두어서, 저장된 자리 값은 전부터 양쪽에서
  // 똑같이 이겼다. 달라지는 것은 **처음부터 끌 수 있고 경로점이 보인다**는 것
  // 하나다(전에는 드롭다운을 한 번 바꿔야 열렸다).
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("USER");
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>(navigationTarget.nodeId ? "properties" : "validation");
  const [lastStructuralValidation, setLastStructuralValidation] = useState<StructuralValidationSummary | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  /**
   * 2026-11-03(줄기 B-③) — [검증] 탭에서 **지금 짚고 있는 오류 줄**.
   *
   * 줄 자체가 아니라 줄의 **이름**만 들고 있다(procedure-validation-issue-focus.ts
   * 의 키). 가리키는 곳은 매 렌더에 issueFocusByKey 에서 다시 뽑는다 — 그래야
   * 그 사이에 노드·연결선이 지워졌거나 [검증]을 다시 돌려 목록이 바뀌었을 때
   * 짚기가 **저절로 풀린다.** 가리키던 대상을 state 에 복사해 두면 사라진 id 를
   * 계속 그림에 넘기게 되고, 그러면 전부 흐려지고 환한 것이 하나도 없는 화면이
   * 된다(그 접기의 까닭은 helper 의 keepOnlyExisting 주석에 적어 두었다).
   */
  const [focusedIssueKey, setFocusedIssueKey] = useState<string | null>(null);

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

  // ---- 되돌리기 스택(저장 전 스냅샷 + 서버 구조 변경 표시가 한 줄에 섞인다) ----
  //
  // 🔴 줄기 B-① 이전에는 체계가 **두 벌**이었고 서로 시간순으로 안 섞였다 —
  // 클라이언트 스택에 뭐가 있으면 그것만 되돌리고 서버로는 가지도 않아서, 세션
  // 중에 노드를 한 번이라도 드래그했으면 그 뒤에 무엇을 지워도 [이전]이 그 옛
  // 스냅샷부터 되돌렸다(사용자가 스크린샷과 함께 두 번 신고한 그것).
  //
  // 지금은 스택 하나에 둘을 시간순으로 쌓는다. 무엇을 되돌릴지 고르는 규칙은
  // 화면이 아니라 lib/domain/procedure-editor-undo-plan.ts 가 갖는다 — 왜 그렇게
  // 갈랐는지와 STRUCTURAL 칸이 왜 비어 있는지는 그 파일 머리말에 적었다.
  //
  // 스냅샷은 저장 전 상태 다섯 가지를 통째로 담는다 — 조작마다 역연산을 따로
  // 만들면 조작이 늘 때마다 짝을 맞춰야 해서 어긋나기 쉽다(undo-stack.ts 주석 참고).
  const [pendingUndoStack, setPendingUndoStack] = useState<ProcedureEditorUndoStack<PendingSnapshot>>(() =>
    createProcedureEditorUndoStack<PendingSnapshot>()
  );
  /**
   * 지금 화면에 떠 있는 저장 전 상태 한 묶음. 렌더 중에 읽어야 하는 쪽(되돌리기
   * 계획 — 단추를 켤지 정한다)은 이 값을, 이벤트 핸들러 쪽은 아래 ref를 쓴다.
   */
  const currentPendingSnapshot: PendingSnapshot = useMemo(
    () => ({
      layoutMoves: pendingLayoutMoves,
      edgeRouteMoves: pendingEdgeRouteMoves,
      nodeFieldDrafts: pendingNodeFieldDraftsById,
      edgeFieldDrafts: pendingEdgeFieldDraftsById,
      edgeSaveNotes: pendingEdgeSaveNoteById,
    }),
    [pendingLayoutMoves, pendingEdgeRouteMoves, pendingNodeFieldDraftsById, pendingEdgeFieldDraftsById, pendingEdgeSaveNoteById]
  );
  /**
   * 항상 "가장 최근에 렌더링된" 저장 전 상태를 가리킨다 — 스냅샷을 찍는 쪽은
   * 이벤트 핸들러(드래그 시작, 버튼 클릭)라 렌더 이후에 실행되므로 이 값이
   * 최신이다. 상태 다섯 개를 의존성으로 끌고 다니면 콜백 신원이 매번 바뀌어
   * 그래프의 선택 동기화 effect까지 흔들리므로 ref로 둔다.
   */
  const pendingSnapshotRef = useRef<PendingSnapshot>(currentPendingSnapshot);
  useEffect(() => {
    pendingSnapshotRef.current = currentPendingSnapshot;
  }, [currentPendingSnapshot]);

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
    setPendingUndoStack((prev) => pushPendingUndoEntry(prev, pendingSnapshotRef.current, pendingSnapshotsEqual));
  }, []);

  /**
   * 서버가 **이미 저장한** 구조 변경 한 걸음을 같은 스택에 쌓는다. 되돌릴 내용은
   * 서버 이력이 들고 있으므로 여기서는 표시만 남긴다.
   *
   * 🔴 호출 자리는 전부 "서버 액션이 ok 를 돌려준 뒤"다 — 실패한 호출까지 쌓으면
   * 일어나지도 않은 일을 되돌리려 들어, 바로 아래 있던 멀쩡한 변경이 대신 날아간다.
   * 그래서 이 함수를 handleSaved 안에 숨기지 않았다: handleSaved 는 되돌리기
   * 자신(handleUndo/handleRedo)도 부르는 공용 통로라, 거기 넣으면 되돌리기가 제
   * 흔적을 다시 쌓아 [이전]이 영영 안 끝난다.
   *
   * 글자 입력 단계 끊기(lastFieldEditKeyRef)도 함께 푼다 — 구조 변경 뒤에 같은
   * 칸을 다시 고치면 그때부터 새 단계여야 한다.
   */
  const pushStructuralUndoStep = useCallback(() => {
    lastFieldEditKeyRef.current = null;
    setPendingUndoStack((prev) => pushStructuralUndoEntry(prev));
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

  /**
   * ==========================================================================
   * 🔴 구조 변경이 「저장됐다」고 말하는 자리(2026-11-04, 줄기 B-⑦)
   * ==========================================================================
   * 사용자가 신고한 것: "노드, 연결선등을 추가/제거 하기만 했을 때는 [저장]이
   * 활성화가 안되더라고, 노드, 연결선에 대해서는 수정된 사항이라고 인식을 안하고
   * 있는 것 같아."
   *
   * 실제로는 **인식을 안 한 것이 아니라 이미 저장한 것**이다. 노드·연결선의
   * 추가·삭제·재연결·유형 변경·이름 변경은 그 자리에서 서버로 가고(handleSaved
   * 가 그 성공 통로다), 그래서 [저장]이 맡은 저장 대기(safe-to-defer) 목록은
   * 비어 있는 것이 맞다. 다만 **그렇게 말해 주는 자리가 한 곳도 없었다** —
   * 화면에 남는 글자는 [저장] 단추의 "저장할 변경 없음" 하나뿐이고, 그 문구는
   * 「아직 아무것도 안 건드렸다」와 「방금 저장이 끝났다」를 똑같이 말한다.
   * 특히 삭제는 "사라짐"이 유일한 증거라 신호가 가장 약하다.
   *
   * ── 🔴 globalSaveStatus 를 같이 쓰지 않는 까닭 ──────────────────────────
   * 거기에 "saved" 를 꽂으면 가장 짧은 길이지만, 바로 아래 "변경사항 N건 저장
   * 대기 중" 문구가 globalSaveStatus === "idle" 을 조건으로 쓴다 — 저장 대기가
   * 있는 채로 노드를 하나 지우면 그 안내가 **2.5초 사라졌다 돌아온다.** 지금
   * 고치려는 것이 바로 "화면이 저장 상태를 두고 두 말을 한다"는 오해인데,
   * 깜빡임을 하나 더 만들면 고친 자리에서 다시 생긴다. 그래서 제 타이머를 가진
   * 별도 상태를 둔다. 둘은 동시에 떠도 서로 반대말을 하지 않는다(하나는 방금
   * 저장된 구조 변경, 다른 하나는 아직 안 보낸 칸·배치 변경이다).
   *
   * 0 이면 안 뜬 것이고, 성공할 때마다 1씩 올린다 — 불린으로 두면 표시가 떠
   * 있는 동안 둘째 변경이 들어왔을 때 state 값이 그대로라 효과가 다시 돌지
   * 않고, 타이머가 **첫 변경 기준으로** 끝나 버린다.
   */
  const [structuralSaveNoticeId, setStructuralSaveNoticeId] = useState(0);
  useEffect(() => {
    if (structuralSaveNoticeId === 0) return;
    const timer = setTimeout(() => setStructuralSaveNoticeId(0), 2500);
    return () => clearTimeout(timer);
  }, [structuralSaveNoticeId]);

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

  // ---- 현장에서 더한 단계를 **희미하게** 얹는다 (줄기 B-⑧) ----
  //
  // 🔴 유령 칸·선은 renderedNodes/renderedEdges 에 **안 섞는다.** 그 둘은 저장·
  //    검증·짚기·되돌리기가 전부 읽는 「이 초안의 진짜 내용」이다. 유령을 섞으면
  //    [저장]이 없는 노드를 저장하려 들고, [검증]이 없는 노드를 세고, 부모 비교가
  //    「새로 추가된 노드」로 올린다 — 어느 것도 사람이 시킨 적 없는 일이다.
  //    그림에만 따로 넘기는 길(ghostNodes/ghostEdges)이 그래서 생겼다.
  //
  // 🔵 **받침 자리**의 기준은 지금 그려지고 있는 자리(workingLayoutPositions —
  //    저장된 자리 + 끌고 있는 자리)다.
  //
  // 🔴 **「받침」인 까닭**(2026-11-04 에 뜻이 바뀌었다): workingLayoutPositions 는
  //    저장된 자리(position_x/y · user_position_x/y)를 읽는데, 자리 값이 없는
  //    노드를 그림은 **제 나름의 자동 배치**로 그린다(ProcedureFlowGraph 의
  //    useAutoLayoutForUnpositionedNodes — 이 화면은 기술작업절차에 그것을 켠다).
  //    개발 DB 실측으로 초안 "7"(원복 검사 및 개선 작업)은 노드 22개 중 **0개**,
  //    "기본 통전 검사"는 28개 중 1개만 자리 값이 차 있다 — 드문 경우가 아니라
  //    기본값이다. 그래서 전에는 유령만 「저장 좌표계」에, 둘레는 「자동 배치
  //    좌표계」에 서서 미리 보기가 엉뚱한 자리였다.
  //
  //    실제로 났던 일(2026-11-04 사용자 보고): 유령은 (-1716.0, 162.5)에 섰고 채택
  //    뒤의 진짜 노드도 **같은 (-1716.0, 162.5)** 에 섰지만, 채택하는 순간 자리 값
  //    없는 22개가 자동 배치에서 110~140px 씩 움직여 이웃과의 간격이 8.5 → 148.5px
  //    로 벌어졌다. 「유령 자리가 틀렸다」로 보이지만 움직인 것은 **둘레**였다.
  //
  //    🔴 사용자 결정(「A로 가자」)으로 **유령을 자동 배치에 함께 세운다.** 그래서
  //    이제 유령을 켠 그림이 채택 뒤와 같은 좌표이고, 넣어도 아무것도 안 움직인다.
  //    대신 **켜는 순간** 둘레가 한 번 움직인다 — 그것이 이 결정의 값이고, 방해되면
  //    [현장 단계] 탭의 스위치로 끈다. 여기서 세는 x/y 는 그때의 받침이 된다
  //    (자동 배치를 안 쓰는 절차 · 현장에서 사람이 끌어다 놓은 자리).
  //
  // 🔵 **끄면 그림에서만 사라진다**(2026-11-04 사용자 요청 — 「편집기에서 [현장
  //    단계]를 모두 비가시 처리할 수 있는 기능을 넣어줘」). 끈 상태는 이 브라우저에만
  //    남는다(use-field-step-ghost-visibility). 🔴 탭도 딱지 숫자도 패널의 [절차에
  //    넣기]도 **그대로 남는다** — 숨기는 것은 그림의 유령이지 「현장 단계가 있다는
  //    사실」이 아니다. 아래 pendingFieldStepCount 가 이 설정을 안 보는 것이 그 증거다.
  // 🔴 껐을 때 **빈 한 벌(EMPTY_FIELD_STEP_GHOST_GRAPH)을 돌려준다** — 매번 새 빈
  //    배열을 만들면 그림의 「유령이 없으면 간선 배열의 신원까지 그대로」 보증이
  //    깨진다(ProcedureFlowGraph 의 flowEdgesWithGhosts).
  const { ghostsVisible, setGhostsVisible } = useFieldStepGhostVisibility();
  /**
   * 🔴 채택이 첫 노드에 적을 **sort_order**(이 초안 최댓값 + 1 — adoptFieldAddedStep
   * 과 같은 셈). 자동 배치에서 들어오는 선이 없는 칸은 뿌리로 서고 그 가로 차례를
   * 이 번호가 정하므로, 유령이 **채택이 줄 번호 그대로**를 들고 있어야 켠 그림과
   * 넣은 뒤 그림이 안 갈린다.
   * 🔵 노드가 하나도 없으면 0 이다(채택 쪽의 `(max ?? -1) + 1` 과 같은 값).
   */
  const nextFieldStepSortOrder = useMemo(
    () => renderedNodes.reduce((max, n) => (n.sortOrder > max ? n.sortOrder : max), -1) + 1,
    [renderedNodes]
  );
  const fieldStepGhostGraph = useMemo(
    () =>
      ghostsVisible
        ? buildFieldStepGhostGraph({
            steps: fieldAddedSteps,
            anchorPositions: workingLayoutPositions,
            nextSortOrder: nextFieldStepSortOrder,
          })
        : EMPTY_FIELD_STEP_GHOST_GRAPH,
    [ghostsVisible, fieldAddedSteps, workingLayoutPositions, nextFieldStepSortOrder]
  );
  const pendingFieldStepCount = useMemo(() => pendingFieldSteps(fieldAddedSteps).length, [fieldAddedSteps]);

  // ---- [검증] 탭의 오류 줄 → 그림에서 짚기 (줄기 B-③) ----
  //
  // 🔴 **이 지도에 없는 줄이 곧 "누를 수 없는 줄"**이다. 판정이 한 곳에만
  //    있어야 "흐려 보이는데 눌리는" 또는 그 반대가 생기지 않는다 — 되돌리기
  //    단추를 켜는 조건과 눌렀을 때 도는 계획을 하나로 묶은 것과 같은 길이다.
  // 🔵 두 목록을 한꺼번에 넣는다. 탭에는 「구조 검증 결과」와 「가져오기 시점
  //    검증 이슈」가 함께 있고, 뒤쪽은 nodeId/edgeId 칸이 아예 없어 시트·도형
  //    번호로 풀어야 한다(그 풀이는 helper 가 가진다).
  const issueFocusByKey = useMemo(
    () =>
      buildValidationIssueFocusMap({
        structuralIssues: lastStructuralValidation?.issues ?? [],
        importedIssues: template.unresolvedIssues,
        nodes: renderedNodes,
        edges: renderedEdges,
      }),
    [lastStructuralValidation, template.unresolvedIssues, renderedNodes, renderedEdges]
  );
  const focusedIssue = focusedIssueKey === null ? null : issueFocusByKey.get(focusedIssueKey) ?? null;
  const { highlightedNodeIds: focusHighlightedNodeIds, highlightedEdgeIds: focusHighlightedEdgeIds } = focusHighlightProps(focusedIssue);

  // ---- 오류 줄에 **이름**을 함께 보인다 (줄기 B-④) ----
  //
  // 🔴 실측(2026-11-03): 사용자 화면에서 경고 13건이 전부 같은 문장이었다
  //    (「다른 노드와 연결되지 않은 고립된 노드입니다」). 목록에서 서로 구분이
  //    안 돼 어느 노드인지 알려면 13줄을 하나씩 눌러 봐야 했다.
  // 🔵 **짚기 지도에서 그대로 뽑는다.** 줄이 누를 수 있는지(지도에 있는가)와
  //    줄에 보일 이름이 같은 출처라, 「이름은 붙었는데 눌리지 않는」 줄이 생길
  //    수 없다. 지도에 없는 줄은 이름도 없다 — 가리키는 곳이 없으니 당연하다.
  const issueTargetLabelByKey = useMemo(() => {
    const labels = new Map<string, string>();
    for (const [key, focus] of issueFocusByKey) {
      const label = describeValidationIssueTarget(focus, renderedNodes, renderedEdges);
      if (label) labels.set(key, label);
    }
    return labels;
  }, [issueFocusByKey, renderedNodes, renderedEdges]);

  /**
   * 오류·경고 줄 누르기. 같은 줄을 다시 누르면 풀리고 다른 줄을 누르면 그쪽으로
   * 옮겨간다 — 그 규칙은 toggleIssueFocusKey 하나가 갖는다.
   *
   * 🔵 카메라를 함께 옮기는 것은 **새로 만든 장치가 아니다.** 이 화면은 이미
   *    onInstanceReady 로 React Flow 인스턴스를 들고 있고(노드 실측 크기를 읽는
   *    데 쓴다), 그림 안의 노드 검색도 똑같은 fitView 한 줄로 옮긴다. 짚어 준
   *    곳이 화면 밖에 있으면 아무리 환하게 해도 안 보인다.
   * 🔴 fitView 는 **노드 목록만** 받는다 — 연결선만 가리키는 오류는 그 선의 양
   *    끝 칸으로 바꿔 넘긴다(resolveFocusFitNodeIds).
   */
  function handleIssueRowFocus(key: string) {
    const next = toggleIssueFocusKey(focusedIssueKey, key);
    setFocusedIssueKey(next);
    if (next === null) return;
    const fitNodeIds = resolveFocusFitNodeIds(issueFocusByKey.get(next) ?? null, renderedEdges);
    if (fitNodeIds.length === 0) return;
    reactFlowInstanceRef.current?.fitView({ nodes: fitNodeIds.map((id) => ({ id })), duration: 300, padding: 1.5 });
  }

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

  /**
   * 서버가 **그 자리에서 이미 저장한** 변경 하나가 돌아오는 통로.
   *
   * 🔴 여기 닿는 길은 전부 "액션이 ok 를 돌려준 뒤"다 — 패널들은 예외 없이
   * `if (!result.ok) { setErrorMessage(...); return; }` 를 지나서야 부르고,
   * procedure-editor-confirm-dialogs.test.ts ⑤절이 그 순서를 지키고 있다.
   * 그래서 아래 "저장됨" 표시는 **실패했을 때 뜰 수가 없다**(실패는 각 패널이
   * 제자리에 빨간 글로 알린다 — 그 동작은 그대로다).
   *
   * 🔵 되돌리기([이전]/[앞으로])도 이 통로를 지나고, 거기서도 뜨는 것이 맞다:
   * 되돌리기 역시 **서버에 쓰는 조작**이라 실패하면 undoRedoError 가 같은 줄에
   * 빨갛게 뜬다. 실패만 말하고 성공은 말하지 않으면 짝이 안 맞는다.
   */
  function handleSaved(newUpdatedAt: string, structuralValidation?: StructuralValidationSummary) {
    setCurrentUpdatedAt(newUpdatedAt);
    if (structuralValidation) setLastStructuralValidation(structuralValidation);
    setStructuralSaveNoticeId((id) => id + 1);
    router.refresh();
  }

  /**
   * 구조 변경(서버가 그 자리에서 저장하는 것)이 **성공했을 때** 지나는 통로.
   * handleSaved 가 하던 일을 그대로 하고, 되돌리기 스택에 한 걸음을 더 쌓는다.
   *
   * 지나는 조작: 노드 생성 · 노드 유형 변경 · 연결선 생성 · 재연결 · 연결선 위
   * 노드 삽입 · 템플릿 이름 변경 · 이력 복원. 삭제 둘은 지우개 뒤처리가 있어
   * 제 함수(handleNodeDeleted/handleEdgeDeleted)에서 같은 것을 쌓는다.
   */
  function handleStructuralSaved(newUpdatedAt: string, structuralValidation?: StructuralValidationSummary) {
    pushStructuralUndoStep();
    handleSaved(newUpdatedAt, structuralValidation);
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
  // these buttons, regardless of canEdit.
  //
  // 🔴 줄기 B-① 에서 바뀐 것: 예전에는 "저장 전 변경이 하나라도 있으면 서버
  // 이력은 못 건드린다"는 가드(hasAnyPendingChanges)가 있었다. 통합 스택이
  // 시간순이 된 지금은 그 가드가 **필요 없을 뿐 아니라 해롭다** — STRUCTURAL
  // 차례가 왔다는 것은 그 위에 쌓여 있던 PENDING 이 이미 전부 되돌려졌다는
  // 뜻이고, 순서는 스택이 보장한다. 가드를 남겨 두면 드래그 한 번에 삭제
  // 되돌리기가 통째로 막힌다(사용자가 신고한 그 증상).
  // hasAnyPendingChanges 자체는 [저장]/[취소] 단추와 나가기 확인이 계속 쓴다.
  const [isUndoing, setIsUndoing] = useState(false);
  const [isRedoing, setIsRedoing] = useState(false);
  const [undoRedoError, setUndoRedoError] = useState<string | null>(null);
  /**
   * 🔴 서버 되돌리기가 도는 동안 둘째 호출을 막는 빗장. isUndoing/isRedoing 만으로는
   * 모자란다 — 그 둘은 state 라 다음 렌더에서야 단추에 닿고, 같은 틱에 두 번
   * 누르면 둘 다 false 를 본 채로 통과해 **두 걸음이 한꺼번에 날아간다.**
   * ("두 번 누르기"는 이 저장소에서 실제로 났던 결함이다.)
   */
  const undoRedoInFlightRef = useRef(false);

  /**
   * 되돌리기 계획 — 단추를 켤지와 눌렀을 때 무엇을 할지를 **한 번에** 정한다.
   * 렌더 중에 계산해 두 쓰임이 같은 답을 보게 한다(고치기 전에는 안내 문구와
   * 단추가 서로 다른 변수를 봐서, 문구는 "쓸 수 없습니다"인데 단추는 눌리는
   * 화면이 코드상 가능했다).
   */
  const undoPlan = planProcedureUndo({
    stack: pendingUndoStack,
    currentPending: currentPendingSnapshot,
    serverHasHistory: historyView.canUndo,
    canUseHistory: canDeleteGraph,
    isRunning: isUndoing || isRedoing,
    pendingEquals: pendingSnapshotsEqual,
  });
  const redoPlan = planProcedureRedo({
    stack: pendingUndoStack,
    currentPending: currentPendingSnapshot,
    serverHasHistory: historyView.canRedo,
    canUseHistory: canDeleteGraph,
    isRunning: isUndoing || isRedoing,
    pendingEquals: pendingSnapshotsEqual,
  });

  /**
   * [이전] — 저장 전 스냅샷이든 서버 이력이든, **쌓인 역순 그대로** 한 걸음씩
   * 되돌린다. 어느 쪽인지 고르는 일은 이미 undoPlan 이 끝냈으므로 여기서 다시
   * 판정하지 않는다.
   */
  async function handleUndo() {
    if (undoPlan.action === "NONE" || undoRedoInFlightRef.current) return;
    if (undoPlan.action === "RESTORE_PENDING") {
      setPendingUndoStack(undoPlan.nextStack);
      applyPendingSnapshot(undoPlan.snapshot);
      return;
    }
    undoRedoInFlightRef.current = true;
    setIsUndoing(true);
    setUndoRedoError(null);
    const result = await undoProcedureTemplateChangeAction({ templateId: template.id, expectedTemplateUpdatedAt: currentUpdatedAt });
    undoRedoInFlightRef.current = false;
    setIsUndoing(false);
    if (!result.ok) {
      // 🔴 실패하면 스택을 건드리지 않는다 — 일어나지 않은 되돌리기를 스택에서
      // 빼면 그 걸음을 다시는 되돌릴 수 없다.
      setUndoRedoError(result.message);
      return;
    }
    setPendingUndoStack(undoPlan.nextStack);
    handleSaved(result.updatedAt);
  }

  /** [앞으로] — handleUndo와 정확히 대칭이다(계획도 반대 방향 한 벌을 그대로 쓴다). */
  async function handleRedo() {
    if (redoPlan.action === "NONE" || undoRedoInFlightRef.current) return;
    if (redoPlan.action === "RESTORE_PENDING") {
      setPendingUndoStack(redoPlan.nextStack);
      applyPendingSnapshot(redoPlan.snapshot);
      return;
    }
    undoRedoInFlightRef.current = true;
    setIsRedoing(true);
    setUndoRedoError(null);
    const result = await redoProcedureTemplateChangeAction({ templateId: template.id, expectedTemplateUpdatedAt: currentUpdatedAt });
    undoRedoInFlightRef.current = false;
    setIsRedoing(false);
    if (!result.ok) {
      setUndoRedoError(result.message);
      return;
    }
    setPendingUndoStack(redoPlan.nextStack);
    handleSaved(result.updatedAt);
  }

  function handleNodeDeleted(newUpdatedAt: string) {
    // 🔴 삭제는 서버가 이미 저장했다 — 되돌리기 스택에 한 걸음을 쌓아야
    // [이전]이 이 자리에서 서버 이력으로 넘어간다. 이것이 없어서, 드래그 뒤의
    // 삭제가 되돌려지지 않았다.
    pushStructuralUndoStep();
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
    // 노드 삭제와 같은 까닭으로 한 걸음을 쌓는다(바로 위 주석 참고).
    pushStructuralUndoStep();
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
    // 이름 변경도 서버 이력에 남는 구조 변경이다 — RENAME_TEMPLATE 한 걸음을 쌓는다.
    handleStructuralSaved(result.updatedAt);
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
    // 같은 변경이 두 체계에 중복으로 남지 않게 한다. 비워도 되돌리기가 막히지
    // 않는다: 스택이 빈 채로 [이전]을 누르면 계획이 "스택이 비었고 서버 이력에
    // 남은 것이 있다" 갈래로 가 서버 이력을 그대로 거슬러 올라간다.
    setPendingUndoStack(createProcedureEditorUndoStack<PendingSnapshot>());
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
      // 🔴 새로 검증하면 짚기를 푼다(줄기 B-③). 구조 검증 결과에는 id 가 없어
      //    줄의 이름이 **목록 안 자리**인데, 다시 돌리면 그 자리의 오류가 다른
      //    것으로 바뀔 수 있다 — 안 풀면 사람이 고른 적 없는 곳이 짚혀 있다.
      setFocusedIssueKey(null);
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
                className="rounded-md bg-primary-900 px-2 py-1 text-xs font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900"
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
                className="rounded-md bg-primary-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900"
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
              {/*
                🔴 줄기 B-⑦ — 구조 변경이 끝났다고 말하는 자리. 왜 별도 상태인지는
                structuralSaveNoticeId 선언부의 주석에 있다.

                🔵 문구를 "저장 완료"로 하지 않았다. 바로 왼쪽의 [저장] 단추가
                그때 "저장할 변경 없음"이라 적혀 있어서, 같은 낱말 둘이 나란히
                서면 "완료라면서 왜 변경이 없다고 하지"가 된다 — 이번 오해의
                실체가 정확히 그 충돌이었다. 그래서 **무엇이** 저장됐는지를
                말한다: 방금 한 그 변경은 [저장]을 거치지 않고 바로 갔다.

                🔵 저장 대기 안내와 동시에 떠도 괜찮다. 둘은 서로 다른 것을
                가리킨다 — 이쪽은 방금 서버로 간 구조 변경, 저쪽은 아직 안 보낸
                칸·배치 변경이다.
              */}
              {structuralSaveNoticeId > 0 && (
                <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">방금 변경은 바로 저장됐습니다</span>
              )}
              {/*
                🔵 아무 일도 없을 때 서 있는 안내. 띄우는 표시는 2.5초면 사라지는데,
                사용자가 막힌 지점은 **그 뒤에도 남아 있는 화면**이었다("저장할 변경
                없음" 한 줄만 보고 "인식을 못 한다"고 읽었다). [저장]이 무엇을 맡고
                무엇을 안 맡는지는 상태가 아니라 이 편집기의 구조라, 상태가 아니라
                상시 문구로 적는다. globalSaveStatus 가 idle 일 때만 — "저장 완료"와
                한 줄에 겹쳐 서지 않게 한다.
              */}
              {!hasAnyPendingChanges && structuralSaveNoticeId === 0 && globalSaveStatus === "idle" && (
                <span className="text-xs text-zinc-500 dark:text-zinc-400">노드·연결선 추가·삭제·재연결은 [저장] 없이 바로 저장됩니다</span>
              )}
            </>
          )}
          {canDeleteGraph && (
            // 🔴 단추를 켤 조건도 계획 하나에서만 나온다 — 눌렀을 때 도는 코드와
            // 같은 판정이라, "흐려 보이는데 눌리는" 또는 그 반대가 생길 수 없다.
            <UndoRedoControls
              canUndo={canRunUndoPlan(undoPlan)}
              canRedo={canRunUndoPlan(redoPlan)}
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
          {/*
            [게시] — 줄기 B-④. 전까지 게시하는 길은 **절차 상세 화면에만** 있어서,
            초안을 다 고친 사람이 편집기를 나갔다가 상세로 들어가야 했다. 막는
            까닭이 적힌 자리는 없었다(상세에만 둔 것이 의도라는 주석도 시험도
            없다 — 09d16d8 은 그때 편집기 쪽을 아예 다루지 않았다).

            🔵 부품은 상세 화면이 쓰던 것 그대로다. 확인 창(되돌릴 수 없다는
            설명)과 서버 실패 이유를 보이는 자리가 이미 그 안에 있고,
            procedure-publish-flow.test.tsx 가 그것을 지키고 있다 — 여기서
            새로 만들면 한쪽만 고쳐지는 날이 온다.

            🔴 **저장하지 않은 변경이 있으면 막는다.** 편집기의 안전 보류
            (safe-to-defer) 변경은 [저장]을 눌러야 서버로 간다. 그대로 게시하면
            게시된 내용은 **화면에 보이는 것이 아니라 마지막으로 저장된 것**이
            되어, 사람이 본 것과 현장에 나간 것이 달라진다. 흐린 단추만 두지
            않고 까닭을 함께 적는다.

            🔵 게시 뒤 화면: PublishTemplateButton 이 router.refresh() 를 부르고,
            이 경로(/procedures/<id>/edit)의 page.tsx 는 PUBLISHED 상태를 보면
            편집기 대신 "게시된 템플릿은 직접 편집할 수 없습니다 — 새 DRAFT
            버전을 만드세요" 안내를 그린다. 이미 게시된 초안 위에 편집기가 남는
            일이 구조적으로 없다.
          */}
          {template.status === "DRAFT" && canPublish && (
            <PublishTemplateButton
              templateId={template.id}
              templateName={template.name}
              isReferenceOnly={template.isReferenceOnly}
              disabledReason={hasAnyPendingChanges ? `저장하지 않은 변경 ${totalPendingCount}건이 있어 게시할 수 없습니다 — [저장] 먼저` : null}
            />
          )}
          {/*
            [초안 버리기] — 줄기 B-⑥. [새 DRAFT 버전 만들기]를 잘못 눌러 생긴
            초안을 **떨어진 그 자리에서** 치운다. 버리는 길 자체는 전부터
            있었지만(/procedures/technical 의 [삭제 모드] → 휴지통), 여기서
            나가 목록으로 가 같은 이름의 여러 판 중 하나를 골라야 했다.

            🔴 **[게시] 옆에 둔다.** 이 둘이 초안이 끝나는 두 길이다 — 올리거나,
            버리거나. 저장하지 않은 변경이 있어도 막지 않는다: 게시와 달리
            버리기는 "화면에 보이는 것"과 "저장된 것"이 달라서 생기는 사고가
            없다(둘 다 휴지통으로 간다).
          */}
          {template.status === "DRAFT" && canDiscardDraft && (
            <DiscardDraftButton
              templateId={template.id}
              templateName={template.name}
              templateVersion={template.version}
            />
          )}
          <button type="button" onClick={handleExit} className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300">
            편집기 나가기
          </button>
        </div>
      </div>
      {globalSaveStatus === "failed" && globalSaveError && <p className="text-xs text-red-600 dark:text-red-400">{globalSaveError}</p>}
      {undoRedoError && <p className="text-xs text-red-600 dark:text-red-400">{undoRedoError}</p>}
      {/*
        여기 있던 "저장하지 않은 변경사항이 있어 실행 취소/다시 실행을 사용할 수
        없습니다" 안내는 없앴다(줄기 B-①). 잠기는 상태 자체가 사라져서 할 말이
        없어졌다 — 저장 전 변경이 있어도 [이전]은 쌓인 역순 그대로 계속 돈다.
      */}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-2">
          {/*
            「현장 단계 표시」 스위치는 **[현장 단계] 탭 안**에 있다(2026-11-04
            사용자 결정 — 「기능은 좋은데 [현장단계]안에 체크표시가 있도록 해줘.
            설명은 필요없다」). 전에는 이 자리, 곧 그림 바로 위에 설명 한 줄과 함께
            서 있었다.

            🔵 **그때 적어 둔 까닭을 지운 것이 아니라 덮은 것이다.** 당시 판단은
            「끄면 그림만 달라지는데, 그 까닭을 보려면 탭을 열어야 하는 단추가
            된다」였다. 사용자 결정이 그것을 덮었고, 바뀐 자리에서도 꺼 둔 사람이
            길을 잃지 않도록 **패널 맨 위 안내가 상태 둘을 갈라** 말한다
            (FieldAddedStepsPanel — 꺼 둔 사람에게 「그림에 그려집니다」는 거짓말이다).

            🔴 스위치가 서는 조건은 그대로 **아직 안 넣은 것이 있는가**다(패널의
            pending.length). 탭이 서는 조건(fieldAddedSteps.length)과 일부러 다르다 —
            다 넣고 나면 끌 유령이 없고, 끌 것 없는 스위치는 「껐는데 왜 그대로지」를
            낳는다. 탭은 그대로 남아 「이미 넣은 단계」를 확인할 길이 된다.
          */}
          <ProcedureFlowGraph
            templateId={template.id}
            nodes={renderedNodes}
            edges={renderedEdges}
            openIssuesByNodeId={openIssuesByNodeId}
            initialWorksheet={navigationTarget.worksheetFilter}
            initialSelectedNodeId={navigationTarget.nodeId}
            errorFocusMode={errorFocusMode}
            highlightedNodeIds={focusHighlightedNodeIds}
            highlightedEdgeIds={focusHighlightedEdgeIds}
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
            ghostNodes={fieldStepGhostGraph.nodes}
            ghostEdges={fieldStepGhostGraph.edges}
            layoutMode={layoutMode}
            onLayoutModeChange={setLayoutMode}
            layoutModeOptions={EDITOR_LAYOUT_MODES}
            onInstanceReady={(instance) => {
              reactFlowInstanceRef.current = instance;
            }}
          />
          <ProcedureGraphLegend />
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap gap-1 border-b border-zinc-200 pb-2 text-xs dark:border-zinc-800">
            {/*
              🔴 「현장 단계」 탭은 **현장에서 더한 것이 실제로 있을 때만** 선다
              (줄기 B-⑧). 늘 떠 있으면 거의 언제나 빈 탭이라, 누르면 아무것도
              없는 자리가 된다 — 「짚을 곳 없는 줄은 아예 단추로 만들지 않는다」와
              같은 길이다.
              🔵 숫자는 **아직 안 넣은 것**만 센다. 알림은 할 일의 수여야 한다 —
              이미 넣은 것까지 세면 다 처리한 뒤에도 딱지가 안 사라진다.
              🔴 창을 띄우지 않는 까닭은 FieldAddedStepsPanel 머리말에 있다.
            */}
            {(
              [
                "properties",
                "validation",
                "history",
                "createEdge",
                ...(canDeleteGraph ? (["addNode"] as const) : []),
                ...(fieldAddedSteps.length > 0 ? (["fieldSteps"] as const) : []),
              ] as RightPanelTab[]
            ).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => switchRightPanelTab(tab)}
                className={`rounded-md px-2 py-1 ${rightPanelTab === tab ? "bg-primary-900 text-white dark:bg-primary-50 dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}
              >
                {tab === "properties"
                  ? "속성"
                  : tab === "validation"
                    ? "검증"
                    : tab === "history"
                      ? "이력"
                      : tab === "createEdge"
                        ? "연결 추가"
                        : tab === "addNode"
                          ? "노드 추가"
                          : `현장 단계${pendingFieldStepCount > 0 ? ` ${pendingFieldStepCount}` : ""}`}
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
              onSaved={handleStructuralSaved}
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
              onSaved={handleStructuralSaved}
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
              onSaved={handleStructuralSaved}
              isTechnical={isTechnical}
            />
          )}

          {rightPanelTab === "addNode" && canDeleteGraph && (
            <CreateNodePanel
              templateId={template.id}
              expectedTemplateUpdatedAt={currentUpdatedAt}
              onSaved={handleStructuralSaved}
              selectedNode={selectedNode}
              resolveNodeDimensions={resolveNodeDimensions}
            />
          )}

          {rightPanelTab === "fieldSteps" && (
            // 🔴 넣기는 서버가 그 자리에서 저장하는 **구조 변경**이다 —
            //    handleStructuralSaved 를 지나야 [이전]이 이 걸음에서 서버 이력으로
            //    넘어간다. handleSaved 만 부르면 되돌리기가 이 걸음을 건너뛴다
            //    (노드 삭제에서 실제로 났던 결함과 같은 자리).
            <FieldAddedStepsPanel
              templateId={template.id}
              steps={fieldAddedSteps}
              canEdit={canDeleteGraph}
              ghostsVisible={ghostsVisible}
              onGhostsVisibleChange={setGhostsVisible}
              expectedTemplateUpdatedAt={currentUpdatedAt}
              onAdopted={handleStructuralSaved}
            />
          )}

          {rightPanelTab === "validation" && (
            <div className="flex flex-col gap-3 text-xs">
              {/*
                줄기 B-③ — 짚기가 걸려 있는 동안만 보이는 줄. 🔴 푸는 길이
                "같은 줄 다시 누르기" 하나뿐이면, 고른 줄이 스크롤 밖으로
                밀려났을 때 돌아갈 방법이 없다. 그림이 왜 흐린지도 여기서
                한 번 말해 준다 — 안 말하면 고장으로 읽힌다.
              */}
              {focusedIssue && (
                <div className="flex items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 dark:border-blue-900 dark:bg-blue-950">
                  <span className="text-blue-800 dark:text-blue-300">
                    고른 오류가 가리키는 곳만 그림에서 환하게 표시 중입니다 (노드 {focusedIssue.nodeIds.length}개 · 연결선 {focusedIssue.edgeIds.length}개).
                  </span>
                  <button
                    type="button"
                    onClick={() => setFocusedIssueKey(null)}
                    className="shrink-0 rounded-md border border-blue-300 px-2 py-0.5 font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900"
                  >
                    표시 해제
                  </button>
                </div>
              )}
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">가져오기 시점 검증 이슈 (미해결)</h3>
                {template.unresolvedIssues.length === 0 ? (
                  <p className="mt-1 text-zinc-400 dark:text-zinc-600">없음</p>
                ) : (
                  <ul className="mt-1 flex flex-col gap-1">
                    {template.unresolvedIssues.map((i) => {
                      const focusKey = importedIssueFocusKey(i.id);
                      return (
                        <ValidationIssueRow
                          key={i.id}
                          focusKey={focusKey}
                          canFocus={issueFocusByKey.has(focusKey)}
                          isFocused={focusedIssueKey === focusKey}
                          onFocus={handleIssueRowFocus}
                          severity={i.severity}
                          targetLabel={issueTargetLabelByKey.get(focusKey) ?? null}
                          message={procedureValidationIssueTypeLabels[i.issueType] ?? i.issueType}
                        />
                      );
                    })}
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
                      {lastStructuralValidation.issues.map((issue, idx) => {
                        const focusKey = structuralIssueFocusKey(idx);
                        return (
                          <ValidationIssueRow
                            key={idx}
                            focusKey={focusKey}
                            canFocus={issueFocusByKey.has(focusKey)}
                            isFocused={focusedIssueKey === focusKey}
                            onFocus={handleIssueRowFocus}
                            severity={issue.severity}
                            targetLabel={issueTargetLabelByKey.get(focusKey) ?? null}
                            message={issue.message}
                          />
                        );
                      })}
                    </ul>
                  </>
                )}
              </div>
            </div>
          )}

          {rightPanelTab === "history" && (
            // 복원도 서버 이력에 새 걸음으로 기록된다(이 패널의 확인 문구가
            // "복원 후에도 [이전] 버튼으로 이번 복원을 되돌릴 수 있습니다"라고
            // 약속한다) — 지시서 목록에는 없었지만 같은 통로를 써야 그 약속이
            // 지켜진다. 안 쌓으면 저장 전 변경이 하나라도 있을 때 [이전]이
            // 복원 대신 그 스냅샷을 먼저 되돌린다.
            <EditHistoryPanel templateId={template.id} historyView={historyView} canManage={canDeleteGraph} expectedTemplateUpdatedAt={currentUpdatedAt} onRestored={handleStructuralSaved} />
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

/**
 * [검증] 탭의 오류·경고 한 줄(줄기 B-③, 줄기 B-④ 에서 모양을 다듬었다).
 *
 * 🔴 **짚을 대상이 있는 줄만 단추가 된다.** 눌리는데 아무 일도 안 일어나면
 * 사람은 고장으로 읽는다 — 그래서 못 짚는 줄은 아예 단추로 만들지 않고, 왜
 * 못 누르는지를 그 자리에 적는다(까닭이 없으면 그것도 고장으로 읽힌다).
 * 실제로 못 짚는 줄이 있다: 「가져오기 시점 검증 이슈」에는 노드·연결선 칸이
 * 아예 없어 `shape#…`/`connector#…` 로 풀어야 하는데, 그 번호가 비었거나
 * 지금 그래프에 남아 있지 않은 건이 섞인다.
 *
 * 🔵 눌리는 줄과 안 눌리는 줄은 **보기에도 다르다** — 눌리는 쪽만 테두리가
 * 마우스에 반응하고, 오른쪽 딱지의 색이 다르다. 색만으로 가르지 않은 까닭은
 * 심각도(빨강/노랑)가 이미 색을 쓰고 있어서다.
 *
 * ── 🔴 꼬리말이 본문에 붙어 있으면 글자가 한가운데서 잘린다 (줄기 B-④) ────
 * B-③ 에서는 안내 글(「— 누르면 그림에서 표시」)을 본문 **뒤에 그대로 이어**
 * 붙였다. 사용자가 본 화면에서 그 글이 320px 짜리 오른쪽 패널의 줄 끝에서
 * 접혀 「— 누 / 르면 그림에서 표시」가 됐다. 사용자가 말한 것: "[누르면
 * 그림에서 표시]가 다음 줄로 가던가 작은 버튼으로 표시되던가 아에 없던가 해도
 * 될 것 같아."
 *
 * 그래서 **본문과 꼬리말을 가로로 가른다**: 줄 전체가 flex 이고, 본문은
 * `min-w-0 flex-1` 로 제 안에서 몇 줄이든 접히고, 딱지는 `shrink-0
 * whitespace-nowrap` 이라 **본문이 몇 줄이 되든 제자리에서 안 깨진다.**
 * 글은 「표시」/「표시 중」/「짚을 곳 없음」으로 줄이고, 원래 길게 적던 설명은
 * title 로 옮겼다 — 딱지만 보고 뜻이 안 잡히는 사람에게는 마우스를 올리면
 * 한 문장이 그대로 나온다. 🔴 까닭을 **없애지는 않았다**: 왜 못 누르는지
 * 모르면 그 줄은 고장으로 읽힌다.
 */
function ValidationIssueRow({
  focusKey,
  canFocus,
  isFocused,
  onFocus,
  severity,
  targetLabel,
  message,
}: {
  focusKey: string;
  canFocus: boolean;
  isFocused: boolean;
  onFocus: (focusKey: string) => void;
  severity: ProcedureValidationSeverity;
  /**
   * 이 줄이 가리키는 노드·연결선의 이름. 짚을 곳이 없으면 null 이다.
   *
   * 🔴 같은 문장이 열 줄 넘게 늘어서는 일이 실제로 있었다(고립된 노드 13건).
   * 이름이 없으면 그 줄들은 서로 구분이 안 되고, 어느 칸인지 알려면 하나씩
   * 눌러 봐야 한다.
   */
  targetLabel: string | null;
  message: string;
}) {
  const body = (
    <span className="min-w-0 flex-1">
      <span className={severity === "ERROR" ? "font-medium text-red-600 dark:text-red-400" : "font-medium text-amber-600 dark:text-amber-400"}>
        {procedureValidationSeverityLabels[severity]}
      </span>
      {targetLabel && (
        <>
          {" · "}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{targetLabel}</span>
        </>
      )}
      {" · "}
      <span className="text-zinc-600 dark:text-zinc-400">{message}</span>
    </span>
  );

  if (!canFocus) {
    return (
      <li className="flex items-start gap-1.5 rounded border border-zinc-100 p-1.5 dark:border-zinc-800">
        {body}
        <span
          title="그림에서 짚을 노드·연결선이 없습니다"
          className="shrink-0 whitespace-nowrap rounded bg-zinc-100 px-1 py-0.5 text-[10px] text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600"
        >
          짚을 곳 없음
        </span>
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        onClick={() => onFocus(focusKey)}
        aria-pressed={isFocused}
        className={`flex w-full items-start gap-1.5 rounded border p-1.5 text-left ${
          isFocused
            ? "border-blue-400 bg-blue-50 dark:border-blue-700 dark:bg-blue-950"
            : "border-zinc-100 hover:border-blue-300 hover:bg-blue-50 dark:border-zinc-800 dark:hover:border-blue-800 dark:hover:bg-blue-950"
        }`}
      >
        {body}
        <span
          title={isFocused ? "그림에서 표시 중 (다시 누르면 해제)" : "누르면 그림에서 표시"}
          className={`shrink-0 whitespace-nowrap rounded px-1 py-0.5 text-[10px] font-medium ${
            isFocused ? "bg-blue-600 text-white dark:bg-blue-500" : "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400"
          }`}
        >
          {isFocused ? "표시 중" : "표시"}
        </span>
      </button>
    </li>
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
