"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  MANUAL_TECHNICAL_NODE_TYPE_CODES,
  PROCEDURE_NODE_TYPE_CODES,
  procedureNodeTypeLabels,
  type ProcedureNodeType,
} from "@/lib/domain/procedure-template-types";
import type { EditorNodeRow } from "@/lib/db/queries/procedure-template-editor";
import {
  resolveEffectiveNodePosition,
  computeCenterAlignedRelativePosition,
  resolveColumnSnappedRelativePosition,
  type RelativeDirection,
  type ColumnSnapCandidate,
} from "@/lib/graph-editor-core/layout";
import type { ProcedureNodeFieldDraft } from "@/lib/domain/procedure-editor-save-state";
import type { NextProcedureLinkCandidate } from "@/lib/db/queries/procedure-templates";
import { isNextProcedureLinkAllowedOn } from "@/lib/domain/procedure-next-procedure-link";
import { NODE_VISUAL_CONFIG, getSemanticNodeVisualType } from "@/lib/domain/procedure-visual-language";

/** Phase 5C-5B — fixed spacing for "상대 위치로 이동": vertical reuses createProcedureTemplateNode's own default node-stacking gap (150) for consistency; horizontal is a fixed step between columns. 노드 폭에 상한이 없어진 뒤로는 "가장 넓은 노드를 비켜갈 만큼"이라는 기준이 성립하지 않으므로, 폭이 아니라 사람이 보기 좋은 열 간격으로 정한다(겹치는 경우 열 스냅과 직접 드래그로 조정). */
const RELATIVE_POSITION_SPACING = { horizontal: 140, vertical: 150 } as const;

/** 5C-6D-1D — same derivation as Case Flowchart's own COLUMN_SNAP_TOLERANCE: half the standard horizontal spacing, close enough to catch "same column, slightly different due to a different reference node's width" while staying far short of a full column-to-column distance. */
const COLUMN_SNAP_TOLERANCE = RELATIVE_POSITION_SPACING.horizontal / 2;

/**
 * Node property side panel (Phase 4A; safe fields converted to a
 * screen-owned pending draft in 5C-6D-1C; node-type UX moved into the
 * primary block in the 5C-6D-1F Procedure-node-type-UX checkpoint) —
 * title/description/instructions/sortOrder/isActive are a controlled draft
 * the screen owns (`draft`/`onDraftChange`); they no longer save through a
 * local button — the screen's global [저장] persists them together with any
 * other pending safe-field/position/route changes.
 *
 * Node type is displayed as a normal `<select>` in the primary block (same
 * visual position/appearance as every other primary field), but it is NOT
 * part of `draft` — it never becomes one of the safe-to-defer fields the
 * screen's five draft maps carry. 🔴 2026-11-20(조각 4) 에 「It triggers the
 * exact same IMMEDIATE … changeProcedureTemplateNodeTypeAction call」이 **거짓이
 * 됐다** — 유형 변경도 [저장] 때까지 모였다가 간다(아래 조각 4 절). 다만 **어느
 * 액션으로 가는지는 그대로**다(CHANGE_NODE_TYPE history action, not UPDATE_NODE).
 * `newNodeType` resyncs to `node.nodeType` via adjust-state-
 * during-render whenever the selected node itself changes (this panel is not
 * remounted on selection change — see CreateEdgePanel's own doc comment for
 * the same convention) so the select never shows a stale type left over
 * from a previously-selected node.
 *
 * 🔴 2026-11-03(줄기 B-②) — 노드 유형 변경의 확인 창을 **TECHNICAL_TASK 에서만**
 * 없앴다. 사용자가 "추가/수정할 때마다 팝업이 뜬다"고 한 그것이고, 줄기 B-① 로
 * 유형 변경도 [이전]으로 되돌릴 수 있게 됐다 — 기술 작업 절차에서는 드롭다운을
 * 고르는 순간 바로 적용되고, 됐다는 증거는 **지도에서 노드 모양이 바뀌는 것**이다.
 *
 * 🔴 그런데 FULL_SERVICE/REFERENCE 는 창을 **남겼다.** 그 둘은 서버가 사유를
 * 필수로 요구하고(changeProcedureTemplateNodeType 의
 * `template.category !== "TECHNICAL_TASK" && isBlank(reason)` → INVALID_INPUT),
 * 사유를 받을 칸이 이 창 안에만 있기 때문이다. 창만 걷어내면 유형 변경이
 * "눌러도 빨간 글씨만 뜨는" 죽은 기능이 된다. 즉 남긴 기준은 "삭제라서"가
 * 아니라 **"그 창이 확인이 아니라 입력을 받고 있어서"**다. (연결 추가·재연결의
 * 사유 칸은 원래부터 패널에 있어서 창을 통째로 없앨 수 있었다.)
 *
 * ── 🔴 2026-11-20(조각 4) — 유형 변경·삭제도 **[저장]을 눌러야 간다** ─────
 * 쓰는 분의 요청으로 둘 다 모아 두는 쪽으로 옮겼다. 이 패널은 이제
 * changeProcedureTemplateNodeTypeAction·deleteProcedureTemplateNodeAction 을 부르지
 * 않고, 화면에 「이걸 해 달라」고 적어 넘긴다 — 화면이 [저장]에서 **같은 액션을**
 * 부른다(서버는 한 글자도 안 바뀌었다).
 *
 * 🔴 그래서 「실패하면 드롭다운을 되돌린다」가 **성립하지 않는다.** 여기서는 실패할
 * 일이 없고, 고른 유형은 그림에도 곧바로 비친다(저장 전 미리보기). 서버가 거절하면
 * [저장] 줄에서 알리고, 모아 둔 조작은 그대로 남아 다시 보낼 수 있다.
 *
 * 🔵 사유를 받는 확인 창은 **그대로 남는다.** 서버가 FULL_SERVICE/REFERENCE 에서
 * 빈 사유를 거절하는 규칙이 안 바뀌었고, 그 사유는 이제 모아 둔 조작의 reason 칸에
 * 실려 [저장] 때 함께 간다.
 *
 * 🔴 「재검증 결과: 오류 N건 · 경고 M건」 한 줄은 **없앴다.** 그 값은 서버가 유형
 * 변경에 답하며 주던 것인데, 이제 그 답이 [저장] 때 오기 때문이다. 없어진 것이
 * 아니라 **[검증] 탭으로 옮겨 간다** — 화면이 저장 뒤 마지막 요약을 거기에 싣는다.
 */
