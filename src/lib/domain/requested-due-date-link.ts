import { foldBlankToNull, formatDomesticOrderDueDateLines } from "./domestic-order-list";
import { pickEarliestDueDate } from "./weekly-report-delivery";

/**
 * ============================================================================
 * `납기요청일` ↔ `고객 요청 납기일` — 한쪽이 비었을 때 상대의 값을 보여 주는 규칙
 * ============================================================================
 * DB 도 React 도 여기 들어오지 않는다. domestic-order-list.ts ·
 * weekly-report-delivery.ts 와 같은 자리의 파일이고, 같은 이유로 순수 함수만
 * 둔다 — 아래 두 규칙은 **화면 둘이 같은 답을 내야** 하는 종류라, 각 화면 안에
 * 두면 한쪽만 고쳐지는 날이 오고 그날 같은 자료가 두 날짜로 보인다.
 *
 * ── ⚠️ 보여 주는 규칙일 뿐, 저장 구조는 그대로다 ────────────────────────
 * 두 값은 지금처럼 **각자 자기 자리에** 저장된다:
 *
 *   내자 정리 `납기요청일`   ← domestic_order_due_dates (날짜 + 비고, **여럿**)
 *   수리 건  `고객 요청 납기일` ← repair_cases.customer_requested_due_date (**하나**)
 *
 * 한쪽에서 고친 값이 다른 쪽 칼럼에 써지는 일은 없다. 이 파일의 함수가 내놓는
 * 것은 **그릴 값**이지 저장할 값이 아니다 — 계산된 값을 원본 칸에 옮겨 담으면
 * 자동으로 따라오던 날짜가 그 줄에 박제되고, 그때부터 "일부러 다르게 적었다"와
 * "그냥 안 건드렸다"를 구분할 수 없다(domestic-order-cell-edit.ts 헤더의 함정 ②).
 * 그래서 이 결과는 어느 저장 payload 타입에도 들어가지 않는다.
 *
 * ── 자기 자리에 적힌 것이 먼저다 ────────────────────────────────────────
 * 승인된 결정이다. 내자에 날짜가 있으면 그것을 보여 주고, 없을 때만 수리 건의
 * 값을 빌린다. 반대쪽도 같다 — 고객사·형식·L/N·S/N·고장내역 다섯 칸이 이미 쓰는
 * 방향과 같다(domestic-order-list.ts 의 resolveDomesticOrderValue).
 *
 * ── ⚠️ 빌려 온 값에는 표시가 붙는다. 그 다섯 칸과 다른 점이다 ────────────
 * 다섯 칸은 목록에 아무 표시 없이 그려진다. 그래도 되는 이유는 **그 다섯이 같은
 * 사실을 두 곳에서 부르는 이름**이기 때문이다 — 그 발주의 고객사는 곧 그 수리
 * 건의 고객사이고, 형식도 L/N 도 S/N 도 같은 물건의 같은 값이다. 어느 쪽에서
 * 왔든 문장의 뜻이 달라지지 않는다.
 *
 * 납기일은 그렇지 않다. 내자의 납기요청일은 **발주서에 적힌 날짜**이고, 수리
 * 건의 고객 요청 납기일은 **고객이 접수 때 말한 날짜**다 — 이 저장소가 원래
 * "같아야 할 이유가 없다"고 못 박아 두었던 두 값이다(queries/domestic-orders.ts
 * 의 그 칸 주석). 표시 없이 그냥 날짜만 그리면 "이 줄에 내가 적어 둔 값"으로
 * 읽히고, 나중에 상대 쪽이 바뀌면 아무도 안 건드렸는데 값이 달라진 것으로
 * 보인다. 그래서 아래 두 함수는 날짜만 내놓지 않고 **어디서 온 값인지**를 함께
 * 내놓는다(borrowed).
 *
 * 다섯 칸과 어긋나는 것도 아니다 — 납기요청일은 `줄 수정` 폼에서도 이미 다섯
 * 칸과 다르게 다뤄진다. 다섯은 흐린 글씨(placeholder)로 힌트를 주지만 납기일
 * 묶음에는 그럴 자리가 없어 **안내 한 줄**로 적고 있고(DomesticOrderEditForm 의
 * '흐린 글씨로는 안 된다'), 여기 붙는 표시는 그 결정의 목록 쪽 짝이다.
 *
 * ── ⚠️ 여럿 중 하나를 골라야 하는 쪽은 주간보고와 같은 함수를 쓴다 ───────
 * 내자 쪽은 날짜가 여럿일 수 있고(분할 납품), 한 수리 건에 내자 줄이 여럿일
 * 수도 있다(분할 발주 — repair_case_id 에 유일 제약이 없다). 그래서 수리 건
 * 화면이 빌려 올 때는 **하나로 접어야** 한다.
 *
 * 그 규칙은 여기서 새로 정하지 않는다 — 주간보고 `납입 예정 건` 표의
 * `입고 요청일` 이 같은 물음에 이미 답해 두었다: **그 건에 붙은 납기요청일 중
 * 가장 이른 하루**(weekly-report-delivery.ts 의 pickEarliestDueDate). 같은 자료를
 * 두 화면이 다른 날짜로 보여 주면 어느 쪽도 믿을 수 없게 되므로, 규칙을 베껴
 * 적지 않고 **그 함수를 그대로 부른다.**
 * ============================================================================
 */

