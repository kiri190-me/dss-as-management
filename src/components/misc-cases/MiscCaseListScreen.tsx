"use client";

import { useMemo, useState } from "react";

import { ResponsiveList } from "@/components/common/responsive-list";
import Pagination from "@/components/repair-cases/Pagination";
import {
  isDomesticOrderSearchActive,
  type DomesticOrderSearchable,
} from "@/lib/domain/domestic-order-list";
import {
  applyMiscCaseFilters,
  collectMiscCaseCustomerOptions,
  countActiveMiscCaseFilters,
  DEFAULT_MISC_CASE_FILTERS,
  MISC_CASE_DEFAULT_SORT,
  MISC_CASE_EMPTY_LABEL,
  MISC_CASE_NO_MATCH_LABEL,
  nextMiscCaseSort,
  sortMiscCases,
  type MiscCaseFilters as MiscCaseFilterState,
  type MiscCaseSortable,
  type MiscCaseSortColumn,
  type MiscCaseSortState,
} from "@/lib/domain/misc-case-list";
import MiscCaseCardList from "./MiscCaseCardList";
import MiscCaseFilters from "./MiscCaseFilters";
import type { MiscCaseRow } from "./misc-case-fields";
import MiscCaseTable from "./MiscCaseTable";

/**
 * ============================================================================
 * 「기타건 현황」 — 수리 건이 안 붙은 내자 줄을 모아 본다 (2026-11-06)
 * ============================================================================
 * 사용자 요구 그대로: 「[PO/내자] … 에 [기타건 현황]이라고 만들고 [전체 a/s
 * 현황]처럼 기타건들을 모아서 볼 수 있도록 해줘」.
 *
 * ── 🔴 「전체 A/S 현황처럼」에서 **베낀 것** ────────────────────────────
 * 저쪽은 **수리 건** 화면이라 칸(모델 · L/N · S/N · 단계 · 담당자 …)이 기타건에는
 * 대부분 없다. 그래서 베낀 것은 칸이 아니라 **화면의 뼈대**다:
 *  ① 제목 한 줄 → ② 찾는 칸 → ③ 건수 한 줄(`aria-live`) → ④ 표/카드(ResponsiveList)
 *    → ⑤ 쪽 나누기, 그리고 ⑥ 0건일 때의 **상자 안내 + 되돌리는 단추**.
 *  · 표의 생김새(머리글 한 벌, 한 칸에 주/보조 둘, 맨 끝 [상세])도 그대로다 —
 *    MiscCaseTable 의 머리말에 무엇을 베끼고 무엇을 안 베꼈는지 적어 두었다.
 *
 * ── 🔴 **안 베낀 것**과 까닭 ───────────────────────────────────────────
 *  · **휴지통 탭** — 지우는 길은 내자 정리에 이미 있고(관리 권한), 휴지통이 받는
 *    행에는 `repairCaseId` 가 아예 없어 **어느 줄이 기타건인지 가를 재료가 없다**
 *    (domain/domestic-order-detail-link.ts 의 같은 까닭). 여기에 탭을 세우면 수리
 *    건이 붙은 줄까지 「기타건 휴지통」으로 보이게 된다.
 *  · **삭제 모드 · 일괄 선택** — 이 화면에는 쓰기가 하나도 없다. 같은 줄을 지우는
 *    길이 둘이 되면 「어디서 지웠는지」를 사람이 기억해야 한다.
 *  · **수리 건의 조건들(우선순위 · 유·무상 · 납기 지연 · 제품군)** — 전부 수리 건의
 *    값이라 기타건에는 짝이 없다. 거르개 자체는 **베꼈다**: 상태와 공급처 둘을
 *    같은 모양의 카드에 담고(MiscCaseFilters), 좁은 화면에서 접는 부품도 저쪽 것을
 *    그대로 쓴다(FilterDisclosure) — 2026-11-06 사용자 요구다.
 *  · **발주 년도 고르개** — 내자 정리에는 있지만 베끼지 않았다. 저 화면은 한 해의
 *    장부를 통째로 보는 자리라 년도가 기본 축이고, 이 화면은 「기타건을 **모아서**
 *    본다」가 목적이다(사용자 요구). 기본값이 올해인 고르개를 달면 **작년 건이
 *    첫 화면에서 사라진다** — 모아 보려고 들어온 사람에게 그것은 자료가 없는 것으로
 *    읽힌다. 본보기인 전체 A/S 현황에도 년도 고르개는 없다.
 *  · **「내게 온 결재 요청」· 「장기 PO 미발행」· 「납기 임박」** — 셋 다 수리 건을
 *    재는 서버 판정이다(queries/repair-case-approvals-pending.ts 등). 기타건에
 *    대응하는 판정은 아직 없고, 없는 것을 흉내 내면 늘 0건인 조건이 생긴다.
 *  · **목록 위로 되돌아가는 앵커(listTopRef)** — 저쪽은 한 쪽에 10건이라 쪽을 자주
 *    넘긴다. 이 화면은 기본이 50건이라(아래) 쪽 넘김이 드물다.
 *
 * ── 🔴 찾는 규칙을 새로 적지 않는다 ────────────────────────────────────
 * 내자 정리가 쓰는 함수를 그대로 부른다(filterDomesticOrdersBySearch — 여덟 칸).
 * 같은 줄을 보는 두 화면에서 같은 글자가 다르게 걸리면, 한쪽에서 찾던 건을 다른
 * 쪽에서 「없다」고 읽는다. 「지금 찾는 중인가」도 같은 자리의 함수로 묻는다
 * (isDomesticOrderSearchActive) — 화면에서 `trim() !== ""` 로 따로 판정하면 스페이스
 * 한 칸에 「찾는 중」이 되면서 정작 거르기는 아무것도 하지 않는다.
 *
 * ── 🔴 차례도 화면이 다시 세운다 ───────────────────────────────────────
 * 서버가 이미 발행일자 내림차순으로 보내지만(queries 의 listMiscDomesticOrders),
 * 머리글을 눌러 바꿀 수 있어야 하므로 화면도 같은 규칙으로 **다시** 세운다. 둘이
 * 같은 값이라야 서버가 그린 첫 HTML 과 화면의 첫 차례가 어긋나지 않는다
 * (domain/misc-case-list.ts 의 머리말 — hydration).
 * ============================================================================
 */

