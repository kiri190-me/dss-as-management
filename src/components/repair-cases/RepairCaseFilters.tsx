"use client";

import {
  formatShipmentMonthLabel,
  IN_HOUSE_STATUSES,
  type BillingTypeFilterValue,
  type Filters,
  type RepairStatusFilterValue,
} from "@/lib/domain/repair-case-filters";
import {
  FINAL_SHIPMENT_APPROVED_FILTER_VALUE,
  FINAL_SHIPMENT_APPROVED_LABEL,
} from "@/lib/domain/final-shipment-approval-badge";
import {
  billingTypeLabels,
  BILLING_TYPE_CODES,
  PRIORITY_CODES,
  PRODUCT_CATEGORY_OPTIONS,
  REPAIR_STATUS_CODES,
} from "@/lib/domain/types";
import type { Customer, Priority } from "@/lib/domain/types";
import { useUiText } from "@/components/providers/UiTextProvider";
import CheckboxFilterDropdown from "@/components/common/CheckboxFilterDropdown";
import FilterDisclosure from "./FilterDisclosure";

type RepairCaseFiltersProps = {
  filters: Filters;
  customers: Customer[];
  onQueryChange: (value: string) => void;
  /**
   * 고른 상태들. 빈 배열이면 「전체」다(2026-11-11 복수 선택).
   *
   * 🔴 값이 `RepairStatus` 가 아니라 **한 줄 더 넓은** 타입이다(2026-11-12) —
   * [최종 출하 승인 완료]는 상태가 아니라 필터 전용 값이다(그 타입의 주석).
   */
  onStatusesChange: (value: RepairStatusFilterValue[]) => void;
  /**
   * 아래 넷도 전부 **배열**이다(2026-11-11 사용자 개선요청 — 그 전에는 값 하나와
   * "ALL" 이었다). 빈 배열이면 「전체」라, 받는 쪽은 길이가 0 인지만 보면 된다.
   */
  onProductCategoriesChange: (value: string[]) => void;
  onBillingTypesChange: (value: BillingTypeFilterValue[]) => void;
  onCustomerIdsChange: (value: string[]) => void;
  onPrioritiesChange: (value: Priority[]) => void;
  onOverdueOnlyChange: (value: boolean) => void;
  /**
   * "내게 온 결재 요청"을 쓸 수 있는가. 서버가 내게 결재 요청이 들어와 있는
   * 건들의 집합을 계산해 준 경우(DATABASE 모드 + 로그인 세션)에만 true다 —
   * false면 이 조건은 아예 그리지 않는다. 근거 없이 체크박스만 보이면 눌러도
   * 0건이 되어 고장처럼 보인다.
   */
  canFilterMyPendingApproval?: boolean;
  onMyPendingApprovalOnlyChange?: (value: boolean) => void;
  /**
   * "장기 PO 미발행"을 쓸 수 있는가. 서버가 그 접수 건들의 집합을 계산해 준
   * 경우(DATABASE 모드)에만 true다 — false면 이 조건은 아예 그리지 않는다.
   * 위 결재 요청 조건과 같은 판단이다: 근거 없이 체크박스만 보이면 눌러도
   * 0건이 되어 고장처럼 보인다.
   */
  canFilterLongPendingPo?: boolean;
  onLongPendingPoOnlyChange?: (value: boolean) => void;
  /**
   * 신고 증상 필터만 푼다. 「필터 초기화」와 따로 둔 이유가 둘이다.
   *
   *   · 이 조건은 대시보드에서 눌러 들어올 때만 걸리는데, 그 사람은 보통
   *     고객사·기간 같은 다른 조건을 이미 걸어 둔 채다. 증상 하나만 풀려고
   *     전부를 날리게 하면 다시 걸어야 한다.
   *   · 좁은 화면에서는 「필터 초기화」가 **상세 조건이 걸려 있을 때만** 보인다
   *     (FilterDisclosure). 신고 증상은 그 셈에 들어가지 않으므로(아래
   *     countHiddenActiveFilters 주석) 그것만 걸린 상태에서는 풀 단추가 하나도
   *     보이지 않게 된다.
   */
  onClearReportedSymptom?: () => void;
  onReset: () => void;
};

