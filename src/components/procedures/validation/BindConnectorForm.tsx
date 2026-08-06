"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { bindValidationIssueEdgeAction } from "@/lib/server/actions/procedure-validation-resolutions";
import {
  PROCEDURE_BRANCH_TYPE_CODES,
  procedureBranchTypeLabels,
  type ProcedureBranchType,
} from "@/lib/domain/procedure-template-types";

type NodeOption = { id: string; nodeCode: string; title: string; sourceWorksheet: string | null };

/**
 * Bind an existing unbound connector to two existing nodes (Phase 3A) —
 * never creates a new node, never auto-picks a candidate. The reviewer
 * always explicitly selects both endpoints, even when one is pre-filled
 * from the top-ranked candidate, and must pass through a second, explicit
 * confirmation step (a native <dialog>, same pattern as
 * ApprovalActionDialog.tsx) before the mutation actually fires.
 */
export default function BindConnectorForm({
  issueId,
  nodeOptions,
  suggestedSourceNodeId,
  suggestedTargetNodeId,
}: {
  issueId: string;
  nodeOptions: NodeOption[];
  suggestedSourceNodeId?: string | null;
  suggestedTargetNodeId?: string | null;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [sourceNodeId, setSourceNodeId] = useState(suggestedSourceNodeId ?? "");
  const [targetNodeId, setTargetNodeId] = useState(suggestedTargetNodeId ?? "");
  const [branchType, setBranchType] = useState<ProcedureBranchType>("DEFAULT");
  const [branchLabel, setBranchLabel] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (confirming && !dialog.open) dialog.showModal();
    else if (!confirming && dialog.open) dialog.close();
  }, [confirming]);

  const sourceNode = nodeOptions.find((n) => n.id === sourceNodeId);
  const targetNode = nodeOptions.find((n) => n.id === targetNodeId);
  const canReview = sourceNodeId.length > 0 && targetNodeId.length > 0 && sourceNodeId !== targetNodeId && resolutionNote.trim().length > 0;

  async function handleConfirm() {
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await bindValidationIssueEdgeAction({
      issueId,
      sourceNodeId,
      targetNodeId,
      branchType,
      branchLabel: branchLabel.trim() || null,
      resolutionNote: resolutionNote.trim(),
    });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">연결선 바인딩</h3>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          시작 노드
          <select
            value={sourceNodeId}
            onChange={(e) => setSourceNodeId(e.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            <option value="">노드를 선택하세요</option>
            {nodeOptions.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title} ({n.nodeCode})
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          대상 노드
          <select
            value={targetNodeId}
            onChange={(e) => setTargetNodeId(e.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            <option value="">노드를 선택하세요</option>
            {nodeOptions.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title} ({n.nodeCode})
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          분기 유형
          <select
            value={branchType}
            onChange={(e) => setBranchType(e.target.value as ProcedureBranchType)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            {PROCEDURE_BRANCH_TYPE_CODES.map((bt) => (
              <option key={bt} value={bt}>
                {procedureBranchTypeLabels[bt]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          분기 라벨 (선택)
          <input
            type="text"
            value={branchLabel}
            onChange={(e) => setBranchLabel(e.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
        해결 메모 (필수)
        <textarea
          rows={2}
          value={resolutionNote}
          onChange={(e) => setResolutionNote(e.target.value)}
          placeholder="예: 원본 도면 connector#57의 유실된 바인딩을 복원함 (거리 1.00, 확실)"
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </label>

      {sourceNode && targetNode && sourceNodeId === targetNodeId && (
        <p className="text-xs text-red-600 dark:text-red-400">자기 자신으로의 분기는 지원하지 않습니다.</p>
      )}

      <div>
        <button
          type="button"
          disabled={!canReview}
          onClick={() => setConfirming(true)}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          검토 후 적용
        </button>
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby="bind-connector-confirm-title"
        onCancel={(e) => {
          e.preventDefault();
          if (!isSubmitting) setConfirming(false);
        }}
        className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      >
        <h2 id="bind-connector-confirm-title" className="text-sm font-semibold">
          분기 추가 확인
        </h2>
        <div className="mt-3 space-y-1 text-sm">
          <p>
            <span className="text-zinc-500 dark:text-zinc-400">시작:</span> {sourceNode?.title} ({sourceNode?.nodeCode})
          </p>
          <p>
            <span className="text-zinc-500 dark:text-zinc-400">대상:</span> {targetNode?.title} ({targetNode?.nodeCode})
          </p>
          <p>
            <span className="text-zinc-500 dark:text-zinc-400">분기 유형:</span> {procedureBranchTypeLabels[branchType]}
            {branchLabel ? ` ("${branchLabel}")` : ""}
          </p>
          <p className="whitespace-pre-wrap">
            <span className="text-zinc-500 dark:text-zinc-400">메모:</span> {resolutionNote}
          </p>
        </div>
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          이 작업은 실제 절차 그래프에 새 분기를 추가하고 이 이슈를 &quot;해결됨 (그래프 변경)&quot;으로 표시합니다.
        </p>
        {errorMessage && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={isSubmitting}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={isSubmitting}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {isSubmitting ? "적용 중..." : "적용"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
