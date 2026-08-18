import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCartLinePatch, type CartLine } from "./inventory-part-request-cart";

function line(overrides: Partial<CartLine> = {}): CartLine {
  return { partId: "part-a", partName: "테스트 부품", quantity: "3", owner: "", note: "", ...overrides };
}

test("applyCartLinePatch: changing owner does not mutate partId/quantity/note on the same line", () => {
  const cart = [line({ partId: "part-a", quantity: "7", note: "긴급" })];
  const result = applyCartLinePatch(cart, "part-a", { owner: "DSS" });
  assert.equal(result[0].owner, "DSS");
  assert.equal(result[0].partId, "part-a");
  assert.equal(result[0].quantity, "7");
  assert.equal(result[0].note, "긴급");
});

test("applyCartLinePatch: only the line matching partId is touched, other lines are untouched", () => {
  const cart = [line({ partId: "part-a", owner: "DSS" }), line({ partId: "part-b", owner: "KYOSAN" })];
  const result = applyCartLinePatch(cart, "part-a", { owner: "SERVICE_SPARE" });
  assert.equal(result[0].owner, "SERVICE_SPARE");
  assert.equal(result[1].owner, "KYOSAN", "an unrelated line's owner must never change");
});

test("applyCartLinePatch: original array is not mutated in place", () => {
  const cart = [line({ partId: "part-a", owner: "" })];
  const result = applyCartLinePatch(cart, "part-a", { owner: "DSS" });
  assert.equal(cart[0].owner, "", "the source array must remain untouched");
  assert.notEqual(result, cart);
});
