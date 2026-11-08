import { foldBlankToNull } from "./domestic-order-list";
import { isNotEarlierThan } from "./local/validation";

/**
 * ============================================================================
 * 내자 `납품일` ↔ 수리 건 `실제 출하일` — **그리기**와 **묶기** (2026-11-08)
 * ============================================================================
 * DB 도 React 도 여기 들어오지 않는다. requested-due-date-link.ts 와 **같은
 * 자리의 같은 모양**인 파일이고, 같은 이유로 순수 함수만 둔다 — 아래 규칙들은
 * 화면 넷(내자 표 · 내자 카드 · 기타건 현황 · 기타건 상세)과 저장 통로 셋(내자
 * 저장 · 수리 건 인수정보 · 출하 완료 전이)이 **같은 답을 내야** 하는 종류라,
 * 각자 안에 두면 한쪽만 고쳐지는 날이 오고 그날 같은 자료가 두 날짜로 보인다.
 *
 * ── 🔴 자리가 바뀌었다 — 납품일은 이제 **납기요청일 행에 달린다** ──────────
 * 사용자 요구 원문(2026-11-07): 「내자정리에서 납기 요청일을 여러줄로 두면,
 * 납품일, 납품자도 그 수에 맞게 설정할 수 있도록 … 납품일과 수리건 상세의 실제
 * 출하일이 서로 연동되도록」. 그래서 저장 구조가 이렇게 된다:
 *
 *   내자 정리 `납품일`·`납품자` ← domestic_order_due_dates.delivered_date / _by
 *                                  (납기요청일 **행마다 하나**, 1번 줄 ↔ 1번 줄)
 *   수리 건  `실제 출하일`      ← repair_cases.actual_shipment_date (**하나**)
 *
 * 🔴 **옛 자리는 `domestic_orders.delivered_date`·`delivered_by` 였고 지우지
 * 않았다**(사용자 결정 11 — PO 가 같은 DB 에서 그 칸을 쓴다). 다만 **A/S 는 그
 * 칸을 더 이상 그리지 않는다.** 이 파일의 함수들이 받는 타입 어디에도 그 칸이
 * 없는 것이 그 장치다 — `requested_due_date` 가 걸은 길과 같은 모양이고, 같은
 * 까닭이다: 같은 뜻이 두 자리에 살아 **화면에 동시에 보이면** 어느 쪽이 맞는지
 * 답할 길이 없다.
 *
 * ── 🔴 2026-09-11 의 결정이 뒤집힌 자리와 그대로인 자리 ────────────────────
 * 그때 정한 것은 「**연결된 줄의 납품일은 수리 건의 실제 출하일 하나뿐**이고,
 * 그 줄에 손으로 적은 값이 있어도 보지 않는다」였다(domestic-order-list.ts 의
 * resolveDomesticOrderDeliveredDate). 까닭은 **둘이 어긋나는 줄이 생기면 어느
 * 쪽이 맞는지 화면만 봐서는 알 길이 없다**였고, 그 걱정은 지금도 옳다.
 *
 * 🔴 뒤집힌 것은 **「그래서 한쪽만 보여 준다」가 아니라 「그래서 둘을 맞춘다」**
 * 로 답이 바뀐 것이다(사용자 결정 2: 연동은 양방향). 어긋남을 숨기는 대신 저장할
 * 때마다 같은 날짜로 맞추고, 맞출 수 없는 모양에서는 **조용히 넘기지 않고 사람에게
 * 말한다**(아래 NOT_LINKED 셋). 2026-10-30 납기요청일 묶기가 먼저 걸은 길이고,
 * 멈추는 자리의 모양까지 그대로 본떴다.
 *
 * 🔵 **빌려 그리기는 그대로 남는다.** 행에 아무것도 안 적힌 줄은 여전히 연결된
 * 수리 건의 실제 출하일을 대신 보여 주고, 거기에는 꼬리표가 붙는다(아래
 * DELIVERED_DATE_FROM_REPAIR_CASE_LABEL). 운영에 실제 출하일만 있고 내자 쪽은
 * 비어 있는 줄이 9줄 있었다(2026-11-07 실측) — 그 줄들은 **아무것도 옮기지
 * 않았는데도 화면에 보이는 날짜가 그대로다.**
 *
 * ── 🔴 멈추는 자리 다섯 ─────────────────────────────────────────────────
 *  ① **안 바뀐 저장은 아무 일도 하지 않는다.** 내자의 칸 편집은 어느 칸을 고쳐도
 *     줄 전체를 다시 보내므로(domestic-order-cell-edit.ts 헤더), 날짜가 그대로인
 *     저장까지 묶으면 발주서번호 하나 고친 저장이 수리 건의 출하일을 덮는다.
 *     그래서 아래 두 함수는 **고치기 전 값과 뒤 값을 함께 받아** 같으면 멈춘다.
 *  ② **지우는 쪽은 안 묶는다.** 내자에서 납품일을 비워도 수리 건의 출하일은
 *     그대로 두고, 출하 완료를 되돌려도 내자의 납품 기록은 그대로 둔다. 까닭은
 *     납기요청일 때와 같다 — **행에 사람이 적은 것이 함께 달려 있다**(납품자).
 *     그리고 수리 건 쪽 저장은 애초에 실제 출하일을 **비울 수 없다**
 *     (mutations/repair-cases.ts: 「실제 출하일은 비울 수 없습니다」) — 지우기를
 *     묶으면 이 통로가 저쪽이 막아 둔 문을 뒤로 여는 셈이 된다.
 *  ③ **행을 만들지도 지우지도 않는다.** 납기요청일 행이 없는 줄에는 **납품일을
 *     적을 자리가 없다**(그 표의 due_date 는 NOT NULL 이다 — 지어낼 납기일이
 *     없다). 그런 줄은 지금도 수리 건의 출하일을 빌려 그리고 있어 **화면에 보이는
 *     날짜가 어차피 같다.**
 *  ④ **어느 행인지 말할 수 없으면 멈추고 사람에게 알린다.** 한 수리 건에 내자
 *     줄이 여럿이거나 한 줄에 납품 기록이 여럿이면(분할 납품) 어느 날짜를 맞춰야
 *     하는지는 사람만 안다.
 *  ⑤ 🔴 **아직 출하 전인 건에는 날짜를 밀어 넣지 않는다.** 수리 건 쪽 저장이
 *     이미 그렇게 막고 있고(「아직 출하 완료되지 않은 건입니다. 실제 출하일은
 *     출하 완료 처리로 적힙니다.」), **우회하면 더 나쁜 일이 함께 일어난다**:
 *     `actual_shipment_date` 는 종 알림 넷의 침묵 스위치다(납기 임박 · 납기 역전 ·
 *     목표 출하일 미등록 · 납기 지연 — domain/shipment-finished.ts 의
 *     isRepairCaseShipmentFinished 를 그 넷이 함께 본다). 내자에서 적은 날짜가 그
 *     칸에 써지면 **그 건의 경보 넷이 조용히 꺼진다.** 오류가 아니라 「아무것도
 *     안 뜸」이라 아무도 신고하지 않는다.
 *
 * ── 방향 하나에만 있는 잣대 ──────────────────────────────────────────────
 * 수리 건의 실제 출하일에는 **인수일보다 이를 수 없다**는 잣대가 걸려 있고
 * (mutations/repair-cases.ts — 날짜 넷이 같이 쓴다), 내자 납품일에는 그런 잣대가
 * 없다. 그래서 **내자 → 수리 건** 방향만 그 잣대에 걸릴 수 있다. 🔴 우회하지
 * 않는다 — 그 건은 수리 건 쪽만 그대로 두고 사람에게 말한다. 잣대 자체는 베껴
 * 적지 않고 저쪽이 부르는 함수를 그대로 부른다(isNotEarlierThan).
 * ============================================================================
 */

