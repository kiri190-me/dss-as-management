"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_DELETION_REASON_LENGTH } from "@/lib/domain/local/attachments/filename";

type DeleteAttachmentDialogProps = {
  isOpen: boolean;
  displayName: string;
  isSubmitting: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
};

export default function DeleteAttachmentDialog({
  isOpen,
  displayName,
  isSubmitting,
  onConfirm,
  onCancel,
}: DeleteAttachmentDialogProps) {
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
      setError("삭제 사유를 입력해 주세요.");
      textareaRef.current?.focus();
      return;
    }
    if (trimmed.length > MAX_DELETION_REASON_LENGTH) {
      setError(`삭제 사유는 ${MAX_DELETION_REASON_LENGTH}자 이하로 입력해 주세요.`);
      textareaRef.current?.focus();
      return;
    }
    onConfirm(trimmed);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="delete-attachment-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="delete-attachment-dialog-title" className="text-sm font-semibold">
        첨부파일 메타데이터 삭제
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        대상: <span className="font-medium text-zinc-900 dark:text-zinc-50">{displayName}</span>
      </p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        소프트 삭제입니다. 기록은 저장소에 남아 있으며 언제든 복원할 수 있습니다.
      </p>
      {/*
        🔴 **앱은 공유폴더의 파일을 지우지 않는다**(그것이 규칙이다 —
        storage/contact-folder-archive.ts 머리말). 그래서 첨부를 휴지통에 넣어도 연락서
        폴더에 꽂아 둔 사본은 그대로 남는다. 그 사실을 말하지 않으면 사람은 「지웠다」고
        믿는다.

        🔴 **늘 보인다**(공유폴더 기능이 켜졌을 때만 보이게 하지 않는다). 까닭 둘:
         · 이 확인창은 서버 설정을 모른다. 그것을 알리려면 페이지 → FilesScreen →
           이 창으로 깃발 하나를 세 겹 넘겨야 하는데, 한 문장 때문에 치를 값이 아니다.
         · 문장이 **기능과 무관하게 참이다.** 연락서 폴더에는 직원이 손으로 넣은 사본도
           있고, 앱은 그것도 지우지 않는다. 더 보여서 치르는 값은 한 줄이지만, 덜 보여서
           치르는 값은 「지운 줄 알았던 파일」이다.
      */}
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        공유폴더에 넣어 둔 사본은 그대로 남습니다 — 필요하면 탐색기에서 직접 지워 주세요.
      </p>

      <div className="mt-3 flex flex-col gap-1">
        <label htmlFor="delete-attachment-reason" className="text-xs text-zinc-500 dark:text-zinc-400">
          삭제 사유 *
        </label>
        <textarea
          id="delete-attachment-reason"
          ref={textareaRef}
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "delete-attachment-reason-error" : undefined}
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        {error && (
          <p id="delete-attachment-reason-error" className="text-xs text-red-600 dark:text-red-400">
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
          {isSubmitting ? "삭제 중..." : "삭제"}
        </button>
      </div>
    </dialog>
  );
}
