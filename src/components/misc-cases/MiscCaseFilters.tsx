"use client";

import CheckboxFilterDropdown from "@/components/common/CheckboxFilterDropdown";
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
 *  · 이름표·입력칸의 클래스가 저쪽과 같은 글자다(고르는 칸은 2026-11-11 부터
 *    아예 **같은 부품**이라 클래스를 이 파일이 갖고 있지 않다 — 아래 ──).
 *  · [필터 초기화]가 고르는 칸들과 같은 줄 오른쪽 끝에 선다.
 *
 * ⚠️ 저쪽과 다른 점 하나 — **격자가 2칸**이다(저쪽은 5칸). 고르는 칸이 둘뿐이라
 * 5칸 격자에 넣으면 왼쪽에 둘만 붙고 오른쪽이 휑하게 빈다. 저 파일의 주석이 바로 그
 * 조정을 하라고 적어 두었다(「칸 수는 선택 항목 수와 같게 둔다」).
 *
 * 🔴 **값은 언제나 코드다.** 상태는 MiscCaseStatus, 공급처는 이름(또는 `"NONE"`)이고,
 * 보여 줄 글자는 따로 들어온다 — 글자를 값으로 쓰면 글자를 바꾸는 순간 거르개가
 * 아무것도 못 찾는데 오류도 나지 않는다(저쪽 파일의 같은 주의).
 *
 * ── 🔴 두 칸 모두 **여럿 고르는 칸**이다 (2026-11-11 사용자 개선요청) ────
 * 「한 종류의 필터 안에서 복수로 선택할 수 있게」. 일곱 필터 가운데 **마지막 둘**이고,
 * 앞의 다섯([전체 A/S 현황])과 **같은 공용 부품**을 쓴다
 * (components/common/CheckboxFilterDropdown). 이 화면에 따로 만들지 않는다 — 닫힌
 * 칸의 글자(「전체」 / 이름 / 「첫째 이름 외 N개」) · 바깥 누르기로 접기가 두 화면에서
 * 다르게 굴면 안 된다.
 *
 * 🔴 **단축 단추(shortcut)는 둘 다 주지 않는다.** 「입고품 전체」처럼 미리 정해진
 * 묶음이 있는 것은 [현재 상태] 하나뿐이고, 안 주면 목록만 그려진다.
 * 🔵 공급처의 「미지정」은 단축이 아니라 **목록의 한 줄**이다 — 선택지를 만드는 쪽이
 * 그 줄을 붙여 보낸다(domain/misc-case-list.ts 의 collectMiscCaseCustomerOptions).
 * ============================================================================
 */

const labelClass = "text-xs text-zinc-500 dark:text-zinc-400";

export default function MiscCaseFilters({
  filters,
  customerOptions,
  onQueryChange,
  onStatusesChange,
  onCustomerNamesChange,
  onReset,
}: {
  filters: MiscCaseFilterState;
  /**
   * 고를 수 있는 공급처. 🔴 **지금 떠 있는 기타건들에서 뽑은 것**이고, 거르기 전의
   * 줄에서 뽑아야 한다(domain/misc-case-list.ts 의 collectMiscCaseCustomerOptions).
   */
  customerOptions: readonly { value: string; label: string }[];
  onQueryChange: (value: string) => void;
  /** 고른 상태들. 빈 배열이면 「전체」다(2026-11-11 복수 선택). 아래도 같다. */
  onStatusesChange: (value: MiscCaseStatus[]) => void;
  onCustomerNamesChange: (value: string[]) => void;
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
          {/* 차례는 **흐름의 순서**다 — 이름순으로 세우면 단계를 거꾸로 읽는다
              (domain/misc-case-status.ts 의 MISC_CASE_STATUS_ORDER). 손으로 적지
              않고 그 상수를 펼치는 까닭은, 상태가 하나 느는 날 이 칸에서만 조용히
              빠지는 일을 막기 위해서다. */}
          <CheckboxFilterDropdown<MiscCaseStatus>
            id="misc-case-status"
            label="상태"
            options={MISC_CASE_STATUS_ORDER.map((status: MiscCaseStatus) => ({
              value: status,
              label: MISC_CASE_STATUS_LABELS[status],
            }))}
            selected={filters.statuses}
            onChange={onStatusesChange}
          />

          {/* 🔴 선택지를 여기서 만들지 않는다 — 받은 것을 그대로 넘긴다. 그 목록은
              **거르기 전의 줄**에서 뽑은 것이고(위 프롭 주석), 「미지정」 한 줄도
              거기서 붙어 온다. 선택지가 수십 줄까지 늘 수 있지만 부품이 목록 높이를
              묶고 제 안에서 굴린다(CheckboxFilterPanel 의 max-h-60). */}
          <CheckboxFilterDropdown
            id="misc-case-customer"
            label="공급처"
            options={customerOptions}
            selected={filters.customerNames}
            onChange={onCustomerNamesChange}
          />
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
