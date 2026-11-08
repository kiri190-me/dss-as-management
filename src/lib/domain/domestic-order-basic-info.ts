import {
  dash,
  formatAmount,
  NO_ORDER_DATE_LABEL,
  paymentLabel,
} from "./domestic-order-display";
import {
  DOMESTIC_ORDER_DUE_DATE_LINK_NOTE,
  DUE_DATE_FROM_REPAIR_CASE_LABEL,
  resolveDomesticOrderDueDateDisplay,
} from "./requested-due-date-link";
import {
  DELIVERED_DATE_FROM_REPAIR_CASE_LABEL,
  DOMESTIC_ORDER_DELIVERED_DATE_NOTE,
} from "./delivered-date-link";

/**
 * ============================================================================
 * 「기타건 상세」의 **기본정보 탭**에 무엇을 어떤 글자로 적는가 (2026-11-06)
 * ============================================================================
 * 사용자 요구 그대로: 「기타건 상세에 [기본정보]탭도 만들어줘. 거기에 견적서 번호,
 * 내자정리의 내용들을 한눈에 볼 수 있도록」 · 「기본정보를 첫화면으로 해줘」.
 *
 * ── 🔴 값을 여기서 새로 정하지 않는다 ───────────────────────────────────
 * 이 파일이 쓰는 것은 **목록이 이미 그리는 그 값**이다(queries 의
 * DomesticOrderListItem — `modelName` · `displayQuoteNumber` · `displayDeliveredDate`
 * 처럼 매퍼가 이미 고른 칸). 「이 줄의 값이 먼저인가 수리 건의 값이 먼저인가」,
 * 「연결된 견적서가 이기는 칸은 무엇인가」 같은 판단을 여기서 한 줄이라도 다시
 * 적으면, 같은 줄이 목록과 상세에서 다른 값으로 보이는 날이 온다 — [형식]을 눌러
 * 들어온 화면이 방금 본 줄과 다른 말을 하면 사람은 어느 쪽도 믿을 수 없다.
 *
 * 🔴 그래서 받는 타입도 **DomesticOrderListItem 그대로**다. 칸을 골라 받는 좁은
 * 타입을 새로 적으면, 칸이 하나 늘었을 때 여기만 조용히 빠진다.
 *
 * ── 왜 화면이 아니라 여기인가 ───────────────────────────────────────────
 * 「어느 칸이 어느 묶음에 몇 개 들어가는가」는 **값으로 잴 수 있는 사실**이다.
 * JSX 안에 늘어놓으면 그것을 확인할 방법이 브라우저를 띄우는 것밖에 없고, 칸 하나가
 * 빠져도 아무 데서도 티가 나지 않는다(목록의 CARD_FIELD_GROUPS 가 같은 까닭으로
 * 화면 안의 상수로 서 있지만, 거기는 `of` 가 마디를 돌려줘 떼어 낼 수 없었다).
 *
 * ── 🔴 **박스 둘** 로 접었다 (2026-11-07) ──────────────────────────────
 * 사용자 요구 그대로다: 「기본정보 텝에서 **[제품, 견적. 납품]을 한 박스**
 * **[줄, 발주, 정산, 기타]를 한 박스**로 해서 **간결하게** 정리되도록 해줘」.
 * 하루 전까지는 묶음 여섯이 각각 상자 하나였다(`줄`·`발주`·`제품`·`견적 · 납품`·
 * `정산`·`기타`).
 *
 * 🔴 **박스 이름은 사용자가 쓴 낱말 그대로**다 — 「제품 · 견적 · 납품」과
 * 「줄 · 발주 · 정산 · 기타」. 새 이름을 지으면(예: 「거래」·「정산 정보」) 안에 무엇이
 * 들어 있는지 이름이 더 이상 말해 주지 않고, 사용자가 말한 묶음과 화면의 묶음이 다른
 * 말이 되어 다음 요구를 주고받을 때 서로 다른 것을 가리키게 된다.
 *
 * 🔴 **안의 소제목은 없앴다.** 박스 이름이 안의 묶음 이름을 **전부** 적고 있어서,
 * 소제목을 남기면 같은 글자를 두 번 쓰는 것이 된다 — 사용자가 말한 것은 「간결하게」다.
 * 칸 이름(발주서번호 · 금액(VAT별도) …)이 저마다 무엇인지 이미 말한다. 🔵 그래서
 * 「제품」 묶음이 칸 하나(형식)만 남은 것도 문제가 되지 않는다 — 소제목이 없으니 그
 * 칸은 박스 A 의 첫 칸으로 설 뿐이다.
 *
 * ── 칸의 차례는 목록의 카드와 같다 ──────────────────────────────────────
 * 박스 안의 차례는 예전 묶음 차례를 그대로 이어 붙인 것이고, 그 차례는 목록 카드의
 * CARD_FIELD_GROUPS 와 같다 — 같은 줄을 보는 두 화면이 칸을 다른 순서로 늘어놓으면
 * 눈이 매번 다시 길을 찾는다. 맨 앞의 `줄` 묶음만 여기에 더 있다: 목록에서는 고객사가
 * 칸이 아니라 묶음 소제목에 있어서, 상세에서는 적을 자리가 따로 필요하다.
 *
 * ── 🔴 **이 탭에서만 빠지는 다섯 칸** (2026-11-07) ──────────────────────
 * 사용자 지정: 「[제품]에서 **L/N, S/N, 고장내역**은 없어도 돼」 · 「[줄]에서
 * **순번, 인수번호**는 없어도 돼」.
 *
 * 🔴 **빠지는 것은 이 탭뿐이다.** 다섯 칸은 내자 정리 목록에 그대로 있다 — 표에는
 * 머리말 칸으로(순번·인수번호·L/N·S/N·고장내역), 카드에는 줄 머리와
 * CARD_FIELD_GROUPS 의 `제품` 묶음으로. 그 둘은 **이 파일을 쓰지 않는다**(목록 화면
 * 안의 제 상수다). 즉 여기서 지워도 목록은 한 글자도 안 바뀐다.
 *
 * 🔴 **DB 에서도, 받는 타입에서도 지우지 않는다.** 값은 그대로 있고
 * (`lotNumber`·`serialNumber`·`reportedSymptom`·`displayOrder`·`displayIntakeNumber`),
 * 받는 타입도 DomesticOrderListItem 모양 그대로 둔다 — 아래 그 타입 주석에 까닭이
 * 있다. 화면에서 **안 그리는 것**이지 없어진 것이 아니다.
 * ============================================================================
 */