/**
 * 내자 정리의 `납기요청일` 칸에 붙는 표시. 빌려 온 날짜 옆에만 붙는다.
 *
 * 짧아야 하는 자리다 — 22칼럼짜리 표의 한 칸이라, 설명을 통째로 적으면 그
 * 칼럼만 넓어져 표가 옆으로 길어진다. 긴 설명은 아래 …_NOTE 가 맡는다.
 */
export const DUE_DATE_FROM_REPAIR_CASE_LABEL = "수리 건 요청일";

/** 수리 건 상세정보의 `고객 요청 납기일` 아래에 붙는 표시. 위와 짝이다. */
export const DUE_DATE_FROM_DOMESTIC_ORDER_LABEL = "내자 납기요청일";

/**
 * 내자 정리 쪽 설명. 표 머리말과 카드 이름표가 **같은 글자**를 title 로 나눠
 * 쓴다 — 따로 적으면 언젠가 한쪽만 고쳐져 같은 칸이 화면마다 다른 규칙으로
 * 설명된다(DomesticOrderListScreen 의 DELIVERED_DATE_NOTE 와 같은 이유).
 *
 * 표시 글자를 문장에 **박아 넣지 않고 위 상수를 끼워 넣는다.** 배지에 적히는
 * 말과 설명에 적히는 말이 어긋나면, 설명이 화면에 없는 표시를 가리키게 된다.
 */
export const DOMESTIC_ORDER_DUE_DATE_LINK_NOTE =
  `납기요청일이 비어 있는 줄은 연결된 수리 건의 고객 요청 납기일을 대신 보여 줍니다. ` +
  `그 값에는 '${DUE_DATE_FROM_REPAIR_CASE_LABEL}' 표시가 붙습니다.`;

/** 수리 건 상세정보 쪽 설명. 위와 같은 자리에 같은 이유로 있다. */
export const REPAIR_CASE_DUE_DATE_LINK_NOTE =
  `고객 요청 납기일이 비어 있으면 연결된 내자 정리의 납기요청일 중 가장 이른 하루를 ` +
  `대신 보여 줍니다. 그 값에는 '${DUE_DATE_FROM_DOMESTIC_ORDER_LABEL}' 표시가 붙습니다.`;

/**
 * 내자 정리 목록의 `납기요청일` 칸에 그릴 것.
 *
 * `lines` 는 **한 줄에 날짜 하나**다(formatDomesticOrderDueDateLines 와 같은
 * 모양). 비어 있으면 그릴 것이 없다는 뜻이고, "-"로 바꾸는 일은 화면이 한다 —
 * 자료를 "-"로 바꾸는 일은 화면에서만 한다는 이 저장소의 규칙 그대로다.
 *
 * `borrowed` 가 참이면 그 줄들은 **이 줄에 적힌 값이 아니다.** 화면은 이때만
 * 표시를 붙인다(위 DUE_DATE_FROM_REPAIR_CASE_LABEL).
 */
export type DomesticOrderDueDateDisplay = {
  lines: string[];
  borrowed: boolean;
};

