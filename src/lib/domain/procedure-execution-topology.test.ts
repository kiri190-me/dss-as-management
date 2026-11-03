import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isExecutableNodeType,
  isSystemEntryNodeType,
  isUserFacingExecutionNodeType,
  computeSuggestedNextNodes,
  type TopologyNode,
  type TopologyEdge,
  type TopologyExecutionNode,
} from "./procedure-execution-topology";
import { PROCEDURE_NODE_TYPE_CODES, type ProcedureNodeType } from "./procedure-template-types";

test("isExecutableNodeType: all 9 real node types classify exactly per the Phase 5A plan (only DOCUMENT_REFERENCE excluded)", () => {
  const expected: Record<ProcedureNodeType, boolean> = {
    START: true,
    TASK: true,
    INSPECTION: true,
    DECISION: true,
    CORRECTIVE_ACTION: true,
    CHECKLIST: true,
    TROUBLESHOOTING: true,
    DOCUMENT_REFERENCE: false,
    END: true,
  };
  for (const nodeType of PROCEDURE_NODE_TYPE_CODES) {
    assert.equal(isExecutableNodeType(nodeType), expected[nodeType], `mismatch for ${nodeType}`);
  }
});

test("isSystemEntryNodeType: only START is a system entry marker", () => {
  const expected: Record<ProcedureNodeType, boolean> = {
    START: true,
    TASK: false,
    INSPECTION: false,
    DECISION: false,
    CORRECTIVE_ACTION: false,
    CHECKLIST: false,
    TROUBLESHOOTING: false,
    DOCUMENT_REFERENCE: false,
    END: false,
  };
  for (const nodeType of PROCEDURE_NODE_TYPE_CODES) {
    assert.equal(isSystemEntryNodeType(nodeType), expected[nodeType], `mismatch for ${nodeType}`);
  }
});

test("isUserFacingExecutionNodeType: executable minus START minus DOCUMENT_REFERENCE — TASK/INSPECTION/DECISION/CORRECTIVE_ACTION/CHECKLIST/TROUBLESHOOTING/END unaffected, only START newly excluded", () => {
  const expected: Record<ProcedureNodeType, boolean> = {
    START: false,
    TASK: true,
    INSPECTION: true,
    DECISION: true,
    CORRECTIVE_ACTION: true,
    CHECKLIST: true,
    TROUBLESHOOTING: true,
    DOCUMENT_REFERENCE: false,
    END: true,
  };
  for (const nodeType of PROCEDURE_NODE_TYPE_CODES) {
    assert.equal(isUserFacingExecutionNodeType(nodeType), expected[nodeType], `mismatch for ${nodeType}`);
  }
});

function execNode(overrides: Partial<TopologyExecutionNode> & { id: string }): TopologyExecutionNode {
  // 🔵 그림 위 자리 id 의 기본값은 **제 실행 노드 id** 다(2026-11-03, 조각 13) —
  //    이 건에서 더한 작업이 그렇게 들어온다. 템플릿에서 온 줄은 부르는 쪽이
  //    템플릿 노드 id 를 넘긴다.
  return { graphNodeId: overrides.id, status: "PENDING", selectedOutgoingEdgeId: null, ...overrides };
}

test("computeSuggestedNextNodes: a simple linear chain suggests only the node right after the completed one", () => {
  const nodes: TopologyNode[] = [
    { id: "n1", nodeType: "START" },
    { id: "n2", nodeType: "TASK" },
    { id: "n3", nodeType: "END" },
  ];
  const edges: TopologyEdge[] = [
    { id: "e1", fromNodeId: "n1", toNodeId: "n2" },
    { id: "e2", fromNodeId: "n2", toNodeId: "n3" },
  ];
  const executionNodes: TopologyExecutionNode[] = [
    execNode({ id: "en1", graphNodeId: "n1", status: "COMPLETED" }),
    execNode({ id: "en2", graphNodeId: "n2", status: "PENDING" }),
    execNode({ id: "en3", graphNodeId: "n3", status: "PENDING" }),
  ];
  const suggested = computeSuggestedNextNodes(nodes, edges, executionNodes);
  assert.deepEqual([...suggested].sort(), ["en2"]);
});

