"use client";

import { useEffect, useRef, useState } from "react";
import { WORK_RECORD_KIND_CODES, type WorkRecordKind } from "@/lib/domain/types";
import { useUiText } from "@/components/providers/UiTextProvider";

/**
 * 작업 기록 고치기 창(2026-10-02). 이웃 InvalidateWorkRecordDialog 를 본보기로
 * 같은 모양으로 짰다 — 네이티브 `<dialog>`, `showModal()`, Esc 는 onCancel.
 *
 * 🔴 **저장된 글자를 그대로 싣는다.** 교산 연락서를 넣은 기록은 칸에 일본어
 * 원문이 들어 있고, 목록에서는 `KyosanMemoText` 가 **보여 줄 때만** 한글을
 * 곁들인다. 이 창에는 그 곁들임이 섞이면 안 된다 — 사람이 그것을 지우거나
 * 고치면 곁들인 한글이 저장되어 버린다. 그래서 여기 들어오는 값은 조회가
 * 돌려준 `record.memo` 그대로이고, 나가는 값도 사람이 고친 글자 그대로다.
 *
 * 열릴 때마다 지금 값으로 다시 채운다 — 창 하나를 여러 기록이 돌려 쓰므로,
 * 앞서 연 기록의 글이 남아 있으면 엉뚱한 글을 저장하게 된다.
 */
export default function EditWorkRecordDialog({
  isOpen,
  isSubmitting,
  initialMemo,
  initialRecordKind,
  errorMessage,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  isSubmitting: boolean;
  /** 지금 저장되어 있는 글 — 보여 주기용으로 손댄 것이 아니라 원문 그대로. */
  initialMemo: string;
  initialRecordKind: WorkRecordKind;
  /** 서버가 돌려준 거절 사유. 창 안에 보인다 — 창이 떠 있는 동안 뒤 화면의 글은 읽을 수 없다. */
  errorMessage: string | null;
  onConfirm: (next: { memo: string; recordKind: WorkRecordKind }) => void;
  onCancel: () => void;
}) {
  const uiText = useUiText();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [memo, setMemo] = useState(initialMemo);
  const [recordKind, setRecordKind] = useState<WorkRecordKind>(initialRecordKind);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      setMemo(initialMemo);
      setRecordKind(initialRecordKind);
      setError(null);
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
    // initialMemo/initialRecordKind 는 "열릴 때" 한 번만 싣는다 — 사람이 치는
    // 동안 바깥 값이 바뀌어도 쓰던 글을 덮어쓰지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function handleConfirm() {
    const trimmed = memo.trim();
    if (!trimmed) {
      setError("작업 기록 내용을 입력해 주세요.");
      textareaRef.current?.focus();
      return;
    }
    setError(null);
    onConfirm({ memo: trimmed, recordKind });
  }

  const shownError = error ?? errorMessage;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="edit-work-record-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="w-full max-w-lg rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="edit-work-record-dialog-title" className="text-sm font-semibold">
        작업 기록 수정
      </h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        본인이 작성한 기록의 내용과 기록 구분을 수정합니다. 수정하기 전의 내용은 이력으로 남아 계속 조회할 수 있습니다.
      </p>

      <div className="mt-3 flex flex-col gap-1">
        <label htmlFor="edit-work-record-kind" className="text-xs text-zinc-500 dark:text-zinc-400">
          기록 구분
        </label>
        <select
          id="edit-work-record-kind"
          value={recordKind}
          onChange={(event) => setRecordKind(event.target.value as WorkRecordKind)}
          disabled={isSubmitting}
          className="w-full max-w-sm rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        >
          {WORK_RECORD_KIND_CODES.map((code) => (
            <option key={code} value={code}>
              {uiText.workRecordKind[code]}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 flex flex-col gap-1">
        <label htmlFor="edit-work-record-memo" className="text-xs text-zinc-500 dark:text-zinc-400">
          작업 기록 내용 *
        </label>
        <textarea
          id="edit-work-record-memo"
          ref={textareaRef}
          rows={8}
          value={memo}
          onChange={(event) => setMemo(event.target.value)}
          disabled={isSubmitting}
          aria-invalid={Boolean(shownError)}
          aria-describedby={shownError ? "edit-work-record-error" : undefined}
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        {shownError && (
          <p id="edit-work-record-error" className="text-xs text-red-600 dark:text-red-400">
            {shownError}
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
          {isSubmitting ? "저장하는 중..." : "저장"}
        </button>
      </div>
    </dialog>
  );
}
