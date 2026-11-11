"use client";

import {
  formatShipmentMonthLabel,
  IN_HOUSE_STATUSES,
  type Filters,
} from "@/lib/domain/repair-case-filters";
import {
  billingTypeLabels,
  BILLING_TYPE_CODES,
  PRIORITY_CODES,
  PRODUCT_CATEGORY_OPTIONS,
  REPAIR_STATUS_CODES,
} from "@/lib/domain/types";
import type { Customer, RepairStatus } from "@/lib/domain/types";
import { useUiText } from "@/components/providers/UiTextProvider";
import CheckboxFilterDropdown from "@/components/common/CheckboxFilterDropdown";
import FilterDisclosure from "./FilterDisclosure";

type RepairCaseFiltersProps = {
  filters: Filters;
  customers: Customer[];
  onQueryChange: (value: string) => void;
  /** 고른 상태들. 빈 배열이면 「전체」다(2026-11-11 복수 선택). */
  onStatusesChange: (value: RepairStatus[]) => void;
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
  if (filters.statuses.length > 0) count += 1;
  if (filters.productCategory !== "ALL") count += 1;
  if (filters.billingType !== "ALL") count += 1;
  if (filters.customerId !== "ALL") count += 1;
  if (filters.priority !== "ALL") count += 1;
  if (filters.overdueOnly) count += 1;
  if (filters.myPendingApprovalOnly) count += 1;
  if (filters.longPendingPoOnly) count += 1;
  return count;
}

const selectClass =
  "w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
const labelClass = "text-xs text-zinc-500 dark:text-zinc-400";

export default function RepairCaseFilters({
  filters,
  customers,
  onQueryChange,
  onStatusesChange,
  onProductCategoryChange,
  onBillingTypeChange,
  onCustomerChange,
  onPriorityChange,
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
              일곱 필터 가운데 이것이 첫째고, 나머지 여섯도 같은 부품을 쓰게 된다.
              아무것도 안 고르면 「전체」, 하나면 그 이름, 여럿이면 「첫째 이름 외 N개」.

              「입고품 전체」는 체크 칸이 아니라 목록 맨 위의 **단축 단추**다:
              누르면 출하 완료를 뺀 상태들이 전부 체크되고, 그 뒤에는 그냥 여럿
              고른 상태라 거기서 하나씩 빼거나 더할 수 있다. 넣을 값을 여기 적지
              않고 IN_HOUSE_STATUSES 를 그대로 넘기는 까닭은, 그것이 대시보드
              [현재 입고 수]와 **같은 잣대**여야 하기 때문이다(그 상수의 주석).
              글자를 uiText 사전에서 뽑지 않는 것도 그래서다 — repairStatus 사전의
              키는 REPAIR_STATUS_CODES 와 한 짝이라 상태가 아닌 것의 글자를 거기
              둘 자리가 없다. */}
          <CheckboxFilterDropdown
            id="repair-case-status"
            label="현재 상태"
            options={REPAIR_STATUS_CODES.map((status) => ({
              value: status,
              label: uiText.repairStatus[status],
            }))}
            selected={filters.statuses}
            onChange={onStatusesChange}
            shortcut={{ label: "입고품 전체", values: IN_HOUSE_STATUSES }}
          />

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
                  {uiText.priority[priority]}
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