test("computeSuggestedNextNodes: a DECISION's unselected branch target is never suggested, the selected one is", () => {
  const nodes: TopologyNode[] = [
    { id: "d1", nodeType: "DECISION" },
    { id: "yes-target", nodeType: "TASK" },
    { id: "no-target", nodeType: "TASK" },
  ];
  const edges: TopologyEdge[] = [
    { id: "e-yes", fromNodeId: "d1", toNodeId: "yes-target" },
    { id: "e-no", fromNodeId: "d1", toNodeId: "no-target" },
  ];
  const executionNodes: TopologyExecutionNode[] = [
    execNode({ id: "en-d1", graphNodeId: "d1", status: "COMPLETED", selectedOutgoingEdgeId: "e-yes" }),
    execNode({ id: "en-yes", graphNodeId: "yes-target", status: "PENDING" }),
    execNode({ id: "en-no", graphNodeId: "no-target", status: "PENDING" }),
  ];
  const suggested = computeSuggestedNextNodes(nodes, edges, executionNodes);
  assert.deepEqual([...suggested].sort(), ["en-yes"]);
});

test("computeSuggestedNextNodes: a DECISION completed without any selection suggests neither branch", () => {
  const nodes: TopologyNode[] = [
    { id: "d1", nodeType: "DECISION" },
    { id: "yes-target", nodeType: "TASK" },
  ];
  const edges: TopologyEdge[] = [{ id: "e-yes", fromNodeId: "d1", toNodeId: "yes-target" }];
  const executionNodes: TopologyExecutionNode[] = [
    execNode({ id: "en-d1", graphNodeId: "d1", status: "COMPLETED", selectedOutgoingEdgeId: null }),
    execNode({ id: "en-yes", graphNodeId: "yes-target", status: "PENDING" }),
  ];
  const suggested = computeSuggestedNextNodes(nodes, edges, executionNodes);
  assert.deepEqual([...suggested], []);
});

test("computeSuggestedNextNodes: a LOOP_BACK-style edge resurfaces its target once the source completes, no special-casing needed", () => {
  const nodes: TopologyNode[] = [
    { id: "stage4-start", nodeType: "START" },
    { id: "aging-test", nodeType: "INSPECTION" },
  ];
  // aging-test loops back to stage4-start on failure; both directions are ordinary edges to this pure layer.
  const edges: TopologyEdge[] = [
    { id: "e-forward", fromNodeId: "stage4-start", toNodeId: "aging-test" },
    { id: "e-loopback", fromNodeId: "aging-test", toNodeId: "stage4-start" },
  ];
  const executionNodes: TopologyExecutionNode[] = [
    execNode({ id: "en-start", graphNodeId: "stage4-start", status: "PENDING" }),
    execNode({ id: "en-aging", graphNodeId: "aging-test", status: "COMPLETED" }),
  ];
  const suggested = computeSuggestedNextNodes(nodes, edges, executionNodes);
  assert.deepEqual([...suggested], ["en-start"]);
});

test("computeSuggestedNextNodes: a node with zero incoming edges is always suggested while PENDING", () => {
  const nodes: TopologyNode[] = [{ id: "standalone-checklist", nodeType: "CHECKLIST" }];
  const executionNodes: TopologyExecutionNode[] = [
    execNode({ id: "en-checklist", graphNodeId: "standalone-checklist", status: "PENDING" }),
  ];
  const suggested = computeSuggestedNextNodes(nodes, [], executionNodes);
  assert.deepEqual([...suggested], ["en-checklist"]);
});

test("computeSuggestedNextNodes: a case-specific extra task with no incoming edge is still suggested while PENDING", () => {
  // 🔵 2026-11-03(조각 13) — 「추가 작업이라서 무조건 추천」이라는 따로 난 가지는
  //    없어졌다. 들어오는 선이 없어서 추천되는 것이고, 결과는 전과 같다.
  const executionNodes: TopologyExecutionNode[] = [execNode({ id: "en-extra", graphNodeId: "en-extra", status: "PENDING" })];
  const suggested = computeSuggestedNextNodes([], [], executionNodes);
  assert.deepEqual([...suggested], ["en-extra"]);
});

