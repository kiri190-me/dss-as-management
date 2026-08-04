"use client";

import { useEffect, useRef } from "react";

type SimulationNoticeDialogMode = "preview" | "download";

type SimulationNoticeDialogProps = {
  isOpen: boolean;
  mode: SimulationNoticeDialogMode;
  displayName: string;
  isSubmitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const COPY: Record<SimulationNoticeDialogMode, { title: string; body: string; confirmLabel: string }> = {
  preview: {
    title: "미리보기 시뮬레이션",
    body: "실제 미리보기 생성 작업은 실행되지 않습니다. 이 데모에서는 미리보기 요청 이력만 기록됩니다.",
    confirmLabel: "미리보기 시뮬레이션 실행",
  },
  download: {
    title: "다운로드 시뮬레이션",
    body: "실제 파일 다운로드는 발생하지 않습니다. 이 데모에서는 다운로드 요청 이력만 기록됩니다.",
    confirmLabel: "다운로드 시뮬레이션 실행",
  },
};

export default function SimulationNoticeDialog({
  isOpen,
  mode,
  displayName,
  isSubmitting,
  onConfirm,
  onCancel,
}: SimulationNoticeDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const copy = COPY[mode];
  // preview/download 두 모드가 항상 동시에 마운트되어 있으므로 title id도
  // mode로 네임스페이스를 나눈다(EditMetadataDialog와 동일한 이유).
  const titleId = `simulation-notice-dialog-title-${mode}`;

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
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        대상: <span className="font-medium text-zinc-900 dark:text-zinc-50">{displayName}</span>
      </p>
      <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
        {copy.body}
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
          {isSubmitting ? "처리 중..." : copy.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
