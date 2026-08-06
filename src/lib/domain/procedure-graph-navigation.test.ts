import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSourceReference,
  buildWorkflowViewHref,
  resolveInitialGraphTarget,
  type NavigableNode,
  type NavigableEdge,
} from "./procedure-graph-navigation";

test("parseSourceReference: extracts a shape id", () => {
  assert.deepEqual(parseSourceReference("shape#50"), { shapeId: "50", connectorId: null });
});

test("parseSourceReference: extracts a connector id", () => {
  assert.deepEqual(parseSourceReference("connector#57"), { shapeId: null, connectorId: "57" });
});

test("parseSourceReference: null/unrecognized input yields both null, never throws", () => {
  assert.deepEqual(parseSourceReference(null), { shapeId: null, connectorId: null });
  assert.deepEqual(parseSourceReference("cell#A1"), { shapeId: null, connectorId: null });
});

test("buildWorkflowViewHref: includes issue/worksheet/node when a resolved node id is known", () => {
  const href = buildWorkflowViewHref({ templateId: "t1", issueId: "i1", worksheet: "(RFG) (4)기본 정전 검사", nodeId: "n1" });
  const url = new URL(href, "http://localhost");
  assert.equal(url.pathname, "/procedures/t1");
  assert.equal(url.searchParams.get("issue"), "i1");
  assert.equal(url.searchParams.get("worksheet"), "(RFG) (4)기본 정전 검사");
  assert.equal(url.searchParams.get("node"), "n1");
  assert.equal(url.searchParams.has("shape"), false);
  assert.equal(url.searchParams.has("connector"), false);
});

test("buildWorkflowViewHref: falls back to shape/connector params when no resolved node id is known (list-screen path)", () => {
  const hrefShape = buildWorkflowViewHref({ templateId: "t1", worksheet: "sheet-A", shapeId: "50" });
  assert.equal(new URL(hrefShape, "http://localhost").searchParams.get("shape"), "50");

  const hrefConnector = buildWorkflowViewHref({ templateId: "t1", worksheet: "sheet-A", connectorId: "57" });
  assert.equal(new URL(hrefConnector, "http://localhost").searchParams.get("connector"), "57");
});

test("buildWorkflowViewHref: a resolved node id always takes precedence over shape/connector", () => {
  const href = buildWorkflowViewHref({ templateId: "t1", nodeId: "n1", shapeId: "50", connectorId: "57" });
  const params = new URL(href, "http://localhost").searchParams;
  assert.equal(params.get("node"), "n1");
  assert.equal(params.has("shape"), false);
  assert.equal(params.has("connector"), false);
});

test("buildWorkflowViewHref: sets fallback=1 only when isFallback is true", () => {
  assert.equal(new URL(buildWorkflowViewHref({ templateId: "t1", nodeId: "n1", isFallback: true }), "http://localhost").searchParams.get("fallback"), "1");
  assert.equal(new URL(buildWorkflowViewHref({ templateId: "t1", nodeId: "n1" }), "http://localhost").searchParams.has("fallback"), false);
});

test("buildWorkflowViewHref: sets mode=error-focus only when errorFocus is true (Problem 2 — every issue-row navigation action must land in 오류 집중 보기)", () => {
  assert.equal(
    new URL(buildWorkflowViewHref({ templateId: "t1", nodeId: "n1", errorFocus: true }), "http://localhost").searchParams.get("mode"),
    "error-focus"
  );
  assert.equal(new URL(buildWorkflowViewHref({ templateId: "t1", nodeId: "n1" }), "http://localhost").searchParams.has("mode"), false);
});

test("buildWorkflowViewHref: with no optional params at all, produces a bare template link", () => {
  assert.equal(buildWorkflowViewHref({ templateId: "t1" }), "/procedures/t1");
});

const nodes: NavigableNode[] = [
  { id: "node-a", sourceWorksheet: "sheet-A", sourceShapeId: "50" },
  { id: "node-b", sourceWorksheet: "sheet-B", sourceShapeId: "50" }, // same shape id, different worksheet — proves title/shape-alone is not enough
  { id: "node-c", sourceWorksheet: "sheet-A", sourceShapeId: "60" },
];
const edges: NavigableEdge[] = [{ fromNodeId: "node-c", toNodeId: "node-a", sourceConnectorId: "57" }];

