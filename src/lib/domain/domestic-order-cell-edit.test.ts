import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DOMESTIC_ORDER_INLINE_EDIT_DATE,
  DOMESTIC_ORDER_INLINE_EDIT_LABELS,
  DOMESTIC_ORDER_INLINE_EDIT_MULTILINE,
  buildDomesticOrderCellUpdateFields,
  domesticOrderFaultDescriptionHint,
  domesticOrderInlineEditControl,
  domesticOrderInlineEditYearNotice,
  type DomesticOrderCellEditRow,
  type DomesticOrderInlineEditableField,
} from "./domestic-order-cell-edit";

/**
 * 내자 정리의 칸 편집이 **보낼 값**을 만드는 규칙.
 *
 * 이 화면의 저장은 보낸 칸만 고치지 않고 **줄 전체를 SET 한다**(그 파일 헤더).
 * 그래서 아래 시험이 막는 것은 화면의 생김새가 아니라 **자료가 조용히 지워지는
 * 일**이다. 자물쇠는 넷이다:
 *
 *  1. 한 칸을 고쳐도 나머지 칸이 **원래 값 그대로** 실린다(빠지면 그 칸이 지워진다).
 *  2. 실리는 것은 **원본 칸**이다 — 계산된 값(modelName · customerName …)이 섞이면
 *     수리 건에서 빌려 쓰던 값이 이 줄에 복사되어 굳는다.
 *  3. 키 목록이 `줄 수정` 폼의 collectFields 와 **한 칸도 다르지 않다.**
 *  4. **납품일(deliveredDate)이 실린다.** 이제 화면 어디에도 안 나오는 값이라
 *     빠져도 눈으로는 알아챌 수 없다 — 파일 맨 아래 묶음이 그 자리를 지킨다.
 */

/**
 * `줄 수정` 폼의 collectFields 가 보내는 키 전부. **여기가 기준이다** —
 * 두 저장 경로가 서로 다른 목록을 보내면, 칸 편집으로 저장한 줄에서만 어떤 칸이
 * 말없이 비워진다.
 */
const COLLECT_FIELDS_KEYS = [
  "repairCaseId",
  "intakeNumberText",
  "customerId",
  "modelNameText",
  "lotNumberText",
  "serialNumberText",
  "faultDescriptionText",
  "displayOrder",
  "purchaseOrderNumber",
  "projectName",
  "orderIssuedDate",
  "dueDates",
  "quoteIssuedDate",
  "quoteNumber",
  "progressNote",
  "deliveredDate",
  "deliveredBy",
  "taxInvoiceDate",
  "amountExcludingVat",
  "paymentCompleted",
  "japanRemittanceNote",
  "historyNote",
  "etcNote",
] as const;

/** 모든 칸이 채워진 줄. 하나라도 빠지면 그것이 지워진 것인지 이 시험이 말해 준다. */
function row(overrides: Partial<DomesticOrderCellEditRow> = {}): DomesticOrderCellEditRow {
  return {
    repairCaseId: "11111111-1111-4111-8111-111111111111",
    intakeNumberText: "2026-0001",
    customerId: "22222222-2222-4222-8222-222222222222",
    modelNameText: "RF-100",
    lotNumberText: "LN-7",
    serialNumberText: "SN-9",
    faultDescriptionText: "전원 안 들어옴",
    displayOrder: 3,
    purchaseOrderNumber: "PO-1",
    projectName: "PJT-A",
    orderIssuedDate: "2026-01-05",
    dueDates: [
      { dueDate: "2026-01-20", note: "1차분" },
      { dueDate: "2026-02-15", note: null },
    ],
    quoteIssuedDate: "2026-01-07",
    quoteNumber: "Q-1",
    progressNote: "수리중\n부품 대기",
    deliveredDate: "2026-02-20",
    deliveredBy: "김유진",
    taxInvoiceDate: "2026-02-25",
    amountExcludingVat: "1234567.00",
    paymentCompleted: true,
    japanRemittanceNote: "송금 완료",
    historyNote: "이력",
    etcNote: "기타",
    ...overrides,
  };
}

test("한 칸을 고쳐도 나머지 칸이 원래 값 그대로 실린다 — 이 저장은 줄 전체를 SET 한다", () => {
  const subject = row();
  const fields = buildDomesticOrderCellUpdateFields(subject, "quoteNumber", "Q-2");

  // 고친 칸만 새 값이다.
  assert.equal(fields.quoteNumber, "Q-2");

  // 나머지는 전부 읽어 온 값 그대로여야 한다. 하나라도 빠지면(undefined) 검증이
  // null 로 접고 mutation 이 그 칼럼을 지운다.
  assert.equal(fields.repairCaseId, subject.repairCaseId);
  assert.equal(fields.intakeNumberText, "2026-0001");
  assert.equal(fields.customerId, subject.customerId);
  assert.equal(fields.modelNameText, "RF-100");
  assert.equal(fields.lotNumberText, "LN-7");
  assert.equal(fields.serialNumberText, "SN-9");
  assert.equal(fields.faultDescriptionText, "전원 안 들어옴");
  assert.equal(fields.purchaseOrderNumber, "PO-1");
  assert.equal(fields.projectName, "PJT-A");
  assert.equal(fields.orderIssuedDate, "2026-01-05");
  assert.equal(fields.quoteIssuedDate, "2026-01-07");
  assert.equal(fields.progressNote, "수리중\n부품 대기");
  assert.equal(fields.deliveredDate, "2026-02-20");
  assert.equal(fields.deliveredBy, "김유진");
  assert.equal(fields.taxInvoiceDate, "2026-02-25");
  assert.equal(fields.amountExcludingVat, "1234567.00");
  assert.equal(fields.japanRemittanceNote, "송금 완료");
  assert.equal(fields.historyNote, "이력");
  assert.equal(fields.etcNote, "기타");
});

