import Link from "next/link";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import { OverdueBadge, PriorityBadge, SourceBadge, StatusBadge } from "./badges";

type RepairCaseCardListProps = {
  rows: ResolvedRepairCase[];
};

export default function RepairCaseCardList({ rows }: RepairCaseCardListProps) {
  return (
    <div className="flex flex-col gap-3 md:hidden">
      {rows.map((row) => (
        <Link
          key={row.id}
          href={`/repair-cases/${row.id}`}
          className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/60"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-zinc-900 dark:text-zinc-50">
              {row.intakeNumber}
            </span>
            <StatusBadge status={row.status} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PriorityBadge priority={row.priority} />
            <OverdueBadge isOverdue={row.isOverdue} />
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
