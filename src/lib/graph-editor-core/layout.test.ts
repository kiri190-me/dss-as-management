import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveEffectiveNodePosition,
  hasUserLayoutOverride,
  packNodesIntoRows,
  computeRelativePosition,
  computeCenterAlignedRelativePosition,
  resolveColumnSnappedRelativePosition,
  resolveEffectiveNodeDimensions,
  computeStraightenedConnectedNodePosition,
  computeLayeredGraphLayout,
  isAlignedVerticalConnection,
  isAlignedHorizontalConnection,
  resolveConnectionHandles,
  HORIZONTAL_HANDLE_IDS,
  VERTICAL_HANDLE_IDS,
  type PackableNode,
  type ColumnSnapCandidate,
} from "./layout";

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

const SPACING = { horizontal: 280, vertical: 150 };

test("computeRelativePosition: LEFT/RIGHT place the target just outside the reference's bounding box (edge + gap), y unchanged", () => {
  const ref = { x: 100, y: 200, width: 180 };
  assert.deepEqual(computeRelativePosition(ref, "LEFT", SPACING, 132), { x: 100 - 280 - 132, y: 200 });
  assert.deepEqual(computeRelativePosition(ref, "RIGHT", SPACING, 132), { x: 100 + 180 + 280, y: 200 });
});

test("computeRelativePosition: UP/DOWN preserve the reference's CENTER x (equal widths), y offset by the vertical spacing", () => {
  const ref = { x: 100, y: 200, width: 180 };
  assert.deepEqual(computeRelativePosition(ref, "UP", SPACING, 180), { x: 100, y: 200 - 150 });
  assert.deepEqual(computeRelativePosition(ref, "DOWN", SPACING, 180), { x: 100, y: 200 + 150 });
});

/**
 * Round-2 fix — the actual bug behind "vertical alignment still wrong in
 * the browser": DOWN/UP must preserve CENTER x, not left-edge x, once the
 * reference and target nodes have different widths (e.g. one has a
 * multiline title). This is the case the earlier (left-edge-only) version
 * silently got wrong.
 */
test("computeRelativePosition: DOWN centers a narrower/wider target under the reference's real center, not its left edge", () => {
  const wideRef = { x: 100, y: 200, width: 240 };
  const narrowTarget = computeRelativePosition(wideRef, "DOWN", SPACING, 132);
  // reference center = 100 + 240/2 = 220; narrow target's own center must land on 220 too.
  assert.equal(narrowTarget.x + 132 / 2, 220);
  assert.notEqual(narrowTarget.x, wideRef.x, "left-edge x must NOT match here — that would mean the centers are misaligned instead");

  const narrowRef = { x: 100, y: 200, width: 132 };
  const wideTarget = computeRelativePosition(narrowRef, "DOWN", SPACING, 240);
  // reference center = 100 + 132/2 = 166; wide target's own center must land on 166 too.
  assert.equal(wideTarget.x + 240 / 2, 166);
});

test("computeRelativePosition: LEFT/RIGHT never overlap the reference's bounding box regardless of target width", () => {
  const ref = { x: 100, y: 200, width: 180 };
  const wideTarget = computeRelativePosition(ref, "LEFT", SPACING, 400);
  assert.ok(wideTarget.x + 400 <= ref.x - SPACING.horizontal, "a wide target placed LEFT must still end entirely before the reference's left edge minus the gap");
  const right = computeRelativePosition(ref, "RIGHT", SPACING, 400);
  assert.equal(right.x, ref.x + ref.width + SPACING.horizontal);
});

test("computeRelativePosition: never mutates the reference object", () => {
  const ref = { x: 100, y: 200, width: 180 };
  computeRelativePosition(ref, "RIGHT", SPACING, 132);
  assert.deepEqual(ref, { x: 100, y: 200, width: 180 });
});

// ---- computeCenterAlignedRelativePosition (5C-6D follow-up #3) ----

test("computeCenterAlignedRelativePosition: LEFT alignment with equal-height nodes — center Y equal", () => {
  const ref = { x: 500, y: 300, width: 180, height: 80 };
  const target = computeCenterAlignedRelativePosition(ref, "LEFT", SPACING, { width: 180, height: 80 });
  const refCenterY = ref.y + ref.height / 2;
  const targetCenterY = target.y + 80 / 2;
  assert.equal(targetCenterY, refCenterY);
});

test("computeCenterAlignedRelativePosition: RIGHT alignment with different-height nodes — center Y still exactly equal", () => {
  const ref = { x: 500, y: 300, width: 180, height: 60 };
  const target = computeCenterAlignedRelativePosition(ref, "RIGHT", SPACING, { width: 180, height: 140 });
  const refCenterY = ref.y + ref.height / 2; // 330
  const targetCenterY = target.y + 140 / 2;
  assert.equal(targetCenterY, refCenterY);
  assert.notEqual(target.y, ref.y, "a naive copy of reference.y would NOT produce equal centers here, since heights differ");
});

/**
 * 🔴 2026-11-05 — 이 자리에는 「UP/DOWN 은 computeRelativePosition 과 **언제나**
 * 같다」가 적혀 있었다. 그 단언이 통과하고 있었기 때문에, 높이가 다른 두 노드를
 * 세로로 이으면 중심 간 거리가 눈금이 아니게 되는 결함이 영영 안 드러났다.
 * 참인 것은 **높이가 같을 때만** 같다는 것이고, 아래 두 시험이 그 둘을 갈라 적는다.
 */
test("computeCenterAlignedRelativePosition: UP/DOWN — 높이가 같으면 computeRelativePosition 과 한 픽셀도 다르지 않다", () => {
  const ref = { x: 100, y: 200, width: 240, height: 90 };
  const oldDown = computeRelativePosition(ref, "DOWN", SPACING, 132);
  const newDown = computeCenterAlignedRelativePosition(ref, "DOWN", SPACING, { width: 132, height: 90 });
  assert.deepEqual(newDown, oldDown);
  const oldUp = computeRelativePosition(ref, "UP", SPACING, 132);
  const newUp = computeCenterAlignedRelativePosition(ref, "UP", SPACING, { width: 132, height: 90 });
  assert.deepEqual(newUp, oldUp);
});

test("computeCenterAlignedRelativePosition: UP/DOWN — 높이가 다르면 **중심 간** 거리가 눈금이다(윗변 간 거리가 아니다)", () => {
  const ref = { x: 100, y: 200, width: 240, height: 90 }; // 중심 y = 245
  const target = { width: 132, height: 50 };
  const down = computeCenterAlignedRelativePosition(ref, "DOWN", SPACING, target);
  const up = computeCenterAlignedRelativePosition(ref, "UP", SPACING, target);
  const refCenterY = ref.y + ref.height / 2;
  assert.equal(down.y + target.height / 2 - refCenterY, SPACING.vertical);
  assert.equal(refCenterY - (up.y + target.height / 2), SPACING.vertical);
  // 윗변 기준(옛 셈)이었다면 이 값이 나왔을 것이다 — 같아지면 이 시험은 아무것도 안 재고 있다.
  assert.notEqual(down.y, ref.y + SPACING.vertical, "윗변 간 간격으로 돌아가면 높이 차이만큼 중심이 어긋난다");
  // 가로는 전과 같은 규칙이다 — 기준의 중심 x 에 대상의 중심 x 를 맞춘다.
  assert.equal(down.x + target.width / 2, ref.x + ref.width / 2);
  assert.equal(up.x, down.x);
});

test("computeCenterAlignedRelativePosition: different node widths still produce correct center-x for UP/DOWN and correct bounding-box placement for LEFT/RIGHT", () => {
  const wideRef = { x: 100, y: 200, width: 240, height: 80 };
  const narrowTarget = computeCenterAlignedRelativePosition(wideRef, "DOWN", SPACING, { width: 132, height: 80 });
  assert.equal(narrowTarget.x + 132 / 2, wideRef.x + wideRef.width / 2);

  const rightTarget = computeCenterAlignedRelativePosition(wideRef, "RIGHT", SPACING, { width: 400, height: 80 });
  assert.equal(rightTarget.x, wideRef.x + wideRef.width + SPACING.horizontal);
});

test("computeCenterAlignedRelativePosition: never mutates the reference object", () => {
  const ref = { x: 100, y: 200, width: 180, height: 80 };
  computeCenterAlignedRelativePosition(ref, "RIGHT", SPACING, { width: 132, height: 60 });
  assert.deepEqual(ref, { x: 100, y: 200, width: 180, height: 80 });
});

// ---- 5C-6D follow-up #4 explicit verification set ----
// The pure math below was already correct as of follow-up #3 (unchanged
// this turn) — the actual follow-up #4 bug was in the CALLER's dimension
// SOURCE (CaseFlowchartNodePropertyPanel using a description-blind size
// ESTIMATE instead of React Flow's real measured dimensions), not this
// math. These tests exist to leave an explicit, literal record that the
// math handles the task's own worked numbers correctly, using the exact
// dimension pairs called out in the follow-up #4 spec.

test("follow-up #4 case 1: reference 120px high, target 80px high -> exact center alignment", () => {
  const ref = { x: 500, y: 100, width: 180, height: 120 };
  const target = computeCenterAlignedRelativePosition(ref, "RIGHT", SPACING, { width: 180, height: 80 });
  assert.equal(ref.y + ref.height / 2, target.y + 80 / 2);
});

test("follow-up #4 case 2: reference 80px high, target 140px high -> exact center alignment", () => {
  const ref = { x: 500, y: 100, width: 180, height: 80 };
  const target = computeCenterAlignedRelativePosition(ref, "LEFT", SPACING, { width: 180, height: 140 });
  assert.equal(ref.y + ref.height / 2, target.y + 140 / 2);
});

// ---- resolveEffectiveNodeDimensions (5C-6D follow-up #5) ----
// The actual follow-up #5 root cause: CaseFlowchartEditorScreen was calling
// React Flow's `getNode(id)`, which resolves to the ORIGINAL unmeasured
// object the caller itself passed in (confirmed by reading @xyflow/react's
// own source), so `.measured` was undefined on every single call — the
// follow-up #4 "fix" silently fell back to the description-blind estimate
// every time, changing nothing at runtime. `getInternalNode(id)` (React
// Flow's real internal, measured node store) is the actual fix; this
// resolver is the one place the measured-vs-fallback PRIORITY rule lives,
// used identically by the caller for every node it resolves.

const FALLBACK = { width: 180, height: 52 }; // a representative estimatedNodeDimensions() result

test("resolveEffectiveNodeDimensions: valid measured width/height fully override the fallback", () => {
  const result = resolveEffectiveNodeDimensions({ width: 210, height: 130 }, FALLBACK);
  assert.deepEqual(result, { width: 210, height: 130 });
});

test("resolveEffectiveNodeDimensions: missing measured (null) uses the fallback entirely", () => {
  assert.deepEqual(resolveEffectiveNodeDimensions(null, FALLBACK), FALLBACK);
  assert.deepEqual(resolveEffectiveNodeDimensions(undefined, FALLBACK), FALLBACK);
});

test("resolveEffectiveNodeDimensions: an empty measured object falls back on both axes", () => {
  assert.deepEqual(resolveEffectiveNodeDimensions({}, FALLBACK), FALLBACK);
});

test("resolveEffectiveNodeDimensions: partially-measured values fall back per-axis, not all-or-nothing", () => {
  // width measured, height not yet
  assert.deepEqual(resolveEffectiveNodeDimensions({ width: 210, height: undefined }, FALLBACK), { width: 210, height: FALLBACK.height });
  // height measured, width not yet
  assert.deepEqual(resolveEffectiveNodeDimensions({ width: undefined, height: 130 }, FALLBACK), { width: FALLBACK.width, height: 130 });
});

test("resolveEffectiveNodeDimensions: a description/multiline fallback never overrides a validly-measured axis, however much they disagree", () => {
  // Exactly the real-world bug scenario: the estimate believes a short box, but the real rendered node (with a description line) is taller.
  const tallDescriptionFallback = { width: 180, height: 52 }; // estimate never accounted for the description line
  const result = resolveEffectiveNodeDimensions({ width: 180, height: 90 }, tallDescriptionFallback);
  assert.equal(result.height, 90, "the REAL measured height must win, not the description-blind estimate");
});

test("resolveEffectiveNodeDimensions: non-finite or zero measured values are treated as unmeasured", () => {
  assert.deepEqual(resolveEffectiveNodeDimensions({ width: NaN, height: 130 }, FALLBACK), { width: FALLBACK.width, height: 130 });
  assert.deepEqual(resolveEffectiveNodeDimensions({ width: Infinity, height: 130 }, FALLBACK), { width: FALLBACK.width, height: 130 });
  assert.deepEqual(resolveEffectiveNodeDimensions({ width: 0, height: 130 }, FALLBACK), { width: FALLBACK.width, height: 130 }, "a measured 0 is never a real chip's rendered size");
});

test("resolveEffectiveNodeDimensions: never mutates its inputs", () => {
  const measured = { width: 210, height: 130 };
  const measuredCopy = { ...measured };
  const fallback = { ...FALLBACK };
  resolveEffectiveNodeDimensions(measured, fallback);
  assert.deepEqual(measured, measuredCopy);
  assert.deepEqual(fallback, FALLBACK);
});

// ---- resolveColumnSnappedRelativePosition (5C-6D follow-up #3) ----

const TARGET_W = 180;
const TARGET_H = 80;
const TOLERANCE = SPACING.horizontal / 2; // 140 — derived from the same relative-position spacing constant, not a magic number

test("resolveColumnSnappedRelativePosition: an existing right-side node above snaps the new RIGHT placement to its center-x column", () => {
  // A --- D (row 0); B below A (row 1); moving/placing C to the RIGHT of B should snap to D's column.
  const d: ColumnSnapCandidate = { id: "d", x: 780, y: 0, width: 180, height: 80 }; // center x = 870
  const candidate = { x: 790, y: 300, width: 180, height: 80 }; // B's RIGHT candidate — close to D's column but not exact (different ref width upstream)
  const result = resolveColumnSnappedRelativePosition({
    candidateX: candidate.x,
    candidateY: candidate.y,
    targetWidth: TARGET_W,
    targetHeight: TARGET_H,
    existingNodes: [d],
    excludeNodeIds: ["b"],
    tolerance: TOLERANCE,
  });
  assert.equal(result.snappedToNodeId, "d");
  assert.equal(result.x + TARGET_W / 2, d.x + d.width / 2); // snapped center-x matches D's center-x exactly
  assert.equal(result.y, candidate.y); // only x snaps — y stays at the center-aligned candidate y
});

test("resolveColumnSnappedRelativePosition: an existing left-side node above snaps the new LEFT placement to its column", () => {
  const leftAbove: ColumnSnapCandidate = { id: "left-above", x: -50, y: 0, width: 180, height: 80 }; // center x = 40
  const candidate = { x: -60, y: 300 };
  const result = resolveColumnSnappedRelativePosition({
    candidateX: candidate.x,
    candidateY: candidate.y,
    targetWidth: TARGET_W,
    targetHeight: TARGET_H,
    existingNodes: [leftAbove],
    excludeNodeIds: [],
    tolerance: TOLERANCE,
  });
  assert.equal(result.snappedToNodeId, "left-above");
  assert.equal(result.x + TARGET_W / 2, leftAbove.x + leftAbove.width / 2);
});

test("resolveColumnSnappedRelativePosition: multiple candidate nodes above — the nearest-above one wins, never array order", () => {
  const far: ColumnSnapCandidate = { id: "far-above", x: 795, y: -400, width: 180, height: 80 }; // further above
  const near: ColumnSnapCandidate = { id: "near-above", x: 785, y: 0, width: 180, height: 80 }; // closer above
  const candidate = { x: 790, y: 300 };
  // Deliberately listed with the FARTHER one first, to prove this isn't array-order dependent.
  const result = resolveColumnSnappedRelativePosition({
    candidateX: candidate.x,
    candidateY: candidate.y,
    targetWidth: TARGET_W,
    targetHeight: TARGET_H,
    existingNodes: [far, near],
    excludeNodeIds: [],
    tolerance: TOLERANCE,
  });
  assert.equal(result.snappedToNodeId, "near-above");
});

