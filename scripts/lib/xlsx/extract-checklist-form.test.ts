import { test } from "node:test";
import assert from "node:assert/strict";
import { extractChecklistForm } from "./extract-checklist-form";
import type { LoadedSheet } from "./workbook-loader";

/**
 * Synthetic fixture matching (MB) 외관 및 내부 검사's real shape (Phase 1
 * report §3): no drawing layer, sections anchored by a recurring
 * 'Main page'!A1 hyperlink, titles marked with a bullet ("・"/"･") with the
 * Korean line following the Japanese one, a #VALUE! formula-error cell,
 * and a numeric pressure spec embedded in free text.
 */
function buildFixtureSheet(): LoadedSheet {
  return {
    name: "(TEST) 체크리스트 시트",
    sheetId: "998",
    worksheetPath: "xl/worksheets/sheetTest2.xml",
    drawingPath: null,
    worksheet: {
      dimension: "A1:F40",
      merges: [],
      hyperlinks: [
        { ref: "A10", rId: "rId1", location: "'Main page'!A1", display: null, target: "'Main page'!A1" },
        { ref: "A20", rId: "rId2", location: "'Main page'!A1", display: null, target: "'Main page'!A1" },
      ],
      cells: {
        // section 1: rows 1-9 (before first anchor)
        B2: "인수 절차 개요",
        // section 2: rows 10-19
        A10: "Main page",
        C11: "・JP제목",
        C12: "・압력 확인",
        D15: "차압계 압력이 1.3Mpa 이상인지 확인한다.",
        D16: "#VALUE!",
        // section 3: rows 20+
        A20: "Main page",
        C20: "・유량 확인",
        D25: "유량이 정상 범위인지 확인한다.",
      },
    },
    drawing: null,
  };
}

test("extractChecklistForm: splits the sheet into one section per Main-page anchor, plus an implicit first section", () => {
  const { sections } = extractChecklistForm(buildFixtureSheet());
  assert.equal(sections.length, 3);
});

test("extractChecklistForm: prefers the bulleted Korean title over the Japanese line and stray text", () => {
  const { sections } = extractChecklistForm(buildFixtureSheet());
  const section2 = sections.find((s) => s.sourceCellRange?.startsWith("A10"));
  assert.ok(section2);
  assert.equal(section2?.title, "압력 확인");
});

test("extractChecklistForm: a #VALUE! cell becomes a FORMULA_ERROR issue, not imported content", () => {
  const { issues } = extractChecklistForm(buildFixtureSheet());
  const issue = issues.find((i) => i.issueType === "FORMULA_ERROR");
  assert.ok(issue);
  assert.equal(issue?.severity, "WARNING");
  assert.equal(issue?.sourceReference, "D16");
});

test("extractChecklistForm: a pressure spec embedded in instruction text is extracted as a measurement", () => {
  const { sections } = extractChecklistForm(buildFixtureSheet());
  const section2 = sections.find((s) => s.sourceCellRange?.startsWith("A10"));
  const item = section2?.items[0];
  assert.equal(item?.measurementType, "PRESSURE");
  assert.equal(item?.measurementUnit, "MPa");
  assert.equal(item?.minValue, "1.3");
  assert.equal(item?.maxValue, "1.3");
});

test("extractChecklistForm: produces exactly one CHECKLIST-type node for the whole sheet", () => {
  const { node } = extractChecklistForm(buildFixtureSheet());
  assert.equal(node.nodeType, "CHECKLIST");
  assert.equal(node.sourceWorksheet, "(TEST) 체크리스트 시트");
});