test("보내는 키는 `줄 수정` 폼의 collectFields 와 한 칸도 다르지 않다", () => {
  const fields = buildDomesticOrderCellUpdateFields(row(), "projectName", "PJT-B");
  assert.deepEqual(Object.keys(fields).sort(), [...COLLECT_FIELDS_KEYS].sort());
  // 빠진 키가 없다는 것을 한 번 더 못 박는다 — 위 비교는 목록 자체가 함께
  // 줄어들면 통과해 버린다.
  assert.equal(Object.keys(fields).length, 23);
});

test("dueDates · displayOrder · paymentCompleted 는 빠지지 않는다 — 셋 다 조용히 지워지는 칸이다", () => {
  const fields = buildDomesticOrderCellUpdateFields(row(), "deliveredBy", "박");

  // 납기요청일은 차례가 곧 저장되는 차례다. id · displayOrder 는 저장에 쓰이지
  // 않으므로 두 칸만 골라 보낸다.
  assert.deepEqual(fields.dueDates, [
    { dueDate: "2026-01-20", note: "1차분" },
    { dueDate: "2026-02-15", note: null },
  ]);

  // 순번은 숫자 그대로 보낸다(검증이 number 도 읽는다). 0 이나 문자열로 바꿔
  // 보내면 "순번은 1 이상의 정수여야 합니다"로 막힌다.
  assert.equal(fields.displayOrder, 3);

  // 입금완료는 boolean 이다. 빠지면 검증이 false 로 접어, 아무도 안 건드린
  // 줄의 입금 사실이 사라진다.
  assert.equal(fields.paymentCompleted, true);
});

test("납기요청일이 없는 줄은 빈 배열로 보낸다 — 빈 목록이 정상이다", () => {
  const fields = buildDomesticOrderCellUpdateFields(
    row({ dueDates: [] }),
    "purchaseOrderNumber",
    "PO-2"
  );
  assert.deepEqual(fields.dueDates, []);
});

test("납기요청일 목록은 새로 만든다 — 원본 배열을 그대로 넘기지 않는다", () => {
  const subject = row();
  const fields = buildDomesticOrderCellUpdateFields(subject, "quoteNumber", "Q-3");
  assert.notEqual(fields.dueDates, subject.dueDates);
  assert.notEqual((fields.dueDates as unknown[])[0], subject.dueDates[0]);
});

test("계산된 값은 실리지 않는다 — 수리 건의 값이 이 줄에 복사되어 굳으면 안 된다", () => {
  /**
   * 실제 목록 한 줄(DomesticOrderListItem)에는 원본 칸과 계산된 값이 **두 벌**
   * 들어 있다. 이 줄은 원본 칸이 비어 있어 수리 건의 값을 빌려 쓰는 중이다 —
   * 계산된 값이 실려 나가면 그 순간 빌려 쓰던 값이 자기 값으로 굳어, 나중에
   * 수리 건 쪽이 고쳐져도 이 줄만 옛 값으로 남는다.
   */
  const listItem = {
    ...row({
      intakeNumberText: null,
      customerId: null,
      modelNameText: null,
      lotNumberText: null,
      serialNumberText: null,
      faultDescriptionText: null,
    }),
    // 계산된 값 — 화면이 그리는 것이 이쪽이라 실수로 집어 오기 쉽다.
    displayIntakeNumber: "2026-0099",
    customerName: "주식회사 가나다",
    modelName: "RF-999",
    lotNumber: "LN-999",
    serialNumber: "SN-999",
    reportedSymptom: "수리 건에 적힌 증상",
  };

  const fields = buildDomesticOrderCellUpdateFields(listItem, "japanRemittanceNote", "송금 예정");

  // 원본 칸은 비어 있던 그대로 나간다.
  assert.equal(fields.intakeNumberText, null);
  assert.equal(fields.customerId, null);
  assert.equal(fields.modelNameText, null);
  assert.equal(fields.lotNumberText, null);
  assert.equal(fields.serialNumberText, null);
  assert.equal(fields.faultDescriptionText, null);

  // 계산된 값은 키 자체가 없어야 한다.
  for (const key of [
    "displayIntakeNumber",
    "customerName",
    "modelName",
    "lotNumber",
    "serialNumber",
    "reportedSymptom",
    "intakeNumber",
  ]) {
    assert.equal(key in fields, false, `${key} 는 보내면 안 되는 계산된 값이다`);
  }
});

test("빈 문자열로 지우면 빈 문자열 그대로 나간다 — null 로 접는 일은 검증 한 곳이 한다", () => {
  const fields = buildDomesticOrderCellUpdateFields(row(), "japanRemittanceNote", "");
  assert.equal(fields.japanRemittanceNote, "");
  // 다른 칸까지 함께 비워지지 않는다.
  assert.equal(fields.deliveredBy, "김유진");
  assert.equal(fields.quoteNumber, "Q-1");
});

