"use client";

import { useEffect, useRef } from "react";

/**
 * ============================================================================
 * 첨부 영구 삭제 확인 창 — 되돌릴 수 없다는 것을 말하는 자리 (2026-10-07)
 * ============================================================================
 * 🔴 **옆집(DeleteAttachmentDialog)을 고쳐 쓰지 않았다.** 그 창의 문구는
 * 「소프트 삭제입니다 … 언제든 복원할 수 있습니다」이고, 이 창이 하는 말과 성질이
 * 정반대다. 한 창에 두 성질을 담으면 어느 날 둘 중 하나가 틀린 문장을 보인다.
 *
 * 🔴 **사유를 받지 않는다.** 휴지통에 넣을 때 받은 `delete_reason` 이 영구 삭제
 * 감사 로그의 previousValue 에 함께 실린다(mutations/attachment-purge.ts) — 같은
 * 파일을 두고 사유를 두 번 묻지 않는다.
 *
 * 세 화면(수리건 파일 관리 · 제품 모델 사진/도면 · 제품 종류 공통 서류)이 이 창
 * **하나**를 함께 쓴다. 자리를 여기(repair-cases/files)로 둔 것은 이웃 둘
 * (DeleteAttachmentDialog · RestoreAttachmentDialog)이 이미 그렇게 쓰이고 있어서다 —
 * 제품 모델 쪽 두 화면이 그 둘을 이 폴더에서 가져다 쓴다.
 * ============================================================================
 */

type PurgeAttachmentDialogProps = {
  isOpen: boolean;
  displayName: string;
  isSubmitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function PurgeAttachmentDialog({
  isOpen,
  displayName,
  isSubmitting,
  onConfirm,
  onCancel,
}: PurgeAttachmentDialogProps) {
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
      data-purge-attachment-dialog
      aria-labelledby="purge-attachment-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="purge-attachment-dialog-title" className="text-sm font-semibold text-red-700 dark:text-red-400">
        첨부파일 영구 삭제
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        대상: <span className="font-medium text-zinc-900 dark:text-zinc-50">{displayName}</span>
      </p>
      <p className="mt-2 text-sm font-medium text-red-700 dark:text-red-400">되돌릴 수 없습니다.</p>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
        디스크의 파일까지 지워집니다 — 되살리기로 돌아오지 않습니다.
      </p>
      {/*
        공유폴더에 넣어 둔 사본은 앱이 지우지 않는다 — 휴지통 확인 창이 같은 말을
        하는 것과 같은 까닭이다(DeleteAttachmentDialog 의 주석). 「지웠다」고 믿게
        두지 않는다.
      */}
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        공유폴더에 넣어 둔 사본은 그대로 남습니다 — 필요하면 탐색기에서 직접 지워 주세요.
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
          data-purge-attachment-confirm
          onClick={onConfirm}
          disabled={isSubmitting}
          className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
        >
          {isSubmitting ? "삭제 중..." : "영구 삭제"}
        </button>
      </div>
    </dialog>
  );
}
