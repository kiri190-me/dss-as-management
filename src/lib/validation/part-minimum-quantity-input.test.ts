import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isStockOwner,
  parseMinimumQuantityValue,
  validatePartMinimumQuantityEntries,
} from "./part-minimum-quantity-input";
import { STOCK_OWNER_CODES } from "@/lib/domain/inventory-types";

/**
 * ============================================================================
 * 한계수량 입력 검증
 * ============================================================================
 * 여기서 지키려는 것은 둘이다.
 *  1. **빈 값이 0 이 되지 않는다.** 비운 칸은 "정하지 않음"(null)이고, 저장
 *     쪽에서 그 줄을 지우는 신호다. 0 으로 바뀌면 "정하지 않음"을 표현할 방법이
 *     사라진다.
 *  2. **0 은 살아 있는 값이다.** "하나도 없으면 알려 달라"는 뜻이라 null 과
 *     같은 취급을 받으면 안 된다.
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────── 칸 하나

test("🔴 빈 칸은 0 이 아니라 '정하지 않음'(null)이다", () => {
  for (const empty of ["", "   ", "\t", null, undefined]) {
    const parsed = parseMinimumQuantityValue(empty);
    assert.equal(parsed.ok, true, JSON.stringify(empty));
    if (!parsed.ok) throw new Error("unreachable");
    assert.equal(parsed.value, null, `${JSON.stringify(empty)} 가 null 이 아니다`);
  }
});

test("🔴 0 은 살아 있는 값이다 — 비운 것과 다르다", () => {
  for (const zero of ["0", 0, " 0 "]) {
    const parsed = parseMinimumQuantityValue(zero);
    assert.equal(parsed.ok, true, JSON.stringify(zero));
    if (!parsed.ok) throw new Error("unreachable");
    assert.equal(parsed.value, 0, `${JSON.stringify(zero)} 가 0 이 아니다`);
    assert.notEqual(parsed.value, null);
  }
});

test("0 이상의 정수를 받는다", () => {
  for (const [raw, expected] of [
    ["1", 1],
    ["20", 20],
    [" 340 ", 340],
    [7, 7],
    ["2147483647", 2_147_483_647],
  ] as const) {
    const parsed = parseMinimumQuantityValue(raw);
    assert.equal(parsed.ok, true, JSON.stringify(raw));
    if (!parsed.ok) throw new Error("unreachable");
    assert.equal(parsed.value, expected, JSON.stringify(raw));
  }
});

test("음수를 거절한다", () => {
  for (const raw of ["-1", "-20", -1, -0.5]) {
    assert.equal(parseMinimumQuantityValue(raw).ok, false, JSON.stringify(raw));
  }
});

test("소수를 거절한다", () => {
  for (const raw of ["1.5", "0.1", 1.5, 0.000001]) {
    assert.equal(parseMinimumQuantityValue(raw).ok, false, JSON.stringify(raw));
  }
});

test("숫자가 아닌 것을 거절한다", () => {
  // "1e3" 이 1000 으로, " " 가 0 으로 조용히 통과하지 않는지가 요점이다 —
  // Number() 에 맡기면 둘 다 통과한다.
  for (const raw of ["abc", "1e3", "0x10", "１", "20개", "١٠", true, {}, [], NaN, Infinity]) {
    assert.equal(parseMinimumQuantityValue(raw).ok, false, JSON.stringify(raw));
  }
});

test("integer 컬럼 상한을 넘는 값을 거절한다", () => {
  assert.equal(parseMinimumQuantityValue("2147483648").ok, false);
  assert.equal(parseMinimumQuantityValue(2_147_483_648).ok, false);
});

// ─────────────────────────────────────────────────────── 한 번에 넷

test("소유자 넷을 한 번에 받아 그대로 돌려준다", () => {
  const result = validatePartMinimumQuantityEntries([
    { owner: "DSS", minimumQuantity: "20" },
    { owner: "KYOSAN", minimumQuantity: "" },
    { owner: "SERVICE_SPARE", minimumQuantity: "30" },
    { owner: "TEST", minimumQuantity: "0" },
  ]);

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  assert.deepEqual(result.data, [
    { owner: "DSS", minimumQuantity: 20 },
    { owner: "KYOSAN", minimumQuantity: null },
    { owner: "SERVICE_SPARE", minimumQuantity: 30 },
    { owner: "TEST", minimumQuantity: 0 },
  ]);
});

test("모르는 소유자를 거절한다", () => {
  for (const owner of ["DSS2", "", "dss", null, 3]) {
    const result = validatePartMinimumQuantityEntries([{ owner, minimumQuantity: "1" }]);
    assert.equal(result.ok, false, JSON.stringify(owner));
    if (result.ok) throw new Error("unreachable");
    assert.ok(result.fieldErrors.owner, JSON.stringify(owner));
  }
});

test("등록된 소유자는 전부 통과한다 — 목록이 늘면 여기가 저절로 따라온다", () => {
  for (const owner of STOCK_OWNER_CODES) {
    assert.equal(isStockOwner(owner), true, owner);
    const result = validatePartMinimumQuantityEntries([{ owner, minimumQuantity: "5" }]);
    assert.equal(result.ok, true, owner);
  }
});

test("🔴 하나라도 틀리면 전부 거절한다 — 반쯤 저장되는 일이 없어야 한다", () => {
  const result = validatePartMinimumQuantityEntries([
    { owner: "DSS", minimumQuantity: "20" },
    { owner: "KYOSAN", minimumQuantity: "-5" },
  ]);

  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.ok(result.fieldErrors.KYOSAN, "틀린 칸에 문장이 붙어야 한다");
  assert.equal(result.fieldErrors.DSS, undefined, "맞는 칸에는 문장이 붙지 않는다");
});

test("같은 소유자가 두 번 오면 거절한다", () => {
  const result = validatePartMinimumQuantityEntries([
    { owner: "DSS", minimumQuantity: "20" },
    { owner: "DSS", minimumQuantity: "30" },
  ]);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.ok(result.fieldErrors.DSS);
});

test("배열이 아니면 거절한다", () => {
  for (const raw of [null, undefined, "DSS", 3, { owner: "DSS" }]) {
    assert.equal(validatePartMinimumQuantityEntries(raw).ok, false, JSON.stringify(raw));
  }
});

test("빈 배열은 통과한다 — 바꿀 것이 없다는 뜻이다", () => {
  const result = validatePartMinimumQuantityEntries([]);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.deepEqual(result.data, []);
});