export default function NodePropertyPanel({
  node,
  allNodes,
  isPickingReference = false,
  onStartPickReference,
  onCancelPickReference,
  pickedReferenceNode = null,
  canEdit,
  draft,
  onDraftChange,
  onPositionDraftChange,
  resolveNodeDimensions,
  renderedPositions,
  onQueueChangeType,
  canDelete,
  deleteBlockedReason = null,
  attachedEdgeCount = 0,
  onQueueDelete,
  canPosition,
  isTechnical,
  isUnsavedNode = false,
  nextProcedureCandidates = [],
}: {
  node: EditorNodeRow;
  /** Phase 5C-5B — every node in the template, for "상대 위치로 이동"'s reference-node picker. 5C-6D-1D — also every OTHER node's current visible position/dimensions feed column-snap candidacy, so this must be the screen's rendered (baseline + pending-draft-merged) list, never the raw server rows alone. */
  allNodes: EditorNodeRow[];
  /**
   * "화면에서 선택" — 기준 노드를 목록에서 고르는 대신 캔버스에서 직접 클릭해
   * 지정하는 모드. 클릭을 받는 쪽이 캔버스라 모드 자체는 화면(부모)이 소유하고,
   * 여기서는 상태 표시와 시작/취소 요청만 한다(CreateEdgePanel의 대상 노드
   * 고르기와 같은 규약).
   */
  isPickingReference?: boolean;
  onStartPickReference?: () => void;
  onCancelPickReference?: () => void;
  /** 캔버스에서 고른 결과. 같은 노드를 다시 골라도 반영되도록 seq를 함께 올린다. */
  pickedReferenceNode?: { nodeId: string; seq: number } | null;
  canEdit: boolean;
  /** 5C-6D-1C — screen-owned pending draft for title/description/instructions/sortOrder/isActive; already reflects any locally-unsaved edit (this panel never keeps its own copy). */
  draft: ProcedureNodeFieldDraft;
  onDraftChange: (patch: Partial<ProcedureNodeFieldDraft>) => void;
  /** 5C-6D-1D — sets (or replaces) `node`'s pending position, same deferred model as a canvas drag: no server call here, the screen's global [저장] persists it later via LAYOUT_AND_ROUTES. Replaces the old immediate saveProcedureTemplateLayoutAction call. */
  onPositionDraftChange: (position: { x: number; y: number }) => void;
  /** 5C-6D-1D — the screen's single, already-composed effective-dimension resolver (measured-first via ReactFlowInstance.getInternalNode, estimate-fallback) — see this file's own DIMENSION SOURCE doc comment below for why this must be the SAME function instance the screen composes once, not a locally re-derived copy. */
  resolveNodeDimensions: (n: EditorNodeRow) => { width: number; height: number };
  /**
   * **그림이 실제로 그린 자리**, 노드 id 마다(2026-11-05). 위
   * resolveNodeDimensions 의 자리 쪽 짝이고, 같은 까닭으로 화면이 한 벌만
   * 들고 있는 것을 그대로 받는다 — 여기서 다시 세면 두 곳이 조용히 갈린다.
   * 자리를 정하는 규칙은 그림(ProcedureFlowGraph 의 resolveBaselinePosition)에만
   * 있다.
   *
   * 🔵 안 넘기거나 아직 안 들어온 노드는 아래 currentPosition 이 **전 동작**
   * (저장된 자리)으로 떨어진다. 프롭을 안 넘기는 호출부는 지금 없다.
   */
  renderedPositions?: ReadonlyMap<string, { x: number; y: number }>;
  /** 🔴 서버에 보내지 않고 **모아 둔다**(2026-11-20, 조각 4). 그림의 노드 모양은 그 자리에서 바뀐다. */
  onQueueChangeType: (newNodeType: ProcedureNodeType, reason: string | null) => void;
  /** Phase 5C-5B — true only for a TECHNICAL_TASK DRAFT (see ProcedureTemplateEditorScreen); always false for FULL_SERVICE/REFERENCE, which never gained this new structural-delete capability. */
  canDelete: boolean;
  /**
   * 지금은 지울 수 없는 까닭(2026-11-20, 조각 4). null 이면 지울 수 있다.
   *
   * 🔴 **서버 규칙을 앞당겨 보여 주는 것**이지 새로 막는 것이 아니다. 모아 두는
   * 지금은 서버의 거절이 **[저장]을 누를 때까지** 안 보이는데, 그림에서는 노드가
   * 이미 사라져 보여서 「왜 안 됐지」가 된다.
   *
   * 🔴 2026-11-21 — **들어오는 까닭이 하나로 줄었다.** 「연결선이 붙어 있다」는
   * 더 이상 막는 까닭이 아니다(쓰는 분 결정 — 붙은 선은 노드와 함께 지워진다).
   * 지금 들어오는 것은 체크리스트 · 고장 진단표 내용이 걸린 노드 하나뿐이다.
   */
  deleteBlockedReason?: string | null;
  /**
   * 이 노드를 지우면 **함께 지워질 연결선의 수**(2026-11-21). 0 이면 아무 글도
   * 안 선다.
   *
   * 🔴 확인 창을 안 띄우는 대신(삭제는 [이전] 한 번으로 돌아온다) 누르기 **전에**
   * 수가 보이게 하는 값이다. 안 보이면 선 다섯이 달린 노드를 지운 사람이 제가
   * 무엇을 지웠는지 모른 채 [저장]을 누른다.
   * 🔵 **막혔을 때는 안 보인다**(아래 쓰는 자리). 못 지우는 노드 옆에서 「함께
   * 지워집니다」는 거짓말이다.
   */
  attachedEdgeCount?: number;
  /** 🔴 서버에 보내지 않고 **모아 둔다**. 그림에서는 그 자리에서 사라진다. */
  onQueueDelete: (reason: string | null) => void;
  /** Phase 5C-5B — same gate as canDelete; a separate prop only so the capability stays independently named/readable at the call site. */
  canPosition: boolean;
  /** Phase 5C-5B usability — true for TECHNICAL_TASK (any status/role — purely a UI relaxation of the mandatory-reason requirement, matching the mutation layer's own category-aware validation). FULL_SERVICE keeps requiring a reason for node-type changes, unchanged. */
  isTechnical: boolean;
  /**
   * 이 노드가 **아직 서버에 없는가**(2026-11-20, 조각 4 — 저장 전에 추가한 노드).
   *
   * 🔴 두 가지를 바꾼다. ① 고를 수 있는 유형이 **일곱**으로 좁아진다 —
   * [체크리스트]·[고장 진단표]는 서버가 **새로 만들 수 없는** 유형이라
   * (MANUAL_TECHNICAL_NODE_TYPE_CODES), 고르게 두면 접기가 막아 [저장]이 통째로
   * 멈춘다(TEMP_NODE_TYPE_NOT_CREATABLE). ② 「정렬 순서」 칸이 잠긴다 — 그 번호는
   * 서버가 만들 때 매기고, 화면이 세운 받침 0 을 보내면 그 번호를 0 으로 덮는다.
   */
  isUnsavedNode?: boolean;
  /**
   * 「다음 절차」로 고를 수 있는 절차들(2026-11-04, 줄기 B ④ 조각 ②).
   * 🔵 **노드 유형과 무관하다** — 어느 유형에서 고르든 후보는 같다(가려 내는
   * 잣대가 노드가 아니라 가리켜지는 절차 쪽에 있다).
   * 서버가 거른 것을 그대로 그린다 — 게시본 · 기술작업 · 자기 계열 제외
   * (queries/procedure-templates.ts 의 listNextProcedureLinkCandidates).
   * 🔵 기본값이 빈 배열이라, 안 넘기는 호출부에서는 「이어가지 않음」만 보인다.
   */
  nextProcedureCandidates?: NextProcedureLinkCandidate[];
}) {
  // 🔴 **고를 수 있는 유형**. 저장 전 노드는 일곱, 이미 저장된 노드는 아홉이다.
  // 서버의 비대칭을 그대로 옮긴 것이다 — 「바꿀 수 있는 유형」(아홉)과 「새로 만들 수
  // 있는 유형」(일곱)이 다르고, 아직 안 만든 노드는 뒤엣것을 따라야 한다.
  // 🔵 여기서 목록을 손으로 적지 않는다 — 두 상수가 서버 쪽 관문과 같은 것이다.
  //
  // 🔴 **블록 주석(`/** */`)으로 적으면 안 된다.** 이 저장소의 화면 시험들은
  // 원본 글자를 읽어 재는데, 그 걷어내기가 `{` 바로 뒤의 `/*` 를 **JSX 주석의
  // 시작**으로 읽는다 — 함수 몸통의 여는 중괄호가 그 `{` 가 되어, 여기부터 한참
  // 아래 JSX 주석의 `*/}` 까지 1만 자가 통째로 지워진다(2026-11-20 에 실제로
  // 그렇게 시험 열몇 개가 깨졌다). 몸통 첫 줄의 주석은 `//` 로 적는다.
  const nodeTypeOptions = isUnsavedNode ? MANUAL_TECHNICAL_NODE_TYPE_CODES : PROCEDURE_NODE_TYPE_CODES;

  // Adjust-state-during-render (same convention as CreateEdgePanel's
  // prefillFromNodeId resync) — this panel is not remounted on canvas
  // selection change, so `newNodeType`/dialog/reason state must explicitly
  // resync to the newly-selected node whenever `node.id` changes, or the
  // select would keep showing a previous node's type/dialog.
  const [prevNodeId, setPrevNodeId] = useState(node.id);
  const [prevNodeType, setPrevNodeType] = useState<ProcedureNodeType>(node.nodeType);
  const [newNodeType, setNewNodeType] = useState<ProcedureNodeType>(node.nodeType);
  const [confirmingTypeChange, setConfirmingTypeChange] = useState(false);
  const [typeChangeReason, setTypeChangeReason] = useState("");
  if (node.id !== prevNodeId) {
    setPrevNodeId(node.id);
    setPrevNodeType(node.nodeType);
    setNewNodeType(node.nodeType);
    setConfirmingTypeChange(false);
    setTypeChangeReason("");
  } else if (node.nodeType !== prevNodeType) {
    // 🔴 2026-11-20(조각 4) — **같은 노드인데 유형만 바뀌는 길이 생겼다.** 모아 둔
    //    조작은 [이전]으로 되돌릴 수 있고, 그때 들어오는 행의 유형이 드롭다운과
    //    어긋난다. 안 맞추면 되돌렸는데 드롭다운만 옛 값으로 남아 **화면이
    //    거짓말을 한다**(전에는 서버 거절 때만 그랬고, 그 자리를 handleChangeType
    //    이 손으로 되돌리고 있었다).
    setPrevNodeType(node.nodeType);
    setNewNodeType(node.nodeType);
  }
  const typeDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = typeDialogRef.current;
    if (!dialog) return;
    if (confirmingTypeChange && !dialog.open) dialog.showModal();
    else if (!confirmingTypeChange && dialog.open) dialog.close();
  }, [confirmingTypeChange]);

  const [deleteReason, setDeleteReason] = useState("");

  const otherNodes = allNodes.filter((n) => n.id !== node.id);

  /**
   * 지금 지정된 「다음 절차」가 **고를 수 있는 목록에 없을 때** 그 id.
   * 가리킨 절차가 만료·삭제됐거나 참고용으로 바뀌면 이렇게 된다. 이 값을
   * 따로 세어 두지 않으면 `<select>` 가 값을 못 찾아 「이어가지 않음」으로
   * 보이고, 사람이 아무것도 안 건드려도 다음 저장에서 지정이 조용히 지워진다.
   */
  const orphanedNextProcedureId =
    draft.nextProcedureTemplateId !== null &&
    !nextProcedureCandidates.some((c) => c.id === draft.nextProcedureTemplateId)
      ? draft.nextProcedureTemplateId
      : null;
  const [referenceNodeId, setReferenceNodeId] = useState(otherNodes[0]?.id ?? "");
  // 캔버스에서 고른 기준 노드를 받아 반영한다 — 같은 노드를 다시 골라도 반영되도록
  // 화면이 seq를 함께 올려 보낸다. 자기 자신은 기준이 될 수 없으므로 무시한다.
  const [prevPickedReferenceSeq, setPrevPickedReferenceSeq] = useState(pickedReferenceNode?.seq ?? 0);
  if (pickedReferenceNode && pickedReferenceNode.seq !== prevPickedReferenceSeq) {
    setPrevPickedReferenceSeq(pickedReferenceNode.seq);
    if (pickedReferenceNode.nodeId !== node.id) setReferenceNodeId(pickedReferenceNode.nodeId);
  }

  /**
   * 드롭다운에서 유형을 고른 순간.
   *
   * 🔴 기술 작업 절차(TECHNICAL_TASK)는 **확인 창 없이 바로** 적용한다 —
   * 줄기 B-② 가 없앤 그 팝업이다. 그 밖의 분류는 서버가 사유를 필수로 요구해
   * 창을 열어 사유를 받는다(이 파일 머리말 참고).
   *
   * 어느 쪽이든 **같은 유형을 다시 고르면 아무 일도 일어나지 않는다** — 서버
   * 호출도, 이력 한 줄도, 되돌리기 한 걸음도 생기지 않는다.
   *
   * 🔵 고른 값을 handleChangeType 에 **인자로** 넘긴다. setNewNodeType 은 다음
   * 렌더에야 반영되므로, 같은 이벤트 안에서 state 를 읽으면 직전 유형을 보내게
   * 된다(확인 창이 있던 시절에는 창을 띄우는 사이에 렌더가 한 번 돌아 이 문제가
   * 드러나지 않았다).
   */
  function handleSelectNodeType(value: ProcedureNodeType) {
    setNewNodeType(value);
    if (value === node.nodeType) return;
    if (isTechnical) {
      handleChangeType(value);
      return;
    }
    setConfirmingTypeChange(true);
  }

  function handleCancelTypeChange() {
    setConfirmingTypeChange(false);
    setNewNodeType(node.nodeType);
    setTypeChangeReason("");
  }

  const canConfirmTypeChange = newNodeType !== node.nodeType && (isTechnical || typeChangeReason.trim().length > 0);

  /**
   * 유형 변경의 본체. 들어오는 길이 둘이다 — 드롭다운에서 바로(TECHNICAL_TASK)와
   * 확인 창의 [적용](그 밖의 분류). 어느 쪽이든 같은 함수를 지난다.
   *
   * 🔴 2026-11-20(조각 4) — **서버로 안 간다.** 화면이 모아 두었다가 [저장]에서
   * 같은 액션을 부른다. 그래서 실패 검사도, 「도는 중」 잠금도, 드롭다운 되돌리기도
   * 여기서는 할 일이 없다 — 거절은 [저장] 때 한 자리에서 나온다.
   *
   * 🔵 사유는 **창에서 받은 그대로** 실어 보낸다(TECHNICAL_TASK 는 빈 글자라 null).
   * 서버가 FULL_SERVICE/REFERENCE 에서 빈 사유를 거절하는 규칙은 안 바뀌었고,
   * canConfirmTypeChange 가 전과 같은 식으로 그것을 지킨다.
   */
  function handleChangeType(targetNodeType: ProcedureNodeType) {
    onQueueChangeType(targetNodeType, typeChangeReason.trim() || null);
    setConfirmingTypeChange(false);
    setTypeChangeReason("");
  }

  /**
   * **화면에 실제로 그려져 있는 자리** — 그림이 올려보낸 값을 그대로 쓴다.
   *
   * 🔴 2026-11-05 에 고쳤다. 전에는 이 함수가 `resolveEffectiveNodePosition(…,
   * "USER")` 하나였고, 주석에 "Current visible position" 이라고 적혀 있었다 —
   * **사실이 아니었다.** 기술 작업 절차의 노드는 저장된 자리가 없는 것이
   * 기본이고(개발 DB 실측: 초안 하나는 22개 중 0개), 그런 노드를 그림은 제
   * 나름의 자동 배치로 그린다. 그래서 그 함수는 「만든 차례대로 쌓은 숫자」
   * (x 가 전부 0)를 돌려줬다. 실측으로, 화면 x = −486 에 서 있는 노드를 기준
   * 삼아 [아래]를 누르면 대상이 x = 0 으로 가 **다른 노드 위에 완전히
   * 포개졌고**, [오른쪽]은 758px 어긋났다.
   *
   * 🔵 받침은 전 동작 그대로다 — 지도에 없는 노드(아직 안 올라왔거나 프롭을
   * 안 받은 호출부)는 저장된 자리로 떨어진다. 이 화면의 rendered 행은 1C 의
   * 그리기 길이 끌고 있는·방금 저장한 자리를 이미 userPositionX/Y 에 실어
   * 두므로, 그 받침도 「서버의 낡은 값」은 아니다.
   */
  function currentPosition(n: EditorNodeRow): { x: number; y: number } {
    const rendered = renderedPositions?.get(n.id);
    if (rendered) return rendered;
    return resolveEffectiveNodePosition({ positionX: n.positionX, positionY: n.positionY, userPositionX: n.userPositionX, userPositionY: n.userPositionY }, "USER");
  }

  /**
   * "상대 위치로 이동" (5C-6D-1D parity with Case Flowchart) — LEFT/RIGHT/UP/
   * DOWN of the reference node's current visible position, now:
   *  (1) center-Y aligned for LEFT/RIGHT (computeCenterAlignedRelativePosition)
   *      — two nodes of different height still land with matching centers,
   *      not raw top-left y;
   *  (2) column-snapped for LEFT/RIGHT (resolveColumnSnappedRelativePosition)
   *      — if an existing node already occupies this column directly above
   *      the intended position, the target lands exactly on that node's
   *      center-x, using every OTHER node's CURRENT (possibly still
   *      unsaved) position/dimensions, never last-saved-only;
   *  (3) dimension-sourced from resolveNodeDimensions (measured-first,
   *      composed once in the screen — see this component's own prop doc
   *      comment) for the reference, the target, AND every column-snap
   *      candidate, so none of them can drift onto a different geometry
   *      rule than the others.
   * A LOCAL pending-position update only (onPositionDraftChange) — no
   * server call here; [저장] persists it later, exactly like a canvas drag.
   *
   * 🔴 2026-11-05 — 네 방향이 **전부 중심점 기준**이 됐다. UP/DOWN 의 세로
   * 간격이 윗변 간격에서 **중심 간 간격**으로 바뀌었고(그 함수 주석에 까닭과
   * 실측값), 기준 노드의 자리는 저장 좌표가 아니라 **화면에 그려진 자리**를
   * 쓴다(위 currentPosition). 두 고침이 함께 있어야 뜻이 있다 — 기준 자리가
   * 틀린 채로 간격만 맞추면 어긋난 자리에서 정확히 150 을 세게 된다.
   */
  function handleRelativePosition(direction: RelativeDirection) {
    const reference = otherNodes.find((n) => n.id === referenceNodeId);
    if (!reference) return;
    const refPos = currentPosition(reference);
    const referenceDims = resolveNodeDimensions(reference);
    const targetDims = resolveNodeDimensions(node);
    const candidate = computeCenterAlignedRelativePosition(
      { x: refPos.x, y: refPos.y, width: referenceDims.width, height: referenceDims.height },
      direction,
      RELATIVE_POSITION_SPACING,
      { width: targetDims.width, height: targetDims.height }
    );

    if (direction !== "LEFT" && direction !== "RIGHT") {
      onPositionDraftChange(candidate);
      return;
    }

    const existingNodes: ColumnSnapCandidate[] = otherNodes
      .filter((n) => n.id !== reference.id)
      .map((n) => {
        const pos = currentPosition(n);
        const dims = resolveNodeDimensions(n);
        return { id: n.id, x: pos.x, y: pos.y, width: dims.width, height: dims.height };
      });
    const snapped = resolveColumnSnappedRelativePosition({
      candidateX: candidate.x,
      candidateY: candidate.y,
      targetWidth: targetDims.width,
      targetHeight: targetDims.height,
      existingNodes,
      excludeNodeIds: [],
      tolerance: COLUMN_SNAP_TOLERANCE,
    });
    onPositionDraftChange({ x: snapped.x, y: snapped.y });
  }

  /**
   * ── 고른 노드의 **유형 딱지** 색 (2026-11-20) ──────────────────────────
   * 🔴 **색을 여기서 새로 짓지 않는다.** 캔버스의 노드 상자가 쓰는 그림 언어
   * (procedure-visual-language 의 NODE_VISUAL_CONFIG)에서 그대로 꺼낸다 —
   * 캔버스와 패널의 색이 다르면 「고른 상자」와 「패널」을 눈으로 잇지 못해
   * 오히려 더 헷갈린다.
   *
   * 🔵 밝은/어두운 두 벌을 CSS 변수로 심고 Tailwind 의 `dark:` 가 고르게 한다 —
   * 색이 **데이터에서 오는데**(유형마다 다른 hex) 어둠 전환은 **클래스 기반**이라,
   * 둘을 잇는 자리가 변수뿐이다. ProcedureNodeChip 이 같은 변수 이름으로 같은
   * 일을 한다(그 파일의 cssVars 주석).
   */
  const nodeTypeVisual = NODE_VISUAL_CONFIG[getSemanticNodeVisualType(node.nodeType)];
  const nodeTypeBadgeVars = {
    "--node-bg-light": nodeTypeVisual.bgLight,
    "--node-bg-dark": nodeTypeVisual.bgDark,
    "--node-border-light": nodeTypeVisual.borderLight,
    "--node-border-dark": nodeTypeVisual.borderDark,
    "--node-text-light": nodeTypeVisual.textLight,
    "--node-text-dark": nodeTypeVisual.textDark,
  } as CSSProperties;

  /**
   * [노드 삭제] — 🔴 **모아 두기만 한다**(2026-11-20, 조각 4). 그림에서는 그 자리에서
   * 사라지고, 서버로는 [저장] 때 같은 액션이 나간다.
   *
   * 🔵 사유 칸은 그대로다 — 모아 둔 조작의 reason 칸에 실려 함께 간다.
   */
  function handleDelete() {
    onQueueDelete(deleteReason.trim() || null);
    setDeleteReason("");
  }

  return (
    <div className="flex flex-col gap-4 text-xs">
      <div>
        {/*
          ── 🔴 고른 노드의 **유형을 글자로** 세운다 (2026-11-20) ────────────
          쓰는 분이 [작업] 노드인 줄 알고 고른 것이 [검사]·[조치]였다. 그때까지
          유형을 알 길은 **아래 드롭다운을 열어 보는 것**뿐이었고, 캔버스의 상자도
          색과 모양으로만 갈랐다. 운영 실측으로 [조치] 420개 중 33개는 제목에
          「작업」이라는 말이 들어 있다(사람이 적은 제목이다) — 제목도 단서가 못 된다.

          🔴 **색만으로 가르지 않는다** — 이 저장소의 규칙이다(색약인 사람에게는
          같아 보인다). 게다가 여기서는 색이 애초에 못 가른다: [작업]·[검사]·
          [조치]는 그림 언어에서 **같은 꼴·같은 색 식구**라(TASK 로 모인다) 색만
          보면 셋이 똑같다. 그래서 **글자가 본체이고 색은 캔버스와 잇는 거들기**다.

          🔵 **캔버스의 노드 상자에는 유형 글자를 안 넣었다**(사용자 결정).
          노드가 수백 개라 상자마다 한 줄씩 더하면 상자가 커지고 그림이 빽빽해지며,
          이번에 푸는 문제는 「지금 **고른** 노드가 무엇인가」다. 상자 쪽은 유형
          전체로 보면 모양·색이 갈리고, 색까지 같은 [작업]·[검사]·[조치] 셋은
          아이콘이 갈린다(getNodeIconKey) — 고르면 이 딱지가 글자로 받아 준다.

          🔴 `node.nodeType` 을 본다 — 아래 드롭다운의 `newNodeType` 이 아니다.
          그 값은 아직 서버에 안 간 「고르는 중」일 수 있어서, 그것으로 그리면
          적용되지 않은 유형을 **적용된 것처럼** 보여 준다(「다음 절차」 칸을
          가리는 잣대도 같은 까닭으로 `node.nodeType` 이다).
        */}
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">노드 속성</h3>
          <span
            data-node-type={node.nodeType}
            style={nodeTypeBadgeVars}
            className="rounded-full border px-2 py-0.5 text-[11px] font-semibold bg-[var(--node-bg-light)] dark:bg-[var(--node-bg-dark)] border-[var(--node-border-light)] dark:border-[var(--node-border-dark)] text-[var(--node-text-light)] dark:text-[var(--node-text-dark)]"
          >
            {procedureNodeTypeLabels[node.nodeType]}
          </span>
        </div>
        <p className="mt-0.5 font-mono text-[10px] text-zinc-400 dark:text-zinc-600">
          {node.nodeCode} · {node.sourceWorksheet ?? "-"}
          {node.sourceShapeId ? ` · shape#${node.sourceShapeId}` : ""}
        </p>
        <div className="mt-1 flex flex-wrap gap-1">
          {node.hasChecklistContent && <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700 dark:bg-violet-950 dark:text-violet-400">체크리스트 연결됨</span>}
          {node.hasTroubleshootingContent && <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400">고장 진단표 연결됨</span>}
        </div>
      </div>

      <label className="flex flex-col gap-1">
        제목 (Shift+Enter로 줄바꿈)
        <textarea
          rows={2}
          value={draft.title}
          onChange={(e) => onDraftChange({ title: e.target.value })}
          onKeyDown={(e) => {
            // Shift+Enter inserts a newline (native textarea behavior, left
            // alone); plain Enter is swallowed — it never inserts a line
            // break, and this panel has no Enter-to-submit behavior to
            // accidentally trigger either way (the screen's global [저장]
            // saves this along with every other pending change).
            if (e.key === "Enter" && !e.shiftKey) e.preventDefault();
          }}
          disabled={!canEdit}
          className="resize-y rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm whitespace-pre-wrap disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
      <label className="flex flex-col gap-1">
        설명 (부제)
        <textarea rows={2} value={draft.description} onChange={(e) => onDraftChange({ description: e.target.value })} disabled={!canEdit} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      {/*
        🔵 **「작업 지시 요약」이라는 이름은 그대로 둔다**(2026-11-20에 한 번
        따져 보고 안 고쳤다). 이 말이 [검사]·[조치] 노드를 [작업]으로 오해하는 데
        한몫했지만, 고치지 않은 까닭이 셋이다:
         · 이 낱말은 **한 화면의 것이 아니다** — 수리건 플로차트 패널
           (CaseFlowchartNodePropertyPanel)과 입력 검증의 오류 문구
           (validation/repair-case-flowchart-graph-input.ts)가 같은 글자를 쓴다.
           여기만 고치면 같은 칸을 두 이름으로 부르게 된다.
         · 「작업 지시」는 여기서 유형 이름이 아니라 **「무엇을 어떻게 하는지」**라는
           일반적인 뜻이고, 그 칸은 아홉 유형 전부에 똑같이 있다.
         · 혼동의 진짜 원인은 **유형이 어디에도 글자로 없었다**는 것이었고, 그것은
           바로 위 유형 딱지가 받는다 — 딱지가 [검사]라고 적고 있으면 이 칸 이름을
           유형으로 읽을 자리가 없다.
      */}
      <label className="flex flex-col gap-1">
        작업 지시 요약
        <textarea rows={3} value={draft.instructions} onChange={(e) => onDraftChange({ instructions: e.target.value })} disabled={!canEdit} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      <label className="flex flex-col gap-1">
        노드 유형
        {/*
          🔴 2026-11-20(조각 4) — 「변경 중...」과 잠금이 사라졌다. 도는 것이
          없어졌기 때문이다(서버 호출이 [저장] 때로 옮겨 갔다). 두 번 고르는 것은
          이제 **모아 둔 목록의 마지막 것만 남는 것**으로 끝난다(접기 규칙 6번).

          🔴 **저장 전 노드는 고를 수 있는 유형이 일곱이다** — 위 nodeTypeOptions.
          아홉을 그대로 두면 [체크리스트]·[고장 진단표]를 고를 수 있고, 그러면
          접기가 TEMP_NODE_TYPE_NOT_CREATABLE 로 막아 **[저장]이 통째로 멈춘다**.
          고를 수 없게 하는 쪽이 저장을 막는 쪽보다 낫다.
        */}
        <select
          value={newNodeType}
          onChange={(e) => handleSelectNodeType(e.target.value as ProcedureNodeType)}
          disabled={!canEdit}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
        >
          {nodeTypeOptions.map((t) => (
            <option key={t} value={t}>
              {procedureNodeTypeLabels[t]}
            </option>
          ))}
        </select>
      </label>

      {/*
        ── 「다음 절차」 — 달 수 있는 유형에만 (2026-11-04, 줄기 B ④ 조각 ②) ──
        🔴 **글자(`=== "END"`)를 박지 않고 상수를 본다**(2026-11-20). 전에는 여기에
        END 가 박혀 있었고, [작업]을 열 때 이 한 줄을 따로 찾아 고쳐야 했다 —
        다음에 유형을 또 열면 그때도 빠뜨릴 자리다. 허용 목록은
        domain/procedure-next-procedure-link.ts 한 곳에 있고 서버 재검증·게시 전
        검증기가 같은 상수를 본다.

        🔴 `node.nodeType` 을 본다. 위 드롭다운의 `newNodeType` 이 아니다 —
        그 값은 아직 서버에 안 간 「고르는 중」일 수 있고, 그때 이 칸을 그리면
        사람이 고른 값이 저장 단계에서 달 수 없는 유형이라는 이유로 거절당한다.

        🔵 **고르는 칸만 둔다.** 저장은 화면 상단의 [저장]이 다른 변경과 함께
        한다(이웃 정렬 순서·활성 상태와 같은 규약) — 여기만 즉시 저장하면
        「저장 안 함」으로 떠난 사람의 다른 수정과 이 값이 어긋난다.
      */}
      {isNextProcedureLinkAllowedOn(node.nodeType) && (
        <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
          다음 절차
          <select
            value={draft.nextProcedureTemplateId ?? ""}
            onChange={(e) =>
              onDraftChange({ nextProcedureTemplateId: e.target.value === "" ? null : e.target.value })
            }
            disabled={!canEdit}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">이어가지 않음</option>
            {nextProcedureCandidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} (v{c.version})
              </option>
            ))}
            {/*
              🔴 저장된 값이 후보에 없을 때 — 가리킨 절차가 만료됐거나 휴지통에
              갔거나 참고용으로 바뀐 경우다. 이 줄이 없으면 select 가 값을 못 찾아
              **「이어가지 않음」으로 보이고**, 사람이 아무것도 안 건드려도 다음
              저장에서 지정이 조용히 지워진다. 글자로 「목록에 없다」고 밝혀,
              그대로 둘지 바꿀지를 사람이 고르게 한다.
            */}
            {orphanedNextProcedureId && (
              <option value={orphanedNextProcedureId}>
                지금 지정된 절차 — 고를 수 있는 목록에 없습니다(만료·삭제·참고용)
              </option>
            )}
          </select>
          {/*
            🔴 **[종료]와 나머지는 같은 칸이지만 일어나는 일이 다르다.** 종료는
            절차가 끝나면서 이어지고, 그 밖의 유형은 **절차 한가운데서** 이어진다 —
            원래 절차는 다음 단계로 그대로 간다. 한 글로 뭉개면 중간 노드에
            지정한 사람이 「여기서 절차가 끝난다」로 읽는다. 그래서 [종료] 갈래만
            남겼다.

            🔴 **유형마다 글을 따로 두지 않는다**(2026-11-20). 전에는 아래쪽 글이
            「이 **작업**을 완료할 때」였고, 같은 날 [검사]·[조치]가 열리면서
            **틀린 말이 됐다** — 검사 노드에 지정해 놓고 「작업을 완료할 때」를
            읽으면 자기 노드 얘기가 아닌 줄 안다. 「이 **단계**를 완료할 때」는
            [작업]·[검사]·[조치] 셋에 다 맞고, 유형이 또 늘어도 여기를 안 고친다
            (허용 목록은 NEXT_PROCEDURE_LINK_NODE_TYPES 한 곳에 있다).
          */}
          <span className="text-[11px] text-zinc-400 dark:text-zinc-600">
            {node.nodeType === "END"
              ? "이 절차가 끝나면 고른 절차를 이어서 엽니다."
              : "이 단계를 완료할 때 고른 절차를 이어서 열지 한 번 묻습니다. 지금 절차는 끝나지 않고 다음 단계로 그대로 이어집니다."}{" "}
            고른 절차가 나중에 개정되면 <span className="font-medium">그때의 게시본</span>을 따라가므로 여기를 다시
            고치지 않아도 됩니다.
          </span>
        </label>
      )}
      <details className="rounded-md border border-zinc-200 p-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <summary className="cursor-pointer select-none font-medium text-zinc-600 dark:text-zinc-300">고급 설정</summary>
        <div className="mt-2 flex items-center gap-4">
          <label className="flex flex-col gap-1">
            정렬 순서
            {/*
              🔴 2026-11-20(조각 4) — **아직 저장 안 된 노드에서는 잠근다.** 이 번호는
              서버가 만들 때 「맨 뒤 + 1」로 매기는데, 화면에는 그 값을 알 길이 없어
              받침 0 을 세운다. 그대로 두면 사람이 손도 안 댄 0 이 저장 때 올라가
              **서버가 방금 매긴 번호를 0 으로 덮어쓴다**(조각 2 의
              includeBrandNewDraftEntries 가 경고한 바로 그 자리). 잠그고 까닭을 적어,
              저장한 뒤에 고치게 한다.
            */}
            <input
              type="number"
              value={draft.sortOrder}
              onChange={(e) => onDraftChange({ sortOrder: Number(e.target.value) })}
              disabled={!canEdit || isUnsavedNode}
              className="w-20 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={draft.isActive} onChange={(e) => onDraftChange({ isActive: e.target.checked })} disabled={!canEdit} />
            활성 상태
          </label>
        </div>
        {isUnsavedNode && <p className="mt-2">정렬 순서는 [저장]할 때 서버가 맨 뒤 번호로 매깁니다. 저장한 뒤에 고칠 수 있습니다.</p>}
      </details>

      {canEdit && <p className="text-[11px] text-zinc-400 dark:text-zinc-600">위 속성 변경은 화면 상단의 [저장] 버튼으로 다른 변경사항과 함께 저장됩니다.</p>}

      {canPosition && otherNodes.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950">
          <h4 className="text-xs font-semibold text-emerald-900 dark:text-emerald-300">상대 위치로 이동</h4>
          <div className="flex flex-col gap-1">
            <label htmlFor="relative-reference-node">기준 노드 선택</label>
            <div className="flex items-center gap-2">
              <select
                id="relative-reference-node"
                value={referenceNodeId}
                onChange={(e) => setReferenceNodeId(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                {otherNodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title} ({n.nodeCode})
                  </option>
                ))}
              </select>
              {(onStartPickReference || onCancelPickReference) && (
                <button
                  type="button"
                  onClick={() => (isPickingReference ? onCancelPickReference?.() : onStartPickReference?.())}
                  aria-pressed={isPickingReference}
                  className={`shrink-0 rounded-md border px-2 py-1.5 text-xs ${
                    isPickingReference
                      ? "border-emerald-700 bg-emerald-700 text-white"
                      : "border-emerald-400 text-emerald-900 hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900"
                  }`}
                >
                  {isPickingReference ? "선택 취소" : "화면에서 선택"}
                </button>
              )}
            </div>
            {isPickingReference && <p className="text-emerald-800 dark:text-emerald-300">그래프에서 기준으로 삼을 노드를 클릭하세요.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["LEFT", "왼쪽"],
                ["RIGHT", "오른쪽"],
                ["UP", "위"],
                ["DOWN", "아래"],
              ] as [RelativeDirection, string][]
            ).map(([direction, label]) => (
              <button
                key={direction}
                type="button"
                disabled={!referenceNodeId}
                onClick={() => handleRelativePosition(direction)}
                className="rounded-md border border-emerald-400 px-2.5 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {canDelete && (
        <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
          <h4 className="text-xs font-semibold text-red-900 dark:text-red-300">노드 삭제</h4>
          {(node.hasChecklistContent || node.hasTroubleshootingContent) && (
            <p className="text-red-700 dark:text-red-400">체크리스트 또는 고장 진단표 내용이 연결되어 있어 삭제할 수 없습니다.</p>
          )}
          {/*
            🔴 2026-11-20(조각 4) — **서버가 거절할 까닭을 앞당겨 보인다.** 모아 두는
            지금은 서버의 거절이 [저장] 때까지 안 보이는데, 그림에서는 노드가 **이미
            사라져 보인다** — 「분명히 지웠는데 저장이 실패한다」가 된다. 그래서
            단추를 미리 잠근다.
            🔴 2026-11-21 — 여기 오던 까닭 둘 중 **「연결선이 붙어 있다」는 없어졌다**
            (쓰는 분 결정 — 붙은 선은 노드와 함께 지워진다). 남은 하나는 체크리스트 ·
            고장 진단표 내용이 걸린 노드다.
          */}
          {deleteBlockedReason && <p className="text-red-700 dark:text-red-400">{deleteBlockedReason}</p>}
          <textarea
            rows={2}
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
            placeholder="삭제 사유 (선택)"
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          {/*
            🔴 2026-11-21 — **몇 개가 함께 지워지는지 누르기 전에 보인다.**
            쓰는 분의 결정으로 노드를 지우면 붙은 연결선도 함께 지워지는데, 확인
            창은 안 띄운다(지금 삭제도 안 띄운다 — [이전] 한 번이면 노드와 선이
            **함께** 돌아온다). 그러면 누른 뒤에도 제가 무엇을 지웠는지 알 길이
            화면에 없다. 그래서 **수를 미리** 적는다.

            🔵 **새 상시 안내가 아니다.** 선이 붙었을 때 이 상자에 서던 글이 바로
            위(사유 칸 위)에 하나 있었다 — 「연결선 N개가 붙어 있어 삭제할 수
            없습니다」(2026-11-20~21). 그 줄이 없어진 자리에 이 줄이 들어서는 것이라
            **한 번에 뜨는 글의 수가 안 는다.** 쓰는 분이 이 편집기의 상시 안내 둘을
            지워 달라고 한 것이 어제다(커밋 d57f664a). 그래서 **붙은 선이 있을 때만**
            선다 — 이 상자에서 늘 서는 글은 맨 아래 한 줄뿐이다.
            🔴 막혔으면 안 보인다 — 못 지우는 노드 옆에서 「함께 지워집니다」는
            거짓말이고, 빨간 글 둘이 서로 반대말을 하게 된다.
            🔵 자리는 **단추 바로 위**다. 사유 칸 위(막힌 까닭이 서던 자리)에 두면
            textarea 가 사이에 끼어, 사유를 적는 동안 눈이 그 글에서 떠난다.
          */}
          {deleteBlockedReason === null && attachedEdgeCount > 0 && (
            <p className="text-red-700 dark:text-red-400">붙어 있는 연결선 {attachedEdgeCount}개도 함께 지워집니다.</p>
          )}
          {/*
            🔵 2026-11-21 — **키를 적는 자리는 툴팁 하나**다. 같은 일을 [Delete]
            키로도 할 수 있게 되었는데(화면의 planProcedureDeleteKey), 그것을
            화면에 상시 한 줄로 세우지 않는다: 이 편집기의 상시 안내를 2026-11-04 ·
            11-20 두 번 세웠다 두 번 다 지워 달라는 요청을 받았다(커밋 d57f664a).
            툴팁은 자리를 안 차지하고 찾는 사람만 본다.
            🔴 **막혔을 때는 키 이야기를 안 한다** — 그때는 키로도 안 지워지므로
            (같은 값 하나로 판정한다) 까닭을 그대로 띄운다. 안 그러면 툴팁이
            거짓말을 한다.
          */}
          <button
            type="button"
            disabled={deleteBlockedReason !== null}
            onClick={handleDelete}
            title={deleteBlockedReason ?? "[Delete] 키로도 지울 수 있습니다"}
            className="self-start rounded-md border border-red-400 px-3 py-1.5 text-sm font-medium text-red-900 hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900"
          >
            노드 삭제
          </button>
          {/* 🔴 지워도 아직 안 간다 — 그림에서 사라지는 것이 더 이상 「저장됐다」는 증거가 아니다. */}
          <p className="text-red-700 dark:text-red-400">삭제는 화면 상단의 [저장]을 눌러야 서버에 반영됩니다.</p>
        </div>
      )}

      {/*
        🟢 남긴 확인 창 — 사유가 **필수**인 분류(FULL_SERVICE/REFERENCE)에서만
        열린다. 확인을 받으려고가 아니라 사유를 받으려고 남았다(파일 머리말).
        TECHNICAL_TASK 에서는 handleSelectNodeType 이 여기를 열지 않는다.
      */}
      <dialog
        ref={typeDialogRef}
        aria-labelledby="node-type-confirm-title"
        onCancel={(e) => {
          e.preventDefault();
          handleCancelTypeChange();
        }}
        className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      >
        <h2 id="node-type-confirm-title" className="text-sm font-semibold">
          노드 유형 변경 확인
        </h2>
        <div className="mt-3 space-y-2 text-sm">
          <p>
            {procedureNodeTypeLabels[node.nodeType]} → <span className="font-medium">{procedureNodeTypeLabels[newNodeType]}</span>
          </p>
          <label className="flex flex-col gap-1 text-xs">
            변경 사유 {isTechnical ? "(선택)" : "(필수)"}
            <textarea
              rows={2}
              value={typeChangeReason}
              onChange={(e) => setTypeChangeReason(e.target.value)}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        </div>
        {/* 🔵 [적용]을 눌러도 아직 서버로 안 간다 — 모아 두었다가 [저장]이 보낸다. */}
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">[적용]한 유형 변경은 화면 상단의 [저장]을 눌러야 서버에 저장됩니다.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleCancelTypeChange}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => handleChangeType(newNodeType)}
            disabled={!canConfirmTypeChange}
            className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900"
          >
            적용
          </button>
        </div>
      </dialog>
    </div>
  );
}
