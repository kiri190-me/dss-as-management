"use client";

import { useEffect, useRef, useState } from "react";

type ShipmentCompletionDialogProps = {
  isOpen: boolean;
  isSubmitting: boolean;
  onConfirm: (note: string) => void;
  onCancel: () => void;
};

export default function ShipmentCompletionDialog({
  isOpen,
  isSubmitting,
  onConfirm,
  onCancel,
}: ShipmentCompletionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      setNote("");
      setError(null);
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  function handleConfirm() {
    const trimmed = note.trim();
    if (!trimmed) {
      setError("출하 완료 메모를 입력해 주세요.");
      textareaRef.current?.focus();
      return;
    }
    onConfirm(trimmed);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="shipment-completion-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="shipment-completion-dialog-title" className="text-sm font-semibold">
        출하 완료 처리
      </h2>
      <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
        이 데모 단계에서는 출하 완료가 종료 상태입니다. 처리 후에는 되돌릴 수 없습니다.
      </p>

      <div className="mt-3 flex flex-col gap-1">
        <label htmlFor="shipment-completion-note" className="text-xs text-zinc-500 dark:text-zinc-400">
          출하 완료 메모 *
        </label>
        <textarea
          id="shipment-completion-note"
          ref={textareaRef}
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "shipment-completion-note-error" : undefined}
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        {error && (
          <p id="shipment-completion-note-error" className="text-xs text-red-600 dark:text-red-400">
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
          className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          {isSubmitting ? "처리 중..." : "출하 완료 확정"}
        </button>
      </div>
    </dialog>
  );
}
