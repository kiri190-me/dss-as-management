import Link from "next/link";
import type { MyActiveWorkRow } from "@/lib/db/queries/repair-cases-mine";
import { StatusBadge } from "@/components/repair-cases/badges";
import { ExceptionStatusBadge } from "./ExceptionStatusBadge";
import { formatLastActivity, formatPartsRequestStatus } from "./format";
import { daysSinceIntake } from "@/lib/domain/date-only";

/** Phase 5C-3 mobile card list — same responsive split and Link-wrapped-card/dl-dt-dd pattern as RepairCaseCardList, carrying this screen's own column set. */
export default function MyActiveWorkCardList({ rows }: { rows: MyActiveWorkRow[] }) {
  return (
    <div className="flex flex-col gap-3 md:hidden">
      {rows.map((row) => (
        <Link
          key={row.id}
          href={`/repair-cases/${row.id}`}
          className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/60"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-zinc-900 dark:text-zinc-50">{row.intakeNumber}</span>
            <StatusBadge status={row.status} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{row.currentWorkflowStepLabel}</span>
            <ExceptionStatusBadge exceptionStatus={row.exceptionStatus} />
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">고객사</dt>
              <dd>{row.customerName}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">End-User</dt>
              <dd>{row.endUserName ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">Model / S/N</dt>
              <dd>{row.modelName} / {row.serialNumber}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">L/N</dt>
              <dd>{row.lotNumber}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">사내 목표 검수완료일</dt>
              <dd>{row.internalTargetInspectionCompletionDate ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">사내 목표 출하일</dt>
              <dd>{row.internalTargetShipmentDate ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">고객 요청 납기일</dt>
              <dd>{row.customerRequestedDueDate ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">입고 후 경과일</dt>
              <dd>{daysSinceIntake(row.receivedAt)}일</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">마지막 작업</dt>
              <dd>{formatLastActivity(row)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">부품 요청 상태</dt>
              <dd>{formatPartsRequestStatus(row.activePartsRequestStatus)}</dd>
            </div>
          </dl>
        </Link>
      ))}
    </div>
  );
}