test("공백만 남겨도 그대로 나간다 — 앞뒤 공백을 떼는 규칙도 검증 한 곳이 갖는다", () => {
  const fields = buildDomesticOrderCellUpdateFields(row(), "deliveredBy", "  ");
  assert.equal(fields.deliveredBy, "  ");
});

test("원래 비어 있던 칸도 적을 수 있다 — 빈 칸을 눌러 채우는 길이 막히면 안 된다", () => {
  const fields = buildDomesticOrderCellUpdateFields(
    row({ purchaseOrderNumber: null, projectName: null }),
    "purchaseOrderNumber",
    "PO-새로"
  );
  assert.equal(fields.purchaseOrderNumber, "PO-새로");
  // 함께 비어 있던 칸은 비어 있는 채로 남는다.
  assert.equal(fields.projectName, null);
});

test("다섯 칸 각각이 자기 칸만 바꾼다", () => {
  const fields: DomesticOrderInlineEditableField[] = [
    "purchaseOrderNumber",
    "projectName",
    "quoteNumber",
    "deliveredBy",
    "japanRemittanceNote",
  ];
  const original = row();
  for (const field of fields) {
    const built = buildDomesticOrderCellUpdateFields(original, field, "새 값");
    assert.equal(built[field], "새 값");
    for (const other of fields) {
      if (other === field) continue;
      assert.equal(built[other], original[other], `${field} 을(를) 고치는데 ${other} 가 바뀌었다`);
    }
  }
});

test("칸 이름표는 열두 칸 전부에 있다 — 이름 없는 칸은 낭독기에서 무엇인지 알 수 없다", () => {
  assert.deepEqual(Object.keys(DOMESTIC_ORDER_INLINE_EDIT_LABELS).sort(), [
    "deliveredBy",
    "etcNote",
    "faultDescriptionText",
    "historyNote",
    "japanRemittanceNote",
    "orderIssuedDate",
    "progressNote",
    "projectName",
    "purchaseOrderNumber",
    "quoteIssuedDate",
    "quoteNumber",
    "taxInvoiceDate",
  ]);
  // 표 머리말·카드 이름표와 같은 글자여야 한다.
  assert.equal(DOMESTIC_ORDER_INLINE_EDIT_LABELS.purchaseOrderNumber, "발주서번호");
  assert.equal(DOMESTIC_ORDER_INLINE_EDIT_LABELS.projectName, "PJT");
  assert.equal(DOMESTIC_ORDER_INLINE_EDIT_LABELS.quoteNumber, "견적서번호");
  assert.equal(DOMESTIC_ORDER_INLINE_EDIT_LABELS.deliveredBy, "납품자");
  assert.equal(DOMESTIC_ORDER_INLINE_EDIT_LABELS.japanRemittanceNote, "일본 송금");
  // 여러 줄 칸 넷. 이름은 표 머리말(고장내역 · 현황 · 이력 · 기타) 그대로다 —
  // 칸 이름이 원본 칸 이름(faultDescriptionText)으로 새어 나오면 안 된다.
  assert.equal(DOMESTIC_ORDER_INLINE_EDIT_LABELS.faultDescriptionText, "고장내역");
  assert.equal(DOMESTIC_ORDER_INLINE_EDIT_LABELS.progressNote, "현황");
  assert.equal(DOMESTIC_ORDER_INLINE_EDIT_LABELS.historyNote, "이력");
  assert.equal(DOMESTIC_ORDER_INLINE_EDIT_LABELS.etcNote, "기타");
  // 날짜 셋. 표 머리말·카드 이름표와 같은 글자이면서, **검증의 DATE_FIELDS
  // 이름표와도 같아야 한다**(validation/domestic-order-input.ts) — 저장이 거절될
  // 때 그 이름으로 만든 문장이 이 칸 아래에 그대로 뜬다.
  assert.equal(DOMESTIC_ORDER_INLINE_EDIT_LABELS.orderIssuedDate, "발주발행일");
  assert.equal(DOMESTIC_ORDER_INLINE_EDIT_LABELS.quoteIssuedDate, "견적발행일");
  assert.equal(DOMESTIC_ORDER_INLINE_EDIT_LABELS.taxInvoiceDate, "세금계산서발행일");
});

test("⚠️ 납품일과 납기요청일에는 칸 편집이 없다 — 붙이면 앞선 결정이 뒤집힌다", () => {
  /**
   * 날짜 칸 셋이 합류하면서 "남은 날짜도 마저"가 자연스러워 보이게 되었는데,
   * 이 둘은 **일부러** 빠져 있다:
   *
   *  - 납품일(deliveredDate) — 목록이 그리는 것은 이 칼럼이 아니라 연결된 수리
   *    건의 실제 출하일이고, 사람이 적는 값이 아니라서 `줄 수정` 폼에서도
   *    입력칸을 없앴다. 칸 편집을 붙이면 자동으로 따라오던 날짜가 이 줄에
   *    박제된다(파일 아래 납품일 묶음).
   *  - 납기요청일(dueDates) — 한 칸에 날짜가 **여럿**이고 메모가 딸린 별도
   *    표다. 칸 하나에 값 하나라는 이 파일의 전제 자체가 다르다.
   *
   * 이름표 목록에 이름이 오르는 순간 화면이 그 칸을 눌러 고칠 수 있게 그리므로,
   * 여기가 그 둘을 막는 자리다.
   */
  const labelled = Object.keys(DOMESTIC_ORDER_INLINE_EDIT_LABELS);
  assert.equal(labelled.includes("deliveredDate"), false, "납품일은 눌러 고치는 칸이 아니다");
  assert.equal(labelled.includes("dueDates"), false, "납기요청일은 눌러 고치는 칸이 아니다");
  // 계산된 짝도 마찬가지다 — 이름이 오르면 그 이름으로 SET 이 만들어진다.
  assert.equal(labelled.includes("displayDeliveredDate"), false);
});

