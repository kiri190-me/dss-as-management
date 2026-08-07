import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAlreadyReversedQuantity, computeReturnableQuantity, canReturnQuantity } from "./inventory-return-rules";

test("computeAlreadyReversedQuantity: sums zero prior returns to 0", () => {
  assert.equal(computeAlreadyReversedQuantity([]), 0);
});

test("computeAlreadyReversedQuantity: sums multiple prior returns", () => {
  assert.equal(computeAlreadyReversedQuantity([{ quantity: 3 }, { quantity: 2 }]), 5);
});

test("computeReturnableQuantity: full amount returnable when nothing returned yet", () => {
  assert.equal(computeReturnableQuantity(10, []), 10);
});

test("computeReturnableQuantity: subtracts prior returns", () => {
  assert.equal(computeReturnableQuantity(10, [{ quantity: 3 }]), 7);
});

test("computeReturnableQuantity: fully returned leaves 0, never negative", () => {
  assert.equal(computeReturnableQuantity(10, [{ quantity: 6 }, { quantity: 4 }]), 0);
  assert.equal(computeReturnableQuantity(10, [{ quantity: 6 }, { quantity: 6 }]), 0, "over-returned ledger state must still clamp to 0, not go negative");
});

test("canReturnQuantity: allows a request within the remaining returnable amount", () => {
  assert.equal(canReturnQuantity(10, [{ quantity: 3 }], 7), true);
});

test("canReturnQuantity: rejects a request exceeding the remaining returnable amount", () => {
  assert.equal(canReturnQuantity(10, [{ quantity: 3 }], 8), false);
});

test("canReturnQuantity: an exact match to the remaining amount is allowed", () => {
  assert.equal(canReturnQuantity(10, [{ quantity: 4 }], 6), true);
});

test("canReturnQuantity: rejects a zero or negative requested quantity", () => {
  assert.equal(canReturnQuantity(10, [], 0), false);
  assert.equal(canReturnQuantity(10, [], -1), false);
});

test("canReturnQuantity: supports multiple partial returns across separate calls (10 used, 3 returned, then 2 more)", () => {
  const afterFirstReturn: { quantity: number }[] = [{ quantity: 3 }];
  assert.equal(canReturnQuantity(10, afterFirstReturn, 2), true);
  const afterSecondReturn = [...afterFirstReturn, { quantity: 2 }];
  assert.equal(computeReturnableQuantity(10, afterSecondReturn), 5);
});