export type DomesticOrderBasicInfoField = {
  label: string;
  /**
   * 그 칸의 글자들 — **한 줄에 하나**다. 거의 모든 칸은 한 줄이고, 납기요청일만
   * 여럿일 수 있다(분할 납품).
   *
   * 줄바꿈으로 이어 붙인 한 덩어리가 아니라 **배열**인 까닭은 목록이 같은 값을
   * 배열로 다루는 것과 같다 — 한 덩어리로 주면 무엇이 한 줄인지가 CSS 설정에
   * 달리고, 그러면 이 규칙을 브라우저 없이는 시험할 수 없다.
   *
   * 🔴 **비어 있지 않다.** 값이 없는 칸은 `["-"]` 다 — 화면이 빈 배열을 받아
   * 아무것도 안 그리면 이름표만 떠 있는 칸이 생기고, 그것은 「값이 없다」가 아니라
   * 「화면이 덜 그려졌다」로 읽힌다.
   */
  lines: string[];
  /**
   * 값 옆에 붙는 작은 꼬리표. **지금은 납기요청일 하나**다 — 이 줄에 적힌 날짜가
   * 하나도 없어 연결된 수리 건의 고객 요청 납기일을 빌려 그릴 때만 붙는다.
   * 없으면 undefined 이고, 그때 화면은 아무것도 안 그린다.
   */
  note?: string;
  /** 이름표에 마우스를 올렸을 때 뜨는 설명. 목록의 표 머리말과 **같은 글자**다. */
  hint?: string;
};

