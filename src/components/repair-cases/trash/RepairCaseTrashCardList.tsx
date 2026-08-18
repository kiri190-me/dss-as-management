import type { TrashedRepairCase } from "@/lib/db/mappers/repair-case";
import { StatusBadge } from "../badges";
import RepairCaseTrashRetentionBadge from "./RepairCaseTrashRetentionBadge";

/**
 * Mobile/narrow 휴지통 card list — same `lg:hidden` breakpoint as
 * RepairCaseCardList. No detail-page Link (see RepairCaseTrashScreen's own
 * doc comment: a soft-deleted case's normal detail route is unreachable,
 * so this card is a dead-end display + 복원 action only, not a navigation
 * target).
 */
export default function RepairCaseTrashCardList({
  rows,
  selectedIds,
  onToggleSelect,
  onRestoreOne,
  canPermanentlyDelete,
  onPermanentlyDeleteOne,
}: {
  rows: TrashedRepairCase[];
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (id: string) => void;
  onRestoreOne: (id: string) => void;
  /** Repair Case Permanent Delete checkpoint — SUPER_ADMIN/ADMIN only (canPermanentlyDeleteRepairCases), same role set as the trash tab itself today but checked as its own explicit prop. */
  canPermanentlyDelete: boolean;
  onPermanentlyDeleteOne: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 lg:hidden">
      {rows.map((row) => (
        <div
          key={row.id}
          className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                aria-label={`${row.intakeNumber} 선택`}
                checked={selectedIds.has(row.id)}
                onChange={() => onToggleSelect(row.id)}
                className="h-4 w-4"
              />
              <span className="font-semibold text-zinc-900 dark:text-zinc-50">{row.intakeNumber}</span>
            </div>
            <StatusBadge status={row.status} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RepairCaseTrashRetentionBadge deletedAt={row.deletedAt} />
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">고객사</dt>
              <dd>{row.customerName}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">Model / S/N</dt>
              <dd>
                {row.modelName} / {row.serialNumber}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">삭제일</dt>
              <dd>{row.deletedAt.slice(0, 10)}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">삭제한 사용자</dt>
              <dd>{row.deletedByUserName ?? "-"}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">삭제 사유</dt>
              <dd>{row.deleteReason ?? "-"}</dd>
            </div>
          </dl>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onRestoreOne(row.id)}
              className="rounded-md border border-blue-300 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-900 dark:text-blue-400 dark:hover:bg-blue-950"
            >
              복원
            </button>
            {canPermanentlyDelete && (
              <button
                type="button"
                onClick={() => onPermanentlyDeleteOne(row.id)}
                className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
              >
                완전 삭제
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
