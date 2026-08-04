"use client";

import { useEffect, useRef, useState } from "react";

type ApprovalActionDialogProps = {
  isOpen: boolean;
  title: string;
  requireComment: boolean;
  isSubmitting: boolean;
  onConfirm: (comment: string | null) => void;
  onCancel: () => void;
};

/**
 * 승인/보완요청/반려 공통 확인 다이얼로그다. ClearDraftDialog.tsx와 동일하게
 * 네이티브 <dialog>의 showModal/close로 포커스 트랩과 Escape 취소를 얻는다
 * (별도 다이얼로그 패키지를 쓰지 않는다).
 */
export default function ApprovalActionDialog({
  isOpen,
  title,
  requireComment,
  isSubmitting,
  onConfirm,
  onCancel,
}: ApprovalActionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      setComment("");
      setError(null);
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  function handleConfirm() {
    const trimmed = comment.trim();
    if (requireComment && !trimmed) {
      setError("사유를 입력해 주세요.");
      textareaRef.current?.focus();
      return;
    }
    onConfirm(trimmed || null);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="approval-action-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="approval-action-dialog-title" className="text-sm font-semibold">
        {title}
      </h2>

      <div className="mt-3 flex flex-col gap-1">
        <label htmlFor="approval-action-comment" className="text-xs text-zinc-500 dark:text-zinc-400">
          결정 코멘트{requireComment ? " *" : " (선택)"}
        </label>
        <textarea
          id="approval-action-comment"
          ref={textareaRef}
          rows={3}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "approval-action-comment-error" : undefined}
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        {error && (
          <p id="approval-action-comment-error" className="text-xs text-red-600 dark:text-red-400">
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
