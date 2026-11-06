"use client";

import FilterDisclosure from "@/components/repair-cases/FilterDisclosure";
import {
  countActiveMiscCaseFilters,
  type MiscCaseFilters as MiscCaseFilterState,
} from "@/lib/domain/misc-case-list";
import {
  MISC_CASE_STATUS_LABELS,
  MISC_CASE_STATUS_ORDER,
  type MiscCaseStatus,
} from "@/lib/domain/misc-case-status";

/**
 * ============================================================================
 * 「기타건 현황」의 거르개 — 찾기 한 칸 + 상태 · 공급처 (2026-11-06)
 * ============================================================================
 * 사용자 요구: 「상태·공급처 별로 필터링할 수 있는 검색기능을 넣어줘」.
 *
 * 🔴 **모양을 새로 만들지 않았다.** 전체 A/S 현황의 거르개 카드를 그대로 따른다
 * (components/repair-cases/RepairCaseFilters.tsx):
 *  · 테두리 상자 하나에 **검색칸이 맨 위**, 그 아래 고르는 칸들.
 *  · 좁은 화면에서는 고르는 칸들이 접힌다 — **같은 부품**을 쓴다(FilterDisclosure).
 *    접힌 채로 조건이 걸려 있으면 몇 개가 걸렸는지 알려 주고, 펼치지 않고도 지울 수
 *    있다. 그 까닭은 그 파일에 적혀 있다.
 *  · 이름표·입력칸·고르개의 클래스가 저쪽과 같은 글자다.
 *  · [필터 초기화]가 고르는 칸들과 같은 줄 오른쪽 끝에 선다.
 *
 * ⚠️ 저쪽과 다른 점 하나 — **격자가 2칸**이다(저쪽은 5칸). 고르는 칸이 둘뿐이라
 * 5칸 격자에 넣으면 왼쪽에 둘만 붙고 오른쪽이 휑하게 빈다. 저 파일의 주석이 바로 그
 * 조정을 하라고 적어 두었다(「칸 수는 선택 항목 수와 같게 둔다」).
 *
 * 🔴 **값은 언제나 코드다.** 상태는 MiscCaseStatus, 공급처는 이름(또는 `"NONE"`)이고,
 * 보여 줄 글자는 따로 들어온다 — 글자를 값으로 쓰면 글자를 바꾸는 순간 거르개가
 * 아무것도 못 찾는데 오류도 나지 않는다(저쪽 파일의 같은 주의).
 * ============================================================================
 */

const selectClass =
  "w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
const labelClass = "text-xs text-zinc-500 dark:text-zinc-400";

export default function MiscCaseFilters({
  filters,
  customerOptions,
  onQueryChange,
  onStatusChange,
  onCustomerNameChange,
  onReset,
}: {
  filters: MiscCaseFilterState;
  /**
   * 고를 수 있는 공급처. 🔴 **지금 떠 있는 기타건들에서 뽑은 것**이고, 거르기 전의
   * 줄에서 뽑아야 한다(domain/misc-case-list.ts 의 collectMiscCaseCustomerOptions).
   */
  customerOptions: readonly { value: string; label: string }[];
  onQueryChange: (value: string) => void;
  onStatusChange: (value: MiscCaseFilterState["status"]) => void;
  onCustomerNameChange: (value: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-col gap-1">
        <label htmlFor="misc-case-search" className={labelClass}>
          검색
        </label>
        <input
          id="misc-case-search"
          type="text"
          value={filters.query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="공급처, 품명, 발행번호, 발주서번호, PJT, S/N, L/N, 인수번호 검색"
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </div>

      <FilterDisclosure activeCount={countActiveMiscCaseFilters(filters)} onReset={onReset}>
        {/* 칸 수는 고르는 항목 수와 같게 둔다(파일 머리말의 ⚠️). */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="misc-case-status" className={labelClass}>
              상태
            </label>
            <select
              id="misc-case-status"
              className={selectClass}
              value={filters.status}
              onChange={(event) =>
                onStatusChange(event.target.value as MiscCaseFilterState["status"])
              }
            >
              <option value="ALL">전체</option>
              {/* 차례는 **흐름의 순서**다 — 이름순으로 세우면 단계를 거꾸로 읽는다
                  (domain/misc-case-status.ts 의 MISC_CASE_STATUS_ORDER). */}
              {MISC_CASE_STATUS_ORDER.map((status: MiscCaseStatus) => (
                <option key={status} value={status}>
                  {MISC_CASE_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="misc-case-customer" className={labelClass}>
              공급처
            </label>
            <select
              id="misc-case-customer"
              className={selectClass}
              value={filters.customerName}
              onChange={(event) => onCustomerNameChange(event.target.value)}
            >
              <option value="ALL">전체</option>
              {customerOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
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
