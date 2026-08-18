import { test } from "node:test";
import assert from "node:assert/strict";
import { groupPartOwnerAvailability, ownerScopedAvailability, stockOwnerLabelOrUnspecified } from "./inventory-types";

test("stockOwnerLabelOrUnspecified: renders 미지정 for NULL, the canonical label otherwise", () => {
  assert.equal(stockOwnerLabelOrUnspecified(null), "미지정");
  assert.equal(stockOwnerLabelOrUnspecified("DSS"), "DSS");
  assert.equal(stockOwnerLabelOrUnspecified("KYOSAN"), "교산");
});

test("ownerScopedAvailability: owner not selected returns null, never an all-owner total", () => {
  const byPartId = { "part-a": { DSS: 5, KYOSAN: 3, SERVICE_SPARE: 2 } };
  assert.equal(ownerScopedAvailability(byPartId, "part-a", ""), null);
});

test("ownerScopedAvailability: a part with stock across multiple owners returns only the selected owner's quantity", () => {
  const byPartId = { "part-a": { DSS: 5, KYOSAN: 3, SERVICE_SPARE: 2 } };
  assert.equal(ownerScopedAvailability(byPartId, "part-a", "DSS"), 5, "must never show the all-owner total (10)");
  assert.equal(ownerScopedAvailability(byPartId, "part-a", "KYOSAN"), 3);
  assert.equal(ownerScopedAvailability(byPartId, "part-a", "SERVICE_SPARE"), 2);
});

test("ownerScopedAvailability: an owner with no balance row for that part returns 0, not null/undefined", () => {
  const byPartId = { "part-a": { DSS: 5 } };
  assert.equal(ownerScopedAvailability(byPartId, "part-a", "KYOSAN"), 0);
  assert.equal(ownerScopedAvailability(byPartId, "part-a", "TEST"), 0);
});

test("ownerScopedAvailability: a part absent from the map entirely (no balances at all) returns 0 for any selected owner", () => {
  assert.equal(ownerScopedAvailability({}, "unknown-part", "DSS"), 0);
});

test("groupPartOwnerAvailability: a part with stock across multiple owners keeps each owner's quantity separate, not a total", () => {
  const map = groupPartOwnerAvailability([
    { partId: "part-a", owner: "DSS", quantity: 5 },
    { partId: "part-a", owner: "KYOSAN", quantity: 3 },
    { partId: "part-a", owner: "SERVICE_SPARE", quantity: 2 },
  ]);
  assert.deepEqual(map["part-a"], { DSS: 5, KYOSAN: 3, SERVICE_SPARE: 2 });
});

test("groupPartOwnerAvailability: an owner absent from the input rows is simply absent from the output map (never present with 0)", () => {
  const map = groupPartOwnerAvailability([{ partId: "part-a", owner: "DSS", quantity: 5 }]);
  assert.equal(map["part-a"].TEST, undefined);
  assert.equal(Object.keys(map["part-a"]!).length, 1);
});

test("groupPartOwnerAvailability: multiple parts are grouped independently, and an empty input produces an empty map", () => {
  const map = groupPartOwnerAvailability([
    { partId: "part-a", owner: "DSS", quantity: 5 },
    { partId: "part-b", owner: "DSS", quantity: 9 },
  ]);
  assert.equal(map["part-a"].DSS, 5);
  assert.equal(map["part-b"].DSS, 9);
  assert.deepEqual(groupPartOwnerAvailability([]), {});
});
