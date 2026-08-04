"use client";

import { useEffect, useRef, useState } from "react";

type TransitionDialogMode = "advance" | "return";

type TransitionDialogProps = {
  isOpen: boolean;
  mode: TransitionDialogMode;
  fromStepLabel: string;
  toStepLabel: string;
  toStatusLabel: string;
  requiresApprovalLabel: string | null;
  isSubmitting: boolean;
  onConfirm: (reason: string | null) => void;
  onCancel: () => void;
};

const COPY: Record<TransitionDialogMode, { title: string; confirmLabel: string }> = {
  advance: { title: "다음 단계로 진행", confirmLabel: "진행" },
  return: { title: "이전 단계로 되돌리기", confirmLabel: "되돌리기" },
};

export default function TransitionDialog({
  isOpen,
  mode,
  fromStepLabel,
  toStepLabel,
  toStatusLabel,
  requiresApprovalLabel,
  isSubmitting,
  onConfirm,
  onCancel,
}: TransitionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[mode];
  const titleId = `transition-dialog-title-${mode}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      setReason("");
      setError(null);
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  function handleConfirm() {
    if (mode === "return") {
      const trimmed = reason.trim();
      if (!trimmed) {
        setError("되돌리기 사유를 입력해 주세요.");
        textareaRef.current?.focus();
        return;
      }
      onConfirm(trimmed);
      return;
    }
    onConfirm(null);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id={titleId} className="text-sm font-semibold">
        {copy.title}
      </h2>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">현재 단계</dt>
          <dd className="break-words text-zinc-900 dark:text-zinc-50">{fromStepLabel}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">대상 단계</dt>
          <dd className="break-words text-zinc-900 dark:text-zinc-50">{toStepLabel}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">대상 상태</dt>
          <dd className="text-zinc-900 dark:text-zinc-50">{toStatusLabel}</dd>
        </div>
      </dl>

      {requiresApprovalLabel && (
        <p className="mt-2 rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">
          {requiresApprovalLabel}
        </p>
      )}

      {mode === "return" && (
        <div className="mt-3 flex flex-col gap-1">
          <label htmlFor="transition-return-reason" className="text-xs text-zinc-500 dark:text-zinc-400">
            되돌리기 사유 *
          </label>
          <textarea
            id="transition-return-reason"
            ref={textareaRef}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "transition-return-reason-error" : undefined}
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          {error && (
            <p id="transition-return-reason-error" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </div>
      )}

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
          {isSubmitting ? "처리 중..." : copy.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