test("resolveColumnSnappedRelativePosition: an unrelated far-away column is never snapped to — default relative x is used", () => {
  const unrelated: ColumnSnapCandidate = { id: "unrelated", x: 2000, y: 0, width: 180, height: 80 };
  const candidate = { x: 790, y: 300 };
  const result = resolveColumnSnappedRelativePosition({
    candidateX: candidate.x,
    candidateY: candidate.y,
    targetWidth: TARGET_W,
    targetHeight: TARGET_H,
    existingNodes: [unrelated],
    excludeNodeIds: [],
    tolerance: TOLERANCE,
  });
  assert.equal(result.snappedToNodeId, null);
  assert.equal(result.x, candidate.x);
  assert.equal(result.y, candidate.y);
});

test("resolveColumnSnappedRelativePosition: a node BELOW the candidate is never used as an above-column candidate, even in the same column", () => {
  const below: ColumnSnapCandidate = { id: "below", x: 790, y: 600, width: 180, height: 80 }; // same column, but below the candidate
  const candidate = { x: 790, y: 300 };
  const result = resolveColumnSnappedRelativePosition({
    candidateX: candidate.x,
    candidateY: candidate.y,
    targetWidth: TARGET_W,
    targetHeight: TARGET_H,
    existingNodes: [below],
    excludeNodeIds: [],
    tolerance: TOLERANCE,
  });
  assert.equal(result.snappedToNodeId, null);
});

test("resolveColumnSnappedRelativePosition: excluded node ids (the node being moved / the reference) are never snap candidates even if geometrically qualifying", () => {
  const reference: ColumnSnapCandidate = { id: "ref", x: 790, y: 300, width: 180, height: 80 };
  const candidate = { x: 790, y: 300 };
  const result = resolveColumnSnappedRelativePosition({
    candidateX: candidate.x,
    candidateY: candidate.y,
    targetWidth: TARGET_W,
    targetHeight: TARGET_H,
    existingNodes: [reference],
    excludeNodeIds: ["ref"],
    tolerance: TOLERANCE,
  });
  assert.equal(result.snappedToNodeId, null);
});

test("resolveColumnSnappedRelativePosition: different node widths still compare by center-x, not raw left-edge x", () => {
  // A narrow node and a wide node share the same center-x (870) despite very different left-edge x.
  const wideAbove: ColumnSnapCandidate = { id: "wide-above", x: 770, y: 0, width: 200, height: 80 }; // center x = 870
  const candidate = { x: 800, y: 300 }; // candidate target width 180 => candidate center x = 890, within tolerance of 870
  const result = resolveColumnSnappedRelativePosition({
    candidateX: candidate.x,
    candidateY: candidate.y,
    targetWidth: TARGET_W,
    targetHeight: TARGET_H,
    existingNodes: [wideAbove],
    excludeNodeIds: [],
    tolerance: TOLERANCE,
  });
  assert.equal(result.snappedToNodeId, "wide-above");
  assert.equal(result.x + TARGET_W / 2, 870);
});

test("resolveColumnSnappedRelativePosition: never mutates its inputs", () => {
  const node: ColumnSnapCandidate = { id: "d", x: 780, y: 0, width: 180, height: 80 };
  const nodeCopy = { ...node };
  resolveColumnSnappedRelativePosition({
    candidateX: 790,
    candidateY: 300,
    targetWidth: TARGET_W,
    targetHeight: TARGET_H,
    existingNodes: [node],
    excludeNodeIds: [],
    tolerance: TOLERANCE,
  });
  assert.deepEqual(node, nodeCopy);
});

// ---- computeStraightenedConnectedNodePosition (5C-6D follow-up #6) ----

test("computeStraightenedConnectedNodePosition: vertical-dominant connection aligns target center-X to source, target Y unchanged", () => {
  const source = { x: 500, y: 100, width: 180, height: 80 }; // center (590, 140)
  const target = { x: 560, y: 400, width: 180, height: 80 }; // center (650, 440) -> dx=60, dy=300 -> vertical-dominant
  const result = computeStraightenedConnectedNodePosition(source, target);
  assert.equal(result.orientation, "VERTICAL");
  const sourceCenterX = source.x + source.width / 2;
  assert.equal(result.position.x + target.width / 2, sourceCenterX);
  assert.equal(result.position.y, target.y, "target Y must stay unchanged for a vertical straighten");
});

test("computeStraightenedConnectedNodePosition: horizontal-dominant connection aligns target center-Y to source, target X unchanged", () => {
  const source = { x: 500, y: 300, width: 180, height: 80 }; // center (590, 340)
  const target = { x: 900, y: 340, width: 180, height: 80 }; // center (990, 380) -> dx=400, dy=40 -> horizontal-dominant
  const result = computeStraightenedConnectedNodePosition(source, target);
  assert.equal(result.orientation, "HORIZONTAL");
  const sourceCenterY = source.y + source.height / 2;
  assert.equal(result.position.y + target.height / 2, sourceCenterY);
  assert.equal(result.position.x, target.x, "target X must stay unchanged for a horizontal straighten");
});

test("computeStraightenedConnectedNodePosition: equal |dx| and |dy| deterministically prefers VERTICAL", () => {
  const source = { x: 500, y: 300, width: 100, height: 100 };
  const target = { x: 700, y: 500, width: 100, height: 100 }; // dx=200, dy=200 exactly
  const result = computeStraightenedConnectedNodePosition(source, target);
  assert.equal(result.orientation, "VERTICAL");
});

test("computeStraightenedConnectedNodePosition: different node widths still produce exact center-X alignment (vertical)", () => {
  const source = { x: 500, y: 100, width: 240, height: 80 }; // center x = 620
  const target = { x: 300, y: 400, width: 132, height: 80 };
  const result = computeStraightenedConnectedNodePosition(source, target);
  assert.equal(result.orientation, "VERTICAL");
  assert.equal(result.position.x + 132 / 2, 620);
});

test("computeStraightenedConnectedNodePosition: different node heights still produce exact center-Y alignment (horizontal)", () => {
  const source = { x: 500, y: 300, width: 180, height: 60 }; // center y = 330
  const target = { x: 900, y: 100, width: 180, height: 140 };
  const result = computeStraightenedConnectedNodePosition(source, target);
  assert.equal(result.orientation, "HORIZONTAL");
  assert.equal(result.position.y + 140 / 2, 330);
});

test("computeStraightenedConnectedNodePosition: source geometry is never mutated", () => {
  const source = { x: 500, y: 100, width: 180, height: 80 };
  const sourceCopy = { ...source };
  const target = { x: 560, y: 400, width: 180, height: 80 };
  computeStraightenedConnectedNodePosition(source, target);
  assert.deepEqual(source, sourceCopy);
});

test("computeStraightenedConnectedNodePosition: target geometry object is never mutated (only a new position is returned)", () => {
  const source = { x: 500, y: 100, width: 180, height: 80 };
  const target = { x: 560, y: 400, width: 180, height: 80 };
  const targetCopy = { ...target };
  computeStraightenedConnectedNodePosition(source, target);
  assert.deepEqual(target, targetCopy);
});

test("computeStraightenedConnectedNodePosition: an already vertically-aligned pair returns the target's current, unchanged position", () => {
  const source = { x: 500, y: 100, width: 180, height: 80 }; // center x = 590
  const target = { x: 500, y: 400, width: 180, height: 80 }; // already center x = 590 too
  const result = computeStraightenedConnectedNodePosition(source, target);
  assert.equal(result.orientation, "VERTICAL");
  assert.deepEqual(result.position, { x: target.x, y: target.y });
});

test("computeStraightenedConnectedNodePosition: an already horizontally-aligned pair returns the target's current, unchanged position", () => {
  const source = { x: 500, y: 300, width: 180, height: 80 }; // center y = 340
  const target = { x: 900, y: 300, width: 180, height: 80 }; // already center y = 340 too
  const result = computeStraightenedConnectedNodePosition(source, target);
  assert.equal(result.orientation, "HORIZONTAL");
  assert.deepEqual(result.position, { x: target.x, y: target.y });
});

const LAYERED_SPACING = { horizontal: 280, vertical: 150 };

/**
 * 🔵 아래 묶음의 `height` 는 2026-11-05 에 **필수 칸이 되면서** 더해졌다. 값이
 * 다 같은 52 인 것은 일부러다 — 높이가 같으면 전체가 26(=52/2)만큼 위로 평행
 * 이동할 뿐 **서로의 관계가 하나도 안 바뀐다**는 것을 이 시험들이 그대로 통과함
 * 으로써 보인다. 높이가 **다를** 때의 중심 맞춤은 아래 따로 모아 둔 묶음이 잰다.
 */
const CHIP_H = 52;

test("computeLayeredGraphLayout: a straight A->B->C chain stays at the same x (vertical continuation), one depth per hop", () => {
  const nodes = [
    { id: "a", sortOrder: 0, width: 0, height: CHIP_H },
    { id: "b", sortOrder: 1, width: 0, height: CHIP_H },
    { id: "c", sortOrder: 2, width: 0, height: CHIP_H },
  ];
  const edges = [
    { fromNodeId: "a", toNodeId: "b" },
    { fromNodeId: "b", toNodeId: "c" },
  ];
  const result = computeLayeredGraphLayout(nodes, edges, LAYERED_SPACING);
  const a = result.get("a")!;
  const b = result.get("b")!;
  const c = result.get("c")!;
  assert.equal(a.x, b.x, "B must share A's x — a single-parent/single-child continuation");
  assert.equal(b.x, c.x, "C must share B's x");
  assert.equal(b.y - a.y, 150);
  assert.equal(c.y - b.y, 150);
});

/**
 * ────────────────────────────────────────────────────────────────────────
 * 🔴 한 부모 밑에서 **줄기 하나**는 부모의 열에 그대로 남는다 (2026-11-05 오후)
 * ────────────────────────────────────────────────────────────────────────
 * 이 시험은 전에 「자식 둘이 부모 중심을 기준으로 **좌우 대칭**으로 펴진다」를
 * 값으로 지키고 있었다(`(yes.x + no.x) / 2 === d.x`). 그 단언은 맞았지만, 그
 * 동작이 곧 결함이었다 — 자식이 둘이면 −140 과 +140 이라 **아무도 부모의 열에 안
 * 남고**, 판단 노드마다 줄기가 반 칸씩 밀려 그림이 대각선이 됐다(실제 절차:
 * 노드 79개 · 판단 40~51개). 그래서 단언을 **약하게 만든 것이 아니라 바꿨다**:
 * 「대칭인가」 대신 「**하나가 부모의 열에 정확히 남는가**」를 잰다 — 더 센 조건이다
 * (대칭은 둘 다 안 남아도 통과하지만, 이쪽은 안 남으면 바로 깨진다).
 */
test("computeLayeredGraphLayout: a DECISION's two children — 하나는 부모의 열을 **그대로** 잇고, 다른 하나만 오른쪽으로 한 칸 비켜선다", () => {
  const nodes = [
    { id: "d", sortOrder: 0, width: 0, height: CHIP_H },
    { id: "yes", sortOrder: 1, width: 0, height: CHIP_H },
    { id: "no", sortOrder: 2, width: 0, height: CHIP_H },
  ];
  const edges = [
    { fromNodeId: "d", toNodeId: "yes" },
    { fromNodeId: "d", toNodeId: "no" },
  ];
  const result = computeLayeredGraphLayout(nodes, edges, LAYERED_SPACING);
  const d = result.get("d")!;
  const yes = result.get("yes")!;
  const no = result.get("no")!;
  assert.equal(yes.x, d.x, "줄기 표시가 없으면 **첫 자식**이 부모의 열을 그대로 잇는다");
  assert.equal(no.x, d.x + LAYERED_SPACING.horizontal, "나머지 형제는 오른쪽으로만 간다");
  assert.notEqual(yes.x, no.x, "siblings must not overlap in x");
  // 🔴 **왼쪽에는 아무도 없다.** 줄기보다 왼쪽에 형제를 두면 충돌 풀기(왼→오른쪽
  //    밀기)가 그 형제를 통해 줄기를 밀어내, 고치려던 대각선으로 되돌아간다.
  assert.equal(Math.min(yes.x, no.x), d.x, "부모의 열이 그 깊이의 가장 왼쪽이어야 한다");

  /**
   * 🔴 2026-11-05 저녁 — 이 자리에 전에는 `assert.equal(yes.y, no.y)`(두 자식이
   * **같은 줄**에 선다)가 있었다. 세로를 깊이로 정하던 때의 사실이고, 그 때문에
   * 주 흐름과 가지가 **한 줄을 나눠 써서** 가지가 길어도 주 흐름이 한 칸만
   * 내려갔다 — 엑셀 원본과 모양이 갈린 뿌리가 거기였다(사용자: 「원본 엑셀처럼
   * 만들어줘」). 지금은 **가지가 먼저 한 줄, 줄기는 그 아래**다.
   * 🔵 단언을 지운 것이 아니라 **더 센 것으로 바꿨다**: 「같다」는 둘이 어디에
   * 있든 통과하지만, 아래는 **차례와 거리**를 값으로 못 박는다.
   */
  assert.equal(no.y, d.y + LAYERED_SPACING.vertical, "가지가 부모 바로 아래 한 줄");
  // 🔵 이 묶음의 눈금에는 **빈자리(verticalGap)가 없다.** 그래서 줄기는 가지의
  //    아랫변에 정확히 **맞닿는 자리**에 선다 — 빈자리를 주는 절차 도메인에서는
  //    그만큼 더 내려간다(procedure-auto-layout.test.ts 가 그쪽 값을 잰다).
  assert.equal(yes.y, no.y + CHIP_H, "줄기는 그 가지 **아래**로 내려간다");
  assert.ok(yes.y > no.y, "차례가 뒤집히면 엑셀과 반대 모양이 된다");
});

test("computeLayeredGraphLayout: **줄기 표시가 차례를 이긴다** — 늦게 온 자식도 continuesMainFlow 면 부모의 열을 잇는다", () => {
  const nodes = [
    { id: "d", sortOrder: 0, width: 0, height: CHIP_H },
    { id: "ng", sortOrder: 1, width: 0, height: CHIP_H },
    { id: "normal", sortOrder: 2, width: 0, height: CHIP_H },
  ];
  // 🔵 **NG 가 먼저** 온다 — 엑셀에서 들여온 선의 차례가 실제로 이렇다(연결선이
  //    그려진 차례일 뿐 뜻과 무관하다). 차례만 보면 NG 가 줄기가 돼 버린다.
  const edges = [
    { fromNodeId: "d", toNodeId: "ng" },
    { fromNodeId: "d", toNodeId: "normal", continuesMainFlow: true },
  ];
  const result = computeLayeredGraphLayout(nodes, edges, LAYERED_SPACING);
  assert.equal(result.get("normal")!.x, result.get("d")!.x, "줄기 선으로 들어온 자식이 부모의 열을 잇는다");
  assert.equal(result.get("ng")!.x, result.get("d")!.x + LAYERED_SPACING.horizontal);

  // 🔵 표본 확인 — 표시를 떼면 **정말로 뒤집힌다**. 안 뒤집히면 이 시험은
  //    continuesMainFlow 를 하나도 안 재고 있는 것이다.
  const hintless = computeLayeredGraphLayout(nodes, [{ fromNodeId: "d", toNodeId: "ng" }, { fromNodeId: "d", toNodeId: "normal" }], LAYERED_SPACING);
  assert.equal(hintless.get("ng")!.x, hintless.get("d")!.x);
  assert.equal(hintless.get("normal")!.x, hintless.get("d")!.x + LAYERED_SPACING.horizontal);
});

/**
 * 🔴 **얼마나 좋아지는가** — 판단이 연달아 20개 서고 각자 NG 가지를 하나씩 내는
 * 표본(실제 절차 「[RFG] 기본 정전 검사」가 노드 79개에 판단 40~51개다).
 *
 * 2026-11-05 오후의 고침 **전** 값(같은 표본을 같은 눈금으로 재어 둔 것):
 *   - 가지 1단계: 가로 폭 **2940**, 줄기 22칸이 서로 다른 x 를 **21개** 썼다
 *   - 가지 2단계: 가로 폭 **5600**, 역시 **21개**
 * 고침 **뒤**가 아래 단언이다 — 폭 280/560, 줄기가 쓰는 x 는 **1개**.
 */