/**
 * ── 여기부터: 여러 줄짜리 글자 칸 넷 ───────────────────────────────────────
 *
 * 고장내역 · 현황 · 이력 · 기타. 위 다섯과 저장 규칙은 똑같고, 아래 셋이 더
 * 걸린다:
 *
 *  4. 편집칸이 `<textarea>` 여야 한다 — `<input>` 으로 열면 브라우저가 값의
 *     줄바꿈을 말없이 지운 채 넘겨준다. 그 판정은 화면이 아니라
 *     DOMESTIC_ORDER_INLINE_EDIT_MULTILINE 이 한다.
 *  5. 줄바꿈이 든 값이 **한 글자도 깎이지 않고** 실려야 한다 — 고치는 칸도,
 *     함께 실려 가는 나머지 칸도.
 *  6. **고장내역은 원본 칸이 실린다.** 화면이 그리는 것은 계산된
 *     값(reportedSymptom)이라, 이 칸 하나만 "보이는 것"과 "저장되는 것"이 다르다.
 */

/** 이 화면에서 눌러 고칠 수 있는 칸 열둘. 시험이 도는 기준 목록이다. */
const ALL_INLINE_FIELDS: DomesticOrderInlineEditableField[] = [
  "purchaseOrderNumber",
  "projectName",
  "quoteNumber",
  "deliveredBy",
  "japanRemittanceNote",
  "faultDescriptionText",
  "progressNote",
  "historyNote",
  "etcNote",
  "orderIssuedDate",
  "quoteIssuedDate",
  "taxInvoiceDate",
];

/** 여러 줄이 실제로 들어 있는 칸 넷. 값에 줄바꿈이 들어 있다. */
const MULTILINE_FIELDS: DomesticOrderInlineEditableField[] = [
  "faultDescriptionText",
  "progressNote",
  "historyNote",
  "etcNote",
];

/** 달력으로 고르는 칸 셋. 값은 `"YYYY-MM-DD"` 문자열 하나다. */
const DATE_INLINE_FIELDS: DomesticOrderInlineEditableField[] = [
  "orderIssuedDate",
  "quoteIssuedDate",
  "taxInvoiceDate",
];

test("여러 줄 칸 넷을 각각 고쳐도 나머지 열한 칸이 원래 값 그대로 실린다", () => {
  const original = row();
  for (const field of MULTILINE_FIELDS) {
    const built = buildDomesticOrderCellUpdateFields(original, field, "새 값\n둘째 줄");
    assert.equal(built[field], "새 값\n둘째 줄");
    for (const other of ALL_INLINE_FIELDS) {
      if (other === field) continue;
      assert.equal(
        built[other],
        original[other],
        `${field} 을(를) 고치는데 ${other} 가 바뀌었다`
      );
    }
    // 글자 칸 말고도 조용히 지워지는 것들이 함께 실려야 한다.
    assert.equal(built.displayOrder, 3);
    assert.equal(built.paymentCompleted, true);
    assert.deepEqual(built.dueDates, [
      { dueDate: "2026-01-20", note: "1차분" },
      { dueDate: "2026-02-15", note: null },
    ]);
    assert.equal(Object.keys(built).length, 23);
  }
});

test("줄바꿈이 든 값은 한 글자도 깎이지 않고 실린다 — input 으로 열면 조용히 사라지는 그것이다", () => {
  const written = "1차 확인: 전원부 이상\n2차 확인: 부품 대기\n\n메모  칸맞춤";
  for (const field of MULTILINE_FIELDS) {
    const built = buildDomesticOrderCellUpdateFields(row(), field, written);
    assert.equal(built[field], written, `${field} 의 줄바꿈이 깎였다`);
  }
});

test("고치지 않은 여러 줄 칸의 줄바꿈도 그대로 실려 나간다", () => {
  // 현황 하나만 고치는 상황. 이력·기타·고장내역에 들어 있던 줄바꿈이 이 저장에
  // 휩쓸려 뭉개지면, 사람이 제일 길게 적어 둔 칸이 조용히 한 줄이 된다.
  const subject = row({
    faultDescriptionText: "증상 1\n증상 2",
    historyNote: "2026-01-05 접수\n2026-01-20 발주",
    etcNote: "비고 1\n비고 2",
  });
  const built = buildDomesticOrderCellUpdateFields(subject, "progressNote", "수리 완료");

  assert.equal(built.progressNote, "수리 완료");
  assert.equal(built.faultDescriptionText, "증상 1\n증상 2");
  assert.equal(built.historyNote, "2026-01-05 접수\n2026-01-20 발주");
  assert.equal(built.etcNote, "비고 1\n비고 2");
});

