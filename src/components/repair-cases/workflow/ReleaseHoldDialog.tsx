"use client";

import { useEffect, useRef, useState } from "react";

type ReleaseHoldDialogProps = {
  isOpen: boolean;
  holdReason: string | null;
  isSubmitting: boolean;
  /**
   * 보류 해제 사유는 선택 입력이다(2026-08-18 완화 — HoldDialog와 동일한
   * 취급). 비워 두면 null이 넘어가고 서버도 사유 없이 해제한다.
   */
  onConfirm: (reason: string | null) => void;
  onCancel: () => void;
};

export default function ReleaseHoldDialog({
  isOpen,
  holdReason,
  isSubmitting,
  onConfirm,
  onCancel,
}: ReleaseHoldDialogProps) {
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
    onConfirm(trimmed === "" ? null : trimmed);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="release-hold-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="release-hold-dialog-title" className="text-sm font-semibold">
        보류 해제
      </h2>
      {holdReason && (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">기존 보류 사유: &ldquo;{holdReason}&rdquo;</p>
      )}

      <div className="mt-3 flex flex-col gap-1">
        <label htmlFor="release-hold-reason" className="text-xs text-zinc-500 dark:text-zinc-400">
          보류 해제 사유 (선택)
        </label>
        <textarea
          id="release-hold-reason"
          ref={textareaRef}
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "release-hold-reason-error" : undefined}
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        {error && (
          <p id="release-hold-reason-error" className="text-xs text-red-600 dark:text-red-400">
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
          {isSubmitting ? "처리 중..." : "보류 해제"}
        </button>
      </div>
    </dialog>
  );
}