/**
 * 내자 정리의 `납품일` 칸에 붙는 표시. 빌려 온 날짜 옆에만 붙는다.
 *
 * 짧아야 하는 자리다 — 22칼럼짜리 표의 한 칸이라 설명을 통째로 적으면 그 칼럼만
 * 넓어져 표가 옆으로 길어진다(납기요청일의 `수리 건 요청일` 과 같은 판단).
 *
 * 🔴 **「출하일」이라고 적는다 — 「납품일」이 아니다.** 빌려 온 값은 수리 건이 우리
 * 손을 떠난 날이고, 이 칸의 제 값은 사람이 적는 납품일이다. 둘은 운송이 끼면 며칠
 * 어긋나는 것이 정상이라(scripts/lib/delivered-date-sync-survey.ts 머리말), 같은
 * 이름으로 부르면 **빌려 왔다는 사실만 지워지는 것이 아니라 뜻까지 같아 보인다.**
 */
export const DELIVERED_DATE_FROM_REPAIR_CASE_LABEL = "수리 건 출하일";

/**
 * 내자 정리 쪽 설명. 표 머리말 · 카드 이름표 · 기타건 현황 · 기타건 상세가 **같은
 * 글자**를 title 로 나눠 쓴다 — 따로 적으면 언젠가 한쪽만 고쳐져 같은 칸이 화면마다
 * 다른 규칙으로 설명된다.
 *
 * 🔴 **옛 DELIVERED_DATE_NOTE 를 대신한다**(domain/domestic-order-display.ts).
 * 그 문장은 「연결된 줄의 납품일은 수리 건의 실제 출하일이고 표에서 못 고친다」고
 * 적고 있었는데, 2026-11-08 부터 **둘 다 사실이 아니다.**
 */
