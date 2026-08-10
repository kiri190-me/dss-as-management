"use client";

import { useMemo, useState } from "react";
import type { MyActiveWorkRow } from "@/lib/db/queries/repair-cases-mine";
import { applyMyWorkFilters, DEFAULT_MY_WORK_FILTERS } from "@/lib/domain/my-active-work-filter";
import { sortMyActiveWorkRows } from "@/lib/domain/my-active-work-sort";
import MyWorkSummary from "./MyWorkSummary";
import MyWorkFilters from "./MyWorkFilters";
import MyActiveWorkTable from "./MyActiveWorkTable";
import MyActiveWorkCardList from "./MyActiveWorkCardList";

/**
 * Phase 5C-3 — client shell for "내 담당 제품". `rows` arrives already
 * server-side restricted to the authenticated engineer's own
 * non-shipment-completed cases (repair-cases/mine/page.tsx) — everything
 * this component does (search/status filter, sort) operates only on that
 * already-secured set, never re-fetches or accepts a wider one.
 */
export default function MyActiveWorkScreen({ rows }: { rows: MyActiveWorkRow[] }) {
  const [filters, setFilters] = useState(DEFAULT_MY_WORK_FILTERS);

  const filteredRows = useMemo(() => applyMyWorkFilters(rows, filters), [rows, filters]);
  const sortedRows = useMemo(() => sortMyActiveWorkRows(filteredRows), [filteredRows]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">내 담당 제품</h1>
        <MyWorkSummary count={rows.length} />
      </div>

      <MyWorkFilters
        filters={filters}
        onQueryChange={(value) => setFilters((prev) => ({ ...prev, query: value }))}
        onStatusChange={(value) => setFilters((prev) => ({ ...prev, status: value }))}
      />

      {sortedRows.length === 0 ? (
        rows.length === 0 ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            현재 담당 중인 제품이 없습니다.
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            조건에 맞는 담당 제품이 없습니다.
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setFilters(DEFAULT_MY_WORK_FILTERS)}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                필터 초기화
              </button>
            </div>
          </div>
        )
      ) : (
        <>
          <MyActiveWorkTable rows={sortedRows} />
          <MyActiveWorkCardList rows={sortedRows} />
        </>
      )}
    </div>
  );
}