/**
 * 한 쪽에 몇 건인가. **전체 A/S 현황은 10건이지만 여기는 50건**이다 — 사용자가
 * 요구한 것이 「기타건들을 **모아서** 볼 수 있도록」이라, 열자마자 대부분이 한 쪽에
 * 들어오는 편이 이 화면의 뜻에 맞는다. 고르는 칸은 그대로라 10 · 20 으로 줄일 수
 * 있다(Pagination 의 선택지 셋).
 */
const DEFAULT_PAGE_SIZE = 50;

/**
 * 이 화면이 보는 칸 — **그리는 칸**(MiscCaseRow) + **찾는 칸**(여덟,
 * DomesticOrderSearchable) + **세우는 칸**(다섯, MiscCaseSortable).
 *
 * 셋을 겹쳐 적는 까닭: 조회의 전체 행 타입을 끌어오면 이 화면이 무엇을 쓰는지
 * 타입에서 사라지고, 찾기·세우기가 쓰는 칸이 빠져도 **그 칸으로만 조용히 안
 * 걸리는** 상태가 된다. `DomesticOrderListItem` 이 셋을 그대로 만족하므로
 * (구조적 타입) 페이지는 조회 결과를 그대로 넘긴다.
 */
export type MiscCaseListRow = MiscCaseRow & DomesticOrderSearchable & MiscCaseSortable;

