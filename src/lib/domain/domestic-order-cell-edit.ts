/**
 * ============================================================================
 * 내자 정리 — 칸 하나를 고쳐 보낼 때 **무엇을 함께 실을지** 정하는 규칙
 * ============================================================================
 * DB 도 React 도 여기 들어오지 않는다. domestic-order-list.ts 와 같은 자리의
 * 파일이고, 같은 이유로 순수 함수만 둔다 — 아래 규칙은 **틀리면 자료가 조용히
 * 지워지는** 종류라서, 화면 안에 두면 브라우저를 띄우지 않고는 시험할 방법이
 * 없어진다.
 *
 * ── ⚠️ 이 화면의 저장은 "보낸 칸만" 고치지 않는다 ───────────────────────
 * 주간보고 비고와 **정반대**다. 저쪽 mutation 은 `key in fields` 로만 SET 절을
 * 만들어서, 안 보낸 칸은 손대지 않은 채로 남는다. 내자 정리는 그렇지 않다:
 *
 *   1. validateDomesticOrderFields(validation/domestic-order-input.ts)의
 *      normalizeText·normalizeDate 는 **키가 없으면(undefined) null 로 접는다.**
 *      "안 보냈다"와 "지웠다"를 구분하지 않는다.
 *   2. updateDomesticOrder(mutations/domestic-orders.ts)는 그 결과를
 *      toColumnValues 로 통째로 넘겨 **모든 칼럼을 SET 한다.**
 *
 * 그래서 `{ quoteNumber: "Q-1" }` 하나만 보내면 **그 줄의 나머지 칸이 전부
 * 지워진다.** 칸 하나를 고쳐도 그 줄의 값 전체를 함께 실어 보내야 하는 이유가
 * 이것이고, 그 일을 하는 것이 아래 buildDomesticOrderCellUpdateFields 다.
 *
 * 목록과 차례는 `줄 수정` 폼의 collectFields(DomesticOrderEditForm)를 그대로
 * 따른다 — 그쪽이 이미 이 규칙을 지키는 유일한 자리였다. 두 곳이 서로 다른
 * 목록을 들고 있으면, 한쪽에만 칸이 추가된 날 다른 쪽으로 저장한 줄에서 그 칸이
 * 말없이 비워진다.
 *
 * ⚠️ **이 함수를 부르는 쪽은 expectedVersion 에 그 줄의 version 을 반드시
 * 실어야 한다.** 줄 전체를 덮어쓰는 저장이라, 낙관적 잠금이 없으면 낡은 화면에서
 * 누른 저장이 그 사이 남이 고친 값을 통째로 되돌린다. 그것이 이 방식을 안전하게
 * 만드는 유일한 장치다.
 *
 * ── ⚠️ 계산된 값을 원본 칸에 저장하면 안 된다 ───────────────────────────
 * 목록 한 줄(DomesticOrderListItem)에는 두 벌이 들어 있다:
 *
 *   - **원본 칸** — modelNameText · lotNumberText · serialNumberText ·
 *     intakeNumberText · customerId · faultDescriptionText
 *   - **계산된 값** — modelName · lotNumber · serialNumber ·
 *     displayIntakeNumber · customerName · reportedSymptom
 *
 * 계산된 값은 *"그 줄에 적힌 것이 먼저, 없으면 연결된 수리 건의 것"* 이다
 * (resolveDomesticOrderValue). 그러므로 **보낼 때는 반드시 원본 칸을 쓴다.**
 * 계산된 값을 보내면, 그 줄이 원래 비워 두고 수리 건 값을 빌려 쓰던 칸에 수리
 * 건의 값이 자기 값으로 복사되어 굳는다 — 그때부터 "일부러 다르게 적었다"와
 * "그냥 안 건드렸다"를 구분할 수 없고, 나중에 수리 건 쪽이 고쳐져도 이 줄만 옛
 * 값으로 남는다. 화면상으로는 똑같아 보여서 **알아채기까지 오래 걸린다.**
 * (같은 함정을 `줄 수정` 폼도 피하고 있다 — 그 파일 헤더의 'placeholder 다.
 * value 가 아니다'.)
 *
 * 아래 DomesticOrderCellEditRow 가 **원본 칸만** 요구하는 것이 그 장치다.
 * 계산된 값은 타입에 아예 없으므로 실수로 집어 올 자리가 없다.
 *
 * ── 값은 손대지 않고 그대로 옮긴다 ──────────────────────────────────────
 * 빈 값을 접는 일(빈 문자열 · 공백 → null), 금액의 쉼표를 걷어 내는 일, 순번을
 * 숫자로 읽는 일은 전부 **검증 한 곳**이 한다. 여기서 미리 다듬으면 규칙이 두
 * 곳에 생기고, 언젠가 둘이 어긋난다. 그래서 이 함수는 읽어 온 값을 그대로
 * 되돌려 보내고, 고치는 칸 하나만 갈아 끼운다.
 * ============================================================================
 */

/**
 * 칸을 눌러 그 자리에서 고칠 수 있는 칸. **한 줄짜리 글자 칸 다섯뿐이다.**
 *
 * 날짜·금액·체크·고르기 칸은 다루는 방식이 제각각이라(달력 입력, 쉼표가 섞인
 * 숫자, 체크상자, UUID 를 고르는 드롭다운) 같은 방식으로 묶을 수 없다. 그
 * 칸들은 지금도 `줄 수정` 폼에서 고친다.
 */