test("고장내역은 원본 칸으로 실린다 — 계산된 reportedSymptom 이 끼어들면 안 된다", () => {
  /**
   * ⚠️ **이 시험이 이 칸의 전부다.**
   *
   * 이 줄은 원본 칸이 비어 있어 연결된 수리 건의 증상을 빌려 쓰는 중이고, 화면에는
   * 그 빌려 온 글이 보인다. 사람이 그 칸을 눌러 자기 글을 적으면 **원본 칸**이
   * 그 글로 바뀌어야 한다 — 계산된 값이 실려 나가면, 아무도 건드리지 않은 다른
   * 줄에서까지 수리 건의 증상이 자기 값으로 굳는다.
   */
  const listItem = {
    ...row({ faultDescriptionText: null }),
    displayIntakeNumber: "2026-0099",
    customerName: "주식회사 가나다",
    modelName: "RF-999",
    lotNumber: "LN-999",
    serialNumber: "SN-999",
    // 화면이 그리고 있는 글자. 편집칸에 채우지도, 저장에 싣지도 않는다.
    reportedSymptom: "수리 건에 적힌 증상",
  };

  const built = buildDomesticOrderCellUpdateFields(
    listItem,
    "faultDescriptionText",
    "발주서에 적힌 증상\n(수리 건과 다름)"
  );

  assert.equal(built.faultDescriptionText, "발주서에 적힌 증상\n(수리 건과 다름)");
  assert.equal("reportedSymptom" in built, false, "계산된 값이 함께 실려 나갔다");

  // 고장내역을 고쳤다고 다른 원본 칸이 수리 건 값으로 채워지지도 않는다.
  assert.equal(built.modelNameText, "RF-100");
  assert.equal(built.lotNumberText, "LN-7");
  assert.equal(built.serialNumberText, "SN-9");
});

test("고장내역을 빈 문자열로 지우면 다시 수리 건 값을 빌려 쓰게 된다 — 계산된 값이 굳지 않는다", () => {
  // 빈 문자열을 null 로 접는 일은 검증 한 곳이 한다(파일 헤더). 여기서 계산된
  // 값을 대신 채워 넣으면 "지웠다"가 "수리 건 값을 내 값으로 박았다"가 된다.
  const built = buildDomesticOrderCellUpdateFields(row(), "faultDescriptionText", "");
  assert.equal(built.faultDescriptionText, "");
  assert.equal(built.progressNote, "수리중\n부품 대기");
});

test("여러 줄 칸인지는 값의 성질이 정한다 — 넷만 textarea, 나머지 여덟은 아니다", () => {
  // 이 표가 틀리면 화면이 <input> 을 열고, 그 순간 값의 줄바꿈이 말없이 사라진다.
  assert.deepEqual(
    Object.keys(DOMESTIC_ORDER_INLINE_EDIT_MULTILINE).sort(),
    Object.keys(DOMESTIC_ORDER_INLINE_EDIT_LABELS).sort(),
    "이름표가 있는 칸과 여러 줄 판정이 있는 칸이 어긋난다"
  );
  for (const field of MULTILINE_FIELDS) {
    assert.equal(DOMESTIC_ORDER_INLINE_EDIT_MULTILINE[field], true, `${field} 는 여러 줄 칸이다`);
  }
  for (const field of ALL_INLINE_FIELDS) {
    if (MULTILINE_FIELDS.includes(field)) continue;
    assert.equal(DOMESTIC_ORDER_INLINE_EDIT_MULTILINE[field], false, `${field} 는 한 줄짜리다`);
  }
});

test("고장내역 안내는 연결된 수리 건에 증상이 적혀 있을 때만 나온다", () => {
  const linked = {
    repairCaseId: "11111111-1111-4111-8111-111111111111",
    intakeNumber: "2026-0001",
    repairCaseReportedSymptom: "전원 안 들어옴",
  };

  assert.deepEqual(domesticOrderFaultDescriptionHint(linked), {
    intakeNumber: "2026-0001",
    symptom: "전원 안 들어옴",
  });

  // 연결이 없으면 빌려 올 값 자체가 없다.
  assert.equal(
    domesticOrderFaultDescriptionHint({ ...linked, repairCaseId: null }),
    null
  );

  // 연결은 있지만 그 건에 증상이 안 적혀 있으면, 비워 두어도 아무것도 안 보인다.
  // 그때 "비워 두면 이 값이 그대로 보입니다"는 거짓말이 된다.
  assert.equal(
    domesticOrderFaultDescriptionHint({ ...linked, repairCaseReportedSymptom: null }),
    null
  );
  assert.equal(
    domesticOrderFaultDescriptionHint({ ...linked, repairCaseReportedSymptom: "   " }),
    null
  );

  // 인수번호가 없어도 안내는 나온다 — 없는 것은 번호이지 증상이 아니다.
  assert.deepEqual(domesticOrderFaultDescriptionHint({ ...linked, intakeNumber: null }), {
    intakeNumber: null,
    symptom: "전원 안 들어옴",
  });
  assert.deepEqual(domesticOrderFaultDescriptionHint({ ...linked, intakeNumber: "  " }), {
    intakeNumber: null,
    symptom: "전원 안 들어옴",
  });
});

