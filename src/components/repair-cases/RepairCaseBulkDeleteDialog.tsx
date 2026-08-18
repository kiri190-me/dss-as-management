"use client";

import { useEffect, useRef } from "react";

const MAX_LISTED_INTAKE_NUMBERS = 15;

/**
 * Confirm dialog for /repair-cases 삭제 모드's "선택 삭제" — same native
 * <dialog>/showModal() pattern as ClearDraftDialog.tsx (repair-cases/new).
 * Explicitly states this is a soft delete (cases only disappear from the
 * active list; nothing is physically removed) per the approved UX spec.
 * A single, optional 삭제 사유 applies to the whole batch — not per case.
 */
export default function RepairCaseBulkDeleteDialog({
  isOpen,
  intakeNumbers,
  reason,
  isSubmitting,
  submitError,
  onReasonChange,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  intakeNumbers: string[];
  reason: string;
  isSubmitting: boolean;
  submitError: string | null;
  onReasonChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
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

  const shown = intakeNumbers.slice(0, MAX_LISTED_INTAKE_NUMBERS);
  const remaining = intakeNumbers.length - shown.length;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="bulk-delete-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="bulk-delete-dialog-title" className="text-sm font-semibold">
        선택한 {intakeNumbers.length}건의 A/S 접수 건을 삭제하시겠습니까?
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        삭제된 접수 건은 전체 A/S 현황 등 활성 목록에서 더 이상 표시되지
        않습니다. 다만 데이터베이스에서 완전히 제거되지는 않으며(소프트
        삭제), 작업 이력·승인·부품 요청 등 연결된 기록은 그대로 보존됩니다.
      </p>

      <ul className="mt-3 max-h-32 overflow-y-auto rounded-md border border-zinc-100 bg-zinc-50 p-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        {shown.map((intakeNumber) => (
          <li key={intakeNumber}>{intakeNumber}</li>
        ))}
        {remaining > 0 && <li>외 {remaining}건</li>}
      </ul>

      <div className="mt-3">
        <label htmlFor="bulk-delete-reason" className="text-xs text-zinc-500 dark:text-zinc-400">
          삭제 사유 (선택)
        </label>
        <textarea
          id="bulk-delete-reason"
          rows={2}
          disabled={isSubmitting}
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </div>

      {submitError && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {submitError}
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          취소
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? "삭제 중..." : "삭제"}
        </button>
      </div>
    </dialog>
  );
}
