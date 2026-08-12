"use client";

import { useState } from "react";
import {
  PROCEDURE_NODE_TYPE_CODES,
  procedureNodeTypeLabels,
  type ProcedureNodeType,
} from "@/lib/domain/procedure-template-types";
import type { EditorNodeRow } from "@/lib/db/queries/procedure-template-editor";
import {
  updateProcedureTemplateNodeAction,
  changeProcedureTemplateNodeTypeAction,
  deleteProcedureTemplateNodeAction,
  saveProcedureTemplateLayoutAction,
} from "@/lib/server/actions/procedure-template-editor";
import type { StructuralValidationSummary } from "@/lib/db/mutations/procedure-template-editor";
import { resolveEffectiveNodePosition, computeRelativePosition, type RelativeDirection } from "@/lib/graph-editor-core/layout";
import { NODE_VISUAL_CONFIG, getNodeChipVisual, computeNodeDimensions } from "@/lib/domain/procedure-visual-language";

/** Phase 5C-5B — fixed spacing for "상대 위치로 이동": vertical reuses createProcedureTemplateNode's own default node-stacking gap (150) for consistency; horizontal is sized to comfortably clear the widest node chip (NODE_SIZE.MAX_WIDTH=240 in procedure-visual-language.ts) plus a margin. Round-2 fix — computeRelativePosition now also needs both nodes' actual widths (computeNodeDimensions, the same function the graph itself sizes nodes with) to center DOWN/UP correctly, so this file imports procedure-visual-language after all. */
const RELATIVE_POSITION_SPACING = { horizontal: 280, vertical: 150 } as const;

/**
 * Node property side panel (Phase 4A) — title/description/instructions/
 * sortOrder/isActive save immediately through their own explicit "저장"
 * button (same per-form-explicit-submit convention as Phase 3A's
 * BindConnectorForm); node type change is a separate, always-reasoned
 * sub-action since it re-runs structural validation and must be
 * individually auditable (CHANGE_NODE_TYPE, not UPDATE_NODE).
 */
