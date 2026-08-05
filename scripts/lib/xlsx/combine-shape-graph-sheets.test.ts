import { test } from "node:test";
import assert from "node:assert/strict";
import { combineShapeGraphSheets } from "./combine-shape-graph-sheets";
import type { LoadedSheet } from "./workbook-loader";
import type { DrawingAnchor } from "./ooxml-parser";

/**
 * Two-sheet fixture reproducing the mechanism behind the two verified RFG
 * cross-stage loop-backs (Phase 1 report §2): a node whose text names a
 * stage by its parenthesized number and ends in 재실시/재진행 must, when
 * that target stage's sheet is included in the same combined template,
 * get a real LOOP_BACK edge to that sheet's own START node — not just a
 * dead-end text reference.
 */
function buildSourceSheet(): LoadedSheet {
  const drawing: DrawingAnchor[] = [
    { kind: "shape", id: "1", name: "n1", descr: null, geom: "rect", text: "출하 준비 확인", fill: null, from: { col: 0, row: 0 }, to: { col: 2, row: 1 } },
    { kind: "shape", id: "2", name: "n2", descr: null, geom: "rect", text: "(4) 기본 정전 검사 재실시", fill: null, from: { col: 0, row: 3 }, to: { col: 2, row: 4 } },
    { kind: "connector", id: "c1", name: "c1", geom: "straightConnector1", stCxnId: "1", endCxnId: "2", headType: "none", tailType: "triangle", from: { col: 0, row: 1 }, to: { col: 0, row: 3 } },
  ];
  return {
    name: "(RFG) (11)출하 준비",
    sheetId: "911",
    worksheetPath: "xl/worksheets/sheetSource.xml",
    drawingPath: "xl/drawings/drawingSource.xml",
    worksheet: { dimension: "A1:F10", merges: [], hyperlinks: [], cells: {} },
    drawing,
  };
}

function buildTargetSheet(): LoadedSheet {
  const drawing: DrawingAnchor[] = [
    { kind: "shape", id: "1", name: "n1", descr: null, geom: "rect", text: "판금 탈거 및 외관 확인", fill: null, from: { col: 0, row: 0 }, to: { col: 2, row: 1 } },
    { kind: "shape", id: "2", name: "n2", descr: null, geom: "rect", text: "통전 검사 실시", fill: null, from: { col: 0, row: 3 }, to: { col: 2, row: 4 } },
    { kind: "connector", id: "c1", name: "c1", geom: "straightConnector1", stCxnId: "1", endCxnId: "2", headType: "none", tailType: "triangle", from: { col: 0, row: 1 }, to: { col: 0, row: 3 } },
  ];
  return {
    name: "(RFG) (4)기본 정전 검사",
    sheetId: "904",
    worksheetPath: "xl/worksheets/sheetTarget.xml",
    drawingPath: "xl/drawings/drawingTarget.xml",
    worksheet: { dimension: "A1:F10", merges: [], hyperlinks: [], cells: {} },
    drawing,
  };
}

test("combineShapeGraphSheets: a stage-restart reference becomes a real LOOP_BACK edge to the target sheet's START node", () => {
  const template = combineShapeGraphSheets([buildSourceSheet(), buildTargetSheet()], {
    code: "test-combine",
    name: "테스트 결합 템플릿",
    equipmentType: "RFG",
    description: "",
  });

  const loopBackEdges = template.edges.filter((e) => e.branchType === "LOOP_BACK");
  assert.equal(loopBackEdges.length, 1);

  const edge = loopBackEdges[0];
  const fromNode = template.nodes.find((n) => n.nodeCode === edge.fromNodeCode)!;
  const toNode = template.nodes.find((n) => n.nodeCode === edge.toNodeCode)!;
  assert.equal(fromNode.title, "(4) 기본 정전 검사 재실시");
  assert.equal(toNode.title, "판금 탈거 및 외관 확인");
  assert.equal(toNode.sourceWorksheet, "(RFG) (4)기본 정전 검사");
});

test("combineShapeGraphSheets: a stage reference to a sheet NOT included in the template is reported, not guessed at", () => {
  const template = combineShapeGraphSheets([buildSourceSheet()], {
    code: "test-combine-partial",
    name: "테스트 결합 (일부만)",
    equipmentType: "RFG",
    description: "",
  });

  assert.equal(template.edges.some((e) => e.branchType === "LOOP_BACK"), false);
  const issue = template.issues.find((i) => i.issueType === "MISSING_SOURCE_NODE" && i.severity === "INFO");
  assert.ok(issue, "expected an INFO issue noting the out-of-scope stage reference");
});

test("combineShapeGraphSheets: nodes from both sheets carry a unique, sheet-prefixed node code", () => {
  const template = combineShapeGraphSheets([buildSourceSheet(), buildTargetSheet()], {
    code: "test-combine-codes",
    name: "테스트 결합 코드",
    equipmentType: "RFG",
    description: "",
  });
  assert.equal(template.nodes.length, 4);
  const codes = new Set(template.nodes.map((n) => n.nodeCode));
  assert.equal(codes.size, 4, "every node code must be unique across the combined template");
});
