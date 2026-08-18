"use client";

import {
  formatShipmentMonthLabel,
  type Filters,
} from "@/lib/domain/repair-case-filters";
import {
  priorityLabels,
  repairStatusLabels,
  workflowTypeLabels,
  PRIORITY_CODES,
  REPAIR_STATUS_CODES,
  WORKFLOW_TYPE_CODES,
} from "@/lib/domain/types";
import type { Customer } from "@/lib/domain/types";
import FilterDisclosure from "./FilterDisclosure";

type RepairCaseFiltersProps = {
  filters: Filters;
  customers: Customer[];
  onQueryChange: (value: string) => void;
  onStatusChange: (value: Filters["status"]) => void;
  onWorkflowTypeChange: (value: Filters["workflowType"]) => void;
  onCustomerChange: (value: Filters["customerId"]) => void;
  onPriorityChange: (value: Filters["priority"]) => void;
  onOverdueOnlyChange: (value: boolean) => void;
  onReset: () => void;
};

/**
 * 접혔을 때 감춰지는 조건 중 지금 걸려 있는 개수. 검색어는 늘 보이므로 세지
 * 않고, shipmentMonth도 카드 아래 자기 안내 문구가 따로 있으므로 뺀다.
 */
export function countHiddenActiveFilters(filters: Filters): number {
  let count = 0;
  if (filters.status !== "ALL") count += 1;
  if (filters.workflowType !== "ALL") count += 1;
  if (filters.customerId !== "ALL") count += 1;
  if (filters.priority !== "ALL") count += 1;
  if (filters.overdueOnly) count += 1;
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
  onWorkflowTypeChange,
  onCustomerChange,
  onPriorityChange,
  onOverdueOnlyChange,
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
            <label htmlFor="repair-case-workflow-type" className={labelClass}>
              워크플로 유형
            </label>
            <select
              id="repair-case-workflow-type"
              className={selectClass}
              value={filters.workflowType}
              onChange={(event) =>
                onWorkflowTypeChange(event.target.value as Filters["workflowType"])
              }
            >
              <option value="ALL">전체</option>
              {WORKFLOW_TYPE_CODES.map((type) => (
                <option key={type} value={type}>
                  {workflowTypeLabels[type]}
                </option>
              ))}
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
          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={filters.overdueOnly}
              onChange={(event) => onOverdueOnlyChange(event.target.checked)}
            />
            납기 지연 건만 보기
          </label>

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