/**
 * 그 줄의 `납기요청일` 칸에 무엇을 그릴 것인가 — **이 줄에 적힌 날짜가 먼저,
 * 하나도 없으면 연결된 수리 건의 고객 요청 납기일**(파일 헤더).
 *
 * 딸린 표에 줄이 하나라도 있으면 그것이 전부다. 거기에 수리 건의 날짜를 섞어
 * 붙이지 않는다 — 섞으면 사람이 적어 넣은 1차분·2차분 사이에 아무도 적지 않은
 * 날짜가 끼어들고, 그 순간 이 칸은 "발주서에 이렇게 적혀 있다"는 기록이기를
 * 그만둔다.
 *
 * 빌려 오는 쪽은 **한 줄뿐**이다. 수리 건의 그 칸은 원래 날짜 하나이고
 * (repair_cases.customer_requested_due_date), 메모도 없어 괄호가 붙지 않는다.
 * 공백만 적힌 값은 없는 것으로 접는다 — 화면에는 빈칸으로 보이는데 표시만
 * 붙는 줄이 생기지 않게 한다(domestic-order-list.ts 의 foldBlankToNull).
 *
 * ⚠️ **행 전체가 아니라 이 함수가 보는 두 칸만 받는다.** 목록 한 줄을 통째로
 * 받게 해 두면 언젠가 `deliveredDate` 나 원본 칸이 여기 섞여 들어오고, 그때
 * 이 규칙은 조용히 달라진다(resolveDomesticOrderDeliveredDate 가 값 하나가
 * 아니라 이름 붙은 칸을 받는 것과 같은 이유).
 */
export function resolveDomesticOrderDueDateDisplay(row: {
  dueDates: readonly { dueDate: string; note: string | null }[];
  repairCaseCustomerRequestedDueDate: string | null;
}): DomesticOrderDueDateDisplay {
  if (row.dueDates.length > 0) {
    return { lines: formatDomesticOrderDueDateLines(row.dueDates), borrowed: false };
  }

  const borrowed = foldBlankToNull(row.repairCaseCustomerRequestedDueDate);
  if (borrowed === null) return { lines: [], borrowed: false };
  return { lines: [borrowed], borrowed: true };
}

/**
 * 수리 건 상세정보의 `고객 요청 납기일` 칸에 그릴 것.
 *
 * `dueDate` 가 null 이면 양쪽 어디에도 날짜가 없다는 뜻이고, 화면이 "-"로
 * 그린다. `borrowed` 가 참이면 그 날짜는 **이 건에 적힌 값이 아니다.**
 */
export type RepairCaseRequestedDueDateDisplay = {
  dueDate: string | null;
  borrowed: boolean;
};

/**
 * 그 수리 건의 `고객 요청 납기일` 에 무엇을 그릴 것인가 — **이 건에 적힌 날짜가
 * 먼저, 없으면 연결된 내자 줄들의 납기요청일 중 가장 이른 하루**(파일 헤더).
 *
 * `domesticOrderDueDates` 는 **여러 내자 줄에 걸친 날짜를 통틀어 모은 한
 * 묶음**이다. 줄마다 먼저 접은 뒤 다시 고르지 않는다 — 그렇게 하면 "어느 줄의
 * 날짜인가"라는 뜻이 슬쩍 끼어들지만, 여기서 답하려는 물음은 "이 건에서 가장
 * 이른 날이 언제인가"다(pickEarliestDueDate 의 주석).
 *
 * 고르는 일을 그 함수에 그대로 맡기므로 **주간보고 `입고 요청일` 과 언제나 같은
 * 날짜**다. 이미 지난 날짜라도 그것이 가장 이르면 그것이고, 그 판단은 여기서
 * 다시 하지 않는다.
 */
export function resolveRepairCaseRequestedDueDate(row: {
  customerRequestedDueDate: string | null;
  domesticOrderDueDates: readonly string[];
}): RepairCaseRequestedDueDateDisplay {
  const own = foldBlankToNull(row.customerRequestedDueDate);
  if (own !== null) return { dueDate: own, borrowed: false };

  const borrowed = pickEarliestDueDate(row.domesticOrderDueDates);
  if (borrowed === null) return { dueDate: null, borrowed: false };
  return { dueDate: borrowed, borrowed: true };
}