export const DOMESTIC_ORDER_DELIVERED_DATE_NOTE =
  `납품일·납품자는 납기요청일 **줄마다** 적습니다(1번 줄 ↔ 1번 줄). ` +
  `아무 줄에도 안 적힌 건은 연결된 수리 건의 실제 출하일을 대신 보여 주고, ` +
  `그 값에는 '${DELIVERED_DATE_FROM_REPAIR_CASE_LABEL}' 표시가 붙습니다. ` +
  `납품일을 고쳐 저장하면 연결된 수리 건의 실제 출하일도 같은 날짜로 맞춰집니다` +
  `(줄이나 납품 기록이 여럿이거나 아직 출하 전이면 맞추지 않고 알려 드립니다).`;

/** 수리 건 상세정보 쪽 설명. 위와 **거울이면서 같은 사실**이다. */
export const REPAIR_CASE_SHIPMENT_DATE_LINK_NOTE =
  `실제 출하일은 출하 완료 처리가 찍고, 그때 연결된 내자 정리의 납품일에도 같은 ` +
  `날짜가 적힙니다. 여기서 날짜를 고쳐 저장하면 그 납품일도 함께 바뀝니다` +
  `(내자 줄이나 납품 기록이 여럿이면 맞추지 않고 알려 드립니다).`;

/**
 * 내자 정리 한 줄의 `납품일` · `납품자` 칸에 그릴 것.
 *
 * 🔴 **둘을 한 함수가 함께 내놓는다.** 따로 두면 「무엇이 적혀 있는가」를 두 번
 * 판정하게 되고, 납품자만 적힌 줄(날짜는 아직 모름)에서 **두 칸의 줄 수가 어긋나
 * 표가 세로로 밀린다.** 이 칸들은 납기요청일 칸과 **자리가 맞아야 읽힌다** —
 * 1번 줄의 납기요청일 옆이 1번 줄의 납품일이다.
 *
 * `dates` · `people` 은 **행마다 하나**이고 길이가 같다. 안 적은 회차는 `null`
 * 이며, 화면이 "-"로 그린다 — 자료를 "-"로 바꾸는 일은 화면에서만 한다는 이
 * 저장소의 규칙 그대로다.
 *
 * ⚠️ **비고(note)를 글자에 섞지 않는다.** 납기요청일 칸이 바로 옆에서 같은 차례로
 * 비고를 이미 그리고 있어서, 여기에도 붙이면 같은 글이 한 줄에 세 번 나온다. 어느
 * 회차인지는 **자리**가 말한다.
 *
 * `borrowed` 가 참이면 `dates` 는 이 줄에 적힌 값이 아니라 연결된 수리 건의 실제
 * 출하일 하나다. 화면은 그때만 꼬리표를 붙인다.
 */
