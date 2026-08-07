"use client";

import { useEffect, useRef, useState } from "react";
import { PROCEDURE_BRANCH_TYPE_CODES, procedureBranchTypeLabels, type ProcedureBranchType } from "@/lib/domain/procedure-template-types";
import type { EditorNodeRow } from "@/lib/db/queries/procedure-template-editor";
import { createProcedureTemplateEdgeAction } from "@/lib/server/actions/procedure-template-editor";
import { buildNewEdgePreview, type NodeLookup } from "@/lib/domain/procedure-editor-client-state";
import type { StructuralValidationSummary } from "@/lib/db/mutations/procedure-template-editor";

/**
 * Add-connection panel (Phase 4A) — only ever links two existing nodes
 * (no node creation), always requires an explicit reason and a preview
 * confirmation before the edge is persisted. A caller may pre-fill
 * fromNodeId (e.g. "새 연결 추가" invoked with a node already selected) but
 * the reviewer still must pick the target and confirm.
 */
export default function CreateEdgePanel({
  templateId,
  nodes,
  canEdit,
  expectedTemplateUpdatedAt,
  prefillFromNodeId,
  onSaved,
}: {
  templateId: string;
  nodes: EditorNodeRow[];
  canEdit: boolean;
  expectedTemplateUpdatedAt: string;
  prefillFromNodeId?: string | null;
  onSaved: (newUpdatedAt: string, structuralValidation?: StructuralValidationSummary) => void;
}) {
  const nodesById = new Map<string, NodeLookup>(nodes.map((n) => [n.id, { id: n.id, title: n.title, nodeCode: n.nodeCode }]));
  const [fromNodeId, setFromNodeId] = useState(prefillFromNodeId ?? nodes[0]?.id ?? "");
  const [toNodeId, setToNodeId] = useState("");
  const [branchType, setBranchType] = useState<ProcedureBranchType>("DEFAULT");
  const [branchLabel, setBranchLabel] = useState("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (confirming && !dialog.open) dialog.showModal();
    else if (!confirming && dialog.open) dialog.close();
  }, [confirming]);

  const labelRequired = branchType === "CUSTOM" && branchLabel.trim().length === 0;
  const canReview = fromNodeId.length > 0 && toNodeId.length > 0 && fromNodeId !== toNodeId && !labelRequired && reason.trim().length > 0;

  async function handleConfirm() {
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await createProcedureTemplateEdgeAction({
      templateId,
      fromNodeId,
      toNodeId,
      branchType,
      branchLabel: branchLabel.trim() || null,
      reason,
      expectedTemplateUpdatedAt,
    });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    setConfirming(false);
    setToNodeId("");
    setReason("");
    onSaved(result.updatedAt, result.structuralValidation);
  }

  if (!canEdit) return null;

  const preview = buildNewEdgePreview({ fromNodeId, toNodeId, branchType, branchLabel: branchLabel.trim() || null }, nodesById);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs dark:border-emerald-900 dark:bg-emerald-950">
      <h3 className="text-sm font-semibold text-emerald-900 dark:text-emerald-300">새 연결 추가</h3>
      <label className="flex flex-col gap-1">
        시작 노드
        <select value={fromNodeId} onChange={(e) => setFromNodeId(e.target.value)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          <option value="">노드를 선택하세요</option>
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.title} ({n.nodeCode})
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        대상 노드
        <select value={toNodeId} onChange={(e) => setToNodeId(e.target.value)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          <option value="">노드를 선택하세요</option>
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.title} ({n.nodeCode})
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        분기 유형
        <select value={branchType} onChange={(e) => setBranchType(e.target.value as ProcedureBranchType)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          {PROCEDURE_BRANCH_TYPE_CODES.map((bt) => (
            <option key={bt} value={bt}>
              {procedureBranchTypeLabels[bt]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        분기 라벨 {branchType === "CUSTOM" ? "(필수)" : "(선택)"}
        <input value={branchLabel} onChange={(e) => setBranchLabel(e.target.value)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      <label className="flex flex-col gap-1">
        추가 사유 (필수)
        <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      {fromNodeId && toNodeId && fromNodeId === toNodeId && <p className="text-red-600 dark:text-red-400">자기 자신으로의 분기는 지원하지 않습니다.</p>}
      <button
        type="button"
        disabled={!canReview}
        onClick={() => setConfirming(true)}
        className="self-start rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        연결 검토
      </button>
      {errorMessage && !confirming && <p className="text-red-600 dark:text-red-400">{errorMessage}</p>}

      <dialog
        ref={dialogRef}
        aria-labelledby="create-edge-confirm-title"
        onCancel={(e) => {
          e.preventDefault();
          if (!isSubmitting) setConfirming(false);
        }}
        className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      >
        <h2 id="create-edge-confirm-title" className="text-sm font-semibold">
          새 연결 추가 확인
        </h2>
        <div className="mt-3 space-y-1 text-sm">
          <p>
            {preview.from.title} → {preview.to.title}
          </p>
          <p>
            <span className="text-zinc-500 dark:text-zinc-400">분기 유형:</span> {procedureBranchTypeLabels[preview.branchType]}
            {preview.branchLabel ? ` ("${preview.branchLabel}")` : ""}
          </p>
          <p className="whitespace-pre-wrap text-xs">
            <span className="text-zinc-500 dark:text-zinc-400">사유:</span> {reason}
          </p>
        </div>
        {errorMessage && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={isSubmitting}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={isSubmitting}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
          >
            {isSubmitting ? "추가 중..." : "추가"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