/**
 * 접혔을 때 감춰지는 조건 중 지금 걸려 있는 개수. 검색어는 늘 보이므로 세지
 * 않고, shipmentMonth와 reportedSymptom도 카드 아래 자기 안내 문구가 따로
 * 있으므로 뺀다 — 접혀 있어도 그 두 줄은 보인다.
 */
export function countHiddenActiveFilters(filters: Filters): number {
  let count = 0;
  // 🔴 상태는 몇 개를 골랐든 **필터 하나**다. 여기서 세는 것은 "걸려 있는
  // 조건의 수"이지 고른 값의 수가 아니다 — 「입고품 전체」를 누르면 상태가
  // 열하나 들어오는데, 그것을 11 로 세면 접힌 필터가 "11개 적용됨"이라 말하고
  // 사람은 어디서 열한 가지를 걸었는지 찾아 헤맨다.
  // 빈 배열(= 전체)만 안 센다. 대시보드 [현재 입고 수]를 눌러 들어온 사람은
  // 조건이 걸린 채로 이 화면을 처음 보는데, 세지 않으면 "0개 적용됨"이라
  // 말하면서 목록만 짧아져 왜 짧은지 알 길이 없어진다.
  // 🔴 아래 넷도 상태와 **똑같은 규칙**이다(2026-11-11 복수 선택). 몇 개를
  // 골랐든 그 필터는 하나다 — 제품군 셋을 고른 것은 "제품군이라는 조건 하나가
  // 걸려 있다"는 뜻이지 세 조건이 아니다.
  if (filters.statuses.length > 0) count += 1;
  if (filters.productCategories.length > 0) count += 1;
  if (filters.billingTypes.length > 0) count += 1;
  if (filters.customerIds.length > 0) count += 1;
  if (filters.priorities.length > 0) count += 1;
  if (filters.overdueOnly) count += 1;
  if (filters.myPendingApprovalOnly) count += 1;
  if (filters.longPendingPoOnly) count += 1;
  return count;
}

const labelClass = "text-xs text-zinc-500 dark:text-zinc-400";

