import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateProcedureGraphStructure,
  countBySeverity,
  type StructuralValidationNode,
  type StructuralValidationEdge,
} from "./procedure-graph-structural-validation";

function node(id: string, nodeType: StructuralValidationNode["nodeType"]): StructuralValidationNode {
  return { id, nodeType };
}
function edge(id: string, fromNodeId: string, toNodeId: string, branchType: StructuralValidationEdge["branchType"]): StructuralValidationEdge {
  return { id, fromNodeId, toNodeId, branchType };
}

test("validateProcedureGraphStructure: a well-formed START->DECISION->END graph produces no ERROR", () => {
  const nodes = [node("start", "START"), node("d", "DECISION"), node("t", "TASK"), node("end", "END")];
  const edges = [
    edge("e1", "start", "d", "DEFAULT"),
    edge("e2", "d", "t", "YES"),
    edge("e3", "d", "t", "NG"),
    edge("e4", "t", "end", "DEFAULT"),
  ];
  const issues = validateProcedureGraphStructure(nodes, edges);
  assert.equal(issues.filter((i) => i.severity === "ERROR").length, 0);
});

test("validateProcedureGraphStructure: START with an incoming edge is INVALID_START_STRUCTURE", () => {
  const nodes = [node("start", "START"), node("t", "TASK")];
  const edges = [edge("e1", "start", "t", "DEFAULT"), edge("e2", "t", "start", "DEFAULT")];
  const issues = validateProcedureGraphStructure(nodes, edges);
  assert.ok(issues.some((i) => i.issueType === "INVALID_START_STRUCTURE" && i.nodeId === "start"));
});

test("validateProcedureGraphStructure: START with no outgoing edge is INVALID_START_STRUCTURE", () => {
  const nodes = [node("start", "START")];
  const issues = validateProcedureGraphStructure(nodes, []);
  assert.ok(issues.some((i) => i.issueType === "INVALID_START_STRUCTURE" && i.nodeId === "start"));
});

test("validateProcedureGraphStructure: END with an outgoing edge is INVALID_END_STRUCTURE", () => {
  const nodes = [node("t", "TASK"), node("end", "END")];
  const edges = [edge("e1", "t", "end", "DEFAULT"), edge("e2", "end", "t", "DEFAULT")];
  const issues = validateProcedureGraphStructure(nodes, edges);
  assert.ok(issues.some((i) => i.issueType === "INVALID_END_STRUCTURE" && i.nodeId === "end"));
});

test("validateProcedureGraphStructure: END with no incoming edge is INVALID_END_STRUCTURE", () => {
  const nodes = [node("end", "END")];
  const issues = validateProcedureGraphStructure(nodes, []);
  assert.ok(issues.some((i) => i.issueType === "INVALID_END_STRUCTURE" && i.nodeId === "end"));
});

test("validateProcedureGraphStructure: a DECISION with only NG/NO branches (no continue path) is MISSING_OUTGOING_PATH", () => {
  const nodes = [node("d", "DECISION"), node("a", "TASK"), node("b", "TASK")];
  const edges = [edge("e1", "d", "a", "NG"), edge("e2", "d", "b", "NO")];
  const issues = validateProcedureGraphStructure(nodes, edges);
  assert.ok(issues.some((i) => i.issueType === "MISSING_OUTGOING_PATH" && i.nodeId === "d"));
});

test("validateProcedureGraphStructure: a DECISION with a YES branch present is not MISSING_OUTGOING_PATH", () => {
  const nodes = [node("d", "DECISION"), node("a", "TASK"), node("b", "TASK")];
  const edges = [edge("e1", "d", "a", "NG"), edge("e2", "d", "b", "YES")];
  const issues = validateProcedureGraphStructure(nodes, edges);
  assert.ok(!issues.some((i) => i.issueType === "MISSING_OUTGOING_PATH"));
});

test("validateProcedureGraphStructure: a DECISION with no outgoing edges at all is not double-flagged by MISSING_OUTGOING_PATH", () => {
  const nodes = [node("d", "DECISION")];
  const issues = validateProcedureGraphStructure(nodes, []);
  assert.ok(!issues.some((i) => i.issueType === "MISSING_OUTGOING_PATH"));
});

test("validateProcedureGraphStructure: a duplicate (same from/to/branchType) edge is flagged exactly once", () => {
  const nodes = [node("a", "TASK"), node("b", "TASK")];
  const edges = [edge("e1", "a", "b", "DEFAULT"), edge("e2", "a", "b", "DEFAULT")];
  const issues = validateProcedureGraphStructure(nodes, edges);
  assert.equal(issues.filter((i) => i.issueType === "DUPLICATE_EDGE").length, 1);
});

