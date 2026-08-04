"use client";

import { useEffect, useRef } from "react";

type RestoreAttachmentDialogProps = {
  isOpen: boolean;
  displayName: string;
  isSubmitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function RestoreAttachmentDialog({
  isOpen,
  displayName,
  isSubmitting,
  onConfirm,
  onCancel,
}: RestoreAttachmentDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="restore-attachment-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="restore-attachment-dialog-title" className="text-sm font-semibold">
        첨부파일 메타데이터 복원
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        대상: <span className="font-medium text-zinc-900 dark:text-zinc-50">{displayName}</span>
      </p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        복원하면 목록에 다시 표시됩니다. 이전 삭제 이력은 이벤트 타임라인에 그대로 남습니다.
      </p>

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
          onClick={onConfirm}
          disabled={isSubmitting}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {isSubmitting ? "복원 중..." : "복원"}
        </button>
      </div>
    </dialog>
  );
}
