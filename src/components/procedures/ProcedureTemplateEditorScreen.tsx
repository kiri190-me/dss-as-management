"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReactFlowInstance } from "@xyflow/react";
import ProcedureFlowGraph, { type LayoutMode, type ProcedureCanvasTool, type ProcedureNodeDragMove } from "./ProcedureFlowGraph";
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
  planUndoStackAfterStructuralSave,
  planProcedureUndo,
  planProcedureRedo,
  canRunUndoPlan,
  type ProcedureEditorUndoStack,
} from "@/lib/domain/procedure-editor-undo-plan";
import type { ProcedureTemplateForEditor, DraftParentComparisonResult, EditorNodeRow, EditorEdgeRow } from "@/lib/db/queries/procedure-template-editor";
import type { NextProcedureLinkCandidate } from "@/lib/db/queries/procedure-templates";
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
  createProcedureTemplateNodeAction,
  deleteProcedureTemplateNodeAction,
  changeProcedureTemplateNodeTypeAction,
  createProcedureTemplateEdgeAction,
  deleteProcedureTemplateEdgeAction,
  retargetProcedureTemplateEdgeAction,
  insertProcedureTemplateNodeOnEdgeAction,
} from "@/lib/server/actions/procedure-template-editor";
import { renameTechnicalProcedureTemplateAction } from "@/lib/server/actions/procedure-templates";
import { undoProcedureTemplateChangeAction, redoProcedureTemplateChangeAction } from "@/lib/server/actions/procedure-template-undo-redo";
import {
  procedureValidationIssueTypeLabels,
  procedureValidationSeverityLabels,
  procedureBranchTypeLabels,
  procedureNodeTypeLabels,
  procedureTemplateStatusLabels,
  type ProcedureValidationSeverity,
  type ProcedureBranchType,
  type ProcedureNodeType,
  type ManualTechnicalNodeType,
} from "@/lib/domain/procedure-template-types";
import type { StructuralValidationSummary, EdgeRouteInput } from "@/lib/db/mutations/procedure-template-editor";
import { addWaypointAtDefaultPosition, moveWaypoint, removeWaypoint, type RoutePoint } from "@/lib/graph-editor-core/routing";
import {
  mergeProcedureNodeForRender,
  mergeProcedureEdgeForRender,
  computeDirtyProcedureNodeFieldEntries,
  computeDirtyProcedureEdgeFieldEntries,
  computeDirtyProcedurePositionNodeIds,
  computeDirtyProcedureRouteEdgeIds,
  resolveCurrentRenderedNodePosition,
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
import {
  coalescePendingStructuralOperations,
  canSendStructuralChanges,
  isTempEdgeId,
  isTempNodeId,
  type PendingStructuralOperation,
} from "@/lib/domain/procedure-editor-structural-changes";
import {
  appendPendingStructuralOperations,
  procedureStructuralOperationsSignature,
} from "@/lib/domain/procedure-editor-structural-undo";
import {
  runProcedureStructuralSequence,
  canProceedToFieldSave,
  collectStructuralIdEffects,
  rebaseDraftMapAfterStructuralSave,
  includeBrandNewDraftEntries,
  includeBrandNewDraftIds,
  type ProcedureStructuralStepResult,
} from "@/lib/domain/procedure-editor-structural-save";
import {
  previewPendingStructuralGraph,
  describeStructuralConflicts,
  type StructuralPreviewFactories,
} from "@/lib/domain/procedure-editor-structural-preview";
import { planProcedureDeleteKey, isTextEntryTarget } from "@/lib/domain/procedure-editor-delete-key";
import {
  findEdgesAttachedToNode,
  findEdgesAttachedToNodes,
  planProcedureNodeDeletionOperations,
  planProcedureNodesDeletionOperations,
  resolveProcedureNodeDeleteBlockedReason,
} from "@/lib/domain/procedure-editor-node-deletion";
import { removeNodesFromSelection } from "@/lib/graph-editor-core/box-selection";
import { planStraightenEdgeOrder } from "@/lib/graph-editor-core/straighten-selection";
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
 * ── 🔴 2026-11-20(조각 4) — **위 마지막 문장의 절반이 뒤집혔다** ──────────
 * 쓰는 분의 요청(「노드·연결선 추가·삭제·재연결도 [저장]을 눌러야 저장되도록 해
 * 달라」)으로 **일곱**이 이 계약 안으로 들어왔다 — 노드 추가·삭제·유형 변경,
 * 연결선 추가·삭제·재연결, 연결선 위 노드 끼우기. 다만 **담기는 방식이 다르다**:
 * 위 다섯 지도는 「이미 있는 행의 칸 값」이라 서버 스냅숏과 맞대어 세지만, 구조
 * 변경은 행 자체가 생기고 사라져서 그 모델로는 안 세어진다. 그래서 여섯째 칸
 * (pendingStructuralOperations)에 **조작 목록으로** 담고, [저장]이 그것을 먼저
 * 보낸 뒤 위 세 단계를 돈다(handleGlobalSave 의 머리말에 차례가 적혀 있다).
 *
 * 🔵 **여전히 즉시**인 것: [검증] · 게시/판본 · [이전]/[앞으로] · 템플릿 이름 변경 ·
 *    이력 복원 · 현장 단계 넣기. 앞 둘은 애초에 저장 대상이 아니고, [이전]/[앞으로]
 *    는 되돌리는 동작 자체이며, 나머지 셋은 그래프 구조가 아니다.
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
 *
 * 🔴 2026-11-20(조각 4) — **구조 변경 목록이 여섯째 칸으로 들어왔다.** 노드·연결선
 * 추가·삭제·유형 변경·재연결·끼우기가 [저장] 때까지 모이는 곳이고, 그것을 여기
 * 함께 싣는 까닭 셋은 procedure-editor-structural-undo.ts 머리말에 있다 — 특히
 * ②번(임시 번호를 키로 쓰는 초안이 같은 칸에 있어야 함께 되돌아온다)이 따로 두면
 * 안 되는 까닭이다.
 */
type PendingSnapshot = {
  layoutMoves: Map<string, Position>;
  edgeRouteMoves: Map<string, RoutePoint[] | null>;
  nodeFieldDrafts: Map<string, ProcedureNodeFieldDraft>;
  edgeFieldDrafts: Map<string, ProcedureEdgeFieldDraft>;
  edgeSaveNotes: Map<string, string>;
  structuralOperations: PendingStructuralOperation[];
};

/**
 * 스냅샷 두 개가 같은 상태인지 — 키 순서를 고정해 직렬화한 뒤 비교한다(작은 Map
 * 몇 개라 비용이 문제되지 않는다).
 *
 * 🔴 2026-11-20(조각 4) — **구조 목록의 서명을 반드시 섞어야 한다.** 노드를 하나
 * 추가한 단계는 지도 다섯이 **똑같다.** 섞지 않으면 planProcedureUndo 가 그 칸을
 * 「헛도는 단계」로 보고 조용히 버려서, [이전]이 그 추가를 건너뛰고 더 오래된
 * 단계부터 되돌린다 — 오류도 경고도 안 난다. 조각 3 의 ⑦절 시험이 그 꼴을 그대로
 * 시연해 두었다.
 *
 * 🔵 목록은 **차례도 뜻이 있어** 정렬하지 않는다(지도 다섯과 다른 점이다) —
 * 보낼 차례와 미리보기 차례를 둘 다 그 순서에서 뽑는다. 대신 칸 차례에 안 흔들리게
 * 하는 일은 procedureStructuralOperationsSignature 가 안에서 한다.
 */
function pendingSnapshotSignature(snapshot: PendingSnapshot): string {
  const dump = (map: Map<string, unknown>) => [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([
    dump(snapshot.layoutMoves),
    dump(snapshot.edgeRouteMoves),
    dump(snapshot.nodeFieldDrafts),
    dump(snapshot.edgeFieldDrafts),
    dump(snapshot.edgeSaveNotes),
    procedureStructuralOperationsSignature(snapshot.structuralOperations),
  ]);
}

function pendingSnapshotsEqual(a: PendingSnapshot, b: PendingSnapshot): boolean {
  return pendingSnapshotSignature(a) === pendingSnapshotSignature(b);
}

/**
 * 저장 전 초안 지도에서 **키 몇 개를 빼낸 새 지도**. 지우기 뒤처리가 쓰는 자리가
 * 2026-11-21 에 다섯으로 늘어 한 벌로 모았다(노드 삭제에 선이 딸려 가면서 연결선
 * 쪽 지도 셋도 함께 치워야 한다).
 *
 * 🔵 **하나도 안 빠지면 들어온 지도를 그대로 돌려준다.** setState 에 새 Map 을
 * 넘기면 내용이 같아도 신원이 달라 딸린 useMemo 들이 전부 다시 돈다 — 손으로 적던
 * 시절의 `if (!prev.has(id)) return prev;` 가 지키던 성질이고, 모으면서 잃기 쉬운
 * 자리라 여기 그대로 옮겨 적는다.
 */
function dropMapKeys<T>(map: Map<string, T>, keys: readonly string[]): Map<string, T> {
  if (!keys.some((key) => map.has(key))) return map;
  const next = new Map(map);
  for (const key of keys) next.delete(key);
  return next;
}

export default function ProcedureTemplateEditorScreen({
  template,
  historyView,
  comparison,
  canEdit,
  canPublish = false,
  canDiscardDraft = false,
  fieldAddedSteps = [],
  nextProcedureCandidates = [],
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
  /**
   * [종료] 노드의 「다음 절차」로 고를 수 있는 절차들(2026-11-04, 줄기 B ④ 조각 ②).
   *
   * 🔵 **기본값이 빈 배열이다.** 안 넘기는 호출부에서는 고르는 칸에
   * 「이어가지 않음」만 서고, 이미 지정된 값이 있으면 「목록에 없습니다」로
   * 밝혀진다 — 조용히 지워지지 않는다.
   *
   * 🔴 거르는 일은 **서버가 한다**(listNextProcedureLinkCandidates): 게시본 ·
   * 기술작업 · 참고용 아님 · 자기 계열 제외. 화면이 다시 거르지 않는 까닭은,
   * 거르는 잣대가 둘이 되면 고를 수 있는데 저장이 거절하는 날이 오기 때문이다.
   */
  nextProcedureCandidates?: NextProcedureLinkCandidate[];
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
  /**
   * 🔴 **다섯째 그림자**(2026-11-20, 조각 4) — 이번 저장에서 **서버가 받아 끝낸**
   * 구조 조작들. 앞의 넷과 달리 이것은 「행의 칸 값」이 아니라 **행 자체가 생기고
   * 사라진 것**이라, 같은 수법(서버 행 위에 덮어쓰기)으로는 표현할 수가 없다 —
   * 새로 만든 노드는 `template.nodes` 에 **아예 없다.**
   *
   * 🔴 이것이 없으면 **부분 실패에서 방금 만든 노드가 화면에서 사라진다.** 보낸
   * 조작은 모아 둔 목록에서 빠지는데(다시 보내면 두 번 만들어진다) 화면은 부분
   * 실패에서 router.refresh() 를 안 부르므로, 목록에도 없고 서버 목록에도 없는
   * 상태가 된다. 그래서 **아래 미리보기에는 「아직 안 보낸 것」과 「방금 보낸 것」을
   * 함께** 얹는다.
   *
   * 🔵 비우는 자리는 앞의 넷과 똑같다 — 진짜 새로고침이 닿으면 서버 목록이 이미
   * 그 행들을 들고 있어 그림자가 거짓이 된다.
   */
  const [justSavedStructuralOperations, setJustSavedStructuralOperations] = useState<PendingStructuralOperation[]>([]);
  if (template.updatedAt !== prevTemplateUpdatedAt) {
    setPrevTemplateUpdatedAt(template.updatedAt);
    setCurrentUpdatedAt(template.updatedAt);
    setJustSavedNodeFieldsById(new Map());
    setJustSavedPositionsById(new Map());
    setJustSavedEdgeFieldsById(new Map());
    setJustSavedRoutesById(new Map());
    setJustSavedStructuralOperations([]);
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
  /**
   * 2026-11-21(조각 B2) — 그림 위에서 **마우스가 하는 일**(마우스 / 점선 네모).
   * 바로 위 배치 모드와 **같은 까닭으로 여기 들어 올렸다**: 그림 바깥의 부품이
   * 이 값을 알아야 하는 날이 오기 때문이다(다음 조각의 [Delete] 복수 삭제는
   * 이 화면이 맡는 일이고, 「지금 점선 네모 모드인가」로 갈린다).
   *
   * 🔴 **이 화면이 제 손으로 갈아 끼우지 않는다.** 바꾸는 길은 그림 안의
   * `changeCanvasTool` 하나여야 한다 — 그 함수가 바꾸는 김에 고른 것을 비운다.
   * 여기서 직접 `setCanvasTool` 을 부르면 앞 모드에서 고른 칸이 그대로 남아
   * 엉뚱한 칸이 함께 끌린다(그림 쪽 프롭 주석에 같은 경고).
   */
  const [canvasTool, setCanvasTool] = useState<ProcedureCanvasTool>("POINTER");
  /**
   * 2026-11-21(조각 B3) — **[범위 선택]으로 고른 칸들.** 바로 위 도구 모드와 같은
   * 통제형 패턴으로 그림에서 들어 올렸다(그림 쪽 프롭 주석에 같은 까닭).
   *
   * 🔴 올린 까닭은 **[Delete] 하나**다. 고른 여럿을 한 번에 지우는 일은 「모아 두는
   * 목록에 쌓고 되돌리기 한 칸을 찍는」 일이라 이 화면 말고 할 수 있는 데가 없다.
   *
   * 🔴 **이 화면은 제 손으로 비우지 않는다.** 비우는 길은 그림 안의 둘 그대로다 —
   * changeCanvasTool(모드 전환) · handleCanvasPaneClick(빈 바탕 누르기). 여기서
   * 하는 일은 **지운 칸을 빼는 것** 하나이고(handleQueueDeleteNodes), 못 지운 칸은
   * 일부러 골라진 채 남긴다 — 그래야 「N개 선택」이 줄다 멈추고 그 칸만 테두리가
   * 남아 화면이 스스로 말한다(새 안내 줄을 세우지 않는 까닭이기도 하다).
   */
  const [boxSelectedNodeIds, setBoxSelectedNodeIds] = useState<ReadonlySet<string>>(() => new Set<string>());
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

  /**
   * 🔴 **그림이 실제로 그린 자리**를 노드 id 마다(2026-11-05).
   *
   * 크기(resolveNodeDimensions)의 **자리 쪽 짝**이다. 전까지 두 패널은 기준
   * 노드의 자리를 저장된 position_x/y 로 읽었는데, 기술작업절차의 그 값은
   * 「만든 차례대로 쌓은 숫자」(x 가 전부 0)일 뿐 사람이 그린 자리가 아니다 —
   * 노드를 그림은 제 나름의 자동 배치로 그린다. 그래서 화면에서 x = −486 에
   * 서 있는 노드의 「아래」를 눌러도 새 노드가 x = 0 에, 다른 노드 위로
   * 포개져 꽂혔다(브라우저 실측).
   *
   * 🔴 **자리를 여기서 다시 세지 않는다.** 그림이 제가 그린 값을 올려보내고
   * (ProcedureFlowGraph 의 onRenderedPositionsChange) 이 화면은 그대로 들고
   * 있다가 패널에 넘길 뿐이다. 같은 계산이 두 벌이 되면 「시험은 통과하는데
   * 화면만 어긋나는」 자리가 생긴다.
   *
   * 🔵 ref 가 아니라 state 다 — 패널은 이 값을 **렌더 중에** 읽을 수 있어야
   * 한다(단추를 누르는 순간이 아니라 그려 둔 함수 안에서 읽는다). 올려보내는
   * 쪽이 effect 한 번에 한 번만 부르고 지도의 신원이 안정적이라, 이 setState 가
   * 끝없는 되그리기로 번지지 않는다.
   */
  const [renderedNodePositions, setRenderedNodePositions] = useState<ReadonlyMap<string, { x: number; y: number }>>(() => new Map());
  const handleRenderedPositionsChange = useCallback((positions: ReadonlyMap<string, { x: number; y: number }>) => {
    setRenderedNodePositions(positions);
  }, []);

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
  /**
   * 저장된 자리 + 이번 세션의 끌기. **「화면에 그려지는 자리」가 아니다** —
   * 자리 값이 없는 노드를 그림은 제 나름의 자동 배치로 그린다.
   *
   * 🔴 2026-11-05 현재 이것을 읽는 곳은 **유령 칸의 받침(anchorPositions) 하나
   * 뿐**이고, 그것은 **일부러 남긴 것**이다(그 자리의 주석에 까닭 둘). 자리를
   * 바꾸는 조작 셋 — 「상대 위치로 이동」· 「선택한 노드 아래 추가」· 「연결선
   * 곧게 펴기」· 「경로점 추가」 — 은 전부 아래 resolveCurrentPosition 으로
   * 옮겨 갔다. 🔵 **여기에 쓰임을 새로 더하지 마라**: 자리를 읽는 일이면
   * 십중팔구 resolveCurrentPosition 쪽이 맞다.
   */
  const workingLayoutPositions = useMemo(() => {
    const map = new Map(savedLayoutPositions);
    for (const [id, pos] of pendingLayoutMoves) map.set(id, pos);
    return map;
  }, [savedLayoutPositions, pendingLayoutMoves]);

  /**
   * 🔴 **자리를 바꾸는 조작이 기준으로 삼아야 하는 값** — 그림에 그려져 있는
   * 자리다. 위 두 지도와 **다르다**: 저 둘은 저장된 값(+이번 세션의 끌기)이고,
   * 자리 값이 없는 노드를 그림은 제 나름의 자동 배치로 그린다.
   *
   * 차례 셋과 「덧셈이 아니라 고르기」인 까닭은 resolveCurrentRenderedNodePosition
   * 의 주석에 있다 — 셈을 여기 다시 적지 않는 것은 그래야 값으로 시험할 수
   * 있기 때문이다(procedure-editor-save-state.test.ts).
   *
   * 🔵 받침이 `savedLayoutPositions`(끌기를 안 섞은 쪽)인 것은 일부러다 —
   * 끌기는 ①이 이미 맡고 있어서, 여기에 workingLayoutPositions 를 넣으면 같은
   * 값이 두 칸에 걸쳐 「두 번 반영되나?」를 읽는 사람이 매번 따져야 한다.
   * 세 칸의 뜻이 서로 안 겹치게 둔다.
   */
  const resolveCurrentPosition = useCallback(
    (nodeId: string): Position | undefined =>
      resolveCurrentRenderedNodePosition(nodeId, {
        pendingLayoutMoves,
        renderedPositions: renderedNodePositions,
        savedPositions: savedLayoutPositions,
      }),
    [pendingLayoutMoves, renderedNodePositions, savedLayoutPositions]
  );

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

  /**
   * ==========================================================================
   * 🔴 저장 전 **구조 변경** 목록 (2026-11-20, 조각 4)
   * ==========================================================================
   * 쓰는 분의 요청: 「노드·연결선 추가·삭제·재연결은 [저장] 없이 바로 저장되는데,
   * 그것들도 [저장]을 눌러야 저장되도록 해 달라.」 그래서 일곱(노드 추가·삭제·유형
   * 변경 · 연결선 추가·삭제·재연결 · 연결선 위 노드 끼우기)이 **누르는 즉시 서버로**
   * 가던 것을 여기 쌓아 두었다가 [저장] 한 번에 보낸다.
   *
   * 🔵 **[이전]/[앞으로]와 이력 복원, 템플릿 이름 변경은 그대로 즉시**다. 앞 둘은
   *    되돌리는 동작 자체라 모아 둘 것이 없고(되돌릴 대상이 서버 이력이다), 이름
   *    변경은 그래프 구조가 아니다.
   *
   * 🔴 번호를 찍는 길은 **appendPendingStructuralOperations 하나뿐**이다 — 도장
   *    (createTempIdMinter)을 여기서 직접 만들지 않는다. 렌더마다 다시 만들면 같은
   *    번호가 두 번 나가고, 그러면 접기가 서로 다른 두 노드를 한 덩어리로 봐서
   *    하나를 지울 때 다른 하나가 같이 사라진다(조각 3 머리말). 그 함수는 **살아
   *    있는 목록에서** 다음 번호를 뽑으므로 그 함정이 성립하지 않는다.
   */
  const [pendingStructuralOperations, setPendingStructuralOperations] = useState<PendingStructuralOperation[]>([]);

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
      structuralOperations: pendingStructuralOperations,
    }),
    [pendingLayoutMoves, pendingEdgeRouteMoves, pendingNodeFieldDraftsById, pendingEdgeFieldDraftsById, pendingEdgeSaveNoteById, pendingStructuralOperations]
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
    // 🔵 지도 다섯과 같은 규약으로 **사본**을 넣는다 — 스냅샷 안의 배열을 그대로
    //    state 에 꽂으면 그다음 조작이 그 배열을 가리키게 되어, 되돌아간 자리가
    //    다음 조작에 따라 움직인다.
    setPendingStructuralOperations([...snapshot.structuralOperations]);
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
   * ── 🔴 2026-11-20(조각 4) — **그 안내가 가리키는 범위가 줄었다** ─────────
   * 쓰는 분에게서 같은 요청이 다시 왔고(안내로는 부족했다는 뜻이다), 이번에는
   * 동작을 바꿔 **일곱을 [저장] 쪽으로 옮겼다.** 그래서 이 표시가 뜨는 자리는
   * 이제 **여전히 즉시 저장되는 것들**뿐이다 — 템플릿 이름 변경 · 이력 복원 ·
   * 현장 단계 넣기 · [이전]/[앞으로]. 🔴 노드·연결선 추가·삭제·재연결은 여기
   * 더 이상 안 온다(오면 거짓말이 된다 — 아직 서버에 안 갔다).
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

  /**
   * ==========================================================================
   * 🔴 저장 전 구조 변경을 **서버 목록 위에 얹은 그래프** (2026-11-20, 조각 4)
   * ==========================================================================
   * 아래 serverNodesById · renderedNodes 가 전부 이 결과를 돈다. 전에는 둘 다
   * `template.nodes`(서버가 그려 준 목록)를 돌았는데, 그러면 **아직 안 보낸 노드가
   * 화면에 아예 안 그려진다** — 누르고 나서 아무 일도 안 일어난 것처럼 보인다.
   *
   * 🔴 얹는 목록이 **둘을 이어 붙인 것**인 까닭은 justSavedStructuralOperations 의
   * 주석에 있다 — 부분 실패에서 「방금 보낸 것」이 서버 목록에도 없고 대기 목록에도
   * 없는 틈이 생기기 때문이다. 차례는 **보낸 것이 먼저**다(시간순 그대로).
   *
   * 🔵 행을 만들고 고치는 일(factories)은 여기가 맡는다 — 미리보기 모듈은
   * EditorNodeRow 에 칸이 몇 개인지 모른다. 새 노드의 칸은 **서버가 실제로 적는 것만**
   * 채우고 나머지는 null/기본값이다(createProcedureTemplateNode 와 같은 모습).
   */
  const previewOperations = useMemo(
    () => [...justSavedStructuralOperations, ...pendingStructuralOperations],
    [justSavedStructuralOperations, pendingStructuralOperations]
  );

  const structuralPreviewFactories: StructuralPreviewFactories<EditorNodeRow, EditorEdgeRow> = useMemo(
    () => ({
      createNode: (seed) => ({
        id: seed.id,
        // 🔵 서버는 `manual-<새 uuid>` 를 적는데 그 번호는 저장하기 전에는 알 수 없다.
        //    화면에 보이는 자리(노드 검색·드롭다운의 괄호 안)라 **사람이 읽을 수 있는
        //    글**을 넣는다 — 「저장 전」이면 그 노드가 아직 서버에 없다는 뜻까지 함께 말한다.
        nodeCode: "저장 전",
        nodeType: seed.nodeType,
        title: seed.title,
        description: null,
        instructions: null,
        objective: null,
        preparation: null,
        toolsAndEquipment: null,
        safetyCaution: null,
        expectedNormalResult: null,
        ngSymptoms: null,
        recommendedCorrectiveAction: null,
        acceptanceCriteria: null,
        workerMayAddNextTask: false,
        nextProcedureTemplateId: null,
        // 🔵 가리킨 파일도 없다 — 노드를 **만드는** 자리에는 고르는 창이 없고(속성
        //    패널에만 있다), CREATE_NODE 도 그 칸을 안 싣는다. 만든 뒤 골라 담으면
        //    그때 초안 지도를 타고 들어간다(NODE_FIELDS 걸음).
        shareDocRelativePath: null,
        positionX: seed.position ? seed.position.x : 0,
        positionY: seed.position ? seed.position.y : 0,
        // 🔴 자리를 안 정했으면 user_position 을 **null 로 둔다** — 그래야 그림이
        //    제 자동 배치로 그리고, 저장 뒤 서버가 세로로 쌓은 모습과 어긋나지 않는다.
        userPositionX: seed.position ? seed.position.x : null,
        userPositionY: seed.position ? seed.position.y : null,
        sortOrder: seed.sortOrder,
        sourceWorksheet: null,
        sourceShapeId: null,
        sourceCellRange: null,
        isActive: true,
        hasChecklistContent: false,
        hasTroubleshootingContent: false,
      }),
      createEdge: (seed) => ({
        id: seed.id,
        fromNodeId: seed.fromNodeId,
        toNodeId: seed.toNodeId,
        branchType: seed.branchType,
        branchLabel: seed.branchLabel,
        sortOrder: seed.sortOrder,
        sourceConnectorId: null,
        clonedFromEdgeId: null,
        userRoutePoints: null,
      }),
      changeNodeType: (node, newNodeType) => ({ ...node, nodeType: newNodeType }),
      retargetEdge: (edge, fromNodeId, toNodeId) => ({ ...edge, fromNodeId, toNodeId }),
    }),
    []
  );

  const structuralPreview = useMemo(
    () => previewPendingStructuralGraph(template.nodes, template.edges, previewOperations, structuralPreviewFactories),
    [template.nodes, template.edges, previewOperations, structuralPreviewFactories]
  );

  /** 서버 목록에 **아직 없는** 노드·연결선(= 저장 전에 만든 것). 화면 여기저기서 「저장 전인가」를 묻는 잣대다. */
  const unsavedNodeIds = useMemo(() => new Set(structuralPreview.nodes.filter((n) => isTempNodeId(n.id)).map((n) => n.id)), [structuralPreview.nodes]);

  const templateNodeById = useMemo(() => new Map(template.nodes.map((n) => [n.id, n])), [template.nodes]);
  const templateEdgeById = useMemo(() => new Map(template.edges.map((e) => [e.id, e])), [template.edges]);

  /**
   * 🔴 **받침(baseline)의 출처가 둘**이다. 이미 서버에 있는 행은 `template.nodes`
   * 의 값이 받침이고(그래야 「바뀌었는가」를 저장된 값과 맞댄다), 저장 전에 만든
   * 행은 **미리보기 행 자체**가 받침이다 — 맞댈 서버 값이 아직 없으므로 「만들 때
   * 적은 값」이 그 자리를 맡는 수밖에 없다.
   *
   * 🔴 받침을 안 세우면 속성 패널이 새 노드의 제목을 **빈 칸으로** 보여 준다
   * (nodeFieldDraft 가 `server?.title ?? ""` 로 떨어진다). 사람이 방금 적은 제목이
   * 패널에서만 사라지는 꼴이라 고장으로 읽힌다.
   */
  const serverNodesById = useMemo(() => {
    const map = new Map<string, ProcedureServerNodeSnapshot>();
    for (const previewNode of structuralPreview.nodes) {
      const source = templateNodeById.get(previewNode.id) ?? previewNode;
      const effectivePos = resolveEffectiveNodePosition(source, "USER");
      const raw: ProcedureServerNodeSnapshot = {
        id: previewNode.id,
        title: source.title,
        description: source.description,
        instructions: source.instructions,
        sortOrder: source.sortOrder,
        isActive: source.isActive,
        nextProcedureTemplateId: source.nextProcedureTemplateId,
        shareDocRelativePath: source.shareDocRelativePath,
        positionX: effectivePos.x,
        positionY: effectivePos.y,
      };
      map.set(previewNode.id, mergeProcedureNodeForRender(raw, justSavedNodeFieldsById.get(previewNode.id), justSavedPositionsById.get(previewNode.id)));
    }
    return map;
  }, [structuralPreview.nodes, templateNodeById, justSavedNodeFieldsById, justSavedPositionsById]);

  const serverEdgesById = useMemo(() => {
    const map = new Map<string, ProcedureServerEdgeSnapshot>();
    for (const previewEdge of structuralPreview.edges) {
      const source = templateEdgeById.get(previewEdge.id) ?? previewEdge;
      const raw: ProcedureServerEdgeSnapshot = {
        id: previewEdge.id,
        branchType: source.branchType,
        branchLabel: source.branchLabel,
        routePoints: source.userRoutePoints && source.userRoutePoints.length > 0 ? source.userRoutePoints : null,
      };
      map.set(previewEdge.id, mergeProcedureEdgeForRender(raw, justSavedEdgeFieldsById.get(previewEdge.id), justSavedRoutesById.get(previewEdge.id)));
    }
    return map;
  }, [structuralPreview.edges, templateEdgeById, justSavedEdgeFieldsById, justSavedRoutesById]);

  function nodeFieldDraft(nodeId: string): ProcedureNodeFieldDraft {
    const pending = pendingNodeFieldDraftsById.get(nodeId);
    if (pending) return pending;
    const server = serverNodesById.get(nodeId);
    return {
      title: server?.title ?? "",
      description: server?.description ?? "",
      instructions: server?.instructions ?? "",
      sortOrder: server?.sortOrder ?? 0,
      isActive: server?.isActive ?? true,
      // 🔵 이웃 글자 칸들과 달리 **빈 글자로 떨어뜨리지 않는다** — 이 값은
      //    id 아니면 null 이고, 빈 글자를 섞으면 FK 에 빈 글자가 날아간다.
      nextProcedureTemplateId: server?.nextProcedureTemplateId ?? null,
      // 🔴 안 가리킨 것이 기본이다. 🔵 바로 위와 같은 까닭으로 `?? ""` 가 아니다 —
      //    이 칸은 초안도 서버도 `string | null` 한 가지 모양이다.
      shareDocRelativePath: server?.shareDocRelativePath ?? null,
    };
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

  /**
   * 🔴 **접은 뒤의 건수를 센다**(2026-11-20, 조각 4) — 사람이 한 조작 수가 아니다.
   * 만들었다 지운 노드는 서버에 보낼 것이 0건이고, 그 줄에 걸렸던 선도 함께
   * 사라진다. 사람이 세 번 눌렀어도 「변경 0건」이 맞는 답이다.
   *
   * 🔴 그리고 **막힌 것**(conflicts)이 하나라도 있으면 [저장]을 막는다. operations
   * 만 들고 보내면 사람이 화면에서 한 일 하나가 설명 없이 사라진다(조각 1 의 관문).
   */
  const coalescedStructural = useMemo(() => coalescePendingStructuralOperations(pendingStructuralOperations), [pendingStructuralOperations]);
  const structuralPendingCount = coalescedStructural.operations.length;
  const structuralConflictMessages = useMemo(() => describeStructuralConflicts(coalescedStructural.conflicts), [coalescedStructural.conflicts]);
  const canSendStructural = canSendStructuralChanges(coalescedStructural);

  const dirtyNodeFieldEntries = computeDirtyProcedureNodeFieldEntries(pendingNodeFieldDraftsById, serverNodesById);
  const dirtyEdgeFieldEntries = computeDirtyProcedureEdgeFieldEntries(pendingEdgeFieldDraftsById, serverEdgesById);
  const dirtyPositionNodeIds = computeDirtyProcedurePositionNodeIds(pendingLayoutMoves, serverNodesById);
  const dirtyRouteEdgeIds = computeDirtyProcedureRouteEdgeIds(pendingEdgeRouteMoves, serverEdgesById);
  /**
   * 🔴 구조 변경 건수가 **반드시** 여기 더해져야 한다. 안 더하면 노드만 추가한
   * 상태에서 [저장]이 꺼져 있어 **한 건도 안 나간다** — 이번 일이 고치려던 바로 그
   * 증상이 모양만 바꿔 되돌아온다.
   * 🔵 나가기 경고(beforeunload · handleExit)도 이 값을 보므로, 더하면 경고가
   *    저장 전 구조 변경까지 함께 지킨다.
   */
  const totalPendingCount =
    dirtyNodeFieldEntries.length + dirtyEdgeFieldEntries.length + dirtyPositionNodeIds.length + dirtyRouteEdgeIds.length + structuralPendingCount;
  const hasAnyPendingChanges = totalPendingCount > 0;

  /**
   * Full EditorNodeRow rows, safe-to-defer fields overridden by live drafts — passed to ProcedureFlowGraph/panels so there is exactly one rendered graph, never a separate copy for the canvas and another for Save. userPositionX/Y is only ever touched when THIS session actually has a position override pending or just-saved for that node — otherwise the original row's own value (null, or a real prior override) passes through untouched, preserving SOURCE-mode/layered-layout fallback behavior for every node this session never dragged.
   *
   * 🔴 2026-11-20(조각 4) — 도는 목록이 `template.nodes` 에서 **structuralPreview.nodes**
   * 로 바뀌었다. 저장 전에 추가한 노드가 여기 안 들어오면 그림에도 패널에도 안 나온다.
   */
  const renderedNodes: EditorNodeRow[] = useMemo(
    () =>
      structuralPreview.nodes.map((n) => {
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
          // 🔴 저장 전 초안이 여기에도 비쳐야 한다(2026-11-25) — 안 얹으면 이 행의
          //    칸만 서버 값으로 남아, 나중에 이 행을 읽는 자리가 생기는 날 **패널은
          //    새 값을 보이는데 행은 옛 값**인 두 벌이 된다.
          //    🔵 지금 이 칸을 읽는 호출부는 없다(속성 패널은 draft 를 본다).
          //       이웃 nextProcedureTemplateId 는 아직 안 얹혀 있는데, 그쪽은 이 조각의
          //       몫이 아니라 손대지 않았다(보고에 적었다).
          shareDocRelativePath: merged.shareDocRelativePath,
          userPositionX: hasSessionPositionOverride ? merged.positionX : n.userPositionX,
          userPositionY: hasSessionPositionOverride ? merged.positionY : n.userPositionY,
        };
      }),
    [structuralPreview.nodes, serverNodesById, pendingNodeFieldDraftsById, pendingLayoutMoves, justSavedPositionsById]
  );

  const renderedEdges: EditorEdgeRow[] = useMemo(
    () =>
      structuralPreview.edges.map((e) => {
        const baseline = serverEdgesById.get(e.id)!;
        const merged = mergeProcedureEdgeForRender(baseline, pendingEdgeFieldDraftsById.get(e.id), pendingEdgeRouteMoves.get(e.id));
        return { ...e, branchType: merged.branchType, branchLabel: merged.branchLabel, userRoutePoints: merged.routePoints };
      }),
    [structuralPreview.edges, serverEdgesById, pendingEdgeFieldDraftsById, pendingEdgeRouteMoves]
  );

  // ---- 현장에서 더한 단계를 **희미하게** 얹는다 (줄기 B-⑧) ----
  //
  // 🔴 유령 칸·선은 renderedNodes/renderedEdges 에 **안 섞는다.** 그 둘은 저장·
  //    검증·짚기·되돌리기가 전부 읽는 「이 초안의 진짜 내용」이다. 유령을 섞으면
  //    [저장]이 없는 노드를 저장하려 들고, [검증]이 없는 노드를 세고, 부모 비교가
  //    「새로 추가된 노드」로 올린다 — 어느 것도 사람이 시킨 적 없는 일이다.
  //    그림에만 따로 넘기는 길(ghostNodes/ghostEdges)이 그래서 생겼다.
  //
  // 🔵 **받침 자리**의 기준은 workingLayoutPositions(저장된 자리 + 끌고 있는
  //    자리)다.
  //
  // 🔴 **「지금 그려지고 있는 자리」가 아니다**(2026-11-05 에 바로잡았다). 이
  //    주석에 그렇게 적혀 있었는데 사실이 아니다 — 바로 아래 문단이 설명하듯
  //    자리 값이 없는 노드를 그림은 자동 배치로 그리고, workingLayoutPositions
  //    는 그 값을 모른다. 같은 거짓말이 「연결선 곧게 펴기」에도 적혀 있었고
  //    거기서는 실제로 노드를 엉뚱한 곳으로 보냈다(handleEdgeDoubleClick).
  //
  // 🔴 **그런데 여기만은 그대로 두었다**(2026-11-05 판단). 고치려면 그림이
  //    올려보낸 지도(renderedNodePositions)를 여기 넣어야 하는데, 그러면 고리가
  //    닫힌다: 유령 받침이 바뀜 → ghostNodes 의 신원이 바뀜 → 그림의
  //    layeredLayout memo 가 다시 돎 → resolveBaselinePosition 이 바뀜 →
  //    올려보낼 지도가 **새 Map** 으로 다시 만들어짐 → effect 가 또 돎 →
  //    유령 받침이 또 바뀜. 값이 수렴하더라도 **신원이 수렴하지 않아** 렌더가
  //    멈추지 않는다(buildFieldStepGhostGraph 도 매번 새 객체를 낸다).
  //    useAutoLayoutForUnpositionedNodes 가 꺼진 절차에서도 똑같이 닫힌다 —
  //    그쪽 가지도 ghostNodes 를 의존 목록에 두고 매번 새 빈 Map 을 낸다.
  //
  // 🔵 **게다가 여기서는 고칠 것이 없다.** 유령이 실제로 그려지는 자리는 이
  //    받침이 아니라 자동 배치가 센 값이다(ProcedureFlowGraph 의
  //    resolveGhostPosition 차례 ②, 그리고 buildFieldStepGhostGraph 머리말의
  //    「②③ 이 센 x/y 는 그 절차에서는 안 쓰인다」). 현장에서 사람이 끌어다
  //    놓은 자리가 있는 유령(차례 ①)은 그 값을 **단계 자신**이 들고 오지
  //    anchorPositions 에서 읽지 않는다. 즉 이 지도가 화면에 닿는 길은
  //    자동 배치를 안 켠 절차 하나뿐이고, 거기서는 자리 값이 다 차 있어
  //    workingLayoutPositions 가 곧 화면 자리다.
  //
  // 🔴 **「빠뜨린 것」으로 보고 고치지 마라** — 위 고리가 그대로 살아난다.
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
   * 🔴 2026-11-20(조각 4) — **지나는 조작이 줄었다.** 전에는 노드 생성·유형 변경·
   * 연결선 생성·재연결·끼우기까지 여기로 왔는데, 그 일곱이 [저장] 쪽으로 옮겨
   * 갔다(그쪽은 planUndoStackAfterStructuralSave 가 저장 **뒤에** 표시를 세운다).
   * 지금 여기 오는 것은 **여전히 즉시 서버로 가는 셋**뿐이다 —
   * 템플릿 이름 변경 · 이력 복원 · 현장 단계 넣기.
   *
   * 🔴 일곱을 여기 그대로 두면 **같은 변경에 표시가 두 번** 선다(모아 둘 때 한 번,
   * 저장할 때 또 한 번). 그러면 [이전]을 두 번 눌러야 한 걸음이 되돌아간다.
   *
   * 🔵 「현장 단계 넣기」는 일곱에 없다 — 그 조작은 서버가 실행 쪽 행을 제 손으로
   *    읽어 노드·간선을 만드는 것이라 화면이 모아 둘 값이 없다. 그대로 즉시다.
   */
  function handleStructuralSaved(newUpdatedAt: string, structuralValidation?: StructuralValidationSummary) {
    pushStructuralUndoStep();
    handleSaved(newUpdatedAt, structuralValidation);
  }

  /**
   * ==========================================================================
   * 🔴 구조 변경을 **모아 두는** 단 하나의 통로 (2026-11-20, 조각 4)
   * ==========================================================================
   * 일곱이 전부 여기를 지난다. 하는 일이 둘인데 **차례가 중요하다.**
   *
   *  ① `pushPendingUndoStep()` 을 **목록을 고치기 전에** 부른다. 되돌리기 스택은
   *     「바뀌기 직전 상태」를 쌓는 방식이라, 뒤에 부르면 이미 바뀐 목록이 담겨
   *     [이전]이 한 칸씩 밀린다(드래그가 지켜 온 규칙 그대로다).
   *  ② 번호는 appendPendingStructuralOperations 가 찍는다. 도장을 여기서 만들지
   *     않는 까닭은 pendingStructuralOperations 선언부에 있다.
   */
  function queueStructural(build: Parameters<typeof appendPendingStructuralOperations>[1]) {
    pushPendingUndoStep();
    setPendingStructuralOperations((prev) => appendPendingStructuralOperations(prev, build));
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

  /**
   * ── 🔴 구조 변경 일곱을 모아 두는 자리 (2026-11-20, 조각 4) ───────────────
   * 전에는 패널들이 서버 액션을 직접 불렀고, 성공하면 handleStructuralSaved /
   * handleNodeDeleted / handleEdgeDeleted 로 돌아왔다. 지금은 **무엇을 할지만**
   * 받아 목록에 쌓고, 실제 호출은 handleGlobalSave 가 한다.
   *
   * 🔴 **되돌리기 한 걸음은 queueStructural 이 쌓는다**(목록을 고치기 전에).
   *    여기서 pushStructuralUndoStep 을 또 부르면 한 변경에 표시가 둘이 선다.
   */
  function handleQueueCreateNode(input: { nodeType: ManualTechnicalNodeType; title: string; position: Position | null }) {
    queueStructural((mint) => [
      { kind: "CREATE_NODE", tempNodeId: mint.nextNodeId(), nodeType: input.nodeType, title: input.title, position: input.position },
    ]);
  }

  function handleQueueChangeNodeType(nodeId: string, newNodeType: ProcedureNodeType, reason: string | null) {
    queueStructural(() => [{ kind: "CHANGE_NODE_TYPE", nodeId, newNodeType, reason }]);
  }

  /**
   * ── 🔴 **붙은 연결선도 함께 지운다** (2026-11-21 쓰는 분 결정) ────────────
   * 「노드를 지우면 연결된 연결선도 함께 지워지는 걸로 하자 — 연결선을 지우지
   * 않아도 노드를 지울 수 있도록.」 전에는 선이 붙은 노드를 아예 못 지웠다
   * (selectedNodeDeleteBlockedReason 이 단추를 잠갔다). 사람이 선을 하나씩 먼저
   * 지우고 나서야 노드를 지울 수 있었다.
   *
   * 🔴 **무엇을 쌓을지는 planProcedureNodeDeletionOperations 가 정한다** — 선을
   * 찾는 일도 차례도 거기 한 벌이고 값으로 재어진다(화면은 .css 와 server-only 를
   * 물고 있어 import 자체가 던진다). 여기서 다시 세면 「패널이 말한 수」와 「실제로
   * 지워지는 수」가 갈린다.
   *
   * 🔴 넘기는 목록이 **renderedEdges**(그림이 실제로 그린 선)인 것이 핵심이다.
   * 서버 목록(template.edges)으로 세면 ① 저장 전에 그은 선을 빠뜨려 [저장]이
   * ENDPOINT_DELETED_IN_SAME_SAVE 로 통째로 막히고 ② 저장 전에 옮긴 선은 양 끝이
   * 달라서 엉뚱한 선을 지운다. 까닭 전문은 그 모듈 머리말에 있다.
   *
   * 🔵 **[이전] 한 칸**이다 — queueStructural 이 목록을 고치기 전에 한 칸을 찍고,
   * 받은 배열을 통째로 붙인다. 노드와 선들이 함께 되살아난다.
   *
   * 🔴 지울 노드의 **초안도 함께 버린다**(옛 handleNodeDeleted 가 하던 뒤처리 그대로).
   * 안 버리면 사라진 노드의 칸 값이 「바뀜」으로 계속 세어져 [저장]이 없는 행을
   * 고치려 든다. 🔵 되돌리면 스냅샷이 그 초안까지 함께 되살린다 — queueStructural
   * 이 **버리기 전에** 한 칸을 찍기 때문이다.
   * 🔴 함께 지워지는 **연결선의 초안·경로·저장 메모도 같이 버린다** —
   * handleQueueDeleteEdge 가 선 하나에 하던 그 뒤처리를, 딸려 지워지는 선들에도
   * 똑같이 해 준다(안 하면 선 하나를 어떻게 지웠느냐에 따라 뒤처리가 갈린다).
   */
  function handleQueueDeleteNode(nodeId: string, reason: string | null) {
    const attachedEdgeIds = findEdgesAttachedToNode(renderedEdges, nodeId);
    queueStructural(() => planProcedureNodeDeletionOperations(renderedEdges, nodeId, reason));
    setPendingNodeFieldDraftsById((prev) => dropMapKeys(prev, [nodeId]));
    setPendingLayoutMoves((prev) => dropMapKeys(prev, [nodeId]));
    setPendingEdgeFieldDraftsById((prev) => dropMapKeys(prev, attachedEdgeIds));
    setPendingEdgeRouteMoves((prev) => dropMapKeys(prev, attachedEdgeIds));
    setPendingEdgeSaveNoteById((prev) => dropMapKeys(prev, attachedEdgeIds));
    setSelectedNodeId(null);
    // 🔵 함께 지워진 선을 고른 채였다면 선택도 푼다. 안 풀어도 패널은 안 서지만
    //    (EdgePropertyPanel 은 그려진 선에서만 서고 그 선은 이미 사라졌다), 고른
    //    경로점이 남아 있으면 [Delete] 가 없는 선의 점을 지우러 간다.
    if (selectedEdgeId !== null && attachedEdgeIds.includes(selectedEdgeId)) {
      setSelectedEdgeId(null);
      setSelectedWaypoint(null);
    }
  }

  /**
   * ── 🔴 **[범위 선택]으로 고른 여럿을 한 번에** (2026-11-21, 조각 B3) ──────────
   * 쓰는 분 요청: 「2번 옮기기 + [DELETE]로 지우는 것까지 하자.」 들어오는 목록은
   * 이미 **지울 수 있는 것만** 걸러진 것이다(planProcedureDeleteKey 가
   * resolveProcedureNodeDeleteBlockedReason 의 답을 보고 걸렀다) — 여기서 또
   * 거르면 세 번째 잣대가 된다.
   *
   * 🔴 **위 단수 함수 안에 못 넣는다.** 넣으면 그 함수가 queueStructural 을 두 번
   * 부르거나 가지를 타게 되는데, 「삭제 한 번에 통로를 한 번만 지난다」는 것이
   * [이전] 한 칸의 근거라 시험이 **정확히 1회**로 못 박고 있다. 그래서 새 함수다.
   *
   * 🔴 **queueStructural 은 여기서도 한 번뿐이다.** 노드마다 부르면 지금은 우연히
   * 한 칸으로 접힐 수 있지만(스냅샷 ref 가 한 이벤트 안에서 안 바뀐다) 그것은
   * 최적화이지 약속이 아니다. 노드마다의 줄을 **합친 배열 하나**로 넘겨야
   * [이전] 한 번에 고른 것이 전부 돌아온다.
   * 🔵 두 노드가 공유하던 선은 DELETE_EDGE 가 두 줄 적히는데, 서버로 가는 길에
   *    반드시 지나는 접기가 DUPLICATE_DELETE 로 한 줄로 만든다(화면의 「변경 N건」도
   *    접힌 뒤 센다). 그래서 노드마다 붙은 선을 넣는 것을 겁낼 까닭이 없다.
   *
   * 🔴 **뒤처리는 단수와 똑같이 다섯 지도 전부**다. 하나라도 빠뜨리면 「같은
   * 저장에서 지워진 노드(선)의 초안을 안 버려 저장 전체가 실패하는」 결함이 난다 —
   * 2026-11-21 에 실제로 겪은 그것이다.
   *
   * 🔵 사유는 null 이다. 이 길은 키 하나뿐이고 사유를 받을 칸이 없다(단수의 키
   *    경로도 null 을 넘긴다 — 사유 칸은 애초에 「선택」이다).
   */
  function handleQueueDeleteNodes(nodeIds: readonly string[]) {
    // 🔵 판정은 빈 목록을 안 준다. 그래도 막아 두는 까닭은, 빈 호출이 **아무것도
    //    안 바뀐 [이전] 한 칸**을 찍어 되돌리기를 한 번 헛돌게 하기 때문이다.
    if (nodeIds.length === 0) return;
    const attachedEdgeIds = findEdgesAttachedToNodes(renderedEdges, nodeIds);
    queueStructural(() => planProcedureNodesDeletionOperations(renderedEdges, nodeIds, null));
    setPendingNodeFieldDraftsById((prev) => dropMapKeys(prev, nodeIds));
    setPendingLayoutMoves((prev) => dropMapKeys(prev, nodeIds));
    setPendingEdgeFieldDraftsById((prev) => dropMapKeys(prev, attachedEdgeIds));
    setPendingEdgeRouteMoves((prev) => dropMapKeys(prev, attachedEdgeIds));
    setPendingEdgeSaveNoteById((prev) => dropMapKeys(prev, attachedEdgeIds));
    // 🔴 **지운 것만 뺀다** — 못 지운 칸은 골라진 채 남는다(쓰는 분 결정).
    //    통째로 비우면 무엇이 안 지워졌는지가 화면에서 사라진다.
    setBoxSelectedNodeIds((prev) => removeNodesFromSelection(prev, nodeIds));
    // 🔵 단수 선택은 이 모드에서 늘 비어 있다(그림이 모드를 바꿀 때 비운다). 그래도
    //    「지워진 것을 고른 채로 두지 않는다」는 뒤처리는 단수와 똑같이 해 둔다 —
    //    둘이 함께 설 수 있게 되는 날 패널이 없는 노드를 그리게 된다.
    if (selectedNodeId !== null && nodeIds.includes(selectedNodeId)) setSelectedNodeId(null);
    if (selectedEdgeId !== null && attachedEdgeIds.includes(selectedEdgeId)) {
      setSelectedEdgeId(null);
      setSelectedWaypoint(null);
    }
  }

  function handleQueueCreateEdge(input: {
    fromNodeId: string;
    toNodeId: string;
    branchType: ProcedureBranchType;
    branchLabel: string | null;
    reason: string | null;
  }) {
    queueStructural((mint) => [
      {
        kind: "CREATE_EDGE",
        tempEdgeId: mint.nextEdgeId(),
        fromNodeId: input.fromNodeId,
        toNodeId: input.toNodeId,
        branchType: input.branchType,
        branchLabel: input.branchLabel,
        reason: input.reason,
      },
    ]);
  }

  function handleQueueRetargetEdge(edgeId: string, newFromNodeId: string, newToNodeId: string, reason: string | null) {
    queueStructural(() => [{ kind: "RETARGET_EDGE", edgeId, newFromNodeId, newToNodeId, reason }]);
  }

  function handleQueueDeleteEdge(edgeId: string, reason: string | null) {
    queueStructural(() => [{ kind: "DELETE_EDGE", edgeId, reason }]);
    setPendingEdgeFieldDraftsById((prev) => {
      if (!prev.has(edgeId)) return prev;
      const next = new Map(prev);
      next.delete(edgeId);
      return next;
    });
    setPendingEdgeRouteMoves((prev) => {
      if (!prev.has(edgeId)) return prev;
      const next = new Map(prev);
      next.delete(edgeId);
      return next;
    });
    setPendingEdgeSaveNoteById((prev) => {
      if (!prev.has(edgeId)) return prev;
      const next = new Map(prev);
      next.delete(edgeId);
      return next;
    });
    setSelectedEdgeId(null);
    setSelectedWaypoint(null);
  }

  /**
   * 🔴 **한 도장에서 번호를 둘 받는다** — 새 노드 하나와 딸려 생길 둘째 연결선
   * 하나. 두 번 나눠 부르면 그 사이에 목록이 바뀌어 번호가 어긋날 수 있다
   * (appendPendingStructuralOperations 가 build 를 **목록**으로 받는 까닭).
   */
  function handleQueueInsertNodeOnEdge(edgeId: string, input: { nodeType: ManualTechnicalNodeType; title: string; position: Position }) {
    queueStructural((mint) => [
      {
        kind: "INSERT_NODE_ON_EDGE",
        edgeId,
        tempNodeId: mint.nextNodeId(),
        tempSecondEdgeId: mint.nextEdgeId(),
        nodeType: input.nodeType,
        title: input.title,
        position: input.position,
      },
    ]);
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
   *
   * ──────────────────────────────────────────────────────────────────────
   * 🔴 2026-11-20(조각 4) — **구조 변경이 앞에 한 단계 더 붙었다**
   * ──────────────────────────────────────────────────────────────────────
   *   구조 보내기 → collectStructuralIdEffects → 네 지도 rebase
   *     → dirty 다시 계산 + includeBrandNew* → 기존 planProcedureSaveSteps
   *     → 기존 runProcedureSaveSequence
   *
   * 차례가 뒤집히면 안 되는 까닭은 procedure-editor-structural-save.ts 머리말에
   * 있다 — 새 노드는 칸 값 단계가 가리킬 진짜 id 가 아직 없고, 그 사라짐에는
   * **오류가 안 난다.**
   *
   * 🔴 구조가 중간에 멈추면 **칸 값 단계로 안 넘어간다**(canProceedToFieldSave).
   * 메시지가 둘이 되면 어디까지 맞는지 사람이 못 읽는다. 🔵 넘어가지 않아도 잃는
   * 것은 없다 — 아직 안 간 초안은 그대로 남아 다음 [저장]에 다시 간다.
   */
  async function handleGlobalSave() {
    if (!hasAnyPendingChanges || !canSendStructural) return;
    setGlobalSaveStatus("saving");
    setGlobalSaveError(null);

    // 🔴 이 아래는 전부 **지역 변수로** 들고 간다. 구조 단계가 지도의 키를 옮기는데
    //    setState 는 다음 렌더에야 닿으므로, 칸 값 단계가 state 를 읽으면 **옮기기
    //    전** 지도를 본다(임시 id 가 그대로 남아 그 줄이 통째로 건너뛰어진다).
    let nodeDrafts = pendingNodeFieldDraftsById;
    let edgeDrafts = pendingEdgeFieldDraftsById;
    let edgeNotes = pendingEdgeSaveNoteById;
    let layoutMoves = pendingLayoutMoves;
    let routeMoves = pendingEdgeRouteMoves;
    let brandNewNodeIds: string[] = [];
    let brandNewEdgeIds: string[] = [];
    let tokenAfterStructural = currentUpdatedAt;
    let structuralValidationFromStructuralPhase: StructuralValidationSummary | null = null;
    /**
     * 🔴 되돌리기 스택을 **한 번만** 손댄다. 여기서 설정해 두고 아래 세 끝 자리에서
     * planUndoStackAfterStructuralSave 에 넘긴다 — 중간에 미리 세워 두면 「전부
     * 성공」 갈래의 스택 비우기가 방금 세운 표시를 도로 지운다.
     * 🔵 구조 변경이 0건이면 빈 목록 그대로이고, 그 함수는 들어온 스택을 **그대로**
     *    돌려준다 — 즉 구조를 안 쓰는 저장에서는 전 동작과 한 글자도 다르지 않다.
     */
    let succeededStructuralOperations: readonly PendingStructuralOperation[] = [];

    if (pendingStructuralOperations.length > 0) {
      const structuralOutcome = await runProcedureStructuralSequence<StructuralValidationSummary>(
        pendingStructuralOperations,
        currentUpdatedAt,
        executeStructuralOperation
      );
      const effects = collectStructuralIdEffects(structuralOutcome);

      // 🔴 **남은 조작 세우기와 네 지도 옮기기를 반드시 함께** 한다. 하나만 하면
      //    어긋난다 — 목록만 바꾸면 초안이 임시 키를 든 채 남아 영영 안 가고,
      //    지도만 옮기면 이미 보낸 조작을 다시 보내 같은 노드가 두 번 만들어진다.
      setPendingStructuralOperations(structuralOutcome.remainingOperations);
      setJustSavedStructuralOperations((prev) => [...prev, ...structuralOutcome.succeededOperations]);

      nodeDrafts = rebaseDraftMapAfterStructuralSave(pendingNodeFieldDraftsById, effects, "node");
      layoutMoves = rebaseDraftMapAfterStructuralSave(pendingLayoutMoves, effects, "node");
      edgeDrafts = rebaseDraftMapAfterStructuralSave(pendingEdgeFieldDraftsById, effects, "edge");
      routeMoves = rebaseDraftMapAfterStructuralSave(pendingEdgeRouteMoves, effects, "edge");
      // 🔵 지시서가 말한 「네 지도」에 **검토자 메모를 하나 더** 얹었다. 그것도
      //    연결선 id 를 키로 쓰는 지도라 똑같이 옮겨야 하고, 안 옮기면 새 연결선에
      //    적은 메모가 그 저장의 이력에서 조용히 빠진다.
      edgeNotes = rebaseDraftMapAfterStructuralSave(pendingEdgeSaveNoteById, effects, "edge");

      setPendingNodeFieldDraftsById(nodeDrafts);
      setPendingLayoutMoves(layoutMoves);
      setPendingEdgeFieldDraftsById(edgeDrafts);
      setPendingEdgeRouteMoves(routeMoves);
      setPendingEdgeSaveNoteById(edgeNotes);

      succeededStructuralOperations = structuralOutcome.succeededOperations;
      brandNewNodeIds = effects.createdNodeIds;
      brandNewEdgeIds = effects.createdEdgeIds;
      tokenAfterStructural = structuralOutcome.finalUpdatedAt;
      structuralValidationFromStructuralPhase = structuralOutcome.lastStructuralValidation;

      if (!canProceedToFieldSave(structuralOutcome)) {
        // 🔴 **칸 값 단계로 안 넘어간다.** 다만 **스택은 반드시 손본다** — 한 건이라도
        //    서버에 갔다면 그보다 앞에 쌓인 스냅샷은 전부 거짓이고(「아직 보낼 것」이라
        //    말하는데 이미 보냈다), 그대로 되돌려 다시 저장하면 같은 노드가 두 번
        //    만들어진다. 🔵 한 건도 안 갔으면 그 함수가 들어온 스택을 그대로 돌려준다.
        setPendingUndoStack((prev) => planUndoStackAfterStructuralSave(prev, { succeededOperations: succeededStructuralOperations }));
        if (succeededStructuralOperations.length > 0) lastFieldEditKeyRef.current = null;
        setCurrentUpdatedAt(tokenAfterStructural);
        if (structuralValidationFromStructuralPhase) setLastStructuralValidation(structuralValidationFromStructuralPhase);
        setGlobalSaveStatus("failed");
        setGlobalSaveError(
          structuralOutcome.failureMessage ?? "저장할 수 없는 구조 변경이 있어 저장을 멈췄습니다. 아래 안내를 확인해 주세요."
        );
        return;
      }
    }

    // 🔴 dirty 를 **다시** 센다. 위에서 키가 옮겨졌고, 같은 저장에서 지워진 행의
    //    초안은 버려졌다 — 바깥(렌더 시점)에서 센 값은 이미 낡았다.
    const rebasedNodeFieldEntries = includeBrandNewDraftEntries(
      computeDirtyProcedureNodeFieldEntries(nodeDrafts, serverNodesById),
      brandNewNodeIds,
      nodeDrafts
    );
    const rebasedEdgeFieldEntries = includeBrandNewDraftEntries(
      computeDirtyProcedureEdgeFieldEntries(edgeDrafts, serverEdgesById),
      brandNewEdgeIds,
      edgeDrafts
    );
    const rebasedPositionNodeIds = includeBrandNewDraftIds(computeDirtyProcedurePositionNodeIds(layoutMoves, serverNodesById), brandNewNodeIds, layoutMoves);
    const rebasedRouteEdgeIds = includeBrandNewDraftIds(computeDirtyProcedureRouteEdgeIds(routeMoves, serverEdgesById), brandNewEdgeIds, routeMoves);

    const steps = planProcedureSaveSteps({
      dirtyNodeFieldEntries: rebasedNodeFieldEntries,
      dirtyEdgeFieldEntries: rebasedEdgeFieldEntries,
      dirtyPositionNodeIds: rebasedPositionNodeIds,
      dirtyRouteEdgeIds: rebasedRouteEdgeIds,
    });

    let capturedStructuralValidation: StructuralValidationSummary | null = null;
    const brandNewNodeIdSet = new Set(brandNewNodeIds);

    async function executeStep(step: ProcedureSaveStep, expectedUpdatedAt: string): Promise<ProcedureSaveStepResult> {
      if (step.kind === "NODE_FIELDS") {
        const draft = nodeDrafts.get(step.nodeId) ?? nodeFieldDraft(step.nodeId);
        const result = await updateProcedureTemplateNodeAction({
          nodeId: step.nodeId,
          patch: {
            title: draft.title,
            description: draft.description.trim() || null,
            instructions: draft.instructions.trim() || null,
            // 🔴 **막 생긴 노드에는 정렬 번호를 안 보낸다**(2026-11-20, 조각 4).
            //    서버가 만들 때 「맨 뒤 + 1」을 매겼는데, 화면의 초안은 서버 스냅숏이
            //    없을 때 `sortOrder: 0` 으로 받침을 세운다. 그 0 을 그대로 보내면
            //    **방금 매긴 번호를 0 으로 덮어쓴다**(조각 2 가 경고한 자리).
            //    🔵 짐작한 값을 보내는 길도 있었지만 안 골랐다 — 서버가 재는 시점
            //       (구조 단계 맨 앞)과 화면이 재는 시점(사람이 누른 그때)이 달라
            //       같은 저장에서 노드를 지웠다 만들면 어긋난다. 틀린 값을 보내느니
            //       안 보내고 서버 값을 그대로 두는 쪽이 언제나 맞다.
            //    🔵 속성 패널은 이 노드의 정렬 칸을 잠그고 까닭을 적는다
            //       (NodePropertyPanel 의 isUnsavedNode) — 못 보내는 칸을 고칠 수
            //       있게 두면 사람이 고친 값이 조용히 사라진다.
            ...(brandNewNodeIdSet.has(step.nodeId) ? {} : { sortOrder: draft.sortOrder }),
            isActive: draft.isActive,
            // 🔵 이웃 글자 칸처럼 `|| null` 로 떨어뜨리지 않는다 — 이 값은 이미
            //    id 아니면 null 이고, 빈 글자가 섞일 자리가 없다.
            nextProcedureTemplateId: draft.nextProcedureTemplateId,
            // 🔴 **다듬지 않는다**(2026-11-25) — 공유폴더의 이름은 앞뒤 공백까지 그
            //    이름이다(다듬으면 없는 파일이 된다). 빈 글자로 떨어뜨리는 `|| null`
            //    도 두지 않는다: 이 칸은 `""` 를 아예 들지 않고, null 이 곧
            //    「가리킴 지우기」다.
            shareDocRelativePath: draft.shareDocRelativePath,
          },
          expectedTemplateUpdatedAt: expectedUpdatedAt,
        });
        return result.ok ? { ok: true, updatedAt: result.updatedAt } : { ok: false, message: result.message };
      }
      if (step.kind === "EDGE_FIELDS") {
        const draft = edgeDrafts.get(step.edgeId) ?? edgeFieldDraft(step.edgeId);
        const note = (edgeNotes.get(step.edgeId) ?? "").trim() || null;
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
        const pos = layoutMoves.get(nodeId)!;
        return { nodeId, x: pos.x, y: pos.y };
      });
      const edgeRoutes: EdgeRouteInput[] = step.edgeIds.map((edgeId) => ({ edgeId, points: routeMoves.has(edgeId) ? (routeMoves.get(edgeId) ?? null) : null }));
      const result = await saveProcedureTemplateLayoutAction({ templateId: template.id, positions, edgeRoutes, expectedTemplateUpdatedAt: expectedUpdatedAt });
      return result.ok ? { ok: true, updatedAt: result.updatedAt } : { ok: false, message: result.message };
    }

    const outcome = await runProcedureSaveSequence(steps, tokenAfterStructural, executeStep);

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
        // 🔵 지도는 **옮긴 뒤의 지역 변수**를 읽는다 — state 는 아직 옛 키를 들고 있다.
        for (const id of flushedNodeFieldIds) {
          const draft = nodeDrafts.get(id);
          if (draft) next.set(id, draft);
        }
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
        for (const id of flushedEdgeFieldIds) {
          const draft = edgeDrafts.get(id);
          if (draft) next.set(id, draft);
        }
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
          const pos = layoutMoves.get(id);
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
        for (const id of flushedRouteEdgeIds) next.set(id, routeMoves.has(id) ? (routeMoves.get(id) ?? null) : null);
        return next;
      });
      setPendingEdgeRouteMoves((prev) => {
        const next = new Map(prev);
        for (const id of flushedRouteEdgeIds) next.delete(id);
        return next;
      });
    }

    setCurrentUpdatedAt(outcome.finalUpdatedAt);
    // 🔴 **더 나중 것이 이긴다.** 구조 단계와 칸 값 단계가 둘 다 검증 요약을
    //    돌려주는데, 칸 값 단계(EDGE_FIELDS)가 **뒤**라 그쪽이 더 새 사진이다.
    //    차례를 뒤집으면 저장이 끝난 화면에 구조 단계 중간의 낡은 요약이 선다.
    if (structuralValidationFromStructuralPhase) setLastStructuralValidation(structuralValidationFromStructuralPhase);
    if (capturedStructuralValidation) setLastStructuralValidation(capturedStructuralValidation);

    if (outcome.failedAtStep) {
      // PARTIAL FAILURE: retain failed/unrun drafts (never touched above),
      // rebase the concurrency token, but do NOT refresh — a refresh here
      // would fetch a server state that doesn't yet include enough of this
      // save to be safely reconciled against the drafts that are still
      // pending, and none of that reconciliation is needed anyway: the
      // justSaved shadows already make the canvas correct without it.
      //
      // 🔴 2026-11-20(조각 4) — 다만 **되돌리기 스택은 손본다.** 여기 닿았다는 것은
      //    구조 단계가 **전부 성공**했다는 뜻이고(안 그러면 위에서 돌아갔다), 그러면
      //    그보다 앞에 쌓인 스냅샷은 전부 거짓이다 — 「아직 보낼 것」이라고 말하는데
      //    이미 보냈고 임시 번호는 진짜 id 가 됐다. 그대로 되돌려 다시 저장하면 같은
      //    노드가 두 번 만들어진다.
      setPendingUndoStack((prev) => planUndoStackAfterStructuralSave(prev, { succeededOperations: succeededStructuralOperations }));
      if (succeededStructuralOperations.length > 0) lastFieldEditKeyRef.current = null;
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
    //
    // 🔴 2026-11-20(조각 4) — 비우는 **대신** planUndoStackAfterStructuralSave 에
    //    빈 스택을 넣어 부른다. 그냥 비우기만 하면 이번 저장이 보낸 구조 변경이
    //    [이전]으로 되돌아갈 차례를 못 받는다: 그 갈래는 serverHasHistory 를 믿는데
    //    그 값은 **서버에서 그려 온** 것이라 방금 적힌 것이 아직 안 비쳐 있다
    //    (router.refresh() 가 닿기 전이다). 보낸 건수만큼 표시를 세워 그 틈을 없앤다.
    //    🔵 구조 변경이 0건이면 빈 스택이 그대로 나와 전 동작과 똑같다.
    setPendingUndoStack(planUndoStackAfterStructuralSave(createProcedureEditorUndoStack<PendingSnapshot>(), { succeededOperations: succeededStructuralOperations }));
    lastFieldEditKeyRef.current = null;
    router.refresh();
  }

  /**
   * 모아 둔 구조 조작 **한 건**을 실제로 서버로 보낸다 — 일곱 갈래가 전부 여기서
   * 갈린다. 🔴 **부르는 액션은 전부 전부터 있던 것 그대로**다(이 조각은 서버를 한
   * 글자도 안 바꿨다). 바뀐 것은 **부르는 시점**뿐이다.
   *
   * 🔴 넘어오는 operation 은 **치환이 끝난 모습**이다 — 임시 id 를 여기서 다시
   * 들여다볼 필요가 없다(들여다보면 안 된다. 그때쯤이면 이미 진짜 id 다).
   *
   * 🔴 돌려주는 칸에서 `nodeId`·`edgeId`·`secondEdgeId` 를 빠뜨리면 뒤 걸음이
   * 임시 id 를 든 채 나간다. 타입은 전부 선택 칸이라 아무 말도 안 하고, 대신
   * 보내기 직전 관문(findUnresolvedTempIds)이 운다. 특히 **삽입은 둘**이다.
   */
  async function executeStructuralOperation(
    operation: PendingStructuralOperation,
    expectedUpdatedAt: string
  ): Promise<ProcedureStructuralStepResult<StructuralValidationSummary>> {
    switch (operation.kind) {
      case "CREATE_NODE": {
        const result = await createProcedureTemplateNodeAction({
          templateId: template.id,
          nodeType: operation.nodeType,
          title: operation.title,
          position: operation.position,
          expectedTemplateUpdatedAt: expectedUpdatedAt,
        });
        return result.ok ? { ok: true, updatedAt: result.updatedAt, nodeId: result.nodeId } : { ok: false, message: result.message };
      }
      case "DELETE_NODE": {
        const result = await deleteProcedureTemplateNodeAction({
          nodeId: operation.nodeId,
          reason: operation.reason,
          expectedTemplateUpdatedAt: expectedUpdatedAt,
        });
        return result.ok ? { ok: true, updatedAt: result.updatedAt } : { ok: false, message: result.message };
      }
      case "CHANGE_NODE_TYPE": {
        const result = await changeProcedureTemplateNodeTypeAction({
          nodeId: operation.nodeId,
          newNodeType: operation.newNodeType,
          reason: operation.reason,
          expectedTemplateUpdatedAt: expectedUpdatedAt,
        });
        return result.ok
          ? { ok: true, updatedAt: result.updatedAt, structuralValidation: result.structuralValidation }
          : { ok: false, message: result.message };
      }
      case "CREATE_EDGE": {
        const result = await createProcedureTemplateEdgeAction({
          templateId: template.id,
          fromNodeId: operation.fromNodeId,
          toNodeId: operation.toNodeId,
          branchType: operation.branchType,
          branchLabel: operation.branchLabel,
          reason: operation.reason,
          expectedTemplateUpdatedAt: expectedUpdatedAt,
        });
        return result.ok
          ? { ok: true, updatedAt: result.updatedAt, edgeId: result.edgeId, structuralValidation: result.structuralValidation }
          : { ok: false, message: result.message };
      }
      case "DELETE_EDGE": {
        const result = await deleteProcedureTemplateEdgeAction({
          edgeId: operation.edgeId,
          reason: operation.reason,
          expectedTemplateUpdatedAt: expectedUpdatedAt,
        });
        return result.ok ? { ok: true, updatedAt: result.updatedAt } : { ok: false, message: result.message };
      }
      case "RETARGET_EDGE": {
        const result = await retargetProcedureTemplateEdgeAction({
          edgeId: operation.edgeId,
          newFromNodeId: operation.newFromNodeId,
          newToNodeId: operation.newToNodeId,
          reason: operation.reason,
          expectedTemplateUpdatedAt: expectedUpdatedAt,
        });
        return result.ok
          ? { ok: true, updatedAt: result.updatedAt, structuralValidation: result.structuralValidation }
          : { ok: false, message: result.message };
      }
      case "INSERT_NODE_ON_EDGE": {
        const result = await insertProcedureTemplateNodeOnEdgeAction({
          edgeId: operation.edgeId,
          nodeType: operation.nodeType,
          title: operation.title,
          position: operation.position,
          expectedTemplateUpdatedAt: expectedUpdatedAt,
        });
        // 🔴 **둘**이다 — 새 노드와 둘째 연결선. firstEdgeId 는 넘긴 edgeId 그
        //    자체(이미 진짜 id)라 받지 않는다.
        return result.ok
          ? { ok: true, updatedAt: result.updatedAt, nodeId: result.nodeId, secondEdgeId: result.secondEdgeId }
          : { ok: false, message: result.message };
      }
    }
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
    // 🔴 2026-11-20(조각 4) — **구조 목록도 함께 비운다.** 안 비우면 취소한 뒤에도
    //    노드 추가가 살아남아 다음 [저장]에 조용히 따라간다. 🔴 그리고 이것이
    //    **부분 실패로 남은 조작을 치우는 유일한 길**이다 — 못 보낸 조작은
    //    되돌리기 스택에 제 칸이 없다(planUndoStackAfterStructuralSave 의 ㄷ절).
    setPendingStructuralOperations([]);
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
    /*
     * 🔴 **연결선을 고르면 노드 선택을 푼다**(2026-11-21 쓰는 분 요청: 「노드를
     *    선택했다가 바로 연결선을 클릭하면 연결선이 바로 선택되도록」).
     *
     * 전에는 이 줄이 없어 **노드 선택이 남아 있었다.** 오른쪽 패널은 노드가 고려돼
     * 있으면 노드 패널을 세우므로(`selectedNode ? … : !selectedNode && selectedEdge ? …`),
     * 선을 눌러도 화면은 **노드 패널 그대로**였다 — 「선을 골랐는데 왜 노드가 보이지」.
     * 🔴 2026-11-21 에 [Delete] 키를 더하면서 그것이 **지워지는 결함**이 됐다: 선을
     *    누르고 [Delete] 를 치면 **아까 고른 노드가 지워졌다.** 키는 패널과 같은 차례를
     *    따르므로(노드가 먼저) 키 쪽이 틀린 것이 아니라 **선택이 안 풀리는 쪽**이 틀렸다.
     * 🔵 반대 방향(노드를 고르면 선 선택을 푼다)은 **전부터 있었다** — `ProcedureFlowGraph`
     *    의 노드 클릭이 그렇게 한다. 이 한 줄로 두 방향이 같아진다.
     * 🔵 「연결선 대상 고르기」·「참고 노드 고르기」는 **위에서 이미 껐다** — 그 모드들은
     *    노드를 누르기를 기다리는 것이라, 여기서 노드 선택을 푸는 것과 부딪히지 않는다.
     */
    if (edgeId !== null) setSelectedNodeId(null);
    setSelectedEdgeId(edgeId);
    if (edgeId) setRightPanelTab("properties");
  }, []);
  /**
   * 5C-6D-1D — the ONE place both a canvas drag-stop and NodePropertyPanel's
   * "상대 위치로 이동" buttons funnel through, mirroring
   * CaseFlowchartEditorScreen's own setPendingNodePosition. No mutation call
   * here; position is dirty/pending like every other field, only global
   * [저장] persists it.
   *
   * 🔵 2026-11-21 — **칸 여럿을 한 번에** 받도록 넓혔다(복수 선택 밑자락).
   * `pendingLayoutMoves` 는 원래 Map 이라 칸이 몇이든 [저장] 때 함께 나간다 —
   * 저장 쪽은 손댈 것이 없었다. 칸 하나짜리 `setPendingPosition` 은 **이것을
   * 부르는 얇은 껍질**로 남겨 둔다: 패널의 「상대 위치로 이동」·「연결선 곧게
   * 펴기」가 그 이름으로 부르고 있고, 그 자리들은 늘 칸 하나다.
   */
  // pushPendingUndoStep는 useCallback([])으로 신원이 고정돼 있어 의존성에 넣어도
  // 이 콜백의 신원이 흔들리지 않는다(그래프 선택 동기화 effect 참고).
  const setPendingPositions = useCallback((moves: readonly ProcedureNodeDragMove[]) => {
    if (moves.length === 0) return;
    // 드래그는 시작할 때 이미 한 단계를 찍었다 — 프레임마다 또 찍지 않는다.
    // 버튼(상대 위치로 이동)으로 온 호출은 여기서 한 단계가 된다.
    // 🔴 **칸이 몇이든 여기서 한 번**이다 — 칸마다 이 함수를 부르는 꼴로
    //    고치면 [이전]이 칸 수만큼 쌓여 한 번 눌러서는 안 돌아온다.
    if (!isNodeDraggingRef.current) pushPendingUndoStep();
    setPendingLayoutMoves((prev) => {
      const next = new Map(prev);
      for (const move of moves) next.set(move.nodeId, move.position);
      return next;
    });
  }, [pushPendingUndoStep]);
  const setPendingPosition = useCallback(
    (nodeId: string, position: Position) => setPendingPositions([{ nodeId, position }]),
    [setPendingPositions]
  );

  /** 드래그 한 번이 되돌리기 한 단계다 — 시작할 때 직전 상태를 찍고, 끝날 때까지 더 찍지 않는다. */
  const handleNodeDragStart = useCallback(() => {
    pushPendingUndoStep();
    isNodeDraggingRef.current = true;
  }, [pushPendingUndoStep]);

  /**
   * 🔴 **놓은 칸 전부**를 받아 한 번에 적는다(2026-11-21). 앞의 `nodeId`/
   * `position` 은 끄는 칸 하나일 뿐이라, 그것만 쓰면 여러 칸을 함께 끌었을 때
   * **하나만 저장된다** — 화면은 전부 움직여 놓고 [저장]을 누르면 하나만
   * 옮겨져 있는, 오류가 안 나는 결함이다.
   * 🔵 오늘은 선택이 늘 하나뿐이라 `moves` 의 길이가 1 이고, 그 한 칸이 곧
   *    `nodeId` 다 — 그래서 지금 동작은 전과 똑같다.
   */
  const handleNodeDragStop = useCallback(
    (_nodeId: string, _position: Position, moves: readonly ProcedureNodeDragMove[]) => {
      setPendingPositions(moves);
      isNodeDraggingRef.current = false;
    },
    [setPendingPositions]
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
   * 🔴 2026-11-05 — **자리의 출처를 바꿨다.** 여기에는 「workingLayoutPositions
   * (server baseline + pendingLayoutMoves merged — the CURRENT visible
   * position)」이라고 적혀 있었는데 **사실이 아니었다.** 그 지도는
   * `resolveEffectiveNodePosition(n, "USER")` 로 만들어진다 — 저장된 자리가
   * 없는 노드에서는 「만든 차례대로 쌓은 숫자」(x 가 전부 0)이고, 기술 작업
   * 절차에서는 그것이 **기본**이다(그런 노드를 그림은 자동 배치로 그린다).
   * 그래서 곧게 펴기가 화면에 안 보이는 좌표로 노드를 보냈다. 지금은
   * resolveCurrentPosition — 그림이 올려보낸 **화면 자리**를 쓴다(아래 그 함수의
   * 주석에 차례 셋과 받침). 크기 쪽(resolveNodeDimensions: 측정값 우선, 추정값
   * 받침)은 1D 그대로다. No no-op
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
      // 🔴 2026-11-20(조각 4) — 찾는 곳이 `template.edges` 에서 **renderedEdges** 로
      //    바뀌었다. 저장 전에 그은 선은 서버 목록에 없어서, 그대로 두면 그 선만
      //    두 번 눌러도 아무 일이 안 일어난다(옆의 [연결 정렬] 단추도 같다).
      const edge = renderedEdges.find((e) => e.id === edgeId);
      if (!edge) return;
      const sourceNode = renderedNodes.find((n) => n.id === edge.fromNodeId);
      const targetNode = renderedNodes.find((n) => n.id === edge.toNodeId);
      const sourcePos = resolveCurrentPosition(edge.fromNodeId);
      const targetPos = resolveCurrentPosition(edge.toNodeId);
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
    [renderedEdges, renderedNodes, resolveCurrentPosition, pendingEdgeRouteMoves, savedEdgeRoutes, setPendingPosition, resolveNodeDimensions]
  );

  /**
   * 🔴 **고른 노드들 사이의 선을 펼 차례** — 단추를 누르기 전에 미리 센다
   * (2026-11-22, 조각 D1).
   *
   * 🔴 **하나로 둔 것이 핵심이다.** 아래 손잡이가 실제로 펴는 목록과, 그림이
   * 단추를 흐리게 할지 정할 때 세는 수가 **같은 배열**이어야 한다. 둘로 나누면
   * 「단추는 살아 있는데 눌러도 아무 일이 없는」(또는 그 반대의) 화면이 생기고,
   * 그 어긋남은 오류가 안 나서 눌러 봐야만 드러난다.
   *
   * 🔵 **[범위 선택] 모드인지는 여기서 안 본다.** 모드 관문은 단추를 세우는
   * 그림 쪽에 있고(boxSelectActive && 고른 칸 ≥ 2), 모드를 벗어나면 고른 집합이
   * 비워지므로 이 목록도 저절로 빈다.
   */
  const boxSelectionStraightenPlan = useMemo(
    () => planStraightenEdgeOrder(renderedEdges, boxSelectedNodeIds),
    [renderedEdges, boxSelectedNodeIds]
  );

  /**
   * ==========================================================================
   * 🔴 [연결 정렬] — **고른 노드들 사이의 연결선을 한 번에 곧게** (2026-11-22, 조각 D1)
   * ==========================================================================
   * 쓰는 분 요청(2026-11-21): 「[범위 선택]으로 여러 노드를 선택한 상태에서 연결선
   * 정렬을 할 수 있도록 하자.」 뜻은 2026-11-22 에 **「고른 것끼리의 선을 곧게」**로
   * 정해졌다 — `A→B` 와 `B→C` 를 둘 다 고르면 둘 다 펴져 한 줄이 되고, `A→D` 처럼
   * **한쪽만 고른 선은 그대로 둔다**(움직이는 것은 고른 노드뿐이다).
   *
   * 🔴 **위 handleEdgeDoubleClick 과 출처가 글자 그대로 같다** — 선은
   * `renderedEdges`, 노드는 `renderedNodes`, 자리는 `resolveCurrentPosition`
   * (그림이 올려보낸 **화면 자리**), 크기는 `resolveNodeDimensions`(측정값 우선).
   * 2026-11-05 에 곧게 펴기가 다른 지도(workingLayoutPositions)를 읽다가 노드를
   * **화면 밖으로** 보낸 적이 있고, 그 경위가 저 위 주석에 적혀 있다. 하나라도
   * 갈리면 「단추로 한 번씩 누른 것」과 이 단추의 결과가 달라진다.
   *
   * 🔴 **앞의 결과를 보고 다음을 잰다.** 선마다 **그 순간의** 시작·도착 자리를
   * 읽어야 사슬이 한 줄이 된다 — `movedPositions` 가 이번 고리 안에서 옮겨 놓은
   * 자리를 들고 있고, 자리를 읽을 때 **그것을 먼저** 본다. 전부를 처음 자리
   * 기준으로 한꺼번에 계산하면 C 가 **옛 자리의 B** 에 맞은 뒤 B 가 움직여, 눈으로
   * 보면 가운데가 꺾인 채 남는다(straighten-selection.test.ts ③절이 좌표로 잰다).
   * 🔵 `setPendingPositions` 의 결과를 되읽지 않는 까닭도 같다 — setState 는 이
   * 고리가 끝나야 반영되므로 중간에 읽을 수 있는 자리가 아니다.
   *
   * 🔴 **되돌리기는 한 칸이다.** 적용을 다 모아 `setPendingPositions` 를 **한 번**
   * 부른다 — 그 함수가 제 안에서 「드래그 중이 아니면 한 단계를 찍는」 규약을
   * 이미 갖고 있고(그 자리 주석), 선마다 부르면 [이전]이 선 수만큼 쌓여 한 번
   * 눌러서는 안 돌아온다.
   *
   * 🔴 **펼 선이 하나도 없으면 아무 일도 안 한다** — 되돌리기 칸도 안 찍는다.
   * 아무것도 안 바뀐 칸이 쌓이면 [이전]이 한 번 헛돈다(사람 눈에는 단추가 안
   * 먹은 것으로 보인다). 그림 쪽 단추도 같은 수로 흐려진다.
   *
   * 🔵 **수동 경로점은 단수와 똑같이** 자동으로 되돌린다. 안 그러면 선을 곧게
   * 폈는데 옛 꺾임이 그대로 남아, 「단추로 한 번씩 누른 것」과 결과가 갈린다.
   * 묶어서 한 번에 `setPendingEdgeRouteMoves` 를 부르는 것도 위와 같은 까닭이다.
   */
  const handleStraightenBoxSelection = useCallback(() => {
    if (boxSelectionStraightenPlan.length === 0) return;

    const movedPositions = new Map<string, Position>();
    const moves: ProcedureNodeDragMove[] = [];
    const routeResetEdgeIds: string[] = [];

    for (const edge of boxSelectionStraightenPlan) {
      const sourceNode = renderedNodes.find((n) => n.id === edge.fromNodeId);
      const targetNode = renderedNodes.find((n) => n.id === edge.toNodeId);
      // 🔴 옮겨 놓은 자리가 있으면 **그것이 먼저**다(위 「앞의 결과를 보고」).
      const sourcePos = movedPositions.get(edge.fromNodeId) ?? resolveCurrentPosition(edge.fromNodeId);
      const targetPos = movedPositions.get(edge.toNodeId) ?? resolveCurrentPosition(edge.toNodeId);
      if (!sourceNode || !targetNode || !sourcePos || !targetPos) continue;

      const sourceDims = resolveNodeDimensions(sourceNode);
      const targetDims = resolveNodeDimensions(targetNode);
      const straightened = computeStraightenedConnectedNodePosition(
        { x: sourcePos.x, y: sourcePos.y, width: sourceDims.width, height: sourceDims.height },
        { x: targetPos.x, y: targetPos.y, width: targetDims.width, height: targetDims.height }
      );
      movedPositions.set(targetNode.id, straightened.position);
      moves.push({ nodeId: targetNode.id, position: straightened.position });

      if (currentWorkingRoutePoints(pendingEdgeRouteMoves, edge.id).length > 0) routeResetEdgeIds.push(edge.id);
    }

    // 🔵 계획에 선이 있었는데 적용이 하나도 안 된 경우(그 사이 칸이 사라졌을 때)도
    //    되돌리기 칸을 안 찍는다 — 위 「아무 일도 안 한다」와 같은 까닭이다.
    if (moves.length === 0) return;
    setPendingPositions(moves);

    if (routeResetEdgeIds.length > 0) {
      setPendingEdgeRouteMoves((prev) => {
        const next = new Map(prev);
        for (const edgeId of routeResetEdgeIds) next.set(edgeId, null);
        return next;
      });
    }
  }, [
    boxSelectionStraightenPlan,
    renderedNodes,
    resolveCurrentPosition,
    pendingEdgeRouteMoves,
    savedEdgeRoutes,
    setPendingPositions,
    resolveNodeDimensions,
  ]);

  /**
   * "경로점 추가" — the primary insertion method, no click position
   * required: inserts at the midpoint of the selected edge's longest
   * current segment. Forces USER (사용자 배치) mode — the newly-added point
   * is otherwise invisible/unclickable (see this file's own layoutMode
   * doc comment), silently blocking the very next step the side panel
   * asks for ("선택된 경로점 위치에 새 노드를 삽입").
   *
   * 🔴 양 끝의 자리는 **곧게 펴기와 같은 출처**다(resolveCurrentPosition —
   * 그림이 올려보낸 화면 자리). 둘의 출처가 갈리면 안 되는 까닭은, 둘 다
   * 「화면에 보이는 그 선」을 기준으로 삼는 조작이기 때문이다: 여기서 꽂는
   * 점은 **그 선의 중점**인데(addWaypointAtDefaultPosition), 끝점이 저장된
   * 자리면 자동 배치로 그려지는 절차에서 보이는 선을 한참 벗어난 곳에 점이
   * 생긴다. 2026-11-05 까지 여기만 workingLayoutPositions 를 읽고 있었다 —
   * 곧게 펴기와 **같은 종류의 결함**이었고, 거기를 고치면서 함께 고쳤다.
   */
  const handleAddWaypoint = useCallback(() => {
    if (!selectedEdgeId) return;
    pushPendingUndoStep();
    // 🔴 곧게 펴기와 같은 까닭으로 renderedEdges 를 본다(2026-11-20, 조각 4).
    const edge = renderedEdges.find((e) => e.id === selectedEdgeId);
    const source = edge ? resolveCurrentPosition(edge.fromNodeId) : undefined;
    const target = edge ? resolveCurrentPosition(edge.toNodeId) : undefined;
    if (!edge || !source || !target) return;
    setLayoutMode("USER");
    setPendingEdgeRouteMoves((prev) => {
      const next = new Map(prev);
      next.set(selectedEdgeId, addWaypointAtDefaultPosition(currentWorkingRoutePoints(prev, selectedEdgeId), source, target));
      return next;
    });
  }, [selectedEdgeId, renderedEdges, resolveCurrentPosition, savedEdgeRoutes, pushPendingUndoStep]);

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

  // 🔵 **키로 지우는 통로는 이 아래 한 곳으로 모였다**(2026-11-21). 전에는 여기
  //    (경로점 전용 keydown)에 있었는데, 노드·연결선까지 받게 되면서 「못 지우는
  //    까닭」(selectedNodeDeleteBlockedReason)을 읽어야 해 그 계산 아래로 내려갔다.
  //    🔴 등록은 여전히 **하나**다 — 둘로 나누면 한 번 누른 키에 둘이 반응한다.

  const selectedNode = selectedNodeId ? renderedNodes.find((n) => n.id === selectedNodeId) ?? null : null;
  const selectedEdge = selectedEdgeId ? renderedEdges.find((e) => e.id === selectedEdgeId) ?? null : null;

  /** 5C-6D-1E — same gate ProcedureFlowGraph's own double-click handler already applies before requesting a straighten (editable + 사용자 배치 only); the explicit "연결 정렬" button in EdgePropertyPanel must never offer an action the canvas gesture itself wouldn't currently allow. */
  const canStraighten = canEdit && layoutMode === "USER";

  /**
   * 🔴 **지금 지울 수 없는 까닭**(2026-11-20, 조각 4). 서버가 거절할 것을 앞당겨
   * 보여 준다 — 새로 막는 것이 아니라, 모아 두느라 **거절이 [저장] 때로 밀린** 것을
   * 화면이 대신 말해 주는 것이다.
   *
   * ── 🔴 2026-11-21 — **까닭이 둘에서 하나로 줄었다** ──────────────────────
   * 쓰는 분의 결정: 「노드를 지우면 연결된 연결선도 함께 지워지는 걸로 하자 —
   * 연결선을 지우지 않아도 노드를 지울 수 있도록.」 그래서 막던 글
   * 「연결선 N개가 붙어 있어 삭제할 수 없습니다」가 **없어졌다.** 선이 붙어 있어도
   * 지울 수 있고, handleQueueDeleteNode 가 그 선들의 삭제를 같은 묶음에 함께 쌓는다.
   *
   * 🔴 **서버 규칙이 없어진 것이 아니다** — 서버는 여전히 선이 붙은 노드를
   * NODE_HAS_CONNECTED_EDGES 로 거절한다. 보낼 차례가 DELETE_EDGE(3단계) →
   * DELETE_NODE(6단계) 라서 서버가 받을 때는 이미 선이 없을 뿐이다.
   *
   * 🔵 **남은 까닭 하나**: 체크리스트 · 고장 진단표 내용이 걸린 노드
   * (NODE_HAS_DEPENDENT_CONTENT). 이쪽은 함께 지울 수 있는 성질의 것이 아니다 —
   * 그 안에 사람이 쓴 점검 항목·진단 표가 들어 있고, 편집기에는 그것을 옮기거나
   * 지울 손잡이조차 없다. 그래서 그대로 막는다.
   *
   * ── 🔴 2026-11-21(조각 B3) — **셈이 순수 함수로 나갔다** ──────────────────
   * 조건도 글자도 한 글자 안 바뀌었고, 자리만 옮겼다. 까닭은 **묻는 자리가 둘이
   * 됐기 때문**이다 — [범위 선택]으로 고른 여럿을 [Delete] 로 지울 때 노드마다
   * 같은 질문을 해야 한다(바로 아래 boxSelectedDeleteCandidates). 규칙을 두 벌로
   * 적으면 **패널이 「지울 수 있다」고 말한 노드를 복수가 빼거나 그 반대**가 되고,
   * 그때 오류는 한 번도 안 난다.
   */
  const selectedNodeDeleteBlockedReason: string | null = resolveProcedureNodeDeleteBlockedReason(selectedNode);

  /**
   * 🔴 **이 노드를 지우면 함께 지워질 연결선의 수**(2026-11-21). 확인 창을 안
   * 띄우는 대신(지금 삭제도 안 띄운다 — [이전]으로 돌아온다) 누르기 **전에** 수가
   * 보이게 하려는 값이다. 패널이 삭제 단추 바로 위에 한 줄로 적는다.
   *
   * 🔴 지울 때 쓰는 것과 **같은 함수 · 같은 목록**이다(handleQueueDeleteNode 의
   * renderedEdges). 여기서 따로 세면 「3개도 함께 지워집니다」라고 적어 놓고 둘만
   * 지우는 일이 생기고, 그 어긋남은 저장이 끝난 뒤에야 드러난다.
   */
  const selectedNodeAttachedEdgeCount = selectedNode ? findEdgesAttachedToNode(renderedEdges, selectedNode.id).length : 0;

  /**
   * 🔴 **지금 [범위 선택] 도구로 그림을 보고 있는가**(2026-11-21, 조각 B3).
   * 그림 쪽의 `boxSelectActive`(= canUseBoxSelect && canvasTool === "BOX_SELECT",
   * 여기서 canUseBoxSelect 는 `editable && layoutMode === "USER"`)와 **같은 값**을
   * 이 화면이 제 손에 든 셋으로 다시 세운 것이다. 그림은 이 값으로 **칸에 테두리를
   * 실을지**를 정하고, 이 화면은 **[Delete] 가 고른 집합을 볼지**를 정한다.
   *
   * 🔴 둘이 갈리면 「테두리는 보이는데 키로는 안 지워진다」(또는 그 반대로
   * **보이지도 않는 것이 지워진다**)가 되고 오류는 안 난다. 그래서 아래 시험이
   * 두 줄을 함께 못 박아 둔다(procedure-multi-node-delete-ui.test.ts ②절).
   * 🔵 편집기에서 배치는 「사용자 배치」 하나뿐이지만(EDITOR_LAYOUT_MODES) 그래도
   *    적는다 — 그 목록이 늘어나는 날 조용히 어긋나는 쪽이 되면 안 된다.
   */
  const boxSelectActive = canEdit && layoutMode === "USER" && canvasTool === "BOX_SELECT";
  /**
   * 🔴 [Delete] 에 넘길 **고른 칸들과 각자의 「못 지우는 까닭」**.
   *
   * 🔴 **그림에 그려진 목록(renderedNodes)을 돌며** 고른 것만 추린다 — 집합을
   * 돌며 노드를 찾지 않는다. 까닭 둘: ① 그 사이에 사라진 칸의 id 가 집합에 남아
   * 있어도 **없는 행을 지우는 조작이 안 쌓인다**(단수 쪽이 selectedNode?.id 로
   * 같은 것을 지킨다), ② 차례가 **그림이 그린 차례**가 되어 사람이 본 것과 같다.
   * 🔴 까닭은 단추를 흐리게 하는 **그 함수 그대로**다(바로 위 한 벌과 같은 것).
   */
  const boxSelectedDeleteCandidates = useMemo(
    () =>
      renderedNodes
        .filter((n) => boxSelectedNodeIds.has(n.id))
        .map((n) => ({ id: n.id, deleteBlockedReason: resolveProcedureNodeDeleteBlockedReason(n) })),
    [renderedNodes, boxSelectedNodeIds]
  );

  /**
   * ==========================================================================
   * 🔴 [Delete] 키로 지우기 (2026-11-21)
   * ==========================================================================
   * 쓰는 분의 요청: 「노드나 연결선을 지울 때 [DELETE] 키를 눌러서 지울 수 있도록
   * 해 달라.」
   *
   * 🔴 **무엇을 지울지 여기서 판정하지 않는다** — planProcedureDeleteKey 하나가
   * 답한다. 차례(경로점 → 복수 노드 → 노드 → 연결선) · 글자 칸 보호 · Backspace
   * 결정 · 막힌 노드에서 안 흘러내리는 규칙까지 전부 그 파일에 까닭과 함께 있고,
   * 값으로 재어진다(이 화면은 .css 와 server-only 를 물고 있어 import 자체가 던진다).
   *
   * 🔴 2026-11-21(조각 B3) — **[범위 선택]으로 고른 여럿**이 한 가지 더 붙었다.
   * 막힌 노드가 섞여 있으면 **그것만 빼고 나머지를 지운다**(쓰는 분 결정) — 「하나라도
   * 막히면 전부 안 함」은 **아무 일도 안 일어나는 것과 구별이 안 돼서**(이 키 경로는
   * 조용하다) 사람이 기능이 고장 난 줄 안다. 못 지운 칸은 골라진 채 남아 테두리로
   * 제 자리를 말한다.
   *
   * 🔴 넘기는 값은 **단추에 넘기는 그 값 그대로**다. nodeDeleteBlockedReason 은
   * [노드 삭제] 단추를 흐리게 하는 selectedNodeDeleteBlockedReason 이고, 권한은
   * 삭제 칸을 세우는 canDeleteGraph 다. 하나라도 다시 계산하면 「단추는 흐린데
   * 키로는 지워지는」 화면이 생긴다.
   *
   * 🔴 id 는 **그림에 실제로 그려진 것**(selectedNode/selectedEdge)에서 뽑는다.
   * 고른 id 가 미리보기에서 사라진 상태(예: 막 만든 노드를 [이전]으로 되돌린 뒤)
   * 에서는 속성 패널도 안 서 있는데, 그때 state 의 id 로 삭제를 쌓으면 없는 행을
   * 지우려 드는 조작이 목록에 남는다.
   *
   * 🔵 확인 창은 안 띄운다 — 지금 삭제 **단추**도 안 띄운다. 모아 두기라 [이전]
   * 한 번이면 돌아오고, 키만 다르게 굴면 안 된다.
   *
   * 🔵 사유는 null 로 간다. 사유 칸은 애초에 「선택」이다(패널의
   * `placeholder="삭제 사유 (선택)"` · `onQueueDelete(deleteReason.trim() || null)`).
   */
  /**
   * 🔴 지우기 셋의 **가장 최근 신원**. 셋은 useCallback 이 아니라 렌더마다 다시
   * 만들어지는 함수 선언이라, 아래 의존성 배열에 그대로 넣으면 keydown 등록·해제가
   * 렌더마다(드래그 중에는 프레임마다) 돈다. pendingSnapshotRef 가 같은 까닭으로
   * 쓰는 수법 그대로다.
   *
   * 🔵 셋 다 몸통이 setState 갱신 함수뿐이라 설령 옛 신원이 불려도 결과가 같다 —
   * 그래도 ref 로 맞춰 두는 것은 그 성질이 나중에 깨져도 여기가 안 틀리게 하려는 것이다.
   *
   * 🔴 2026-11-21(조각 B3) — **고른 집합도 여기 싣는다.** 그 목록은 렌더마다 새
   * 배열이고(윗줄의 useMemo 도 renderedNodes 가 바뀌면 신원이 바뀐다 — 칸 하나에
   * 글자를 칠 때마다 바뀐다), 의존성에 넣으면 **글자 한 자마다 keydown 등록이
   * 돈다.** ref 는 렌더마다 갱신되고 키는 눌린 **그 순간** 읽으므로 값은 언제나
   * 가장 최근 것이다.
   */
  const queueDeleteByKeyRef = useRef({
    node: handleQueueDeleteNode,
    edge: handleQueueDeleteEdge,
    nodes: handleQueueDeleteNodes,
    boxSelectActive,
    boxSelectedNodes: boxSelectedDeleteCandidates,
  });
  useEffect(() => {
    queueDeleteByKeyRef.current = {
      node: handleQueueDeleteNode,
      edge: handleQueueDeleteEdge,
      nodes: handleQueueDeleteNodes,
      boxSelectActive,
      boxSelectedNodes: boxSelectedDeleteCandidates,
    };
  });

  const deletableNodeId = selectedNode?.id ?? null;
  const deletableEdgeId = selectedEdge?.id ?? null;
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const plan = planProcedureDeleteKey({
        key: e.key,
        isTypingTarget: isTextEntryTarget(document.activeElement),
        canEdit,
        canDeleteGraph,
        selectedNodeId: deletableNodeId,
        selectedEdgeId: deletableEdgeId,
        selectedWaypointIndex,
        nodeDeleteBlockedReason: selectedNodeDeleteBlockedReason,
        // 🔴 이 둘만 ref 에서 읽는다 — 까닭은 바로 위 ref 주석에(의존성에 넣으면
        //    글자 한 자마다 등록이 돈다). 값은 렌더마다 갱신되므로 가장 최근 것이다.
        boxSelectActive: queueDeleteByKeyRef.current.boxSelectActive,
        boxSelectedNodes: queueDeleteByKeyRef.current.boxSelectedNodes,
      });
      // 🔴🔴 아무 일도 안 할 때는 **이벤트에 손도 안 댄다.** 글자 칸에서
      //    preventDefault 를 하면 [Delete] 가 글자를 안 지운다.
      if (plan.action === "NONE") return;
      e.preventDefault();
      if (plan.action === "REMOVE_WAYPOINT") {
        handleRemoveSelectedWaypoint();
        return;
      }
      if (plan.action === "DELETE_NODES") {
        queueDeleteByKeyRef.current.nodes(plan.nodeIds);
        return;
      }
      if (plan.action === "DELETE_NODE") {
        queueDeleteByKeyRef.current.node(plan.nodeId, null);
        return;
      }
      queueDeleteByKeyRef.current.edge(plan.edgeId, null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canEdit, canDeleteGraph, deletableNodeId, deletableEdgeId, selectedWaypointIndex, selectedNodeDeleteBlockedReason, handleRemoveSelectedWaypoint]);

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
              {/*
                🔴 2026-11-20(조각 4) — **막힌 구조 변경이 있으면 [저장]을 끈다**
                (canSendStructural). 보낼 수 있는 것만 골라 보내면 사람이 화면에서
                한 일 하나가 설명 없이 사라진다 — 그래서 한 건도 안 보낸다. 까닭은
                바로 아래 줄에서 조작마다 한 줄씩 적는다(흐린 단추만 두면 고장으로
                읽힌다).
              */}
              <button
                type="button"
                onClick={() => void handleGlobalSave()}
                disabled={!hasAnyPendingChanges || !canSendStructural || globalSaveStatus === "saving"}
                className="rounded-md bg-primary-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900"
              >
                {globalSaveStatus === "saving"
                  ? "저장 중..."
                  : !hasAnyPendingChanges
                    ? "저장할 변경 없음"
                    : !canSendStructural
                      ? "저장할 수 없는 변경 있음"
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
                🔴 **아무 일도 없을 때 서 있던 안내를 걷어냈다**(2026-11-21 쓰는 분 요청:
                「이 설명들은 삭제해줘」). 여기에는 차례로 두 글이 서 있었다 —
                2026-11-04 의 "노드·연결선 추가·삭제·재연결은 [저장] 없이 바로 저장됩니다"
                와, 2026-11-20 에 동작이 뒤집히며 그것을 뒤집은 "…도 [저장]을 눌러야
                저장됩니다".

                🔵 **걷어내도 되는 까닭**: 그 글은 「저장이 어떻게 도는지」를 **모르는
                   사람에게** 하던 말인데, 이제 동작이 사람이 바라던 그 모양이라 설명할
                   것이 없다. 그리고 **정작 필요한 때**(저장할 것이 있을 때)에는 바로 위
                   줄의 「변경사항 N건 저장 대기 중」이 선다 — 이 글은 `!hasAnyPendingChanges`
                   일 때, 즉 **아무것도 안 건드렸을 때만** 뜨던 것이다.
                🔴 **다시 세우지 마라.** 2026-11-04 에 한 번, 11-20 에 한 번 세웠고 두 번 다
                   쓰는 분이 지워 달라고 했다. 「모르실까 봐」로 또 세우면 세 번째다.
              */}
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
        🔴 2026-11-20(조각 4) — **보낼 수 없는 구조 변경**을 저장 전에 미리 보인다.
        위 [저장] 단추가 꺼져 있는 유일한 까닭이고, 조작마다 한 줄씩 「무엇이」와
        「무엇을 하면 되는지」를 적는다. 글은 화면에서 짓지 않고 도메인
        (describeStructuralConflicts)에서 받아 온다 — 두 곳에 적으면 어긋나는 날
        아무도 못 잡는다.
        🔵 패널의 빨간 글이 아니라 **여기** 서는 까닭: 막힌 조작이 지금 고른 노드·
        연결선과 다른 것일 수 있다(목록 어디에나 있을 수 있다).
      */}
      {canEdit && structuralConflictMessages.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs dark:border-red-900 dark:bg-red-950">
          <p className="font-medium text-red-800 dark:text-red-300">저장할 수 없는 구조 변경 {structuralConflictMessages.length}건이 있어 [저장]이 막혀 있습니다.</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-red-700 dark:text-red-400">
            {structuralConflictMessages.map((message, idx) => (
              <li key={idx}>· {message}</li>
            ))}
          </ul>
        </div>
      )}
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
            onRenderedPositionsChange={handleRenderedPositionsChange}
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
            canvasTool={canvasTool}
            onCanvasToolChange={setCanvasTool}
            boxSelectedNodeIds={boxSelectedNodeIds}
            onBoxSelectionChange={setBoxSelectedNodeIds}
            boxSelectionStraighten={{
              straightenableEdgeCount: boxSelectionStraightenPlan.length,
              onStraighten: handleStraightenBoxSelection,
            }}
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
              procedureTemplateId={template.id}
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
              draft={nodeFieldDraft(selectedNode.id)}
              onDraftChange={(patch) => updateNodeFieldDraft(selectedNode.id, patch)}
              onPositionDraftChange={(position) => setPendingPosition(selectedNode.id, position)}
              resolveNodeDimensions={resolveNodeDimensions}
              renderedPositions={renderedNodePositions}
              onQueueChangeType={(newNodeType, reason) => handleQueueChangeNodeType(selectedNode.id, newNodeType, reason)}
              nextProcedureCandidates={nextProcedureCandidates}
              canDelete={canDeleteGraph}
              deleteBlockedReason={selectedNodeDeleteBlockedReason}
              attachedEdgeCount={selectedNodeAttachedEdgeCount}
              onQueueDelete={(reason) => handleQueueDeleteNode(selectedNode.id, reason)}
              canPosition={canDeleteGraph}
              isTechnical={isTechnical}
              isUnsavedNode={unsavedNodeIds.has(selectedNode.id)}
            />
          )}
          {rightPanelTab === "properties" && !selectedNode && selectedEdge && (
            <EdgePropertyPanel
              edge={selectedEdge}
              nodes={renderedNodes}
              canEdit={canEdit}
              draft={edgeFieldDraft(selectedEdge.id)}
              onDraftChange={(patch) => updateEdgeFieldDraft(selectedEdge.id, patch)}
              note={edgeSaveNote(selectedEdge.id)}
              onNoteChange={(note) => updateEdgeSaveNote(selectedEdge.id, note)}
              onQueueRetarget={(newFromNodeId, newToNodeId, reason) => handleQueueRetargetEdge(selectedEdge.id, newFromNodeId, newToNodeId, reason)}
              routePoints={workingEdgeRoutes.get(selectedEdge.id) ?? null}
              selectedWaypointIndex={selectedWaypointIndex}
              onAddWaypoint={handleAddWaypoint}
              onRemoveSelectedWaypoint={handleRemoveSelectedWaypoint}
              onResetRoute={() => handleResetEdgeRoute(selectedEdge.id)}
              onStraighten={canStraighten ? () => handleEdgeDoubleClick(selectedEdge.id) : null}
              canDelete={canDeleteGraph}
              onQueueDelete={(reason) => handleQueueDeleteEdge(selectedEdge.id, reason)}
              canInsertNode={canDeleteGraph}
              // 🔴 아직 저장 안 된 연결선 위에는 못 끼운다 — 그 조작이 목록에 들어가면
              //    접기가 INSERT_ON_UNSAVED_EDGE 로 올려 [저장]이 통째로 막힌다.
              insertNodeBlockedReason={
                isTempEdgeId(selectedEdge.id) ? "이 연결선은 아직 저장 전이라 노드를 끼울 수 없습니다. 먼저 [저장]한 뒤에 해 주세요." : null
              }
              onQueueInsertNode={(input) => handleQueueInsertNodeOnEdge(selectedEdge.id, input)}
              isTechnical={isTechnical}
            />
          )}
          {rightPanelTab === "properties" && !selectedNode && !selectedEdge && <p className="text-xs text-zinc-400 dark:text-zinc-600">그래프에서 노드나 분기를 선택하세요.</p>}

          {rightPanelTab === "createEdge" && (
            <CreateEdgePanel
              nodes={renderedNodes}
              canEdit={canEdit}
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
              onQueueCreate={handleQueueCreateEdge}
              isTechnical={isTechnical}
            />
          )}

          {rightPanelTab === "addNode" && canDeleteGraph && (
            <CreateNodePanel
              onQueueCreate={handleQueueCreateNode}
              selectedNode={selectedNode}
              resolveNodeDimensions={resolveNodeDimensions}
              renderedPositions={renderedNodePositions}
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
