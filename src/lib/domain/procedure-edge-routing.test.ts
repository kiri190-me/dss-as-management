import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyAndAssignEdgeRoute,
  decisionBranchSourceHandle,
  assignEdgeLanes,
  buildOuterLanePath,
  computeEdgeVisibility,
  type RoutableNode,
  type RoutableEdge,
} from "./procedure-edge-routing";

function node(id: string, overrides: Partial<RoutableNode> = {}): RoutableNode {
  return { id, nodeType: "TASK", sourceWorksheet: "sheet-A", rowIndex: 0, ...overrides };
}

function edge(overrides: Partial<RoutableEdge> = {}): RoutableEdge {
  return { id: "e1", fromNodeId: "a", toNodeId: "b", branchType: "DEFAULT", ...overrides };
}

test("decisionBranchSourceHandle: YES/NORMAL/DEFAULT always leave from the right, deterministically", () => {
  assert.equal(decisionBranchSourceHandle("YES"), "right-out");
  assert.equal(decisionBranchSourceHandle("NORMAL" as never), "right-out");
  assert.equal(decisionBranchSourceHandle("DEFAULT"), "right-out");
});

test("decisionBranchSourceHandle: NO/NG always leave from the left", () => {
  assert.equal(decisionBranchSourceHandle("NO"), "left-out");
  assert.equal(decisionBranchSourceHandle("NG"), "left-out");
});

test("decisionBranchSourceHandle: RETRY/LOOP_BACK always use the dedicated loop direction", () => {
  assert.equal(decisionBranchSourceHandle("RETRY"), "loop-out");
  assert.equal(decisionBranchSourceHandle("LOOP_BACK"), "loop-out");
});

test("classifyAndAssignEdgeRoute: LOOP_BACK is always classified as loopback, even across worksheets (the real RFG case)", () => {
  const from = node("a", { sourceWorksheet: "(RFG) (7)원복 검사 및 개선 작업", rowIndex: 5 });
  const to = node("b", { sourceWorksheet: "(RFG) (4)기본 정전 검사", rowIndex: 0 });
  const result = classifyAndAssignEdgeRoute(edge({ branchType: "LOOP_BACK" }), from, to, 1);
  assert.deepEqual(result, { kind: "loopback", sourceHandle: "loop-out", targetHandle: "loop-in" });
});

test("classifyAndAssignEdgeRoute: a DECISION node's branch takes priority over same-row/next-row classification", () => {
  const from = node("a", { nodeType: "DECISION", rowIndex: 2 });
  const to = node("b", { rowIndex: 2 });
  const result = classifyAndAssignEdgeRoute(edge({ branchType: "NG" }), from, to, 2);
  assert.deepEqual(result, { kind: "decision-branch", sourceHandle: "left-out", targetHandle: "top-in" });
});

test("classifyAndAssignEdgeRoute: a DECISION node with only one outgoing edge is not treated as a branch", () => {
  const from = node("a", { nodeType: "DECISION", rowIndex: 2 });
  const to = node("b", { rowIndex: 2 });
  const result = classifyAndAssignEdgeRoute(edge({ branchType: "DEFAULT" }), from, to, 1);
  assert.equal(result.kind, "same-row");
});

test("classifyAndAssignEdgeRoute: different worksheets, no loopback/decision, is cross-worksheet", () => {
  const from = node("a", { sourceWorksheet: "sheet-A" });
  const to = node("b", { sourceWorksheet: "sheet-B" });
  const result = classifyAndAssignEdgeRoute(edge(), from, to, 1);
  assert.deepEqual(result, { kind: "cross-worksheet", sourceHandle: "cross-out", targetHandle: "cross-in" });
});

test("classifyAndAssignEdgeRoute: same worksheet, same packed row is a same-row hand-off", () => {
  const from = node("a", { rowIndex: 3 });
  const to = node("b", { rowIndex: 3 });
  const result = classifyAndAssignEdgeRoute(edge(), from, to, 1);
  assert.deepEqual(result, { kind: "same-row", sourceHandle: "right-out", targetHandle: "left-in" });
});

test("classifyAndAssignEdgeRoute: same worksheet, different packed row falls back to the ordinary vertical next-row route", () => {
  const from = node("a", { rowIndex: 3 });
  const to = node("b", { rowIndex: 4 });
  const result = classifyAndAssignEdgeRoute(edge(), from, to, 1);
  assert.deepEqual(result, { kind: "next-row", sourceHandle: "bottom-out", targetHandle: "top-in" });
});

test("assignEdgeLanes: non-overlapping spans share the same lane", () => {
  const lanes = assignEdgeLanes([
    { id: "e1", fromY: 0, toY: 100 },
    { id: "e2", fromY: 200, toY: 300 },
  ]);
  assert.equal(lanes.get("e1"), lanes.get("e2"));
});

test("assignEdgeLanes: overlapping spans are pushed to distinct lanes", () => {
  const lanes = assignEdgeLanes([
    { id: "e1", fromY: 0, toY: 200 },
    { id: "e2", fromY: 50, toY: 150 },
  ]);
  assert.notEqual(lanes.get("e1"), lanes.get("e2"));
});

