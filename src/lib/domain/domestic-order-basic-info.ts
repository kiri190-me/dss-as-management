import {
  dash,
  DELIVERED_DATE_NOTE,
  formatAmount,
  NO_ORDER_DATE_LABEL,
  paymentLabel,
} from "./domestic-order-display";
import {
  DOMESTIC_ORDER_DUE_DATE_LINK_NOTE,
  DUE_DATE_FROM_REPAIR_CASE_LABEL,
  resolveDomesticOrderDueDateDisplay,
} from "./requested-due-date-link";

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
 * ── 묶음과 차례는 목록의 카드와 같다 ────────────────────────────────────
 * `줄` · `발주` · `제품` · `견적 · 납품` · `정산` · `기타`. 뒤 다섯은 목록 카드의
 * CARD_FIELD_GROUPS 와 같은 이름·같은 차례다 — 같은 줄을 보는 두 화면이 칸을 다른
 * 순서로 늘어놓으면 눈이 매번 다시 길을 찾는다. 맨 앞의 `줄` 묶음만 여기에 더 있다:
 * 목록에서는 순번·인수번호·고객사가 칸이 아니라 줄 머리와 묶음 소제목에 있어서,
 * 상세에서는 적을 자리가 따로 필요하다.
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

export type DomesticOrderBasicInfoGroup = {
  label: string;
  fields: DomesticOrderBasicInfoField[];
};

/**
 * 이 파일이 실제로 보는 칸만 적는다 — DomesticOrderListItem 을 그대로 받되
 * `import type` 사슬이 `server-only` 로 끌려가지 않게, 구조만 요구한다.
 * (queries 파일은 `import "server-only"` 로 시작한다. 타입만 들여오면 런타임에는
 * 지워지지만, 이 도메인 파일이 그쪽을 알아야 할 까닭 자체가 없다.)
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
  displayDeliveredDate: string | null;
  deliveredBy: string | null;
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
 * 기본정보 탭에 그릴 묶음 여섯.
 *
 * 🔴 **완료 여부는 `completedAt` 한 칸으로만 판정한다**(schema 파일 주석) — 그
 * 시각을 날짜로 그리지는 않는다. 서버가 보낸 ISO 를 화면에서 형식 맞추면 서버가
 * 그린 것과 달라져 hydration 이 어긋나고, 목록도 같은 까닭으로 「완료인가 아닌가」
 * 로만 쓴다.
 */
export function domesticOrderBasicInfoGroups(
  row: DomesticOrderBasicInfoRow
): DomesticOrderBasicInfoGroup[] {
  // 🔴 목록의 `납기요청일` 칸과 **같은 함수**로 정한다 — 이 줄에 적힌 날짜가
  //    먼저이고, 하나도 없을 때만 연결된 수리 건에서 빌린다. 빌려 온 줄에는
  //    꼬리표가 붙는다(안 붙이면 「내가 적은 값」으로 읽힌다).
  const dueDate = resolveDomesticOrderDueDateDisplay({
    dueDates: row.dueDates,
    repairCaseCustomerRequestedDueDate: row.repairCaseCustomerRequestedDueDate,
  });

  return [
    {
      label: "줄",
      fields: [
        one("순번", row.displayOrder),
        one("인수번호", row.displayIntakeNumber),
        one("고객사", row.customerName),
        { label: "완료 여부", lines: [row.completedAt === null ? "진행 중" : "완료"] },
      ],
    },
    {
      label: "발주",
      fields: [
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
      ],
    },
    {
      label: "제품",
      fields: [
        one("형식", row.modelName),
        one("L/N", row.lotNumber),
        one("S/N", row.serialNumber),
        one("고장내역", row.reportedSymptom),
      ],
    },
    {
      label: "견적 · 납품",
      fields: [
        one("견적발행일", row.displayQuoteIssuedDate),
        one("견적서번호", row.displayQuoteNumber),
        one("현황", row.progressNote),
        { ...one("납품일", row.displayDeliveredDate), hint: DELIVERED_DATE_NOTE },
        one("납품자", row.deliveredBy),
      ],
    },
    {
      label: "정산",
      fields: [
        one("세금계산서발행일", row.taxInvoiceDate),
        { label: "금액(VAT별도)", lines: [formatAmount(row.displayAmountExcludingVat)] },
        { label: "입금완료 여부", lines: [paymentLabel(row.paymentCompleted)] },
        one("일본 송금", row.japanRemittanceNote),
      ],
    },
    {
      label: "기타",
      fields: [one("이력", row.historyNote), one("기타", row.etcNote)],
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