test("computeLayeredGraphLayout: 판단이 연달아 20개 서도 **줄기는 한 열**에 머문다 — 가로 폭 2940 → 280", () => {
  const spacing = LAYERED_SPACING;
  const build = (ngSteps: number) => {
    const nodes = [{ id: "start", sortOrder: 0, width: 0, height: CHIP_H }];
    const edges: { fromNodeId: string; toNodeId: string; continuesMainFlow?: boolean }[] = [];
    let order = 1;
    for (let i = 1; i <= 20; i++) {
      nodes.push({ id: `d${i}`, sortOrder: order++, width: 0, height: CHIP_H });
      edges.push({ fromNodeId: i === 1 ? "start" : `d${i - 1}`, toNodeId: `d${i}`, continuesMainFlow: true });
      for (let s = 1; s <= ngSteps; s++) {
        nodes.push({ id: `n${i}_${s}`, sortOrder: order++, width: 0, height: CHIP_H });
        // 가지 안에서는 이어지는 선이 줄기다(가지 자신의 줄기) — 갈라지는 것은 판단에서뿐이다.
        edges.push({ fromNodeId: s === 1 ? `d${i}` : `n${i}_${s - 1}`, toNodeId: `n${i}_${s}`, continuesMainFlow: s > 1 });
      }
    }
    return { nodes, edges };
  };

  for (const [ngSteps, expectedWidth] of [[1, 280], [2, 560]] as const) {
    const { nodes, edges } = build(ngSteps);
    const result = computeLayeredGraphLayout(nodes, edges, spacing);
    assert.equal(result.size, nodes.length, "표본 확인 — 자리를 못 받은 칸이 있으면 아래 폭이 거짓이다");

    const trunkXs = new Set(["start", ...Array.from({ length: 20 }, (_, i) => `d${i + 1}`)].map((id) => result.get(id)!.x));
    assert.equal(trunkXs.size, 1, `NG ${ngSteps}단계: 줄기 21칸이 서로 다른 x 를 ${trunkXs.size}개 쓴다 — 1 이 아니면 대각선이다`);

    const xs = [...result.values()].map((p) => p.x);
    assert.equal(Math.max(...xs) - Math.min(...xs), expectedWidth, `NG ${ngSteps}단계의 가로 폭`);
    // 🔵 줄기가 **가장 왼쪽**이다 — 가지는 전부 오른쪽에만 선다.
    assert.equal([...trunkXs][0], Math.min(...xs));
  }
});

/**
 * 🔴 **합류점** — 정상/NG 두 팔이 같은 깊이에서 다시 만나는 자리. 기준 열이
 * 부모들의 **평균**이면 만날 때마다 눈금의 절반(140)씩 밀린다. 고침 전 측정(두 팔
 * 길이가 같은 다이아몬드 10개): 줄기가 서로 다른 x 를 **11개** 쓰고 가로 폭 **1540**.
 */
test("computeLayeredGraphLayout: 가지가 되돌아와 만나는 **합류점**은 줄기 쪽 부모의 열에 선다 — 평균(140)이 아니다", () => {
  const nodes = [
    { id: "d", sortOrder: 0, width: 0, height: CHIP_H },
    { id: "ok", sortOrder: 1, width: 0, height: CHIP_H }, // 정상 쪽 한 걸음
    { id: "fix", sortOrder: 2, width: 0, height: CHIP_H }, // NG 쪽 조치
    { id: "merge", sortOrder: 3, width: 0, height: CHIP_H }, // 둘이 만나는 다음 단계
  ];
  const edges = [
    { fromNodeId: "d", toNodeId: "ok", continuesMainFlow: true },
    { fromNodeId: "d", toNodeId: "fix" },
    { fromNodeId: "ok", toNodeId: "merge", continuesMainFlow: true },
    { fromNodeId: "fix", toNodeId: "merge" },
  ];
  const result = computeLayeredGraphLayout(nodes, edges, LAYERED_SPACING);
  // 🔵 표본 확인 — 두 부모가 **정말로 다른 열**에 서 있나. 같으면 평균이든
  //    아니든 값이 같아져 아래가 공짜로 통과한다.
  assert.equal(result.get("ok")!.x, result.get("d")!.x);
  assert.equal(result.get("fix")!.x, result.get("d")!.x + LAYERED_SPACING.horizontal);
  assert.equal(result.get("merge")!.x, result.get("d")!.x, "합류점이 줄기의 열로 돌아와야 한다");
  assert.notEqual(result.get("merge")!.x, (result.get("ok")!.x + result.get("fix")!.x) / 2, "평균(140)이면 합류할 때마다 반 칸씩 밀린다");

  // 🔵 줄기 표시가 하나도 없으면 **전처럼 평균**이다 — 힌트를 안 주는 부르는 쪽의
  //    값은 한 픽셀도 안 바뀐다는 근거.
  const hintless = computeLayeredGraphLayout(nodes, edges.map((e) => ({ fromNodeId: e.fromNodeId, toNodeId: e.toNodeId })), LAYERED_SPACING);
  assert.equal(hintless.get("merge")!.x, (hintless.get("ok")!.x + hintless.get("fix")!.x) / 2);
});

/**
 * 🔴 2026-11-05 저녁 — 이 시험은 전에 「형제가 늘어도 **아무것도** 안 움직인다」
 * 였다. 세로가 깊이로 정해지던 때는 참이었다. 세로를 「앞에 놓인 것들이 쓴 높이」로
 * 바꾸면서 **반만 참**이 됐다: 가로는 그대로지만, 새 가지가 **한 줄을 차지하므로**
 * 줄기는 그만큼 내려간다. 그것이 이번 변경의 요점 자체라 숨길 수 없다.
 * 🔵 그래서 재는 것을 둘로 나눴다 — 가로는 「한 픽셀도」, 세로는 「정확히 한 줄」.
 * 둘 다 정확한 값 단언이고, 「안 움직인다」 하나보다 더 많은 것을 지킨다.
 */
test("computeLayeredGraphLayout: 형제가 하나 늘어도 **가로는 한 픽셀도 안 움직인다** — 세로는 새 가지가 쓴 **한 줄만큼** 내려간다", () => {
  const nodes = [
    { id: "p", sortOrder: 0, width: 0, height: CHIP_H },
    { id: "c1", sortOrder: 1, width: 0, height: CHIP_H },
    { id: "c2", sortOrder: 2, width: 0, height: CHIP_H },
  ];
  const edges = [
    { fromNodeId: "p", toNodeId: "c1" },
    { fromNodeId: "p", toNodeId: "c2" },
  ];
  const before = computeLayeredGraphLayout(nodes, edges, LAYERED_SPACING);
  const after = computeLayeredGraphLayout(
    [...nodes, { id: "c3", sortOrder: 3, width: 0, height: CHIP_H }],
    [...edges, { fromNodeId: "p", toNodeId: "c3" }],
    LAYERED_SPACING
  );
  assert.equal(after.size, 4, "표본 확인 — 셋째가 정말 들어갔나");

  // 가로 — 셋 다 그대로다. 새 자식만 맨 오른쪽에 붙는다.
  for (const id of ["p", "c1", "c2"]) assert.equal(after.get(id)!.x, before.get(id)!.x, `${id} 의 가로가 움직이면 안 된다`);
  assert.equal(after.get("c3")!.x, before.get("c2")!.x + LAYERED_SPACING.horizontal, "새 자식만 맨 오른쪽에 붙는다");

  // 세로 — 부모와 **먼저 놓인 가지**는 그대로, **줄기만** 한 줄 내려간다.
  assert.equal(after.get("p")!.y, before.get("p")!.y, "부모는 안 움직인다");
  assert.equal(after.get("c2")!.y, before.get("c2")!.y, "먼저 놓인 가지도 안 움직인다");
  // 🔵 눈금에 빈자리가 없으므로 「한 줄」의 크기는 **새 가지의 높이**다(맞닿는다).
  assert.equal(after.get("c1")!.y - before.get("c1")!.y, CHIP_H, "줄기는 새 가지가 쓴 한 줄만큼 내려간다");
  assert.equal(after.get("c3")!.y, before.get("c1")!.y, "새 가지가 전에 줄기가 있던 줄을 가져간다");
});

/**
 * 🔴 2026-11-05 저녁 — 전에는 두 뿌리가 **같은 줄**(중심 y 0)에 섰다. 지금은
 * 둘째 뿌리의 나무가 첫째 나무 **아래**에서 시작한다. 까닭은 겹침이다: 뿌리를
 * 모두 0 에 두면 서로 다른 나무가 같은 줄을 나눠 쓰는데, 가로 충돌 풀기는 **같은
 * 깊이**끼리만 보므로 「같은 줄 · 같은 열 · 다른 깊이」를 못 막는다. 무작위 그래프
 * 4000개로 재어 보니 그때 **포개진 쌍이 294개**였고, 쌓고 나니 **0개**다.
 * 🔵 가로는 그대로다 — 뿌리는 여전히 왼쪽부터 한 칸씩이고, 서로 다른 열에 선다.
 */
test("computeLayeredGraphLayout: two independent root chains — 둘째 뿌리는 첫째 나무 **아래**에서 시작한다", () => {
  const nodes = [
    { id: "r1", sortOrder: 0, width: 0, height: CHIP_H },
    { id: "r2", sortOrder: 1, width: 0, height: CHIP_H },
  ];
  const result = computeLayeredGraphLayout(nodes, [], LAYERED_SPACING);
  const r1 = result.get("r1")!;
  const r2 = result.get("r2")!;
  // 첫 뿌리의 **중심 y** 는 여전히 0 이다(2026-11-05 오전의 중심점 결정 그대로) —
  // 돌려주는 y 는 좌상단이라 높이의 절반만큼 위다.
  assert.equal(r1.y + CHIP_H / 2, 0);
  assert.equal(r2.y + CHIP_H / 2, LAYERED_SPACING.vertical, "둘째 뿌리는 한 줄 아래");
  assert.notEqual(r1.x, r2.x, "가로는 전과 같이 서로 다른 열이다");
});

test("computeLayeredGraphLayout: a LOOP_BACK cycle (C -> A) never infinite-loops and every node still gets a position", () => {
  const nodes = [
    { id: "a", sortOrder: 0, width: 0, height: CHIP_H },
    { id: "b", sortOrder: 1, width: 0, height: CHIP_H },
    { id: "c", sortOrder: 2, width: 0, height: CHIP_H },
  ];
  const edges = [
    { fromNodeId: "a", toNodeId: "b" },
    { fromNodeId: "b", toNodeId: "c" },
    { fromNodeId: "c", toNodeId: "a" },
  ];
  const result = computeLayeredGraphLayout(nodes, edges, LAYERED_SPACING);
  assert.equal(result.size, 3);
  for (const n of nodes) assert.ok(Number.isFinite(result.get(n.id)!.x) && Number.isFinite(result.get(n.id)!.y));
});

/**
 * ────────────────────────────────────────────────────────────────────────
 * 🔴 이웃 사이는 **그 둘의 크기만큼** 벌린다 (2026-11-05 오후)
 * ────────────────────────────────────────────────────────────────────────
 * 사용자 신고: 「노드끼리 겹쳐서 보이기도 하고, 연결선이 노드에 겹쳐 있어서
 * 가시성이 좋지 않아」. 눈금은 고정인데 노드 폭은 제목이 정해서 생긴 일이다 —
 * 절차 도메인 실측으로 폭이 **132 ~ 527**(판단 노드는 ×1.25 가 더 붙는다 —
 * 🔵 527 은 **상한이 아니다**, 폭에는 상한이 없어 제목이 길수록 계속 넓어진다),
 * 높이가 **52 ~ 97** 이다(이쪽은 네 줄에서 잘려 **상한이 있다**).
 *
 * 🔵 아래 묶음만 `horizontalGap`/`verticalGap` 을 넘긴다. **위쪽 묶음은 안
 * 넘기므로 값이 한 픽셀도 안 바뀌었다** — 그래서 이 조각이 기존 동작을 안 건드린다는
 * 증거가 그 시험들의 통과 자체다.
 */
const SIZED_SPACING = { horizontal: 280, vertical: 150, horizontalGap: 148, verticalGap: 98 };
/** 절차 도메인의 실측 양 끝 — 가장 좁은 노드와 한 줄짜리 긴 제목. */
const NARROW_W = 132;
const WIDE_W = 527;

/** 서로 포개지는(가로·세로 둘 다 겹치는) 쌍의 개수. 0 이 「안 포개진다」의 값이다. */
function countOverlappingPairs(
  result: Map<string, { x: number; y: number }>,
  nodes: { id: string; width: number; height: number }[]
): number {
  const boxes = nodes.map((n) => {
    const p = result.get(n.id)!;
    return { left: p.x, right: p.x + n.width, top: p.y, bottom: p.y + n.height };
  });
  let count = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top)) count += 1;
    }
  }
  return count;
}

/** 판단이 연달아 서고 각자 가지를 하나 내는 표본. 폭·높이를 번갈아 바꿔 넓은 칸이 이웃하게 만든다. */
function wideDecisionChain(count: number) {
  const nodes: { id: string; sortOrder: number; width: number; height: number }[] = [{ id: "start", sortOrder: 0, width: NARROW_W, height: CHIP_H }];
  const edges: { fromNodeId: string; toNodeId: string; continuesMainFlow?: boolean }[] = [];
  let order = 1;
  for (let i = 1; i <= count; i++) {
    nodes.push({ id: `d${i}`, sortOrder: order++, width: i % 2 === 0 ? WIDE_W : 254, height: i % 3 === 0 ? 97 : CHIP_H });
    edges.push({ fromNodeId: i === 1 ? "start" : `d${i - 1}`, toNodeId: `d${i}`, continuesMainFlow: true });
    nodes.push({ id: `n${i}`, sortOrder: order++, width: i % 2 === 0 ? 254 : WIDE_W, height: CHIP_H });
    edges.push({ fromNodeId: `d${i}`, toNodeId: `n${i}` });
  }
  return { nodes, edges };
}

/**
 * **한 부모 밑 형제들**의 모서리 사이 틈. 음수면 그만큼 포개진 것이다.
 *
 * 🔴 2026-11-05 저녁 전에는 이것이 「**같은 줄**(중심 y 가 같은 칸들)의 이웃 쌍」을
 * 모으는 함수였다. 세로를 쌓기로 바꾼 뒤로는 **어떤 두 칸도 같은 줄에 안 서므로**
 * 그 함수는 늘 빈 배열을 돌려준다 — 즉 아무것도 안 재게 된다. 가로 간격이 실제로
 * 걸리는 자리는 이제 **형제끼리**라, 재는 대상을 그쪽으로 옮겼다.
 */
function siblingEdgeGaps(
  result: Map<string, { x: number; y: number }>,
  nodes: { id: string; width: number; height: number }[],
  edges: { fromNodeId: string; toNodeId: string }[]
): number[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, string[]>();
  for (const e of edges) {
    if (!byId.has(e.fromNodeId) || !byId.has(e.toNodeId)) continue;
    if (!childrenOf.has(e.fromNodeId)) childrenOf.set(e.fromNodeId, []);
    childrenOf.get(e.fromNodeId)!.push(e.toNodeId);
  }
  const gaps: number[] = [];
  for (const children of childrenOf.values()) {
    if (children.length < 2) continue;
    const boxes = children
      .map((id) => ({ left: result.get(id)!.x, right: result.get(id)!.x + byId.get(id)!.width }))
      .sort((a, b) => a.left - b.left);
    for (let i = 1; i < boxes.length; i++) gaps.push(boxes[i].left - boxes[i - 1].right);
  }
  return gaps;
}