/**
 * ── ⚠️ 여기부터: 납품일 — 화면에 없는데 반드시 실려야 하는 칸 ──────────────
 *
 * 목록의 `납품일` 은 이제 이 칼럼이 아니라 **연결된 수리 건의 실제 출하일**이고
 * (queries 의 displayDeliveredDate), `줄 수정` 폼에도 입력칸이 없다. 그래서 이
 * 칸은 **화면 어디를 봐도 확인할 수 없는 값**이 되었다 — payload 에서 빠져도
 * 눈으로는 아무도 못 알아채고, 알아챘을 때는 이미 여러 줄에서 지워진 뒤다.
 * 위 열두 칸과 달리 "고쳐 보고 값이 맞나" 볼 자리조차 없으므로, 이 셋이 그
 * 칼럼을 지키는 **유일한** 장치다.
 *
 * ⚠️ 날짜 칸 셋이 눌러 고칠 수 있게 되면서 이 칼럼은 **더 위험해졌다** — 같은
 * 줄의 다른 날짜를 고치는 저장이 이 칸을 함께 실어 나르기 때문이다. 아래 둘째
 * 시험이 열두 칸을 모두 돌므로 날짜 셋도 그 자리에서 함께 막힌다.
 *
 * 손으로 적던 시절의 값은 되돌릴 수 있도록 DB 에 남겨 두기로 한 것이지, 버리기로
 * 한 것이 아니다 — 화면에서 안 보여 주는 것과 자료를 지우는 것은 다른 결정이다.
 */

test("⚠️ 납품일은 화면에 없어도 원래 값 그대로 실린다 — 빠지면 저장 한 번에 지워진다", () => {
  const subject = row();
  const built = buildDomesticOrderCellUpdateFields(subject, "quoteNumber", "Q-9");

  // 키가 있어야 하고(없으면 검증이 undefined 를 null 로 접는다),
  assert.equal("deliveredDate" in built, true, "deliveredDate 키가 빠졌다 — 그 칼럼이 지워진다");
  // 값이 읽어 온 그대로여야 한다(다른 값으로 바뀌어도 자료가 어긋난다).
  assert.equal(built.deliveredDate, "2026-02-20");
  assert.equal(built.deliveredDate, subject.deliveredDate);
});

test("⚠️ 열두 칸 중 무엇을 고쳐도 납품일은 그대로다 — 한 경로만 새도 자료가 샌다", () => {
  const subject = row();
  for (const field of ALL_INLINE_FIELDS) {
    const built = buildDomesticOrderCellUpdateFields(subject, field, "새 값");
    assert.equal(built.deliveredDate, "2026-02-20", `${field} 을(를) 고치는데 납품일이 바뀌었다`);
  }
  // 비어 있던 줄은 비어 있는 채로 남는다 — 없던 날짜가 생기는 것도 곤란하다.
  const empty = buildDomesticOrderCellUpdateFields(
    row({ deliveredDate: null }),
    "progressNote",
    "수리 완료"
  );
  assert.equal(empty.deliveredDate, null);
});

test("⚠️ 계산된 납품일(displayDeliveredDate)은 실리지 않는다 — 담길 칼럼조차 없다", () => {
  /**
   * 목록 한 줄에는 원본 칸(deliveredDate)과 계산된 값(displayDeliveredDate)이
   * 함께 들어 있다. 화면이 그리는 것은 계산된 쪽이라 실수로 집어 오기 쉽고,
   * 그것이 원본 칸에 담기면 자동으로 따라오던 실제 출하일이 이 줄에 박제된다 —
   * 고장내역과 같은 함정이다(파일 헤더의 함정 ②).
   */
  const listItem = {
    ...row({ deliveredDate: "2026-03-31" }),
    // 화면이 지금 그리고 있는 날짜. 연결된 수리 건의 실제 출하일이다.
    displayDeliveredDate: "2025-11-14",
    repairCaseActualShipmentDate: "2025-11-14",
  };

  const built = buildDomesticOrderCellUpdateFields(listItem, "deliveredBy", "김유진");

  // 실리는 것은 원본 칸이고, 값은 손으로 적던 그 값 그대로다.
  assert.equal(built.deliveredDate, "2026-03-31");
  // 계산된 값도, 조인해 온 수리 건의 칸도 키 자체가 없어야 한다.
  assert.equal("displayDeliveredDate" in built, false, "계산된 값이 함께 실려 나갔다");
  assert.equal("repairCaseActualShipmentDate" in built, false, "수리 건의 칸이 실려 나갔다");
  // 키 개수는 그대로 23개다 — 늘었다면 무언가가 몰래 끼어든 것이다.
  assert.equal(Object.keys(built).length, 23);
});

