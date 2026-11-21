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
import {
  REPAIR_CASE_FLOWCHART_NODE_TYPE_CODES,
  type RepairCaseFlowchartBranchType,
  type RepairCaseFlowchartNodeType,
} from "@/lib/domain/repair-case-flowchart-types";
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
  deleteRepairCaseFlowchartNodeAction,
  deleteRepairCaseFlowchartEdgeAction,
  saveRepairCaseFlowchartLayoutAction,
  saveRepairCaseFlowchartEdgeRouteAction,
  updateRepairCaseFlowchartNodeAction,
  changeRepairCaseFlowchartNodeTypeAction,
  updateRepairCaseFlowchartEdgeAction,
  retargetRepairCaseFlowchartEdgeAction,
  insertRepairCaseFlowchartNodeOnEdgeAction,
} from "@/lib/server/actions/repair-case-flowchart-graph";
// ──────────────────────────────────────────────────────────────────────────
// 🔴 구조 변경을 **모아 두었다가 [저장] 때 보내는** 한 벌 (2026-11-21, 조각 C2)
// ──────────────────────────────────────────────────────────────────────────
// 🔵 이름이 `procedure-` 로 시작해도 **베끼지 않고 그대로 쓴다.** 위
// procedure-editor-delete-key 와 같은 까닭이다 — 이 다섯 모듈은 React·DOM·서버
// 액션·DB 를 한 줄도 안 물고, 입력이 전부 글자·수·`Position` 이라 절차 쪽
// 자료형을 끌고 오지 않는다. 한 벌 더 베끼면 두 잣대가 생기고 한쪽만 고치는
// 날이 온다(그 어긋남은 오류를 한 번도 안 낸다).
// 🔵 진단에서 **안 쓰는 조작 둘**(CHANGE_NODE_TYPE · RETARGET_EDGE)이 그 타입에
// 들어 있지만, 진단은 그 둘을 쌓지 않는다 — 노드 유형 변경과 연결선 재연결은
// 이 편집기에서 이미 초안 지도 + SaveStep 으로 잘 돌고 있고, 잘 도는 것을
// 옮기면 같은 일을 하는 길이 두 벌 생긴다(2026-11-21 결정).
import {
  appendPendingStructuralOperations,
  procedureStructuralOperationsSignature,
  type ProcedureTempIdMinter,
} from "@/lib/domain/procedure-editor-structural-undo";
import {
  canSendStructuralChanges,
  coalescePendingStructuralOperations,
  type PendingStructuralOperation,
} from "@/lib/domain/procedure-editor-structural-changes";
import {
  canProceedToFieldSave,
  collectStructuralIdEffects,
  includeBrandNewDraftEntries,
  includeBrandNewDraftIds,
  rebaseDraftMapAfterStructuralSave,
  runProcedureStructuralSequence,
  type ProcedureStructuralStepResult,
} from "@/lib/domain/procedure-editor-structural-save";
import {
  describeStructuralConflicts,
  previewPendingStructuralGraph,
  type StructuralPreviewFactories,
} from "@/lib/domain/procedure-editor-structural-preview";
// 🔴 2026-11-21(조각 C3) — 「노드를 지우면 붙은 연결선도 함께 지운다」가 진단에도 왔다.
// 그래서 **무엇을 쌓을지**는 절차와 **같은 한 벌**인 planProcedureNodeDeletionOperations
// 가 정한다(선 먼저 · 노드 나중이라는 차례까지 거기 있고 값으로 재어진다).
// 🔵 findEdgesAttachedToNode 는 **뒤처리에 쓸 id 를 얻는 데** 남는다 — 함께 지워지는
//    선들의 칸 초안·경로점을 버려야 해서다. 지울 줄을 정하는 데는 안 쓴다(두 벌이 된다).
import { findEdgesAttachedToNode, planProcedureNodeDeletionOperations } from "@/lib/domain/procedure-editor-node-deletion";
// [Delete] 키가 **무엇을 가리키는가**를 정하는 순수 판정 — 「기술 작업 절차」
// 편집기가 쓰는 그 파일 그대로다. 이름이 `procedure-` 로 시작해도 베끼지 않는
// 까닭은 아래 keydown 자리의 주석에 적어 두었다.
import { planProcedureDeleteKey, isTextEntryTarget } from "@/lib/domain/procedure-editor-delete-key";
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
 * ==========================================================================
 * 🔴 2026-11-21 (조각 C2) — **구조 변경도 [저장]을 눌러야 저장된다**
 * ==========================================================================
 * 바로 위 문단은 2026-11-21 까지의 모습이었다: 「노드·연결선의 만들기·지우기는
 * 누르는 즉시 서버로 간다」. 쓰는 분 요청으로 그 다섯(노드 추가·삭제 · 연결선
 * 추가·삭제 · 연결선 위 노드 끼우기)도 [저장] 쪽으로 옮겼다 — 「기술 작업 절차」
 * 편집기가 2026-11-20 에 먼저 그렇게 바뀌었고, 그때 만든 순수 모듈 다섯을
 * **베끼지 않고 그대로** 쓴다(위 import 주석).
 *
 *   SERVER BASELINE(nodes/edges)
 *     + 아직 안 보낸 **구조 변경 목록**(pendingStructuralOperations)
 *     = structuralPreview  ← previewPendingStructuralGraph
 *     + 초안 지도 넷
 *     = RENDERED GRAPH
 *
 * 🔴 **미리보기를 빼먹으면 화면에 아무 일도 안 일어난다.** [노드 추가]를 눌러도
 * 서버 목록에는 그 노드가 없으므로, 미리보기를 안 얹으면 단추만 눌리고 그림은
 * 그대로다. 아래 renderedNodes/renderedEdges 가 **structuralPreview** 를 도는
 * 것이 그 까닭이다(전에는 `nodes`/`edges` 를 돌았다).
 *
 * 🔵 **그대로 둔 것**(이미 [저장] 모델이다): 노드 칸 값 · 노드 유형 변경 · 노드
 * 자리 · 연결선 칸 값 · **연결선 재연결** · 경로점. 유형 변경과 재연결을 구조
 * 조작으로 옮기지 않는 것은 2026-11-21 결정이다 — 화면에서 보이는 동작이 이미
 * 같고, 잘 도는 것을 옮기면 같은 일을 하는 길이 두 벌 생긴다.
 *
 * 🔴 저장 차례는 **구조가 먼저, 칸 값이 나중**이다(procedure-editor-structural-
 * save.ts 머리말). 새 노드는 칸 값 단계가 가리킬 진짜 id 가 아직 없고, 그
 * 사라짐에는 **오류가 안 난다** — handleGlobalSave 의 주석에 세 겹의 방어가
 * 적혀 있다.
 * =================================================================================
 */
/**
 * 저장 전(아직 서버에 보내지 않은) 편집 상태 전부 — [이전]/[앞으로]가 통째로
 * 갈아끼우는 단위다.
 *
 * 🔴 2026-11-21(조각 C2) — **다섯째 칸이 생겼다**(structuralOperations). 아직 안
 * 보낸 구조 변경도 「저장 전 상태」라, 지도 넷과 **한 스냅샷에 함께** 실려야 한다.
 * 따로 두면 ① 시간순이 안 맞고 ② 임시 id(`tmp:node:1`)를 키로 쓰는 초안이 지도에
 * 혼자 남아, 다음에 만든 노드가 같은 번호를 받으면 **지운 적 없는 남의 글이 새
 * 노드에 붙는다**(procedure-editor-structural-undo.ts 머리말 ②).
 */
type CasePendingSnapshot = {
  nodeDrafts: Map<string, CaseFlowchartNodeDraft>;
  nodePositions: Map<string, Position>;
  edgeDrafts: Map<string, CaseFlowchartEdgeDraft>;
  routePoints: Map<string, RoutePoint[] | null>;
  structuralOperations: PendingStructuralOperation[];
};

/**
 * 되돌리기 한 단계 — 저장 전 상태 스냅샷 하나가 전부다.
 *
 * 🔴 2026-11-21(조각 C2) — 전에는 여기에 `restoreNode`/`restoreEdge` 가 있었다.
 * 삭제가 **이미 서버에 반영된 뒤**라 화면 상태만 되돌려서는 되살아나지 않았고,
 * [이전]을 누르면 서버에 같은 것을 **새 번호로 다시 만들었다**. 지금은 삭제가
 * 「아직 안 보낸 조작」이라 되돌릴 DB 가 없다 — 목록에서 그 줄을 빼면 그만이고,
 * 그래서 그 120줄과 함께 서버 왕복·실패 글·진행 중 표시가 전부 사라졌다.
 */
type CaseUndoStep = {
  snapshot: CasePendingSnapshot;
};

