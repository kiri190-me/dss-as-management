import assert from "node:assert/strict";
import { test } from "node:test";

import { parseAmountValue } from "./amount-value";

/**
 * ============================================================================
 * 금액 한 칸의 규칙
 * ============================================================================
 * 🔵 **이 시험은 `part-unit-price-input.test.ts` 에서 옮겨 왔다**(2026-10-27, 조각 13-C5).
 *    저쪽 파일은 옛 재고의 부품 단가·O/H 단가와 함께 지워졌는데, 그 안의 **금액 규칙
 *    시험만은 재고와 상관이 없는 쪽**(수리 작업비의 시간당 단가)이 지금도 그대로 쓰는
 *    함수를 재고 있었다. 단언은 한 줄도 약하게 만들지 않고 그대로 옮겼다 —
 *    부르는 함수 이름만 `parseUnitPriceValue` → `parseAmountValue` 로 바뀌었다
 *    (전자는 후자를 그대로 되넘기던 별칭이었다).
 *
 * 🔴 못 박는 것 셋:
 *  · **빈 칸과 0 이 다르다.** 빈 칸은 「정하지 않음」(null)이고 0 은 「무상」이다.
 *    둘을 뭉개면 정하지 않은 값이 0원으로 청구된다.
 *  · **문자열 그대로 간다.** Number 를 거치면 오차가 쌓이고, 그것이 견적서 합계와
 *    세금계산서 사이의 1원 차이가 된다.
 *  · **numeric(15,2) 폭을 넘는 값은 여기서 막는다.** 그대로 보내면 Postgres 의
 *    22003 이 되고, 그 오류는 사용자에게 아무것도 설명하지 못한다.
 * ============================================================================
 */

/** 🔴 표가 비면 for 문이 한 바퀴도 안 돌아 **공짜로 통과한다** — 먼저 표본 수를 못 박는다. */
const EMPTY_INPUTS = ["", "   ", null, undefined] as const;
const ACCEPTED: ReadonlyArray<readonly [string | number, string]> = [
  ["125000", "125000"],
  ["1,250,000", "1250000"],
  ["1250.50", "1250.50"],
  [125000, "125000"],
];
const REJECTED = ["-1", "1.234", "12345678901234", "abc", "1e3", "１２３", "1..2"] as const;

test("표본이 비어 있지 않다 — 아래 세 표가 한 바퀴도 안 돌면 전부 공짜로 통과한다", () => {
  assert.equal(EMPTY_INPUTS.length, 4);
  assert.equal(ACCEPTED.length, 4);
  assert.equal(REJECTED.length, 7);
});

test("빈 칸은 0 이 아니라 '정하지 않음'이다 — 부르는 쪽이 그 줄을 지운다", () => {
  for (const empty of EMPTY_INPUTS) {
    const result = parseAmountValue(empty);
    assert.ok(result.ok);
    assert.equal(result.value, null, `${JSON.stringify(empty)} 는 null 이어야 한다`);
  }
});

test("0 은 '무상'이라는 뜻으로 저장된다 — 빈 칸과 다르다", () => {
  const result = parseAmountValue("0");
  assert.ok(result.ok);
  assert.equal(result.value, "0", "null 이 되면 '정하지 않음'과 구별되지 않는다");
});

test("금액은 문자열 그대로 간다 — Number 를 거치면 오차가 쌓인다", () => {
  for (const [input, expected] of ACCEPTED) {
    const result = parseAmountValue(input);
    assert.ok(result.ok, `${input} 가 거절됐다`);
    assert.equal(result.value, expected);
  }
});

test("numeric(15,2) 폭과 형식을 벗어나면 거절한다", () => {
  for (const bad of REJECTED) {
    const result = parseAmountValue(bad);
    assert.equal(result.ok, false, `${bad} 가 통과했다`);
  }
});

test("정수부 13자리·소수 2자리까지는 통과한다 — 견적서 칸과 같은 폭", () => {
  const result = parseAmountValue("1234567890123.45");
  assert.ok(result.ok);
  assert.equal(result.value, "1234567890123.45");
});

test("값으로 읽을 수 없는 것은 거절한다 — 화면이 보낸 모양을 믿지 않는다", () => {
  assert.equal(parseAmountValue({ owner: "DSS" }).ok, false);
  assert.equal(parseAmountValue(["125000"]).ok, false);
});

test("🔴 유한하지 않은 수는 빈 칸으로 접는다 — \"NaN\" 이라는 글자가 내려가지 않는다", () => {
  // String(NaN) 을 그대로 넘기면 "NaN" 이 금액 칸으로 간다. 실측한 동작은 **거절이 아니라
  // 빈 칸**(정하지 않음)이고, 옮기면서 한 글자도 바꾸지 않았으므로 그대로 못 박아 둔다.
  for (const notFinite of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const result = parseAmountValue(notFinite);
    assert.ok(result.ok, String(notFinite));
    assert.equal(result.value, null, String(notFinite));
  }
});
