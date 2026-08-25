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
 * 표가 폭에 안 들어갈 때(그리고 사람이 카드를 골랐을 때) 대신 나오는 목록.
 * 언제 나올지는 이 파일이 정하지 않는다 — 서비스의 모든 목록과 같이
 * ResponsiveList(components/common/responsive-list.tsx)가 정한다.
 *
 * 유·무상은 표에서 독립 열이 되면서 여기에도 들어왔다(2026-08-19). 표가 안
 * 들어가는 폭에서는 이쪽이 기본 화면이라, 표에만 넣으면 창 크기에 따라 보이는
 * 사람과 안 보이는 사람이 갈린다.
 *
 * 날짜도 같은 이유로 표에 맞췄다(2026-08-25). 표는 이미 실제 출하일
 * (effectiveActualShipmentDate)과 고객 요청 납기일을 보여 주는데 카드만 사내
 * 목표 출하일이라, 같은 접수 건이 창 크기에 따라 다른 날짜를 보여 주고 있었다.
 * 표와 똑같이 실제 출하일이 비어 있어도 사내 목표 출하일로 대신 채우지 않는다
 * — 아직 출하되지 않은 건이 출하된 것처럼 보이면 안 된다.
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
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">유·무상</dt>
              <dd>{row.paidOrWarranty}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">고객 요청 납기일</dt>
              <dd>{row.customerRequestedDueDate ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">실제 출하일</dt>
              <dd>{row.effectiveActualShipmentDate ?? "-"}</dd>
            </div>
          </dl>
        </Link>
      ))}
    </div>
  );
}