test("validateProcedureGraphStructure: a different branchType between the same two nodes is not a duplicate", () => {
  const nodes = [node("d", "DECISION"), node("b", "TASK")];
  const edges = [edge("e1", "d", "b", "YES"), edge("e2", "d", "b", "NG")];
  const issues = validateProcedureGraphStructure(nodes, edges);
  assert.ok(!issues.some((i) => i.issueType === "DUPLICATE_EDGE"));
});

test("validateProcedureGraphStructure: a self-edge is INVALID_SELF_EDGE", () => {
  const nodes = [node("a", "TASK")];
  const edges = [edge("e1", "a", "a", "DEFAULT")];
  const issues = validateProcedureGraphStructure(nodes, edges);
  assert.ok(issues.some((i) => i.issueType === "INVALID_SELF_EDGE" && i.edgeId === "e1"));
});

test("validateProcedureGraphStructure: an edge referencing a node outside the given set is CROSS_TEMPLATE_REFERENCE", () => {
  const nodes = [node("a", "TASK")];
  const edges = [edge("e1", "a", "does-not-exist", "DEFAULT")];
  const issues = validateProcedureGraphStructure(nodes, edges);
  assert.ok(issues.some((i) => i.issueType === "CROSS_TEMPLATE_REFERENCE" && i.edgeId === "e1"));
});

test("validateProcedureGraphStructure: a node with no edges at all is ORPHAN_NODE", () => {
  const nodes = [node("a", "TASK"), node("isolated", "TASK")];
  const edges: StructuralValidationEdge[] = [];
  const issues = validateProcedureGraphStructure(nodes, edges);
  assert.ok(issues.some((i) => i.issueType === "ORPHAN_NODE" && i.nodeId === "isolated"));
});

test("validateProcedureGraphStructure: an edge-less CHECKLIST/TROUBLESHOOTING container node is never ORPHAN_NODE", () => {
  const nodes = [node("checklist", "CHECKLIST"), node("troubleshooting", "TROUBLESHOOTING")];
  const issues = validateProcedureGraphStructure(nodes, []);
  assert.ok(!issues.some((i) => i.issueType === "ORPHAN_NODE"));
});

test("validateProcedureGraphStructure: a node with edges but not reachable from any START is UNREACHABLE_NODE", () => {
  const nodes = [node("start", "START"), node("a", "TASK"), node("island1", "TASK"), node("island2", "TASK")];
  const edges = [edge("e1", "start", "a", "DEFAULT"), edge("e2", "island1", "island2", "DEFAULT")];
  const issues = validateProcedureGraphStructure(nodes, edges);
  assert.ok(issues.some((i) => i.issueType === "UNREACHABLE_NODE" && i.nodeId === "island1"));
  assert.ok(issues.some((i) => i.issueType === "UNREACHABLE_NODE" && i.nodeId === "island2"));
  assert.ok(!issues.some((i) => i.issueType === "UNREACHABLE_NODE" && i.nodeId === "a"));
});

test("validateProcedureGraphStructure: LOOP_BACK/RETRY targeting an END node is INVALID_LOOP_BACK_TARGET", () => {
  const nodes = [node("a", "TASK"), node("end", "END")];
  const edges = [edge("e1", "a", "end", "LOOP_BACK")];
  const issues = validateProcedureGraphStructure(nodes, edges);
  assert.ok(issues.some((i) => i.issueType === "INVALID_LOOP_BACK_TARGET" && i.edgeId === "e1"));
});

test("validateProcedureGraphStructure: LOOP_BACK targeting an ordinary node (the real RFG shape — from a non-DECISION node) is valid", () => {
  const nodes = [node("shipping_prep", "CORRECTIVE_ACTION"), node("stage4_start", "START")];
  const edges = [edge("e1", "shipping_prep", "stage4_start", "LOOP_BACK")];
  const issues = validateProcedureGraphStructure(nodes, edges);
  assert.ok(!issues.some((i) => i.issueType === "INVALID_LOOP_BACK_TARGET"));
  assert.ok(!issues.some((i) => i.issueType === "INVALID_BRANCH_TYPE_FOR_NODE"));
});

test("validateProcedureGraphStructure: a YES/NO/NG/NORMAL branch from a non-DECISION node is INVALID_BRANCH_TYPE_FOR_NODE", () => {
  const nodes = [node("t", "TASK"), node("b", "TASK")];
  const edges = [edge("e1", "t", "b", "YES")];
  const issues = validateProcedureGraphStructure(nodes, edges);
  assert.ok(issues.some((i) => i.issueType === "INVALID_BRANCH_TYPE_FOR_NODE" && i.edgeId === "e1"));
});

