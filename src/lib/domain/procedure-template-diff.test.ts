import { test } from "node:test";
import assert from "node:assert/strict";
import { compareDraftAndParentGraphs, type DiffNode, type DiffEdge } from "./procedure-template-diff";

function node(overrides: Partial<DiffNode> & { id: string; nodeCode: string }): DiffNode {
  return {
    title: "제목",
    nodeType: "TASK",
    description: null,
    instructions: null,
    sortOrder: 0,
    isActive: true,
    effectiveX: 0,
    effectiveY: 0,
    ...overrides,
  };
}
function edge(overrides: Partial<DiffEdge> & { id: string }): DiffEdge {
  return { clonedFromEdgeId: null, fromNodeCode: "n1", toNodeCode: "n2", branchType: "DEFAULT", branchLabel: null, userRoutePoints: null, ...overrides };
}

test("compareDraftAndParentGraphs: identical draft and parent produce an entirely empty diff", () => {
  const nodes = [node({ id: "d1", nodeCode: "n1" })];
  const edges = [edge({ id: "de1", clonedFromEdgeId: "pe1" })];
  const parentNodes = [node({ id: "p1", nodeCode: "n1" })];
  const parentEdges = [edge({ id: "pe1" })];
  const result = compareDraftAndParentGraphs(nodes, edges, parentNodes, parentEdges);
  assert.deepEqual(result, { changedNodes: [], movedNodes: [], changedNodeTypes: [], changedEdges: [], retargetedEdges: [], newlyAddedEdges: [], routeChangedEdges: [] });
});

test("compareDraftAndParentGraphs: a changed title/description surfaces as a changedNodes entry with per-field before/after", () => {
  const draftNodes = [node({ id: "d1", nodeCode: "n1", title: "새 제목", description: "새 설명" })];
  const parentNodes = [node({ id: "p1", nodeCode: "n1", title: "원래 제목", description: null })];
  const result = compareDraftAndParentGraphs(draftNodes, [], parentNodes, []);
  assert.equal(result.changedNodes.length, 1);
  assert.equal(result.changedNodes[0].nodeCode, "n1");
  const fields = result.changedNodes[0].changes.map((c) => c.field).sort();
  assert.deepEqual(fields, ["description", "title"]);
});

test("compareDraftAndParentGraphs: a node type change is reported separately from ordinary field changes", () => {
  const draftNodes = [node({ id: "d1", nodeCode: "n1", nodeType: "INSPECTION" })];
  const parentNodes = [node({ id: "p1", nodeCode: "n1", nodeType: "TASK" })];
  const result = compareDraftAndParentGraphs(draftNodes, [], parentNodes, []);
  assert.deepEqual(result.changedNodeTypes, [{ nodeCode: "n1", before: "TASK", after: "INSPECTION" }]);
  assert.equal(result.changedNodes.length, 0, "a pure type change must not also appear in changedNodes");
});

test("compareDraftAndParentGraphs: a moved node reports its effective position before/after", () => {
  const draftNodes = [node({ id: "d1", nodeCode: "n1", effectiveX: 500, effectiveY: 300 })];
  const parentNodes = [node({ id: "p1", nodeCode: "n1", effectiveX: 100, effectiveY: 100 })];
  const result = compareDraftAndParentGraphs(draftNodes, [], parentNodes, []);
  assert.deepEqual(result.movedNodes, [{ nodeCode: "n1", before: { x: 100, y: 100 }, after: { x: 500, y: 300 } }]);
});

test("compareDraftAndParentGraphs: an edge with no clonedFromEdgeId is newlyAddedEdges, never confused with a retarget", () => {
  const draftEdges = [edge({ id: "de1", clonedFromEdgeId: null, fromNodeCode: "a", toNodeCode: "b", branchType: "NG" })];
  const result = compareDraftAndParentGraphs([], draftEdges, [], []);
  assert.deepEqual(result.newlyAddedEdges, [{ draftEdgeId: "de1", fromNodeCode: "a", toNodeCode: "b", branchType: "NG", branchLabel: null }]);
  assert.equal(result.retargetedEdges.length, 0);
});

test("compareDraftAndParentGraphs: an edge whose endpoints changed relative to its clonedFromEdgeId parent is retargetedEdges", () => {
  const draftEdges = [edge({ id: "de1", clonedFromEdgeId: "pe1", fromNodeCode: "a", toNodeCode: "z" })];
  const parentEdges = [edge({ id: "pe1", fromNodeCode: "a", toNodeCode: "b" })];
  const result = compareDraftAndParentGraphs([], draftEdges, [], parentEdges);
  assert.deepEqual(result.retargetedEdges, [{ draftEdgeId: "de1", before: { fromNodeCode: "a", toNodeCode: "b" }, after: { fromNodeCode: "a", toNodeCode: "z" } }]);
  assert.equal(result.newlyAddedEdges.length, 0);
  assert.equal(result.changedEdges.length, 0, "an endpoint-only change must not also appear in changedEdges");
});