/**
 * ── 여기부터: 날짜 칸 셋 ───────────────────────────────────────────────────
 *
 * 발주발행일 · 견적발행일 · 세금계산서발행일. 보내는 값을 만드는 규칙은 위
 * 아홉과 똑같고(`"YYYY-MM-DD"` 문자열 하나다), 아래 넷이 더 걸린다:
 *
 *  7. 이 셋을 고치는 저장에서도 **납품일이 살아남아야 한다.** 바로 위 묶음이
 *     지키던 그 칼럼인데, 이제 그것을 실어 나르는 경로가 셋 늘었다.
 *  8. **빈 값으로 지울 수 있어야 한다.** 세 칸 다 비어 있는 것이 정상이라
 *     (발주가 아직 안 난 줄, 견적만 나간 줄), 지우는 길이 막히면 한 번 잘못
 *     적은 날짜를 되돌릴 방법이 없다. 빈 문자열을 null 로 접는 일은 검증
 *     한 곳이 하므로, 여기서는 **손대지 않고 그대로** 나가야 한다.
 *  9. **편집칸이 `<input type="date">` 여야 한다.** 글자 칸으로 열리면 사람이
 *     `2026.5.11` 처럼 쳐서 저장할 때마다 검증에 걸린다. 그 판정은 화면이
 *     아니라 …_INLINE_EDIT_DATE 와 domesticOrderInlineEditControl 이 한다.
 * 10. **발주발행일에만 년도 안내가 붙는다.** 이 목록은 그 칸의 년도로 줄을
 *     가르므로, 다른 해로 고치면 그 줄이 지금 보고 있는 해에서 사라진다.
 *     년도와 상관없는 다른 칸에까지 그 말이 붙으면 있지도 않은 규칙을 설명하는
 *     문장이 된다.
 */

test("날짜 칸 셋을 각각 고쳐도 나머지 22칸이 원래 값 그대로 실린다 — 납품일 포함", () => {
  const original = row();
  for (const field of DATE_INLINE_FIELDS) {
    const built = buildDomesticOrderCellUpdateFields(original, field, "2027-03-09");

    // 고친 칸만 새 값이다.
    assert.equal(built[field], "2027-03-09");

    // ⚠️ 화면 어디에도 안 보이는 칸이라, 여기서 새면 눈으로는 아무도 못
    // 알아챈다(위 납품일 묶음).
    assert.equal(built.deliveredDate, "2026-02-20", `${field} 을(를) 고치는데 납품일이 바뀌었다`);

    // 나머지 22칸은 읽어 온 값 그대로여야 한다. 목록을 손으로 늘어놓지 않고
    // 기준 키 목록을 도는 것은, 칸이 하나 늘어난 날 이 시험이 함께 자라게
    // 하기 위해서다.
    for (const key of COLLECT_FIELDS_KEYS) {
      if (key === field) continue;
      if (key === "dueDates") {
        assert.deepEqual(built.dueDates, [
          { dueDate: "2026-01-20", note: "1차분" },
          { dueDate: "2026-02-15", note: null },
        ]);
        continue;
      }
      assert.equal(built[key], original[key], `${field} 을(를) 고치는데 ${key} 가 바뀌었다`);
    }

    // 키 개수는 그대로 23개다 — 날짜 칸이 자기 이름으로 키를 하나 더 만들면
    // (예: orderIssuedDate 를 안 지우고 덧붙이면) 여기서 걸린다.
    assert.equal(Object.keys(built).length, 23);
  }
});

test("날짜 칸을 고쳐도 다른 두 날짜는 그대로다 — 세 칸이 한 칸처럼 움직이면 안 된다", () => {
  const built = buildDomesticOrderCellUpdateFields(row(), "quoteIssuedDate", "2026-05-11");
  assert.equal(built.quoteIssuedDate, "2026-05-11");
  assert.equal(built.orderIssuedDate, "2026-01-05");
  assert.equal(built.taxInvoiceDate, "2026-02-25");
});

test("날짜를 빈 값으로 지우면 빈 문자열 그대로 나간다 — null 로 접는 일은 검증 한 곳이 한다", () => {
  /**
   * `<input type="date">` 를 비우면 빈 문자열이 온다. 그것을 여기서 null 로
   * 미리 접으면 규칙이 두 곳에 생기고, `줄 수정` 폼으로 지웠을 때와 결과가
   * 달라질 여지가 생긴다(파일 헤더의 '값은 손대지 않고').
   */
  const original = row();
  for (const field of DATE_INLINE_FIELDS) {
    const built = buildDomesticOrderCellUpdateFields(original, field, "");
    assert.equal(built[field], "", `${field} 을(를) 지운 값이 다듬어졌다`);
    // 지우는 저장에서도 나머지는 그대로다 — 특히 화면에 없는 납품일.
    assert.equal(built.deliveredDate, "2026-02-20");
    assert.deepEqual(built.dueDates, [
      { dueDate: "2026-01-20", note: "1차분" },
      { dueDate: "2026-02-15", note: null },
    ]);
    assert.equal(Object.keys(built).length, 23);
  }
});

test("원래 비어 있던 날짜 칸도 적을 수 있다 — 빈 칸을 눌러 채우는 길이 막히면 안 된다", () => {
  // 발주발행일이 없는 줄(`발주일 미정`)이 실제로 있고, 그 줄이야말로 이 칸을
  // 눌러 적게 되는 줄이다.
  const built = buildDomesticOrderCellUpdateFields(
    row({ orderIssuedDate: null, taxInvoiceDate: null }),
    "orderIssuedDate",
    "2026-04-01"
  );
  assert.equal(built.orderIssuedDate, "2026-04-01");
  // 함께 비어 있던 칸은 비어 있는 채로 남는다.
  assert.equal(built.taxInvoiceDate, null);
});

