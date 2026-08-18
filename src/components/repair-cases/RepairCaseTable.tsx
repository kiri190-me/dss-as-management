"use client";

import Link from "next/link";
import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import type { SortColumn, SortState } from "@/lib/domain/repair-case-filters";
import { HoldBadge, OverdueBadge, PriorityBadge, SourceBadge, StatusBadge, WorkflowOverrideBadge } from "./badges";

type RepairCaseTableProps = {
  rows: EffectiveRepairCase[];
  sort: SortState;
  onSortChange: (column: SortColumn) => void;
  /**
   * Bulk soft-delete selection (/repair-cases 삭제 모드) — every field below
   * is optional and undefined by default, so every other caller of this
   * shared component (CustomerRepairCaseHistory, ProductModelRepairCaseHistory,
   * MyActiveWorkScreen, etc.) renders byte-for-byte identically to before;
   * only RepairCaseListPage ever passes these. `selectionMode` alone gates
   * whether the checkbox column renders at all. `selectableIds` restricts
   * which rows may actually be checked (DATABASE-sourced rows only — a
   * local/draft row has no server-side repair_cases row to delete).
   */
  selectionMode?: boolean;
  selectedIds?: ReadonlySet<string>;
  selectableIds?: ReadonlySet<string>;
  onToggleSelect?: (id: string) => void;
};

const thBaseClass =
  "border-b border-zinc-200 bg-white px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400";

function sortIndicator(sort: SortState, column: SortColumn): string {
  if (sort.column !== column) return "";
  return sort.direction === "asc" ? "▲" : "▼";
}

/** Primary sort control in a merged header cell — same visual weight as thBaseClass's own buttons. */
function PrimarySortButton({
  column,
  label,
  sort,
  onSortChange,
}: {
  column: SortColumn;
  label: string;
  sort: SortState;
  onSortChange: (column: SortColumn) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSortChange(column)}
      className="flex items-center gap-1 whitespace-nowrap hover:text-zinc-900 dark:hover:text-zinc-50"
    >
      {label}
      <span className="text-[10px]">{sortIndicator(sort, column)}</span>
    </button>
  );
}

/** Secondary sort control stacked under a PrimarySortButton in the same merged header cell — lighter weight so the header's visual hierarchy matches the body's primary/secondary line pairing. */
function SecondarySortButton({
  column,
  label,
  sort,
  onSortChange,
}: {
  column: SortColumn;
  label: string;
  sort: SortState;
  onSortChange: (column: SortColumn) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSortChange(column)}
      className="flex items-center gap-1 whitespace-nowrap text-[11px] font-normal text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200"
    >
      {label}
      <span className="text-[9px]">{sortIndicator(sort, column)}</span>
    </button>
  );
}

/**
 * Table-local badge for the non-overdue ("정상") state — deliberately NOT
 * the shared badges.tsx OverdueBadge for this case, so this column's
 * badge-consistency treatment (blue pill instead of unstyled text) doesn't
 * bleed into OverdueBadge's other callers (DetailHeader, ReportSections,
 * ReportHeaderSummary), which keep their existing plain-text "정상"
 * rendering unchanged. The overdue (true) case still reuses OverdueBadge
 * as-is — its red badge already has a background and needs no change.
 */
function StatusRowOverdueBadge({ isOverdue }: { isOverdue: boolean }) {
  if (!isOverdue) {
    return (
      <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-blue-700 dark:bg-blue-950 dark:text-blue-400">
        정상
      </span>
    );
  }
  return <OverdueBadge isOverdue={isOverdue} />;
}

/**
 * Compact 7-column table for 전체 A/S 현황: 인수번호, 상태, 고객사, 제품,
 * 담당 엔지니어, 출하일, 상세 — the 7 fields explicitly called out as the
 * screen's prominent scan fields. Every other field from the original
 * 16-column table (인수일, End-User, 제품 구분, 유상/무상, L/N, 우선순위, 납기
 * 지연 여부, 고객 요청 납기일) still renders, folded into a secondary line or
 * badge inside one of these 7 cells rather than getting its own column —
 * see the doc comments on each <td> below. All 6 SortColumn values
 * (intakeNumber, receivedAt, customerName, status, priority,
 * customerRequestedDueDate) remain independently clickable, via a
 * secondary sort button stacked under the relevant primary header where the
 * field itself no longer has its own column.
 *
 * 상태 cell is two lines: 상태 배지 alone on line 1, 우선순위/납기/보류/재정의
 * 배지 cluster on line 2 — StatusRowOverdueBadge keeps the non-overdue
 * "정상" state a filled blue pill instead of unstyled text, so it reads
 * consistently with its badge neighbors on the same line.
 *
 * 제품 cell: line 1 (stronger) is 제품 구분(제품명 역할)/모델/유·무상, line 2
 * (secondary, smaller/gray) is S/N·L/N.
 *
 * 출하일 cell shows effectiveActualShipmentDate (실제 출하일), never
 * internalTargetShipmentDate — renders "-" when not yet shipped rather than
 * silently substituting the target date. 고객 요청 납기일 stays as secondary
 * context (still sortable via the header's secondary button).
 *
 * No wrapping div here — the responsive table/card switch for this screen
 * is an intentional `lg:` breakpoint (see RepairCaseListPage), not
 * overflow-measured, so the table itself just needs `hidden lg:block` on
 * its own wrapper, which lives here (self-contained), unlike the
 * diagnosis-flowcharts screen's JS-overflow-driven wrapper (which
 * deliberately lives in that screen's parent instead).
 */
