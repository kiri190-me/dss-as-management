import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidDomesticOrderId,
  isValidExpectedVersion,
  validateDomesticOrderFields,
} from "./domestic-order-input";

/**
 * 내자 정리 입력 검증. 여기서 지키려는 것은 두 가지다 —
 * **비어 있는 값은 전부 null 한 가지 모양이 된다**(빈칸이 세 종류로 저장되면
 * 목록에서 같은 "-"로 보이는 값이 서로 다른 값이 된다), 그리고
 * **틀린 칸은 그 칸의 이름으로 돌아온다**(18칸짜리 폼에서 "확인해 주세요" 한
 * 줄만 돌려주면 사용자는 어디가 틀렸는지 찾지 못한다).
 */

/** 통과하는 최소 입력 — 이 표에는 필수 칸이 하나도 없다. */
function emptyInput(): Record<string, unknown> {
  return {};
}

test("isValidDomesticOrderId는 UUID만 받는다", () => {
  assert.equal(isValidDomesticOrderId("11111111-1111-4111-8111-111111111111"), true);
  assert.equal(isValidDomesticOrderId("not-a-uuid"), false);
  assert.equal(isValidDomesticOrderId(""), false);
  assert.equal(isValidDomesticOrderId(123), false);
  assert.equal(isValidDomesticOrderId(null), false);
});

test("isValidExpectedVersion은 1 이상의 정수만 받는다", () => {
  assert.equal(isValidExpectedVersion(1), true);
  assert.equal(isValidExpectedVersion(42), true);
  assert.equal(isValidExpectedVersion(0), false);
  assert.equal(isValidExpectedVersion(-1), false);
  assert.equal(isValidExpectedVersion(1.5), false);
  assert.equal(isValidExpectedVersion("1"), false);
  assert.equal(isValidExpectedVersion(null), false);
});

test("빈 입력도 통과한다 — 이 표에는 필수 칸이 없다", () => {
  const result = validateDomesticOrderFields(emptyInput());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data, {
    repairCaseId: null,
    intakeNumberText: null,
    displayOrder: null,
    purchaseOrderNumber: null,
    projectName: null,
    orderIssuedDate: null,
    requestedDueDate: null,
    quoteIssuedDate: null,
    quoteNumber: null,
    progressNote: null,
    deliveredDate: null,
    deliveredBy: null,
    taxInvoiceDate: null,
    amountExcludingVat: null,
    paymentCompleted: false,
    japanRemittanceNote: null,
    historyNote: null,
    etcNote: null,
  });
});