/**
 * 🔴 **얼마나 좋아지는가.** 고치기 **전**(간격이 눈금 280 고정)에 **절차 도메인의
 * 실제 제목·크기로** 재어 둔 값 — 판단 20개 · 제목이 전부 긴 표본에서 **포개진 쌍
 * 19개**, 가장 깊이 포갠 곳이 **268px** 이었다. 🔵 아래 표본은 그 숫자를 그대로
 * 재현하는 표본이 **아니다**(여기는 도메인을 모르므로 폭을 손으로 적는다) —
 * 같은 모양을 이 파일 안에서 흉내 내어 **지금은 0** 임을 값으로 적는다.
 * 실제 크기로 0 임을 재는 것은 procedure-auto-layout.test.ts 의 같은 이름 묶음이다.
 */
test("computeLayeredGraphLayout: 🔴 넓은 노드가 줄줄이 서도 **포개진 쌍이 0** 이다", () => {
  const { nodes, edges } = wideDecisionChain(10);
  const result = computeLayeredGraphLayout(nodes, edges, SIZED_SPACING);
  assert.equal(result.size, nodes.length);

  // 🔵 표본 확인 — 이 표본이 **옛 고정 간격이었다면 겹쳤을** 표본인가. 형제 쌍
  //    가운데 「폭의 절반 합 + 148」이 눈금 280 을 넘어 크기 규칙이 **이긴** 쌍을
  //    센다. 0 이면 이 시험은 겹침을 안 재고 있다(폭을 전부 0 으로 두면 그렇게 된다).
  const sizeRuleWon = siblingEdgeGaps(result, nodes, edges).filter((gap) => gap === SIZED_SPACING.horizontalGap).length;
  assert.ok(sizeRuleWon > 0, "크기 규칙이 한 번도 안 이긴 표본이면 이 시험은 겹침을 안 재고 있다");

  assert.equal(countOverlappingPairs(result, nodes), 0, "한 쌍도 안 포개져야 한다");
  assert.ok(Math.min(...siblingEdgeGaps(result, nodes, edges)) >= SIZED_SPACING.horizontalGap, "형제 사이 틈이 전부 148 이상이다");

  // 🔴 2026-11-05 저녁부터는 **어떤 두 칸도 같은 줄에 안 선다** — 겹침이 구조적으로
  //    불가능한 까닭이 이것이다(세로가 겹칠 수가 없으니 가로가 어떻든 안 포갠다).
  assert.equal(new Set(nodes.map((n) => result.get(n.id)!.y + n.height / 2)).size, nodes.length, "줄을 나눠 쓰는 칸이 있으면 안 된다");
});

test("computeLayeredGraphLayout: 빈자리를 **안 넘겨도 겹치지는 않는다** — 모서리가 맞닿을 뿐이다", () => {
  // 🔴 머리말의 「빈자리는 겹침을 막는 값이 아니라 숨 쉴 자리를 정하는 값」을
  //    값으로 적는다. 실측: 폭 527 짜리 형제 둘이 맞닿아 틈 0, 겹침 0.
  const { nodes, edges } = wideDecisionChain(10);
  const noGap = computeLayeredGraphLayout(nodes, edges, LAYERED_SPACING);
  assert.equal(countOverlappingPairs(noGap, nodes), 0);
  assert.equal(Math.min(...siblingEdgeGaps(noGap, nodes, edges)), 0, "빈자리가 0 이면 어딘가는 정확히 맞닿는다");
  // 그리고 빈자리를 주면 그 맞닿은 자리가 정확히 148 로 벌어진다.
  const withGap = computeLayeredGraphLayout(nodes, edges, SIZED_SPACING);
  assert.equal(Math.min(...siblingEdgeGaps(withGap, nodes, edges)), SIZED_SPACING.horizontalGap);
});

test("computeLayeredGraphLayout: 이웃한 두 형제의 **모서리 사이 빈자리가 정확히 horizontalGap**이다 — 폭이 서로 달라도", () => {
  const nodes = [
    { id: "p", sortOrder: 0, width: NARROW_W, height: CHIP_H },
    { id: "c1", sortOrder: 1, width: WIDE_W, height: CHIP_H },
    { id: "c2", sortOrder: 2, width: 254, height: CHIP_H },
  ];
  const edges = [
    { fromNodeId: "p", toNodeId: "c1" },
    { fromNodeId: "p", toNodeId: "c2" },
  ];
  const result = computeLayeredGraphLayout(nodes, edges, SIZED_SPACING);
  const right = (id: string, w: number) => result.get(id)!.x + w;
  assert.equal(result.get("c2")!.x - right("c1", WIDE_W), SIZED_SPACING.horizontalGap, "넓은 형제 옆이라도 빈자리는 정확히 148");
  // 🔵 중심 거리로 보면 눈금(280)이 아니다 — (527 + 254) / 2 + 148 = 538.5.
  assert.equal(result.get("c2")!.x + 254 / 2 - (result.get("c1")!.x + WIDE_W / 2), 538.5);
  assert.equal(countOverlappingPairs(result, nodes), 0);
});

test("computeLayeredGraphLayout: **좁은 칸끼리는 눈금이 이긴다** — 빈자리를 넘겨도 값이 전과 한 픽셀도 안 다르다", () => {
  const nodes = [
    { id: "p", sortOrder: 0, width: NARROW_W, height: CHIP_H },
    { id: "c1", sortOrder: 1, width: NARROW_W, height: CHIP_H },
    { id: "c2", sortOrder: 2, width: NARROW_W, height: CHIP_H },
  ];
  const edges = [
    { fromNodeId: "p", toNodeId: "c1" },
    { fromNodeId: "p", toNodeId: "c2" },
  ];
  const withGap = computeLayeredGraphLayout(nodes, edges, SIZED_SPACING);
  const without = computeLayeredGraphLayout(nodes, edges, LAYERED_SPACING);
  // 🔴 **가로만** 맞댄다. 전에는 지도 전체를 deepEqual 로 맞댔는데, 2026-11-05
  //    저녁부터 verticalGap 이 세로 **쌓임**에도 쓰여서(앞 형제의 아랫변 아래로
  //    내려 보낼 때) 세로 값은 당연히 달라진다. 이 시험이 지키려는 말은 처음부터
  //    「**가로** 빈자리를 줘도 좁은 칸끼리는 눈금대로 선다」였다.
  for (const id of ["p", "c1", "c2"]) assert.equal(withGap.get(id)!.x, without.get(id)!.x, `${id} 의 가로가 달라지면 안 된다 — 132 + 148 = 280 이라 max 가 눈금을 고른다`);
  // 🔵 표본 확인 — 이 비교가 「둘 다 비어서」 통과한 것이 아니다.
  assert.equal(withGap.size, 3);
  assert.equal(withGap.get("c2")!.x - withGap.get("c1")!.x, LAYERED_SPACING.horizontal);
  // 🔵 그리고 세로는 **정말 달라진다** — 위 단언이 가로만 본다는 것을 값으로 못 박는다.
  assert.notEqual(withGap.get("c1")!.y, without.get("c1")!.y);
});

/**
 * 🔵 깊이 0 은 **눈금 그대로 쌓고**, 벌리는 일은 바로 뒤의 충돌 풀기가 한다
 * (layout.ts 의 그 자리 주석 참고 — 두 길이 같은 값을 내므로 한쪽만 둔다).
 * 그래서 이 시험이 재는 것은 「뿌리끼리도 **결과적으로** 크기만큼 벌어진다」이다.
 */
test("computeLayeredGraphLayout: 뿌리끼리도 크기만큼 벌어진다 — 그래도 뒤에 뿌리를 더하면 앞선 뿌리는 안 움직인다", () => {
  const roots = [
    { id: "r1", sortOrder: 0, width: WIDE_W, height: CHIP_H },
    { id: "r2", sortOrder: 1, width: WIDE_W, height: CHIP_H },
  ];
  const two = computeLayeredGraphLayout(roots, [], SIZED_SPACING);
  assert.equal(two.get("r2")!.x - (two.get("r1")!.x + WIDE_W), SIZED_SPACING.horizontalGap, "뿌리끼리도 모서리 사이가 148");
  assert.equal(countOverlappingPairs(two, roots), 0);

  const three = computeLayeredGraphLayout([...roots, { id: "r3", sortOrder: 2, width: NARROW_W, height: CHIP_H }], [], SIZED_SPACING);
  assert.equal(three.get("r1")!.x, two.get("r1")!.x, "뿌리를 더해도 앞선 뿌리는 안 움직인다 — 2026-11-05 오전의 결정 그대로다");
  assert.equal(three.get("r2")!.x, two.get("r2")!.x);
});

test("computeLayeredGraphLayout: **충돌 풀기**도 눈금이 아니라 크기만큼 민다", () => {
  // p1 의 가지(c2)와 p2 의 줄기(c3)가 같은 열로 가서 c3 가 밀린다.
  const nodes = [
    { id: "p1", sortOrder: 0, width: NARROW_W, height: CHIP_H },
    { id: "p2", sortOrder: 1, width: NARROW_W, height: CHIP_H },
    { id: "c1", sortOrder: 2, width: NARROW_W, height: CHIP_H },
    { id: "c2", sortOrder: 3, width: WIDE_W, height: CHIP_H },
    { id: "c3", sortOrder: 4, width: WIDE_W, height: CHIP_H },
  ];
  const edges = [
    { fromNodeId: "p1", toNodeId: "c1" },
    { fromNodeId: "p1", toNodeId: "c2" },
    { fromNodeId: "p2", toNodeId: "c3" },
  ];
  const result = computeLayeredGraphLayout(nodes, edges, SIZED_SPACING);
  // 🔵 표본 확인 — c3 가 **정말 밀렸나**. 안 밀렸으면 충돌 풀기를 안 재고 있다.
  assert.notEqual(result.get("c3")!.x + WIDE_W / 2, result.get("p2")!.x + NARROW_W / 2, "c3 는 부모 p2 의 열에서 밀려나 있어야 한다");
  // 🔴 밀어낸 거리가 **눈금 280 이 아니다.** c1(132) → c3(527) 는
  //    (132+527)/2 + 148 = 477.5 만큼 벌어진다. 눈금으로 밀었다면 겹친 채였다.
  assert.equal(result.get("c3")!.x + WIDE_W / 2 - (result.get("c1")!.x + NARROW_W / 2), 477.5);
  assert.deepEqual(siblingEdgeGaps(result, nodes, edges).filter((g) => g < SIZED_SPACING.horizontalGap), [], "밀린 뒤에도 모든 형제 틈이 148 이상");
  assert.equal(countOverlappingPairs(result, nodes), 0);
});

/**
 * 🔴 2026-11-05 저녁 — 이 시험은 전에 「세로는 **그 줄의 가장 높은 노드**로 잰다」
 * 였다. 세로가 깊이로 정해지던 때는 같은 깊이가 한 줄을 통째로 썼으니 그 줄에서
 * 가장 높은 칸을 봐야 했다. 지금은 **한 칸이 한 줄**을 쓰므로 「그 줄의 최대 높이」
 * 라는 말 자체가 없어졌고, 거리는 **맞닿는 두 칸의 높이**로 곧장 잰다.
 * 🔵 재는 것은 그대로다 — 「높이를 안 보면 아래 칸을 뚫는다」. 더 정확해졌을 뿐이다
 * (줄에 혼자 높은 칸이 있다고 **다른 칸까지** 밀려나지 않는다).
 */
test("computeLayeredGraphLayout: 세로 거리는 **맞닿는 두 칸의 높이**로 잰다 — 높은 칸이 끼면 그만큼만 벌어진다", () => {
  const nodes = [
    { id: "p", sortOrder: 0, width: NARROW_W, height: CHIP_H },
    { id: "short", sortOrder: 1, width: NARROW_W, height: CHIP_H },
    { id: "tall", sortOrder: 2, width: NARROW_W, height: 97 }, // 제목이 네 줄이라 혼자 높다
    { id: "below", sortOrder: 3, width: NARROW_W, height: CHIP_H },
  ];
  const edges = [
    { fromNodeId: "p", toNodeId: "short" },
    { fromNodeId: "p", toNodeId: "tall", continuesMainFlow: true },
    { fromNodeId: "tall", toNodeId: "below", continuesMainFlow: true },
  ];
  const result = computeLayeredGraphLayout(nodes, edges, SIZED_SPACING);
  const centerY = (id: string, h: number) => result.get(id)!.y + h / 2;

  // 🔵 표본 확인 — 줄기는 tall 이다(선에 표시가 있어 차례를 이긴다). 가지 short 가
  //    먼저 한 줄을 쓰고, 줄기 tall 은 그 아래로 내려간다.
  assert.equal(result.get("tall")!.x, result.get("p")!.x, "tall 이 부모의 열을 잇는 줄기다");
  assert.ok(result.get("short")!.x > result.get("tall")!.x, "short 는 오른쪽 가지다");

  // 부모(52) → 가지(52): 둘 다 낮으므로 눈금이 이긴다.
  assert.equal(centerY("short", CHIP_H) - centerY("p", CHIP_H), 150);
  // 🔴 가지(52)의 아랫변 아래로 줄기(97)가 내려간다 — 그 칸이 높은 만큼 더 내려간다.
  //    (52/2) + 98 + (97/2) = 172.5 이고, 눈금 150 보다 크므로 크기 쪽이 이긴다.
  assert.equal(centerY("tall", 97) - centerY("short", CHIP_H), 172.5, "두 칸의 높이로 잰다 — 52 끼리로 쟀다면 150 이다");
  // 줄기(97) → 그 자식(52): 역시 두 칸의 높이로 172.5.
  assert.equal(centerY("below", CHIP_H) - centerY("tall", 97), 172.5);
  // 🔴 아랫변이 다음 칸의 윗변을 넘지 않는다 — 「뚫는다」를 직접 재는 줄.
  assert.ok(result.get("tall")!.y + 97 <= result.get("below")!.y, "높은 칸의 아랫변이 아래 칸의 윗변을 넘으면 안 된다");
  assert.equal(countOverlappingPairs(result, nodes), 0);
});

test("computeLayeredGraphLayout: 크기만큼 벌려도 **줄기는 여전히 한 열**이고 **pinned 는 안 움직인다**", () => {
  const { nodes, edges } = wideDecisionChain(10);
  const trunkIds = ["start", ...Array.from({ length: 10 }, (_, i) => `d${i + 1}`)];
  const plain = computeLayeredGraphLayout(nodes, edges, SIZED_SPACING);
  const trunkCenters = new Set(trunkIds.map((id) => plain.get(id)!.x + nodes.find((n) => n.id === id)!.width / 2));
  assert.equal(trunkCenters.size, 1, "줄기 11칸이 서로 다른 x 를 쓰면 간격 고침이 줄기 규칙을 깬 것이다");

  // 가지 하나를 사람이 끌어다 놓은 자리에 못 박는다 — 그 칸만은 그 값 그대로다.
  const pinnedNodes = nodes.map((n) => (n.id === "n3" ? { ...n, pinnedX: -1234 } : n));
  const pinned = computeLayeredGraphLayout(pinnedNodes, edges, SIZED_SPACING);
  assert.equal(pinned.get("n3")!.x, -1234, "못 박힌 칸은 간격을 벌리려고도 안 움직인다");
  // 🔵 그리고 **왼쪽에 못 박힌 칸이 생겨도** 줄기는 그대로 한 열이다.
  assert.equal(new Set(trunkIds.map((id) => pinned.get(id)!.x + nodes.find((n) => n.id === id)!.width / 2)).size, 1);
});

test("computeLayeredGraphLayout: empty input returns an empty map", () => {
  assert.equal(computeLayeredGraphLayout([], [], LAYERED_SPACING).size, 0);
});

test("computeLayeredGraphLayout: an edge referencing an unknown node id is ignored, never throws", () => {
  const nodes = [{ id: "a", sortOrder: 0, width: 0, height: CHIP_H }];
  const edges = [{ fromNodeId: "a", toNodeId: "ghost" }];
  const result = computeLayeredGraphLayout(nodes, edges, LAYERED_SPACING);
  assert.equal(result.size, 1);
  // 중심이 (0, 0) — 폭 0 이라 x 는 그대로 0 이고, y 만 높이의 절반만큼 위다.
  assert.deepEqual(result.get("a"), { x: 0, y: -CHIP_H / 2 });
});