export default function NodePropertyPanel({
  node,
  allNodes,
  templateId,
  canEdit,
  expectedTemplateUpdatedAt,
  onSaved,
  canDelete,
  onDeleted,
  canPosition,
  isTechnical,
}: {
  node: EditorNodeRow;
  /** Phase 5C-5B — every node in the template, for "상대 위치로 이동"'s reference-node picker. */
  allNodes: EditorNodeRow[];
  templateId: string;
  canEdit: boolean;
  expectedTemplateUpdatedAt: string;
  onSaved: (newUpdatedAt: string, structuralValidation?: StructuralValidationSummary) => void;
  /** Phase 5C-5B — true only for a TECHNICAL_TASK DRAFT (see ProcedureTemplateEditorScreen); always false for FULL_SERVICE/REFERENCE, which never gained this new structural-delete capability. */
  canDelete: boolean;
  onDeleted: (newUpdatedAt: string) => void;
  /** Phase 5C-5B — same gate as canDelete; a separate prop only so the capability stays independently named/readable at the call site. */
  canPosition: boolean;
  /** Phase 5C-5B usability — true for TECHNICAL_TASK (any status/role — purely a UI relaxation of the mandatory-reason requirement, matching the mutation layer's own category-aware validation). FULL_SERVICE keeps requiring a reason for node-type changes, unchanged. */
  isTechnical: boolean;
}) {
  const [title, setTitle] = useState(node.title);
  const [description, setDescription] = useState(node.description ?? "");
  const [instructions, setInstructions] = useState(node.instructions ?? "");
  const [sortOrder, setSortOrder] = useState(node.sortOrder);
  const [isActive, setIsActive] = useState(node.isActive);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [newNodeType, setNewNodeType] = useState<ProcedureNodeType>(node.nodeType);
  const [typeChangeReason, setTypeChangeReason] = useState("");
  const [isChangingType, setIsChangingType] = useState(false);
  const [typeChangeResult, setTypeChangeResult] = useState<StructuralValidationSummary | null>(null);

  const [deleteReason, setDeleteReason] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const otherNodes = allNodes.filter((n) => n.id !== node.id);
  const [referenceNodeId, setReferenceNodeId] = useState(otherNodes[0]?.id ?? "");
  const [isPositioning, setIsPositioning] = useState(false);

  const hasFieldChanges =
    title !== node.title || description !== (node.description ?? "") || instructions !== (node.instructions ?? "") || sortOrder !== node.sortOrder || isActive !== node.isActive;

  async function handleSaveFields() {
    setIsSaving(true);
    setErrorMessage(null);
    const result = await updateProcedureTemplateNodeAction({
      nodeId: node.id,
      patch: { title, description: description.trim() || null, instructions: instructions.trim() || null, sortOrder, isActive },
      expectedTemplateUpdatedAt,
    });
    setIsSaving(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    onSaved(result.updatedAt);
  }

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
    onSaved(result.updatedAt, result.structuralValidation);
  }

  /**
   * "상대 위치로 이동" — moves `node` to a fixed spacing left/right/up/down
   * of the reference node's own *effective* position (its saved
   * user-position override if it has one, else its own base position) —
   * reusing resolveEffectiveNodePosition, the same generic graph-editor-
   * core function the graph canvas itself resolves display positions
   * through, so "relative to what's actually on screen" holds even when
   * the reference node has never been manually repositioned. Persists via
   * the existing saveProcedureTemplateLayoutAction (userPositionX/Y) —
   * never a new mutation, never position_x/position_y.
   */
  async function handleRelativePosition(direction: RelativeDirection) {
    const reference = otherNodes.find((n) => n.id === referenceNodeId);
    if (!reference) return;
    const refPos = resolveEffectiveNodePosition(
      { positionX: reference.positionX, positionY: reference.positionY, userPositionX: reference.userPositionX, userPositionY: reference.userPositionY },
      "USER"
    );
    const referenceWidth = computeNodeDimensions({ title: reference.title, shape: NODE_VISUAL_CONFIG[getNodeChipVisual(reference.nodeType).semanticType].shape }).width;
    const targetWidth = computeNodeDimensions({ title: node.title, shape: NODE_VISUAL_CONFIG[getNodeChipVisual(node.nodeType).semanticType].shape }).width;
    const target = computeRelativePosition({ ...refPos, width: referenceWidth }, direction, RELATIVE_POSITION_SPACING, targetWidth);

    setIsPositioning(true);
    setErrorMessage(null);
    const result = await saveProcedureTemplateLayoutAction({
      templateId,
      positions: [{ nodeId: node.id, x: target.x, y: target.y }],
      edgeRoutes: [],
      expectedTemplateUpdatedAt,
    });
    setIsPositioning(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    onSaved(result.updatedAt);
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
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            // Shift+Enter inserts a newline (native textarea behavior, left
            // alone); plain Enter is swallowed — it never inserts a line
            // break, and this panel has no Enter-to-submit behavior to
            // accidentally trigger either way (only the explicit "속성
            // 저장" button saves).
            if (e.key === "Enter" && !e.shiftKey) e.preventDefault();
          }}
          disabled={!canEdit}
          className="resize-y rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm whitespace-pre-wrap disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
      <label className="flex flex-col gap-1">
        설명 (부제)
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canEdit} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      <label className="flex flex-col gap-1">
        작업 지시 요약
        <textarea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} disabled={!canEdit} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      <div className="flex items-center gap-4">
        <label className="flex flex-col gap-1">
          정렬 순서
          <input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} disabled={!canEdit} className="w-20 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} disabled={!canEdit} />
          활성 상태
        </label>
      </div>

      {canEdit && (
        <button
          type="button"
          disabled={!hasFieldChanges || isSaving}
          onClick={() => void handleSaveFields()}
          className="self-start rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {isSaving ? "저장 중..." : "속성 저장"}
        </button>
      )}

      {canEdit && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
          <h4 className="text-xs font-semibold text-amber-900 dark:text-amber-300">노드 유형 변경</h4>
          <select value={newNodeType} onChange={(e) => setNewNodeType(e.target.value as ProcedureNodeType)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
            {PROCEDURE_NODE_TYPE_CODES.map((t) => (
              <option key={t} value={t}>
                {procedureNodeTypeLabels[t]}
              </option>
            ))}
          </select>
          <textarea
            rows={2}
            value={typeChangeReason}
            onChange={(e) => setTypeChangeReason(e.target.value)}
            placeholder={isTechnical ? "변경 사유 (선택)" : "변경 사유 (필수)"}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="button"
            disabled={newNodeType === node.nodeType || (!isTechnical && typeChangeReason.trim().length === 0) || isChangingType}
            onClick={() => void handleChangeType()}
            className="self-start rounded-md border border-amber-400 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900"
          >
            {isChangingType ? "변경 중..." : "유형 변경 적용"}
          </button>
          {typeChangeResult && (
            <p className="text-[11px] text-amber-800 dark:text-amber-400">
              재검증 결과: 오류 {typeChangeResult.errorCount}건 · 경고 {typeChangeResult.warningCount}건
            </p>
          )}
        </div>
      )}

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
                disabled={!referenceNodeId || isPositioning}
                onClick={() => void handleRelativePosition(direction)}
                className="rounded-md border border-emerald-400 px-2.5 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900"
              >
                {isPositioning ? "이동 중..." : label}
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
    </div>
  );
}
