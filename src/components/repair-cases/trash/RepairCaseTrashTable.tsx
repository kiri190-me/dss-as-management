import type { TrashedRepairCase } from "@/lib/db/mappers/repair-case";
import { StatusBadge } from "../badges";
import RepairCaseTrashRetentionBadge from "./RepairCaseTrashRetentionBadge";
import SelectAllCheckbox from "@/components/common/select-all-checkbox";

const thBaseClass =
  "border-b border-zinc-200 bg-white px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400";

/**
 * Desktop 휴지통 table — 인수번호/삭제일/삭제한 사용자/삭제 사유/고객사/
 * Model/S/N/현재 상태/만료 상태 + a per-row 복원 button, mirroring
 * RepairCaseTable's own `hidden lg:block` breakpoint and checkbox-column
 * shape (selectionMode/selectedIds/selectableIds/onToggleSelect — every
 * DATABASE row here is always selectable, since a local/draft row can never
 * be soft-deleted in the first place; the prop is still threaded through
 * for shape-consistency with the active table, not because any row is ever
 * actually excluded).
 */
export default function RepairCaseTrashTable({
  rows,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onRestoreOne,
  canPermanentlyDelete,
  onPermanentlyDeleteOne,
}: {
  rows: TrashedRepairCase[];
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (id: string) => void;
  /** 체크박스 열 머리글의 전체 선택. 휴지통에는 고를 수 없는 행이 없으므로 대상은 늘 rows 전부다. */
  onToggleSelectAll: (nextChecked: boolean) => void;
  onRestoreOne: (id: string) => void;
  /** Repair Case Permanent Delete checkpoint — SUPER_ADMIN/ADMIN only (canPermanentlyDeleteRepairCases), same role set as the trash tab itself today but checked as its own explicit prop. */
  canPermanentlyDelete: boolean;
  onPermanentlyDeleteOne: (id: string) => void;
}) {
  return (
      <table className="w-full min-w-[1100px] border-collapse text-sm">
        <thead className="sticky top-0 z-10">
          <tr>
            <th scope="col" className={`${thBaseClass} w-10`}>
              <SelectAllCheckbox
                selectableCount={rows.length}
                selectedCount={rows.filter((row) => selectedIds.has(row.id)).length}
                onChange={onToggleSelectAll}
                ariaLabel="휴지통 전체 선택"
              />
            </th>
            <th scope="col" className={thBaseClass}>인수번호</th>
            <th scope="col" className={thBaseClass}>삭제일</th>
            <th scope="col" className={thBaseClass}>삭제한 사용자</th>
            <th scope="col" className={thBaseClass}>삭제 사유</th>
            <th scope="col" className={thBaseClass}>고객사</th>
            <th scope="col" className={thBaseClass}>Model / S/N</th>
            <th scope="col" className={thBaseClass}>현재 상태</th>
            <th scope="col" className={thBaseClass}>보관 기한</th>
            <th scope="col" className={thBaseClass}>복원</th>
            {canPermanentlyDelete && <th scope="col" className={thBaseClass}>완전 삭제</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-zinc-100 align-top last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
            >
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  aria-label={`${row.intakeNumber} 선택`}
                  checked={selectedIds.has(row.id)}
                  onChange={() => onToggleSelect(row.id)}
                  className="h-4 w-4"
                />
              </td>
              <td className="px-3 py-2 font-medium whitespace-nowrap">{row.intakeNumber}</td>
              <td className="px-3 py-2 whitespace-nowrap">{row.deletedAt.slice(0, 10)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{row.deletedByUserName ?? "-"}</td>
              <td className="max-w-[220px] px-3 py-2">{row.deleteReason ?? "-"}</td>
              <td className="px-3 py-2 whitespace-nowrap">{row.customerName}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {row.modelName} / {row.serialNumber}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <StatusBadge status={row.status} />
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <RepairCaseTrashRetentionBadge deletedAt={row.deletedAt} />
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => onRestoreOne(row.id)}
                  className="rounded-md border border-blue-300 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-900 dark:text-blue-400 dark:hover:bg-blue-950"
                >
                  복원
                </button>
              </td>
              {canPermanentlyDelete && (
                <td className="px-3 py-2 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => onPermanentlyDeleteOne(row.id)}
                    className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                  >
                    완전 삭제
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
  );
}