test("🔴 computeSuggestedNextNodes: 이어 붙인 추가 작업은 **앞 작업이 끝나야** 추천된다 — 템플릿 노드와 같은 잣대", () => {
  const nodes: TopologyNode[] = [
    { id: "n1", nodeType: "TASK" },
    { id: "en-extra", nodeType: "TASK" },
  ];
  const edges: TopologyEdge[] = [{ id: "added-1", fromNodeId: "n1", toNodeId: "en-extra" }];
  const pending = [
    execNode({ id: "en1", graphNodeId: "n1", status: "PENDING" }),
    execNode({ id: "en-extra", graphNodeId: "en-extra", status: "PENDING" }),
  ];
  assert.deepEqual([...computeSuggestedNextNodes(nodes, edges, pending)], ["en1"], "앞 작업이 안 끝났으면 추천 안 된다");

  const done = [
    execNode({ id: "en1", graphNodeId: "n1", status: "COMPLETED" }),
    execNode({ id: "en-extra", graphNodeId: "en-extra", status: "PENDING" }),
  ];
  assert.deepEqual([...computeSuggestedNextNodes(nodes, edges, done)], ["en-extra"]);
});

test("computeSuggestedNextNodes: DOCUMENT_REFERENCE nodes never appear since they never receive an execution-node row", () => {
  // Simulates the caller correctly excluding DOCUMENT_REFERENCE from executionNodes entirely (per isExecutableNodeType).
  const nodes: TopologyNode[] = [
    { id: "n1", nodeType: "TASK" },
    { id: "ref1", nodeType: "DOCUMENT_REFERENCE" },
  ];
  const edges: TopologyEdge[] = [{ id: "e1", fromNodeId: "n1", toNodeId: "ref1" }];
  const executionNodes: TopologyExecutionNode[] = [execNode({ id: "en-n1", graphNodeId: "n1", status: "COMPLETED" })];
  const suggested = computeSuggestedNextNodes(nodes, edges, executionNodes);
  assert.deepEqual([...suggested], [], "no execution-node row exists for ref1, so nothing can be suggested for it");
});

test("computeSuggestedNextNodes: a node already IN_PROGRESS/COMPLETED/SKIPPED/BLOCKED is never re-suggested", () => {
  const nodes: TopologyNode[] = [
    { id: "n1", nodeType: "START" },
    { id: "n2", nodeType: "TASK" },
  ];
  const edges: TopologyEdge[] = [{ id: "e1", fromNodeId: "n1", toNodeId: "n2" }];
  for (const status of ["IN_PROGRESS", "COMPLETED", "SKIPPED", "BLOCKED"] as const) {
    const executionNodes: TopologyExecutionNode[] = [
      execNode({ id: "en1", graphNodeId: "n1", status: "COMPLETED" }),
      execNode({ id: "en2", graphNodeId: "n2", status }),
    ];
    const suggested = computeSuggestedNextNodes(nodes, edges, executionNodes);
    assert.deepEqual([...suggested], [], `status ${status} must not be suggested`);
  }
});

test("computeSuggestedNextNodes: multiple incoming edges are ANY not ALL — one completed source is enough", () => {
  const nodes: TopologyNode[] = [
    { id: "start", nodeType: "START" },
    { id: "a", nodeType: "TASK" },
    { id: "b", nodeType: "TASK" },
    { id: "converge", nodeType: "TASK" },
  ];
  const edges: TopologyEdge[] = [
    { id: "e-start-a", fromNodeId: "start", toNodeId: "a" },
    { id: "e-start-b", fromNodeId: "start", toNodeId: "b" },
    { id: "e-a", fromNodeId: "a", toNodeId: "converge" },
    { id: "e-b", fromNodeId: "b", toNodeId: "converge" },
  ];
  const executionNodes: TopologyExecutionNode[] = [
    execNode({ id: "en-start", graphNodeId: "start", status: "COMPLETED" }),
    execNode({ id: "en-a", graphNodeId: "a", status: "COMPLETED" }),
    execNode({ id: "en-b", graphNodeId: "b", status: "PENDING" }),
    execNode({ id: "en-converge", graphNodeId: "converge", status: "PENDING" }),
  ];
  const suggested = computeSuggestedNextNodes(nodes, edges, executionNodes);
  // "converge" is suggested via its completed "a" source even though "b" (its other source) is still pending.
  assert.deepEqual([...suggested].sort(), ["en-b", "en-converge"]);
});
