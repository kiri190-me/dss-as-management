"use client";

import { useEffect, useRef } from "react";

const MAX_LISTED_INTAKE_NUMBERS = 15;

/**
 * Confirm dialog for /repair-cases 휴지통's 완전 삭제 (single or bulk) —
 * same native <dialog>/showModal() pattern as RepairCaseRestoreDialog.tsx/
 * RepairCaseBulkDeleteDialog.tsx, danger-styled (red, matching
 * RepairCaseBulkDeleteDialog's own soft-delete confirm) since this action
 * is irreversible. Deliberately NO title-typing confirmation (e.g. "type
 * DELETE to confirm") — the approved checkpoint spec explicitly rules that
 * out; the mandatory 삭제 사유 plus the intake-number list is the
 * confirmation surface instead. Reused unchanged for both a single-row
 * 완전 삭제 click and a multi-select 선택 완전 삭제 — the caller always
 * passes a 1+ length intakeNumbers array either way.
 */
export default function RepairCasePermanentDeleteDialog({
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
  const trimmedReason = reason.trim();
  const canSubmit = trimmedReason.length > 0 && !isSubmitting;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="permanent-delete-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-red-300 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-red-900 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="permanent-delete-dialog-title" className="text-sm font-semibold text-red-700 dark:text-red-400">
        선택한 {intakeNumbers.length}건의 A/S 접수 건을 영구 삭제하시겠습니까?
      </h2>
      <p className="mt-2 text-sm font-medium text-red-700 dark:text-red-400">
        이 작업은 되돌릴 수 없습니다. 삭제 후에는 복원할 수 없습니다.
      </p>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        접수 건 자체는 데이터베이스에서 완전히 제거됩니다. 다만 작업
        이력·승인·재고 사용 기록·부품 요청 등 연결된 기록은 접수 건과의
        연결만 해제된 채 그대로 보존되며, 첨부된 Flowchart는 함께 영구
        삭제됩니다.
      </p>

      <ul className="mt-3 max-h-32 overflow-y-auto rounded-md border border-zinc-100 bg-zinc-50 p-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        {shown.map((intakeNumber) => (
          <li key={intakeNumber}>{intakeNumber}</li>
        ))}
        {remaining > 0 && <li>외 {remaining}건</li>}
      </ul>

      <div className="mt-3">
        <label htmlFor="permanent-delete-reason" className="text-xs text-zinc-500 dark:text-zinc-400">
          영구 삭제 사유 (필수)
        </label>
        <textarea
          id="permanent-delete-reason"
          rows={2}
          required
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
          disabled={!canSubmit}
          aria-busy={isSubmitting}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? "영구 삭제 중..." : "영구 삭제"}
        </button>
      </div>
    </dialog>
  );
}
