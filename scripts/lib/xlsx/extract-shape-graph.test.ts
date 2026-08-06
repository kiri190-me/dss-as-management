import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSheetGraph } from "./extract-shape-graph";
import type { LoadedSheet } from "./workbook-loader";
import type { DrawingAnchor } from "./ooxml-parser";

/**
 * Synthetic fixture — not the real workbook. Encodes, in miniature, every
 * structural signal Phase 1 documented as real (Phase 1 report §5/§6):
 * a DEFAULT edge (unlabeled), an NG edge (proximity-matched red label), a
 * dangling connector (missing endCxn), an unreachable island, a decision
 * node missing its normal/default path, and an arrow-shaped autoshape
 * carrying its own text (not resolvable as a graph edge).
 */
function buildFixtureSheet(): LoadedSheet {
  const drawing: DrawingAnchor[] = [
    // node 1 — START (earliest, no incoming). Multi-line text exercises
    // the "*"-prefixed caution split (Phase 1 report §2/§6 finding 9).
    { kind: "shape", id: "1", name: "n1", descr: null, geom: "rect", text: "인수 제품 확인\n*고전압 주의", fill: null, from: { col: 0, row: 0 }, to: { col: 2, row: 1 } },
    // node 2 — has only an NG outgoing edge, no default/normal path.
    { kind: "shape", id: "2", name: "n2", descr: null, geom: "rect", text: "판단 확인", fill: null, from: { col: 0, row: 3 }, to: { col: 2, row: 4 } },
    // node 3 — NG target, terminal (END).
    { kind: "shape", id: "3", name: "n3", descr: null, geom: "rect", text: "NG 조치", fill: "FF0000", from: { col: 4, row: 3 }, to: { col: 6, row: 4 } },
    // island: 4 -> 5, unreachable from node 1's start.
    { kind: "shape", id: "4", name: "n4", descr: null, geom: "rect", text: "고립된 시작", fill: null, from: { col: 0, row: 10 }, to: { col: 2, row: 11 } },
    { kind: "shape", id: "5", name: "n5", descr: null, geom: "rect", text: "고립된 끝", fill: null, from: { col: 4, row: 10 }, to: { col: 6, row: 11 } },

    // NG label, close to connector c2's anchor.
    { kind: "shape", id: "8", name: "lbl-ng", descr: null, geom: "rect", text: "NG", fill: "FF0000", from: { col: 2, row: 3 }, to: { col: 3, row: 4 } },
    // Arrow-shaped autoshape carrying its own text, far from every
    // connector so it can't be proximity-matched as anyone's label —
    // Phase 1 report §6 finding 3.
    { kind: "shape", id: "9", name: "arrow-with-text", descr: null, geom: "straightConnector1", text: "O.K.", fill: null, from: { col: 20, row: 20 }, to: { col: 21, row: 20 } },

    // c1: 1 -> 2, DEFAULT (no nearby label)
    { kind: "connector", id: "c1", name: "c1", geom: "straightConnector1", stCxnId: "1", endCxnId: "2", headType: "none", tailType: "triangle", from: { col: 0, row: 1 }, to: { col: 0, row: 3 } },
    // c2: 2 -> 3, NG (label #8 nearby)
    { kind: "connector", id: "c2", name: "c2", geom: "straightConnector1", stCxnId: "2", endCxnId: "3", headType: "none", tailType: "triangle", from: { col: 2, row: 3 }, to: { col: 4, row: 4 } },
    // c3: dangling — no endCxnId at all
    { kind: "connector", id: "c3", name: "c3", geom: "straightConnector1", stCxnId: "1", endCxnId: null, headType: "none", tailType: "triangle", from: { col: 0, row: 1 }, to: { col: 1, row: 2 } },
    // c4: 4 -> 5, DEFAULT (the unreachable island)
    { kind: "connector", id: "c4", name: "c4", geom: "straightConnector1", stCxnId: "4", endCxnId: "5", headType: "none", tailType: "triangle", from: { col: 2, row: 10 }, to: { col: 4, row: 11 } },
  ];

  return {
    name: "(TEST) 가상 시트",
    sheetId: "999",
    worksheetPath: "xl/worksheets/sheetTest.xml",
    drawingPath: "xl/drawings/drawingTest.xml",
    worksheet: { dimension: "A1:F20", merges: [], hyperlinks: [], cells: {} },
    drawing,
  };
}

test("extractSheetGraph: builds one node per connected shape, skipping unconnected labels", () => {
  const { nodes } = extractSheetGraph(buildFixtureSheet());
  assert.equal(nodes.length, 5); // shapes 1-5; label #8 and arrow-text #9 excluded
  assert.ok(nodes.every((n) => ["1", "2", "3", "4", "5"].includes(n.sourceShapeId!)));
});

test("extractSheetGraph: default edge has no label; NG edge resolves via proximity", () => {
  const { edges } = extractSheetGraph(buildFixtureSheet());
  const defaultEdge = edges.find((e) => e.sourceConnectorId === "c1");
  const ngEdge = edges.find((e) => e.sourceConnectorId === "c2");
  assert.ok(defaultEdge);
  assert.equal(defaultEdge?.branchType, "DEFAULT");
  assert.equal(defaultEdge?.branchLabel, null);
  assert.ok(ngEdge);
  assert.equal(ngEdge?.branchType, "NG");
  assert.equal(ngEdge?.branchLabel, "NG");
});

