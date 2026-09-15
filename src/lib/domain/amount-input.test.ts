import { test } from "node:test";
import assert from "node:assert/strict";
import { caretAfterReformat, formatAmountInput, parseAmountInput } from "./amount-input";

test("치는 글자에서 금액만 남긴다 — 콤마·공백·문자는 버린다", () => {
  assert.equal(parseAmountInput("3,500,000"), "3500000");
  assert.equal(parseAmountInput(" 1 000 "), "1000");
  assert.equal(parseAmountInput("12a3원"), "123");
  assert.equal(parseAmountInput(""), "");
});

test("점은 첫 번째만, 소수는 둘째 자리까지 — 저장 검증과 같은 모양", () => {
  assert.equal(parseAmountInput("1.2.3"), "1.23");
  assert.equal(parseAmountInput("1.234"), "1.23");
  assert.equal(parseAmountInput("12000.50"), "12000.50");
});

test("치는 중인 끝의 점은 지우지 않는다 — 지우면 소수를 칠 수 없다", () => {
  assert.equal(parseAmountInput("1234."), "1234.");
  assert.equal(parseAmountInput("."), "0.");
});

test("앞자리 0 은 하나만 남긴다", () => {
  assert.equal(parseAmountInput("007"), "7");
  assert.equal(parseAmountInput("0"), "0");
  assert.equal(parseAmountInput("00.5"), "0.5");
});

test("음수는 받지 않는다 — 저장 검증도 0 이상만 받는다", () => {
  assert.equal(parseAmountInput("-5000"), "5000");
});

test("🔴 정수부만 세 자리마다 끊는다 — 소수부와 끝의 점은 그대로", () => {
  assert.equal(formatAmountInput("3500000"), "3,500,000");
  assert.equal(formatAmountInput("3500000.00"), "3,500,000.00");
  assert.equal(formatAmountInput("1234."), "1,234.");
  assert.equal(formatAmountInput("1234.5"), "1,234.5");
  assert.equal(formatAmountInput("999"), "999");
  assert.equal(formatAmountInput("0.5"), "0.5");
  assert.equal(formatAmountInput(""), "");
});

test("🔴 보이는 글자를 다시 읽으면 들고 있던 값 그대로다", () => {
  for (const raw of ["", "0", "7", "1000", "3500000", "3500000.00", "12000.5", "1234."]) {
    assert.equal(parseAmountInput(formatAmountInput(raw)), raw, raw);
  }
});

test("🔴 끝에 칠 때 — 콤마가 새로 생겨도 커서는 끝에 있다", () => {
  // "350,000" 끝에 0 을 쳤다 → "3,500,000"
  const typed = "350,0000";
  const formatted = formatAmountInput(parseAmountInput(typed));
  assert.equal(formatted, "3,500,000");
  assert.equal(caretAfterReformat(typed, typed.length, formatted), formatted.length);
});

test("🔴 가운데를 지울 때 — 콤마가 없어져도 커서는 지운 자리에 남는다", () => {
  // "3,500,000" 에서 5 를 지웠다(커서가 3 뒤) → "300,000", 커서는 첫 숫자 뒤
  const typed = "3,00,000";
  const formatted = formatAmountInput(parseAmountInput(typed));
  assert.equal(formatted, "300,000");
  assert.equal(caretAfterReformat(typed, 2, formatted), 1);
});

test("가운데에 칠 때 — 친 숫자 바로 뒤에 커서가 온다", () => {
  // "1,000" 의 1 뒤에 2 를 쳤다 → "12,000", 커서는 2 뒤
  const typed = "12,000";
  const formatted = formatAmountInput(parseAmountInput(typed));
  assert.equal(formatted, "12,000");
  assert.equal(caretAfterReformat(typed, 2, formatted), 2);
});

test("버려진 글자는 세지 않는다 — 문자를 쳐도 커서가 밀리지 않는다", () => {
  // "1,000" 의 1 뒤에 a 를 쳤다 → 값은 그대로, 커서는 1 뒤
  const typed = "1a,000";
  const formatted = formatAmountInput(parseAmountInput(typed));
  assert.equal(formatted, "1,000");
  assert.equal(caretAfterReformat(typed, 2, formatted), 1);
});

test("맨 앞 · 넘친 자리", () => {
  assert.equal(caretAfterReformat("1,000", 0, "1,000"), 0);
  assert.equal(caretAfterReformat("1,000", 99, "1,000"), 5);
});
