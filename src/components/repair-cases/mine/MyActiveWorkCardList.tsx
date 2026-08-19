import Link from "next/link";
import { LIST_CARD_GRID } from "@/components/common/responsive-list";
import type { MyActiveWorkRow } from "@/lib/db/queries/repair-cases-mine";
import { billingTypeLabels } from "@/lib/domain/types";
import { StatusBadge } from "@/components/repair-cases/badges";
import { ExceptionStatusBadge } from "./ExceptionStatusBadge";
import { formatLastActivity, formatPartsRequestStatus } from "./format";
import { daysSinceIntake } from "@/lib/domain/date-only";

/**
 * 좁은 화면용 카드 목록 — RepairCaseCardList와 같은 반응형 분기,
 * Link로 감싼 카드, dl/dt/dd 구성을 쓰고 이 화면 고유의 항목을 담는다.
 *
 * 2026-08-19: 표와 함께 전체 A/S 현황 쪽에 맞췄다. 끊는 지점을 md에서 lg로
 * 옮긴 것은(표는 lg:block, 카드는 lg:hidden) 그쪽과 같은 값이다 — 접은 표라도
 * 태블릿 폭에서는 답답해서, 그쪽도 카드로 넘긴다. 제품 줄에 유·무상을 붙인
 * 것도 같은 이유다.
 */
export default function MyActiveWorkCardList({ rows }: { rows: MyActiveWorkRow[] }) {
  return (
    <div className={LIST_CARD_GRID}>
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
            <div className="col-span-2">
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">제품</dt>
              <dd>
                {row.productCategory} / {row.modelName} /{" "}
                {row.billingType ? billingTypeLabels[row.billingType] : "-"}
              </dd>
              <dd className="text-xs text-zinc-500 dark:text-zinc-400">
                S/N {row.serialNumber} / L/N {row.lotNumber}
              </dd>
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
