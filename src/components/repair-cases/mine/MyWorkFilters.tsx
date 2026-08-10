"use client";

import { REPAIR_STATUS_CODES, repairStatusLabels } from "@/lib/domain/types";
import type { MyWorkFilterState } from "@/lib/domain/my-active-work-filter";

/**
 * Phase 5C-3 — deliberately small, purpose-built filter set for My Active
 * Work: free-text search + current status only. Not a reuse of
 * RepairCaseFilters/Filters (that type carries workflowType/customerId/
 * priority/shipmentMonth/overdueOnly, none of which this screen needs —
 * priority in particular has no real data for database-mode cases, see
 * the Phase 5C-3 audit). No engineer filter — identity is already fixed
 * server-side to the authenticated actor.
 */
const inputClass =
  "w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
const labelClass = "text-xs text-zinc-500 dark:text-zinc-400";

export default function MyWorkFilters({
  filters,
  onQueryChange,
  onStatusChange,
}: {
  filters: MyWorkFilterState;
  onQueryChange: (value: string) => void;
  onStatusChange: (value: MyWorkFilterState["status"]) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 sm:flex-row sm:items-end dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-1 flex-col gap-1">
        <label htmlFor="my-work-search" className={labelClass}>
          검색
        </label>
        <input
          id="my-work-search"
          type="text"
          value={filters.query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="인수번호, 고객사, End-User, Model, S/N, L/N"
          className={inputClass}
        />
      </div>
      <div className="flex flex-col gap-1 sm:w-56">
        <label htmlFor="my-work-status" className={labelClass}>
          현재 상태
        </label>
        <select
          id="my-work-status"
          value={filters.status}
          onChange={(e) => onStatusChange(e.target.value as MyWorkFilterState["status"])}
          className={inputClass}
        >
          <option value="ALL">전체</option>
          {REPAIR_STATUS_CODES.map((code) => (
            <option key={code} value={code}>
              {repairStatusLabels[code]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