test("assignEdgeLanes: assignment is deterministic regardless of input order", () => {
  const edges = [
    { id: "e1", fromY: 0, toY: 200 },
    { id: "e2", fromY: 50, toY: 150 },
    { id: "e3", fromY: 300, toY: 400 },
  ];
  const lanesA = assignEdgeLanes(edges);
  const lanesB = assignEdgeLanes([...edges].reverse());
  for (const e of edges) assert.equal(lanesA.get(e.id), lanesB.get(e.id));
});

test("buildOuterLanePath: routes strictly through the shared lane x, never dipping back into node territory between endpoints", () => {
  const { path } = buildOuterLanePath({ x: 100, y: 50 }, { x: 120, y: 400 }, 900);
  assert.equal(path, "M 100 50 L 900 50 L 900 400 L 120 400");
});

test("buildOuterLanePath: label sits on the shared lane, at the vertical midpoint", () => {
  const { labelPosition } = buildOuterLanePath({ x: 100, y: 0 }, { x: 120, y: 200 }, 900);
  assert.deepEqual(labelPosition, { x: 900, y: 100 });
});

test("computeEdgeVisibility: ALL mode never hides anything, only varies opacity", () => {
  const base = { hasSelection: false, isConnectedToSelected: false, isCrossWorksheet: false, isLoopback: false, isDecisionBranch: false, hasOpenIssueOnEndpoint: false };
  assert.equal(computeEdgeVisibility("ALL", base).hidden, false);
  assert.equal(computeEdgeVisibility("ALL", { ...base, isCrossWorksheet: true }).hidden, false);
  assert.ok(computeEdgeVisibility("ALL", { ...base, isCrossWorksheet: true }).opacity < computeEdgeVisibility("ALL", base).opacity);
});

test("computeEdgeVisibility: SELECTED_FLOW hides everything when nothing is selected", () => {
  const base = { hasSelection: false, isConnectedToSelected: false, isCrossWorksheet: false, isLoopback: false, isDecisionBranch: false, hasOpenIssueOnEndpoint: false };
  assert.deepEqual(computeEdgeVisibility("SELECTED_FLOW", base), { opacity: 0, hidden: true });
});

test("computeEdgeVisibility: SELECTED_FLOW shows only edges connected to the selected node", () => {
  const connected = { hasSelection: true, isConnectedToSelected: true, isCrossWorksheet: false, isLoopback: false, isDecisionBranch: false, hasOpenIssueOnEndpoint: false };
  const unrelated = { ...connected, isConnectedToSelected: false };
  assert.equal(computeEdgeVisibility("SELECTED_FLOW", connected).hidden, false);
  assert.equal(computeEdgeVisibility("SELECTED_FLOW", unrelated).hidden, true);
});

test("computeEdgeVisibility: STAGE_INTERNAL hides cross-worksheet edges", () => {
  const base = { hasSelection: false, isConnectedToSelected: false, isCrossWorksheet: true, isLoopback: false, isDecisionBranch: false, hasOpenIssueOnEndpoint: false };
  assert.deepEqual(computeEdgeVisibility("STAGE_INTERNAL", base), { opacity: 0, hidden: true });
});

test("computeEdgeVisibility: ERROR_RELATED shows only edges touching a node with an open issue", () => {
  const withIssue = { hasSelection: false, isConnectedToSelected: false, isCrossWorksheet: false, isLoopback: false, isDecisionBranch: false, hasOpenIssueOnEndpoint: true };
  const withoutIssue = { ...withIssue, hasOpenIssueOnEndpoint: false };
  assert.equal(computeEdgeVisibility("ERROR_RELATED", withIssue).hidden, false);
  assert.equal(computeEdgeVisibility("ERROR_RELATED", withoutIssue).hidden, true);
});

test("computeEdgeVisibility: a LOOP_BACK edge touching the selected node stays fully visible in every mode, even STAGE_INTERNAL/SELECTED_FLOW", () => {
  const ctx = { hasSelection: true, isConnectedToSelected: true, isCrossWorksheet: true, isLoopback: true, isDecisionBranch: false, hasOpenIssueOnEndpoint: false };
  for (const mode of ["ALL", "SELECTED_FLOW", "STAGE_INTERNAL", "ERROR_RELATED"] as const) {
    assert.deepEqual(computeEdgeVisibility(mode, ctx), { opacity: 1, hidden: false }, `mode ${mode}`);
  }
});

test("computeEdgeVisibility: selecting a node dims unrelated edges much more strongly than the no-selection baseline", () => {
  const base = { isCrossWorksheet: false, isLoopback: false, isDecisionBranch: false, hasOpenIssueOnEndpoint: false };
  const noSelection = computeEdgeVisibility("ALL", { ...base, hasSelection: false, isConnectedToSelected: false });
  const withSelectionUnrelated = computeEdgeVisibility("ALL", { ...base, hasSelection: true, isConnectedToSelected: false });
  assert.ok(withSelectionUnrelated.opacity < noSelection.opacity);
});