test("validateProcedureGraphStructure: the same branch types from a DECISION node are valid", () => {
  const nodes = [node("d", "DECISION"), node("b", "TASK")];
  const edges = [edge("e1", "d", "b", "YES"), edge("e2", "d", "b", "NG")];
  const issues = validateProcedureGraphStructure(nodes, edges);
  assert.ok(!issues.some((i) => i.issueType === "INVALID_BRANCH_TYPE_FOR_NODE"));
});

test("validateProcedureGraphStructure: DEFAULT/CUSTOM/RETRY are never restricted to DECISION nodes", () => {
  const nodes = [node("t", "TASK"), node("b", "TASK")];
  const edges = [edge("e1", "t", "b", "DEFAULT"), edge("e2", "t", "b", "CUSTOM"), edge("e3", "b", "t", "RETRY")];
  const issues = validateProcedureGraphStructure(nodes, edges);
  assert.ok(!issues.some((i) => i.issueType === "INVALID_BRANCH_TYPE_FOR_NODE"));
});

test("validateProcedureGraphStructure: a DOCUMENT_REFERENCE node with an outgoing edge is REFERENCE_NODE_IN_EXECUTABLE_PATH", () => {
  const nodes = [node("ref", "DOCUMENT_REFERENCE"), node("t", "TASK")];
  const edges = [edge("e1", "ref", "t", "DEFAULT")];
  const issues = validateProcedureGraphStructure(nodes, edges);
  assert.ok(issues.some((i) => i.issueType === "REFERENCE_NODE_IN_EXECUTABLE_PATH" && i.nodeId === "ref"));
});

test("validateProcedureGraphStructure: a DOCUMENT_REFERENCE node with only an incoming edge is not flagged", () => {
  const nodes = [node("t", "TASK"), node("ref", "DOCUMENT_REFERENCE")];
  const edges = [edge("e1", "t", "ref", "DEFAULT")];
  const issues = validateProcedureGraphStructure(nodes, edges);
  assert.ok(!issues.some((i) => i.issueType === "REFERENCE_NODE_IN_EXECUTABLE_PATH"));
});

test("validateProcedureGraphStructure: a CHECKLIST node missing checklist content is flagged only when the context set is supplied", () => {
  const nodes = [node("cl", "CHECKLIST")];
  const withoutContext = validateProcedureGraphStructure(nodes, []);
  assert.ok(!withoutContext.some((i) => i.issueType === "INVALID_CHECKLIST_OR_TROUBLESHOOTING_REFERENCE"));

  const withContext = validateProcedureGraphStructure(nodes, [], { nodeIdsWithChecklistContent: new Set() });
  assert.ok(withContext.some((i) => i.issueType === "INVALID_CHECKLIST_OR_TROUBLESHOOTING_REFERENCE" && i.nodeId === "cl"));

  const satisfied = validateProcedureGraphStructure(nodes, [], { nodeIdsWithChecklistContent: new Set(["cl"]) });
  assert.ok(!satisfied.some((i) => i.issueType === "INVALID_CHECKLIST_OR_TROUBLESHOOTING_REFERENCE"));
});

test("validateProcedureGraphStructure: a TROUBLESHOOTING node missing entries is flagged the same way", () => {
  const nodes = [node("ts", "TROUBLESHOOTING")];
  const withContext = validateProcedureGraphStructure(nodes, [], { nodeIdsWithTroubleshootingContent: new Set() });
  assert.ok(withContext.some((i) => i.issueType === "INVALID_CHECKLIST_OR_TROUBLESHOOTING_REFERENCE" && i.nodeId === "ts"));

  const satisfied = validateProcedureGraphStructure(nodes, [], { nodeIdsWithTroubleshootingContent: new Set(["ts"]) });
  assert.ok(!satisfied.some((i) => i.issueType === "INVALID_CHECKLIST_OR_TROUBLESHOOTING_REFERENCE"));
});

test("countBySeverity: tallies ERROR/WARNING/INFO independently", () => {
  const issues = [
    { severity: "ERROR" as const, issueType: "INVALID_SELF_EDGE" as const, message: "" },
    { severity: "ERROR" as const, issueType: "DUPLICATE_EDGE" as const, message: "" },
    { severity: "WARNING" as const, issueType: "ORPHAN_NODE" as const, message: "" },
    { severity: "INFO" as const, issueType: "UNREACHABLE_NODE" as const, message: "" },
  ];
  assert.deepEqual(countBySeverity(issues), { errorCount: 2, warningCount: 1, infoCount: 1 });
});

test("validateProcedureGraphStructure: an empty graph produces no issues", () => {
  assert.deepEqual(validateProcedureGraphStructure([], []), []);
});
