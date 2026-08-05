export const editInputClass =
  "w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
export const editLabelClass = "text-xs text-zinc-500 dark:text-zinc-400";
export const editErrorClass = "mt-1 text-xs text-red-600 dark:text-red-400";

/**
 * Shared Save/Cancel row + error/conflict display for all three section
 * edit forms. On CONFLICT (isConflict=true), the Save/Cancel pair is
 * replaced entirely by a single "최신 정보 다시 불러오기" action — the form
 * is frozen, matching the requirement that a stale form never allows a
 * further save attempt.
 */
export default function EditSectionActions({
  isSubmitting,
  isConflict,
  submitError,
  onCancel,
  onReloadAfterConflict,
}: {
  isSubmitting: boolean;
  isConflict: boolean;
  submitError: string | null;
  onCancel: () => void;
  onReloadAfterConflict: () => void;
}) {
  return (
    <div className="mt-3 flex flex-col gap-2">
      {submitError && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {submitError}
        </p>
      )}
      {isConflict ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onReloadAfterConflict}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            최신 정보 다시 불러오기
          </button>
        </div>
      ) : (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {isSubmitting ? "저장 중..." : "저장"}
          </button>
        </div>
      )}
    </div>
  );
}