export type DomesticOrderDeliveryDisplay = {
  dates: (string | null)[];
  people: (string | null)[];
  borrowed: boolean;
};

/**
 * 이 함수가 보는 칸만 요구한다 — 목록 한 줄을 통째로 받게 해 두면 언젠가 옛
 * 칸(`domestic_orders.delivered_date`)이 여기 섞여 들어오고, 그때 이 규칙은 조용히
 * 달라진다(requested-due-date-link.ts 의 같은 판단).
 */
export type DomesticOrderDeliveryRow = {
  dueDates: readonly { deliveredDate: string | null; deliveredBy: string | null }[];
  /** 연결이 있는가. 🔴 출하일이 비었느냐로 가르면 안 된다(아래 주석). */
  repairCaseId: string | null;
  repairCaseActualShipmentDate: string | null;
};

/**
 * 그 줄의 `납품일`·`납품자` 칸에 무엇을 그릴 것인가 — **행에 적힌 것이 먼저,
 * 아무 행에도 없으면 연결된 수리 건의 실제 출하일**(파일 헤더).
 *
 * 행에 하나라도 적혀 있으면 그것이 전부다. 거기에 수리 건의 출하일을 섞어 붙이지
 * 않는다 — 섞으면 사람이 적어 넣은 1차분·2차분 사이에 아무도 적지 않은 날짜가
 * 끼어들고, 그 순간 이 칸은 「이렇게 보냈다」는 기록이기를 그만둔다.
 *
 * 🔴 **갈림은 「날짜 **또는** 납품자가 적혔는가」다.** 날짜만 보면, 「누가 보냈는지는
 * 아는데 언제인지 아직 모른다」는 줄에서 납품자 칸만 값이 있고 날짜 칸은 빌려 온
 * 값이 되어 **한 줄에 두 출처가 섞인다.**
 *
 * 🔴 **빌려 올지는 `repairCaseId` 로만 가른다.** 출하일이 null 인 것은 「연결이
 * 없다」와 「연결은 있는데 아직 안 나갔다」 둘 다라, 그것으로 가르면 뒤쪽 줄이
 * 조용히 다른 길로 샌다(옛 resolveDomesticOrderDeliveredDate 가 적어 둔 그 함정).
 *
 * 공백만 적힌 값은 없는 것으로 접는다 — 화면에는 빈칸으로 보이는데 「적혀 있다」로
 * 세어지는 줄이 생기지 않게 한다.
 */
export function resolveDomesticOrderDeliveryDisplay(
  row: DomesticOrderDeliveryRow
): DomesticOrderDeliveryDisplay {
  const dates = row.dueDates.map((entry) => foldBlankToNull(entry.deliveredDate));
  const people = row.dueDates.map((entry) => foldBlankToNull(entry.deliveredBy));
  const written = dates.some((value) => value !== null) || people.some((value) => value !== null);
  if (written) return { dates, people, borrowed: false };

  if (row.repairCaseId === null) return { dates: [], people: [], borrowed: false };
  const borrowed = foldBlankToNull(row.repairCaseActualShipmentDate);
  if (borrowed === null) return { dates: [], people: [], borrowed: false };
  return { dates: [borrowed], people: [null], borrowed: true };
}

/**
 * ============================================================================
 * 🔴 묶기 — 한쪽을 고쳐 저장하면 상대 칸도 같은 날짜가 된다
 * ============================================================================
 * 여기부터는 **그릴 값이 아니라 저장할 값**을 정한다. 묶는 일을 실제로 하는 곳은
 * 셋이고(db/mutations/domestic-orders.ts · db/mutations/repair-cases.ts ·
 * db/mutations/workflow-transitions.ts), **무엇을 할지 정하는 규칙은 이 묶음
 * 하나뿐**이다 — 세 통로가 규칙을 베껴 적으면 언젠가 하나만 고쳐지고, 그날
 * 「어느 쪽에서 고쳤느냐」에 따라 묶이기도 안 묶이기도 한다.
 *
 * 내놓는 것은 셋 중 하나다(납기요청일 묶기와 같은 모양):
 *
 *   NONE       — 할 일이 없다(안 바뀌었거나, 빌려 그리는 중이라 이미 같은 날짜다)
 *   WRITE      — 상대 칸을 이 날짜로 고친다
 *   NOT_LINKED — 묶을 수 없다. **까닭을 사람에게 말한다**(머리말 ④⑤)
 * ============================================================================
 */

