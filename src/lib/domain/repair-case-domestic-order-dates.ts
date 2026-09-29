import { pickWeeklyReportOrderDates, type WeeklyReportOrderDates } from "./weekly-report";

/**
 * ============================================================================
 * 수리 건 상세 「기본 정보」 — 내자 정리에서 따라오는 두 날짜
 * ============================================================================
 * DB 도 React 도 여기 들어오지 않는다. requested-due-date-link.ts ·
 * weekly-report.ts 와 같은 자리의 파일이고, 같은 이유로 순수 함수만 둔다 —
 * 0개·1개·N개를 가르는 판정을 화면 안에 흩뿌리면 시험할 방법이 브라우저를
 * 띄우는 것밖에 남지 않는다.
 *
 * ── ⚠️ 여기서 내놓는 것은 **그릴 값**이다 ───────────────────────────────
 * 두 날짜의 집은 `domestic_orders` 다(schema/domestic-orders.ts 의
 * quote_issued_date · order_issued_date). 수리 건 쪽에는 이 두 값을 담을 칸이
 * 없고, 만들지도 않는다 — 저장은 언제나 그 내자 줄의 원본 칼럼으로 간다.
 *
 * 🔴 **접은 값을 다른 줄에 저장하면 안 된다.** 2026-09-29 부터 이 구역에서 두
 * 날짜를 고칠 수 있게 됐고, 그때 편집칸을 채우는 것이 아래 resolve… 가 **여럿
 * 중 하나를 골라 접은** 값이다. 그 값이 다른 줄에 저장되면 그 줄에 박제되고,
 * 그때부터 "일부러 다르게 적었다"와 "그냥 안 건드렸다"를 구분할 수 없다
 * (domestic-order-cell-edit.ts 헤더의 함정 ②, requested-due-date-link.ts 헤더의
 * 같은 규칙). 그래서 **줄이 하나일 때와 없을 때만 편집이 열린다** — 그 판정은
 * 이 파일이 아니라 domestic-order-issue-date-edit.ts 가 갖고, 화면과 서버가
 * 함께 부른다. 줄이 여럿이면 양쪽 다 막는다.
 *
 * ⚠️ 그러므로 이 파일의 함수는 **저장하는 쪽에서 부르지 않는다**(시험이 그것을
 * 훑는다 — 이 파일 옆 .test.ts 의 '저장하는 쪽은 이 모듈을 쓰지 않는다'). 저장
 * payload 에 실리는 값은 화면이 **그 줄 하나**에서 읽은 값이지, 접는 함수의
 * 출력이 서버로 흘러 들어가는 것이 아니다.
 *
 * ── ⚠️ 여럿 중 하나를 고르는 일은 여기서 새로 정하지 않는다 ─────────────
 * 한 수리 건에 내자 줄이 **여럿일 수 있다**(분할 발주 — repair_case_id 에 유일
 * 제약이 없다. queries/domestic-orders.ts 의 같은 주석). 그래서 칸이 둘뿐인 이
 * 구역은 하나로 접어야 하는데, 그 규칙은 주간보고 상세표가 이미 답해 두었다:
 * **발주발행일이 가장 이른 줄, 어느 줄에도 발주일이 없으면 견적발행일이 가장
 * 이른 줄**(weekly-report.ts 의 pickWeeklyReportOrderDates). 규칙을 베껴 적지
 * 않고 **그 함수를 그대로 부른다** — 같은 자료를 두 화면이 다른 날짜로 보여
 * 주면 어느 쪽도 믿을 수 없게 된다.
 *
 * 🔴 고객 포털은 **다른 규칙**을 쓴다(queries/domestic-orders.ts 의
 * listQuoteInfoForRepairCases — 견적발행일이 가장 **늦은** 줄). 재견적이 나갔다면
 * 마지막 것이 지금 유효한 값이라는 그쪽 판단이고, 이 구역이 맞출 상대가
 * 아니다.
 * ============================================================================
 */

/**
 * 이 구역이 읽는 내자 줄 하나 — 두 날짜뿐이다.
 *
 * 주간보고가 쓰는 타입을 그대로 쓴다. 같은 모양을 한 벌 더 적으면 고르는 함수에
 * 넘길 때만 맞춰 주는 변환이 끼어들고, 그 변환이 언젠가 한쪽 값을 떨어뜨린다.
 */
export type RepairCaseDomesticOrderRow = WeeklyReportOrderDates;

/**
 * 화면에 그리는 이름. **주간보고 상세표의 머리말과 같은 글자**다
 * (components/dashboard/WeeklyReportScreen.tsx 의 `<th>`). 같은 값이 두 화면에서
 * 다른 이름으로 불리면 사람이 다른 값으로 읽는다.
 *
 * 주간보고 쪽은 표 머리말에 글자가 그대로 박혀 있어 여기서 불러올 수 없다 —
 * 대신 시험이 그 파일의 원본을 읽어 두 글자가 같은지 대조한다
 * (components/repair-cases/detail/domestic-order-dates-section.test.ts).
 */
