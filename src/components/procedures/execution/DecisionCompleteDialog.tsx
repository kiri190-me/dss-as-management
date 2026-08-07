"use client";

import { useEffect, useRef, useState } from "react";
import type { ExecutionOutgoingEdgeOption } from "@/lib/db/queries/procedure-case-execution";

/** DECISION-node completion — requires selecting exactly one of the node's own outgoing branches (plan §6); a plain confirm dialog is not enough since completing a DECISION always needs a selection. */
export default function DecisionCompleteDialog({
  isOpen,
  nodeTitle,
  outgoingEdgeOptions,
  isSubmitting,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  nodeTitle: string;
  outgoingEdgeOptions: ExecutionOutgoingEdgeOption[];
  isSubmitting: boolean;
  onConfirm: (selectedOutgoingEdgeId: string) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      setSelectedEdgeId("");
      setError(null);
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  function handleConfirm() {
    if (!selectedEdgeId) {
      setError("분기를 선택해 주세요.");
      return;
    }
    onConfirm(selectedEdgeId);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="decision-complete-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="decision-complete-dialog-title" className="text-sm font-semibold">
        판단 완료: {nodeTitle}
      </h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">선택한 분기가 실행 이력에 함께 기록됩니다.</p>

      <fieldset className="mt-3 flex flex-col gap-2">
        <legend className="sr-only">분기 선택</legend>
        {outgoingEdgeOptions.map((edge) => (
          <label
            key={edge.edgeId}
            className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <input
              type="radio"
              name="decision-outgoing-edge"
              value={edge.edgeId}
              checked={selectedEdgeId === edge.edgeId}
              onChange={() => setSelectedEdgeId(edge.edgeId)}
            />
            <span>
              {edge.branchLabel ?? edge.branchType} → {edge.toNodeTitle}
            </span>
          </label>
        ))}
      </fieldset>
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          취소
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isSubmitting}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {isSubmitting ? "처리 중..." : "완료"}
        </button>
      </div>
    </dialog>
  );
}
