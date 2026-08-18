"use client";

import { exceptionStatusLabels, REPAIR_STATUS_CODES, repairStatusLabels } from "@/lib/domain/types";
import type { ExceptionStatus } from "@/lib/domain/types";
import type { MyWorkFilterState } from "@/lib/domain/my-active-work-filter";
import FilterDisclosure from "@/components/repair-cases/FilterDisclosure";

/** 접혔을 때 감춰지는 조건 중 지금 걸려 있는 개수(검색어는 늘 보이므로 세지 않는다). */
export function countHiddenActiveFilters(filters: MyWorkFilterState): number {
  let count = 0;
  if (filters.status !== "ALL") count += 1;
  if (filters.productCategory !== "ALL") count += 1;
  if (filters.customerId !== "ALL") count += 1;
  if (filters.exceptionStatus !== "ALL") count += 1;
  return count;
}

const selectClass =
  "w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
const labelClass = "text-xs text-zinc-500 dark:text-zinc-400";

/**
 * "내 담당 제품"의 필터 카드.
 *
 * 2026-08-19부터 전체 A/S 현황(RepairCaseFilters)과 같은 짜임이다 — 검색이
 * 한 줄을 다 쓰고, 그 아래 선택 항목이 격자로 놓이고, 마지막 줄 오른쪽에
 * 초기화 버튼이 있다. 두 화면을 오가는 사람이 같은 자리에서 같은 것을 찾게
 * 하려는 것이므로, 클래스 문자열도 그쪽과 같은 값을 쓴다.
 *
 * 그렇다고 컴포넌트를 하나로 합치지는 않았다. 그쪽 Filters 타입은
 * workflowType/customerId/priority/shipmentMonth/overdueOnly를 들고 다니는데
 * 이 화면에 필요한 것과 겹치지 않고(우선순위·납기 지연은 여기 데이터가 없다),
 * 선택 항목도 그쪽은 전체 목록, 여기는 담당 건에 실제로 있는 값만이다 —
 * 합치면 한쪽에서만 쓰는 분기가 컴포넌트 안에 쌓인다.
 *
 * 좁은 화면에서 검색칸만 남기고 접는 것(FilterDisclosure)도 그쪽과 같다 —
 * 전체 A/S 현황에만 넣으면 방금 맞춰 놓은 두 화면이 모바일에서 다시 갈린다.
 */
export default function MyWorkFilters({
  filters,
  productCategories,
  customers,
  exceptionStatuses,
  onQueryChange,
  onStatusChange,
  onProductCategoryChange,
  onCustomerChange,
  onExceptionStatusChange,
  onReset,
}: {
  filters: MyWorkFilterState;
  productCategories: string[];
  customers: { id: string; name: string }[];
  exceptionStatuses: ExceptionStatus[];
  onQueryChange: (value: string) => void;
  onStatusChange: (value: MyWorkFilterState["status"]) => void;
  onProductCategoryChange: (value: MyWorkFilterState["productCategory"]) => void;
  onCustomerChange: (value: MyWorkFilterState["customerId"]) => void;
  onExceptionStatusChange: (value: MyWorkFilterState["exceptionStatus"]) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-col gap-1">
        <label htmlFor="my-work-search" className={labelClass}>
          검색
        </label>
        <input
          id="my-work-search"
          type="text"
          value={filters.query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="인수번호, 고객사, End-User, Model, S/N, L/N 검색"
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </div>

      <FilterDisclosure activeCount={countHiddenActiveFilters(filters)} onReset={onReset}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="my-work-status" className={labelClass}>
              현재 상태
            </label>
            <select
              id="my-work-status"
              className={selectClass}
              value={filters.status}
              onChange={(e) => onStatusChange(e.target.value as MyWorkFilterState["status"])}
            >
              <option value="ALL">전체</option>
              {REPAIR_STATUS_CODES.map((code) => (
                <option key={code} value={code}>
                  {repairStatusLabels[code]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="my-work-product-category" className={labelClass}>
              제품 구분
            </label>
            <select
              id="my-work-product-category"
              className={selectClass}
              value={filters.productCategory}
              onChange={(e) => onProductCategoryChange(e.target.value)}
            >
              <option value="ALL">전체</option>
              {productCategories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="my-work-customer" className={labelClass}>
              고객사
            </label>
            <select
              id="my-work-customer"
              className={selectClass}
              value={filters.customerId}
              onChange={(e) => onCustomerChange(e.target.value)}
            >
              <option value="ALL">전체</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="my-work-exception-status" className={labelClass}>
              예외 상태
            </label>
            <select
              id="my-work-exception-status"
              className={selectClass}
              value={filters.exceptionStatus}
              onChange={(e) => onExceptionStatusChange(e.target.value as MyWorkFilterState["exceptionStatus"])}
            >
              <option value="ALL">전체</option>
              <option value="NONE">예외 없음</option>
              {exceptionStatuses.map((code) => (
                <option key={code} value={code}>
                  {exceptionStatusLabels[code]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={onReset}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            필터 초기화
          </button>
        </div>
      </FilterDisclosure>
    </div>
  );
}
