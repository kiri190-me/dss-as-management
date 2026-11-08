/**
 * ============================================================================
 * 내자 정리 — **회차를 사람 말로 부르는 자리** (2026-11-08)
 * ============================================================================
 * 「1차 · 납기 2026-01-20 (1차분)」. 납기요청일 행 하나를 가리키는 이 한 줄을
 * **여기 한 곳에서만** 만든다.
 *
 * ── 🔴 왜 한 곳이어야 하는가 ────────────────────────────────────────────
 * 같은 행을 부르는 자리가 2026-11-08 에 **넷**이 되었다:
 *  1. 회차별 납품 편집칸의 줄 이름표(DomesticOrderDeliveriesCell — 이 글자가 처음
 *     태어난 자리다).
 *  2. 🔴 출하 승인 요청 창의 **드롭다운**(사용자 결정 12 — 「어느 납기 요청일에 관한
 *     출하승인 요청인지 선택」).
 *  3. [승인] 탭의 회차별 카드 머리.
 *  4. 회차별 [완료 처리] 단추와, 그 단추가 막혔을 때의 안내 문장.
 *
 * 두 화면이 같은 줄을 다른 말로 부르면 사람은 그것이 같은 회차인지 알 수 없다 —
 * 드롭다운에서 「2차 · 납기 2026-02-15」를 골라 승인을 올렸는데 완료 단추 옆에는
 * 「2번째 납기일」이라고 적혀 있으면, 그 둘이 같은 것이라는 보장은 어디에도 없다.
 * 이름표를 글자로 다시 적지 않는 규칙(DOMESTIC_ORDER_APPROVAL_LABEL)과 같은 자리의
 * 같은 판단이다.
 *
 * ── 🔴 번호는 **차례**(`display_order`)다 ───────────────────────────────
 * 1부터 센다. 저장이 언제나 목록 index + 1 로 적으므로(mutations/domestic-orders.ts
 * 의 replaceDueDates) 화면에 보이는 N 번째가 곧 DB 의 `display_order = N` 이고,
 * 승인 행이 회차를 가리키는 값(`repair_case_approvals.due_date_row_order`)도 같은
 * 번호다. 🔴 **그래서 이 번호는 꾸밈이 아니라 열쇠다** — 「1차」를 「첫 번째」로
 * 바꿔 적는 것은 괜찮지만, 번호 자체를 날짜순으로 다시 매기면 안 된다(차례가 곧
 * 뜻이라는 것이 그 표의 설계다 — schema 의 display_order 주석).
 *
 * ── DB 도 React 도 들어오지 않는다 ──────────────────────────────────────
 * 순수 함수뿐이다. 서버(알림 문구·거절 문장)와 클라이언트(드롭다운·단추)가 같은
 * 함수를 부를 수 있어야 해서 `server-only` 도 `"use client"` 도 없다.
 * ============================================================================
 */

/**
 * 날짜가 비어 있는 회차를 부르는 말. 🔴 편집 중에는 **실제로 빈 칸이 있다** —
 * 사람이 [납기요청일 추가]를 누르고 아직 날짜를 안 적은 줄이 그렇다. 그때 빈
 * 문자열을 그대로 두면 「1차 · 납기 」로 끝나 글이 잘린 것처럼 보인다.
 */
export const DUE_DATE_ROW_NO_DATE_LABEL = "(날짜 없음)";

/**
 * 🔴 **납기요청일 행이 하나도 없는 기타건**의 유일한 단위를 부르는 말.
 *
 * 그런 줄이 드물지 않다 — 개발 DB 실측(2026-11-08)으로 살아 있는 기타건 15건 중
 * **11건**이 납기요청일 0행이다. 그 줄에도 승인 단위는 하나 있어야 하고
 * (domain/domestic-order-approval-rules.ts 의 domesticOrderApprovalUnitCount),
 * 그 하나를 「1차」라고 부르면 **있지도 않은 회차를 가리키는 말**이 된다.
 *
 * 🔵 이 글자가 화면에 보이는 자리는 거의 없다 — 단위가 하나뿐인 줄에서는 드롭다운도
 * 회차 머리도 뜨지 않기 때문이다(그것이 「납기요청일이 하나뿐인 기타건은 지금과
 * 똑같이 보인다」의 근거다). 알림이나 거절 문장이 이름을 꼭 필요로 할 때만 쓰인다.
 */
export const DUE_DATE_ROW_WHOLE_LINE_LABEL = "납기요청일 없음";

/** 이름표를 만드는 데 필요한 만큼의 행 하나. 🔴 납품·완료는 보지 않는다. */
export type DomesticOrderDueDateLabelRow = {
  /** "YYYY-MM-DD". 편집 중에는 빈 문자열일 수 있다(위 상수). */
  dueDate: string | null;
  /** "1차분" 같은 짧은 메모. 여러 날짜를 구분하는 유일한 단서다. */
  note: string | null;
};

/**
 * 「1차 · 납기 2026-01-20 (1차분)」.
 *
 * 🔴 **납기요청일을 번호와 함께 적는다.** 번호만 적으면 사람이 표의 납기요청일 칸과
 * 눈으로 짝을 맞춰야 하고, 편집 중에는 그 칸이 편집칸에 가려 있을 수도 있다
 * (DomesticOrderDeliveriesCell 이 처음 그렇게 정한 까닭 그대로다).
 *
 * @param rowOrder 1부터. `display_order` 와 같은 값이다.
 */
export function domesticOrderDueDateRowLabel(
  rowOrder: number,
  row: DomesticOrderDueDateLabelRow
): string {
  const dueDate = (row.dueDate ?? "").trim();
  const shown = dueDate === "" ? DUE_DATE_ROW_NO_DATE_LABEL : dueDate;
  const note = (row.note ?? "").trim();
  return note === ""
    ? `${rowOrder}차 · 납기 ${shown}`
    : `${rowOrder}차 · 납기 ${shown} (${note})`;
}

/** 승인·완료가 붙는 **단위 하나**. 회차 번호와 그 회차를 부르는 말. */
export type DomesticOrderDueDateUnit = {
  /** 1부터. `display_order` · `due_date_row_order` 와 같은 번호다. */
  rowOrder: number;
  label: string;
};

/**
 * 그 기타건의 **승인·완료 단위 전부** — 차례대로.
 *
 * 🔴 **행이 0개여도 단위는 하나다.** 까닭은 DUE_DATE_ROW_WHOLE_LINE_LABEL 주석과
 * domain/domestic-order-approval-rules.ts 의 domesticOrderApprovalUnitCount 에 있다.
 * 여기서 빈 목록을 돌려주면 납기요청일 없는 기타건 11건이 승인도 완료도 할 수 없는
 * 줄이 된다.
 *
 * 🔴 **행 목록은 차례대로 들어와야 한다**(조회가 display_order 로 정렬해 내려준다).
 * 자리(index)가 곧 번호이므로, 뒤섞인 목록을 넘기면 번호가 엉뚱하게 붙는다.
 */
export function domesticOrderDueDateUnits(
  rows: readonly DomesticOrderDueDateLabelRow[]
): DomesticOrderDueDateUnit[] {
  if (rows.length === 0) {
    return [{ rowOrder: 1, label: DUE_DATE_ROW_WHOLE_LINE_LABEL }];
  }
  return rows.map((row, index) => ({
    rowOrder: index + 1,
    label: domesticOrderDueDateRowLabel(index + 1, row),
  }));
}
