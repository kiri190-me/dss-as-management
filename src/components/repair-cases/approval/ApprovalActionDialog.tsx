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
   * 사내 목표 출하일(YYYY-MM-DD) — 판단에 참고하라고 **읽기 전용**으로 한 줄
   * 보여 준다. 위 「처리할 사람」과 같은 방식으로 **주지 않으면 그 자리를 아예
   * 그리지 않는다**: 이 창은 검수 카드와 출하 카드가 함께 쓰는데, 이 날짜를
   * 보고 판단하는 것은 출하 승인 쪽(요청·승인·반려 셋 다)뿐이다. 검수 카드는
   * 주지 않으므로 지금과 똑같이 그려진다.
   *
   * 🔴 「주지 않음」(undefined)과 「아직 정해지지 않음」(null)이 서로 다른 뜻이다 —
   * 뒤엣것은 그 사실과 **어디서 입력하는지**를 대신 적는다. 「-」 한 글자만
   * 보여 주면 사람은 어디서 고치는지 모른다.
   *
   * 🔴 이 창에서는 **고칠 수 없다.** 이 값의 편집 경로는 「접수 정보 편집」
   * 하나뿐이고(IntakeInfoEditForm.tsx 머리말), 이 창은 그 약속을 지켜 읽기만
   * 한다 — 그래서 입력칸이 아니라 글자로 그린다.
   */
  internalTargetShipmentDate?: string | null;
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
  internalTargetShipmentDate,
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

      {/*
        읽기 전용 한 줄. 🔴 <input>·<select> 를 만들지 않는다 — 입력칸처럼
        생기면 사람이 여기서 고치려 든다. 이름표에 「읽기 전용」을 적어 두는
        것도 같은 이유다(고치는 자리는 「접수 정보 편집」 하나뿐이다).
      */}
      {internalTargetShipmentDate !== undefined && (
        <dl className="mt-3 rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">사내 목표 출하일 (읽기 전용)</dt>
          <dd
            className={
              internalTargetShipmentDate
                ? "mt-0.5 text-sm text-zinc-900 dark:text-zinc-50"
                : "mt-0.5 text-sm text-zinc-500 dark:text-zinc-400"
            }
          >
            {internalTargetShipmentDate ?? "아직 정해지지 않았습니다. 접수 정보에서 입력합니다."}
          </dd>
        </dl>
      )}

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