test("빈 문자열·공백만 적힌 값은 전부 null 한 가지 모양이 된다", () => {
  const result = validateDomesticOrderFields({
    purchaseOrderNumber: "",
    projectName: "   ",
    progressNote: "\n\t ",
    orderIssuedDate: "",
    amountExcludingVat: "",
    displayOrder: "",
    repairCaseId: "",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.purchaseOrderNumber, null);
  assert.equal(result.data.projectName, null);
  assert.equal(result.data.progressNote, null);
  assert.equal(result.data.orderIssuedDate, null);
  assert.equal(result.data.amountExcludingVat, null);
  assert.equal(result.data.displayOrder, null);
  assert.equal(result.data.repairCaseId, null);
});

test("글자 칸은 앞뒤 공백을 떼고 저장한다", () => {
  const result = validateDomesticOrderFields({
    purchaseOrderNumber: "  PO-2026-001  ",
    deliveredBy: " 김유진 ",
    etcNote: "  두 줄\n메모  ",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.purchaseOrderNumber, "PO-2026-001");
  assert.equal(result.data.deliveredBy, "김유진");
  assert.equal(result.data.etcNote, "두 줄\n메모");
});

// ─────────────────────────────────────────────────────────────── 날짜 5종

test("날짜 5종은 YYYY-MM-DD 형식을 받는다", () => {
  const result = validateDomesticOrderFields({
    orderIssuedDate: "2026-01-05",
    requestedDueDate: "2026-02-28",
    quoteIssuedDate: "2026-03-01",
    deliveredDate: "2026-04-30",
    taxInvoiceDate: "2026-12-31",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.orderIssuedDate, "2026-01-05");
  assert.equal(result.data.requestedDueDate, "2026-02-28");
  assert.equal(result.data.quoteIssuedDate, "2026-03-01");
  assert.equal(result.data.deliveredDate, "2026-04-30");
  assert.equal(result.data.taxInvoiceDate, "2026-12-31");
});

test("형식은 맞지만 존재하지 않는 날짜는 거부한다", () => {
  // 2026년 2월은 28일까지다. 형식만 보면 통과하지만 Postgres 는 거절한다.
  const result = validateDomesticOrderFields({ orderIssuedDate: "2026-02-31" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.fieldErrors.orderIssuedDate);
});

test("YYYY-MM-DD가 아닌 날짜 표기는 거부한다", () => {
  for (const value of ["2026/01/05", "26-01-05", "2026-1-5", "2026-01-05T00:00:00Z", "어제"]) {
    const result = validateDomesticOrderFields({ deliveredDate: value });
    assert.equal(result.ok, false, value);
    if (result.ok) continue;
    assert.ok(result.fieldErrors.deliveredDate, value);
  }
});

test("날짜 칸에 문자열이 아닌 값이 오면 그 칸의 오류가 된다", () => {
  const result = validateDomesticOrderFields({ taxInvoiceDate: 20260105 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.fieldErrors.taxInvoiceDate);
});

// ─────────────────────────────────────────────────────────────── 금액

test("금액은 소수 둘째 자리까지 받는다", () => {
  for (const [input, expected] of [
    ["1000", "1000"],
    ["1000.5", "1000.5"],
    ["1000.50", "1000.50"],
    ["0", "0"],
  ] as const) {
    const result = validateDomesticOrderFields({ amountExcludingVat: input });
    assert.equal(result.ok, true, input);
    if (!result.ok) continue;
    assert.equal(result.data.amountExcludingVat, expected, input);
  }
});

test("금액의 쉼표는 걷어 낸다 — 목록에 보이던 모양 그대로 붙여 넣을 수 있어야 한다", () => {
  const result = validateDomesticOrderFields({ amountExcludingVat: " 1,234,567.89 " });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.amountExcludingVat, "1234567.89");
});

test("금액은 음수일 수 없다", () => {
  const result = validateDomesticOrderFields({ amountExcludingVat: "-1" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.fieldErrors.amountExcludingVat);
});

test("금액의 소수 셋째 자리는 거부한다", () => {
  const result = validateDomesticOrderFields({ amountExcludingVat: "100.005" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.fieldErrors.amountExcludingVat);
});

test("금액이 numeric(15,2)의 정수부 13자리를 넘으면 거부한다", () => {
  const ok = validateDomesticOrderFields({ amountExcludingVat: "9".repeat(13) });
  assert.equal(ok.ok, true);

  const tooWide = validateDomesticOrderFields({ amountExcludingVat: "9".repeat(14) });
  assert.equal(tooWide.ok, false);
  if (tooWide.ok) return;
  assert.ok(tooWide.fieldErrors.amountExcludingVat);
});

test("숫자가 아닌 금액은 거부한다", () => {
  for (const value of ["일억", "1e5", "1.2.3", "100원"]) {
    const result = validateDomesticOrderFields({ amountExcludingVat: value });
    assert.equal(result.ok, false, value);
  }
});

// ─────────────────────────────────────────────────────────────── 순번

test("순번은 양의 정수를 받는다 — 문자열로 와도 숫자로 저장한다", () => {
  const fromString = validateDomesticOrderFields({ displayOrder: "12" });
  assert.equal(fromString.ok, true);
  if (fromString.ok) assert.equal(fromString.data.displayOrder, 12);

  const fromNumber = validateDomesticOrderFields({ displayOrder: 7 });
  assert.equal(fromNumber.ok, true);
  if (fromNumber.ok) assert.equal(fromNumber.data.displayOrder, 7);
});

test("순번이 0·음수·소수·글자면 거부한다", () => {
  for (const value of [0, -1, 1.5, "0", "-3", "1.5", "일", "3개"]) {
    const result = validateDomesticOrderFields({ displayOrder: value });
    assert.equal(result.ok, false, String(value));
    if (result.ok) continue;
    assert.ok(result.fieldErrors.displayOrder, String(value));
  }
});

test("순번이 integer 컬럼의 상한을 넘으면 거부한다", () => {
  const ok = validateDomesticOrderFields({ displayOrder: 2_147_483_647 });
  assert.equal(ok.ok, true);

  const overflow = validateDomesticOrderFields({ displayOrder: 2_147_483_648 });
  assert.equal(overflow.ok, false);
});

// ─────────────────────────────────────────────────────────── 길이 상한

test("짧은 칸은 200자를 넘으면 거부한다", () => {
  for (const key of [
    "intakeNumberText",
    "purchaseOrderNumber",
    "projectName",
    "quoteNumber",
    "deliveredBy",
    "japanRemittanceNote",
  ]) {
    const ok = validateDomesticOrderFields({ [key]: "가".repeat(200) });
    assert.equal(ok.ok, true, key);

    const tooLong = validateDomesticOrderFields({ [key]: "가".repeat(201) });
    assert.equal(tooLong.ok, false, key);
    if (tooLong.ok) continue;
    assert.ok(tooLong.fieldErrors[key], key);
  }
});

test("긴 칸(현황·이력·기타)은 4000자까지 받는다", () => {
  for (const key of ["progressNote", "historyNote", "etcNote"]) {
    const ok = validateDomesticOrderFields({ [key]: "가".repeat(4000) });
    assert.equal(ok.ok, true, key);

    const tooLong = validateDomesticOrderFields({ [key]: "가".repeat(4001) });
    assert.equal(tooLong.ok, false, key);
    if (tooLong.ok) continue;
    assert.ok(tooLong.fieldErrors[key], key);
  }
});

// ────────────────────────────────────────────── 수리 건 연결 · 입금완료

test("수리 건 연결은 UUID이거나 비어 있어야 한다", () => {
  const linked = validateDomesticOrderFields({
    repairCaseId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(linked.ok, true);
  if (linked.ok) assert.equal(linked.data.repairCaseId, "11111111-1111-4111-8111-111111111111");

  const broken = validateDomesticOrderFields({ repairCaseId: "D2601-001" });
  assert.equal(broken.ok, false);
  if (broken.ok) return;
  assert.ok(broken.fieldErrors.repairCaseId);
});

test("입금완료 여부는 값이 없으면 false다 — 시트의 빈칸은 '아직 안 들어왔다'는 뜻이다", () => {
  const missing = validateDomesticOrderFields({});
  assert.equal(missing.ok, true);
  if (missing.ok) assert.equal(missing.data.paymentCompleted, false);

  const explicit = validateDomesticOrderFields({ paymentCompleted: true });
  assert.equal(explicit.ok, true);
  if (explicit.ok) assert.equal(explicit.data.paymentCompleted, true);
});

test("입금완료 여부가 불리언이 아니면 거부한다 — '아니오'를 참으로 읽지 않는다", () => {
  for (const value of ["true", "false", 1, 0]) {
    const result = validateDomesticOrderFields({ paymentCompleted: value });
    assert.equal(result.ok, false, String(value));
    if (result.ok) continue;
    assert.ok(result.fieldErrors.paymentCompleted, String(value));
  }
});

// ─────────────────────────────────────────────────────────────── 종합

test("틀린 칸이 여럿이면 전부 한 번에 돌려준다", () => {
  const result = validateDomesticOrderFields({
    orderIssuedDate: "2026-13-01",
    amountExcludingVat: "-5",
    displayOrder: "0",
    quoteNumber: "가".repeat(201),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(
    Object.keys(result.fieldErrors).sort(),
    ["amountExcludingVat", "displayOrder", "orderIssuedDate", "quoteNumber"]
  );
});

test("오류 문구는 한국어다", () => {
  const result = validateDomesticOrderFields({ amountExcludingVat: "-1", displayOrder: "0" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  for (const message of Object.values(result.fieldErrors)) {
    assert.match(message, /[가-힣]/, message);
  }
});

test("고객사·형식·L/N·S/N·고장내역은 받지 않는다 — 수리 건에서 따라오는 값이다", () => {
  const result = validateDomesticOrderFields({
    customerId: "11111111-1111-4111-8111-111111111111",
    customerName: "몰래 넣은 고객사",
    modelName: "몰래 넣은 형식",
    lotNumber: "L1",
    serialNumber: "S1",
    reportedSymptom: "몰래 넣은 고장내역",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // 조용히 무시된다 — data 에 그 키가 아예 없으므로 mutation 이 쓸 수도 없다.
  assert.equal("customerId" in result.data, false);
  assert.equal("customerName" in result.data, false);
  assert.equal("modelName" in result.data, false);
  assert.equal("lotNumber" in result.data, false);
  assert.equal("serialNumber" in result.data, false);
  assert.equal("reportedSymptom" in result.data, false);
});
