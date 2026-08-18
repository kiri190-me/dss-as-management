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

/** Phase 5C-5B — fixed spacing for "상대 위치로 이동": vertical reuses createProcedureTemplateNode's own default node-stacking gap (150) for consistency; horizontal is sized to comfortably clear the widest node chip (NODE_SIZE.MAX_WIDTH=240 in procedure-visual-language.ts) plus a margin. */
const RELATIVE_POSITION_SPACING = { horizontal: 280, vertical: 150 } as const;

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
 * part of `draft` — selecting a different type never mutates immediately
 * and never becomes a pending/deferred field. It still triggers the exact
 * same IMMEDIATE, individually-reasoned, re-validated changeProcedureTemplateNodeTypeAction
 * call this panel has always used (CHANGE_NODE_TYPE history action, not
 * UPDATE_NODE) — only now behind a compact confirm dialog (same pattern as
 * EdgePropertyPanel's retarget dialog) instead of a large permanent amber
 * box. `newNodeType` resyncs to `node.nodeType` via adjust-state-during-
 * render whenever the selected node itself changes (this panel is not
 * remounted on selection change — see CreateEdgePanel's own doc comment for
 * the same convention) so the select never shows a stale type left over
 * from a previously-selected node.
 */
export default function NodePropertyPanel({
  node,
  allNodes,
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
}: {
  node: EditorNodeRow;
  /** Phase 5C-5B — every node in the template, for "상대 위치로 이동"'s reference-node picker. 5C-6D-1D — also every OTHER node's current visible position/dimensions feed column-snap candidacy, so this must be the screen's rendered (baseline + pending-draft-merged) list, never the raw server rows alone. */
  allNodes: EditorNodeRow[];
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
  const [referenceNodeId, setReferenceNodeId] = useState(otherNodes[0]?.id ?? "");

  /** Selecting a different type never mutates by itself — it only opens the confirm dialog. Re-selecting the current type again (or the dialog's own cancel) never calls the mutation. */
  function handleSelectNodeType(value: ProcedureNodeType) {
    setNewNodeType(value);
    setErrorMessage(null);
    if (value !== node.nodeType) setConfirmingTypeChange(true);
  }

  function handleCancelTypeChange() {
    setConfirmingTypeChange(false);
    setNewNodeType(node.nodeType);
    setTypeChangeReason("");
    setErrorMessage(null);
  }

  const canConfirmTypeChange = newNodeType !== node.nodeType && (isTechnical || typeChangeReason.trim().length > 0) && !isChangingType;

  async function handleChangeType() {
    setIsChangingType(true);
    setErrorMessage(null);
    const result = await changeProcedureTemplateNodeTypeAction({
      nodeId: node.id,
      newNodeType,
      reason: typeChangeReason,
      expectedTemplateUpdatedAt,
    });
    setIsChangingType(false);
    if (!result.ok) {
      setErrorMessage(result.message);
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
        노드 유형
        <select
          value={newNodeType}
          onChange={(e) => handleSelectNodeType(e.target.value as ProcedureNodeType)}
          disabled={!canEdit}
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
          <label className="flex flex-col gap-1">
            기준 노드 선택
            <select value={referenceNodeId} onChange={(e) => setReferenceNodeId(e.target.value)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
              {otherNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title} ({n.nodeCode})
                </option>
              ))}
            </select>
          </label>
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
            onClick={() => void handleChangeType()}
            disabled={!canConfirmTypeChange}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
          >
            {isChangingType ? "변경 중..." : "적용"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
