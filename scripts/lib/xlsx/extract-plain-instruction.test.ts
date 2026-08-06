import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPlainInstruction } from "./extract-plain-instruction";
import type { LoadedSheet } from "./workbook-loader";

/**
 * Synthetic fixture matching (MB) 고객 연락's real shape (Phase 2.5): no
 * drawing layer at all, no checklist-anchor hyperlinks (only the sheet's
 * own single "Main page" back-link), just instructional paragraphs typed
 * directly into the cell grid.
 */
function buildFixtureSheet(overrides?: Partial<LoadedSheet["worksheet"]["cells"]>): LoadedSheet {
  return {
    name: "(TEST) 고객 연락",
    sheetId: "997",
    worksheetPath: "xl/worksheets/sheetTest3.xml",
    drawingPath: null,
    worksheet: {
      dimension: "A2:L25",
      merges: [],
      hyperlinks: [{ ref: "A2", rId: null, location: "'Main page'!A1", display: "Main page", target: null }],
      cells: {
        A2: "Main page",
        B2: "※ 점검 완료 후 검사 보고서를 작성하여 고객 담당자에게 제출한다.",
        B4: "1. 검사보고서는 해당 수리 건의 연락서 폴더 내에서 작성 후 저장한다.",
        ...overrides,
      },
    },
    drawing: null,
  };
}

test("extractPlainInstruction: produces exactly one node with zero edges", () => {
  const { node } = extractPlainInstruction(buildFixtureSheet());
  assert.equal(node.sourceWorksheet, "(TEST) 고객 연락");
});

test("extractPlainInstruction: excludes the 'Main page' back-link cell from the instruction text", () => {
  const { node } = extractPlainInstruction(buildFixtureSheet());
  assert.ok(!node.instructions?.includes("Main page"));
});

test("extractPlainInstruction: joins cell text in reading order (row then column)", () => {
  const { node } = extractPlainInstruction(buildFixtureSheet());
  const idx1 = node.instructions?.indexOf("점검 완료 후") ?? -1;
  const idx2 = node.instructions?.indexOf("연락서 폴더") ?? -1;
  assert.ok(idx1 >= 0 && idx2 >= 0 && idx1 < idx2);
});

test("extractPlainInstruction: report-submission wording classifies as DOCUMENT_REFERENCE", () => {
  const { node } = extractPlainInstruction(buildFixtureSheet());
  assert.equal(node.nodeType, "DOCUMENT_REFERENCE");
});

test("extractPlainInstruction: plain task wording (no report-submission phrase) classifies as TASK", () => {
  const sheet = buildFixtureSheet({
    B2: "부품을 확인하고 정리한다.",
    B4: "정리 후 다음 단계로 진행한다.",
  });
  const { node } = extractPlainInstruction(sheet);
  assert.equal(node.nodeType, "TASK");
});

test("extractPlainInstruction: a sheet with no usable text raises an UNSUPPORTED_OBJECT issue", () => {
  const sheet: LoadedSheet = {
    name: "(TEST) 빈 시트",
    sheetId: "996",
    worksheetPath: "xl/worksheets/sheetTest4.xml",
    drawingPath: null,
    worksheet: { dimension: "A1:A1", merges: [], hyperlinks: [], cells: { A1: "Main page" } },
    drawing: null,
  };
  const { issues } = extractPlainInstruction(sheet);
  const issue = issues.find((i) => i.issueType === "UNSUPPORTED_OBJECT");
  assert.ok(issue);
  assert.equal(issue?.severity, "WARNING");
});
