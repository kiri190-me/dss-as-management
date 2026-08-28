import assert from "node:assert/strict";
import { test } from "node:test";

import { parseUnitPriceValue, validatePartUnitPriceEntries } from "./part-unit-price-input";

test("빈 칸은 0 이 아니라 '정하지 않음'이다 — 저장 쪽이 그 줄을 지운다", () => {
  for (const empty of ["", "   ", null, undefined]) {
    const result = parseUnitPriceValue(empty);
    assert.ok(result.ok);
    assert.equal(result.value, null, `${JSON.stringify(empty)} 는 null 이어야 한다`);
  }
});

test("0 은 '무상 부품'이라는 뜻으로 저장된다 — 빈 칸과 다르다", () => {
  const result = parseUnitPriceValue("0");
  assert.ok(result.ok);
  assert.equal(result.value, "0");
});

test("금액은 문자열 그대로 간다 — Number 를 거치면 오차가 쌓인다", () => {
  for (const [input, expected] of [
    ["125000", "125000"],
    ["1,250,000", "1250000"],
    ["1250.50", "1250.50"],
    [125000, "125000"],
  ] as const) {
    const result = parseUnitPriceValue(input);
    assert.ok(result.ok, `${input} 가 거절됐다`);
    assert.equal(result.value, expected);
  }
});

test("numeric(15,2) 폭과 형식을 벗어나면 거절한다", () => {
  for (const bad of ["-1", "1.234", "12345678901234", "abc", "1e3", "１２３", "1..2"]) {
    const result = parseUnitPriceValue(bad);
    assert.equal(result.ok, false, `${bad} 가 통과했다`);
  }
});

test("정수부 13자리·소수 2자리까지는 통과한다 — 견적서 칸과 같은 폭", () => {
  const result = parseUnitPriceValue("1234567890123.45");
  assert.ok(result.ok);
  assert.equal(result.value, "1234567890123.45");
});

test("소유자 넷을 한 번에 — 정상", () => {
  const result = validatePartUnitPriceEntries([
    { owner: "DSS", unitPrice: "125000" },
    { owner: "KYOSAN", unitPrice: "" },
    { owner: "SERVICE_SPARE", unitPrice: "0" },
    { owner: "TEST", unitPrice: "1,000.50" },
  ]);
  assert.ok(result.ok);
  assert.deepEqual(result.data, [
    { owner: "DSS", unitPrice: "125000" },
    { owner: "KYOSAN", unitPrice: null },
    { owner: "SERVICE_SPARE", unitPrice: "0" },
    { owner: "TEST", unitPrice: "1000.50" },
  ]);
});

test("하나라도 틀리면 전부 거절한다 — 반쯤 저장되면 화면과 DB 가 달라진다", () => {
  const result = validatePartUnitPriceEntries([
    { owner: "DSS", unitPrice: "125000" },
    { owner: "KYOSAN", unitPrice: "-5" },
  ]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(!result.fieldErrors.DSS, "정상인 칸에는 오류가 붙지 않는다");
  assert.match(result.fieldErrors.KYOSAN, /단가/);
});

test("같은 소유자가 두 번 오면 거절한다 — 어느 쪽이 뜻인지 알 수 없다", () => {
  const result = validatePartUnitPriceEntries([
    { owner: "DSS", unitPrice: "1" },
    { owner: "DSS", unitPrice: "2" },
  ]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.fieldErrors.DSS, /두 번/);
});

test("알 수 없는 소유자는 조용히 버리지 않는다 — 버리면 저장된 줄 알게 된다", () => {
  const result = validatePartUnitPriceEntries([{ owner: "NOPE", unitPrice: "1" }]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.fieldErrors.owner);
});

test("배열이 아니면 거절한다", () => {
  assert.equal(validatePartUnitPriceEntries({ owner: "DSS" }).ok, false);
  assert.equal(validatePartUnitPriceEntries(null).ok, false);
});
