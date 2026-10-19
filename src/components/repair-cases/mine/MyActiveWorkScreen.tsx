"use client";

import { useMemo, useState } from "react";
import type { MyActiveWorkRow } from "@/lib/db/queries/repair-cases-mine";
import {
  applyMyWorkFilters,
  collectMyWorkFilterOptions,
  DEFAULT_MY_WORK_FILTERS,
} from "@/lib/domain/my-active-work-filter";
import {
  DEFAULT_MY_WORK_SORT,
  sortMyActiveWorkRowsBy,
  type MyWorkSortColumn,
} from "@/lib/domain/my-active-work-sort";
import MyWorkSummary from "./MyWorkSummary";
import MyWorkFilters from "./MyWorkFilters";
import MyActiveWorkTable from "./MyActiveWorkTable";
import { ResponsiveList } from "@/components/common/responsive-list";
import MyActiveWorkCardList from "./MyActiveWorkCardList";

/**
 * "내 담당 제품"의 클라이언트 껍데기. `rows`는 이미 서버에서 로그인한
 * 엔지니어 본인의 미출하 건으로 좁혀져 도착한다(repair-cases/mine/page.tsx) —
 * 여기서 하는 일(검색·필터·정렬)은 전부 그 이미 안전한 집합 위에서만 벌어지고,
 * 다시 가져오거나 더 넓은 집합을 받지 않는다.
 *
 * 2026-08-19: 화면 구성을 전체 A/S 현황(RepairCaseListPage)에 맞췄다 —
 * 필터 카드, 목록 위 건수 줄, 접힌 표. 페이지 나누기는 넣지 않았다: 한 사람이
 * 담당하는 미출하 건은 한 화면에 들어오는 양이고, 나누면 오히려 "내 일 전부"를
 * 한눈에 보는 이 화면의 쓸모가 줄어든다.
 */
export default function MyActiveWorkScreen({
  rows,
  dueDateNearCaseIds,
}: {
  rows: MyActiveWorkRow[];
  /**
   * 지금 **납기 임박**인 접수 건 id — 서버가 재 둔 것이다(2026-10-19). 이 화면은
   * 배지를 달지 않고 **「고객 요청 납기일」 글자만** 굵은 붉은색이 된다(사용자가
   * 배지를 요구한 곳은 전체 A/S 현황과 상세 둘이다).
   *
   * 🔴 화면이 스스로 재지 않는 까닭은 전체 A/S 현황과 같다 — "오늘"을 화면에서
   * 만들면 서버가 그린 것과 어긋나고(hydration), 조건을 적으면 종 알림과 두 말이
   * 된다. 🔵 이 묶음은 **내 건만 담고 있지 않다**(종이 쓰는 조회 그대로다). 남의
   * 건 id 가 섞여 있어도 이 화면에는 내 행만 있어 아무 줄에도 닿지 않는다.
   */
  dueDateNearCaseIds?: readonly string[];
}) {
  const dueDateNearIdSet = useMemo(
    () => (dueDateNearCaseIds ? new Set(dueDateNearCaseIds) : undefined),
    [dueDateNearCaseIds]
  );
  const [filters, setFilters] = useState(DEFAULT_MY_WORK_FILTERS);
  const [sort, setSort] = useState(DEFAULT_MY_WORK_SORT);

  const options = useMemo(() => collectMyWorkFilterOptions(rows), [rows]);
  const filteredRows = useMemo(() => applyMyWorkFilters(rows, filters), [rows, filters]);
  const sortedRows = useMemo(() => sortMyActiveWorkRowsBy(filteredRows, sort), [filteredRows, sort]);

  function handleSortChange(column: MyWorkSortColumn) {
    setSort((prev) => {
      if (prev.column !== column) return { column, direction: "asc" };
      // 같은 열을 세 번째 누르면 기본 순서(급한 순)로 돌아온다 — 눌러서 바꾼
      // 정렬을 되돌릴 방법이 달리 없으면 새로고침밖에 남지 않는다.
      if (prev.direction === "asc") return { column, direction: "desc" };
      return DEFAULT_MY_WORK_SORT;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">내 담당 제품</h1>
        <MyWorkSummary count={rows.length} />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          현재 담당 중인 제품이 없습니다.
        </div>
      ) : (
        <>
          <MyWorkFilters
            filters={filters}
            productCategories={options.productCategories}
            customers={options.customers}
            exceptionStatuses={options.exceptionStatuses}
            onQueryChange={(value) => setFilters((prev) => ({ ...prev, query: value }))}
            onStatusChange={(value) => setFilters((prev) => ({ ...prev, status: value }))}
            onProductCategoryChange={(value) => setFilters((prev) => ({ ...prev, productCategory: value }))}
            onCustomerChange={(value) => setFilters((prev) => ({ ...prev, customerId: value }))}
            onExceptionStatusChange={(value) => setFilters((prev) => ({ ...prev, exceptionStatus: value }))}
            onReset={() => setFilters(DEFAULT_MY_WORK_FILTERS)}
          />

          <p aria-live="polite" className="text-sm text-zinc-600 dark:text-zinc-400">
            조건에 맞는 담당 제품 {sortedRows.length}건
          </p>

          {sortedRows.length === 0 ? (
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
          ) : (
            <ResponsiveList
              listId="my-active-work"
              table={
                <MyActiveWorkTable
                  rows={sortedRows}
                  sort={sort}
                  onSortChange={handleSortChange}
                  dueDateNearCaseIds={dueDateNearIdSet}
                />
              }
              cards={<MyActiveWorkCardList rows={sortedRows} dueDateNearCaseIds={dueDateNearIdSet} />}
            />
          )}
        </>
      )}
    </div>
  );
}