test("compareDraftAndParentGraphs: an edge whose branchType/label changed but endpoints stayed the same is changedEdges, not retargetedEdges", () => {
  const draftEdges = [edge({ id: "de1", clonedFromEdgeId: "pe1", branchType: "NG", branchLabel: "NG (수정)" })];
  const parentEdges = [edge({ id: "pe1", branchType: "NO", branchLabel: "NO" })];
  const result = compareDraftAndParentGraphs([], draftEdges, [], parentEdges);
  assert.equal(result.retargetedEdges.length, 0);
  assert.deepEqual(result.changedEdges, [
    { draftEdgeId: "de1", fromNodeCode: "n1", toNodeCode: "n2", before: { branchType: "NO", branchLabel: "NO" }, after: { branchType: "NG", branchLabel: "NG (수정)" } },
  ]);
});

test("compareDraftAndParentGraphs: an edge that is both retargeted and relabeled appears in both lists", () => {
  const draftEdges = [edge({ id: "de1", clonedFromEdgeId: "pe1", fromNodeCode: "a", toNodeCode: "z", branchType: "NG" })];
  const parentEdges = [edge({ id: "pe1", fromNodeCode: "a", toNodeCode: "b", branchType: "NO" })];
  const result = compareDraftAndParentGraphs([], draftEdges, [], parentEdges);
  assert.equal(result.retargetedEdges.length, 1);
  assert.equal(result.changedEdges.length, 1);
});

test("compareDraftAndParentGraphs: a draft node with no parent counterpart (shouldn't happen in Phase 4A) is silently skipped, never fabricated as a change", () => {
  const draftNodes = [node({ id: "d1", nodeCode: "orphan-node-code" })];
  const result = compareDraftAndParentGraphs(draftNodes, [], [], []);
  assert.deepEqual(result.changedNodes, []);
  assert.deepEqual(result.movedNodes, []);
});

// ---- Phase 4B: 연결선 경로 수동 조정 (manual edge-route diff indicator) ----

test("compareDraftAndParentGraphs: an edge with a new manual route (parent had none) surfaces as routeChangedEdges with a summary, never raw coordinates", () => {
  const draftEdges = [edge({ id: "de1", clonedFromEdgeId: "pe1", userRoutePoints: [{ x: 1, y: 1 }, { x: 2, y: 2 }] })];
  const parentEdges = [edge({ id: "pe1", userRoutePoints: null })];
  const result = compareDraftAndParentGraphs([], draftEdges, [], parentEdges);
  assert.deepEqual(result.routeChangedEdges, [
    { draftEdgeId: "de1", fromNodeCode: "n1", toNodeCode: "n2", before: { isManual: false, pointCount: 0 }, after: { isManual: true, pointCount: 2 } },
  ]);
  // The requirement is explicit: no raw coordinate arrays in the main comparison result — only isManual + a count.
  assert.equal("userRoutePoints" in result.routeChangedEdges[0].before, false);
  assert.equal("userRoutePoints" in result.routeChangedEdges[0].after, false);
});

test("compareDraftAndParentGraphs: restoring a route to automatic (draft null, parent manual) also surfaces as a route change", () => {
  const draftEdges = [edge({ id: "de1", clonedFromEdgeId: "pe1", userRoutePoints: null })];
  const parentEdges = [edge({ id: "pe1", userRoutePoints: [{ x: 5, y: 5 }] })];
  const result = compareDraftAndParentGraphs([], draftEdges, [], parentEdges);
  assert.deepEqual(result.routeChangedEdges, [
    { draftEdgeId: "de1", fromNodeCode: "n1", toNodeCode: "n2", before: { isManual: true, pointCount: 1 }, after: { isManual: false, pointCount: 0 } },
  ]);
});

test("compareDraftAndParentGraphs: a changed waypoint count on an already-manual route is detected", () => {
  const draftEdges = [edge({ id: "de1", clonedFromEdgeId: "pe1", userRoutePoints: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }] })];
  const parentEdges = [edge({ id: "pe1", userRoutePoints: [{ x: 1, y: 1 }] })];
  const result = compareDraftAndParentGraphs([], draftEdges, [], parentEdges);
  assert.deepEqual(result.routeChangedEdges, [
    { draftEdgeId: "de1", fromNodeCode: "n1", toNodeCode: "n2", before: { isManual: true, pointCount: 1 }, after: { isManual: true, pointCount: 3 } },
  ]);
});

test("compareDraftAndParentGraphs: an identical manual route (same points, same order) on both sides is not reported as a route change", () => {
  const points = [{ x: 1, y: 1 }, { x: 2, y: 2 }];
  const draftEdges = [edge({ id: "de1", clonedFromEdgeId: "pe1", userRoutePoints: points })];
  const parentEdges = [edge({ id: "pe1", userRoutePoints: [{ x: 1, y: 1 }, { x: 2, y: 2 }] })];
  const result = compareDraftAndParentGraphs([], draftEdges, [], parentEdges);
  assert.deepEqual(result.routeChangedEdges, []);
});

test("compareDraftAndParentGraphs: an edge with no route change alongside a real branch-label change reports only the branch-label change, not a phantom route change", () => {
  const draftEdges = [edge({ id: "de1", clonedFromEdgeId: "pe1", branchLabel: "새 라벨", userRoutePoints: null })];
  const parentEdges = [edge({ id: "pe1", branchLabel: "원래 라벨", userRoutePoints: null })];
  const result = compareDraftAndParentGraphs([], draftEdges, [], parentEdges);
  assert.equal(result.changedEdges.length, 1);
  assert.deepEqual(result.routeChangedEdges, []);
});