export const DOMESTIC_ORDER_QUOTE_ISSUED_DATE_LABEL = "견적서 발행일";

/**
 * 칼럼은 `date` 라 시각이 없다 — 그래서 `일시`가 아니라 `발행일`이다(2026-09-29
 * 사용자 결정). 주간보고 상세표의 머리말도 같은 조각에서 함께 고쳤고, 위 상수와
 * 마찬가지로 시험이 두 화면의 글자를 대조한다.
 */
export const DOMESTIC_ORDER_PO_ISSUED_DATE_LABEL = "PO 발행일";

/** 구역 제목. 어디서 온 값인지를 제목이 먼저 말한다. */
export const DOMESTIC_ORDER_DATES_SECTION_TITLE = "내자 정리 발행일";

/**
 * 제목에 마우스를 올렸을 때 뜨는 설명. 값이 이 건에 적힌 것이 아니라는 것과,
 * 줄이 여럿일 때 어느 줄인지를 한 줄로 말한다 — 화면에 보이는 날짜가 왜 그
 * 날짜인지 코드를 열지 않고 답할 수 있어야 한다.
 */
export const DOMESTIC_ORDER_DATES_SECTION_NOTE =
  `연결된 내자 정리 줄에서 가져온 날짜입니다. 줄이 여럿이면 주간보고와 같은 규칙으로 ` +
  `한 줄을 고릅니다 — 발주발행일이 가장 이른 줄, 어느 줄에도 발주발행일이 없으면 ` +
  `견적발행일이 가장 이른 줄입니다.`;

/** 줄이 하나도 없을 때의 안내. 빈칸만 남기면 자료가 없는 것인지 덜 그려진 것인지 알 수 없다. */
export const DOMESTIC_ORDER_DATES_NONE_NOTE = "내자 정리에 줄이 아직 없습니다.";

/** 내자 정리 목록 주소. 이 구역에서 나가는 유일한 길이다. */
export const DOMESTIC_ORDER_LIST_HREF = "/domestic-orders";

/**
 * 줄이 여럿일 때 붙는 링크의 글자. 아래 안내 앞부분과 **이어져 한 문장**이
 * 된다 — "내자 줄이 3개입니다 — 내자 정리에서 보세요".
 */
export const DOMESTIC_ORDER_LIST_LINK_TEXT = "내자 정리에서 보세요";

/**
 * 줄이 여럿일 때의 안내 앞부분. 뒤에 위 링크가 이어진다.
 *
 * 개수를 적는 이유: 이 구역은 그중 한 줄만 그린다. 몇 줄이 있는지 말하지 않으면
 * 보이는 두 날짜가 이 건의 전부인 줄로 읽힌다.
 */
export function formatMultipleDomesticOrderRowsNotice(rowCount: number): string {
  return `내자 줄이 ${rowCount}개입니다 — `;
}

/**
 * 이 구역이 그릴 것.
 *
 * `kind` 는 세 경우를 가르는 유일한 판정이다 — 화면은 이 값만 보고 갈라지고,
 * `rowCount` 로 다시 세지 않는다.
 */
export type RepairCaseDomesticOrderDatesDisplay = WeeklyReportOrderDates & {
  /** 연결된 내자 줄 수(지워지지 않은 줄만 — 조회가 이미 걸러 온다). */
  rowCount: number;
  /**
   * NONE  — 줄이 없다. 두 칸은 빈 값이고 안내 한 줄이 붙는다.
   * SINGLE — 줄이 하나. 두 칸이 그 줄의 값이다(비어 있는 날짜는 화면이 "-").
   * MULTIPLE — 줄이 여럿. 두 칸은 **고른 한 줄**의 값이고 안내와 링크가 붙는다.
   */
  kind: "NONE" | "SINGLE" | "MULTIPLE";
};

/**
 * 그 수리 건의 내자 발행일 구역에 무엇을 그릴 것인가.
 *
 * 접는 일은 **한 줄도 직접 하지 않는다** — pickWeeklyReportOrderDates 에 그대로
 * 넘긴다(파일 헤더). 여기서 하는 일은 세 경우를 가르는 것뿐이다.
 *
 * 두 날짜를 각각 다른 줄에서 뽑지 않는 것도 그 함수의 약속이다 — 따로 뽑으면
 * 화면의 견적일과 발주일이 서로 다른 발주 건의 것이 된다.
 */
export function resolveRepairCaseDomesticOrderDates(
  rows: readonly RepairCaseDomesticOrderRow[]
): RepairCaseDomesticOrderDatesDisplay {
  const picked = pickWeeklyReportOrderDates(rows);
  return {
    quoteIssuedDate: picked.quoteIssuedDate,
    orderIssuedDate: picked.orderIssuedDate,
    rowCount: rows.length,
    kind: rows.length === 0 ? "NONE" : rows.length === 1 ? "SINGLE" : "MULTIPLE",
  };
}
