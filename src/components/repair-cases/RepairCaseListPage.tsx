"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  mockCustomers,
  mockEndUsers,
  mockProducts,
  mockRepairCases,
  mockUsers,
} from "@/lib/domain/mock-data";
import { buildRepairCaseRows } from "@/lib/domain/repair-case-rows";
import {
  applyFilters,
  DEFAULT_FILTERS,
  paginate,
  parseInitialFilters,
  sortRows,
  type Filters,
  type PaginationState,
  type SortColumn,
  type SortState,
} from "@/lib/domain/repair-case-filters";
import DemoReferenceNotice from "@/components/domain/DemoReferenceNotice";
import RepairCaseFilters from "./RepairCaseFilters";
import RepairCaseTable from "./RepairCaseTable";
import RepairCaseCardList from "./RepairCaseCardList";
import Pagination from "./Pagination";

const DEFAULT_SORT: SortState = { column: "receivedAt", direction: "desc" };
const DEFAULT_PAGINATION: PaginationState = { page: 1, pageSize: 10 };

export default function RepairCaseListPage() {
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<Filters>(() =>
    parseInitialFilters(searchParams)
  );
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [pagination, setPagination] = useState<PaginationState>(DEFAULT_PAGINATION);

  const rows = useMemo(
    () =>
      buildRepairCaseRows(
        mockRepairCases,
        mockCustomers,
        mockEndUsers,
        mockProducts,
        mockUsers
      ),
    []
  );

  const filteredRows = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  const sortedRows = useMemo(() => sortRows(filteredRows, sort), [filteredRows, sort]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pagination.pageSize));
  const currentPage = Math.min(pagination.page, totalPages);
  const pagedRows = useMemo(
    () => paginate(sortedRows, { ...pagination, page: currentPage }),
    [sortedRows, pagination, currentPage]
  );

  function updateFilters(partial: Partial<Filters>) {
    setFilters((prev) => ({ ...prev, ...partial }));
    setPagination((prev) => ({ ...prev, page: 1 }));
  }

  function handleSortChange(column: SortColumn) {
    setSort((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { column, direction: "asc" }
    );
  }

  function handleReset() {
    setFilters(DEFAULT_FILTERS);
    setPagination((prev) => ({ ...prev, page: 1 }));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          전체 A/S 현황
        </h1>
        <DemoReferenceNotice />
      </div>

      <RepairCaseFilters
        filters={filters}
        customers={mockCustomers}
        onQueryChange={(value) => updateFilters({ query: value })}
        onStatusChange={(value) => updateFilters({ status: value })}
        onWorkflowTypeChange={(value) => updateFilters({ workflowType: value })}
        onCustomerChange={(value) => updateFilters({ customerId: value })}
        onPriorityChange={(value) => updateFilters({ priority: value })}
        onOverdueOnlyChange={(value) => updateFilters({ overdueOnly: value })}
        onReset={handleReset}
      />

      <p aria-live="polite" className="text-sm text-zinc-600 dark:text-zinc-400">
        조건에 맞는 A/S 접수 건 {sortedRows.length}건
      </p>

      {sortedRows.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          조건에 맞는 A/S 접수 건이 없습니다.
          <div className="mt-3">
            <button
              type="button"
              onClick={handleReset}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              필터 초기화
            </button>
          </div>
        </div>
      ) : (
        <>
          <RepairCaseTable rows={pagedRows} sort={sort} onSortChange={handleSortChange} />
          <RepairCaseCardList rows={pagedRows} />
          <Pagination
            page={currentPage}
            pageSize={pagination.pageSize}
            totalCount={sortedRows.length}
            onPageChange={(page) => setPagination((prev) => ({ ...prev, page }))}
            onPageSizeChange={(pageSize) => setPagination({ page: 1, pageSize })}
          />
        </>
      )}
    </div>
  );
}
