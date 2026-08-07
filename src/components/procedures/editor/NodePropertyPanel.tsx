"use client";

import { useState } from "react";
import {
  PROCEDURE_NODE_TYPE_CODES,
  procedureNodeTypeLabels,
  type ProcedureNodeType,
} from "@/lib/domain/procedure-template-types";
import type { EditorNodeRow } from "@/lib/db/queries/procedure-template-editor";
import { updateProcedureTemplateNodeAction, changeProcedureTemplateNodeTypeAction } from "@/lib/server/actions/procedure-template-editor";
import type { StructuralValidationSummary } from "@/lib/db/mutations/procedure-template-editor";

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
  canEdit,
  expectedTemplateUpdatedAt,
  onSaved,
}: {
  node: EditorNodeRow;
  canEdit: boolean;
  expectedTemplateUpdatedAt: string;
  onSaved: (newUpdatedAt: string, structuralValidation?: StructuralValidationSummary) => void;
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
        제목
        <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canEdit} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
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
            placeholder="변경 사유 (필수)"
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="button"
            disabled={newNodeType === node.nodeType || typeChangeReason.trim().length === 0 || isChangingType}
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

      {errorMessage && <p className="text-red-600 dark:text-red-400">{errorMessage}</p>}
    </div>
  );
}
