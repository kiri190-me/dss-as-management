import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ROUTE_POINTS,
  isValidRoutePoint,
  sanitizeRoutePoints,
  resolveEffectiveEdgeRoute,
  hasManualRoute,
  insertWaypointAtSegment,
  addWaypointAtDefaultPosition,
  moveWaypoint,
  removeWaypoint,
  routePointsEqual,
} from "./procedure-edge-waypoints";

test("isValidRoutePoint: accepts exactly {x, y} with finite numbers", () => {
  assert.equal(isValidRoutePoint({ x: 1, y: 2 }), true);
  assert.equal(isValidRoutePoint({ x: -1.5, y: 0 }), true);
});

test("isValidRoutePoint: rejects NaN, Infinity, strings, null coordinates", () => {
  assert.equal(isValidRoutePoint({ x: NaN, y: 1 }), false);
  assert.equal(isValidRoutePoint({ x: Infinity, y: 1 }), false);
  assert.equal(isValidRoutePoint({ x: -Infinity, y: 1 }), false);
  assert.equal(isValidRoutePoint({ x: "1", y: 1 }), false);
  assert.equal(isValidRoutePoint({ x: null, y: 1 }), false);
  assert.equal(isValidRoutePoint({ x: undefined, y: 1 }), false);
});

test("isValidRoutePoint: rejects malformed objects — missing keys, extra keys, non-objects, arrays", () => {
  assert.equal(isValidRoutePoint({ x: 1 }), false);
  assert.equal(isValidRoutePoint({}), false);
  assert.equal(isValidRoutePoint(null), false);
  assert.equal(isValidRoutePoint(undefined), false);
  assert.equal(isValidRoutePoint("1,2"), false);
  assert.equal(isValidRoutePoint([1, 2]), false);
  assert.equal(isValidRoutePoint(42), false);
  // The "no React Flow internal objects stored" requirement — a raw RF-shaped
  // object carrying x/y plus other fields must be rejected, not silently
  // accepted with the extra fields dropped.
  assert.equal(isValidRoutePoint({ x: 1, y: 2, id: "node-1", type: "custom" }), false);
  assert.equal(isValidRoutePoint({ x: 1, y: 2, data: {} }), false);
});

test("sanitizeRoutePoints: null/undefined/empty array all normalize to null", () => {
  assert.deepEqual(sanitizeRoutePoints(null), { ok: true, points: null });
  assert.deepEqual(sanitizeRoutePoints(undefined), { ok: true, points: null });
  assert.deepEqual(sanitizeRoutePoints([]), { ok: true, points: null });
});

test("sanitizeRoutePoints: a valid ordered array round-trips unchanged (order preserved)", () => {
  const input = [
    { x: 1, y: 1 },
    { x: 5, y: 5 },
    { x: 10, y: 2 },
  ];
  const result = sanitizeRoutePoints(input);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.points, input);
});

test("sanitizeRoutePoints: rejects a non-array value", () => {
  const result = sanitizeRoutePoints({ x: 1, y: 2 });
  assert.equal(result.ok, false);
});

test("sanitizeRoutePoints: rejects an array containing any malformed point", () => {
  const result = sanitizeRoutePoints([{ x: 1, y: 1 }, { x: "bad", y: 2 }]);
  assert.equal(result.ok, false);
});

test("sanitizeRoutePoints: rejects an array containing NaN/Infinity anywhere", () => {
  assert.equal(sanitizeRoutePoints([{ x: 1, y: 1 }, { x: NaN, y: 2 }]).ok, false);
  assert.equal(sanitizeRoutePoints([{ x: 1, y: 1 }, { x: Infinity, y: 2 }]).ok, false);
});

test("sanitizeRoutePoints: normalizes adjacent duplicate points (drops repeats)", () => {
  const result = sanitizeRoutePoints([
    { x: 1, y: 1 },
    { x: 1, y: 1 },
    { x: 5, y: 5 },
    { x: 5, y: 5 },
    { x: 5, y: 5 },
    { x: 9, y: 9 },
  ]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.points, [
      { x: 1, y: 1 },
      { x: 5, y: 5 },
      { x: 9, y: 9 },
    ]);
  }
});

test("sanitizeRoutePoints: an array of only duplicate points dedupes down to the single distinct point (not null — one real point remains)", () => {
  const result = sanitizeRoutePoints([
    { x: 3, y: 3 },
    { x: 3, y: 3 },
    { x: 3, y: 3 },
  ]);
  assert.deepEqual(result, { ok: true, points: [{ x: 3, y: 3 }] });
});

test("sanitizeRoutePoints: accepts exactly MAX_ROUTE_POINTS distinct points", () => {
  const input = Array.from({ length: MAX_ROUTE_POINTS }, (_, i) => ({ x: i, y: i }));
  const result = sanitizeRoutePoints(input);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.points?.length, MAX_ROUTE_POINTS);
});

test("sanitizeRoutePoints: rejects more than MAX_ROUTE_POINTS distinct points", () => {
  const input = Array.from({ length: MAX_ROUTE_POINTS + 1 }, (_, i) => ({ x: i, y: i }));
  const result = sanitizeRoutePoints(input);
  assert.equal(result.ok, false);
});

test("sanitizeRoutePoints: rejects a pathologically large raw payload outright", () => {
  const input = Array.from({ length: 10000 }, (_, i) => ({ x: i, y: i }));
  const result = sanitizeRoutePoints(input);
  assert.equal(result.ok, false);
});