/**
 * 절차 편집기의 pendingSnapshotSignature와 같은 방식 — 키 순서를 고정해 직렬화한 뒤 비교한다.
 *
 * 🔴 **구조 목록을 안 섞으면 되돌리기 한 칸이 조용히 사라진다.** 노드를 하나
 * 지웠을 뿐이면 지도 넷은 **완전히 똑같다** — 그러면 pushUndoStep 이 「직전과 같은
 * 상태」로 보고 그 칸을 안 쌓고(undo-stack.ts), undoStep 은 「헛도는 단계」로 보고
 * 건너뛴다. 오류도 경고도 없이 [이전]이 한 칸을 건너뛰는 꼴이다. 아래 다섯째 줄이
 * 그것을 막는다(procedure-editor-structural-undo.ts ②절이 이 한 줄을 요구한다).
 * 🔵 서명이 **글자**인 까닭도 그 모듈에 적혀 있다 — 칸 차례에 흔들리지 않게 키를
 * 정렬해 직렬화한다(치환이 조작을 다시 만들면서 키 차례가 바뀔 수 있다).
 */
function casePendingSnapshotSignature(snapshot: CasePendingSnapshot): string {
  const dump = (map: Map<string, unknown>) => [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([
    dump(snapshot.nodeDrafts),
    dump(snapshot.nodePositions),
    dump(snapshot.edgeDrafts),
    dump(snapshot.routePoints),
    procedureStructuralOperationsSignature(snapshot.structuralOperations),
  ]);
}

/** 두 단계가 같은가 — 스냅샷 서명 하나로 가른다(특례 없음: 서버에 되돌릴 것이 남는 단계가 더는 없다). */
function caseUndoStepsEqual(a: CaseUndoStep, b: CaseUndoStep): boolean {
  return casePendingSnapshotSignature(a.snapshot) === casePendingSnapshotSignature(b.snapshot);
}

/**
 * 🔴 미리보기 씨앗의 노드 유형은 **넓은 쪽**(ProcedureNodeType, 아홉 값)으로
 * 적혀 있는데 진단 노드 행은 **일곱 값**만 받는다. 그 차이가 실제로 들어올 일은
 * 없다 — 이 화면이 쌓는 조작은 CREATE_NODE · INSERT_NODE_ON_EDGE 둘뿐이고, 그
 * 칸의 타입(ManualTechnicalNodeType)은 진단의 일곱과 **글자도 차례도 같다**
 * (2026-11-21 에 두 상수를 맞대어 확인했다). 그래도 글자로 한 번 더 확인하고,
 * 아니면 「작업」으로 떨어뜨린다 — 그리는 쪽에서 던지면 **화면 전체가 하얘지고**,
 * 그것은 미리보기 모듈이 「가리키는 대상이 없으면 조용히 건너뛴다」로 정한 규약과
 * 어긋난다.
 */
function asCaseNodeType(nodeType: string): RepairCaseFlowchartNodeType {
  return (REPAIR_CASE_FLOWCHART_NODE_TYPE_CODES as readonly string[]).includes(nodeType) ? (nodeType as RepairCaseFlowchartNodeType) : "TASK";
}

/** 초안 지도에서 줄 몇 개를 버린다. 🔵 버릴 것이 하나도 없으면 **같은 지도를 그대로** 돌려줘 쓸데없는 렌더를 안 만든다(올리기 전 네 자리가 각각 적던 그 수법 그대로). */
function dropKeys<T>(map: Map<string, T>, keys: readonly string[]): Map<string, T> {
  if (!keys.some((key) => map.has(key))) return map;
  const next = new Map(map);
  for (const key of keys) next.delete(key);
  return next;
}

/** 저장이 실제로 읽는 초안 지도 넷 — 스냅샷에서 구조 목록만 뺀 모습이다. */
type CasePendingDraftMaps = Omit<CasePendingSnapshot, "structuralOperations">;

/**
 * 🔴 **받침 지도도 키를 함께 옮긴다.** 구조 단계가 끝나면 막 만든 노드·연결선의
 * 키가 임시 번호에서 진짜 id 로 바뀌는데, 받침이 임시 번호를 든 채면 planSaveSteps
 * 의 `if (!server) continue;` 가 그 줄을 **조용히 건너뛴다**(그러면 새 노드에 적은
 * 설명이 오류 없이 사라진다).
 * 🔵 값 안의 `id` 칸도 함께 맞춘다. planSaveSteps 는 **키만** 보므로 안 맞춰도
 *    지금은 아무 일이 없지만, 한쪽만 옮겨진 지도를 남겨 두면 그 값을 id 로 믿고
 *    쓰는 코드가 생기는 날 조용히 틀린다.
 */
function rebaseSnapshotMap<T extends { id: string }>(
  map: Map<string, T>,
  effects: Parameters<typeof rebaseDraftMapAfterStructuralSave>[1],
  scope: "node" | "edge"
): Map<string, T> {
  const moved = rebaseDraftMapAfterStructuralSave(map, effects, scope);
  const next = new Map<string, T>();
  for (const [id, value] of moved) next.set(id, value.id === id ? value : { ...value, id });
  return next;
}

/**
 * 🔴 연결선 초안 **안의 노드 번호**도 옮긴다. rebaseDraftMapAfterStructuralSave 는
 * 지도의 **키**만 옮기는데, 연결선 초안은 값 안에 재연결 대상(fromNodeId·toNodeId)을
 * 들고 있다. 사람이 「방금 만든 노드」로 재연결해 두면 그 칸에 임시 번호가 남고,
 * 칸 값 단계에는 치환이 없어 그대로 서버에 가서 **「요청을 확인할 수 없습니다」로
 * 거절당한다**(서버 액션의 첫 관문이 UUID 검사다).
 */
function rebaseEdgeDraftTargets(drafts: Map<string, CaseFlowchartEdgeDraft>, resolvedIds: ReadonlyMap<string, string>): Map<string, CaseFlowchartEdgeDraft> {
  if (resolvedIds.size === 0) return drafts;
  const next = new Map<string, CaseFlowchartEdgeDraft>();
  for (const [id, draft] of drafts) {
    next.set(id, { ...draft, fromNodeId: resolvedIds.get(draft.fromNodeId) ?? draft.fromNodeId, toNodeId: resolvedIds.get(draft.toNodeId) ?? draft.toNodeId });
  }
  return next;
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
  /**
   * 🔴 아직 안 보낸 **구조 변경 목록**(2026-11-21, 조각 C2). 노드 추가·삭제,
   * 연결선 추가·삭제, 연결선 위 노드 끼우기 다섯이 전부 여기 쌓였다가 [저장] 한
   * 번에 나간다.
   *
   * 🔴 번호를 찍는 길은 **appendPendingStructuralOperations 하나뿐**이다 — 도장
   * (createTempIdMinter)을 여기서 직접 만들지 않는다. 렌더마다 다시 만들면 같은
   * 번호가 두 번 나가고, 그러면 접기가 서로 다른 두 노드를 한 덩어리로 봐서 하나를
   * 지울 때 다른 하나가 같이 사라진다(procedure-editor-structural-undo.ts 머리말).
   * 그 함수는 **살아 있는 목록에서** 다음 번호를 뽑으므로 그 함정이 성립하지 않는다.
   */
  const [pendingStructuralOperations, setPendingStructuralOperations] = useState<PendingStructuralOperation[]>([]);

  // ---- 저장 전 되돌리기(클라이언트 스냅샷 스택) ----
  //
  // 이 편집기에는 서버 편집 이력이 없다(절차 템플릿과 달리 케이스 Flowchart는
  // 발행/이력 개념이 없는 작업 문서다) — 그래서 [이전]/[앞으로]는 저장하지 않은
  // 변경만 다룬다. 스냅샷 방식과 한 단계의 단위는 절차 편집기와 같다
  // (graph-editor-core/undo-stack.ts 주석 참고).
  const [pendingUndoStack, setPendingUndoStack] = useState<UndoStack<CaseUndoStep>>(() => createUndoStack<CaseUndoStep>());
  const pendingSnapshotRef = useRef<CasePendingSnapshot>({
    nodeDrafts: new Map(),
    nodePositions: new Map(),
    edgeDrafts: new Map(),
    routePoints: new Map(),
    structuralOperations: [],
  });
  useEffect(() => {
    pendingSnapshotRef.current = {
      nodeDrafts: pendingNodeDraftsById,
      nodePositions: pendingNodePositionsById,
      edgeDrafts: pendingEdgeDraftsById,
      routePoints: pendingRoutePointsByEdgeId,
      structuralOperations: pendingStructuralOperations,
    };
  }, [pendingNodeDraftsById, pendingNodePositionsById, pendingEdgeDraftsById, pendingRoutePointsByEdgeId, pendingStructuralOperations]);

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
   * ==========================================================================
   * 🔴 구조 변경을 **모아 두는 단 하나의 통로** (2026-11-21, 조각 C2)
   * ==========================================================================
   * 다섯(노드 추가·삭제 · 연결선 추가·삭제 · 연결선 위 노드 끼우기)이 전부 여기를
   * 지난다. 하는 일이 둘인데 **차례가 중요하다.**
   *
   *  ① `pushPendingUndoStep()` 을 **목록을 고치기 전에** 부른다. 되돌리기 스택은
   *     「바뀌기 직전 상태」를 쌓는 방식이라, 뒤에 부르면 이미 바뀐 목록이 담겨
   *     [이전]이 한 칸씩 밀린다(드래그가 지켜 온 규칙 그대로다).
   *  ② 번호는 appendPendingStructuralOperations 가 찍는다(위 state 선언부의 까닭).
   *
   * 🔴 **방금 찍힌 줄을 그대로 돌려준다.** 임시 번호를 그 자리에서 알아야 하는
   * 자리가 둘 있기 때문이다 — 노드 추가의 **설명 칸**(CREATE_NODE 가 안 싣는다)과
   * 연결선 위 노드 끼우기(쪼개진 선의 초안을 새 노드 쪽으로 돌려놔야 한다).
   * 그래서 `setPendingStructuralOperations(prev => ...)` 꼴을 **안 쓴다.**
   * 🔴 대신 「**한 이벤트에 한 번만 부른다**」가 약속이 된다. 새로 생기는 제약이
   * 아니다 — 바로 위 pushPendingUndoStep 이 쥐는 스냅샷(pendingSnapshotRef)도
   * 이미 같은 전제 위에 서 있다. 시험이 자리마다 **정확히 1회**를 센다.
   * 🔵 그래서 여러 줄을 한꺼번에 쌓을 때는 **합친 배열 하나**로 한 번만 부른다 —
   * 고리를 돌며 N번 부르면 [이전]을 N번 눌러야 한 걸음이 되돌아간다.
   */
  function queueStructural(build: (mint: ProcedureTempIdMinter) => readonly PendingStructuralOperation[]): PendingStructuralOperation[] {
    if (!canEdit) return [];
    pushPendingUndoStep();
    const next = appendPendingStructuralOperations(pendingStructuralOperations, build);
    setPendingStructuralOperations(next);
    return next.slice(pendingStructuralOperations.length);
  }

  function applyPendingSnapshot(snapshot: CasePendingSnapshot) {
    setPendingNodeDraftsById(new Map(snapshot.nodeDrafts));
    setPendingNodePositionsById(new Map(snapshot.nodePositions));
    setPendingEdgeDraftsById(new Map(snapshot.edgeDrafts));
    setPendingRoutePointsByEdgeId(new Map(snapshot.routePoints));
    // 🔵 지도 넷과 같은 규약으로 **사본**을 넣는다 — 스냅샷 안의 배열을 그대로
    //    state 에 꽂으면 그다음 조작이 그 배열을 가리키게 되어, 되돌아간 자리가
    //    다음 조작에 따라 움직인다.
    setPendingStructuralOperations([...snapshot.structuralOperations]);
    lastFieldEditKeyRef.current = null;
  }

  /**
   * [이전] — 저장하지 않은 변경을 한 단계씩 되돌린다.
   *
   * 🔴 2026-11-21(조각 C2) — **서버 왕복이 사라졌다.** 전에는 「삭제된 노드·연결선」
   * 단계가 섞여 있어, [이전]이 서버에 같은 것을 **새 번호로 다시 만들었다**(그래서
   * 이 함수가 async 였고 실패 글과 진행 중 표시를 쥐고 있었다). 지금은 삭제도 아직
   * 안 보낸 조작이라 되돌릴 DB 가 없다 — 스냅샷을 통째로 갈아끼우면 그만이다.
   *
   * 🔴 [앞으로](redo)의 **특례도 함께 없앴다.** 전에는 서버 작업이 낀 단계를
   * `{ past, future: [] }` 로 redo 대상에서 뺐다 — 「되살린 것을 [앞으로]가 다시
   * 지우면 방금 되살린 것이 조용히 사라진다」는 까닭이었다. 그 걱정은 **되살리기가
   * 서버에 진짜로 쓰던 시절의 것**이고, 지금 [앞으로]는 목록을 한 칸 앞으로 되돌려
   * 놓을 뿐이라 서버에 닿지 않는다(그리고 그 뒤에도 [이전]으로 다시 돌아온다).
   * 그래서 구조 변경도 다른 변경과 **똑같이** 앞뒤로 오간다.
   */
  function handleUndo() {
    const result = undoStep(pendingUndoStack, { snapshot: pendingSnapshotRef.current }, caseUndoStepsEqual);
    setPendingUndoStack(result.stack);
    if (result.restored) applyPendingSnapshot(result.restored.snapshot);
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

  /**
   * ==========================================================================
   * 🔴 지우기를 **부르는 자리는 이 화면뿐**이다 (2026-11-21)
   * ==========================================================================
   * 2026-11-21 이전에는 속성 패널이 제 손으로 서버 액션을 불렀다
   * (CaseFlowchartNodePropertyPanel · CaseFlowchartEdgePropertyPanel 의
   * handleDelete). 이번에 [Delete] 키가 붙으면서 **부르는 자리가 둘이 될 뻔했고**,
   * 그러면 「단추로 지울 때와 키로 지울 때가 다른」 화면이 된다 — 막힌 까닭을
   * 띄우는 것도, 되돌리기 단계를 쌓는 것도, 저장 전 수정을 치우는 것도 한쪽에만
   * 남는 날이 온다. 그리고 그 어긋남은 오류를 한 번도 안 낸다.
   *
   * 그래서 **부르는 일도 뒤처리도 전부 여기로 올렸다.** 패널은 단추를 그리고
   * `onDelete` 를 부르는 것까지만 한다. 키도 똑같이 아래 둘을 부른다.
   *
   * 🔴 2026-11-21(조각 C2) — 그날 안에 **삭제도 [저장] 쪽으로 옮겼다.** 아래 둘은
   * 이제 서버를 안 부르고 「지운다」는 줄을 목록에 쌓는다(queueStructural). 패널도
   * 키도 **한 글자 안 고쳤다** — 위 문단이 내다본 그 자리가 실제로 그 자리였다.
   *
   * 🔴 2026-11-21(조각 C3) — **「막힌 까닭」이라는 것이 없어졌다.** 이 화면이 미리
   * 막던 까닭은 「연결선이 붙어 있다」 **하나뿐**이었고, 이번에 그것이 「함께
   * 지운다」로 바뀌었다(아래 handleDeleteNode). 그래서 까닭을 쥐고 패널로
   * 내려보내던 state(`nodeDeleteBlockedMessage`)와 패널의 `deleteBlockedMessage`
   * 프롭·표시 자리를 **걷어냈다** — 값이 영영 null 인 칸을 남겨 두면 「꺼도 아무
   * 일 없는 스위치」가 된다. 🔵 서버가 거절하면 그 글은 [저장] 때 globalSaveError
   * 로 뜬다(이 화면이 미리 재는 자리는 이제 하나도 없다).
   */

  /**
   * 노드 하나를 지운다 — 패널의 [노드 삭제] 단추와 [Delete] 키가 **똑같이** 부르는 한 자리.
   *
   * ── 🔴 **붙은 연결선도 함께 지운다** (2026-11-21, 조각 C3) ─────────────────
   * 쓰는 분의 결정(원문): 「노드를 지우면 연결된 연결선도 지워지는 거로 하자
   * (연결선을 지우지 않아도 노드를 지울 수 있도록).」 그 전까지 이 함수는 선이
   * 붙은 노드를 **아예 막았다.** 그때 띄우던 글이 이것이다 —
   * 「이 노드에 연결된 분기가 N개 있어 삭제할 수 없습니다. 먼저 연결된 분기를 삭제해 주세요.」
   * 사람이 선을 하나씩 먼저 지우고 나서야 노드를 지울 수 있었다. 절차 편집기가
   * 같은 날 아침 먼저 이렇게 바뀌었다(커밋 1972ab29).
   *
   * 🔴 **중간 노드를 지워도 앞뒤를 새로 잇지 않는다**(쓰는 분 명시 — 「중간에
   * 연결된 노드를 삭제하면 앞뒤 노드는 연결되지 않은채로 둬줘」). 선 둘이 다
   * 사라지고 끝이다. 그래서 이 함수에는 CREATE_EDGE 를 쌓는 줄이 **하나도 없고**,
   * 쌓을 줄을 정하는 순수 함수도 DELETE 만 적어 낸다.
   *
   * 🔴 **무엇을 쌓을지는 planProcedureNodeDeletionOperations 가 정한다** — 절차와
   * 같은 한 벌이다. 화면이 제 손으로 다시 세면 「화면이 말한 수」와 「실제로
   * 지워지는 수」가 갈리고, 그 어긋남은 [저장]이 끝난 뒤에야 드러난다.
   *
   * 🔴 **서버는 한 글자도 안 바꿨다.** deleteRepairCaseFlowchartNode 는 **여전히**
   * 선이 붙은 노드를 NODE_HAS_CONNECTED_EDGES 로 거절한다
   * (db/mutations/repair-case-flowchart-graph.ts). 막음을 걷어낼 수 있는 까닭은 그
   * 규칙이 없어져서가 아니라, 모아 둔 조작을 보내는 차례
   * (PROCEDURE_STRUCTURAL_PHASE_ORDER)가 **DELETE_EDGE(3단계) → DELETE_NODE(6단계)**
   * 라 선이 먼저 지워진 뒤에 노드가 가기 때문이다. 🔴 그 차례가 이제 이 기능을
   * 떠받친다 — 둘의 앞뒤가 뒤집히면 여기서 나가는 **모든** 삭제가 [저장]에서 그
   * 거절로 멈춘다.
   *
   * 🔴 세는 목록이 **renderedEdges**(그림이 실제로 그린 선)인 것이 핵심이다.
   * `edges`(서버 것)도 `structuralPreview.edges`(조작만 얹은 것)도 아니다 — 이
   * 편집기는 **연결선 재연결을 구조 조작이 아니라 초안 지도로** 들고 있어서
   * (RETARGET_EDGE 를 안 쌓는다 — 이 파일 머리말의 2026-11-21 결정), 미리보기 목록은
   * 저장 전에 옮긴 선의 **옛 양 끝**을 그대로 들고 있다. 그것으로 세면 ① 이 노드에서
   * **떠난** 선을 지우고 ② 이 노드로 **옮겨 온** 선은 남긴다. 둘 다 사람이 시킨 적
   * 없는 일이고, 남은 쪽은 [저장]에서 **없어진 노드로 재연결**하려다 실패한다.
   * 🔵 저장 전에 그은 선(tmp:edge:N)과 이미 지우기로 쌓아 둔 선은 미리보기 쪽에서
   *    이미 맞춰져 있다 — renderedEdges 가 그 위에 초안을 한 겹 더 얹은 것이다.
   *
   * 🔵 **[이전] 한 칸**이다 — queueStructural 이 목록을 고치기 전에 한 칸을 찍고,
   * 받은 배열을 통째로 붙인다. 선이 셋 붙은 노드를 지워도 [이전] 한 번에 넷이
   * 함께 돌아온다. 그래서 queueStructural 을 **한 번만** 부른다.
   */
  function handleDeleteNode(nodeId: string) {
    if (!canEdit) return;
    const attachedEdgeIds = findEdgesAttachedToNode(renderedEdges, nodeId);
    queueStructural(() => planProcedureNodeDeletionOperations(renderedEdges, nodeId, null));
    // 🔴 지울 노드의 **저장 전 수정도 함께 버린다**(올리기 전 handleNodeDeleted 가
    //    하던 뒤처리 그대로). 안 버리면 같은 저장에서 지워질 노드에 칸 값을 쓰려
    //    들어 **저장 전체가 실패한다**(구조는 이미 지나간 뒤라 더 나쁘다).
    //    🔵 되돌리면 스냅샷이 그 초안까지 함께 되살린다 — queueStructural 이
    //       **버리기 전에** 한 칸을 찍기 때문이다.
    setPendingNodeDraftsById((prev) => dropKeys(prev, [nodeId]));
    setPendingNodePositionsById((prev) => dropKeys(prev, [nodeId]));
    // 🔴 **함께 지워지는 선들의 뒤처리도 똑같이 한다** — 바로 아래 handleDeleteEdge
    //    가 선 하나에 하던 그 둘이다. 빠뜨리면 [저장]이 **없는 선**에 칸 값·경로점을
    //    쓰려 들어 저장 전체가 실패한다(절차 쪽에서 실제로 겪은 결함이다). 선 하나를
    //    어떻게 지웠느냐에 따라 뒤처리가 갈리면 안 된다.
    setPendingEdgeDraftsById((prev) => dropKeys(prev, attachedEdgeIds));
    setPendingRoutePointsByEdgeId((prev) => dropKeys(prev, attachedEdgeIds));
    setSelectedNodeId(null);
    // 🔵 함께 지워진 선을 고른 채였다면 **선택도 푼다.** 안 풀어도 연결선 패널은 안
    //    선다(그려진 선에서만 서고 그 선은 이미 사라졌다). 다만 고른 경로점이 남아
    //    있으면 [Delete] 가 없는 선의 점을 지우러 간다.
    if (selectedEdgeId !== null && attachedEdgeIds.includes(selectedEdgeId)) {
      setSelectedEdgeId(null);
      setSelectedWaypointIndex(null);
    }
  }

  /** 연결선 하나를 지운다 — 패널의 [분기 삭제] 단추와 [Delete] 키가 **똑같이** 부르는 한 자리. */
  function handleDeleteEdge(edgeId: string) {
    if (!canEdit) return;
    queueStructural(() => [{ kind: "DELETE_EDGE", edgeId, reason: null }]);
    // 🔴 노드 쪽과 같은 까닭 — 지워질 연결선의 칸 값·경로점 초안을 함께 버린다.
    setPendingEdgeDraftsById((prev) => dropKeys(prev, [edgeId]));
    setPendingRoutePointsByEdgeId((prev) => dropKeys(prev, [edgeId]));
    setSelectedEdgeId(null);
    setSelectedWaypointIndex(null);
  }

  /**
   * ── 🔴 **노드 추가** (2026-11-21, 조각 C2) ───────────────────────────────
   * 🔴 **설명 칸은 CREATE_NODE 가 안 싣는다**(서버의 생성 액션은 받지만, 모아 두는
   * 조작 타입에는 그 칸이 없다 — 절차 쪽 만들기 패널에는 설명 칸이 아예 없어서다).
   * 그래서 적힌 설명은 **방금 찍힌 임시 id 를 키로 초안 지도에 얹는다.** 그러면
   * [저장]이 구조를 먼저 보내 진짜 id 를 받고, 지도의 키를 그 id 로 옮긴 뒤
   * (rebaseDraftMapAfterStructuralSave) 칸 값 단계에서 설명이 따라 들어간다.
   * 🔴 안 얹으면 **적은 설명이 조용히 사라진다** — 오류도 안 나고 「저장 완료」까지 뜬다.
   */
  function handleQueueCreateNode(input: { nodeType: RepairCaseFlowchartNodeType; title: string; description: string; position: Position }) {
    const [created] = queueStructural((mint) => [
      { kind: "CREATE_NODE", tempNodeId: mint.nextNodeId(), nodeType: input.nodeType, title: input.title, position: input.position },
    ]);
    if (created?.kind !== "CREATE_NODE") return;
    const description = input.description.trim();
    if (description.length === 0) return;
    setPendingNodeDraftsById((prev) => {
      const next = new Map(prev);
      next.set(created.tempNodeId, { title: input.title, description, instructions: "", nodeType: input.nodeType });
      return next;
    });
  }

  /** ── 연결선 추가 — 칸이 전부 CREATE_EDGE 에 실려 따로 얹을 초안이 없다. */
  function handleQueueCreateEdge(input: { fromNodeId: string; toNodeId: string; branchType: RepairCaseFlowchartBranchType; branchLabel: string | null }) {
    queueStructural((mint) => [
      {
        kind: "CREATE_EDGE",
        tempEdgeId: mint.nextEdgeId(),
        fromNodeId: input.fromNodeId,
        toNodeId: input.toNodeId,
        branchType: input.branchType,
        branchLabel: input.branchLabel,
        reason: null,
      },
    ]);
  }

  /**
   * ── 🔴 **연결선 위 노드 끼우기** — 한 도장에서 번호를 **둘** 받는다 ─────────
   * 새 노드 하나와, 그 노드 → 원래 대상으로 딸려 생길 **둘째** 연결선 하나.
   * 두 번 나눠 부르면 그 사이에 목록이 바뀌어 번호가 어긋날 수 있다
   * (appendPendingStructuralOperations 가 build 를 **목록**으로 받는 까닭).
   *
   * 🔴 **쪼개진 선의 초안도 함께 돌려놓는다.** 미리보기는 원래 선의 끝을 새
   * 노드로 옮기는데(previewPendingStructuralGraph 의 INSERT_NODE_ON_EDGE), 그
   * 선에 저장 전 초안이 남아 있으면 그 초안이 **선 전체의 사진**이라 끝점을 옛
   * 값으로 덮어쓴다 — 그림에서는 끼운 노드가 떠 있고, 받침과 어긋나 **저장 때
   * 끼우기를 되돌리는 재연결**까지 나간다. 끝점만 새 노드로 맞춰 두면 둘 다 없다.
   * 🔵 분기 유형·라벨은 그대로 남는다(서버도 원래 값을 첫 구간에 남긴다).
   */
  function handleQueueInsertNodeOnEdge(edgeId: string, input: { nodeType: RepairCaseFlowchartNodeType; title: string; position: Position }) {
    const [inserted] = queueStructural((mint) => [
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
    if (inserted?.kind !== "INSERT_NODE_ON_EDGE") return;
    setPendingEdgeDraftsById((prev) => {
      const draft = prev.get(edgeId);
      if (!draft) return prev;
      const next = new Map(prev);
      next.set(edgeId, { ...draft, toNodeId: inserted.tempNodeId });
      return next;
    });
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

  // ---- 저장 전 구조 변경을 **서버 목록 위에 얹은 그래프** (2026-11-21, 조각 C2) ----
  //
  // 🔴 **이것이 없으면 조작을 아무리 쌓아도 화면에 아무 일도 안 일어난다.** 아래
  // renderedNodes/renderedEdges 와 받침(nodesById/edgesById)이 전부 이 결과를 돈다 —
  // 전에는 둘 다 `nodes`/`edges`(서버가 그려 준 목록)를 돌았고, 그러면 아직 안 보낸
  // 노드가 그림에도 패널에도 안 나온다.
  //
  // 🔵 행을 만들고 고치는 일(factories)은 **여기**가 맡는다 — 미리보기 모듈은 진단
  // 노드 행에 칸이 몇 개인지 모른다. 새 행의 칸은 서버가 실제로 적는 것만 채우고
  // 나머지는 null 이다(createRepairCaseFlowchartNode / createRepairCaseFlowchartEdge 와 같은 모습).
  const structuralPreviewFactories: StructuralPreviewFactories<CaseFlowchartGraphNode, CaseFlowchartGraphEdge> = {
    createNode: (seed) => ({
      id: seed.id,
      nodeType: asCaseNodeType(seed.nodeType),
      title: seed.title,
      // 🔵 설명은 CREATE_NODE 가 안 싣는다 — 적힌 설명은 **초안 지도**를 타고 오고,
      //    아래 renderedNodes 의 mergeNodeForRender 가 그 위에 얹는다.
      description: null,
      instructions: null,
      // 🔵 자리는 늘 들어온다(만들기 패널이 비워 보내지 않는다 — 그 패널 머리말).
      //    그래도 null 을 받으면 (0,0)으로 둔다. 진단 그림에는 자동 배치가 없어
      //    좌표 말고 그릴 방법이 없다.
      positionX: seed.position ? seed.position.x : 0,
      positionY: seed.position ? seed.position.y : 0,
    }),
    createEdge: (seed) => ({
      id: seed.id,
      fromNodeId: seed.fromNodeId,
      toNodeId: seed.toNodeId,
      branchType: seed.branchType,
      branchLabel: seed.branchLabel,
      routePoints: null,
    }),
    // 🔵 진단은 CHANGE_NODE_TYPE 을 **안 쌓는다**(유형 변경은 초안 + SaveStep 으로
    //    돈다). 그래서 이 함수는 지금 한 번도 안 불린다 — 그래도 비워 두지 않는다.
    //    빈 함수를 두면 언젠가 그 조작을 쌓는 날 **그림에서만 조용히 아무 일도 안 난다.**
    changeNodeType: (node, newNodeType) => ({ ...node, nodeType: asCaseNodeType(newNodeType) }),
    retargetEdge: (edge, fromNodeId, toNodeId) => ({ ...edge, fromNodeId, toNodeId }),
  };

  const structuralPreview = previewPendingStructuralGraph(nodes, edges, pendingStructuralOperations, structuralPreviewFactories);

  /**
   * 🔴 「바뀌었는가」를 맞대어 보는 **받침**. 미리보기 행을 그대로 쓴다 — 셋이
   * 한꺼번에 맞아떨어진다.
   *  ① 저장 전에 만든 노드·연결선도 받침이 생긴다. 없으면 computeDirty* 와
   *     planSaveSteps 가 **조용히 건너뛴다**(`if (!server) continue;`) — 새 노드에
   *     적은 설명이 오류 없이 사라지는 그 자리다.
   *  ② 이미 있는 행은 미리보기 행이 서버 행 **그 자체**라 값이 같다.
   *  ③ 연결선 위 노드 끼우기로 **끝이 옮겨진 선**은 받침도 함께 옮겨진다. 서버
   *     행을 받침으로 쓰면 그 선의 초안이 「재연결됨」으로 보여, [저장]이 방금
   *     끼운 것을 **되돌리는 재연결**을 한 번 더 보낸다(handleQueueInsertNodeOnEdge
   *     가 초안의 끝점을 함께 맞추는 것이 이 ③과 한 짝이다).
   */
  const nodesById = new Map(structuralPreview.nodes.map((n) => [n.id, n]));
  const edgesById = new Map(structuralPreview.edges.map((e) => [e.id, e]));

  /**
   * 🔴 **접은 뒤의 건수를 센다** — 사람이 한 조작 수가 아니다. 만들었다 지운 노드는
   * 서버에 보낼 것이 0건이고, 그 노드에 걸렸던 선도 함께 사라진다. 사람이 세 번
   * 눌렀어도 「변경 0건」이 맞는 답이다.
   * 🔴 그리고 **막힌 것**(conflicts)이 하나라도 있으면 [저장]을 막는다. operations 만
   * 들고 보내면 사람이 화면에서 한 일 하나가 설명 없이 사라진다.
   */
  const coalescedStructural = coalescePendingStructuralOperations(pendingStructuralOperations);
  const structuralPendingCount = coalescedStructural.operations.length;
  const structuralConflictMessages = describeStructuralConflicts(coalescedStructural.conflicts);
  const canSendStructural = canSendStructuralChanges(coalescedStructural);

  // ---- node draft (title/description/nodeType) ----

  /**
   * 🔴 받침(baseline)이 **미리보기 행**이다(2026-11-21). 전에는 `nodes`(서버 목록)를
   * 뒤졌는데, 그러면 저장 전에 만든 노드를 고를 때 패널이 제목을 **빈 칸으로**
   * 보여 준다 — 사람이 방금 적은 제목이 패널에서만 사라지는 꼴이라 고장으로 읽힌다.
   * 🔵 이미 서버에 있는 노드는 미리보기 행이 **서버 행 그 자체**라(미리보기는 더하고
   * 빼기만 한다) 달라지는 것이 없다.
   */
  function nodeDraft(nodeId: string): CaseFlowchartNodeDraft {
    const pending = pendingNodeDraftsById.get(nodeId);
    if (pending) return pending;
    const serverNode = nodesById.get(nodeId);
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

  const dirtyNodeEntries = computeDirtyNodeEntries(pendingNodeDraftsById, nodesById);
  const dirtyPositionNodeIds = computeDirtyPositionNodeIds(pendingNodePositionsById, nodesById);

  // ---- edge draft (branchType/branchLabel/fromNodeId/toNodeId) ----

  /** 받침이 **미리보기 행**인 까닭은 바로 위 nodeDraft 와 같다. */
  function edgeDraft(edgeId: string): CaseFlowchartEdgeDraft {
    const pending = pendingEdgeDraftsById.get(edgeId);
    if (pending) return pending;
    const serverEdge = edgesById.get(edgeId);
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

  const dirtyEdgeEntries = computeDirtyEdgeEntries(pendingEdgeDraftsById, edgesById);

  // ---- route draft (waypoints) ----

  function workingRoutePoints(edgeId: string): RoutePoint[] | null {
    if (pendingRoutePointsByEdgeId.has(edgeId)) return pendingRoutePointsByEdgeId.get(edgeId) ?? null;
    // 받침이 **미리보기 행**인 까닭은 nodeDraft 와 같다 — 저장 전에 그은 선도 경로점을 가질 수 있다.
    return edgesById.get(edgeId)?.routePoints ?? null;
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

  /**
   * 🔴 구조 변경 건수가 **반드시** 여기 더해져야 한다. 안 더하면 노드만 추가한
   * 상태에서 [저장]이 꺼져 있어 **한 건도 안 나간다** — 이번 일이 고치려던 바로 그
   * 증상이 모양만 바꿔 되돌아온다.
   * 🔵 나가기 경고(beforeunload)도 이 값을 보므로, 더하면 그 경고가 저장 전 구조
   *    변경까지 함께 지킨다.
   */
  const totalPendingCount = dirtyNodeEntries.length + dirtyPositionNodeIds.length + dirtyEdgeEntries.length + dirtyRouteEdgeIds.length + structuralPendingCount;
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

  // 🔴 도는 목록이 `nodes`/`edges` 에서 **structuralPreview** 로 바뀌었다
  //    (2026-11-21, 조각 C2). 저장 전에 추가한 노드·연결선이 여기 안 들어오면
  //    그림에도 패널에도 안 나온다 — 단추만 눌리고 아무 일도 안 일어난 것처럼 보인다.
  const renderedNodes: CaseFlowchartGraphNode[] = structuralPreview.nodes.map((n) =>
    mergeNodeForRender(n, pendingNodeDraftsById.get(n.id), pendingNodePositionsById.get(n.id))
  );
  const renderedEdges: CaseFlowchartGraphEdge[] = structuralPreview.edges.map((e) =>
    mergeEdgeForRender(e, pendingEdgeDraftsById.get(e.id), pendingRoutePointsByEdgeId.get(e.id))
  );

  const selectedNode = renderedNodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedEdge = renderedEdges.find((e) => e.id === selectedEdgeId) ?? null;

  /**
   * ==========================================================================
   * 🔴 [Delete] 키로 지우기 (2026-11-21)
   * ==========================================================================
   * 쓰는 분의 요청: 「[진단 FLOWCHART]에서도 같은 동작이 되야 해.」 — 「기술 작업
   * 절차」 편집기에 2026-11-21 에 붙은 것을 그대로 옮긴 것이다.
   *
   * 🔴 **무엇을 지울지 여기서 판정하지 않는다** — planProcedureDeleteKey 하나가
   * 답한다. 차례(경로점 → 노드 → 연결선) · 글자 칸 보호 · Backspace 결정 · 막힌
   * 노드에서 연결선으로 안 흘러내리는 규칙까지 전부 그 파일에 까닭과 함께 있고,
   * 값으로 재어진다(src/lib/domain/procedure-editor-delete-key.test.ts).
   *
   * 🔵 이름이 `procedure-` 로 시작해도 **베끼지 않고 그대로 쓴다.** 그 파일은
   * import 가 하나도 없고 입력이 전부 string · boolean · null 이라 절차 쪽 자료형을
   * 한 글자도 안 물고 온다. 이 화면은 이미 같은 까닭으로
   * procedure-visual-language 를 쓰고 있다(CaseFlowchartGraph 도 마찬가지).
   * 한 벌 더 베끼면 두 잣대가 생기고, 한쪽만 고치는 날이 온다.
   *
   * 🔴 절차에 있고 **진단에 없는 개념 셋**은 이렇게 넘긴다:
   *  ① `canDeleteGraph` — 절차는 「기술 작업」 분류에서만 삭제 칸이 선다. 진단에는
   *     분류가 없고 삭제 칸을 세우는 값이 `canEdit` 하나라, 그것을 그대로 넘긴다.
   *  ② `nodeDeleteBlockedReason` — **null** 이다. 절차가 미리 막는 까닭(체크리스트 ·
   *     고장 진단표가 걸린 노드)은 진단 노드 행에 그런 칸이 **아예 없어** 셀 수조차
   *     없다. 🔴 「진단에는 막히는 노드가 없다」가 아니라 **「미리 셀 수 있는 것이
   *     없다」**가 맞다.
   *     🔴 2026-11-21(조각 C3) — 그 뒤로 **진단에는 미리 막는 까닭이 하나도 없다.**
   *     조각 C2 가 잠깐 하나 세웠었다(연결선이 붙은 노드를 화면이 미리 세어 막았다).
   *     그것이 같은 날 「붙은 선도 함께 지운다」로 바뀌면서 사라졌으므로, 이 칸은
   *     **잴 것이 없어서** null 이다 — 「키에서는 안 막는다」는 뜻이 아니다.
   *     🔴 그러니 막는 까닭이 진단에 다시 생기는 날에는 **이 줄도 함께 고쳐야 한다.**
   *     여기 null 을 박아 둔 채 handleDeleteNode 에만 막음을 넣으면, 단추로는
   *     막히는데 키로는 지워지는 화면이 된다(그 반대도 마찬가지다).
   *  ③ `boxSelectActive` / `boxSelectedNodes` — [범위 선택]은 진단에 아직 없다.
   *     false / [] 를 넘기면 복수 갈래는 영영 안 선다.
   *
   * 🔵 확인 창은 안 띄운다 — 지금 삭제 **단추**도 안 띄운다(잘못 지웠으면 [이전]이
   * 목록에서 그 줄을 빼 준다 — 조각 C2 부터 삭제는 서버에 바로 안 간다). 키만
   * 다르게 굴면 안 된다.
   */
  /**
   * 🔴 지우기 셋의 **가장 최근 신원**. 이 화면의 함수들은 useCallback 이 아니라
   * 렌더마다 다시 만들어지는 선언이라, 아래 의존성 배열에 그대로 넣으면 keydown
   * 등록·해제가 렌더마다(드래그 중에는 프레임마다) 돈다. 바로 위
   * pendingSnapshotRef 가 같은 까닭으로 쓰는 수법 그대로다.
   */
  const deleteByKeyRef = useRef({ node: handleDeleteNode, edge: handleDeleteEdge, removeSelectedWaypoint: handleRemoveSelectedWaypoint });
  useEffect(() => {
    deleteByKeyRef.current = { node: handleDeleteNode, edge: handleDeleteEdge, removeSelectedWaypoint: handleRemoveSelectedWaypoint };
  });

  /**
   * 🔴 고른 id 는 **그림에 실제로 그려진 것**에서 뽑는다. state 의 id 를 그대로
   * 쓰면, 그 사이에 사라진 것(예: 되돌리기로 없어진 노드)에 삭제를 날리게 된다 —
   * 그때는 속성 패널도 안 서 있어 「단추와 같은 판정」도 성립하지 않는다.
   */
  const deletableNodeId = selectedNode?.id ?? null;
  const deletableEdgeId = selectedEdge?.id ?? null;
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const plan = planProcedureDeleteKey({
        key: e.key,
        isTypingTarget: isTextEntryTarget(document.activeElement),
        canEdit,
        canDeleteGraph: canEdit,
        selectedNodeId: deletableNodeId,
        selectedEdgeId: deletableEdgeId,
        selectedWaypointIndex,
        nodeDeleteBlockedReason: null,
        boxSelectActive: false,
        boxSelectedNodes: [],
      });
      // 🔴🔴 아무 일도 안 할 때는 **이벤트에 손도 안 댄다.** 글자 칸에서
      //    preventDefault 를 하면 그 키가 글자를 안 지운다.
      if (plan.action === "NONE") return;
      e.preventDefault();
      if (plan.action === "REMOVE_WAYPOINT") {
        // 🔴 경로점은 **쓰던 통로 그대로** 지운다([선택 경로점 삭제] 단추와 같은
        //    함수) — 여기서 removeWaypoint 를 다시 부르면 되돌리기 단계가 빠진다.
        deleteByKeyRef.current.removeSelectedWaypoint();
        return;
      }
      if (plan.action === "DELETE_NODE") {
        deleteByKeyRef.current.node(plan.nodeId);
        return;
      }
      // 🔵 남은 갈래는 DELETE_EDGE 하나다 — 복수(DELETE_NODES)는 위에서 늘 빈 값을
      //    넘기므로 설 길이 없다([범위 선택]이 진단에 생기는 날 여기가 늘어난다).
      if (plan.action === "DELETE_EDGE") deleteByKeyRef.current.edge(plan.edgeId);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canEdit, deletableNodeId, deletableEdgeId, selectedWaypointIndex]);

  /**
   * Executes exactly one planned step against the real mutation layer — the only place in this component that knows which server action a given SaveStep maps to. Ordering, chaining, and stop-on-first-failure all live in runSaveSequence (repair-case-flowchart-editor-save-state.ts), unit-tested there.
   *
   * 🔴 2026-11-21(조각 C2) — 지도 넷을 **인자로 받는다.** state 를 그대로 읽으면
   * **옮기기 전** 지도를 본다: 구조 단계가 임시 키를 진짜 키로 옮기는데 setState 는
   * 다음 렌더에야 닿기 때문이다. 그러면 막 만든 노드의 칸 값이 임시 키에 남은 채라
   * 그 줄이 통째로 건너뛰어진다(오류 없이, 「저장 완료」까지 뜬 채로).
   */
  async function executeSaveStep(step: SaveStep, expectedUpdatedAt: string, pending: CasePendingDraftMaps): Promise<SaveStepResult> {
    if (step.kind === "NODE_FIELDS") {
      const draft = pending.nodeDrafts.get(step.nodeId) ?? nodeDraft(step.nodeId);
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
      const draft = pending.nodeDrafts.get(step.nodeId) ?? nodeDraft(step.nodeId);
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
        const pos = pending.nodePositions.get(id);
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
      const draft = pending.edgeDrafts.get(step.edgeId) ?? edgeDraft(step.edgeId);
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
      const draft = pending.edgeDrafts.get(step.edgeId) ?? edgeDraft(step.edgeId);
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
      routePoints: pending.routePoints.has(step.edgeId) ? pending.routePoints.get(step.edgeId) ?? null : workingRoutePoints(step.edgeId),
      expectedFlowchartUpdatedAt: expectedUpdatedAt,
    });
    return result.ok ? { ok: true, updatedAt: result.updatedAt } : { ok: false, message: result.message };
  }

  /**
   * 모아 둔 구조 조작 **한 건**을 실제로 서버로 보낸다 — 다섯 갈래가 여기서 갈린다.
   * 🔴 **부르는 액션은 전부 전부터 있던 것 그대로**다(이 조각은 서버를 한 글자도
   * 안 바꿨다). 바뀐 것은 **부르는 시점**뿐이다.
   *
   * 🔴 넘어오는 operation 은 **치환이 끝난 모습**이다 — 임시 id 를 여기서 다시
   * 들여다볼 필요가 없다(그때쯤이면 이미 진짜 id 다).
   * 🔴 돌려주는 칸에서 `nodeId`·`edgeId`·`secondEdgeId` 를 빠뜨리면 뒤 걸음이 임시
   * id 를 든 채 나간다. 타입은 전부 선택 칸이라 아무 말도 안 하고, 대신 보내기
   * 직전 관문(findUnresolvedTempIds)이 운다. 특히 **끼우기는 둘**이다.
   * 🔵 진단 서버는 구조 검증 요약을 안 돌려준다 — 그래서 타입 매개변수가 `null` 이고
   *    `structuralValidation` 을 한 번도 안 싣는다(절차 쪽은 싣는다).
   * 🔵 **`reason` 은 안 보낸다** — 진단 액션들에는 그 인자가 아예 없다. 조작에 칸은
   *    있지만(절차와 같은 타입이다) 늘 null 로 쌓고 여기서 버린다. DB 칸은 이미
   *    있으니 받는 날 코드만 고치면 된다.
   */
  async function executeStructuralOperation(operation: PendingStructuralOperation, expectedUpdatedAt: string): Promise<ProcedureStructuralStepResult<null>> {
    switch (operation.kind) {
      case "CREATE_NODE": {
        const result = await createRepairCaseFlowchartNodeAction({
          repairCaseId,
          flowchartId: flowchart.id,
          nodeType: operation.nodeType,
          title: operation.title,
          position: operation.position,
          expectedFlowchartUpdatedAt: expectedUpdatedAt,
        });
        return result.ok ? { ok: true, updatedAt: result.updatedAt, nodeId: result.nodeId } : { ok: false, message: result.message };
      }
      case "DELETE_NODE": {
        const result = await deleteRepairCaseFlowchartNodeAction({
          repairCaseId,
          flowchartId: flowchart.id,
          nodeId: operation.nodeId,
          expectedFlowchartUpdatedAt: expectedUpdatedAt,
        });
        return result.ok ? { ok: true, updatedAt: result.updatedAt } : { ok: false, message: result.message };
      }
      case "CREATE_EDGE": {
        const result = await createRepairCaseFlowchartEdgeAction({
          repairCaseId,
          flowchartId: flowchart.id,
          fromNodeId: operation.fromNodeId,
          toNodeId: operation.toNodeId,
          branchType: operation.branchType,
          branchLabel: operation.branchLabel,
          expectedFlowchartUpdatedAt: expectedUpdatedAt,
        });
        return result.ok ? { ok: true, updatedAt: result.updatedAt, edgeId: result.edgeId } : { ok: false, message: result.message };
      }
      case "DELETE_EDGE": {
        const result = await deleteRepairCaseFlowchartEdgeAction({
          repairCaseId,
          flowchartId: flowchart.id,
          edgeId: operation.edgeId,
          expectedFlowchartUpdatedAt: expectedUpdatedAt,
        });
        return result.ok ? { ok: true, updatedAt: result.updatedAt } : { ok: false, message: result.message };
      }
      case "INSERT_NODE_ON_EDGE": {
        const result = await insertRepairCaseFlowchartNodeOnEdgeAction({
          repairCaseId,
          flowchartId: flowchart.id,
          edgeId: operation.edgeId,
          nodeType: operation.nodeType,
          title: operation.title,
          position: operation.position,
          expectedFlowchartUpdatedAt: expectedUpdatedAt,
        });
        // 🔴 **둘**이다 — 새 노드와 둘째 연결선. firstEdgeId 는 넘긴 edgeId 그
        //    자체(이미 진짜 id)라 받지 않는다.
        return result.ok
          ? { ok: true, updatedAt: result.updatedAt, nodeId: result.nodeId, secondEdgeId: result.secondEdgeId }
          : { ok: false, message: result.message };
      }
      case "CHANGE_NODE_TYPE":
      case "RETARGET_EDGE":
        // 🔴 진단은 이 둘을 **안 쌓는다**(노드 유형 변경 · 연결선 재연결은 초안
        //    지도 + SaveStep 으로 돈다 — 이 파일 머리말의 2026-11-21 결정). 여기
        //    닿았다는 것은 어딘가에서 쌓기 시작했다는 뜻이고, 그러면 같은 일을
        //    하는 길이 두 벌이 된 것이다. 조용히 성공으로 넘기면 그 날 아무도 못
        //    잡으므로 **소리를 낸다**(저장이 여기서 멈추고 글이 뜬다).
        return { ok: false, message: "내부 오류: 이 편집기는 노드 유형 변경·연결선 재연결을 구조 변경으로 보내지 않습니다." };
    }
  }

  /**
   * The editor's SOLE save action — commits exactly what's currently
   * rendered (see this file's own EDITOR MODEL doc comment above).
   * Deterministic order: node property/type changes, then node positions
   * (one batched layout call), then edge property/retarget changes, then
   * route changes.
   *
   * ──────────────────────────────────────────────────────────────────────
   * 🔴 2026-11-21(조각 C2) — **구조 변경이 앞에 한 단계 더 붙었다**
   * ──────────────────────────────────────────────────────────────────────
   *   구조 보내기 → collectStructuralIdEffects → 지도 넷 + 받침 둘 rebase
   *     → dirty 다시 계산 + includeBrandNew* → 기존 planSaveSteps
   *     → 기존 runSaveSequence
   *
   * 차례가 뒤집히면 안 되는 까닭은 procedure-editor-structural-save.ts 머리말에
   * 있다 — 새 노드는 칸 값 단계가 가리킬 진짜 id 가 아직 없다.
   *
   * 🔴 **세 겹을 다 해야 한다.** 절차 쪽에서 실제로 겪은 결함들이다.
   *  ㉠ 저장이 끝나면 **임시 키로 적어 둔 초안을 진짜 키로 옮긴다**
   *     (rebaseDraftMapAfterStructuralSave). 안 하면 막 만든 노드에 적은 설명이
   *     사라진다. 🔵 연결선 초안은 **키뿐 아니라 값 안의 노드 번호까지** 옮긴다
   *     (rebaseEdgeDraftTargets) — 「방금 만든 노드로 재연결」이 임시 번호인 채
   *     서버에 가면 거절당한다.
   *  ㉡ **dirty 셈이 「받침에 없는 id」를 조용히 건너뛴다**(computeDirty* 와
   *     planSaveSteps 의 `if (!server) continue;`). 받침을 미리보기로 세워 그
   *     구멍을 이미 한 번 메웠지만, 저장이 지나간 **뒤**의 받침은 진짜 id 로
   *     옮겨야 맞으므로 받침 둘도 함께 옮기고(rebaseSnapshotMap),
   *     includeBrandNewDraftEntries/Ids 로 한 겹 더 받친다.
   *  ㉢ **같은 저장에서 지워진 노드·연결선의 초안을 버린다.** 안 버리면 없는 행에
   *     칸 값을 쓰려 들어 저장 전체가 실패한다. 🔵 버리는 자리는 둘이다 — 지울
   *     때(handleDeleteNode/Edge)와, 여기 rebase 가 `deletedNodeIds` 로 한 번 더.
   *
   * 🔴 **구조가 중간에 멈추면 칸 값 단계로 안 넘어간다**(canProceedToFieldSave).
   * 넘어가면 실패 글이 둘이 되고 어디까지 맞는지 사람이 못 읽는다. 🔵 넘어가지
   * 않아도 잃는 것은 없다 — 아직 안 간 초안은 그대로 남아 다음 [저장]에 다시 간다.
   */
  async function handleGlobalSave() {
    if (!hasAnyPendingChanges || !canSendStructural) return;
    setGlobalSaveStatus("saving");
    setGlobalSaveError(null);

    // 🔴 아래는 전부 **지역 변수로** 들고 간다. 구조 단계가 지도의 키를 옮기는데
    //    setState 는 다음 렌더에야 닿으므로, 칸 값 단계가 state 를 읽으면 **옮기기
    //    전** 지도를 본다(임시 id 가 그대로 남아 그 줄이 통째로 건너뛰어진다).
    let pending: CasePendingDraftMaps = {
      nodeDrafts: pendingNodeDraftsById,
      nodePositions: pendingNodePositionsById,
      edgeDrafts: pendingEdgeDraftsById,
      routePoints: pendingRoutePointsByEdgeId,
    };
    let saveNodesById = nodesById;
    let saveEdgesById = edgesById;
    let brandNewNodeIds: string[] = [];
    let brandNewEdgeIds: string[] = [];
    let tokenAfterStructural = currentUpdatedAt;
    /** 🔴 한 건이라도 **서버에 닿았는가**. 닿았으면 되돌리기 스택을 비워야 한다(아래 까닭). */
    let sentAnyStructural = false;

    if (pendingStructuralOperations.length > 0) {
      // 🔵 타입 매개변수가 `null` 인 까닭은 executeStructuralOperation 머리말에 있다
      //    (진단 서버는 구조 검증 요약을 안 돌려준다).
      const structuralOutcome = await runProcedureStructuralSequence<null>(pendingStructuralOperations, currentUpdatedAt, executeStructuralOperation);
      const effects = collectStructuralIdEffects(structuralOutcome);
      sentAnyStructural = structuralOutcome.succeededOperations.length > 0;

      // 🔴 **남은 조작 세우기와 지도 옮기기를 반드시 함께** 한다. 하나만 하면
      //    어긋난다 — 목록만 바꾸면 초안이 임시 키를 든 채 남아 영영 안 가고,
      //    지도만 옮기면 이미 보낸 조작을 다시 보내 같은 노드가 두 번 만들어진다.
      setPendingStructuralOperations(structuralOutcome.remainingOperations);

      pending = {
        nodeDrafts: rebaseDraftMapAfterStructuralSave(pendingNodeDraftsById, effects, "node"),
        nodePositions: rebaseDraftMapAfterStructuralSave(pendingNodePositionsById, effects, "node"),
        edgeDrafts: rebaseEdgeDraftTargets(rebaseDraftMapAfterStructuralSave(pendingEdgeDraftsById, effects, "edge"), effects.resolvedIds),
        routePoints: rebaseDraftMapAfterStructuralSave(pendingRoutePointsByEdgeId, effects, "edge"),
      };
      setPendingNodeDraftsById(pending.nodeDrafts);
      setPendingNodePositionsById(pending.nodePositions);
      setPendingEdgeDraftsById(pending.edgeDrafts);
      setPendingRoutePointsByEdgeId(pending.routePoints);

      saveNodesById = rebaseSnapshotMap(nodesById, effects, "node");
      saveEdgesById = rebaseSnapshotMap(edgesById, effects, "edge");

      brandNewNodeIds = effects.createdNodeIds;
      brandNewEdgeIds = effects.createdEdgeIds;
      tokenAfterStructural = structuralOutcome.finalUpdatedAt;

      if (!canProceedToFieldSave(structuralOutcome)) {
        setCurrentUpdatedAt(tokenAfterStructural);
        finishAfterStructuralSend(sentAnyStructural);
        setGlobalSaveStatus("failed");
        setGlobalSaveError(structuralOutcome.failureMessage ?? "저장할 수 없는 구조 변경이 있어 저장을 멈췄습니다.");
        return;
      }
    }

    // 🔴 dirty 를 **다시** 센다. 위에서 키가 옮겨졌고 같은 저장에서 지워진 행의
    //    초안은 버려졌다 — 렌더 시점에 센 값은 이미 낡았다.
    const steps = planSaveSteps({
      dirtyNodes: includeBrandNewDraftEntries(computeDirtyNodeEntries(pending.nodeDrafts, saveNodesById), brandNewNodeIds, pending.nodeDrafts),
      serverNodesById: saveNodesById,
      dirtyPositionNodeIds: includeBrandNewDraftIds(computeDirtyPositionNodeIds(pending.nodePositions, saveNodesById), brandNewNodeIds, pending.nodePositions),
      dirtyEdges: includeBrandNewDraftEntries(computeDirtyEdgeEntries(pending.edgeDrafts, saveEdgesById), brandNewEdgeIds, pending.edgeDrafts),
      serverEdgesById: saveEdgesById,
      dirtyRouteEdgeIds: includeBrandNewDraftIds(computeDirtyRouteEdgeIds(pending.routePoints, saveEdgesById), brandNewEdgeIds, pending.routePoints),
    });

    const outcome = await runSaveSequence(steps, tokenAfterStructural, (step, expectedUpdatedAt) => executeSaveStep(step, expectedUpdatedAt, pending));

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
      // 🔴 구조는 전부 성공했는데(아니면 위에서 돌아갔다) 칸 값에서 멈춘 자리다 —
      //    보낸 구조 변경이 있으면 여기서도 뒤처리를 해야 한다.
      finishAfterStructuralSend(sentAnyStructural);
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

  /**
   * 🔴 구조 변경이 **한 건이라도 서버에 닿은 뒤** 저장이 멈췄을 때의 뒤처리.
   *
   *  ① **되돌리기 스택을 비운다.** 스택에 쌓인 스냅샷은 전부 「이 조작들은 아직
   *     안 보냈다」고 말하는데 이미 보냈다 — 그대로 [이전]을 누르고 다시 [저장]하면
   *     **같은 노드가 두 번 만들어진다.** 🔵 절차 편집기는 그 자리를 서버 편집
   *     이력으로 메우지만(planUndoStackAfterStructuralSave) 진단에는 서버 되돌리기가
   *     없다. 되돌릴 수 있는 칸을 잃는 쪽이, 지우지도 못할 복제본을 만드는 쪽보다 낫다.
   *  ② **서버 목록을 따라잡는다**(router.refresh). 방금 만들어진 노드·연결선은
   *     모아 둔 목록에서는 빠졌고 `nodes`/`edges` 프롭에는 아직 없다 — 새로 받아
   *     오지 않으면 그림에서 잠깐 사라진다. 🔵 저장 전 초안은 이 화면의 state 라
   *     refresh 가 지우지 않는다(이 파일 머리말의 EDITOR MODEL).
   */
  function finishAfterStructuralSend(sentAny: boolean) {
    if (!sentAny) return;
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
    // 🔴 2026-11-21(조각 C2) — **구조 목록도 함께 비운다.** 안 비우면 취소한 뒤에도
    //    노드 추가가 살아남아 다음 [저장]에 조용히 따라간다. 🔴 그리고 이것이
    //    **부분 실패로 남은 조작을 치우는 유일한 길**이다(그때 되돌리기 스택은 비워진다).
    setPendingStructuralOperations([]);
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
            // 🔴 막힌 구조 변경이 하나라도 있으면 **아예 못 누른다**(canSendStructural).
            //    보낼 수 있는 것만 골라 보내면 사람이 화면에서 한 일 하나가 설명 없이
            //    사라진다. 무엇이 막혔는지는 아래 빨간 칸이 줄마다 적는다.
            disabled={!hasAnyPendingChanges || !canSendStructural || globalSaveStatus === "saving"}
            onClick={() => void handleGlobalSave()}
            className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900"
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
          <button
            type="button"
            onClick={handleDiscardAllPending}
            disabled={!hasAnyPendingChanges}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
          >
            취소
          </button>
          {/* 저장 전 변경만 다룬다 — 이 편집기에는 서버 편집 이력이 없다.
              🔴 진행 중 표시(isUndoing/isRedoing)가 **둘 다 false** 가 되었다
              (2026-11-21, 조각 C2). 전에는 삭제를 되돌리려고 [이전]이 서버에 같은
              것을 다시 만들어서 isUndoing 이 진짜로 돌았는데, 지금은 되돌리기가
              목록을 한 칸 전으로 돌려놓을 뿐이라 서버에 닿지 않는다. */}
          <UndoRedoControls
            canUndo={canUndoStack(pendingUndoStack)}
            canRedo={canRedoStack(pendingUndoStack)}
            isUndoing={false}
            isRedoing={false}
            onUndo={handleUndo}
            onRedo={handleRedo}
          />
          {globalSaveStatus === "saved" && <span className="text-emerald-700 dark:text-emerald-400">저장 완료</span>}
          {globalSaveStatus === "failed" && globalSaveError && <span className="text-red-600 dark:text-red-400">{globalSaveError}</span>}
          {hasAnyPendingChanges && globalSaveStatus === "idle" && (
            <span className="text-zinc-500 dark:text-zinc-400">변경사항 {totalPendingCount}건 저장 대기 중</span>
          )}
        </div>
      )}

      {/* 🔴 **막는 것만으로는 부족하다.** [저장]이 꺼져 있는 까닭을 안 적으면 사람은
          그것을 고장으로 읽는다. 글은 「무엇을 해야 하는지」로 끝난다
          (PROCEDURE_STRUCTURAL_CONFLICT_LABELS — 그 모듈이 네 갈래의 글을 쥔다). */}
      {canEdit && structuralConflictMessages.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs dark:border-red-800 dark:bg-red-950">
          <p className="font-medium text-red-800 dark:text-red-300">저장할 수 없는 변경 {structuralConflictMessages.length}건이 있어 [저장]이 막혀 있습니다.</p>
          <ul className="flex list-disc flex-col gap-0.5 pl-4 text-red-700 dark:text-red-400">
            {structuralConflictMessages.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
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
            {/* 🔴 세는 것이 `nodes`(서버 목록)에서 **renderedNodes** 로 바뀌었다
                (2026-11-21, 조각 C2). 첫 노드를 추가해도 저장 전에는 서버 목록이
                0 이라, 안 바꾸면 「아직 노드가 없습니다」가 그대로 떠 있고 방금
                만든 노드가 **아예 안 그려진다.** */}
            {renderedNodes.length === 0 ? (
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
                  canEdit={canEdit}
                  draft={nodeDraft(selectedNode.id)}
                  onDraftChange={(patch) => updateNodeDraft(selectedNode.id, patch)}
                  onPositionDraftChange={(position) => setPendingNodePosition(selectedNode.id, position)}
                  onDelete={() => handleDeleteNode(selectedNode.id)}
                  resolveNodeDimensions={resolveNodeDimensions}
                />
              )}
              {selectedEdge && (
                <CaseFlowchartEdgePropertyPanel
                  edge={selectedEdge}
                  nodes={renderedNodes}
                  canEdit={canEdit}
                  draft={edgeDraft(selectedEdge.id)}
                  onDraftChange={(patch) => updateEdgeDraft(selectedEdge.id, patch)}
                  onDelete={() => handleDeleteEdge(selectedEdge.id)}
                  onQueueInsertNode={(input) => handleQueueInsertNodeOnEdge(selectedEdge.id, input)}
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
            <CaseFlowchartCreateNodePanel allNodes={renderedNodes} selectedNode={selectedNode} onQueueCreate={handleQueueCreateNode} />
          )}

          {/* 🔴 서 있는 조건이 `nodes.length > 0`(서버 목록)에서 **renderedNodes**
              로 바뀌었다 — 빈 Flowchart 에 노드를 하나 추가했을 때, 저장 전이라
              서버 목록은 아직 0 이라 [연결 추가] 칸이 안 선다. */}
          {rightPanelTab === "createEdge" && canEdit && renderedNodes.length > 0 && (
            <CaseFlowchartCreateEdgePanel
              nodes={renderedNodes}
              canEdit={canEdit}
              prefillFromNodeId={selectedNodeId}
              isPickingTarget={isPickingEdgeTarget}
              onStartPickTarget={() => setIsPickingEdgeTarget(true)}
              onCancelPickTarget={() => setIsPickingEdgeTarget(false)}
              pickedTarget={pickedEdgeTarget}
              onQueueCreate={handleQueueCreateEdge}
            />
          )}
        </div>
      </div>
    </div>
  );
}