export default function RepairCaseTable({
  rows,
  sort,
  onSortChange,
  selectionMode,
  selectedIds,
  selectableIds,
  onToggleSelect,
}: RepairCaseTableProps) {
  return (
    <div className="hidden overflow-x-hidden rounded-lg border border-zinc-200 lg:block dark:border-zinc-800">
      <table className="w-full min-w-[960px] border-collapse text-sm">
        <thead className="sticky top-0 z-10">
          <tr>
            {selectionMode && (
              <th scope="col" className={`${thBaseClass} w-10`}>
                <span className="sr-only">선택</span>
              </th>
            )}
            <th scope="col" className={thBaseClass}>
              {/* 인수번호 (primary) + 인수일 (secondary, still sortable) */}
              <div className="flex flex-col gap-0.5">
                <PrimarySortButton column="intakeNumber" label="인수번호" sort={sort} onSortChange={onSortChange} />
                <SecondarySortButton column="receivedAt" label="인수일" sort={sort} onSortChange={onSortChange} />
              </div>
            </th>
            <th scope="col" className={thBaseClass}>
              {/* 상태 (primary, badge on line 1 in the body) + 우선순위 (secondary, still sortable); 납기 지연/보류/재정의 배지는 정렬 대상이 아니므로 헤더 없이 본문 배지로만 표시 */}
              <div className="flex flex-col gap-0.5">
                <PrimarySortButton column="status" label="상태" sort={sort} onSortChange={onSortChange} />
                <SecondarySortButton column="priority" label="우선순위" sort={sort} onSortChange={onSortChange} />
              </div>
            </th>
            <th scope="col" className={thBaseClass}>
              {/* 고객사 (primary, sortable) + End-User (secondary, not sortable) */}
              <PrimarySortButton column="customerName" label="고객사" sort={sort} onSortChange={onSortChange} />
            </th>
            <th scope="col" className={thBaseClass}>
              {/* 제품명(=제품 구분)/모델/유·무상 (primary) + S/N·L/N (secondary) — none of these were sortable before */}
              제품
            </th>
            <th scope="col" className={thBaseClass}>담당 엔지니어</th>
            <th scope="col" className={thBaseClass}>
              {/* 실제 출하일(effectiveActualShipmentDate, primary — never substitutes 사내 목표 출하일 when null) + 고객 요청 납기일 (secondary, still sortable) */}
              <div className="flex flex-col gap-0.5">
                <span className="whitespace-nowrap">출하일</span>
                <SecondarySortButton column="customerRequestedDueDate" label="고객 요청 납기일" sort={sort} onSortChange={onSortChange} />
              </div>
            </th>
            <th scope="col" className={thBaseClass}>상세</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-zinc-100 last:border-0 align-top hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
            >
              {selectionMode && (
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={`${row.intakeNumber} 선택`}
                    checked={selectedIds?.has(row.id) ?? false}
                    disabled={!(selectableIds?.has(row.id) ?? false)}
                    onChange={() => onToggleSelect?.(row.id)}
                    className="h-4 w-4 disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </td>
              )}
              <td className="px-3 py-2">
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1">
                    <Link
                      href={`/repair-cases/${row.id}`}
                      className="font-medium whitespace-nowrap text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-50"
                    >
                      {row.intakeNumber}
                    </Link>
                    <SourceBadge source={row.source} />
                  </div>
                  <span className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">{row.receivedAt}</span>
                  <span className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">보고서번호 {row.legacyReportNumber ?? "—"}</span>
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <StatusBadge status={row.effectiveStatus} />
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <PriorityBadge priority={row.priority} />
                    <StatusRowOverdueBadge isOverdue={row.effectiveIsOverdue} />
                    <HoldBadge isOnHold={row.holdState?.isOnHold ?? false} />
                    <WorkflowOverrideBadge hasOverride={row.hasWorkflowOverride} />
                  </div>
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-col gap-0.5">
                  <span className="whitespace-nowrap">{row.customerName}</span>
                  <span className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">{row.endUserName ?? "-"}</span>
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-col gap-0.5">
                  <span className="whitespace-nowrap">
                    {row.productCategory} / {row.modelName} / {row.paidOrWarranty}
                  </span>
                  <span className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                    S/N {row.serialNumber} / L/N {row.lotNumber}
                  </span>
                </div>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{row.engineerName ?? "미배정"}</td>
              <td className="px-3 py-2">
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium whitespace-nowrap">{row.effectiveActualShipmentDate ?? "-"}</span>
                  <span className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                    고객요청 {row.customerRequestedDueDate ?? "-"}
                  </span>
                </div>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Link
                  href={`/repair-cases/${row.id}`}
                  className="text-sm text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
                >
                  상세
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
