import Link from "next/link";
import { LIST_CARD_GRID } from "@/components/common/responsive-list";
import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import { HoldBadge, OverdueBadge, PriorityBadge, SourceBadge, StatusBadge, WorkflowOverrideBadge } from "./badges";

type RepairCaseCardListProps = {
  rows: EffectiveRepairCase[];
  /** Bulk soft-delete selection (/repair-cases 삭제 모드) — same optional,
   * default-off shape as RepairCaseTable's own selection props; every other
   * caller of this component is unaffected. See RepairCaseTable.tsx's doc
   * comment for the full rationale. */
  selectionMode?: boolean;
  selectedIds?: ReadonlySet<string>;
  selectableIds?: ReadonlySet<string>;
  onToggleSelect?: (id: string) => void;
};

/**
 * Shown below the `lg` breakpoint (medium/narrow width and mobile) — an
 * intentional layout threshold for this screen, not overflow-measured, so
 * the card list appears before the compact table would feel cramped
 * rather than only once it would literally scroll. Mirrors RepairCaseTable's
 * own `hidden lg:block` wrapper.
 */
export default function RepairCaseCardList({
  rows,
  selectionMode,
  selectedIds,
  selectableIds,
  onToggleSelect,
}: RepairCaseCardListProps) {
  return (
    <div className={LIST_CARD_GRID}>
      {rows.map((row) => (
        <Link
          key={row.id}
          href={`/repair-cases/${row.id}`}
          className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/60"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {selectionMode && (
                // stopPropagation keeps the checkbox's own toggle from
                // triggering the surrounding <Link>'s navigation — clicking
                // anywhere else on the card still navigates to the detail
                // page exactly as before (the detail link is never removed).
                <span onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`${row.intakeNumber} 선택`}
                    checked={selectedIds?.has(row.id) ?? false}
                    disabled={!(selectableIds?.has(row.id) ?? false)}
                    onChange={() => onToggleSelect?.(row.id)}
                    className="h-4 w-4 disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </span>
              )}
              <span className="font-semibold text-zinc-900 dark:text-zinc-50">
                {row.intakeNumber}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">보고서번호 {row.legacyReportNumber ?? "—"}</span>
            </div>
            <StatusBadge status={row.effectiveStatus} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PriorityBadge priority={row.priority} />
            <OverdueBadge isOverdue={row.effectiveIsOverdue} />
            <HoldBadge isOnHold={row.holdState?.isOnHold ?? false} />
            <WorkflowOverrideBadge hasOverride={row.hasWorkflowOverride} />
            <SourceBadge source={row.source} />
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">고객사</dt>
              <dd>{row.customerName}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">담당 엔지니어</dt>
              <dd>{row.engineerName ?? "미배정"}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">Model / S/N</dt>
              <dd>
                {row.modelName} / {row.serialNumber}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">사내 목표 출하일</dt>
              <dd>{row.internalTargetShipmentDate ?? "-"}</dd>
            </div>
          </dl>
        </Link>
      ))}
    </div>
  );
}
