import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_QUOTE_ITEMS,
  isValidExpectedVersion,
  isValidQuoteId,
  validateQuoteFields,
} from "./quote-input";

const VALID_UUID = "11111111-2222-3333-4444-555555555555";

const MINIMAL = {
  quoteNumber: "DSS 2026-077",
  quoteDate: "2026-08-28",
  customerNameText: "ICD Co.,Ltd",
  subject: "CFK300FH-IC2 수리 견적",
};

function ok(raw: Record<string, unknown>) {
  const result = validateQuoteFields(raw);
  assert.equal(result.ok, true, `통과할 줄 알았는데 실패: ${JSON.stringify(result)}`);
  assert.ok(result.ok);
  return result.data;
}

function errors(raw: Record<string, unknown>) {
  const result = validateQuoteFields(raw);
  assert.equal(result.ok, false, "실패할 줄 알았는데 통과했다");
  assert.ok(!result.ok);
  return result.fieldErrors;
}

test("필수 넷만 있으면 통과한다 — 나머지는 전부 비워도 된다", () => {
  const data = ok(MINIMAL);
  assert.equal(data.quoteNumber, "DSS 2026-077");
  assert.equal(data.quoteDate, "2026-08-28");
  assert.equal(data.customerNameText, "ICD Co.,Ltd");
  assert.equal(data.subject, "CFK300FH-IC2 수리 견적");
  // 모델명·L/N·S/N 이 없는 견적(부품만 파는 경우)이 실제로 있다.
  assert.equal(data.modelNameText, null);
  assert.equal(data.lotNumberText, null);
  assert.equal(data.serialNumberText, null);
  assert.deepEqual(data.items, []);
  assert.equal(data.workCost, "0");
});

test("필수 넷이 비면 칸마다 오류가 붙는다", () => {
  const fieldErrors = errors({});
  assert.match(fieldErrors.quoteNumber, /발행번호/);
  assert.match(fieldErrors.quoteDate, /발행일자/);
  assert.match(fieldErrors.customerNameText, /공급처/);
  assert.match(fieldErrors.subject, /품명/);
});

test("공백만 적은 값은 비어 있는 것으로 본다", () => {
  assert.match(errors({ ...MINIMAL, quoteNumber: "   " }).quoteNumber, /발행번호/);
  assert.equal(ok({ ...MINIMAL, modelNameText: "   " }).modelNameText, null);
});

test("발행일자는 실제 달력에 있는 날이어야 한다", () => {
  assert.match(errors({ ...MINIMAL, quoteDate: "2026-02-30" }).quoteDate, /YYYY-MM-DD/);
  assert.match(errors({ ...MINIMAL, quoteDate: "26-08-28" }).quoteDate, /YYYY-MM-DD/);
  assert.equal(ok({ ...MINIMAL, quoteDate: "2024-02-29" }).quoteDate, "2024-02-29");
});

test("유효기간·납기·결재조건은 비면 null — 양식 문구를 그대로 쓴다는 뜻이다", () => {
  const data = ok(MINIMAL);
  assert.equal(data.validity, null);
  assert.equal(data.delivery, null);
  assert.equal(data.payment, null);
  assert.equal(ok({ ...MINIMAL, validity: "발행일로부터 8주" }).validity, "발행일로부터 8주");
});

test("금액: 쉼표를 지우고 문자열 그대로 둔다 — Number 를 거치면 오차가 쌓인다", () => {
  assert.equal(ok({ ...MINIMAL, workCost: "1,200,000" }).workCost, "1200000");
  assert.equal(ok({ ...MINIMAL, workCost: "1234.50" }).workCost, "1234.50");
  assert.equal(ok({ ...MINIMAL, workCost: 1200000 }).workCost, "1200000");
});

test("금액: numeric(15,2) 폭을 넘거나 형식이 아니면 거절한다", () => {
  // 정수부 14자리 — DB 에서 22003 이 나기 전에 여기서 잡는다.
  assert.match(errors({ ...MINIMAL, workCost: "12345678901234" }).workCost, /작업비/);
  assert.match(errors({ ...MINIMAL, workCost: "1.234" }).workCost, /작업비/);
  assert.match(errors({ ...MINIMAL, workCost: "-100" }).workCost, /작업비/);
  assert.match(errors({ ...MINIMAL, workCost: "삼백만" }).workCost, /작업비/);
});

test("부품 줄: 정상 입력", () => {
  const data = ok({
    ...MINIMAL,
    items: [
      { partId: VALID_UUID, partNameText: "Bias Board ASSY", quantity: 1, unitPrice: "1850000" },
      { partId: null, partNameText: "냉각 팬", quantity: 2, unitPrice: "45,000" },
    ],
  });
  assert.equal(data.items.length, 2);
  assert.equal(data.items[0].partId, VALID_UUID);
  assert.equal(data.items[1].partId, null);
  assert.equal(data.items[1].unitPrice, "45000");
});

test("부품 줄의 오류는 줄 번호를 낀 키로 온다 — 다섯째가 틀렸는데 첫 줄에 붙으면 안 된다", () => {
  const fieldErrors = errors({
    ...MINIMAL,
    items: [
      { partNameText: "정상", quantity: 1, unitPrice: "100" },
      { partNameText: "", quantity: 1, unitPrice: "100" },
      { partNameText: "수량0", quantity: 0, unitPrice: "100" },
      { partNameText: "단가이상", quantity: 1, unitPrice: "abc" },
    ],
  });
  assert.ok(!fieldErrors["items.0.partNameText"]);
  assert.match(fieldErrors["items.1.partNameText"], /2번째/);
  assert.match(fieldErrors["items.2.quantity"], /3번째/);
  assert.match(fieldErrors["items.3.unitPrice"], /4번째/);
});

