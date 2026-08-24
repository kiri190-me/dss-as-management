"use client";

import {
  formatShipmentMonthLabel,
  type Filters,
} from "@/lib/domain/repair-case-filters";
import {
  billingTypeLabels,
  priorityLabels,
  repairStatusLabels,
  BILLING_TYPE_CODES,
  PRIORITY_CODES,
  PRODUCT_CATEGORY_OPTIONS,
  REPAIR_STATUS_CODES,
} from "@/lib/domain/types";
import type { Customer } from "@/lib/domain/types";
import FilterDisclosure from "./FilterDisclosure";

type RepairCaseFiltersProps = {
  filters: Filters;
  customers: Customer[];
  onQueryChange: (value: string) => void;
  onStatusChange: (value: Filters["status"]) => void;
  onProductCategoryChange: (value: Filters["productCategory"]) => void;
  onBillingTypeChange: (value: Filters["billingType"]) => void;
  onCustomerChange: (value: Filters["customerId"]) => void;
  onPriorityChange: (value: Filters["priority"]) => void;
  onOverdueOnlyChange: (value: boolean) => void;
  /**
   * "내게 온 결재 요청"을 쓸 수 있는가. 서버가 내게 결재 요청이 들어와 있는
   * 건들의 집합을 계산해 준 경우(DATABASE 모드 + 로그인 세션)에만 true다 —
   * false면 이 조건은 아예 그리지 않는다. 근거 없이 체크박스만 보이면 눌러도
   * 0건이 되어 고장처럼 보인다.
   */
  canFilterMyPendingApproval?: boolean;
  onMyPendingApprovalOnlyChange?: (value: boolean) => void;
  onReset: () => void;
};

/**
 * 접혔을 때 감춰지는 조건 중 지금 걸려 있는 개수. 검색어는 늘 보이므로 세지
 * 않고, shipmentMonth도 카드 아래 자기 안내 문구가 따로 있으므로 뺀다.
 */
export function countHiddenActiveFilters(filters: Filters): number {
  let count = 0;
  if (filters.status !== "ALL") count += 1;
  if (filters.productCategory !== "ALL") count += 1;
  if (filters.billingType !== "ALL") count += 1;
  if (filters.customerId !== "ALL") count += 1;
  if (filters.priority !== "ALL") count += 1;
  if (filters.overdueOnly) count += 1;
  if (filters.myPendingApprovalOnly) count += 1;
  return count;
}

const selectClass =
  "w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
const labelClass = "text-xs text-zinc-500 dark:text-zinc-400";

export default function RepairCaseFilters({
  filters,
  customers,
  onQueryChange,
  onStatusChange,
  onProductCategoryChange,
  onBillingTypeChange,
  onCustomerChange,
  onPriorityChange,
  onOverdueOnlyChange,
  canFilterMyPendingApproval = false,
  onMyPendingApprovalOnlyChange,
  onReset,
}: RepairCaseFiltersProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-col gap-1">
        <label htmlFor="repair-case-search" className={labelClass}>
          검색
        </label>
        <input
          id="repair-case-search"
          type="text"
          value={filters.query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="인수번호, 고객사, End-User, Model, S/N, 담당 엔지니어 검색"
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </div>

      <FilterDisclosure activeCount={countHiddenActiveFilters(filters)} onReset={onReset}>
        {/* 칸 수는 선택 항목 수와 같게 둔다 — 다섯 개가 4칸 격자에 들어가면
            마지막 하나만 다음 줄에 홀로 남아, 그 항목만 다른 종류인 것처럼
            보인다. 항목을 더하거나 뺄 때 이 숫자도 같이 고쳐야 한다. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="flex flex-col gap-1">
            <label htmlFor="repair-case-status" className={labelClass}>
              현재 상태
            </label>
            <select
              id="repair-case-status"
              className={selectClass}
              value={filters.status}
              onChange={(event) =>
                onStatusChange(event.target.value as Filters["status"])
              }
            >
              <option value="ALL">전체</option>
              {REPAIR_STATUS_CODES.map((status) => (
                <option key={status} value={status}>
                  {repairStatusLabels[status]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="repair-case-product-category" className={labelClass}>
              제품군
            </label>
            <select
              id="repair-case-product-category"
              className={selectClass}
              value={filters.productCategory}
              onChange={(event) => onProductCategoryChange(event.target.value)}
            >
              <option value="ALL">전체</option>
              {PRODUCT_CATEGORY_OPTIONS.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="repair-case-billing-type" className={labelClass}>
              유·무상
            </label>
            <select
              id="repair-case-billing-type"
              className={selectClass}
              value={filters.billingType}
              onChange={(event) =>
                onBillingTypeChange(event.target.value as Filters["billingType"])
              }
            >
              <option value="ALL">전체</option>
              {BILLING_TYPE_CODES.map((code) => (
                <option key={code} value={code}>
                  {billingTypeLabels[code]}
                </option>
              ))}
              {/* 표에 "-"로 나오는 건들. 아직 정해지지 않은 것을 따로 훑을 수 있어야 한다. */}
              <option value="NONE">미지정</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="repair-case-customer" className={labelClass}>
              고객사
            </label>
            <select
              id="repair-case-customer"
              className={selectClass}
              value={filters.customerId}
              onChange={(event) => onCustomerChange(event.target.value)}
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
            <label htmlFor="repair-case-priority" className={labelClass}>
              우선순위
            </label>
            <select
              id="repair-case-priority"
              className={selectClass}
              value={filters.priority}
              onChange={(event) =>
                onPriorityChange(event.target.value as Filters["priority"])
              }
            >
              <option value="ALL">전체</option>
              {PRIORITY_CODES.map((priority) => (
                <option key={priority} value={priority}>
                  {priorityLabels[priority]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={filters.overdueOnly}
                onChange={(event) => onOverdueOnlyChange(event.target.checked)}
              />
              납기 지연 건만 보기
            </label>

            {canFilterMyPendingApproval && (
              <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={filters.myPendingApprovalOnly}
                  onChange={(event) => onMyPendingApprovalOnlyChange?.(event.target.checked)}
                />
                내게 온 결재 요청만 보기
              </label>
            )}
          </div>

          <button
            type="button"
            onClick={onReset}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            필터 초기화
          </button>
        </div>
      </FilterDisclosure>

      {filters.shipmentMonth && (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          이번 달 출하 완료 필터 적용됨: {formatShipmentMonthLabel(filters.shipmentMonth)}{" "}
          (필터 초기화로 해제할 수 있습니다)
        </p>
      )}
    </div>
  );
}
