"use client";

import { useEffect, useRef } from "react";

const MAX_LISTED_INTAKE_NUMBERS = 15;

/**
 * Confirm dialog for /repair-cases 휴지통's 복원 (single or bulk) — same
 * native <dialog>/showModal() pattern as RepairCaseBulkDeleteDialog.tsx.
 * No reason field (only 삭제 has a 삭제 사유; restore has no equivalent
 * requirement in the approved checkpoint spec). Reused unchanged for both a
 * single-row 복원 click and a multi-select 선택 복원 — the caller always
 * passes a 1+ length intakeNumbers array either way.
 */
export default function RepairCaseRestoreDialog({
  isOpen,
  intakeNumbers,
  isSubmitting,
  submitError,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  intakeNumbers: string[];
  isSubmitting: boolean;
  submitError: string | null;
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
      aria-labelledby="restore-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="restore-dialog-title" className="text-sm font-semibold">
        선택한 {intakeNumbers.length}건의 A/S 접수 건을 복원하시겠습니까?
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        복원된 접수 건은 전체 A/S 현황 등 활성 목록에 다시 표시됩니다. 작업
        이력·승인·부품 요청 등 연결된 기록은 삭제 상태에서도 그대로
        보존되어 있었으며 이번 복원으로도 변경되지 않습니다.
      </p>

      <ul className="mt-3 max-h-32 overflow-y-auto rounded-md border border-zinc-100 bg-zinc-50 p-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        {shown.map((intakeNumber) => (
          <li key={intakeNumber}>{intakeNumber}</li>
        ))}
        {remaining > 0 && <li>외 {remaining}건</li>}
      </ul>

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
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? "복원 중..." : "복원"}
        </button>
      </div>
    </dialog>
  );
}