/**
 * 묶음이 **어느 날짜를 가리키는지 말할 수 있는 모양인가.**
 *
 * 보는 것은 **납품 기록이 있는 행의 수**뿐이다 — 날짜 값도, 어느 줄의 것인지도 보지
 * 않는다. 「고칠 날짜가 꼭 하나인가」만이 물음이기 때문이다.
 *
 * 🔴 납기요청일 쪽의 같은 판정(resolveRequestedDueDateLinkShape)과 **세는 것이
 * 다르다** — 저쪽은 날짜 행 수를, 이쪽은 **납품 기록이 있는 행 수**를 센다. 한 줄에
 * 납기요청일이 셋인데 납품은 아직 하나만 했으면, 그 하나는 가리킬 수 있다. 숫자만
 * 받는 함수라 돌려 쓸 수는 있지만 그러면 타입 이름이 거짓말을 하게 되므로 따로 둔다.
 */
export type DeliveredLinkLine = { deliveredCount: number };

export type DeliveredLinkShape =
  /** 납품 기록이 하나도 없다. */
  | { kind: "NO_ROW" }
  /** 줄 하나 · 기록 하나. 가리킬 것이 분명하다. */
  | { kind: "SINGLE" }
  /** 줄이 여럿이거나 기록이 여럿이다. 사람만 안다. */
  | { kind: "AMBIGUOUS"; lineCount: number; deliveredCount: number };

export function resolveDeliveredLinkShape(
  lines: readonly DeliveredLinkLine[]
): DeliveredLinkShape {
  const deliveredCount = lines.reduce((sum, line) => sum + line.deliveredCount, 0);
  // 🔴 **기록 수를 줄 수보다 먼저 본다.** 줄이 여럿이어도 기록이 하나도 없으면 고를
  // 것이 없으니 「여럿이라 못 맞췄다」가 아니다 — 차례를 뒤집으면 아무 일도 없었던
  // 저장마다 알림이 떠, 진짜 경고가 그 소음에 묻힌다(납기요청일 쪽과 같은 까닭).
  if (deliveredCount === 0) return { kind: "NO_ROW" };
  // 기록을 가진 줄이 둘 이상이면 그것만으로 모호하다. 줄 수가 아니라 **기록을 가진
  // 줄 수**를 세는 것이 요점이다 — 같은 건에 붙은 다른 줄이 비어 있는 것은 아무
  // 문제도 아니다.
  const linesWithRecord = lines.filter((line) => line.deliveredCount > 0).length;
  if (linesWithRecord > 1 || deliveredCount > 1) {
    return { kind: "AMBIGUOUS", lineCount: linesWithRecord, deliveredCount };
  }
  return { kind: "SINGLE" };
}

/**
 * 묶지 못한 까닭 — **화면에 그대로 뜨는 글이다.**
 *
 * 「안 됐다」만 말하고 무엇이 안 됐는지 안 말하면, 사람은 저장 자체가 실패한 줄
 * 안다(실제로는 지금 보고 있는 쪽은 저장됐다).
 */
const AMBIGUOUS_REASON =
  "이 수리 건에는 내자 줄이 여럿이거나 한 줄에 납품 기록이 여럿입니다. 어느 날짜를 맞춰야 하는지는 사람만 알 수 있습니다.";

/** 수리 건에서 고쳤는데 **내자 쪽이 못 따라갔다.** */
export const DOMESTIC_ORDER_DELIVERED_NOT_LINKED_MESSAGE =
  `실제 출하일은 저장했습니다. 다만 ${AMBIGUOUS_REASON} ` +
  `내자 정리의 납품일은 그대로 두었으니, 내자 정리에서 직접 맞춰 주세요.`;

