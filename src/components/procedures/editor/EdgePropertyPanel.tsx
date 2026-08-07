"use client";

import { useEffect, useRef, useState } from "react";
import { PROCEDURE_BRANCH_TYPE_CODES, procedureBranchTypeLabels, type ProcedureBranchType } from "@/lib/domain/procedure-template-types";
import type { EditorEdgeRow, EditorNodeRow } from "@/lib/db/queries/procedure-template-editor";
import { updateProcedureTemplateEdgeAction, retargetProcedureTemplateEdgeAction } from "@/lib/server/actions/procedure-template-editor";
import { buildEdgeRetargetPreview, type NodeLookup } from "@/lib/domain/procedure-editor-client-state";
import type { StructuralValidationSummary } from "@/lib/db/mutations/procedure-template-editor";

/**
 * Edge property side panel (Phase 4A) — branchType/branchLabel edit
 * through its own explicit "저장"; retargeting always shows a current-vs-
 * proposed preview inside a native <dialog> confirmation (same pattern as
 * BindConnectorForm) and always requires a reason — it must never silently
 * replace an edge.
 */
export default function EdgePropertyPanel({
  edge,
  nodes,
  canEdit,
  expectedTemplateUpdatedAt,
  onSaved,
}: {
  edge: EditorEdgeRow;
  nodes: EditorNodeRow[];
  canEdit: boolean;
  expectedTemplateUpdatedAt: string;
  onSaved: (newUpdatedAt: string, structuralValidation?: StructuralValidationSummary) => void;
}) {
  const nodesById = new Map<string, NodeLookup>(nodes.map((n) => [n.id, { id: n.id, title: n.title, nodeCode: n.nodeCode }]));
  const [branchType, setBranchType] = useState<ProcedureBranchType>(edge.branchType);
  const [branchLabel, setBranchLabel] = useState(edge.branchLabel ?? "");
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [newFromNodeId, setNewFromNodeId] = useState(edge.fromNodeId);
  const [newToNodeId, setNewToNodeId] = useState(edge.toNodeId);
  const [retargetReason, setRetargetReason] = useState("");
  const [confirmingRetarget, setConfirmingRetarget] = useState(false);
  const [isRetargeting, setIsRetargeting] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (confirmingRetarget && !dialog.open) dialog.showModal();
    else if (!confirmingRetarget && dialog.open) dialog.close();
  }, [confirmingRetarget]);

  const hasFieldChanges = branchType !== edge.branchType || branchLabel !== (edge.branchLabel ?? "");
  const hasRetarget = newFromNodeId !== edge.fromNodeId || newToNodeId !== edge.toNodeId;
  const labelRequired = branchType === "CUSTOM" && branchLabel.trim().length === 0;

  async function handleSaveFields() {
    setIsSaving(true);
    setErrorMessage(null);
    const result = await updateProcedureTemplateEdgeAction({
      edgeId: edge.id,
      patch: { branchType, branchLabel: branchLabel.trim() || null },
      expectedTemplateUpdatedAt,
      note,
    });
    setIsSaving(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    onSaved(result.updatedAt, result.structuralValidation);
  }

  async function handleConfirmRetarget() {
    setIsRetargeting(true);
    setErrorMessage(null);
    const result = await retargetProcedureTemplateEdgeAction({
      edgeId: edge.id,
      newFromNodeId,
      newToNodeId,
      reason: retargetReason,
      expectedTemplateUpdatedAt,
    });
    setIsRetargeting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    setConfirmingRetarget(false);
    onSaved(result.updatedAt, result.structuralValidation);
  }

  const preview = hasRetarget
    ? buildEdgeRetargetPreview({ fromNodeId: edge.fromNodeId, toNodeId: edge.toNodeId, branchType: edge.branchType, branchLabel: edge.branchLabel }, { fromNodeId: newFromNodeId, toNodeId: newToNodeId }, nodesById)
    : null;

  return (
    <div className="flex flex-col gap-4 text-xs">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">분기 속성</h3>
        <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">
          {nodesById.get(edge.fromNodeId)?.title ?? edge.fromNodeId} → {nodesById.get(edge.toNodeId)?.title ?? edge.toNodeId}
        </p>
      </div>

      <label className="flex flex-col gap-1">
        분기 유형
        <select value={branchType} onChange={(e) => setBranchType(e.target.value as ProcedureBranchType)} disabled={!canEdit} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900">
          {PROCEDURE_BRANCH_TYPE_CODES.map((bt) => (
            <option key={bt} value={bt}>
              {procedureBranchTypeLabels[bt]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        분기 라벨 {branchType === "CUSTOM" ? "(필수)" : "(선택)"}
        <input value={branchLabel} onChange={(e) => setBranchLabel(e.target.value)} disabled={!canEdit} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      <label className="flex flex-col gap-1">
        검토자 메모 (선택)
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={!canEdit} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
      </label>

      {canEdit && (
        <button
          type="button"
          disabled={!hasFieldChanges || labelRequired || isSaving}
          onClick={() => void handleSaveFields()}
          className="self-start rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {isSaving ? "저장 중..." : "속성 저장"}
        </button>
      )}

      {canEdit && (
        <div className="flex flex-col gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950">
          <h4 className="text-xs font-semibold text-blue-900 dark:text-blue-300">분기 대상 변경</h4>
          <label className="flex flex-col gap-1">
            시작 노드
            <select value={newFromNodeId} onChange={(e) => setNewFromNodeId(e.target.value)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title} ({n.nodeCode})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            대상 노드
            <select value={newToNodeId} onChange={(e) => setNewToNodeId(e.target.value)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title} ({n.nodeCode})
                </option>
              ))}
            </select>
          </label>
          <textarea
            rows={2}
            value={retargetReason}
            onChange={(e) => setRetargetReason(e.target.value)}
            placeholder="변경 사유 (필수)"
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="button"
            disabled={!hasRetarget || newFromNodeId === newToNodeId || retargetReason.trim().length === 0}
            onClick={() => setConfirmingRetarget(true)}
            className="self-start rounded-md border border-blue-400 px-3 py-1.5 text-sm font-medium text-blue-900 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-900"
          >
            변경 검토
          </button>
          {newFromNodeId === newToNodeId && <p className="text-red-600 dark:text-red-400">자기 자신으로의 분기는 지원하지 않습니다.</p>}
        </div>
      )}

      {errorMessage && <p className="text-red-600 dark:text-red-400">{errorMessage}</p>}

      <dialog
        ref={dialogRef}
        aria-labelledby="retarget-confirm-title"
        onCancel={(e) => {
          e.preventDefault();
          if (!isRetargeting) setConfirmingRetarget(false);
        }}
        className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      >
        <h2 id="retarget-confirm-title" className="text-sm font-semibold">
          분기 대상 변경 확인
        </h2>
        {preview && (
          <div className="mt-3 space-y-2 text-sm">
            <div>
              <p className="text-zinc-500 dark:text-zinc-400">현재</p>
              <p>
                {preview.current.from.title} → {preview.current.to.title} ({procedureBranchTypeLabels[preview.current.branchType]})
              </p>
            </div>
            <div>
              <p className="text-zinc-500 dark:text-zinc-400">변경 후</p>
              <p className="font-medium">
                {preview.proposed.from.title} → {preview.proposed.to.title} ({procedureBranchTypeLabels[preview.proposed.branchType]})
              </p>
            </div>
            <p className="whitespace-pre-wrap text-xs">
              <span className="text-zinc-500 dark:text-zinc-400">사유:</span> {retargetReason}
            </p>
          </div>
        )}
        {errorMessage && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirmingRetarget(false)}
            disabled={isRetargeting}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void handleConfirmRetarget()}
            disabled={isRetargeting}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
          >
            {isRetargeting ? "적용 중..." : "적용"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