/**
 * Round-2 usability fix — "layout and line geometry must agree": an
 * unpositioned child under a manually-dragged (pinned) parent must center
 * on the parent's REAL persisted x, not a synthetic depth-based x this
 * function would otherwise invent in isolation.
 */
test("computeLayeredGraphLayout: an unpinned single child centers on its pinned parent's REAL x, not a synthetic one", () => {
  const nodes = [
    { id: "a", sortOrder: 0, width: 0, height: CHIP_H, pinnedX: 9999 }, // manually dragged far from where the algorithm would otherwise seed it
    { id: "b", sortOrder: 1, width: 0, height: CHIP_H },
  ];
  const edges = [{ fromNodeId: "a", toNodeId: "b" }];
  const result = computeLayeredGraphLayout(nodes, edges, LAYERED_SPACING);
  assert.equal(result.get("a")!.x, 9999);
  assert.equal(result.get("b")!.x, 9999, "B must align under A's actual pinned x, not a depth-0-seeded synthetic x");
});

test("computeLayeredGraphLayout: a pinned node's own x is never overwritten by the synthetic fan-out formula", () => {
  const nodes = [
    { id: "d", sortOrder: 0, width: 0, height: CHIP_H },
    { id: "yes", sortOrder: 1, width: 0, height: CHIP_H, pinnedX: 500 },
    { id: "no", sortOrder: 2, width: 0, height: CHIP_H },
  ];
  const edges = [
    { fromNodeId: "d", toNodeId: "yes" },
    { fromNodeId: "d", toNodeId: "no" },
  ];
  const result = computeLayeredGraphLayout(nodes, edges, LAYERED_SPACING);
  assert.equal(result.get("yes")!.x, 500);
});

test("computeLayeredGraphLayout: the same-depth collision pass never pushes a pinned node, only its unpinned neighbor", () => {
  const nodes = [
    { id: "r1", sortOrder: 0, width: 0, height: CHIP_H, pinnedX: 100 },
    { id: "r2", sortOrder: 1, width: 0, height: CHIP_H }, // unpinned root; would synthetically seed very close to r1
  ];
  const result = computeLayeredGraphLayout(nodes, [], LAYERED_SPACING);
  assert.equal(result.get("r1")!.x, 100, "the pinned node's x must never move, even to resolve a collision");
  assert.ok(Math.abs(result.get("r2")!.x - 100) >= LAYERED_SPACING.horizontal, "the unpinned neighbor is pushed clear instead");
});

test("computeLayeredGraphLayout: a grandchild with no override still chains correctly under a pinned grandparent", () => {
  const nodes = [
    { id: "a", sortOrder: 0, width: 0, height: CHIP_H, pinnedX: -400 },
    { id: "b", sortOrder: 1, width: 0, height: CHIP_H },
    { id: "c", sortOrder: 2, width: 0, height: CHIP_H },
  ];
  const edges = [
    { fromNodeId: "a", toNodeId: "b" },
    { fromNodeId: "b", toNodeId: "c" },
  ];
  const result = computeLayeredGraphLayout(nodes, edges, LAYERED_SPACING);
  assert.equal(result.get("b")!.x, -400);
  assert.equal(result.get("c")!.x, -400);
});

test("computeLayeredGraphLayout: pinnedX of null/undefined/non-finite is treated as unpinned (falls back to the synthetic formula)", () => {
  const nodes = [
    { id: "a", sortOrder: 0, width: 0, height: CHIP_H, pinnedX: null },
    { id: "b", sortOrder: 1, width: 0, height: CHIP_H, pinnedX: undefined },
    { id: "c", sortOrder: 2, width: 0, height: CHIP_H, pinnedX: NaN },
  ];
  const result = computeLayeredGraphLayout(nodes, [], LAYERED_SPACING);
  assert.equal(result.size, 3);
  for (const n of nodes) assert.ok(Number.isFinite(result.get(n.id)!.x));
});

/**
 * Round-3 usability fix — center-based alignment. React Flow's
 * node.position is TOP-LEFT, so two nodes sharing the same left-edge x do
 * NOT share the same center once their widths differ (e.g. a multiline
 * title made one node wider) — and center, not left edge, is what the
 * bottom/top handles (and therefore the rendered connector) actually key
 * off. These tests use different widths specifically to prove alignment
 * survives that difference.
 */
test("computeLayeredGraphLayout: a single child centers on its parent even when the child is much wider (different node widths)", () => {
  const nodes = [
    { id: "a", sortOrder: 0, width: 132, height: CHIP_H }, // narrow parent
    { id: "b", sortOrder: 1, width: 240, height: CHIP_H }, // much wider child (e.g. a multiline title)
  ];
  const edges = [{ fromNodeId: "a", toNodeId: "b" }];
  const result = computeLayeredGraphLayout(nodes, edges, LAYERED_SPACING);
  const a = result.get("a")!;
  const b = result.get("b")!;
  const aCenterX = a.x + 132 / 2;
  const bCenterX = b.x + 240 / 2;
  assert.equal(aCenterX, bCenterX, "centers must match even though left-edge x will necessarily differ for different widths");
  assert.notEqual(a.x, b.x, "left-edge x must NOT match here — that would mean the centers are misaligned instead");
});

test("computeLayeredGraphLayout: a 3-node vertical chain has identical center x throughout, even with three different widths", () => {
  const nodes = [
    { id: "a", sortOrder: 0, width: 132, height: CHIP_H },
    { id: "b", sortOrder: 1, width: 240, height: CHIP_H },
    { id: "c", sortOrder: 2, width: 180, height: CHIP_H },
  ];
  const edges = [
    { fromNodeId: "a", toNodeId: "b" },
    { fromNodeId: "b", toNodeId: "c" },
  ];
  const result = computeLayeredGraphLayout(nodes, edges, LAYERED_SPACING);
  const centerXOf = (id: string, width: number) => result.get(id)!.x + width / 2;
  const centers = [centerXOf("a", 132), centerXOf("b", 240), centerXOf("c", 180)];
  assert.equal(centers[0], centers[1]);
  assert.equal(centers[1], centers[2]);
});

test("computeLayeredGraphLayout: an unpinned child centers on a pinned parent's real center, accounting for the pinned parent's own width", () => {
  const nodes = [
    { id: "a", sortOrder: 0, width: 200, height: CHIP_H, pinnedX: 1000 }, // pinned top-left x=1000, width 200 -> real center = 1100
    { id: "b", sortOrder: 1, width: 132, height: CHIP_H },
  ];
  const edges = [{ fromNodeId: "a", toNodeId: "b" }];
  const result = computeLayeredGraphLayout(nodes, edges, LAYERED_SPACING);
  assert.equal(result.get("b")!.x + 132 / 2, 1100, "the child's center must equal the pinned parent's REAL center (1000 + 200/2), not its raw pinnedX");
});

/**
 * ────────────────────────────────────────────────────────────────────────
 * 🔴 세로도 **중심점 기준**이다 (2026-11-05)
 * ────────────────────────────────────────────────────────────────────────
 * 사용자 지시: 「노드의 대각선 꼭지점들을 가상의 선으로 잇고, 그 교차점을 그
 * 노드의 중심점으로 삼아서 정렬해」.
 *
 * 가로는 전부터 중심이었는데 세로만 **윗변**이었다. 브라우저 실측(2026-11-05)으로
 * 같은 줄에 선 노드 셋의 윗변이 전부 0 인데 중심은 26 · 26 · 41 이었다 — 제목이
 * 세 줄이라 높이가 82 인 노드 하나만 아래로 삐져나와 보였다. 아래 숫자 52 · 82 가
 * 그 실측값이다.
 */
/**
 * 🔴 2026-11-05 저녁 — 전에는 이 셋이 **같은 줄**(중심 y 0)에 서서, 「높이가 달라도
 * 중심이 같다」를 곧바로 보일 수 있었다. 세로를 쌓기로 바꾸면서 **어떤 두 칸도 같은
 * 줄에 안 서므로** 그 말을 그대로는 못 쓴다.
 *
 * 🔵 지키려는 것(2026-11-05 오전 결정 — 「세로는 노드의 **중심점**으로 잰다」)은
 * 그대로다. 그래서 재는 방식만 바꿨다: 쌓이는 거리를 **중심 간**으로 재면 눈금과
 * 맞고, **윗변 간**으로 재면 안 맞는다. 윗변 기준이면 혼자 높은 칸이 아래로
 * 삐져나온다 — 그것이 그날 고친 결함의 모양이었다(실측 26 · 26 · 41).
 */
test("computeLayeredGraphLayout: 높이가 다른 칸이 섞여도 **중심 간 거리**가 눈금이다 — 윗변 간 거리가 아니다", () => {
  const nodes = [
    { id: "a", sortOrder: 0, width: 0, height: 52 },
    { id: "b", sortOrder: 1, width: 0, height: 52 },
    { id: "h", sortOrder: 2, width: 0, height: 82 }, // 제목이 세 줄이라 혼자 높다
  ];
  const result = computeLayeredGraphLayout(nodes, [], LAYERED_SPACING);
  const centerY = (id: string, height: number) => result.get(id)!.y + height / 2;
  assert.equal(centerY("a", 52), 0, "첫 뿌리의 중심 y 는 여전히 0 이다");
  assert.equal(centerY("b", 52) - centerY("a", 52), LAYERED_SPACING.vertical);
  assert.equal(centerY("h", 82) - centerY("b", 52), LAYERED_SPACING.vertical, "혼자 높은 칸도 **중심 간**으로는 정확히 한 눈금이다");
  // 🔴 표본 확인 — **윗변 간** 거리는 눈금이 아니다. 같다면 높이가 안 섞인
  //    표본이거나 중심이 아니라 윗변으로 재고 있는 것이다.
  assert.notEqual(result.get("h")!.y - result.get("b")!.y, LAYERED_SPACING.vertical, "윗변까지 눈금이면 중심 기준이 아닌 것이다");
  assert.deepEqual([result.get("a")!.y, result.get("b")!.y, result.get("h")!.y], [-26, 124, 259]);
});

test("computeLayeredGraphLayout: 세로로 이어진 부모–자식의 **중심 y 간격이 눈금**이다 — 높이가 서로 달라도", () => {
  const nodes = [
    { id: "p", sortOrder: 0, width: 0, height: 82 },
    { id: "c", sortOrder: 1, width: 0, height: 52 },
  ];
  const result = computeLayeredGraphLayout(nodes, [{ fromNodeId: "p", toNodeId: "c" }], LAYERED_SPACING);
  const pCenterY = result.get("p")!.y + 82 / 2;
  const cCenterY = result.get("c")!.y + 52 / 2;
  assert.equal(cCenterY - pCenterY, LAYERED_SPACING.vertical);
  // 윗변 간 간격은 눈금이 아니다 — 165 다. 이것이 같아지면 높이가 같은 표본을 쓴 것이다.
  assert.notEqual(result.get("c")!.y - result.get("p")!.y, LAYERED_SPACING.vertical);
});

/**
 * 🔴 2026-11-05 저녁 — 이 시험은 전에 「높이를 0 → 52 로 올려도 **전체가 26 만큼
 * 위로 평행이동**할 뿐」이었다. 세로가 깊이로 정해지던 때는 높이가 자리에 전혀 안
 * 섞였으니 참이었다. 지금은 **쌓이는 거리에 높이가 들어가므로**(앞 형제의 아랫변
 * 아래로 내려 보낸다) 더는 평행이동이 아니다.
 *
 * 🔵 그래서 **아직 참인 쪽과 바뀐 쪽을 나눠** 둘 다 값으로 적는다 —
 *  ① 가지가 하나도 없는 **곧은 사슬**은 여전히 정확히 평행이동이다.
 *  ② 가지가 끼면 쌓이는 거리가 높이만큼 늘어난다.
 * 둘 다 정확한 값 단언이라 어느 쪽도 느슨해지지 않았다.
 */
test("computeLayeredGraphLayout: **곧은 사슬**은 높이를 올려도 정확히 평행이동이다 — 가로는 아예 높이와 무관하다", () => {
  const chain = (height: number) => [
    { id: "a", sortOrder: 0, width: 132, height },
    { id: "b", sortOrder: 1, width: 240, height },
    { id: "c", sortOrder: 2, width: 180, height },
  ];
  const edges = [
    { fromNodeId: "a", toNodeId: "b" },
    { fromNodeId: "b", toNodeId: "c" },
  ];
  const H = 52;
  const before = computeLayeredGraphLayout(chain(0), edges, LAYERED_SPACING);
  const after = computeLayeredGraphLayout(chain(H), edges, LAYERED_SPACING);
  assert.equal(before.size, 3, "표본 확인 — 지도가 비면 아래가 공짜로 통과한다");
  for (const n of chain(H)) {
    assert.equal(after.get(n.id)!.x, before.get(n.id)!.x, `${n.id} 의 x 는 높이와 무관해야 한다`);
    assert.equal(after.get(n.id)!.y, before.get(n.id)!.y - H / 2, `${n.id} 이 정확히 높이의 절반만큼만 위로 간다`);
  }
  // 🔵 줄이 정말 여럿인 표본인가 — 전부 한 줄이면 "평행이동"을 안 재고 있다.
  assert.equal(new Set([...after.values()].map((p) => p.y)).size, 3);
});

test("computeLayeredGraphLayout: **가지가 끼면** 높이를 올린 만큼 쌓이는 거리가 늘어난다 — 평행이동이 아니다", () => {
  const shape = (height: number) => [
    { id: "r1", sortOrder: 0, width: 132, height },
    { id: "c1", sortOrder: 1, width: 180, height }, // 줄기
    { id: "c2", sortOrder: 2, width: 96, height }, // 가지 — 줄기보다 먼저 한 줄을 쓴다
    { id: "g1", sortOrder: 3, width: 132, height },
  ];
  const edges = [
    { fromNodeId: "r1", toNodeId: "c1" },
    { fromNodeId: "r1", toNodeId: "c2" },
    { fromNodeId: "c1", toNodeId: "g1" },
  ];
  const before = computeLayeredGraphLayout(shape(0), edges, LAYERED_SPACING);
  const after = computeLayeredGraphLayout(shape(52), edges, LAYERED_SPACING);
  const centerY = (m: Map<string, { x: number; y: number }>, id: string, h: number) => m.get(id)!.y + h / 2;

  // 가지(c2)는 부모 바로 아래 한 줄 — 높이와 무관하게 눈금이다.
  assert.equal(centerY(before, "c2", 0) - centerY(before, "r1", 0), LAYERED_SPACING.vertical);
  assert.equal(centerY(after, "c2", 52) - centerY(after, "r1", 52), LAYERED_SPACING.vertical);
  /**
   * 🔴 줄기(c1)는 그 가지의 **아랫변** 아래로 내려가므로 높이가 섞인다.
   *  - 높이 0 · 빈자리 0 이면 쌓임이 **붕괴**한다: 아랫변이 곧 중심이라 줄기가
   *    가지와 **같은 줄**에 선다(차이 0). 크기가 0 이니 겹치지는 않는다.
   *  - 높이 52 면 가지의 아랫변 아래로 52 만큼 더 내려간다.
   * 🔵 이것이 「크기를 0 으로 넘기는 부르는 쪽은 값이 전과 같다」의 세로 쪽 모습이다.
   */
  assert.equal(centerY(before, "c1", 0) - centerY(before, "c2", 0), 0, "크기도 빈자리도 0 이면 쌓임이 붕괴한다");
  assert.equal(centerY(after, "c1", 52) - centerY(after, "c2", 52), 52, "높이가 생기면 그 높이만큼 더 내려간다");
  // 🔵 가로는 여전히 높이와 무관하다 — 이번 변경이 세로만 건드렸다는 근거.
  for (const n of shape(52)) assert.equal(after.get(n.id)!.x, before.get(n.id)!.x, `${n.id} 의 x`);
});