/** 내자에서 고쳤는데 **수리 건 쪽이 못 따라갔다.** */
export const REPAIR_CASE_SHIPMENT_NOT_LINKED_MESSAGE =
  `납품일은 저장했습니다. 다만 ${AMBIGUOUS_REASON} ` +
  `수리 건의 실제 출하일은 그대로 두었으니, 수리 건 상세에서 직접 맞춰 주세요.`;

/**
 * 🔴 아직 출하 완료되지 않은 건이라 수리 건에 넣지 못했다(머리말 ⑤).
 *
 * **경보가 꺼진다는 사실까지 적는다.** 「반영하지 못했습니다」만 적으면 사람은 그냥
 * 한 칸이 안 채워진 줄 알고 수리 건 상세에서 손으로 적으려 하는데, 그쪽도 같은
 * 까닭으로 막혀 있다. 어디로 가야 하는지를 함께 말한다.
 */
export const REPAIR_CASE_SHIPMENT_NOT_SHIPPED_MESSAGE =
  "납품일은 저장했습니다. 다만 이 수리 건은 아직 출하 완료 처리가 되지 않아 " +
  "실제 출하일에는 반영하지 못했습니다. 출하 완료 처리를 하면 그 날짜가 함께 적힙니다.";

/**
 * 내자에서 고친 날짜가 **인수일보다 일러** 수리 건에 넣지 못했다.
 *
 * 🔴 여기서만 쓰는 잣대가 아니라 수리 건 저장이 날짜 넷에 똑같이 거는 잣대다.
 * 우회하면 사람이 수리 건 상세에서는 적을 수 없는 날짜가 내자를 거쳐 들어간다.
 */
export const REPAIR_CASE_SHIPMENT_BLOCKED_BY_RECEIVED_AT_MESSAGE =
  "납품일은 저장했습니다. 다만 그 날짜가 수리 건의 인수일보다 일러 " +
  "수리 건의 실제 출하일에는 반영하지 못했습니다(인수일보다 이른 날짜는 적을 수 없습니다).";

/**
 * 이번 저장이 **상대 쪽 날짜까지 맞췄는가.** mutation 의 성공 결과에 실려 서버
 * 액션을 그대로 지나 화면까지 간다.
 *
 * 🔴 `linked: false` 를 **조용히 버리지 마라.** 그때 사람이 보고 있는 화면은
 * 「저장했습니다」만 떠 있고, 반대쪽은 옛 날짜 그대로다.
 */
export type DeliveredDateLinkOutcome =
  | { linked: true }
  | {
      linked: false;
      reason: "AMBIGUOUS" | "NOT_SHIPPED" | "BLOCKED_BY_RECEIVED_AT";
      message: string;
    };

/** 무엇을 할 것인가 — 부르는 쪽(mutation)이 이 값만 보고 움직인다. */
export type DeliveredDateLinkPlan =
  | { kind: "NONE" }
  | { kind: "WRITE"; date: string }
  | { kind: "NOT_LINKED"; outcome: Extract<DeliveredDateLinkOutcome, { linked: false }> };

function notLinked(
  reason: "AMBIGUOUS" | "NOT_SHIPPED" | "BLOCKED_BY_RECEIVED_AT",
  message: string
): DeliveredDateLinkPlan {
  return { kind: "NOT_LINKED", outcome: { linked: false, reason, message } };
}

/**
 * **내자 → 수리 건** — 납품일을 고쳐 저장할 때 수리 건의 실제 출하일을 어떻게 할
 * 것인가.
 *
 * 멈추는 자리가 넷이다(머리말 ①②④⑤ 그대로):
 *
 *  · **안 바뀌었다** — 내자 저장은 줄 전체를 다시 보내므로 납품일을 건드리지 않은
 *    저장도 여기까지 온다. 차례는 보지 않는다 — 1차분과 2차분의 순서만 바꾼 저장은
 *    **날짜가 안 바뀐 저장**이다.
 *  · **다 지웠다**(next 가 비었다) — 🔴 수리 건의 출하일을 **지우지 않는다**(머리말 ②).
 *  · **어느 기록인지 모르겠다**(AMBIGUOUS) — 말한다.
 *  · **아직 출하 전이다** — 🔴 밀어 넣지 않는다(머리말 ⑤). 그리고 **인수일 잣대**.
 */
