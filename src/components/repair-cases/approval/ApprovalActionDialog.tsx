"use client";

import { useEffect, useRef, useState } from "react";

export type ApprovalAssigneeOption = {
  id: string;
  name: string;
  /** 역할 이름표 — 동명이인을 구별하는 데만 쓴다. 없으면 이름만 보인다. */
  roleLabel?: string;
};

type ApprovalActionDialogProps = {
  isOpen: boolean;
  title: string;
  requireComment: boolean;
  isSubmitting: boolean;
  /**
   * 「누구에게 보낼까요」 고르는 자리의 후보. **주지 않으면 그 자리를 아예
   * 그리지 않는다** — 이 창은 요청·승인·반려 셋에 함께 쓰이고 검수 카드와
   * 출하 카드 둘 다 쓰므로, 고르는 자리가 나와야 하는 것은 검수 승인 **요청**
   * 하나뿐이다. 나머지 경우는 이 속성을 주지 않아 지금과 똑같이 그려진다.
   */
  assigneeOptions?: ApprovalAssigneeOption[];
  /**
   * 두 번째 인자는 고른 사람의 id다. 고르는 자리를 그리지 않았으면 언제나
   * `null`이므로, 그 자리를 쓰지 않는 호출부는 인자를 하나만 받으면 된다.
   */
  onConfirm: (comment: string | null, assignedApproverUserId: string | null) => void;
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
  assigneeOptions,
  onConfirm,
  onCancel,
}: ApprovalActionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [comment, setComment] = useState("");
  // 빈 문자열이 「지정하지 않음」이고 기본값이다 — 창을 열 때마다 여기로
  // 돌아온다(지난 선택이 다음 요청에 묻어가지 않게).
  const [assigneeId, setAssigneeId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      setComment("");
      setAssigneeId("");
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
    onConfirm(trimmed || null, assigneeOptions ? assigneeId || null : null);
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

      {assigneeOptions && (
        <div className="mt-3 flex flex-col gap-1">
          <label htmlFor="approval-action-assignee" className="text-xs text-zinc-500 dark:text-zinc-400">
            처리할 사람 (선택)
          </label>
          <select
            id="approval-action-assignee"
            value={assigneeId}
            onChange={(event) => setAssigneeId(event.target.value)}
            aria-describedby="approval-action-assignee-help"
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            <option value="">지정하지 않음</option>
            {assigneeOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.roleLabel ? `${option.name} (${option.roleLabel})` : option.name}
              </option>
            ))}
          </select>
          <p id="approval-action-assignee-help" className="text-xs text-zinc-500 dark:text-zinc-400">
            지정하면 그 사람만 처리할 수 있습니다. 비워 두면 자격 있는 사람 누구나 처리합니다.
          </p>
        </div>
      )}

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
          className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200"
        >
          {isSubmitting ? "처리 중..." : "확인"}
        </button>
      </div>
    </dialog>
  );
}
