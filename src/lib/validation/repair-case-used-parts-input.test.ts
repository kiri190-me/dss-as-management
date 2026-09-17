import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_USED_PART_LINES,
  isValidExpectedVersion,
  isValidRepairCaseId,
  validateUsedPartLines,
} from "./repair-case-used-parts-input";

/**
 * ============================================================================
 * 「사용 부품」 입력 검사 (B-2)
 * ============================================================================
 * 여기서 못 박는 것:
 *  1. 🔴 수량이 0 이하면 거절한다(DB CHECK 가 있지만 서버도 본다).
 *  2. 🔴 고르면 part_id 가 붙고, 손으로 적으면 null 이다.
 *  3. 🔴 line_no 를 화면에서 받지 않는다 — 검사기가 읽지도 않는다.
 *  4. 빈 목록은 정상이다(마지막 줄까지 지울 수 있어야 한다).
 * ============================================================================
 */

const PART_ID = "11111111-2222-4333-8444-555555555555";

function ok(result: ReturnType<typeof validateUsedPartLines>) {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  return result.lines;
}

function errors(result: ReturnType<typeof validateUsedPartLines>) {
  assert.equal(result.ok, false, JSON.stringify(result));
  if (result.ok) throw new Error("unreachable");
  return result.fieldErrors;
}

describe("사용 부품 입력 — 줄 목록", () => {
  test("목록이 배열이 아니면 거절한다", () => {
    assert.ok(errors(validateUsedPartLines(undefined)).lines);
    assert.ok(errors(validateUsedPartLines(null)).lines);
    assert.ok(errors(validateUsedPartLines({ 0: {} })).lines);
  });

  test("🔴 빈 목록은 정상이다 — 마지막 줄까지 지울 수 있어야 한다", () => {
    assert.deepEqual(ok(validateUsedPartLines([])), []);
  });

  test(`${MAX_USED_PART_LINES}줄을 넘으면 거절한다`, () => {
    const line = { partNameText: "부품", quantity: 1 };
    assert.deepEqual(ok(validateUsedPartLines(Array(MAX_USED_PART_LINES).fill(line))).length, MAX_USED_PART_LINES);
    assert.ok(errors(validateUsedPartLines(Array(MAX_USED_PART_LINES + 1).fill(line))).lines);
  });

  test("품명은 비울 수 없고 앞뒤 공백은 떼어 낸다", () => {
    assert.match(errors(validateUsedPartLines([{ partNameText: "   ", quantity: 1 }]))["lines.0.partNameText"], /품명/);
    assert.match(errors(validateUsedPartLines([{ quantity: 1 }]))["lines.0.partNameText"], /품명/);
    assert.equal(ok(validateUsedPartLines([{ partNameText: "  RF 모듈  ", quantity: 2 }]))[0].partNameText, "RF 모듈");
  });

  test("품명이 200자를 넘으면 거절한다 — 말없이 자르지 않는다", () => {
    assert.equal(ok(validateUsedPartLines([{ partNameText: "가".repeat(200), quantity: 1 }]))[0].partNameText.length, 200);
    assert.ok(errors(validateUsedPartLines([{ partNameText: "가".repeat(201), quantity: 1 }]))["lines.0.partNameText"]);
  });

  test("🔴 수량이 0 이하면 거절한다", () => {
    for (const quantity of [0, -1, -100]) {
      assert.match(
        errors(validateUsedPartLines([{ partNameText: "부품", quantity }]))["lines.0.quantity"],
        /1 이상의 정수/
      );
    }
    assert.equal(ok(validateUsedPartLines([{ partNameText: "부품", quantity: 1 }]))[0].quantity, 1);
  });

  test("수량은 정수여야 한다 — 소수·빈 칸·글자를 받지 않는다", () => {
    for (const quantity of [1.5, "", "세개", null, undefined, Number.NaN]) {
      assert.ok(
        errors(validateUsedPartLines([{ partNameText: "부품", quantity }]))["lines.0.quantity"],
        `${String(quantity)} 는 거절돼야 한다`
      );
    }
    // 숫자로 적힌 글자는 받는다 — <input> 이 늘 글자를 준다.
    assert.equal(ok(validateUsedPartLines([{ partNameText: "부품", quantity: "3" }]))[0].quantity, 3);
  });

  test("🔴 고르면 part_id 가 붙고, 손으로 적으면 null 이다", () => {
    assert.equal(ok(validateUsedPartLines([{ partNameText: "부품", quantity: 1, partId: PART_ID }]))[0].partId, PART_ID);
    for (const partId of [null, undefined, ""]) {
      assert.equal(ok(validateUsedPartLines([{ partNameText: "손으로 적은 부품", quantity: 1, partId }]))[0].partId, null);
    }
    // 마스터에 없는 부품을 글자로만 적는 길이 남아 있다 — 이 표의 존재 이유 절반이다.
    assert.deepEqual(ok(validateUsedPartLines([{ partNameText: "옛 부품", quantity: 5 }]))[0], {
      partId: null,
      partNameText: "옛 부품",
      quantity: 5,
    });
  });

  test("part_id 가 UUID 가 아니면 거절한다 — 말없이 버리지 않는다", () => {
    assert.ok(errors(validateUsedPartLines([{ partNameText: "부품", quantity: 1, partId: "not-a-uuid" }]))["lines.0.partId"]);
  });

  test("🔴 line_no 를 화면에서 받지 않는다 — 검사기가 읽지도 않는다", () => {
    const lines = ok(
      validateUsedPartLines([
        { partNameText: "첫째", quantity: 1, lineNo: 99 },
        { partNameText: "둘째", quantity: 1, lineNo: 99 },
        { partNameText: "셋째", quantity: 1, lineNo: -3 },
      ])
    );
    for (const line of lines) {
      assert.deepEqual(Object.keys(line).sort(), ["partId", "partNameText", "quantity"]);
    }
    // 차례는 받은 배열의 차례 그대로 살아 있다 — 번호는 저장이 붙인다.
    assert.deepEqual(lines.map((line) => line.partNameText), ["첫째", "둘째", "셋째"]);
  });

  test("여러 줄이 잘못됐으면 한 번에 다 알려 준다", () => {
    const fieldErrors = errors(
      validateUsedPartLines([
        { partNameText: "", quantity: 1 },
        { partNameText: "부품", quantity: 0 },
        "줄이 아니다",
      ])
    );
    assert.ok(fieldErrors["lines.0.partNameText"]);
    assert.ok(fieldErrors["lines.1.quantity"]);
    assert.ok(fieldErrors["lines.2"]);
  });
});

describe("사용 부품 입력 — 건 id 와 버전", () => {
  test("건 id 는 UUID 여야 한다", () => {
    assert.equal(isValidRepairCaseId(PART_ID), true);
    for (const value of ["", "abc", 1, null, undefined, {}]) {
      assert.equal(isValidRepairCaseId(value), false);
    }
  });

  test("버전은 양의 정수여야 한다", () => {
    assert.equal(isValidExpectedVersion(1), true);
    for (const value of [0, -1, 1.5, "1", null, undefined, Number.NaN]) {
      assert.equal(isValidExpectedVersion(value), false);
    }
  });
});