export function resolveRepairCaseShipmentWriteThrough(input: {
  /** 이 저장이 고친 내자 줄의 납품일 — 고치기 전과 뒤. 새로 만든 줄이면 앞은 빈 목록이다. */
  editedLine: { previousDeliveredDates: readonly string[]; nextDeliveredDates: readonly string[] };
  /** 같은 수리 건에 붙은 **다른** 살아 있는 줄들. 없으면 빈 목록이다. */
  otherLines: readonly DeliveredLinkLine[];
  /** 그 수리 건에 지금 적혀 있는 실제 출하일. null 이면 아직 출하 전이다. */
  repairCaseActualShipmentDate: string | null;
  /** 그 수리 건의 인수일. 잣대는 저쪽 저장과 같은 함수로 잰다. */
  receivedAt: string;
}): DeliveredDateLinkPlan {
  if (sameDateSet(input.editedLine.previousDeliveredDates, input.editedLine.nextDeliveredDates)) {
    return { kind: "NONE" };
  }

  const shape = resolveDeliveredLinkShape([
    { deliveredCount: input.editedLine.nextDeliveredDates.length },
    ...input.otherLines,
  ]);
  // 다 지운 저장이다 — 머리말 ②. 다른 줄에 기록이 남아 있으면 NO_ROW 가 아니므로
  // 아래 갈래로 내려가고, 그때는 그 기록이 가리키는 날짜가 그대로 쓰인다.
  if (shape.kind === "NO_ROW") return { kind: "NONE" };
  if (shape.kind === "AMBIGUOUS") {
    return notLinked("AMBIGUOUS", REPAIR_CASE_SHIPMENT_NOT_LINKED_MESSAGE);
  }

  // SINGLE 이면 기록이 꼭 하나다. 그 하나가 **이 줄의 것이 아닐 수도 있다** — 이
  // 줄을 비우고 다른 줄에 하나만 남은 저장이 그 모습이다. 그때 맞출 날짜는 남아
  // 있는 그 기록이어야 하는데 이 함수에는 그 값이 없다. 그래서 **이 줄에 기록이
  // 남아 있을 때만** 쓴다 — 없으면 「지운 저장」과 같은 자리에 선다(머리말 ②).
  const next = input.editedLine.nextDeliveredDates[0];
  if (next === undefined) return { kind: "NONE" };

  const own = foldBlankToNull(input.repairCaseActualShipmentDate);
  // 🔴 아직 안 나간 건이다 — 머리말 ⑤(경보 넷이 조용히 꺼진다).
  if (own === null) return notLinked("NOT_SHIPPED", REPAIR_CASE_SHIPMENT_NOT_SHIPPED_MESSAGE);
  if (next === own) return { kind: "NONE" };
  if (!isNotEarlierThan(next, input.receivedAt)) {
    return notLinked(
      "BLOCKED_BY_RECEIVED_AT",
      REPAIR_CASE_SHIPMENT_BLOCKED_BY_RECEIVED_AT_MESSAGE
    );
  }
  return { kind: "WRITE", date: next };
}

