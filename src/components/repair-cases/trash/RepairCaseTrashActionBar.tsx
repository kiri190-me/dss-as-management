/**
 * Selection bar for /repair-cases 휴지통 tab — unlike RepairCaseBulkDeleteBar
 * (which toggles a "삭제 모드" on/off over the always-visible active list),
 * the trash tab has no separate mode to enter: checkboxes are always
 * present here, so this bar only ever needs a selected-count readout plus
 * 선택 해제(clear)/선택 복원(bulk restore)/선택 완전 삭제(bulk permanent
 * delete) — never an enter/cancel-mode pair. 선택 완전 삭제 only renders
 * when canPermanentlyDelete is true (Repair Case Permanent Delete
 * checkpoint — SUPER_ADMIN/ADMIN only).
 */
export default function RepairCaseTrashActionBar({
  selectedCount,
  onClearSelection,
  onRequestRestore,
  canPermanentlyDelete,
  onRequestPermanentDelete,
}: {
  selectedCount: number;
  onClearSelection: () => void;
  onRequestRestore: () => void;
  canPermanentlyDelete: boolean;
  onRequestPermanentDelete: () => void;
}) {
  if (selectedCount === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-900 dark:bg-blue-950">
      <span className="text-sm font-medium text-blue-800 dark:text-blue-300">{selectedCount}건 선택됨</span>
      <div className="ml-auto flex gap-2">
        <button
          type="button"
          onClick={onClearSelection}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          선택 해제
        </button>
        <button
          type="button"
          onClick={onRequestRestore}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          선택 복원
        </button>
        {canPermanentlyDelete && (
          <button
            type="button"
            onClick={onRequestPermanentDelete}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
          >
            선택 완전 삭제
          </button>
        )}
      </div>
    </div>
  );
}
