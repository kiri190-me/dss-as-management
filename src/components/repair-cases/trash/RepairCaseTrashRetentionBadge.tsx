import { getRepairCaseTrashRetentionStatus } from "@/lib/domain/repair-case-trash-retention";

/**
 * "만료까지 N일" / "만료됨" — display-only retention status (see
 * repair-case-trash-retention.ts's own doc comment: no purge exists yet,
 * this never disables restore). Shared between RepairCaseTrashTable and
 * RepairCaseTrashCardList so the two layouts can never show different
 * wording for the same row.
 */
export default function RepairCaseTrashRetentionBadge({ deletedAt }: { deletedAt: string }) {
  const status = getRepairCaseTrashRetentionStatus(deletedAt);
  if (status.isExpired) {
    return (
      <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-red-700 dark:bg-red-950 dark:text-red-400">
        만료됨
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
      만료까지 {status.daysRemaining}일
    </span>
  );
}