test("computeLayeredGraphLayout: height 가 비유한 값이면 0 으로 친다 — width 와 같은 규칙이다", () => {
  const nodes = [
    { id: "a", sortOrder: 0, width: 0, height: Number.NaN },
    { id: "b", sortOrder: 1, width: 0, height: Number.POSITIVE_INFINITY },
  ];
  const result = computeLayeredGraphLayout(nodes, [], LAYERED_SPACING);
  // 🔴 숫자를 **정확히** 못 박는다 — 높이를 안 걸렀다면 NaN/Infinity 가 셈에 섞여
  //    y 가 NaN 이 되거나 끝없이 내려간다. 「0 이다」만으로는 그걸 못 잡는다.
  assert.equal(result.get("a")!.y, 0, "첫 뿌리는 중심 0 · 높이 0 이라 좌상단도 0");
  // 🔵 둘째 뿌리는 2026-11-05 저녁부터 **한 줄 아래**다(전에는 둘 다 0 이었다) —
  //    높이를 0 으로 쳤기 때문에 정확히 눈금만큼이다.
  assert.equal(result.get("b")!.y, LAYERED_SPACING.vertical);
});

/**
 * ────────────────────────────────────────────────────────────────────────
 * 🔴 깊이 0 은 **왼쪽부터 한 칸씩** (2026-11-05)
 * ────────────────────────────────────────────────────────────────────────
 * 사용자 신고: 「노드를 만들면 이상한 위치에 만들어지고, 연결선을 이으면 원래
 * 자리로 돌아온다」. 가운데 대칭으로 펴던 옛 셈에서는 뿌리가 하나 늘 때마다
 * 손도 안 댄 기존 뿌리가 전부 눈금의 절반(140px)씩 밀렸다 — 브라우저 실측으로
 * A 의 x 가 −66 → −206 → −346 으로 갔다가, A→C 선을 잇자 −206 으로 돌아왔다.
 */
test("computeLayeredGraphLayout: 깊이 0 에 노드를 더해도 **기존 뿌리의 x 가 한 픽셀도 안 바뀐다**", () => {
  const root = (id: string, sortOrder: number) => ({ id, sortOrder, width: 0, height: 52 });
  const one = computeLayeredGraphLayout([root("a", 0)], [], LAYERED_SPACING);
  const two = computeLayeredGraphLayout([root("a", 0), root("b", 1)], [], LAYERED_SPACING);
  const three = computeLayeredGraphLayout([root("a", 0), root("b", 1), root("c", 2)], [], LAYERED_SPACING);

  assert.equal(one.get("a")!.x, 0);
  assert.equal(two.get("a")!.x, 0, "B 를 더해도 A 는 안 움직인다");
  assert.equal(three.get("a")!.x, 0, "C 를 더해도 A 는 안 움직인다");
  assert.equal(two.get("b")!.x, LAYERED_SPACING.horizontal);
  assert.equal(three.get("b")!.x, LAYERED_SPACING.horizontal, "C 를 더해도 B 는 안 움직인다");
  assert.equal(three.get("c")!.x, LAYERED_SPACING.horizontal * 2, "새 뿌리는 맨 뒤에만 붙는다");
});

test("computeLayeredGraphLayout: 🔵 **남는 것** — 선을 이어 어떤 뿌리가 깊이 0 에서 빠지면 그 뒤쪽 뿌리들이 한 칸 당겨진다", () => {
  // 순수 함수라 이전 배치를 기억할 수 없다. 고치지 않기로 한 동작이라 값으로 적어 둔다.
  const nodes = [
    { id: "a", sortOrder: 0, width: 0, height: 52 },
    { id: "b", sortOrder: 1, width: 0, height: 52 },
    { id: "c", sortOrder: 2, width: 0, height: 52 },
    { id: "d", sortOrder: 3, width: 0, height: 52 },
  ];
  const H = LAYERED_SPACING.horizontal;
  const allRoots = computeLayeredGraphLayout(nodes, [], LAYERED_SPACING);
  assert.deepEqual([allRoots.get("a")!.x, allRoots.get("b")!.x, allRoots.get("c")!.x, allRoots.get("d")!.x], [0, H, H * 2, H * 3]);

  // A→B 를 이으면 B 가 깊이 1 로 내려가고, 뒤에 있던 C·D 의 차례가 하나씩 줄어든다.
  const linked = computeLayeredGraphLayout(nodes, [{ fromNodeId: "a", toNodeId: "b" }], LAYERED_SPACING);
  assert.equal(linked.get("b")!.x, 0, "B 는 외동이라 부모 A 의 중심을 그대로 물려받는다");
  assert.equal(linked.get("c")!.x, H, "C 가 한 칸 당겨진다 — 2026-11-05 에 남기기로 한 동작");
  assert.equal(linked.get("d")!.x, H * 2);
  assert.equal(linked.get("a")!.x, 0, "앞쪽(A)은 그대로다 — 당겨지는 것은 빠진 노드의 뒤쪽뿐이다");
});

test("computeLayeredGraphLayout: 왼쪽부터 쌓아도 **pinned 노드는 제 x 를 그대로** 지킨다", () => {
  // 🔴 왼쪽부터 쌓으면 좌표가 전부 0 이상으로 옮겨가므로, 0 근처에 못 박힌 칸이
  //    있을 때 충돌 양상이 달라진다. 그래도 못 박힌 칸은 안 밀려야 한다.
  const atZero = computeLayeredGraphLayout(
    [
      { id: "r1", sortOrder: 0, width: 0, height: 52, pinnedX: 0 },
      { id: "r2", sortOrder: 1, width: 0, height: 52 },
      { id: "r3", sortOrder: 2, width: 0, height: 52 },
    ],
    [],
    LAYERED_SPACING
  );
  assert.equal(atZero.get("r1")!.x, 0, "못 박힌 칸은 충돌을 풀려고도 안 움직인다");
  assert.equal(atZero.get("r2")!.x, LAYERED_SPACING.horizontal);
  assert.equal(atZero.get("r3")!.x, LAYERED_SPACING.horizontal * 2);

  // 옛 대칭 좌표계에서 끌어다 놓아 **음수**로 저장된 자리도 그대로 남아야 한다.
  const atNegative = computeLayeredGraphLayout(
    [
      { id: "r1", sortOrder: 0, width: 0, height: 52 },
      { id: "r2", sortOrder: 1, width: 200, height: 52, pinnedX: -500 },
    ],
    [],
    LAYERED_SPACING
  );
  assert.equal(atNegative.get("r2")!.x, -500, "저장된 자리는 좌표계를 옮겨도 그 값 그대로다");
  assert.equal(atNegative.get("r1")!.x, 0);
});

test("computeLayeredGraphLayout: 같은 깊이의 두 노드는 여전히 안 겹친다 — 충돌 풀기가 듣는다", () => {
  const minGap = (result: Map<string, { x: number; y: number }>, ids: string[]) => {
    const xs = ids.map((id) => result.get(id)!.x).sort((a, b) => a - b);
    return xs.slice(1).reduce((min, x, i) => Math.min(min, x - xs[i]), Infinity);
  };

  // 뿌리 다섯 — 왼쪽부터 쌓는 것만으로 이미 눈금만큼 떨어진다.
  const roots = computeLayeredGraphLayout(
    Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, sortOrder: i, width: 0, height: 52 })),
    [],
    LAYERED_SPACING
  );
  assert.ok(minGap(roots, ["r0", "r1", "r2", "r3", "r4"]) >= LAYERED_SPACING.horizontal);

  // 깊이 1 — 부모가 둘이고, 한쪽의 **가지**가 옆 줄기와 겹치러 간다.
  const nodes = [
    { id: "p1", sortOrder: 0, width: 0, height: 52 },
    { id: "p2", sortOrder: 1, width: 0, height: 52 },
    { id: "c1", sortOrder: 2, width: 0, height: 52 },
    { id: "c2", sortOrder: 3, width: 0, height: 52 },
    { id: "c3", sortOrder: 4, width: 0, height: 52 },
  ];
  const result = computeLayeredGraphLayout(
    nodes,
    [
      { fromNodeId: "p1", toNodeId: "c1" },
      { fromNodeId: "p1", toNodeId: "c2" },
      { fromNodeId: "p2", toNodeId: "c3" },
    ],
    LAYERED_SPACING
  );
  // 🔵 표본 확인 — 충돌 풀기가 **정말 일을 했는가**. 줄기/가지 규칙만 보면
  //    c1 은 p1 의 열(0), c2 는 그 오른쪽 가지(280), c3 는 부모 p2 의 열(280)이라
  //    c2 와 **정확히 포개진다**. 그래서 c3 가 560 으로 밀려야 맞다.
  //    🔴 2026-11-05 오후 전에는 같은 표본이 c1 −140 · c2 +140 · c3 280 이었다
  //       (부모 중심 기준 좌우 대칭). 밀려나는 것은 그때도 c3 였다.
  assert.notEqual(result.get("c3")!.x, LAYERED_SPACING.horizontal, "밀리지 않았다면 이 시험은 충돌 풀기를 안 재고 있다");
  assert.deepEqual(
    ["c1", "c2", "c3"].map((id) => result.get(id)!.x),
    [0, LAYERED_SPACING.horizontal, LAYERED_SPACING.horizontal * 2],
    "밀린 가지는 한 칸만 더 간다 — 그리고 줄기(c1)는 안 밀린다"
  );
  assert.ok(minGap(result, ["c1", "c2", "c3"]) >= LAYERED_SPACING.horizontal);
});

test("isAlignedVerticalConnection: identical centers are aligned", () => {
  assert.equal(isAlignedVerticalConnection(500, 500), true);
});

test("isAlignedVerticalConnection: centers within floating-point drift are still aligned", () => {
  assert.equal(isAlignedVerticalConnection(500, 500.0000001), true);
});

test("isAlignedVerticalConnection: a real horizontal offset (a branch/offset edge) is not aligned", () => {
  assert.equal(isAlignedVerticalConnection(500, 780), false);
});

test("isAlignedVerticalConnection: a non-finite input (an unresolved node) is never a false positive", () => {
  assert.equal(isAlignedVerticalConnection(NaN, NaN), false);
  assert.equal(isAlignedVerticalConnection(500, NaN), false);
  assert.equal(isAlignedVerticalConnection(NaN, 500), false);
});

// ---- resolveConnectionHandles (가로 직선 연결선) ----

const geo = (x: number, y: number, width = 100, height = 50) => ({ x, y, width, height });

test("resolveConnectionHandles: 위아래로 놓인 관계는 지금까지처럼 아래→위로 붙는다", () => {
  const result = resolveConnectionHandles(geo(0, 0), geo(0, 200));
  assert.equal(result.orientation, "VERTICAL");
  assert.equal(result.sourceHandle, VERTICAL_HANDLE_IDS.bottomOut);
  assert.equal(result.targetHandle, VERTICAL_HANDLE_IDS.topIn);
});

test("resolveConnectionHandles: 오른쪽에 나란히 놓인 관계는 오른면→왼면으로 붙는다", () => {
  const result = resolveConnectionHandles(geo(0, 0), geo(300, 0));
  assert.equal(result.orientation, "HORIZONTAL");
  assert.equal(result.sourceHandle, HORIZONTAL_HANDLE_IDS.rightOut);
  assert.equal(result.targetHandle, HORIZONTAL_HANDLE_IDS.leftIn);
});

test("resolveConnectionHandles: 왼쪽으로 되돌아가는 관계는 왼면→오른면으로 붙는다", () => {
  const result = resolveConnectionHandles(geo(300, 0), geo(0, 20));
  assert.equal(result.orientation, "HORIZONTAL");
  assert.equal(result.sourceHandle, HORIZONTAL_HANDLE_IDS.leftOut);
  assert.equal(result.targetHandle, HORIZONTAL_HANDLE_IDS.rightIn);
});

test("resolveConnectionHandles: 대각선이면 더 많이 벌어진 축을 따르고, 동률이면 세로다(곧게 펴기와 같은 규칙)", () => {
  assert.equal(resolveConnectionHandles(geo(0, 0), geo(100, 400)).orientation, "VERTICAL");
  assert.equal(resolveConnectionHandles(geo(0, 0), geo(400, 100)).orientation, "HORIZONTAL");
  // |dx| === |dy| — computeStraightenedConnectedNodePosition과 같이 세로 우선
  assert.equal(resolveConnectionHandles(geo(0, 0), geo(200, 200)).orientation, "VERTICAL");
});

test("resolveConnectionHandles: 위치를 모르는 노드는 언제나 기존 세로 동작으로 남는다 — 추측하지 않는다", () => {
  assert.equal(resolveConnectionHandles(null, geo(300, 0)).orientation, "VERTICAL");
  assert.equal(resolveConnectionHandles(geo(0, 0), undefined).orientation, "VERTICAL");
  assert.equal(resolveConnectionHandles(geo(Number.NaN, 0), geo(300, 0)).orientation, "VERTICAL");
});

test("isAlignedHorizontalConnection: y가 사실상 같을 때만 참이다", () => {
  assert.equal(isAlignedHorizontalConnection(100, 100.4), true);
  assert.equal(isAlignedHorizontalConnection(100, 101), false);
  assert.equal(isAlignedHorizontalConnection(Number.NaN, 100), false);
});

/**
 * ────────────────────────────────────────────────────────────────────────
 * 🔴 세로는 **깊이가 아니라 「앞에 놓인 것들이 쓴 높이」**다 (2026-11-05 저녁)
 * ────────────────────────────────────────────────────────────────────────
 * 사용자가 엑셀 원본을 보여 주며: 「기준이 되는 메인줄기의 노드들이 서로 멀리
 * 띄어져 있어도 괜찮으니까 **원본 엑셀처럼** 만들어줘」.
 *
 * 엑셀은 주 흐름이 **왼쪽 한 열로 쭉** 내려가고 가지는 오른쪽에서 **따로 여러 단계**
 * 내려간다. 그래서 주 흐름 노드 사이가 **그 사이에 낀 가지가 차지한 높이만큼** 멀다.
 * 전에는 세로가 BFS 깊이였고, 주 흐름과 가지가 **한 줄을 나눠 써서** 가지가 아무리
 * 길어도 주 흐름은 한 칸만 내려갔다 — 엑셀과 갈리는 뿌리가 거기였다.
 *
 * 🔵 아래 묶음은 **빈자리를 주는 눈금**(SIZED_SPACING)을 쓴다. 높이 52 에 빈자리
 * 98 이면 한 칸이 정확히 150 이라 값이 읽기 쉽다.
 */
const V = SIZED_SPACING.vertical;

/** 주 흐름 d1..dCount, 각 di 가 가지를 steps 단계 낸다. */
function trunkWithBranches(count: number, steps: number) {
  const nodes: { id: string; sortOrder: number; width: number; height: number }[] = [{ id: "start", sortOrder: 0, width: NARROW_W, height: CHIP_H }];
  const edges: { fromNodeId: string; toNodeId: string; continuesMainFlow?: boolean }[] = [];
  let order = 1;
  for (let i = 1; i <= count; i++) {
    nodes.push({ id: `d${i}`, sortOrder: order++, width: NARROW_W, height: CHIP_H });
    edges.push({ fromNodeId: i === 1 ? "start" : `d${i - 1}`, toNodeId: `d${i}`, continuesMainFlow: true });
    for (let s = 1; s <= steps; s++) {
      nodes.push({ id: `g${i}_${s}`, sortOrder: order++, width: NARROW_W, height: CHIP_H });
      edges.push({ fromNodeId: s === 1 ? `d${i}` : `g${i}_${s - 1}`, toNodeId: `g${i}_${s}`, continuesMainFlow: s > 1 });
    }
  }
  return { nodes, edges };
}

test("computeLayeredGraphLayout: 🔴 **가지가 n 단계면 주 흐름의 다음 칸이 (n+1) 칸 아래**다 — 가지가 없으면 전과 같은 한 칸", () => {
  // 🔴 고치기 **전**에는 가지 길이와 무관하게 늘 한 칸(150)이었다. 그것이
  //    사용자가 「엑셀과 다르다」고 한 그 모양이다.
  const measured: Record<number, number> = {};
  for (const steps of [0, 1, 2, 3]) {
    const { nodes, edges } = trunkWithBranches(3, steps);
    const result = computeLayeredGraphLayout(nodes, edges, SIZED_SPACING);
    assert.equal(result.size, nodes.length, "표본 확인 — 자리를 못 받은 칸이 있으면 아래가 거짓이다");
    const centerY = (id: string) => result.get(id)!.y + CHIP_H / 2;
    const gaps = [centerY("d2") - centerY("d1"), centerY("d3") - centerY("d2")];
    assert.equal(new Set(gaps).size, 1, `가지 ${steps}단계: 주 흐름 사이 거리가 들쭉날쭉하다`);
    measured[steps] = gaps[0];
  }
  assert.deepEqual(measured, { 0: V, 1: V * 2, 2: V * 3, 3: V * 4 }, "가지 단계 수만큼 주 흐름이 더 내려간다");
});

