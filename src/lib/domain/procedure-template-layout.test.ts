import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveEffectiveNodePosition, hasUserLayoutOverride } from "./procedure-template-layout";

test("resolveEffectiveNodePosition: SOURCE mode always returns position_x/position_y, even when a valid override exists", () => {
  const node = { positionX: 10, positionY: 20, userPositionX: 999, userPositionY: 888 };
  assert.deepEqual(resolveEffectiveNodePosition(node, "SOURCE"), { x: 10, y: 20 });
});

test("resolveEffectiveNodePosition: USER mode returns the override when both coordinates are valid", () => {
  const node = { positionX: 10, positionY: 20, userPositionX: 999, userPositionY: 888 };
  assert.deepEqual(resolveEffectiveNodePosition(node, "USER"), { x: 999, y: 888 });
});

test("resolveEffectiveNodePosition: USER mode falls back to source coordinates when the override is null", () => {
  const node = { positionX: 10, positionY: 20, userPositionX: null, userPositionY: null };
  assert.deepEqual(resolveEffectiveNodePosition(node, "USER"), { x: 10, y: 20 });
});

test("resolveEffectiveNodePosition: USER mode falls back to source coordinates when the override is undefined", () => {
  const node = { positionX: 10, positionY: 20, userPositionX: undefined, userPositionY: undefined };
  assert.deepEqual(resolveEffectiveNodePosition(node, "USER"), { x: 10, y: 20 });
});

test("resolveEffectiveNodePosition: USER mode falls back per-axis when only one override coordinate is invalid", () => {
  const node = { positionX: 10, positionY: 20, userPositionX: 999, userPositionY: NaN };
  assert.deepEqual(resolveEffectiveNodePosition(node, "USER"), { x: 999, y: 20 });
});

test("resolveEffectiveNodePosition: USER mode falls back to source coordinates when the override is +/-Infinity", () => {
  const node = { positionX: 10, positionY: 20, userPositionX: Infinity, userPositionY: -Infinity };
  assert.deepEqual(resolveEffectiveNodePosition(node, "USER"), { x: 10, y: 20 });
});

test("hasUserLayoutOverride: true only when both coordinates are present and finite", () => {
  assert.equal(hasUserLayoutOverride({ userPositionX: 1, userPositionY: 2 }), true);
  assert.equal(hasUserLayoutOverride({ userPositionX: null, userPositionY: null }), false);
  assert.equal(hasUserLayoutOverride({ userPositionX: 1, userPositionY: null }), false);
  assert.equal(hasUserLayoutOverride({ userPositionX: NaN, userPositionY: 2 }), false);
});
