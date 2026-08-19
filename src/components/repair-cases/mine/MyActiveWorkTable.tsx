"use client";

import Link from "next/link";
import type { MyActiveWorkRow } from "@/lib/db/queries/repair-cases-mine";
import type { MyWorkSortColumn, MyWorkSortState } from "@/lib/domain/my-active-work-sort";
import { billingTypeLabels } from "@/lib/domain/types";
import { StatusBadge } from "@/components/repair-cases/badges";
import { ExceptionStatusBadge } from "./ExceptionStatusBadge";
import { formatLastActivity, formatPartsRequestStatus } from "./format";
import { daysSinceIntake } from "@/lib/domain/date-only";

const thBaseClass =
  "border-b border-zinc-200 bg-white px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400";

function sortIndicator(sort: MyWorkSortState, column: MyWorkSortColumn): string {
  if (sort.column !== column) return "";
  return sort.direction === "asc" ? "▲" : "▼";
}

/** 전체 A/S 현황 표의 머리글 버튼과 같은 무게 — 두 화면이 나란히 보여야 한다. */
function PrimarySortButton({
  column,
  label,
  sort,
  onSortChange,
}: {
  column: MyWorkSortColumn;
  label: string;
  sort: MyWorkSortState;
  onSortChange: (column: MyWorkSortColumn) => void;
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

/** 한 칸 안에서 주 머리글 아래 놓이는 보조 정렬 버튼(같은 자리, 더 옅은 무게). */
function SecondarySortButton({
  column,
  label,
  sort,
  onSortChange,
}: {
  column: MyWorkSortColumn;
  label: string;
  sort: MyWorkSortState;
  onSortChange: (column: MyWorkSortColumn) => void;
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
 * ============================================================================
 * 내 담당 제품 표 — 전체 A/S 현황과 같은 짜임 (2026-08-19)
 * ============================================================================
 * 원래는 17개 열을 하나씩 늘어놓아 min-w가 1900px이었다. 담당자가 늘 가로로
 * 밀어야 했고, 무엇보다 옆 화면(전체 A/S 현황)과 생김새가 전혀 달랐다.
 *
 * 그쪽과 같은 방식으로 접었다 — 열을 없앤 것이 아니라 **한 칸 안의 둘째 줄로
 * 내렸다**. 사라진 값은 없다:
 *
 *   인수번호 ← 인수일, 입고 후 경과일
 *   상태     ← 예외 상태, 부품 요청 상태
 *   고객사   ← End-User
 *   제품     ← 제품 구분 / 모델 / 유·무상, 그리고 S/N · L/N
 *   현재 단계 ← 마지막 작업
 *   출하일   ← 사내 목표 출하일(주), 고객 요청 납기일 / 목표 검수완료일
 *
 * "제품" 칸의 두 줄 구성(첫 줄 제품구분/모델/유·무상, 둘째 줄 S/N·L/N)은
 * RepairCaseTable과 같다 — 사용자가 같은 자리에서 같은 것을 읽게 하는 것이
 * 이 변경의 목적이다.
 *
 * 여전히 RepairCaseTable을 그대로 쓰지는 않는다. 그 컴포넌트는
 * EffectiveRepairCase(클라이언트 전용 워크플로 재정의 데모 레이어)로 타입이
 * 잡혀 있어 실제 엔지니어용인 이 화면이 가져와서는 안 되고, 이 화면에만 있는
 * 값(예외 상태/현재 단계/마지막 작업/부품 요청 상태)을 담을 자리도 없다.
 * 공유하는 것은 그 아래의 원시적인 조각들뿐이다 — StatusBadge, 표 스타일
 * 관례, 그리고 표/카드 반응형 분기.
 * ============================================================================
 */
export default function MyActiveWorkTable({
  rows,
  sort,
  onSortChange,
}: {
  rows: MyActiveWorkRow[];
  sort: MyWorkSortState;
  onSortChange: (column: MyWorkSortColumn) => void;
}) {
  return (
      <table className="w-full min-w-[1040px] border-collapse text-sm">
        <thead className="sticky top-0 z-10">
          <tr>
            <th scope="col" className={thBaseClass}>
              {/* 인수번호(주) + 인수일(보조, 정렬 가능). 입고 후 경과일은 인수일에서 나오는 값이라 별도 정렬 대상이 아니다. */}
              <div className="flex flex-col gap-0.5">
                <PrimarySortButton column="intakeNumber" label="인수번호" sort={sort} onSortChange={onSortChange} />
                <SecondarySortButton column="receivedAt" label="인수일" sort={sort} onSortChange={onSortChange} />
              </div>
            </th>
            <th scope="col" className={thBaseClass}>
              {/* 상태(주, 본문 첫 줄 배지) + 예외/부품 요청 배지(둘째 줄) — 뒤 둘은 정렬 대상이 아니라 머리글을 두지 않는다. */}
              <PrimarySortButton column="status" label="상태" sort={sort} onSortChange={onSortChange} />
            </th>
            <th scope="col" className={thBaseClass}>
              {/* 고객사(주, 정렬 가능) + End-User(보조, 정렬 대상 아님) */}
              <PrimarySortButton column="customerName" label="고객사" sort={sort} onSortChange={onSortChange} />
            </th>
            <th scope="col" className={thBaseClass}>
              {/* 제품 구분/모델/유·무상(주) + S/N·L/N(보조) — 전체 A/S 현황과 같은 구성이며 어느 쪽도 정렬 대상이 아니다. */}
              제품
            </th>
            <th scope="col" className={thBaseClass}>
              {/* 현재 단계(주) + 마지막 작업(보조) */}
              현재 단계
            </th>
            <th scope="col" className={thBaseClass}>
              {/* 사내 목표 출하일(주) + 고객 요청 납기일(보조, 정렬 가능). 목표 검수완료일은 셋째 줄. */}
              <div className="flex flex-col gap-0.5">
                <PrimarySortButton
                  column="internalTargetShipmentDate"
                  label="목표 출하일"
                  sort={sort}
                  onSortChange={onSortChange}
                />
                <SecondarySortButton
                  column="customerRequestedDueDate"
                  label="고객 요청 납기일"
                  sort={sort}
                  onSortChange={onSortChange}
                />
              </div>
            </th>
            <th scope="col" className={thBaseClass}>
              상세
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-zinc-100 align-top last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
            >
              <td className="px-3 py-2">
                <div className="flex flex-col gap-0.5">
                  <Link
                    href={`/repair-cases/${row.id}`}
                    className="font-medium whitespace-nowrap text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-50"
                  >
                    {row.intakeNumber}
                  </Link>
                  <span className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">{row.receivedAt}</span>
                  <span className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                    입고 후 {daysSinceIntake(row.receivedAt)}일
                  </span>
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <StatusBadge status={row.status} />
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <ExceptionStatusBadge exceptionStatus={row.exceptionStatus} />
                  </div>
                  <span className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                    부품 {formatPartsRequestStatus(row.activePartsRequestStatus)}
                  </span>
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-col gap-0.5">
                  <span className="whitespace-nowrap">{row.customerName}</span>
                  <span className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                    {row.endUserName ?? "-"}
                  </span>
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-col gap-0.5">
                  <span className="whitespace-nowrap">
                    {row.productCategory} / {row.modelName} /{" "}
                    {row.billingType ? billingTypeLabels[row.billingType] : "-"}
                  </span>
                  <span className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                    S/N {row.serialNumber} / L/N {row.lotNumber}
                  </span>
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-col gap-0.5">
                  <span className="whitespace-nowrap">{row.currentWorkflowStepLabel}</span>
                  <span className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                    {formatLastActivity(row)}
                  </span>
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium whitespace-nowrap">{row.internalTargetShipmentDate ?? "-"}</span>
                  <span className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                    고객요청 {row.customerRequestedDueDate ?? "-"}
                  </span>
                  <span className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                    검수완료 {row.internalTargetInspectionCompletionDate ?? "-"}
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
  );
}