/**
 * 화면에 서는 상자 하나 — **박스 둘**이 전부다(머리말).
 *
 * 🔵 안에 묶음을 또 두지 않고 `fields` 를 바로 가진다. 묶음 층을 남겨 두면 화면이
 * 소제목을 그릴지 말지를 거기서 또 정하게 되고, 「무엇이 몇 개 보이는가」를 값으로
 * 잴 수 없게 된다(이 파일이 있는 까닭 자체가 그것이다).
 */
export type DomesticOrderBasicInfoBox = {
  label: string;
  fields: DomesticOrderBasicInfoField[];
};

/**
 * 이 파일이 실제로 보는 칸만 적는다 — DomesticOrderListItem 을 그대로 받되
 * `import type` 사슬이 `server-only` 로 끌려가지 않게, 구조만 요구한다.
 * (queries 파일은 `import "server-only"` 로 시작한다. 타입만 들여오면 런타임에는
 * 지워지지만, 이 도메인 파일이 그쪽을 알아야 할 까닭 자체가 없다.)
 *
 * 🔴 **다섯 칸은 지금 아무 데도 안 그려지는데 그대로 둔다**(2026-11-07) —
 * `displayOrder` · `displayIntakeNumber` · `lotNumber` · `serialNumber` ·
 * `reportedSymptom`. 사용자가 이 탭에서 빼라고 한 다섯이다. 타입에서 빼면 두 가지가
 * 깨진다: ① 받는 모양이 더 이상 「목록이 그리는 그 줄」이 아니게 되어, 칸이 하나 늘
 * 때 여기만 조용히 빠지는 길이 열린다(위 머리말). ② 🔴 **시험이 「안 보인다」를 잴 수
 * 없게 된다** — 값이 실제로 들어 있는 줄을 넣고 그 글자가 화면에 없음을 단언해야
 * 하는데, 타입이 그 칸을 거절하면 표본을 만들 수 없어 시험이 공짜로 통과한다.
 */
export type DomesticOrderBasicInfoRow = {
  displayOrder: number | null;
  displayIntakeNumber: string | null;
  customerName: string | null;
  completedAt: string | null;
  purchaseOrderNumber: string | null;
  projectName: string | null;
  orderIssuedDate: string | null;
  dueDates: readonly { dueDate: string; note: string | null }[];
  repairCaseCustomerRequestedDueDate: string | null;
  modelName: string | null;
  lotNumber: string | null;
  serialNumber: string | null;
  reportedSymptom: string | null;
  displayQuoteIssuedDate: string | null;
  displayQuoteNumber: string | null;
  progressNote: string | null;
  /**
   * 🔴 **납기요청일 행마다 하나씩**이다(2026-11-08). 두 목록은 길이가 같고 자리가
   * 맞는다 — 목록의 같은 두 칸과 **같은 값**이다(queries 의 매퍼가 이미 골라 둔다).
   */
  deliveredDateLines: readonly (string | null)[];
  deliveredByLines: readonly (string | null)[];
  deliveredDateBorrowed: boolean;
  taxInvoiceDate: string | null;
  displayAmountExcludingVat: string | null;
  paymentCompleted: boolean;
  japanRemittanceNote: string | null;
  historyNote: string | null;
  etcNote: string | null;
};

/** 값 하나짜리 칸. 「없음」의 글자는 목록과 같은 한 곳에서 온다(dash). */
function one(label: string, value: string | number | null | undefined): DomesticOrderBasicInfoField {
  return { label, lines: [dash(value)] };
}

/**
 * 줄마다 하나인 납품 칸을 글자 줄로. 🔴 **안 적은 회차도 "-" 한 줄을 차지한다** —
 * 거르면 납품일과 납품자의 줄 수가 달라져 아래로 갈수록 엉뚱한 회차끼리 나란히
 * 선다(components/domestic-orders/delivered-cell-content.tsx 의 같은 규칙).
 *
 * 🔵 행이 아예 없는 줄은 "-" 한 줄이다 — 다른 칸의 빈 값과 같은 모양이다.
 */