test("날짜 칸은 형식을 여기서 검사하지 않는다 — 관문은 검증 한 곳뿐이다", () => {
  /**
   * `2026-02-31` 은 형식은 맞지만 없는 날이고, `2026.5.11` 은 형식부터 다르다.
   * 둘 다 **검증의 normalizeDate 가** 막는다(validation/domestic-order-input.ts).
   * 여기서 미리 거르면 규칙이 두 벌이 되어, 한쪽만 고쳐지는 날 화면과 서버가
   * 서로 다른 날짜를 받아 준다. 그래서 이 함수는 받은 글자를 그대로 넘긴다.
   */
  for (const written of ["2026-02-31", "2026.5.11", "  "]) {
    const built = buildDomesticOrderCellUpdateFields(row(), "orderIssuedDate", written);
    assert.equal(built.orderIssuedDate, written);
  }
});

test("날짜 판정 표는 이름표가 있는 칸과 어긋나지 않는다", () => {
  assert.deepEqual(
    Object.keys(DOMESTIC_ORDER_INLINE_EDIT_DATE).sort(),
    Object.keys(DOMESTIC_ORDER_INLINE_EDIT_LABELS).sort(),
    "이름표가 있는 칸과 날짜 판정이 있는 칸이 어긋난다"
  );
  for (const field of DATE_INLINE_FIELDS) {
    assert.equal(DOMESTIC_ORDER_INLINE_EDIT_DATE[field], true, `${field} 는 날짜 칸이다`);
  }
  for (const field of ALL_INLINE_FIELDS) {
    if (DATE_INLINE_FIELDS.includes(field)) continue;
    assert.equal(DOMESTIC_ORDER_INLINE_EDIT_DATE[field], false, `${field} 는 날짜 칸이 아니다`);
  }
});

test("⚠️ 날짜이면서 여러 줄인 칸은 없다 — 있으면 여러 줄 판정이 말없이 무시된다", () => {
  // 편집칸을 고를 때 날짜를 먼저 보므로(domesticOrderInlineEditControl), 둘 다
  // true 인 칸이 생기면 textarea 로 열리기를 기대한 칸이 date 로 열린다.
  for (const field of ALL_INLINE_FIELDS) {
    assert.equal(
      DOMESTIC_ORDER_INLINE_EDIT_DATE[field] && DOMESTIC_ORDER_INLINE_EDIT_MULTILINE[field],
      false,
      `${field} 가 날짜이면서 여러 줄로 적혀 있다`
    );
  }
});

test("편집칸 종류는 칸마다 하나로 정해진다 — 날짜 셋 · textarea 넷 · 나머지 다섯", () => {
  // 화면이 물어보는 것은 이 함수 하나뿐이다. 표와 카드가 각각 갈래를 만들면
  // 한쪽만 틀릴 수 있고, 틀리면 값이 조용히 깎이거나 저장이 매번 거절된다.
  assert.equal(domesticOrderInlineEditControl("orderIssuedDate"), "date");
  assert.equal(domesticOrderInlineEditControl("quoteIssuedDate"), "date");
  assert.equal(domesticOrderInlineEditControl("taxInvoiceDate"), "date");
  assert.equal(domesticOrderInlineEditControl("faultDescriptionText"), "textarea");
  assert.equal(domesticOrderInlineEditControl("progressNote"), "textarea");
  assert.equal(domesticOrderInlineEditControl("historyNote"), "textarea");
  assert.equal(domesticOrderInlineEditControl("etcNote"), "textarea");
  assert.equal(domesticOrderInlineEditControl("purchaseOrderNumber"), "text");
  assert.equal(domesticOrderInlineEditControl("projectName"), "text");
  assert.equal(domesticOrderInlineEditControl("quoteNumber"), "text");
  assert.equal(domesticOrderInlineEditControl("deliveredBy"), "text");
  assert.equal(domesticOrderInlineEditControl("japanRemittanceNote"), "text");

  // 열두 칸 전부가 셋 중 하나로 정해진다 — 판정이 없는 칸이 생기면 화면이 무엇을
  // 열어야 할지 모른다.
  for (const field of ALL_INLINE_FIELDS) {
    assert.ok(
      ["date", "textarea", "text"].includes(domesticOrderInlineEditControl(field)),
      `${field} 의 편집칸 종류가 없다`
    );
  }
});

test("년도 안내는 발주발행일에만 붙는다 — 그 칸만 목록에서 줄을 사라지게 한다", () => {
  const notice = domesticOrderInlineEditYearNotice("orderIssuedDate");
  assert.notEqual(notice, null);
  // 두 줄이다. 다른 해로 바꾸는 쪽과 비우는 쪽은 결과가 정반대라(사라진다 /
  // 어느 해에서도 보인다) 한 문장으로 뭉뚱그릴 수 없다.
  assert.equal(notice?.length, 2);
  assert.ok(notice?.[0].includes("발주발행일"));
  assert.ok(notice?.[0].includes("사라집니다"));
  assert.ok(notice?.[1].includes("비워 두면"));

  // 나머지 열한 칸에는 붙지 않는다. 특히 다른 날짜 둘 — 년도 거르기와 아무
  // 상관이 없는데 같은 말이 붙으면, 있지도 않은 규칙을 설명하는 문장이 된다.
  for (const field of ALL_INLINE_FIELDS) {
    if (field === "orderIssuedDate") continue;
    assert.equal(
      domesticOrderInlineEditYearNotice(field),
      null,
      `${field} 에 년도 안내가 붙었다`
    );
  }
});