test("수량은 1 이상의 정수여야 한다 — CHECK 제약과 같은 규칙", () => {
  assert.match(errors({ ...MINIMAL, items: [{ partNameText: "a", quantity: 0, unitPrice: "1" }] })["items.0.quantity"], /수량/);
  assert.match(errors({ ...MINIMAL, items: [{ partNameText: "a", quantity: -1, unitPrice: "1" }] })["items.0.quantity"], /수량/);
  assert.match(errors({ ...MINIMAL, items: [{ partNameText: "a", quantity: 1.5, unitPrice: "1" }] })["items.0.quantity"], /수량/);
});

test("단가 0 은 허용한다 — 무상 교체 부품을 견적서에 적어 보이는 일이 있다", () => {
  const data = ok({ ...MINIMAL, items: [{ partNameText: "무상 교체", quantity: 1, unitPrice: "0" }] });
  assert.equal(data.items[0].unitPrice, "0");
});

test("부품 다섯 줄을 넘어도 통과한다 — 합산은 xlsx 를 만들 때만 일어난다", () => {
  const items = Array.from({ length: 7 }, (_, i) => ({
    partNameText: `부품 ${i + 1}`,
    quantity: 1,
    unitPrice: "10000",
  }));
  assert.equal(ok({ ...MINIMAL, items }).items.length, 7);
});

test("부품 줄 상한을 넘으면 거절한다 — 상한이 곧 안전장치다", () => {
  const items = Array.from({ length: MAX_QUOTE_ITEMS + 1 }, (_, i) => ({
    partNameText: `부품 ${i + 1}`,
    quantity: 1,
    unitPrice: "1",
  }));
  assert.match(errors({ ...MINIMAL, items }).items, new RegExp(String(MAX_QUOTE_ITEMS)));
});

/**
 * ============================================================================
 * 통전작업 제외 — 결정(boolean)과 그때 뺀 금액(numeric)은 서로 다른 칸이다
 * ============================================================================
 * 하나로 합치면 "제외하기로 했으나 통전 공수시간이 없어 빼지 못했다"는 상태를
 * 적을 자리가 없다(schema/quotes.ts 의 그 항목).
 * ============================================================================
 */
test("통전작업 제외: 안 보내면 꺼짐이고 뺀 금액은 null 이다 — 옛 요청이 그대로 동작한다", () => {
  const data = ok(MINIMAL);
  assert.equal(data.powerTestExcluded, false);
  assert.equal(data.laborPowerTestDeduction, null, "null 은 '빼지 않았다'이다");
});

test("통전작업 제외: 켰다고 말한 것만 켜진다 — 140만원이 실수로 빠지면 안 된다", () => {
  assert.equal(ok({ ...MINIMAL, powerTestExcluded: true }).powerTestExcluded, true);
  for (const value of ["true", 1, "on", {}, null, undefined]) {
    assert.equal(
      ok({ ...MINIMAL, powerTestExcluded: value }).powerTestExcluded,
      false,
      `${JSON.stringify(value)} 가 켜짐으로 읽혔다`
    );
  }
});

test("통전작업 제외: 뺀 금액도 문자열 그대로 둔다 — 다른 금액 칸과 같은 규칙", () => {
  const data = ok({
    ...MINIMAL,
    powerTestExcluded: true,
    laborPowerTestDeduction: "1,400,000",
  });
  assert.equal(data.laborPowerTestDeduction, "1400000");
  assert.equal(
    ok({ ...MINIMAL, laborPowerTestDeduction: "0" }).laborPowerTestDeduction,
    "0",
    "'0' 은 '빼기는 했는데 0원'이라 null 과 다르다"
  );
});

test("통전작업 제외: 음수나 형식이 아닌 뺀 금액은 거절한다 — CHECK 제약과 같은 규칙", () => {
  const bad = errors({ ...MINIMAL, laborPowerTestDeduction: "-1400000" });
  assert.match(bad.laborPowerTestDeduction, /통전작업 제외 금액/);
  assert.match(errors({ ...MINIMAL, laborPowerTestDeduction: "백사십만" }).laborPowerTestDeduction, /통전작업/);
});

test("id 형식", () => {
  assert.equal(isValidQuoteId(VALID_UUID), true);
  assert.equal(isValidQuoteId("nope"), false);
  assert.equal(isValidQuoteId(123), false);
  assert.match(errors({ ...MINIMAL, repairCaseId: "nope" }).repairCaseId, /수리 건/);
  assert.equal(ok({ ...MINIMAL, repairCaseId: "" }).repairCaseId, null);
});

test("expectedVersion 은 1 이상의 정수다", () => {
  assert.equal(isValidExpectedVersion(1), true);
  assert.equal(isValidExpectedVersion(0), false);
  assert.equal(isValidExpectedVersion(-1), false);
  assert.equal(isValidExpectedVersion(1.5), false);
  assert.equal(isValidExpectedVersion("1"), false);
});