function deliveredLinesOrDash(lines: readonly (string | null)[]): string[] {
  if (lines.length === 0) return [dash(null)];
  return lines.map((line) => dash(line));
}

/**
 * 기본정보 탭에 그릴 **박스 둘**(2026-11-07 사용자 지정 — 머리말).
 *
 * 🔴 **완료 여부는 `completedAt` 한 칸으로만 판정한다**(schema 파일 주석) — 그
 * 시각을 날짜로 그리지는 않는다. 서버가 보낸 ISO 를 화면에서 형식 맞추면 서버가
 * 그린 것과 달라져 hydration 이 어긋나고, 목록도 같은 까닭으로 「완료인가 아닌가」
 * 로만 쓴다.
 */
export function domesticOrderBasicInfoBoxes(
  row: DomesticOrderBasicInfoRow
): DomesticOrderBasicInfoBox[] {
  // 🔴 목록의 `납기요청일` 칸과 **같은 함수**로 정한다 — 이 줄에 적힌 날짜가
  //    먼저이고, 하나도 없을 때만 연결된 수리 건에서 빌린다. 빌려 온 줄에는
  //    꼬리표가 붙는다(안 붙이면 「내가 적은 값」으로 읽힌다).
  const dueDate = resolveDomesticOrderDueDateDisplay({
    dueDates: row.dueDates,
    repairCaseCustomerRequestedDueDate: row.repairCaseCustomerRequestedDueDate,
  });

  return [
    {
      label: "제품 · 견적 · 납품",
      fields: [
        // 제품 — 🔴 **형식 하나만 남는다**(사용자가 L/N · S/N · 고장내역을 뺐다).
        one("형식", row.modelName),
        // 견적 · 납품
        one("견적발행일", row.displayQuoteIssuedDate),
        one("견적서번호", row.displayQuoteNumber),
        one("현황", row.progressNote),
        // 🔴 납품 둘은 **줄마다 하나**다(2026-11-08). 납기요청일 칸과 같은 모양으로
        //    늘어놓고, 빌려 온 날짜에는 꼬리표를 단다 — 꼬리표가 없으면 「내가 적은
        //    값」으로 읽힌다(2026-10-30 「동기화해도 출처 표시는 남긴다」).
        //    🔵 **꼬리표는 날짜 쪽에만** 붙는다. 수리 건에는 「누가 보냈는가」가 없어
        //    납품자는 그때 "-" 한 줄이고, 거기 출처를 적으면 없는 값의 출처가 된다.
        {
          label: "납품일",
          lines: deliveredLinesOrDash(row.deliveredDateLines),
          note: row.deliveredDateBorrowed ? DELIVERED_DATE_FROM_REPAIR_CASE_LABEL : undefined,
          hint: DOMESTIC_ORDER_DELIVERED_DATE_NOTE,
        },
        {
          label: "납품자",
          lines: deliveredLinesOrDash(row.deliveredByLines),
          hint: DOMESTIC_ORDER_DELIVERED_DATE_NOTE,
        },
      ],
    },
    {
      label: "줄 · 발주 · 정산 · 기타",
      fields: [
        // 줄 — 🔴 순번·인수번호는 사용자가 뺐다. 남는 둘은 머리 카드에도 있지만
        //      (공급처 · 상태 배지) 빼라는 말이 없었으므로 그대로 둔다.
        one("고객사", row.customerName),
        { label: "완료 여부", lines: [row.completedAt === null ? "진행 중" : "완료"] },
        // 발주
        one("발주서번호", row.purchaseOrderNumber),
        one("PJT", row.projectName),
        // 목록과 같은 글자다 — "-"(그냥 빈 값)와 구분한다(그 상수 주석).
        {
          label: "발주발행일",
          lines: [row.orderIssuedDate === null ? NO_ORDER_DATE_LABEL : row.orderIssuedDate],
        },
        {
          label: "납기요청일",
          lines: dueDate.lines.length === 0 ? [dash(null)] : dueDate.lines,
          note: dueDate.borrowed ? DUE_DATE_FROM_REPAIR_CASE_LABEL : undefined,
          hint: DOMESTIC_ORDER_DUE_DATE_LINK_NOTE,
        },
        // 정산
        one("세금계산서발행일", row.taxInvoiceDate),
        { label: "금액(VAT별도)", lines: [formatAmount(row.displayAmountExcludingVat)] },
        { label: "입금완료 여부", lines: [paymentLabel(row.paymentCompleted)] },
        one("일본 송금", row.japanRemittanceNote),
        // 기타
        one("이력", row.historyNote),
        one("기타", row.etcNote),
      ],
    },
  ];
}

