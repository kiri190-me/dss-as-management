"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Generic reason-required confirmation dialog — same shape as
 * repair-cases/approval/ApprovalActionDialog.tsx, reused here for skip/block/
 * reopen actions that all require an explicit reason.
 *
 * 🔴 **id 는 instance 마다 새로 뽑는다**(useId, 2026-11-02 조각 8 보완). 이 창은
 * 한 화면에 **여럿이 동시에 DOM 에 있다** — 노드 카드마다 셋(건너뛰기·차단·재개)
 * 이고, 2026-11-02 부터 「이 건의 다른 절차」의 줄마다 하나씩 더 생겼다. 전에는
 * id 가 `reason-prompt-textarea` 처럼 **고정 글자**라 문서에 같은 id 가 수십 개
 * 있었고, `label htmlFor` 는 그중 **맨 앞의 것**으로 가므로 라벨을 눌렀을 때
 * 엉뚱한 창의 칸에 초점이 갔다(aria-labelledby·aria-describedby 도 마찬가지).
 * 창이 열리고 닫히는 것 자체는 instance 마다 제 상태·제 ref 로 하므로 **누른 줄의
 * 창이 열리는 것은 전부터 맞았다** — 어긋난 것은 라벨과 낭독기 쪽이다.
 */
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
  // 같은 화면에 이 창이 여럿 있으므로 id 를 instance 마다 뽑는다(위 머리말).
  const instanceId = useId();
  const titleId = `reason-prompt-dialog-title-${instanceId}`;
  const textareaId = `reason-prompt-textarea-${instanceId}`;
  const errorId = `reason-prompt-error-${instanceId}`;

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
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id={titleId} className="text-sm font-semibold">
        {title}
      </h2>
      {warningNote && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{warningNote}</p>}

      <div className="mt-3 flex flex-col gap-1">
        <label htmlFor={textareaId} className="text-xs text-zinc-500 dark:text-zinc-400">
          사유 *
        </label>
        <textarea
          id={textareaId}
          ref={textareaRef}
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        {error && (
          <p id={errorId} className="text-xs text-red-600 dark:text-red-400">
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
