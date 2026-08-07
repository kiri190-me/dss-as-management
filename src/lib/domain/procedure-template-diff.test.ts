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
  return { clonedFromEdgeId: null, fromNodeCode: "n1", toNodeCode: "n2", branchType: "DEFAULT", branchLabel: null, ...overrides };
}

test("compareDraftAndParentGraphs: identical draft and parent produce an entirely empty diff", () => {
  const nodes = [node({ id: "d1", nodeCode: "n1" })];
  const edges = [edge({ id: "de1", clonedFromEdgeId: "pe1" })];
  const parentNodes = [node({ id: "p1", nodeCode: "n1" })];
  const parentEdges = [edge({ id: "pe1" })];
  const result = compareDraftAndParentGraphs(nodes, edges, parentNodes, parentEdges);
  assert.deepEqual(result, { changedNodes: [], movedNodes: [], changedNodeTypes: [], changedEdges: [], retargetedEdges: [], newlyAddedEdges: [] });
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
