"use client";

import { useEffect, useRef, useState } from "react";

/** Generic reason-required confirmation dialog — same shape as repair-cases/approval/ApprovalActionDialog.tsx, reused here for skip/block/reopen actions that all require an explicit reason. */
export default function ReasonPromptDialog({
  isOpen,
  title,
  warningNote,
  isSubmitting,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  title: string;
  warningNote?: string | null;
  isSubmitting: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

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
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("사유를 입력해 주세요.");
      textareaRef.current?.focus();
      return;
    }
    onConfirm(trimmed);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="reason-prompt-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="reason-prompt-dialog-title" className="text-sm font-semibold">
        {title}
      </h2>
      {warningNote && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{warningNote}</p>}

      <div className="mt-3 flex flex-col gap-1">
        <label htmlFor="reason-prompt-textarea" className="text-xs text-zinc-500 dark:text-zinc-400">
          사유 *
        </label>
        <textarea
          id="reason-prompt-textarea"
          ref={textareaRef}
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "reason-prompt-error" : undefined}
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        {error && (
          <p id="reason-prompt-error" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>

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
          {isSubmitting ? "처리 중..." : "확인"}
        </button>
      </div>
    </dialog>
  );
}
