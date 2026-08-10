import Link from "next/link";
import type { MyActiveWorkRow } from "@/lib/db/queries/repair-cases-mine";
import { StatusBadge } from "@/components/repair-cases/badges";
import { ExceptionStatusBadge } from "./ExceptionStatusBadge";
import { formatLastActivity, formatPartsRequestStatus } from "./format";
import { daysSinceIntake } from "@/lib/domain/date-only";

const thBaseClass =
  "border-b border-zinc-200 bg-white px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400";
const tdBaseClass = "px-3 py-2 whitespace-nowrap";

/**
 * Phase 5C-3 desktop table. Deliberately its own component, not a reuse of
 * RepairCaseTable — that component is typed to EffectiveRepairCase (the
 * client-only workflow-override demo layer this real engineer-facing
 * screen must never import, see the Phase 5C-3 audit §16) and lacks every
 * column this screen needs (예외 상태/마지막 작업/부품 요청 상태/입고 후
 * 경과일). Reuses only the generic, primitive-typed pieces underneath:
 * StatusBadge, the sticky-header/overflow-x-auto/zebra-row table styling
 * convention, and the same responsive split (this table hidden on mobile,
 * MyActiveWorkCardList shown instead).
 */
export default function MyActiveWorkTable({ rows }: { rows: MyActiveWorkRow[] }) {
  return (
    <div className="hidden overflow-x-auto rounded-lg border border-zinc-200 md:block dark:border-zinc-800">
      <table className="w-full min-w-[1900px] border-collapse text-sm">
        <thead className="sticky top-0 z-10">
          <tr>
            <th scope="col" className={`${thBaseClass} sticky top-0 left-0 z-20`}>인수번호</th>
            <th scope="col" className={thBaseClass}>인수일</th>
            <th scope="col" className={thBaseClass}>고객사</th>
            <th scope="col" className={thBaseClass}>End-User</th>
            <th scope="col" className={thBaseClass}>제품 구분</th>
            <th scope="col" className={thBaseClass}>Model</th>
            <th scope="col" className={thBaseClass}>S/N</th>
            <th scope="col" className={thBaseClass}>L/N</th>
            <th scope="col" className={thBaseClass}>현재 상태</th>
            <th scope="col" className={thBaseClass}>현재 단계</th>
            <th scope="col" className={thBaseClass}>예외 상태</th>
            <th scope="col" className={thBaseClass}>사내 목표 검수완료일</th>
            <th scope="col" className={thBaseClass}>사내 목표 출하일</th>
            <th scope="col" className={thBaseClass}>고객 요청 납기일</th>
            <th scope="col" className={thBaseClass}>입고 후 경과일</th>
            <th scope="col" className={thBaseClass}>마지막 작업</th>
            <th scope="col" className={thBaseClass}>부품 요청 상태</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
            >
              <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium whitespace-nowrap dark:bg-zinc-900">
                <Link
                  href={`/repair-cases/${row.id}`}
                  className="text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-50"
                >
                  {row.intakeNumber}
                </Link>
              </td>
              <td className={tdBaseClass}>{row.receivedAt}</td>
              <td className={tdBaseClass}>{row.customerName}</td>
              <td className={tdBaseClass}>{row.endUserName ?? "-"}</td>
              <td className={tdBaseClass}>{row.productCategory}</td>
              <td className={tdBaseClass}>{row.modelName}</td>
              <td className={tdBaseClass}>{row.serialNumber}</td>
              <td className={tdBaseClass}>{row.lotNumber}</td>
              <td className={tdBaseClass}><StatusBadge status={row.status} /></td>
              <td className={tdBaseClass}>{row.currentWorkflowStepLabel}</td>
              <td className={tdBaseClass}><ExceptionStatusBadge exceptionStatus={row.exceptionStatus} /></td>
              <td className={tdBaseClass}>{row.internalTargetInspectionCompletionDate ?? "-"}</td>
              <td className={tdBaseClass}>{row.internalTargetShipmentDate ?? "-"}</td>
              <td className={tdBaseClass}>{row.customerRequestedDueDate ?? "-"}</td>
              <td className={tdBaseClass}>{daysSinceIntake(row.receivedAt)}일</td>
              <td className={tdBaseClass}>{formatLastActivity(row)}</td>
              <td className={tdBaseClass}>{formatPartsRequestStatus(row.activePartsRequestStatus)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