test("resolveInitialGraphTarget: an explicit node param wins outright and always uses stable ids, never title text", () => {
  const result = resolveInitialGraphTarget({ nodeParam: "node-a", worksheetParam: "sheet-A" }, nodes, edges);
  assert.deepEqual(result, { worksheetFilter: "sheet-A", nodeId: "node-a", isFallback: false, errorFocus: false });
});

test("resolveInitialGraphTarget: a shape param resolves via sourceWorksheet+sourceShapeId, disambiguating a shape id reused across worksheets", () => {
  const resultA = resolveInitialGraphTarget({ shapeParam: "50", worksheetParam: "sheet-A" }, nodes, edges);
  assert.equal(resultA.nodeId, "node-a");
  const resultB = resolveInitialGraphTarget({ shapeParam: "50", worksheetParam: "sheet-B" }, nodes, edges);
  assert.equal(resultB.nodeId, "node-b");
  assert.equal(resultA.isFallback, false);
});

test("resolveInitialGraphTarget: an unbound connector falls back to its nearest bound source node and marks isFallback", () => {
  const result = resolveInitialGraphTarget({ connectorParam: "57", worksheetParam: "sheet-A" }, nodes, edges);
  assert.equal(result.nodeId, "node-c");
  assert.equal(result.isFallback, true);
});

test("resolveInitialGraphTarget: no resolvable identity yields a null node id, not a guess", () => {
  const result = resolveInitialGraphTarget({ shapeParam: "does-not-exist", worksheetParam: "sheet-A" }, nodes, edges);
  assert.equal(result.nodeId, null);
  assert.equal(result.isFallback, false);
});

test("resolveInitialGraphTarget: preserves the worksheet filter even when no node is resolvable, so the correct worksheet is still shown", () => {
  const result = resolveInitialGraphTarget({ worksheetParam: "sheet-B" }, nodes, edges);
  assert.equal(result.worksheetFilter, "sheet-B");
  assert.equal(result.nodeId, null);
});

test("resolveInitialGraphTarget: with no params at all, resolves to no worksheet filter and no node", () => {
  const result = resolveInitialGraphTarget({}, nodes, edges);
  assert.deepEqual(result, { worksheetFilter: null, nodeId: null, isFallback: false, errorFocus: false });
});

test("resolveInitialGraphTarget (Problem 2): mode=error-focus is carried through for an exact-node match", () => {
  const result = resolveInitialGraphTarget({ nodeParam: "node-a", worksheetParam: "sheet-A", modeParam: "error-focus" }, nodes, edges);
  assert.deepEqual(result, { worksheetFilter: "sheet-A", nodeId: "node-a", isFallback: false, errorFocus: true });
});

test("resolveInitialGraphTarget (Problem 2): mode=error-focus is carried through for a connector-fallback match", () => {
  const result = resolveInitialGraphTarget({ connectorParam: "57", worksheetParam: "sheet-A", modeParam: "error-focus" }, nodes, edges);
  assert.deepEqual(result, { worksheetFilter: "sheet-A", nodeId: "node-c", isFallback: true, errorFocus: true });
});

test("resolveInitialGraphTarget (Problem 2): mode=error-focus is carried through even when no node is resolvable (worksheet/candidate-evidence-only state)", () => {
  const result = resolveInitialGraphTarget({ worksheetParam: "sheet-A", modeParam: "error-focus" }, nodes, edges);
  assert.deepEqual(result, { worksheetFilter: "sheet-A", nodeId: null, isFallback: false, errorFocus: true });
});

test("resolveInitialGraphTarget (Problem 2): an unrecognized mode value never activates error-focus", () => {
  const result = resolveInitialGraphTarget({ nodeParam: "node-a", modeParam: "something-else" }, nodes, edges);
  assert.equal(result.errorFocus, false);
});
