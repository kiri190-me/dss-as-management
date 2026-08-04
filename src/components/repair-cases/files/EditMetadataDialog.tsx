"use client";

import { useEffect, useRef, useState } from "react";
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  isSafeFileNameString,
} from "@/lib/domain/local/attachments/filename";

type EditMetadataDialogMode = "rename" | "description";

type EditMetadataDialogProps = {
  isOpen: boolean;
  mode: EditMetadataDialogMode;
  isSubmitting: boolean;
  initialValue: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
};

const COPY: Record<EditMetadataDialogMode, { title: string; label: string; multiline: boolean }> = {
  rename: { title: "표시 이름 변경", label: "새 표시 이름", multiline: false },
  description: { title: "설명 수정", label: "설명", multiline: true },
};

export default function EditMetadataDialog({
  isOpen,
  mode,
  isSubmitting,
  initialValue,
  onSubmit,
  onCancel,
}: EditMetadataDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[mode];

  // rename/description 두 모드가 항상 동시에 마운트되어 있으므로(내부 <dialog>의
  // open 여부만 토글) id는 mode로 네임스페이스를 나눠야 한다 — 그렇지 않으면
  // 두 인스턴스가 같은 id를 공유해 label/aria-describedby 연결이 깨진다.
  const titleId = `edit-metadata-dialog-title-${mode}`;
  const fieldId = `edit-metadata-value-${mode}`;
  const errorId = `edit-metadata-value-error-${mode}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      setValue(initialValue);
      setError(null);
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function handleConfirm() {
    const trimmed = value.trim();
    if (mode === "rename") {
      if (!isSafeFileNameString(trimmed, MAX_DISPLAY_NAME_LENGTH)) {
        setError("표시 이름을 올바르게 입력해 주세요.");
        fieldRef.current?.focus();
        return;
      }
    } else if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
      setError(`설명은 ${MAX_DESCRIPTION_LENGTH}자 이하로 입력해 주세요.`);
      fieldRef.current?.focus();
      return;
    }
    onSubmit(trimmed);
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
        {copy.title}
      </h2>

      <div className="mt-3 flex flex-col gap-1">
        <label htmlFor={fieldId} className="text-xs text-zinc-500 dark:text-zinc-400">
          {copy.label}
        </label>
        {copy.multiline ? (
          <textarea
            id={fieldId}
            ref={fieldRef}
            rows={3}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        ) : (
          <input
            id={fieldId}
            ref={fieldRef}
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        )}
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
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {isSubmitting ? "저장 중..." : "저장"}
        </button>
      </div>
    </dialog>
  );
}
