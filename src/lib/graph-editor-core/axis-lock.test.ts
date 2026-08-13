import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDragAxis, applyAxisLock, AXIS_LOCK_THRESHOLD, type Point } from "./axis-lock";

test("horizontal-dominant delta locks the Y axis (movement stays horizontal)", () => {
  assert.equal(resolveDragAxis({ x: 500, y: 300 }, { x: 700, y: 330 }), "horizontal");
});

test("vertical-dominant delta locks the X axis (movement stays vertical)", () => {
  assert.equal(resolveDragAxis({ x: 500, y: 300 }, { x: 520, y: 500 }), "vertical");
});

test("exact tie (|deltaX| === |deltaY|) deterministically resolves to vertical", () => {
  // Math.abs(deltaX) > Math.abs(deltaY) is the only comparison — a tie
  // fails that check and falls through to vertical, always, not "whichever
  // came first" or any other non-deterministic tie-break.
  assert.equal(resolveDragAxis({ x: 0, y: 0 }, { x: 10, y: 10 }), "vertical");
  assert.equal(resolveDragAxis({ x: 0, y: 0 }, { x: -10, y: 10 }), "vertical");
  assert.equal(resolveDragAxis({ x: 0, y: 0 }, { x: 10, y: -10 }), "vertical");
});

test("movement below the threshold in both dimensions commits to no axis yet", () => {
  const start = { x: 100, y: 100 };
  assert.equal(resolveDragAxis(start, { x: 100 + AXIS_LOCK_THRESHOLD - 1, y: 100 }), null);
  assert.equal(resolveDragAxis(start, { x: 100, y: 100 + AXIS_LOCK_THRESHOLD - 1 }), null);
  assert.equal(resolveDragAxis(start, { x: 100 + AXIS_LOCK_THRESHOLD - 1, y: 100 - (AXIS_LOCK_THRESHOLD - 1) }), null);
});

test("movement exactly at the threshold commits (>= threshold, not only >)", () => {
  const start = { x: 100, y: 100 };
  assert.equal(resolveDragAxis(start, { x: 100 + AXIS_LOCK_THRESHOLD, y: 100 }), "horizontal");
});

test("applyAxisLock: horizontal keeps current.x, pins y to start.y", () => {
  const start: Point = { x: 500, y: 300 };
  const current: Point = { x: 700, y: 330 };
  assert.deepEqual(applyAxisLock(start, current, "horizontal"), { x: 700, y: 300 });
});

test("applyAxisLock: vertical keeps current.y, pins x to start.x", () => {
  const start: Point = { x: 500, y: 300 };
  const current: Point = { x: 520, y: 500 };
  assert.deepEqual(applyAxisLock(start, current, "vertical"), { x: 500, y: 500 });
});

test("applyAxisLock: null axis passes current through unchanged", () => {
  const current: Point = { x: 42, y: 84 };
  assert.deepEqual(applyAxisLock({ x: 0, y: 0 }, current, null), { x: 42, y: 84 });
});

test("the worked examples from the task spec produce the exact expected coordinates", () => {
  const start: Point = { x: 500, y: 300 };
  const horizontalTarget: Point = { x: 700, y: 330 };
  const horizontalAxis = resolveDragAxis(start, horizontalTarget);
  assert.deepEqual(applyAxisLock(start, horizontalTarget, horizontalAxis), { x: 700, y: 300 });

  const verticalTarget: Point = { x: 520, y: 500 };
  const verticalAxis = resolveDragAxis(start, verticalTarget);
  assert.deepEqual(applyAxisLock(start, verticalTarget, verticalAxis), { x: 500, y: 500 });
});

test("neither function mutates its input points", () => {
  const start: Point = { x: 500, y: 300 };
  const current: Point = { x: 700, y: 330 };
  const startCopy = { ...start };
  const currentCopy = { ...current };
  resolveDragAxis(start, current);
  applyAxisLock(start, current, "horizontal");
  assert.deepEqual(start, startCopy);
  assert.deepEqual(current, currentCopy);
});
