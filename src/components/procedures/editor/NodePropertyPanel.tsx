"use client";

import { useEffect, useRef, useState } from "react";
import {
  PROCEDURE_NODE_TYPE_CODES,
  procedureNodeTypeLabels,
  type ProcedureNodeType,
} from "@/lib/domain/procedure-template-types";
import type { EditorNodeRow } from "@/lib/db/queries/procedure-template-editor";
import {
  changeProcedureTemplateNodeTypeAction,
  deleteProcedureTemplateNodeAction,
} from "@/lib/server/actions/procedure-template-editor";
import type { StructuralValidationSummary } from "@/lib/db/mutations/procedure-template-editor";
import {
  resolveEffectiveNodePosition,
  computeCenterAlignedRelativePosition,
  resolveColumnSnappedRelativePosition,
  type RelativeDirection,
  type ColumnSnapCandidate,
} from "@/lib/graph-editor-core/layout";
import type { ProcedureNodeFieldDraft } from "@/lib/domain/procedure-editor-save-state";
import type { NextProcedureLinkCandidate } from "@/lib/db/queries/procedure-templates";

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
 * part of `draft` — it never becomes a pending/deferred field. It triggers
 * the exact same IMMEDIATE, re-validated changeProcedureTemplateNodeTypeAction
 * call this panel has always used (CHANGE_NODE_TYPE history action, not
 * UPDATE_NODE). `newNodeType` resyncs to `node.nodeType` via adjust-state-
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
 * 🔴 바로 적용하는 갈래는 **실패하면 드롭다운을 되돌린다**(handleChangeType).
 * 창이 없으니, 적용되지 않은 유형이 골라진 채로 남으면 화면이 거짓말을 한다.
 */