export default function MiscCaseListScreen({ rows }: { rows: readonly MiscCaseListRow[] }) {
  const [filters, setFilters] = useState<MiscCaseFilterState>(DEFAULT_MISC_CASE_FILTERS);
  const [sort, setSort] = useState<MiscCaseSortState>(MISC_CASE_DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // 🔴 **거르기 전의 줄**에서 뽑는다 — 거른 뒤에서 뽑으면 한 공급처를 고르는 순간
  //    다른 이름이 선택지에서 사라져 되돌릴 수 없다(도메인 파일의 그 주석).
  const customerOptions = useMemo(() => collectMiscCaseCustomerOptions(rows), [rows]);

  const isSearching = isDomesticOrderSearchActive(filters.query);
  const hasOtherFilters = countActiveMiscCaseFilters(filters) > 0;
  const filteredRows = useMemo(() => applyMiscCaseFilters(rows, filters), [rows, filters]);
  const sortedRows = useMemo(() => sortMiscCases(filteredRows, sort), [filteredRows, sort]);

  // 조건이 바뀌어 쪽 수가 줄면 지금 쪽이 범위를 넘을 수 있다. 상태를 고치지 않고
  // **그릴 때 접는다** — 상태를 고치면 렌더 중에 상태를 바꾸는 꼴이 되고, 사람이
  // 글자를 지우면 보던 쪽으로 돌아간다(전체 A/S 현황과 같은 처리).
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = useMemo(
    () => sortedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [sortedRows, currentPage, pageSize]
  );

  function handleSortChange(column: MiscCaseSortColumn) {
    setSort((previous) => nextMiscCaseSort(previous, column));
    // 차례가 바뀌면 보던 쪽의 내용이 통째로 달라진다. 첫 쪽으로 돌린다.
    setPage(1);
  }

  /**
   * 조건을 하나 갈아 끼운다. **무엇을 바꾸든 첫 쪽으로 돌린다** — 세 쪽을 보던 중에
   * 조건을 좁히면 남은 줄이 한 쪽뿐일 수 있고, 그때 화면은 빈 쪽이 된다(전체 A/S
   * 현황의 updateFilters 와 같은 처리).
   */
  function updateFilters(partial: Partial<MiscCaseFilterState>) {
    setFilters((previous) => ({ ...previous, ...partial }));
    setPage(1);
  }

  function handleReset() {
    setFilters(DEFAULT_MISC_CASE_FILTERS);
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">기타건 현황</h1>
      </div>

      {/* 🔴 이 화면이 무엇을 모아 놓은 곳인지 한 줄로 적는다. 「기타건」은 2026-11-06
          에 생긴 새 낱말이라, 적지 않으면 사람은 내자 정리와 무엇이 다른지 화면만
          봐서는 알 수 없다. */}
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        수리 건이 연결되지 않은 내자 정리의 줄입니다. 줄을 누르면 기타건 상세로 갑니다.
      </p>

      <MiscCaseFilters
        filters={filters}
        customerOptions={customerOptions}
        onQueryChange={(value) => updateFilters({ query: value })}
        onStatusChange={(value) => updateFilters({ status: value })}
        onCustomerNameChange={(value) => updateFilters({ customerName: value })}
        onReset={handleReset}
      />

      <p aria-live="polite" className="text-sm text-zinc-600 dark:text-zinc-400">
        기타건 {sortedRows.length}건
      </p>

      {sortedRows.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          {/* 🔴 「자료가 없다」와 「내가 건 조건에 안 걸린다」를 가른다 — 앞쪽으로
              읽은 사람은 조건을 풀어 볼 생각을 하지 않는다(글자는 도메인에 있다).
              조건에는 글자 찾기뿐 아니라 상태·공급처도 들어간다: 검색칸은 비었는데
              공급처만 걸어 둔 채 0건이 되는 일이 실제로 흔하다. */}
          {isSearching || hasOtherFilters ? MISC_CASE_NO_MATCH_LABEL : MISC_CASE_EMPTY_LABEL}
          {(isSearching || hasOtherFilters) && (
            <div className="mt-3">
              <button
                type="button"
                onClick={handleReset}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                필터 초기화
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <ResponsiveList
            listId="misc-cases"
            // 줄 수가 바뀌면 표의 필요 폭도 바뀐다 — 다시 재게 한다.
            measureKey={[pagedRows.length]}
            table={<MiscCaseTable rows={pagedRows} sort={sort} onSortChange={handleSortChange} />}
            cards={<MiscCaseCardList rows={pagedRows} />}
          />
          <Pagination
            page={currentPage}
            pageSize={pageSize}
            totalCount={sortedRows.length}
            onPageChange={setPage}
            onPageSizeChange={(nextPageSize) => {
              setPageSize(nextPageSize);
              setPage(1);
            }}
          />
        </>
      )}
    </div>
  );
}
