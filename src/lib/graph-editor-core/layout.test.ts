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

test("computeCenterAlignedRelativePosition: UP/DOWN behavior is unchanged from computeRelativePosition (center-x, y offset by vertical spacing)", () => {
  const ref = { x: 100, y: 200, width: 240, height: 90 };
  const oldDown = computeRelativePosition(ref, "DOWN", SPACING, 132);
  const newDown = computeCenterAlignedRelativePosition(ref, "DOWN", SPACING, { width: 132, height: 50 });
  assert.deepEqual(newDown, oldDown);
  const oldUp = computeRelativePosition(ref, "UP", SPACING, 132);
  const newUp = computeCenterAlignedRelativePosition(ref, "UP", SPACING, { width: 132, height: 50 });
  assert.deepEqual(newUp, oldUp);
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

test("computeLayeredGraphLayout: a straight A->B->C chain stays at the same x (vertical continuation), one depth per hop", () => {
  const nodes = [
    { id: "a", sortOrder: 0, width: 0 },
    { id: "b", sortOrder: 1, width: 0 },
    { id: "c", sortOrder: 2, width: 0 },
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

test("computeLayeredGraphLayout: a DECISION's two children (branch) fan out symmetrically left/right of the parent, at the same depth", () => {
  const nodes = [
    { id: "d", sortOrder: 0, width: 0 },
    { id: "yes", sortOrder: 1, width: 0 },
    { id: "no", sortOrder: 2, width: 0 },
  ];
  const edges = [
    { fromNodeId: "d", toNodeId: "yes" },
    { fromNodeId: "d", toNodeId: "no" },
  ];
  const result = computeLayeredGraphLayout(nodes, edges, LAYERED_SPACING);
  const d = result.get("d")!;
  const yes = result.get("yes")!;
  const no = result.get("no")!;
  assert.equal(yes.y, no.y, "both branch children land at the same depth/row");
  assert.equal((yes.x + no.x) / 2, d.x, "children are centered symmetrically around the parent's x");
  assert.notEqual(yes.x, no.x, "siblings must not overlap in x");
});

test("computeLayeredGraphLayout: two independent root chains never overlap at the same depth", () => {
  const nodes = [
    { id: "r1", sortOrder: 0, width: 0 },
    { id: "r2", sortOrder: 1, width: 0 },
  ];
  const result = computeLayeredGraphLayout(nodes, [], LAYERED_SPACING);
  const r1 = result.get("r1")!;
  const r2 = result.get("r2")!;
  assert.equal(r1.y, 0);
  assert.equal(r2.y, 0);
  assert.notEqual(r1.x, r2.x);
});

test("computeLayeredGraphLayout: a LOOP_BACK cycle (C -> A) never infinite-loops and every node still gets a position", () => {
  const nodes = [
    { id: "a", sortOrder: 0, width: 0 },
    { id: "b", sortOrder: 1, width: 0 },
    { id: "c", sortOrder: 2, width: 0 },
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

test("computeLayeredGraphLayout: empty input returns an empty map", () => {
  assert.equal(computeLayeredGraphLayout([], [], LAYERED_SPACING).size, 0);
});

test("computeLayeredGraphLayout: an edge referencing an unknown node id is ignored, never throws", () => {
  const nodes = [{ id: "a", sortOrder: 0, width: 0 }];
  const edges = [{ fromNodeId: "a", toNodeId: "ghost" }];
  const result = computeLayeredGraphLayout(nodes, edges, LAYERED_SPACING);
  assert.equal(result.size, 1);
  assert.deepEqual(result.get("a"), { x: 0, y: 0 });
});

/**
 * Round-2 usability fix — "layout and line geometry must agree": an
 * unpositioned child under a manually-dragged (pinned) parent must center
 * on the parent's REAL persisted x, not a synthetic depth-based x this
 * function would otherwise invent in isolation.
 */
test("computeLayeredGraphLayout: an unpinned single child centers on its pinned parent's REAL x, not a synthetic one", () => {
  const nodes = [
    { id: "a", sortOrder: 0, width: 0, pinnedX: 9999 }, // manually dragged far from where the algorithm would otherwise seed it
    { id: "b", sortOrder: 1, width: 0 },
  ];
  const edges = [{ fromNodeId: "a", toNodeId: "b" }];
  const result = computeLayeredGraphLayout(nodes, edges, LAYERED_SPACING);
  assert.equal(result.get("a")!.x, 9999);
  assert.equal(result.get("b")!.x, 9999, "B must align under A's actual pinned x, not a depth-0-seeded synthetic x");
});

test("computeLayeredGraphLayout: a pinned node's own x is never overwritten by the synthetic fan-out formula", () => {
  const nodes = [
    { id: "d", sortOrder: 0, width: 0 },
    { id: "yes", sortOrder: 1, width: 0, pinnedX: 500 },
    { id: "no", sortOrder: 2, width: 0 },
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
    { id: "r1", sortOrder: 0, width: 0, pinnedX: 100 },
    { id: "r2", sortOrder: 1, width: 0 }, // unpinned root; would synthetically seed very close to r1
  ];
  const result = computeLayeredGraphLayout(nodes, [], LAYERED_SPACING);
  assert.equal(result.get("r1")!.x, 100, "the pinned node's x must never move, even to resolve a collision");
  assert.ok(Math.abs(result.get("r2")!.x - 100) >= LAYERED_SPACING.horizontal, "the unpinned neighbor is pushed clear instead");
});

test("computeLayeredGraphLayout: a grandchild with no override still chains correctly under a pinned grandparent", () => {
  const nodes = [
    { id: "a", sortOrder: 0, width: 0, pinnedX: -400 },
    { id: "b", sortOrder: 1, width: 0 },
    { id: "c", sortOrder: 2, width: 0 },
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
    { id: "a", sortOrder: 0, width: 0, pinnedX: null },
    { id: "b", sortOrder: 1, width: 0, pinnedX: undefined },
    { id: "c", sortOrder: 2, width: 0, pinnedX: NaN },
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
    { id: "a", sortOrder: 0, width: 132 }, // narrow parent
    { id: "b", sortOrder: 1, width: 240 }, // much wider child (e.g. a multiline title)
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
    { id: "a", sortOrder: 0, width: 132 },
    { id: "b", sortOrder: 1, width: 240 },
    { id: "c", sortOrder: 2, width: 180 },
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
    { id: "a", sortOrder: 0, width: 200, pinnedX: 1000 }, // pinned top-left x=1000, width 200 -> real center = 1100
    { id: "b", sortOrder: 1, width: 132 },
  ];
  const edges = [{ fromNodeId: "a", toNodeId: "b" }];
  const result = computeLayeredGraphLayout(nodes, edges, LAYERED_SPACING);
  assert.equal(result.get("b")!.x + 132 / 2, 1100, "the child's center must equal the pinned parent's REAL center (1000 + 200/2), not its raw pinnedX");
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
