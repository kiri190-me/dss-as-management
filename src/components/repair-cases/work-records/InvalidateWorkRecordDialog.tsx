"use client";

import { useEffect, useRef, useState } from "react";

export default function InvalidateWorkRecordDialog({
  isOpen,
  isSubmitting,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
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
      setError("무효 처리 사유를 입력해 주세요.");
      textareaRef.current?.focus();
      return;
    }
    onConfirm(trimmed);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="invalidate-work-record-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="invalidate-work-record-dialog-title" className="text-sm font-semibold">
        작업 기록 무효 처리
      </h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        원본 기록은 삭제되지 않고 그대로 보존되며, &ldquo;무효&rdquo;로 표시되어 계속 조회할 수 있습니다. 이 작업은 되돌릴 수 없습니다.
      </p>

      <div className="mt-3 flex flex-col gap-1">
        <label htmlFor="invalidate-reason" className="text-xs text-zinc-500 dark:text-zinc-400">
          무효 처리 사유 *
        </label>
        <textarea
          id="invalidate-reason"
          ref={textareaRef}
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "invalidate-reason-error" : undefined}
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        {error && (
          <p id="invalidate-reason-error" className="text-xs text-red-600 dark:text-red-400">
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
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {isSubmitting ? "처리 중..." : "무효 처리"}
        </button>
      </div>
    </dialog>
  );
}