export default function NodePropertyPanel({
  node,
  allNodes,
  isPickingReference = false,
  onStartPickReference,
  onCancelPickReference,
  pickedReferenceNode = null,
  canEdit,
  expectedTemplateUpdatedAt,
  draft,
  onDraftChange,
  onPositionDraftChange,
  resolveNodeDimensions,
  onSaved,
  canDelete,
  onDeleted,
  canPosition,
  isTechnical,
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
  expectedTemplateUpdatedAt: string;
  /** 5C-6D-1C — screen-owned pending draft for title/description/instructions/sortOrder/isActive; already reflects any locally-unsaved edit (this panel never keeps its own copy). */
  draft: ProcedureNodeFieldDraft;
  onDraftChange: (patch: Partial<ProcedureNodeFieldDraft>) => void;
  /** 5C-6D-1D — sets (or replaces) `node`'s pending position, same deferred model as a canvas drag: no server call here, the screen's global [저장] persists it later via LAYOUT_AND_ROUTES. Replaces the old immediate saveProcedureTemplateLayoutAction call. */
  onPositionDraftChange: (position: { x: number; y: number }) => void;
  /** 5C-6D-1D — the screen's single, already-composed effective-dimension resolver (measured-first via ReactFlowInstance.getInternalNode, estimate-fallback) — see this file's own DIMENSION SOURCE doc comment below for why this must be the SAME function instance the screen composes once, not a locally re-derived copy. */
  resolveNodeDimensions: (n: EditorNodeRow) => { width: number; height: number };
  onSaved: (newUpdatedAt: string, structuralValidation?: StructuralValidationSummary) => void;
  /** Phase 5C-5B — true only for a TECHNICAL_TASK DRAFT (see ProcedureTemplateEditorScreen); always false for FULL_SERVICE/REFERENCE, which never gained this new structural-delete capability. */
  canDelete: boolean;
  onDeleted: (newUpdatedAt: string) => void;
  /** Phase 5C-5B — same gate as canDelete; a separate prop only so the capability stays independently named/readable at the call site. */
  canPosition: boolean;
  /** Phase 5C-5B usability — true for TECHNICAL_TASK (any status/role — purely a UI relaxation of the mandatory-reason requirement, matching the mutation layer's own category-aware validation). FULL_SERVICE keeps requiring a reason for node-type changes, unchanged. */
  isTechnical: boolean;
  /**
   * [종료]의 「다음 절차」로 고를 수 있는 절차들(2026-11-04, 줄기 B ④ 조각 ②).
   * 서버가 거른 것을 그대로 그린다 — 게시본 · 기술작업 · 자기 계열 제외
   * (queries/procedure-templates.ts 의 listNextProcedureLinkCandidates).
   * 🔵 기본값이 빈 배열이라, 안 넘기는 호출부에서는 「이어가지 않음」만 보인다.
   */
  nextProcedureCandidates?: NextProcedureLinkCandidate[];
}) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Adjust-state-during-render (same convention as CreateEdgePanel's
  // prefillFromNodeId resync) — this panel is not remounted on canvas
  // selection change, so `newNodeType`/dialog/reason/validation-result state
  // must explicitly resync to the newly-selected node whenever `node.id`
  // changes, or the select would keep showing a previous node's type/dialog.
  const [prevNodeId, setPrevNodeId] = useState(node.id);
  const [newNodeType, setNewNodeType] = useState<ProcedureNodeType>(node.nodeType);
  const [confirmingTypeChange, setConfirmingTypeChange] = useState(false);
  const [typeChangeReason, setTypeChangeReason] = useState("");
  const [isChangingType, setIsChangingType] = useState(false);
  const [typeChangeResult, setTypeChangeResult] = useState<StructuralValidationSummary | null>(null);
  if (node.id !== prevNodeId) {
    setPrevNodeId(node.id);
    setNewNodeType(node.nodeType);
    setConfirmingTypeChange(false);
    setTypeChangeReason("");
    setTypeChangeResult(null);
  }
  const typeDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = typeDialogRef.current;
    if (!dialog) return;
    if (confirmingTypeChange && !dialog.open) dialog.showModal();
    else if (!confirmingTypeChange && dialog.open) dialog.close();
  }, [confirmingTypeChange]);

  const [deleteReason, setDeleteReason] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

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
    setErrorMessage(null);
    if (value === node.nodeType) return;
    if (isTechnical) {
      void handleChangeType(value);
      return;
    }
    setConfirmingTypeChange(true);
  }

  function handleCancelTypeChange() {
    setConfirmingTypeChange(false);
    setNewNodeType(node.nodeType);
    setTypeChangeReason("");
    setErrorMessage(null);
  }

  const canConfirmTypeChange = newNodeType !== node.nodeType && (isTechnical || typeChangeReason.trim().length > 0) && !isChangingType;

  /**
   * 유형 변경의 본체. 들어오는 길이 둘이다 — 드롭다운에서 바로(TECHNICAL_TASK)와
   * 확인 창의 [적용](그 밖의 분류). 어느 쪽이든 같은 함수를 지난다.
   *
   * 🔴 onSaved 는 **실패 검사 뒤**에만 부른다: 이 호출이 화면의
   * handleStructuralSaved → pushStructuralUndoStep() 으로 이어져 되돌리기 한
   * 걸음을 쌓으므로, 실패한 호출까지 쌓으면 일어나지도 않은 일을 되돌리려 들어
   * 바로 아래 있던 멀쩡한 변경이 대신 날아간다(줄기 B-①).
   */
  async function handleChangeType(targetNodeType: ProcedureNodeType) {
    setIsChangingType(true);
    setErrorMessage(null);
    const result = await changeProcedureTemplateNodeTypeAction({
      nodeId: node.id,
      newNodeType: targetNodeType,
      reason: typeChangeReason,
      expectedTemplateUpdatedAt,
    });
    setIsChangingType(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      // 🔴 확인 창이 없는 갈래에서는 드롭다운이 유일한 표시다 — 적용되지 않은
      // 유형이 골라진 채로 남으면 사람은 바뀐 줄 안다. 원래 유형으로 되돌린다.
      setNewNodeType(node.nodeType);
      return;
    }
    setTypeChangeResult(result.structuralValidation);
    setConfirmingTypeChange(false);
    setTypeChangeReason("");
    onSaved(result.updatedAt, result.structuralValidation);
  }

  /** Current visible position (5C-6D-1D) — `n`'s own effective position, which for a node this session has dragged/relative-positioned is already the pending value, not the stale server one: `node`/`allNodes` are the screen's RENDERED rows, and 1C's own render pipeline injects a pending-or-just-saved position into userPositionX/Y whenever one exists for that node. Never reads raw positionX/positionY directly — resolveEffectiveNodePosition is the one shared priority rule the canvas itself uses too. */
  function currentPosition(n: EditorNodeRow): { x: number; y: number } {
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

  async function handleDelete() {
    setIsDeleting(true);
    setErrorMessage(null);
    const result = await deleteProcedureTemplateNodeAction({ nodeId: node.id, reason: deleteReason, expectedTemplateUpdatedAt });
    setIsDeleting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    onDeleted(result.updatedAt);
  }

  return (
    <div className="flex flex-col gap-4 text-xs">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">노드 속성</h3>
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
      <label className="flex flex-col gap-1">
        작업 지시 요약
        <textarea rows={3} value={draft.instructions} onChange={(e) => onDraftChange({ instructions: e.target.value })} disabled={!canEdit} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      <label className="flex flex-col gap-1">
        노드 유형{isChangingType ? " (변경 중...)" : ""}
        {/*
          🔴 변경이 도는 동안 잠근다. 확인 창이 있던 시절에는 창의 [적용]
          단추가 그 일을 했다 — 창을 없앤 지금 잠그는 자리가 여기뿐이고,
          잠그지 않으면 한 번 더 고르는 것으로 두 번째 호출이 나간다.
        */}
        <select
          value={newNodeType}
          onChange={(e) => handleSelectNodeType(e.target.value as ProcedureNodeType)}
          disabled={!canEdit || isChangingType}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
        >
          {PROCEDURE_NODE_TYPE_CODES.map((t) => (
            <option key={t} value={t}>
              {procedureNodeTypeLabels[t]}
            </option>
          ))}
        </select>
      </label>
      {typeChangeResult && (
        <p className="text-[11px] text-zinc-500 dark:text-zinc-600">
          재검증 결과: 오류 {typeChangeResult.errorCount}건 · 경고 {typeChangeResult.warningCount}건
        </p>
      )}

      {/*
        ── 「다음 절차」 — [종료] 노드에만 (2026-11-04, 줄기 B ④ 조각 ②) ──────
        🔴 `node.nodeType` 을 본다. 위 드롭다운의 `newNodeType` 이 아니다 —
        그 값은 아직 서버에 안 간 「고르는 중」일 수 있고, 그때 이 칸을 그리면
        사람이 고른 값이 저장 단계에서 END 가 아니라는 이유로 거절당한다.

        🔵 **고르는 칸만 둔다.** 저장은 화면 상단의 [저장]이 다른 변경과 함께
        한다(이웃 정렬 순서·활성 상태와 같은 규약) — 여기만 즉시 저장하면
        「저장 안 함」으로 떠난 사람의 다른 수정과 이 값이 어긋난다.
      */}
      {node.nodeType === "END" && (
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
          <span className="text-[11px] text-zinc-400 dark:text-zinc-600">
            이 절차가 끝나면 고른 절차를 이어서 엽니다. 고른 절차가 나중에 개정되면{" "}
            <span className="font-medium">그때의 게시본</span>을 따라가므로 여기를 다시 고치지 않아도 됩니다.
          </span>
        </label>
      )}
      <details className="rounded-md border border-zinc-200 p-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <summary className="cursor-pointer select-none font-medium text-zinc-600 dark:text-zinc-300">고급 설정</summary>
        <div className="mt-2 flex items-center gap-4">
          <label className="flex flex-col gap-1">
            정렬 순서
            <input type="number" value={draft.sortOrder} onChange={(e) => onDraftChange({ sortOrder: Number(e.target.value) })} disabled={!canEdit} className="w-20 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" />
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={draft.isActive} onChange={(e) => onDraftChange({ isActive: e.target.checked })} disabled={!canEdit} />
            활성 상태
          </label>
        </div>
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
          <textarea
            rows={2}
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
            placeholder="삭제 사유 (선택)"
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="button"
            disabled={isDeleting}
            onClick={() => void handleDelete()}
            className="self-start rounded-md border border-red-400 px-3 py-1.5 text-sm font-medium text-red-900 hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900"
          >
            {isDeleting ? "삭제 중..." : "노드 삭제"}
          </button>
        </div>
      )}

      {errorMessage && <p className="text-red-600 dark:text-red-400">{errorMessage}</p>}

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
          if (!isChangingType) handleCancelTypeChange();
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
        {errorMessage && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleCancelTypeChange}
            disabled={isChangingType}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void handleChangeType(newNodeType)}
            disabled={!canConfirmTypeChange}
            className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900"
          >
            {isChangingType ? "변경 중..." : "적용"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
