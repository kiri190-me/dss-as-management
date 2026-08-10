import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveEffectiveNodePosition, hasUserLayoutOverride, packNodesIntoRows, type PackableNode } from "./layout";

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

// ---- packNodesIntoRows (Phase 5C-4 extraction) ----

const OPTS = { startY: 0, rowMaxWidth: 300, hGap: 10, vGap: 5, extraRowGap: 40 };

test("packNodesIntoRows: every input node receives a position — none are dropped", () => {
  const nodes: PackableNode[] = Array.from({ length: 50 }, (_, i) => ({ id: `n${i}`, width: 20, height: 20 }));
  const result = packNodesIntoRows(nodes, OPTS);
  assert.equal(result.positions.size, nodes.length);
  for (const n of nodes) assert.ok(result.positions.has(n.id));
});

test("packNodesIntoRows: packs items into the same row until rowMaxWidth would be exceeded", () => {
  const nodes: PackableNode[] = [
    { id: "a", width: 100, height: 20 },
    { id: "b", width: 100, height: 20 },
    { id: "c", width: 100, height: 20 },
  ];
  const result = packNodesIntoRows(nodes, OPTS);
  // a@0, b@110 (100+10 gap), c would start at 220, 220+100=320 > 300 rowMaxWidth -> wraps
  assert.deepEqual(result.positions.get("a"), { x: 0, y: 0 });
  assert.deepEqual(result.positions.get("b"), { x: 110, y: 0 });
  assert.equal(result.positions.get("c")!.y > 0, true, "c must wrap to a new row");
  assert.equal(result.positions.get("c")!.x, 0);
});

test("packNodesIntoRows: row wrap advances y by rowMaxHeight + vGap, and resets x to 0", () => {
  const nodes: PackableNode[] = [
    { id: "a", width: 250, height: 30 },
    { id: "b", width: 250, height: 10 },
  ];
  const result = packNodesIntoRows(nodes, OPTS);
  assert.deepEqual(result.positions.get("a"), { x: 0, y: 0 });
  assert.deepEqual(result.positions.get("b"), { x: 0, y: 30 + OPTS.vGap });
});

test("packNodesIntoRows: extraTrailingGap widens the gap to the next item in the same row", () => {
  const withoutGap = packNodesIntoRows(
    [{ id: "a", width: 50, height: 10 }, { id: "b", width: 50, height: 10 }],
    OPTS
  );
  const withGap = packNodesIntoRows(
    [{ id: "a", width: 50, height: 10, extraTrailingGap: 30 }, { id: "b", width: 50, height: 10 }],
    OPTS
  );
  const gapWithout = withoutGap.positions.get("b")!.x - withoutGap.positions.get("a")!.x;
  const gapWith = withGap.positions.get("b")!.x - withGap.positions.get("a")!.x;
  assert.equal(gapWith, gapWithout + 30);
});

test("packNodesIntoRows: causesExtraRowGap adds extraRowGap only when that row actually wraps", () => {
  const wide: PackableNode[] = [
    { id: "a", width: 250, height: 10, causesExtraRowGap: true },
    { id: "b", width: 250, height: 10 },
  ];
  const result = packNodesIntoRows(wide, OPTS);
  // row wraps after 'a' (a wide alone triggers wrap for b since 250+10+250>300); extra row gap must apply
  assert.equal(result.positions.get("b")!.y, 10 + OPTS.vGap + OPTS.extraRowGap);
});

test("packNodesIntoRows: causesExtraRowGap has no effect when no wrap occurs afterward (single row, no next row)", () => {
  const nodes: PackableNode[] = [{ id: "a", width: 50, height: 10, causesExtraRowGap: true }];
  const result = packNodesIntoRows(nodes, OPTS);
  assert.equal(result.height, 10);
});

test("packNodesIntoRows: rowIndexByNodeId groups same-row items under the same index and increments on wrap", () => {
  const nodes: PackableNode[] = [
    { id: "a", width: 100, height: 10 },
    { id: "b", width: 100, height: 10 },
    { id: "c", width: 250, height: 10 },
  ];
  const result = packNodesIntoRows(nodes, OPTS);
  assert.equal(result.rowIndexByNodeId.get("a"), result.rowIndexByNodeId.get("b"));
  assert.equal(result.rowIndexByNodeId.get("c"), result.rowIndexByNodeId.get("a")! + 1);
});

test("packNodesIntoRows: maxX reaches at least as far right as every node's own right edge", () => {
  const nodes: PackableNode[] = [
    { id: "a", width: 40, height: 10 },
    { id: "b", width: 90, height: 10, extraTrailingGap: 15 },
  ];
  const result = packNodesIntoRows(nodes, OPTS);
  for (const n of nodes) {
    const pos = result.positions.get(n.id)!;
    assert.ok(result.maxX >= pos.x + n.width, `maxX must clear ${n.id}'s right edge`);
  }
});

test("packNodesIntoRows: height spans from startY to the bottom of the last row", () => {
  const nodes: PackableNode[] = [
    { id: "a", width: 250, height: 30 },
    { id: "b", width: 250, height: 20 },
  ];
  const result = packNodesIntoRows(nodes, { ...OPTS, startY: 100 });
  // a: row0 y=100, height 30; b wraps to row1 y=100+30+vGap, height 20
  const expectedBottom = 100 + 30 + OPTS.vGap + 20;
  assert.equal(result.height, expectedBottom - 100);
});

test("packNodesIntoRows: empty input returns empty maps and zero maxX/height", () => {
  const result = packNodesIntoRows([], OPTS);
  assert.equal(result.positions.size, 0);
  assert.equal(result.maxX, 0);
  assert.equal(result.height, 0);
});