export type DomesticOrderInlineEditableField =
  | "purchaseOrderNumber"
  | "projectName"
  | "quoteNumber"
  | "deliveredBy"
  | "japanRemittanceNote";

/**
 * 그 칸의 이름. 표 머리말·카드 이름표와 **같은 글자**여야 한다 — 화면 낭독기가
 * 읽는 이름과 마우스를 올렸을 때 뜨는 안내가 여기서 나오므로, 다르게 적으면 한
 * 칸이 두 이름으로 불린다.
 */
export const DOMESTIC_ORDER_INLINE_EDIT_LABELS: Readonly<
  Record<DomesticOrderInlineEditableField, string>
> = {
  purchaseOrderNumber: "발주서번호",
  projectName: "PJT",
  quoteNumber: "견적서번호",
  deliveredBy: "납품자",
  japanRemittanceNote: "일본 송금",
};

/**
 * 이 함수가 실제로 보는 칸만 요구한다 — DomesticOrderListItem 전체를 끌어오지
 * 않는 것은 domestic-order-list.ts 와 같은 이유이고, 여기서는 이유가 하나 더
 * 있다: **계산된 값을 타입에서 아예 빼 두기 위해서다**(파일 헤더의 함정 ②).
 *
 * 차례는 `줄 수정` 폼의 collectFields 그대로다.
 */
export type DomesticOrderCellEditRow = {
  repairCaseId: string | null;
  intakeNumberText: string | null;
  customerId: string | null;
  modelNameText: string | null;
  lotNumberText: string | null;
  serialNumberText: string | null;
  faultDescriptionText: string | null;
  displayOrder: number | null;
  purchaseOrderNumber: string | null;
  projectName: string | null;
  orderIssuedDate: string | null;
  /**
   * 납기요청일 **전부**. 차례가 곧 저장되는 차례다(validation 의
   * DomesticOrderDueDateInput 주석) — 여기서 다시 정렬하거나 걸러 내면 그 줄의
   * 납기일 순서가 칸 하나 고칠 때마다 바뀐다.
   *
   * 목록이 실어 오는 항목에는 id 와 displayOrder 도 붙어 있지만 저장에는 쓰이지
   * 않는다(검증이 dueDate · note 만 읽는다). 그래도 아래에서 두 칸만 골라
   * 새로 만드는 것은, **보내는 값의 모양을 이 파일이 정한다**는 사실을 코드로
   * 남겨 두기 위해서다.
   */
  dueDates: readonly { dueDate: string; note: string | null }[];
  quoteIssuedDate: string | null;
  quoteNumber: string | null;
  progressNote: string | null;
  deliveredDate: string | null;
  deliveredBy: string | null;
  taxInvoiceDate: string | null;
  amountExcludingVat: string | null;
  paymentCompleted: boolean;
  japanRemittanceNote: string | null;
  historyNote: string | null;
  etcNote: string | null;
};

/**
 * 칸 하나를 고쳐 `updateDomesticOrderAction` 에 보낼 `fields`.
 *
 * 고치는 칸에는 사용자가 친 글자를 **다듬지 않고 그대로** 넣는다(파일 헤더의
 * '값은 손대지 않고'). 빈 문자열을 넣어 지운 경우도 마찬가지다 — 빈 문자열을
 * null 로 접는 일은 검증이 하고, 그래야 `줄 수정` 폼으로 지웠을 때와 결과가
 * 한 글자도 다르지 않다.
 *
 * 나머지 칸은 읽어 온 값 그대로다. 하나라도 빠뜨리면 그 칸이 지워진다.
 */
export function buildDomesticOrderCellUpdateFields(
  row: DomesticOrderCellEditRow,
  field: DomesticOrderInlineEditableField,
  value: string
): Record<string, unknown> {
  return {
    repairCaseId: row.repairCaseId,
    intakeNumberText: row.intakeNumberText,
    customerId: row.customerId,
    modelNameText: row.modelNameText,
    lotNumberText: row.lotNumberText,
    serialNumberText: row.serialNumberText,
    faultDescriptionText: row.faultDescriptionText,
    displayOrder: row.displayOrder,
    purchaseOrderNumber: row.purchaseOrderNumber,
    projectName: row.projectName,
    orderIssuedDate: row.orderIssuedDate,
    dueDates: row.dueDates.map((entry) => ({ dueDate: entry.dueDate, note: entry.note })),
    quoteIssuedDate: row.quoteIssuedDate,
    quoteNumber: row.quoteNumber,
    progressNote: row.progressNote,
    deliveredDate: row.deliveredDate,
    deliveredBy: row.deliveredBy,
    taxInvoiceDate: row.taxInvoiceDate,
    amountExcludingVat: row.amountExcludingVat,
    paymentCompleted: row.paymentCompleted,
    japanRemittanceNote: row.japanRemittanceNote,
    historyNote: row.historyNote,
    etcNote: row.etcNote,
    // 고치는 칸은 **맨 마지막에** 갈아 끼운다. 위 목록에 그 칸이 이미 있으므로
    // 순서가 곧 규칙이다 — 앞에 두면 원래 값이 새 값을 덮어쓴다.
    [field]: value,
  };
}
