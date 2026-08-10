import { test } from "node:test";
import assert from "node:assert/strict";
import { computeConnectedIds, type MinimalEdge } from "./selection";

test("computeConnectedIds: returns empty sets when nothing is selected", () => {
  const edges: MinimalEdge[] = [{ id: "e1", source: "a", target: "b" }];
  const result = computeConnectedIds(null, edges);
  assert.equal(result.nodeIds.size, 0);
  assert.equal(result.edgeIds.size, 0);
});

test("computeConnectedIds: returns 1-hop incoming+outgoing sets for the selected node", () => {
  const edges: MinimalEdge[] = [
    { id: "e1", source: "a", target: "b" },
    { id: "e2", source: "c", target: "b" },
    { id: "e3", source: "b", target: "d" },
    { id: "e4", source: "x", target: "y" },
  ];
  const result = computeConnectedIds("b", edges);
  assert.deepEqual([...result.nodeIds].sort(), ["a", "b", "c", "d"]);
  assert.deepEqual([...result.edgeIds].sort(), ["e1", "e2", "e3"]);
});

test("computeConnectedIds: correctly includes both endpoints of a real RFG LOOP_BACK-style edge", () => {
  // Regression guard for the two real LOOP_BACK edges wired in Phase 2.5 — a
  // loop-back edge is just a normal source/target pair to this function, so
  // selecting either endpoint must surface the other.
  const edges: MinimalEdge[] = [{ id: "loop-1", source: "node-late-step", target: "node-earlier-step" }];
  const fromLateStep = computeConnectedIds("node-late-step", edges);
  assert.ok(fromLateStep.nodeIds.has("node-earlier-step"));
  assert.ok(fromLateStep.edgeIds.has("loop-1"));
  const fromEarlierStep = computeConnectedIds("node-earlier-step", edges);
  assert.ok(fromEarlierStep.nodeIds.has("node-late-step"));
  assert.ok(fromEarlierStep.edgeIds.has("loop-1"));
});
