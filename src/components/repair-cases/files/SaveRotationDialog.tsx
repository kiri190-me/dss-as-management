"use client";

import { useEffect, useRef } from "react";
import { describeOrientation, type ImageOrientation } from "@/lib/domain/image-orientation";

/**
 * ============================================================================
 * 「돌린 대로 저장」 확인 창 — 되돌릴 수 없다는 것을 분명히 말한다
 * ============================================================================
 * 이 저장소의 확인 창 관행을 그대로 따른다(DeleteAttachmentDialog ·
 * RestoreAttachmentDialog와 같은 `<dialog>` + `showModal()`). `window.confirm` 을
 * 쓰지 않는 까닭은 세 가지다 — 글자를 꾸밀 수 없어 「되돌릴 수 없습니다」가
 * 파묻히고, 폰에서 브라우저 UI 로 뜨며, 처리 중 상태를 보여 줄 자리가 없다.
 *
 * 🔴 **크게 보기(AttachmentViewer) 위에 뜬다.** 그 화면이 `fixed inset-0 z-50`
 * 이지만 `showModal()` 로 연 `<dialog>` 는 브라우저의 맨 위 층(top layer)에
 * 그려지므로 z-index 를 다투지 않는다.
 *
 * 무엇을 하는 것인지 **방향을 글자로** 보여 준다 — 「저장」만 있으면 자기가 무엇을
 * 돌려 놓았는지 확인 창에서 다시 볼 방법이 없다.
 * ============================================================================
 */

type SaveRotationDialogProps = {
  isOpen: boolean;
  displayName: string;
  orientation: ImageOrientation;
  isSubmitting: boolean;
  /** 저장이 막혔을 때 서버가 준 문장. 창을 닫지 않고 여기 보여 준다. */
  errorMessage: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function SaveRotationDialog({
  isOpen,
  displayName,
  orientation,
  isSubmitting,
  errorMessage,
  onConfirm,
  onCancel,
}: SaveRotationDialogProps) {
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
      aria-labelledby="save-rotation-dialog-title"
      onCancel={(event) => {
        // 저장 중에 Esc 로 닫히면 무엇이 저장됐는지 알 수 없게 된다.
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="save-rotation-dialog-title" className="text-sm font-semibold">
        돌린 대로 원본에 저장
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        대상: <span className="font-medium text-zinc-900 dark:text-zinc-50">{displayName}</span>
      </p>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        바꿀 방향:{" "}
        <span className="font-medium text-zinc-900 dark:text-zinc-50">
          {describeOrientation(orientation)}
        </span>
      </p>

      {/*
        🔴 이 문단이 이 창의 존재 이유다. 색과 굵기로 눈에 걸리게 두고, 무엇이
        함께 바뀌는지(목록의 작은 그림)도 함께 말한다 — 저장 뒤 목록이 달라 보이는
        것이 고장으로 오해되지 않게.
      */}
      <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        <strong className="font-semibold">원본 파일을 덮어씁니다. 되돌릴 수 없습니다.</strong>
        <br />
        목록에 쓰는 작은 그림도 함께 새 방향으로 바뀝니다.
      </p>

      {errorMessage && (
        <p
          role="alert"
          className="mt-2 rounded-md border border-red-200 bg-white px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-zinc-900 dark:text-red-400"
        >
          {errorMessage}
        </p>
      )}

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
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {isSubmitting ? "저장 중..." : "덮어쓰고 저장"}
        </button>
      </div>
    </dialog>
  );
}