export default function RepairCaseFilters({
  filters,
  customers,
  onQueryChange,
  onStatusesChange,
  onProductCategoriesChange,
  onBillingTypesChange,
  onCustomerIdsChange,
  onPrioritiesChange,
  onOverdueOnlyChange,
  canFilterMyPendingApproval = false,
  onMyPendingApprovalOnlyChange,
  canFilterLongPendingPo = false,
  onLongPendingPoOnlyChange,
  onClearReportedSymptom,
  onReset,
}: RepairCaseFiltersProps) {
  // 🔴 고르는 값(value)은 언제나 코드다. 저장된 문구는 **보여 줄 글자**만
  // 갈아 끼운다 — 값에 문구를 쓰면 문구를 바꾸는 순간 필터가 아무것도 못 찾는데
  // 오류도 나지 않는다(types.ts 의 PRODUCT_CATEGORY_OPTIONS 가 실제로 그 모양이다).
  const uiText = useUiText();

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
          placeholder="인수번호, 고객사, End-User, Model, S/N, L/N, 담당 엔지니어 검색"
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </div>

      <FilterDisclosure activeCount={countHiddenActiveFilters(filters)} onReset={onReset}>
        {/* 칸 수는 선택 항목 수와 같게 둔다 — 다섯 개가 4칸 격자에 들어가면
            마지막 하나만 다음 줄에 홀로 남아, 그 항목만 다른 종류인 것처럼
            보인다. 항목을 더하거나 뺄 때 이 숫자도 같이 고쳐야 한다. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {/* 🔴 한 종류 안에서 **여럿 고르는** 칸이다(2026-11-11 사용자 결정) —
              같은 공용 부품을 **일곱 칸이 쓴다**([전체 A/S 현황]의 다섯 · [기타건
              현황]의 둘). 그 일곱 가운데 **단축 단추가 붙은 것은 이 칸 하나**다.
              아무것도 안 고르면 「전체」, 하나면 그 이름, 여럿이면 「첫째 이름 외 N개」.

              「입고품 전체」는 체크 칸이 아니라 목록 맨 위의 **단축 단추**다:
              누르면 출하 완료를 뺀 상태들이 전부 체크되고, 그 뒤에는 그냥 여럿
              고른 상태라 거기서 하나씩 빼거나 더할 수 있다.

              🔴 그 단추는 **눌린 토글**이다(2026-11-11 사용자 추가 요청). 눌렸는지를
              따로 기억하지 않고 **지금 고른 값으로 판정**하므로, 손으로 출하 완료만
              빼고 하나씩 체크해서 그 묶음이 되어도 단추가 저절로 눌린 모습이 된다 —
              단추로 채운 사람과 손으로 체크한 사람과 대시보드 [현재 입고 수] 카드로
              들어온 사람이 같은 화면을 봐야 하기 때문이다. 그리고 **눌린 단추를 다시
              누르면 체크가 전부 풀린다**(= 「전체」). 판정하는 자리는 이 화면이 아니라
              공용 부품의 값 쪽 파일이다(checkbox-filter-dropdown 의 isShortcutActive).

              넣을 값을 여기 적지 않고 IN_HOUSE_STATUSES 를 그대로 넘기는 까닭은,
              그것이 대시보드 [현재 입고 수]와 **같은 잣대**여야 하기 때문이다
              (그 상수의 주석).
              글자를 uiText 사전에서 뽑지 않는 것도 그래서다 — repairStatus 사전의
              키는 REPAIR_STATUS_CODES 와 한 짝이라 상태가 아닌 것의 글자를 거기
              둘 자리가 없다.

              🔴 **목록의 마지막 한 줄만 상태가 아니다**(2026-11-12 사용자 요구 —
              「[현재 상태] 필터에 [최종 출하 승인 완료]도 추가해 줘」). 유·무상 칸의
              「미지정」과 같은 꼴이다: 코드 목록에 끼워 넣지 않고 **여기서만 한 줄을
              덧붙인다**(까닭은 final-shipment-approval-badge.ts 의 그 상수 주석).

              🔴 **차례가 맨 아래인 까닭.** 위의 열둘은 워크플로 순서대로 서 있어서
              사이에 끼우면 읽는 사람이 그것도 한 단계인 줄 안다. 마지막 상태인
              「출하 완료」 **뒤**에 두면 흐름이 끝난 자리부터가 다른 종류라는 것이
              읽는 차례만으로 드러난다. 구분선으로 가르지 않는 것은 공용 부품이
              묶음을 모르기 때문이다(CheckboxFilterOption 은 value·label 둘뿐이다) —
              **일곱 칸이 함께 쓰는 부품**을 이 칸 하나 때문에 고치지 않는다.

              🔴 글자는 **배지가 쓰는 그 상수**다. 여기 "최종 출하 승인 완료" 라고
              적어 두면 이름표가 바뀌는 날 거르개와 배지가 다른 말을 하게 되는데,
              타입이 같은 문자열이라 tsc 가 한마디도 안 한다.

              🔵 「입고품 전체」 단추의 규칙은 **건드리지 않았다**. 그 묶음은
              IN_HOUSE_STATUSES(= 출하 완료만 뺀 상태들)뿐이라, 단추를 누른 뒤 이
              한 줄을 더 체크하면 고른 묶음이 달라져 단추가 풀린 모습이 된다 —
              2026-11-11 에 정한 「지금 고른 값으로 판정한다」 그대로이고, 여기서만
              따로 봐주면 손으로 체크한 사람과 단추를 누른 사람이 다른 화면을 본다. */}
          <CheckboxFilterDropdown<RepairStatusFilterValue>
            id="repair-case-status"
            label="현재 상태"
            options={[
              ...REPAIR_STATUS_CODES.map((status) => ({
                value: status,
                label: uiText.repairStatus[status],
              })),
              { value: FINAL_SHIPMENT_APPROVED_FILTER_VALUE, label: FINAL_SHIPMENT_APPROVED_LABEL },
            ]}
            selected={filters.statuses}
            onChange={onStatusesChange}
            shortcut={{ label: "입고품 전체", values: IN_HOUSE_STATUSES }}
          />

          {/* 아래 네 칸도 같은 부품을 쓴다(2026-11-11 사용자 개선요청의 나머지).
              🔴 단축 단추(shortcut)는 **주지 않는다** — 「입고품 전체」 같은 미리
              정해진 묶음이 있는 것은 [현재 상태] 하나뿐이다. 안 주면 목록만 그려진다. */}
          <CheckboxFilterDropdown
            id="repair-case-product-category"
            label="제품군"
            options={PRODUCT_CATEGORY_OPTIONS.map((category) => ({
              value: category,
              label: category,
            }))}
            selected={filters.productCategories}
            onChange={onProductCategoriesChange}
          />

          {/* 🔴 「미지정」은 단축 단추가 아니라 **목록의 한 줄**이다. 표에 "-"로
              나오는 건들(billing_type 이 null)을 가리키고, 유상·무상과 **함께**
              고를 수 있어야 한다. 값이 "NONE" 인 것도 그래서다 — 빈 값이면 체크해도
              「전체」와 구분되지 않는다. */}
          <CheckboxFilterDropdown<BillingTypeFilterValue>
            id="repair-case-billing-type"
            label="유·무상"
            options={[
              ...BILLING_TYPE_CODES.map((code) => ({ value: code, label: billingTypeLabels[code] })),
              { value: "NONE", label: "미지정" },
            ]}
            selected={filters.billingTypes}
            onChange={onBillingTypesChange}
          />

          {/* 고객사는 선택지가 수십 줄까지 는다 — 부품이 목록 높이를 묶고 제 안에서
              굴린다(CheckboxFilterPanel 의 max-h-60). 명단은 지금 화면에 올라온
              접수 건에서 뽑은 것이라(collectCustomerFilterOptions) 주소줄로 들어온
              id 가 여기 없을 수 있는데, 그때도 걸린 조건이 사라지지 않는다. */}
          <CheckboxFilterDropdown
            id="repair-case-customer"
            label="고객사"
            options={customers.map((customer) => ({ value: customer.id, label: customer.name }))}
            selected={filters.customerIds}
            onChange={onCustomerIdsChange}
          />

          <CheckboxFilterDropdown<Priority>
            id="repair-case-priority"
            label="우선순위"
            options={PRIORITY_CODES.map((priority) => ({
              value: priority,
              label: uiText.priority[priority],
            }))}
            selected={filters.priorities}
            onChange={onPrioritiesChange}
          />
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

            {canFilterLongPendingPo && (
              <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={filters.longPendingPoOnly}
                  onChange={(event) => onLongPendingPoOnlyChange?.(event.target.checked)}
                />
                {/* 견적서를 낸 지 두 달이 지나도록 발주가 안 난 건. 판정은
                    domain/long-pending-po.ts 하나가 하고, 여기는 서버가 내려준
                    묶음과 대조할 뿐이다. */}
                장기 PO 미발행만 보기
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

      {/* 대시보드 「신고 증상별 현황」에서 눌러 들어오면 이 줄이 뜬다. 걸린
          것이 안 보이면 사람이 "건이 왜 이것밖에 없지" 하고, 그 자리에서 풀
          수 없으면 목록을 떠났다 돌아와야 한다. 접기(FilterDisclosure) 바깥에
          두어 좁은 화면에서도 늘 보인다. */}
      {filters.reportedSymptom !== null && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 break-words text-xs text-zinc-600 dark:text-zinc-400">
            신고 증상 필터 적용됨: {filters.reportedSymptom}
          </p>
          <button
            type="button"
            onClick={onClearReportedSymptom}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            신고 증상 필터 해제
          </button>
        </div>
      )}
    </div>
  );
}