test("computeLayeredGraphLayout: 주 흐름은 **가지보다 반드시 아래**에 선다 — 차례가 뒤집히면 엑셀과 반대다", () => {
  const { nodes, edges } = trunkWithBranches(3, 2);
  const result = computeLayeredGraphLayout(nodes, edges, SIZED_SPACING);
  const centerY = (id: string) => result.get(id)!.y + CHIP_H / 2;
  for (let i = 1; i <= 3; i++) {
    assert.ok(centerY(`g${i}_1`) > centerY(`d${i}`), `d${i} 의 가지는 그 아래에서 시작한다`);
    assert.ok(centerY(`g${i}_2`) > centerY(`g${i}_1`), "가지는 제 안에서 또 내려간다");
    if (i < 3) assert.ok(centerY(`d${i + 1}`) > centerY(`g${i}_2`), `d${i + 1} 은 그 가지의 **끝보다 아래**여야 한다`);
  }
  // 🔵 그리고 줄기는 여전히 **한 열**이다(이번 변경이 가로를 안 건드렸다는 근거).
  assert.equal(new Set(["start", "d1", "d2", "d3"].map((id) => result.get(id)!.x)).size, 1);
  assert.equal(countOverlappingPairs(result, nodes), 0);
});

test("computeLayeredGraphLayout: **가지 안에서 또 가지**가 나오면 그 높이도 더해진다", () => {
  const nodes = [
    { id: "p", sortOrder: 0, width: NARROW_W, height: CHIP_H },
    { id: "b", sortOrder: 1, width: NARROW_W, height: CHIP_H }, // p 의 가지
    { id: "bb", sortOrder: 2, width: NARROW_W, height: CHIP_H }, // b 의 가지(가지 안의 가지)
    { id: "bt", sortOrder: 3, width: NARROW_W, height: CHIP_H }, // b 의 줄기
    { id: "t", sortOrder: 4, width: NARROW_W, height: CHIP_H }, // p 의 줄기
  ];
  const edges = [
    { fromNodeId: "p", toNodeId: "b" },
    { fromNodeId: "p", toNodeId: "t", continuesMainFlow: true },
    { fromNodeId: "b", toNodeId: "bb" },
    { fromNodeId: "b", toNodeId: "bt", continuesMainFlow: true },
  ];
  const result = computeLayeredGraphLayout(nodes, edges, SIZED_SPACING);
  const centerY = (id: string) => result.get(id)!.y + CHIP_H / 2;
  assert.equal(centerY("p"), 0);
  assert.equal(centerY("b"), V, "가지");
  assert.equal(centerY("bb"), V * 2, "가지 안의 가지");
  assert.equal(centerY("bt"), V * 3, "가지의 줄기 — 제 가지 아래");
  assert.equal(centerY("t"), V * 4, "p 의 줄기는 **가지 나무 전체** 아래다 — 세 칸을 건너뛴다");
  assert.equal(countOverlappingPairs(result, nodes), 0);
});

test("computeLayeredGraphLayout: **합류점은 두 팔 중 긴 쪽보다 아래**에 선다", () => {
  // d → (정상) ok → m,  d → (NG) fx1 → fx2 → m   — NG 팔이 더 길다.
  const nodes = ["d", "ok", "fx1", "fx2", "m"].map((id, i) => ({ id, sortOrder: i, width: NARROW_W, height: CHIP_H }));
  const edges = [
    { fromNodeId: "d", toNodeId: "ok", continuesMainFlow: true },
    { fromNodeId: "d", toNodeId: "fx1" },
    { fromNodeId: "fx1", toNodeId: "fx2", continuesMainFlow: true },
    { fromNodeId: "ok", toNodeId: "m", continuesMainFlow: true },
    { fromNodeId: "fx2", toNodeId: "m" },
  ];
  const result = computeLayeredGraphLayout(nodes, edges, SIZED_SPACING);
  const centerY = (id: string) => result.get(id)!.y + CHIP_H / 2;
  // 🔵 표본 확인 — 두 팔이 **정말 다른 줄**에 있나. 같은 줄이면 「둘보다 아래」가
  //    한쪽만 재도 통과해 버린다.
  assert.deepEqual([centerY("d"), centerY("fx1"), centerY("fx2"), centerY("ok"), centerY("m")], [0, V, V * 2, V * 3, V * 4]);
  /**
   * 🔵 **왜 저절로 되는가** — 합류점 m 은 줄기 팔(ok)의 자식이고, 줄기 팔은 이미
   * **가지 팔 전체 아래**에 놓였다. 그래서 m 은 두 팔 어느 쪽보다도 아래다.
   * 「긴 쪽을 따로 재서 더 큰 쪽을 고른다」는 셈이 필요 없다 — 쌓는 차례가 그것을
   * 대신한다. 🔴 다만 **가지 팔이 트리에서 합류점을 먼저 발견하면** 이 성질이
   * 깨진다(아래 「남는 것」 묶음이 그 경우를 값으로 적어 둔다).
   */
  assert.ok(centerY("m") > centerY("fx2"), "합류점은 가지 팔의 끝보다 아래");
  assert.ok(centerY("m") > centerY("ok"), "줄기 팔보다도 아래");
  assert.equal(countOverlappingPairs(result, nodes), 0);
});

/**
 * 🔴 **남는 것** — 가지 팔이 줄기 팔보다 **짧으면**, 합류점이 가지 팔의 자식이 되어
 * (BFS 가 먼저 발견한다) 줄기보다 **위**에 선다. 그러면 줄기에서 합류점으로 가는
 * 선이 위로 거슬러 올라간다. 2026-11-05 저녁에 **고치지 않고 값으로 적어 둔다.**
 *
 * 🔵 고치려면 깊이를 「가장 짧은 길」이 아니라 「가장 긴 길」로 매겨야 한다 —
 * 깊이는 가로 묶음도 쓰는 값이라 그쪽까지 함께 바뀐다. 이번 조각의 범위 밖이다.
 * 🔵 실제 절차에서는 NG 가지가 조치 단계를 거쳐 **더 길어지는** 쪽이 흔해서, 위
 * 시험의 모양(가지가 더 긺)이 보통이다.
 */
test("computeLayeredGraphLayout: 🔵 **남는 것** — 가지 팔이 더 짧으면 합류점이 줄기보다 위에 선다", () => {
  // d → (NG) fx → m   (두 걸음),  d → (정상) ok1 → ok2 → m  (세 걸음)
  const nodes = ["d", "fx", "ok1", "ok2", "m"].map((id, i) => ({ id, sortOrder: i, width: NARROW_W, height: CHIP_H }));
  const edges = [
    { fromNodeId: "d", toNodeId: "fx" },
    { fromNodeId: "d", toNodeId: "ok1", continuesMainFlow: true },
    { fromNodeId: "fx", toNodeId: "m" },
    { fromNodeId: "ok1", toNodeId: "ok2", continuesMainFlow: true },
    { fromNodeId: "ok2", toNodeId: "m", continuesMainFlow: true },
  ];
  const result = computeLayeredGraphLayout(nodes, edges, SIZED_SPACING);
  const centerY = (id: string) => result.get(id)!.y + CHIP_H / 2;
  // 🔵 표본 확인 — 합류점이 **가지 쪽에서 먼저 발견**되는 모양인가(그래야 이 결함이 난다).
  assert.deepEqual([centerY("d"), centerY("fx"), centerY("m"), centerY("ok1"), centerY("ok2")], [0, V, V * 2, V * 3, V * 4]);
  assert.ok(centerY("m") < centerY("ok2"), "🔴 합류점이 줄기의 끝보다 **위**다 — 고치지 않고 적어 두는 동작");
  // 🔵 그래도 겹치지는 않는다. 선이 거슬러 올라갈 뿐이다.
  assert.equal(countOverlappingPairs(result, nodes), 0);
});

test("computeLayeredGraphLayout: 🔴 **되돌아가는 선은 높이 셈에 안 들어간다** — 고리가 있어도 끝없이 안 내려간다", () => {
  // a → b → c → a (LOOP_BACK). c 가 a 를 가리켜도 a 가 c 아래로 내려가면 안 된다.
  const nodes = ["a", "b", "c"].map((id, i) => ({ id, sortOrder: i, width: NARROW_W, height: CHIP_H }));
  const edges = [
    { fromNodeId: "a", toNodeId: "b", continuesMainFlow: true },
    { fromNodeId: "b", toNodeId: "c", continuesMainFlow: true },
    { fromNodeId: "c", toNodeId: "a", continuesMainFlow: true }, // 되돌이 — 일부러 줄기 표시까지 붙였다
  ];
  const result = computeLayeredGraphLayout(nodes, edges, SIZED_SPACING);
  const centerY = (id: string) => result.get(id)!.y + CHIP_H / 2;
  assert.deepEqual([centerY("a"), centerY("b"), centerY("c")], [0, V, V * 2], "되돌이가 자리를 하나도 안 바꾼다");
  for (const n of nodes) assert.ok(Number.isFinite(result.get(n.id)!.y), "끝없이 내려가거나 NaN 이 되면 안 된다");
  assert.equal(countOverlappingPairs(result, nodes), 0);
});

test("computeLayeredGraphLayout: 세로를 바꿔도 **pinned 의 x 는 그대로**다 — 세로는 애초에 못 박는 값이 없다", () => {
  const { nodes, edges } = trunkWithBranches(3, 2);
  const pinnedNodes = nodes.map((n) => (n.id === "g2_1" ? { ...n, pinnedX: -1234 } : n));
  const result = computeLayeredGraphLayout(pinnedNodes, edges, SIZED_SPACING);
  assert.equal(result.get("g2_1")!.x, -1234, "못 박힌 칸의 x 는 그 값 그대로다");
  // 🔵 줄기는 여전히 한 열이고, 왼쪽에 못 박힌 칸이 생겨도 안 밀린다.
  assert.equal(new Set(["start", "d1", "d2", "d3"].map((id) => result.get(id)!.x)).size, 1);
});

/**
 * 🔴 **합류점이 메인줄기 위에 있으면 줄기의 열로 돌아온다** (2026-11-05 밤)
 *
 * 2026-11-05 **오후**에 「합류점은 줄기 쪽 부모의 열」을 넣을 때, 여러 부모가 모두
 * 줄기 선을 보내면 **id 차례로 첫 부모**를 고르게 했다. 그때 주석에 「어느 쪽을
 * 골라도 열 하나에는 서므로 대각선은 안 생긴다」고 적었는데 **그것이 틀렸다** —
 * 같은 날 저녁 실측에서 다이아몬드 8개가 줄기 열을 **9개** 썼다. 되돌아오는 선이
 * 이름 없는 선(DEFAULT)이면 — 들여온 절차에서 흔하다 — 가지 쪽도 「줄기」라서
 * id 차례가 그쪽을 고를 수 있었다.
 *
 * 🟢 밤에 **메인줄기(mainChainIds)** 가 생기면서 이 자리가 풀렸다. 합류점이 사슬
 * 위에 있으면 부모가 누구든 **제 뿌리의 열에 못 박히기** 때문이다. 아래는 그때
 * 「남는 것」으로 적어 두었던 바로 그 표본이고, **값이 반대로 바뀌었다.**
 */
test("computeLayeredGraphLayout: 되돌아오는 선이 이름 없는 선이어도 **합류점이 줄기의 열로 돌아온다**", () => {
  // d → (정상) ok → m,  d → (NG) fx → m. 두 선 다 합류점으로 들어가고,
  // fx → m 은 이름 없는 선(= 줄기로 친다)이다. id 차례로는 "fx" 가 "ok" 보다 앞선다.
  const nodes = ["d", "fx", "ok", "m"].map((id, i) => ({ id, sortOrder: i, width: NARROW_W, height: CHIP_H }));
  const edges = [
    { fromNodeId: "d", toNodeId: "ok", continuesMainFlow: true },
    { fromNodeId: "d", toNodeId: "fx" },
    { fromNodeId: "ok", toNodeId: "m", continuesMainFlow: true },
    { fromNodeId: "fx", toNodeId: "m", continuesMainFlow: true }, // 이름 없는 선도 줄기로 쳐진다
  ];
  const result = computeLayeredGraphLayout(nodes, edges, SIZED_SPACING);
  const centerX = (id: string) => result.get(id)!.x + NARROW_W / 2;
  // 🔵 표본 확인 — 두 부모가 **정말 다른 열**에 있나. 같은 열이면 아래가 거저 통과한다.
  assert.equal(centerX("ok"), centerX("d"), "줄기 팔은 부모의 열");
  assert.equal(centerX("fx"), centerX("d") + SIZED_SPACING.horizontal, "가지 팔은 오른쪽 한 칸");
  // 🟢 합류점이 **줄기의 열**로 돌아온다. 2026-11-05 오후에는 여기서 fx 의 열이 나왔다.
  assert.equal(centerX("m"), centerX("d"), "합류점은 메인줄기의 열이다");
  assert.notEqual(centerX("m"), centerX("fx"), "가지의 열로 가면 다이아몬드마다 한 열씩 밀린다");
  // 🔵 그래서 사슬 d → ok → m 이 **한 열**이다.
  assert.equal(new Set(["d", "ok", "m"].map(centerX)).size, 1);
  assert.equal(countOverlappingPairs(result, nodes), 0);
});

test("computeLayeredGraphLayout: 🔴 **메인줄기는 가지에게 안 밀린다** — 미는 쪽이 못 박힌 칸일 때만 비켜선다", () => {
  // 줄기 t 가 가지 쪽에서 내려온 칸과 같은 열로 가는 모양. 밀리는 쪽은 가지여야 한다.
  const nodes = [
    { id: "r", sortOrder: 0, width: NARROW_W, height: CHIP_H },
    { id: "t", sortOrder: 1, width: NARROW_W, height: CHIP_H }, // 메인줄기
    { id: "b", sortOrder: 2, width: WIDE_W, height: CHIP_H }, // 가지 — 넓어서 줄기 자리를 넘본다
    { id: "b2", sortOrder: 3, width: WIDE_W, height: CHIP_H },
  ];
  const edges = [
    { fromNodeId: "r", toNodeId: "t", continuesMainFlow: true },
    { fromNodeId: "r", toNodeId: "b" },
    { fromNodeId: "b", toNodeId: "b2", continuesMainFlow: true },
  ];
  const result = computeLayeredGraphLayout(nodes, edges, SIZED_SPACING);
  const centerX = (id: string, w: number) => result.get(id)!.x + w / 2;
  assert.equal(centerX("t", NARROW_W), centerX("r", NARROW_W), "줄기는 뿌리의 열 그대로");
  assert.ok(centerX("b", WIDE_W) > centerX("t", NARROW_W), "밀리는 쪽은 가지다");

  /**
   * 🔴 **못 박힌 칸은 줄기를 이긴다.** 줄기 **왼쪽**에, 줄기와 너무 가깝게 못 박힌
   * 칸을 두면 줄기가 비켜선다.
   * 🔵 **왼쪽이어야 한다** — 충돌 풀기는 왼쪽에서 오른쪽으로만 밀기 때문이다.
   *    오른쪽에 못 박으면 줄기는 쳐다보지도 않는다(처음에 그렇게 적었다가 이
   *    시험이 안 물어서 알았다).
   */
  const PINNED_CENTER = -100; // 줄기(중심 0)의 왼쪽, 필요 거리 477.5 보다 훨씬 가깝다
  const pinned = computeLayeredGraphLayout(
    nodes.map((n) => (n.id === "b" ? { ...n, pinnedX: PINNED_CENTER - WIDE_W / 2 } : n)),
    edges,
    SIZED_SPACING
  );
  assert.equal(pinned.get("b")!.x + WIDE_W / 2, PINNED_CENTER, "못 박힌 칸은 그 값 그대로 — 줄기 때문에도 안 움직인다");
  assert.equal(
    pinned.get("t")!.x + NARROW_W / 2,
    PINNED_CENTER + Math.max(SIZED_SPACING.horizontal, (WIDE_W + NARROW_W) / 2 + SIZED_SPACING.horizontalGap),
    "🔴 줄기가 못 박힌 칸에 밀려 오른쪽으로 비켜선다 — 사람이 정한 자리가 줄기보다 세다"
  );
  assert.ok(pinned.get("t")!.x > result.get("t")!.x, "비켜선 뒤의 줄기는 원래보다 오른쪽이다");
});