test("extractSheetGraph: the '*'-prefixed line splits into safetyCaution, separate from instructions", () => {
  const { nodes } = extractSheetGraph(buildFixtureSheet());
  const node1 = nodes.find((n) => n.sourceShapeId === "1")!;
  assert.equal(node1.title, "인수 제품 확인");
  assert.equal(node1.safetyCaution, "*고전압 주의");
  assert.ok(!node1.instructions?.includes("고전압 주의"));
});

test("extractSheetGraph: node with only an NG branch is DECISION, and a MISSING_OUTGOING_PATH issue is raised", () => {
  const { nodes, issues } = extractSheetGraph(buildFixtureSheet());
  const node2 = nodes.find((n) => n.sourceShapeId === "2")!;
  assert.equal(node2.nodeType, "DECISION");
  const issue = issues.find((i) => i.issueType === "MISSING_OUTGOING_PATH");
  assert.ok(issue);
  assert.match(issue!.message, /판단 확인/);
});

test("extractSheetGraph: a dangling connector (missing endCxn) is reported, not imported as an edge", () => {
  const { edges, issues } = extractSheetGraph(buildFixtureSheet());
  assert.equal(edges.some((e) => e.sourceConnectorId === "c3"), false);
  const issue = issues.find((i) => i.issueType === "DANGLING_CONNECTOR");
  assert.ok(issue);
  assert.equal(issue?.severity, "ERROR");
});

test("extractSheetGraph: nodes unreachable from the start node are flagged UNREACHABLE_NODE", () => {
  const { issues } = extractSheetGraph(buildFixtureSheet());
  const unreachable = issues.filter((i) => i.issueType === "UNREACHABLE_NODE");
  assert.equal(unreachable.length, 2); // the isolated 4 -> 5 island
});

test("extractSheetGraph: an arrow-shaped autoshape carrying text is reported as UNSUPPORTED_OBJECT, not silently dropped", () => {
  const { issues } = extractSheetGraph(buildFixtureSheet());
  const issue = issues.find((i) => i.issueType === "UNSUPPORTED_OBJECT");
  assert.ok(issue);
  assert.match(issue!.message, /O\.K\./);
});

test("extractSheetGraph: the earliest node with no incoming edge is classified START", () => {
  const { nodes } = extractSheetGraph(buildFixtureSheet());
  const node1 = nodes.find((n) => n.sourceShapeId === "1")!;
  assert.equal(node1.nodeType, "START");
});

test("extractSheetGraph: a node with no outgoing edges is classified END", () => {
  const { nodes } = extractSheetGraph(buildFixtureSheet());
  const node3 = nodes.find((n) => n.sourceShapeId === "3")!;
  assert.equal(node3.nodeType, "END");
});

test("extractSheetGraph (Phase 3A): a dangling connector's rawEvidence captures the raw geometry and ranks a real candidate for the missing endpoint", () => {
  const { issues } = extractSheetGraph(buildFixtureSheet());
  const issue = issues.find((i) => i.issueType === "DANGLING_CONNECTOR")!;
  assert.equal(issue.rawEvidence?.connectorId, "c3");
  assert.equal(issue.rawEvidence?.stCxnId, "1");
  assert.equal(issue.rawEvidence?.endCxnId, null);
  assert.deepEqual(issue.rawEvidence?.to, { col: 1, row: 2 });
  // endCxnId is missing, so toCandidates must be populated; stCxnId is
  // known, so fromCandidates must not be.
  assert.equal(issue.rawEvidence?.fromCandidates, undefined);
  assert.ok(issue.rawEvidence?.toCandidates && issue.rawEvidence.toCandidates.length > 0);
  const nearest = issue.rawEvidence!.toCandidates![0];
  assert.equal(nearest.shapeId, "2"); // "판단 확인" is the closest real shape to (col:1,row:2)
  // branch-label shapes (NG, O.K.) must never appear as candidates.
  assert.ok(!issue.rawEvidence!.toCandidates!.some((c) => c.shapeId === "8" || c.shapeId === "9"));
});

test("extractSheetGraph (Phase 3A): a MISSING_OUTGOING_PATH issue's rawEvidence excludes the already-targeted NG shape", () => {
  const { issues } = extractSheetGraph(buildFixtureSheet());
  const issue = issues.find((i) => i.issueType === "MISSING_OUTGOING_PATH")!;
  assert.equal(issue.rawEvidence?.shapeId, "2");
  assert.ok(issue.rawEvidence?.candidates && issue.rawEvidence.candidates.length > 0);
  // shape#3 is already the NG target of shape#2 — must not reappear as a candidate.
  assert.ok(!issue.rawEvidence!.candidates!.some((c) => c.shapeId === "3"));
  assert.equal(issue.rawEvidence!.candidates![0].shapeId, "1");
});