test("resolveEffectiveEdgeRoute: returns null in SOURCE and STAGE_SORTED layout regardless of stored points", () => {
  const edge = { userRoutePoints: [{ x: 1, y: 1 }, { x: 2, y: 2 }] };
  assert.equal(resolveEffectiveEdgeRoute(edge, "SOURCE"), null);
  assert.equal(resolveEffectiveEdgeRoute(edge, "STAGE_SORTED"), null);
});

test("resolveEffectiveEdgeRoute: returns the stored points only in USER layout", () => {
  const points = [{ x: 1, y: 1 }, { x: 2, y: 2 }];
  assert.deepEqual(resolveEffectiveEdgeRoute({ userRoutePoints: points }, "USER"), points);
});

test("resolveEffectiveEdgeRoute: null/empty override falls back to null (deterministic routing) even in USER layout", () => {
  assert.equal(resolveEffectiveEdgeRoute({ userRoutePoints: null }, "USER"), null);
  assert.equal(resolveEffectiveEdgeRoute({ userRoutePoints: [] }, "USER"), null);
});

test("hasManualRoute: true only for a real non-empty override", () => {
  assert.equal(hasManualRoute({ userRoutePoints: null }), false);
  assert.equal(hasManualRoute({ userRoutePoints: [] }), false);
  assert.equal(hasManualRoute({ userRoutePoints: [{ x: 1, y: 1 }] }), true);
});

test("insertWaypointAtSegment: inserts into an empty route between source and target", () => {
  const result = insertWaypointAtSegment([], { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 5 });
  assert.deepEqual(result, [{ x: 50, y: 5 }]);
});

test("insertWaypointAtSegment: inserts at the correct segment index among existing points (nearest-segment projection)", () => {
  // source(0,0) -> p0(10,0) -> p1(20,0) -> target(30,0); clicking near (15,1) is closest to the p0->p1 segment
  const result = insertWaypointAtSegment(
    [{ x: 10, y: 0 }, { x: 20, y: 0 }],
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 15, y: 1 }
  );
  assert.deepEqual(result, [{ x: 10, y: 0 }, { x: 15, y: 1 }, { x: 20, y: 0 }]);
});

test("insertWaypointAtSegment: a click near the source-side segment inserts at the front", () => {
  const result = insertWaypointAtSegment(
    [{ x: 20, y: 0 }],
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 3, y: 1 }
  );
  assert.deepEqual(result, [{ x: 3, y: 1 }, { x: 20, y: 0 }]);
});

test("insertWaypointAtSegment: a click near the target-side segment inserts at the end", () => {
  const result = insertWaypointAtSegment(
    [{ x: 10, y: 0 }],
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 27, y: 1 }
  );
  assert.deepEqual(result, [{ x: 10, y: 0 }, { x: 27, y: 1 }]);
});

test("addWaypointAtDefaultPosition: on an empty route, inserts at the midpoint between source and target", () => {
  const result = addWaypointAtDefaultPosition([], { x: 0, y: 0 }, { x: 100, y: 0 });
  assert.deepEqual(result, [{ x: 50, y: 0 }]);
});

test("addWaypointAtDefaultPosition: inserts at the midpoint of the single longest segment", () => {
  // source(0,0) -> p0(10,0) [short segment] -> target(200,0) [long segment]
  const result = addWaypointAtDefaultPosition([{ x: 10, y: 0 }], { x: 0, y: 0 }, { x: 200, y: 0 });
  assert.deepEqual(result, [{ x: 10, y: 0 }, { x: 105, y: 0 }]);
});

test("moveWaypoint: updates exactly one index, leaves the rest untouched", () => {
  const points = [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }];
  const result = moveWaypoint(points, 1, { x: 99, y: 99 });
  assert.deepEqual(result, [{ x: 1, y: 1 }, { x: 99, y: 99 }, { x: 3, y: 3 }]);
  // original array is not mutated
  assert.deepEqual(points, [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]);
});

test("moveWaypoint: out-of-range index is a no-op", () => {
  const points = [{ x: 1, y: 1 }];
  assert.deepEqual(moveWaypoint(points, 5, { x: 0, y: 0 }), points);
  assert.deepEqual(moveWaypoint(points, -1, { x: 0, y: 0 }), points);
});

test("removeWaypoint: removes the targeted index, preserving order of the rest", () => {
  const points = [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }];
  assert.deepEqual(removeWaypoint(points, 1), [{ x: 1, y: 1 }, { x: 3, y: 3 }]);
});

test("removeWaypoint: removing the last remaining waypoint returns null (restores automatic routing)", () => {
  assert.equal(removeWaypoint([{ x: 1, y: 1 }], 0), null);
});

test("routePointsEqual: null and empty array are treated as the same 'no override' state", () => {
  assert.equal(routePointsEqual(null, null), true);
  assert.equal(routePointsEqual(null, []), true);
  assert.equal(routePointsEqual([], null), true);
  assert.equal(routePointsEqual(undefined, null), true);
});

test("routePointsEqual: detects a real difference in points or order", () => {
  assert.equal(routePointsEqual([{ x: 1, y: 1 }], [{ x: 1, y: 1 }]), true);
  assert.equal(routePointsEqual([{ x: 1, y: 1 }], [{ x: 1, y: 2 }]), false);
  assert.equal(
    routePointsEqual(
      [{ x: 1, y: 1 }, { x: 2, y: 2 }],
      [{ x: 2, y: 2 }, { x: 1, y: 1 }]
    ),
    false,
    "order matters — a route is an ordered path, not a set"
  );
  assert.equal(routePointsEqual([{ x: 1, y: 1 }], [{ x: 1, y: 1 }, { x: 2, y: 2 }]), false);
});