/**
 * 🔴 **사슬의 두 칸이 같은 깊이에 떨어지는 모양** — 실제 절차에 있다.
 * `[RFG] 통전검사(3상입력)` 의 「FAN 회전 확인」이 이름 없는 선 둘을 내는데, 하나는
 * 48V 갈래로 돌아가고 다른 하나는 그 갈래의 끝으로 **질러간다**. BFS 는 지름길을
 * 타고 그 끝 칸을 얕은 깊이에 놓으므로, 사슬 칸 둘이 한 깊이에 선다.
 * 「한 자식만 부모의 열」 규칙으로는 둘 다 열에 못 두므로 **열에 못 박아야** 한다.
 */
test("computeLayeredGraphLayout: 사슬 칸 둘이 **같은 깊이**에 떨어져도 둘 다 줄기 열에 선다 — 지름길이 있는 모양", () => {
  // r →(주흐름) a → b → c,  그리고 r →(주흐름) c 로 **질러가는** 선이 하나 더 있다.
  const nodes = ["r", "a", "b", "c"].map((id, i) => ({ id, sortOrder: i, width: NARROW_W, height: CHIP_H }));
  const edges = [
    { fromNodeId: "r", toNodeId: "a", continuesMainFlow: true },
    { fromNodeId: "r", toNodeId: "c", continuesMainFlow: true }, // 지름길
    { fromNodeId: "a", toNodeId: "b", continuesMainFlow: true },
    { fromNodeId: "b", toNodeId: "c", continuesMainFlow: true },
  ];
  const result = computeLayeredGraphLayout(nodes, edges, SIZED_SPACING);
  const centerX = (id: string) => result.get(id)!.x + NARROW_W / 2;
  const centerY = (id: string) => result.get(id)!.y + CHIP_H / 2;
  // 🔵 표본 확인 — 지름길 때문에 c 가 **깊이 1**(a 와 같은 깊이)에 떨어진다. 같은
  //    줄은 아니다: 세로는 한 칸에 하나씩이라 c 가 r 의 **가지**로 먼저 한 줄을 쓰고
  //    (150), 줄기 a 가 그 아래(300), b 가 다시 아래(450)다.
  assert.deepEqual([centerY("r"), centerY("c"), centerY("a"), centerY("b")], [0, 150, 300, 450]);
  assert.equal(new Set(["r", "a", "b", "c"].map(centerY)).size, 4, "같은 줄에 두 칸이 서면 안 된다");
  // 🔴 넷 다 **한 열**이다. 못 박기를 빼면 c 가 옆으로 밀린다.
  assert.equal(new Set(["r", "a", "b", "c"].map(centerX)).size, 1, "사슬이 한 열이 아니면 못 박기가 안 듣는 것이다");
  assert.equal(countOverlappingPairs(result, nodes), 0);
});

test("computeLayeredGraphLayout: 🔴 **메인줄기가 묶음의 줄기를 고를 때 1순위**다 — 「딴 데서 줄기 선을 받았다」는 칸이 열을 못 가져간다", () => {
  /**
   * 2026-11-05 밤에 고친 결함의 **가장 작은 모양**이다. 묶음의 줄기를 「줄기 선을
   * 하나라도 받은 첫 칸」으로만 고르면, **이 부모에게서는 NG 로 들어왔는데 딴 데서
   * 줄기 선을 받은** 칸이 부모의 열을 가져가고 진짜 주 흐름이 옆으로 밀린다.
   * 실제 절차에서 그 일이 여섯 번 나 줄기가 **일곱 열**로 흩어졌다.
   */
  const nodes = ["r", "ng", "main", "end", "z"].map((id, i) => ({ id, sortOrder: i, width: NARROW_W, height: CHIP_H }));
  const edges = [
    { fromNodeId: "r", toNodeId: "ng" }, // 이 부모에게서는 NG(= 줄기 선 아님)
    { fromNodeId: "r", toNodeId: "main", continuesMainFlow: true }, // 진짜 주 흐름
    { fromNodeId: "main", toNodeId: "end", continuesMainFlow: true }, // 사슬은 이쪽으로 간다
    { fromNodeId: "main", toNodeId: "z" }, // z 는 가지 — 사슬 밖이다
    { fromNodeId: "z", toNodeId: "ng", continuesMainFlow: true }, // 🔴 ng 가 **사슬 밖에서** 줄기 선을 받는다
  ];
  const result = computeLayeredGraphLayout(nodes, edges, SIZED_SPACING);
  const centerX = (id: string) => result.get(id)!.x + NARROW_W / 2;
  // 🔵 표본 확인 — ng 가 **정말로** 딴 데서 줄기 선을 받고, 그러면서도 **사슬 밖**
  //    인가. 사슬 안이면 어차피 열에 못 박혀서 이 시험이 아무것도 안 잰다
  //    (처음에 그렇게 적었다가 통과해 버려서 알았다).
  assert.ok(edges.some((e) => e.toNodeId === "ng" && e.continuesMainFlow === true), "표본이 결함을 못 재는 모양이면 뜻이 없다");
  assert.equal(centerX("main"), centerX("r"), "진짜 주 흐름이 부모의 열을 잇는다");
  assert.equal(centerX("end"), centerX("r"), "그 아래도 같은 열");
  assert.equal(centerX("ng"), centerX("r") + SIZED_SPACING.horizontal, "🔴 NG 로 들어온 칸은 **옆으로** 간다 — 옛 규칙에서는 여기가 부모의 열(0)이었다");
});

/**
 * ────────────────────────────────────────────────────────────────────────
 * 🔴 **같은 줄에 세우는 가지**(sameRowBranch) (2026-11-05 밤)
 * ────────────────────────────────────────────────────────────────────────
 * 사용자 지시: 「[NG]로 연결되는 노드는 **수평으로 배치**되도록 해줘」. 원본 엑셀
 * 실측이 뒷받침한다 — 분기 193개 가운데 **NG 97개 중 94개가 부모의 오른쪽**,
 * 그 중 **87개가 같은 줄**이고, **정상 96개 중 같은 줄은 0개**다.
 *
 * 🔵 이 묶음만 `sameRowBranch` 를 넘긴다. **안 넘기는 위쪽 묶음은 값이 한 픽셀도
 * 안 바뀌었다** — 그 시험들이 그대로 통과하는 것이 근거다.
 */
test("computeLayeredGraphLayout: NG 가지는 **부모와 같은 줄, 오른쪽**에 선다 — 정상은 아래로", () => {
  const nodes = ["d", "ng", "ok"].map((id, i) => ({ id, sortOrder: i, width: NARROW_W, height: CHIP_H }));
  const edges = [
    { fromNodeId: "d", toNodeId: "ng", sameRowBranch: true },
    { fromNodeId: "d", toNodeId: "ok", continuesMainFlow: true },
  ];
  const result = computeLayeredGraphLayout(nodes, edges, SIZED_SPACING);
  const cx = (id: string) => result.get(id)!.x + NARROW_W / 2;
  const cy = (id: string) => result.get(id)!.y + CHIP_H / 2;
  assert.equal(cy("ng"), cy("d"), "NG 는 부모와 같은 줄");
  assert.ok(cx("ng") > cx("d"), "그리고 오른쪽");
  assert.equal(cy("ok"), cy("d") + V, "정상은 아래로 — NG 가 줄을 안 썼으므로 바로 다음 줄이다");
  assert.equal(cx("ok"), cx("d"), "정상은 부모의 열");
  assert.equal(countOverlappingPairs(result, nodes), 0);
});

test("computeLayeredGraphLayout: 🔴 같은 줄 가지는 **부모의 폭까지** 비켜선다 — 형제하고만 재면 포갠다", () => {
  // 부모가 527, NG 자식이 527 이면 형제 기준 거리(눈금 280)로는 **247px 포갠다**.
  const nodes = [
    { id: "d", sortOrder: 0, width: WIDE_W, height: CHIP_H },
    { id: "ng", sortOrder: 1, width: WIDE_W, height: CHIP_H },
    { id: "ok", sortOrder: 2, width: NARROW_W, height: CHIP_H },
  ];
  const edges = [
    { fromNodeId: "d", toNodeId: "ng", sameRowBranch: true },
    { fromNodeId: "d", toNodeId: "ok", continuesMainFlow: true },
  ];
  const result = computeLayeredGraphLayout(nodes, edges, SIZED_SPACING);
  // 🔵 표본 확인 — 같은 줄인가(아니면 가로를 안 재도 되니 시험이 뜻을 잃는다).
  assert.equal(result.get("ng")!.y, result.get("d")!.y);
  assert.equal(
    result.get("ng")!.x - (result.get("d")!.x + WIDE_W),
    SIZED_SPACING.horizontalGap,
    "부모의 아랫변이 아니라 **오른쪽 변**과의 틈이 정확히 148 이다"
  );
  assert.equal(countOverlappingPairs(result, nodes), 0);
});

test("computeLayeredGraphLayout: 같은 줄 가지가 **제 가지를 거느리면** 그 아래는 평소대로 내려간다", () => {
  const nodes = ["d", "ng", "ng2", "ok"].map((id, i) => ({ id, sortOrder: i, width: NARROW_W, height: CHIP_H }));
  const edges = [
    { fromNodeId: "d", toNodeId: "ng", sameRowBranch: true },
    { fromNodeId: "d", toNodeId: "ok", continuesMainFlow: true },
    { fromNodeId: "ng", toNodeId: "ng2", continuesMainFlow: true },
  ];
  const result = computeLayeredGraphLayout(nodes, edges, SIZED_SPACING);
  const cy = (id: string) => result.get(id)!.y + CHIP_H / 2;
  assert.equal(cy("ng"), cy("d"), "NG 자신만 부모 줄에 선다");
  assert.equal(cy("ng2"), cy("d") + V, "그 아래는 평소대로 한 줄 내려간다");
  assert.equal(cy("ok"), cy("d") + V * 2, "줄기는 그 가지 나무 **전체** 아래로 간다");
  assert.equal(countOverlappingPairs(result, nodes), 0);
});

/**
 * 🔴 2026-11-05 밤(둘째 판) — 「**외동**은 안 올린다」를 **걷어냈다.**
 *
 * 원래 까닭은 「올릴 자리가 곧 줄기 자리라 부모와 **같은 열**이 되어 포갠다」였다.
 * 그 까닭은 **열**에 관한 것이지 **줄**에 관한 것이 아니었다 — 오른쪽으로 세우면
 * 같은 줄이어도 안 포갠다. 그래서 걸개를 빼고 **줄기 없는 묶음**을 허용했다.
 *
 * 🔴 **값으로 재어 보니 이 걸개가 가장 컸다.** `[RFG] 원복 검사 및 개선 작업`
 * (노드 156)에서 안 올라간 NG 45개를 걸개별로 가르니:
 *   36개 ← 이 걸개(그 중 **32개는 실제로 나가는 선이 2개 이상**이었다 — 형제가
 *          이미 다른 데서 발견돼 **나무 자식**에서 빠졌을 뿐이다)
 *    5개 ← 그 NG 선이 나무 선이 아님 · 2개 ← 합류점 · 2개 ← 묶음이 쪼개져 홀로 남음
 * 걷어낸 뒤 그 절차의 NG 수평이 **47/92 → 85/92**, 줄이 **107 → 71** 이 됐다.
 */
test("computeLayeredGraphLayout: **외동 NG 도 올린다** — 줄은 부모와 같게, 열은 오른쪽으로", () => {
  const nodes = ["d", "ng", "after"].map((id, i) => ({ id, sortOrder: i, width: NARROW_W, height: CHIP_H }));
  const edges = [
    { fromNodeId: "d", toNodeId: "ng", sameRowBranch: true }, // d 의 나무 자식은 ng 하나뿐이다
    { fromNodeId: "ng", toNodeId: "after", continuesMainFlow: true },
  ];
  const result = computeLayeredGraphLayout(nodes, edges, SIZED_SPACING);
  const cx = (id: string) => result.get(id)!.x + NARROW_W / 2;
  const cy = (id: string) => result.get(id)!.y + CHIP_H / 2;
  assert.equal(cy("ng"), cy("d"), "외동이어도 부모와 같은 줄");
  assert.equal(cx("ng"), cx("d") + SIZED_SPACING.horizontal, "🔴 그리고 **오른쪽**으로 — 부모의 열에 두면 같은 줄·같은 열이라 포갠다");
  assert.equal(cy("after"), cy("d") + V, "그 아래는 평소대로");
  assert.equal(cx("after"), cx("ng"), "NG 의 열을 잇는다");
  assert.equal(countOverlappingPairs(result, nodes), 0);
});

test("computeLayeredGraphLayout: 같은 줄로 **안 올리는 둘** — 합류점 · 못 박힌 칸", () => {
  const base = (extra: { pinnedX?: number } = {}) => ["d", "ng", "ok", "other"].map((id, i) => ({ id, sortOrder: i, width: NARROW_W, height: CHIP_H, ...(id === "ng" ? extra : {}) }));

  // ① 합류점 — ng 로 들어오는 선이 둘이면 부모 줄로 안 올린다.
  const merge = computeLayeredGraphLayout(
    base(),
    [
      { fromNodeId: "d", toNodeId: "ng", sameRowBranch: true },
      { fromNodeId: "d", toNodeId: "ok", continuesMainFlow: true },
      { fromNodeId: "d", toNodeId: "other" },
      { fromNodeId: "other", toNodeId: "ng" },
    ],
    SIZED_SPACING
  );
  assert.notEqual(merge.get("ng")!.y, merge.get("d")!.y, "합류점은 안 올린다 — 다른 부모보다 위로 올라가면 선이 거슬러 올라간다");

  // ② 못 박힌 칸 — 사람이 끌어다 놓은 자리가 가장 세다.
  const pinnedResult = computeLayeredGraphLayout(
    base({ pinnedX: 900 }),
    [
      { fromNodeId: "d", toNodeId: "ng", sameRowBranch: true },
      { fromNodeId: "d", toNodeId: "ok", continuesMainFlow: true },
      { fromNodeId: "d", toNodeId: "other" },
    ],
    SIZED_SPACING
  );
  assert.equal(pinnedResult.get("ng")!.x, 900, "못 박힌 x 는 그대로");
  assert.notEqual(pinnedResult.get("ng")!.y, pinnedResult.get("d")!.y, "못 박힌 칸은 부모 줄로 안 끌어온다");
});

test("computeLayeredGraphLayout: 같은 줄로 올리는 것은 **한 부모에 하나**다 — 둘째 NG 는 아래로 내려간다", () => {
  const nodes = ["d", "ng1", "ng2", "ok"].map((id, i) => ({ id, sortOrder: i, width: NARROW_W, height: CHIP_H }));
  const edges = [
    { fromNodeId: "d", toNodeId: "ng1", sameRowBranch: true },
    { fromNodeId: "d", toNodeId: "ng2", sameRowBranch: true },
    { fromNodeId: "d", toNodeId: "ok", continuesMainFlow: true },
  ];
  const result = computeLayeredGraphLayout(nodes, edges, SIZED_SPACING);
  const cy = (id: string) => result.get(id)!.y + CHIP_H / 2;
  assert.equal(cy("ng1"), cy("d"), "첫째만 부모 줄");
  assert.notEqual(cy("ng2"), cy("d"), "둘째는 평소대로 — 둘 다 올리면 두 부분나무가 같은 줄들을 나눠 써서 포갠다");
  assert.equal(countOverlappingPairs(result, nodes), 0);
});