/**
 * **수리 건 → 내자** — 실제 출하일이 적히거나 바뀔 때 내자의 납품일 행을 어떻게 할
 * 것인가. 부르는 곳이 둘이고 그 둘이 `trigger` 로 갈린다.
 *
 * ── 🔴 `trigger` 가 가르는 것은 **덮어쓸 것인가** 하나뿐이다 ────────────────
 *  · `"SHIPMENT_COMPLETED"` — 출하 완료 전이가 **자동으로** 찍는 자리다. 이미 사람이
 *    적어 둔 납품일이 있으면 **건드리지 않는다.** 그 값은 「실제로 보낸 날」로 사람이
 *    고른 날짜이고, 운송이 끼면 출하일과 며칠 어긋나는 것이 정상이라
 *    (scripts/lib/delivered-date-sync-survey.ts 머리말) 자동 처리가 덮으면 그 사실이
 *    말없이 사라진다. 🔵 사용자 결정 6·7 — 「납품일이 하나면 자동으로 찍고, 여럿이면
 *    안 찍는다」가 아래 SINGLE/AMBIGUOUS 갈림 그대로다.
 *  · `"MANUAL_EDIT"` — 사람이 수리 건 상세에서 실제 출하일을 **고쳐 적은** 자리다.
 *    그때는 「이 건은 이 날 나갔다」를 사람이 다시 말한 것이라 내자 쪽도 그 날짜로
 *    맞춘다. 덮지 않으면 사용자 결정 2(양방향)가 한 방향만 도는 셈이 된다.
 *
 * 나머지 멈추는 자리는 위 짝과 같다:
 *  · **안 바뀌었다** — 인수정보 폼은 고칠 수 있는 칸을 늘 함께 보낸다.
 *  · **지웠다**(출하 완료 되돌리기) — 🔴 **내자의 납품 기록을 지우지 않는다**(머리말 ②).
 *  · **달 행이 없다**(NO_ROW) — 🔴 **행을 만들지 않는다**(머리말 ③). 그 줄은 지금
 *    수리 건의 출하일을 빌려 그리는 중이라 보이는 날짜가 이미 같다.
 *  · **행이 여럿이다**(AMBIGUOUS) — 말한다.
 */
export function resolveDomesticOrderDeliveredWriteThrough(input: {
  /** 이 저장 **전에** 수리 건에 적혀 있던 실제 출하일. */
  previousActualShipmentDate: string | null;
  /** 이 저장으로 적히는 값. null 이면 지웠다는 뜻이다(출하 완료 되돌리기). */
  nextActualShipmentDate: string | null;
  /** 어느 통로에서 왔는가 — 위 머리말. */
  trigger: "SHIPMENT_COMPLETED" | "MANUAL_EDIT";
  /**
   * 그 수리 건에 붙은 **살아 있는** 내자 줄 전부와, 줄마다 달린 납기요청일 행의
   * 납품일. 🔴 **행 자체를 받는다** — 「몇 개인가」만 받으면 「이미 적혀 있는가」를
   * 알 수 없어 위 `trigger` 의 갈림을 여기서 못 한다.
   */
  lines: readonly { dueDateRows: readonly { deliveredDate: string | null }[] }[];
}): DeliveredDateLinkPlan {
  const previous = foldBlankToNull(input.previousActualShipmentDate);
  const next = foldBlankToNull(input.nextActualShipmentDate);
  if (previous === next) return { kind: "NONE" };
  if (next === null) return { kind: "NONE" };

  // 🔴 여기서 세는 것은 **납품 기록**이 아니라 **달 수 있는 행**이다 — 비어 있는
  // 행이야말로 찍어야 할 자리이기 때문이다. 위 resolveDeliveredLinkShape 를 쓰지
  // 않는 까닭이 그것이고, 숫자만 넘겨 돌려 쓰면 이름이 거짓말을 한다.
  const rows = input.lines.flatMap((line) => line.dueDateRows);
  const linesWithRow = input.lines.filter((line) => line.dueDateRows.length > 0).length;
  if (rows.length === 0) return { kind: "NONE" };
  if (linesWithRow > 1 || rows.length > 1) {
    return notLinked("AMBIGUOUS", DOMESTIC_ORDER_DELIVERED_NOT_LINKED_MESSAGE);
  }

  const current = foldBlankToNull(rows[0].deliveredDate);
  if (current === next) return { kind: "NONE" };
  // 자동으로 찍는 자리는 **빈 행에만** 쓴다(위 trigger 머리말).
  if (input.trigger === "SHIPMENT_COMPLETED" && current !== null) return { kind: "NONE" };
  return { kind: "WRITE", date: next };
}

/**
 * 두 날짜 묶음이 **같은 날짜들인가.** 차례는 보지 않는다. 같은 날짜가 두 행에 적힌
 * 줄도 있으므로 집합이 아니라 **센 것**으로 견준다 — 행 하나를 지운 저장을
 * 「안 바뀜」으로 읽으면 안 된다(requested-due-date-link.ts 의 같은 함수와 같다).
 */
function sameDateSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}