/**
 * 머리 카드의 넷 — 🔴 **품명 · 공급처 · 발행일자 · 발행번호**(사용자 지정).
 *
 * ── 🔴 넷 다 **내자 줄**에서 읽는다 (견적서에서 읽지 않는다) ──────────────
 * 이 넷의 출처는 둘로 보인다 — 연결된 견적서(subject · customer_name_text ·
 * quote_date · quote_number)와 이 내자 줄(model_name_text · customer_id ·
 * quote_issued_date · quote_number). 내자 줄 쪽을 고른 까닭 셋:
 *
 *  ① 🔴 **견적서 없이도 생기는 줄이 있다.** 손으로 [행 추가] 한 줄에는 견적서가
 *     아예 없다 — 견적서에서 읽으면 그런 줄의 머리가 통째로 빈다. 그런데 사용자가
 *     기타건이라 부른 것에는 바로 그 줄이 들어 있다(「수리건을 연결하지 않은 채
 *     줄 추가를 한 건 포함」).
 *  ② 🔴 **기타 견적서가 만든 줄에서는 두 길이 같은 글자다.** 그 줄은 견적서의
 *     품명(subject)이 그대로 `model_name_text` 에 적히고, 번호와 발행일자도 그
 *     견적서의 값이 적힌다(domain/quote-domestic-order-line.ts 의 「채우는 칸」).
 *     즉 견적서에서 읽어도 같은 값이고, 다른 점은 ① 의 줄뿐이다.
 *  ③ 🔴 **목록과 어긋나지 않는다.** 발행일자·발행번호는 매퍼가 이미 「연결된
 *     견적서가 이긴다」로 접어 둔 display* 둘이고(이 표에서 방향이 반대인 유일한
 *     칸들), 목록이 그리는 것이 그 값이다. 여기서 견적서를 따로 읽으면 같은 규칙을
 *     두 벌 갖게 된다.
 *
 * ⚠️ **공급처가 "-" 인 줄이 있다.** 견적서는 공급처를 고객사 마스터에 안 이어도
 * 저장되므로(2026-11-06 결정) `customer_id` 가 비어 올 수 있다. 그때 견적서에
 * 글자로 적힌 공급처를 끌어오지 **않는다** — 목록의 고객사 칸은 그 줄을
 * 「(고객사 미지정)」으로 묶어 두는데 상세에만 이름이 서면, 같은 줄을 두 화면이
 * 다른 고객사의 건으로 말하게 된다. 이을 자리는 견적서 화면의 공급처 고르개다.
 */
export type DomesticOrderDetailHeadRow = {
  modelName: string | null;
  customerName: string | null;
  displayQuoteIssuedDate: string | null;
  displayQuoteNumber: string | null;
};

export function domesticOrderDetailHeadFacts(
  row: DomesticOrderDetailHeadRow
): { key: string; label: string; value: string }[] {
  return [
    { key: "modelName", label: "품명", value: dash(row.modelName) },
    { key: "customerName", label: "공급처", value: dash(row.customerName) },
    { key: "quoteIssuedDate", label: "발행일자", value: dash(row.displayQuoteIssuedDate) },
    { key: "quoteNumber", label: "발행번호", value: dash(row.displayQuoteNumber) },
  ];
}
