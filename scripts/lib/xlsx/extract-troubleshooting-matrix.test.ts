import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTroubleshootingMatrix } from "./extract-troubleshooting-matrix";
import type { LoadedSheet } from "./workbook-loader";

/**
 * Synthetic fixture matching (MB) 수리's real shape (Phase 1 report §3):
 * no drawing layer at all, symptom headers as "N. <text>" in column A, a
 * step-label row exactly 2 rows below each header (verified against all
 * 11 real blocks), literal "↓"/"N.G." cell text, and a corrective-action
 * row beneath a failure.
 */
function buildFixtureSheet(): LoadedSheet {
  return {
    name: "(TEST) 고장 진단표",
    sheetId: "997",
    worksheetPath: "xl/worksheets/sheetTest3.xml",
    drawingPath: null,
    worksheet: {
      dimension: "A1:H30",
      merges: [],
      hyperlinks: [],
      cells: {
        // block 1: header row 1, label row 3 (1+2)
        A1: "1. 테스트 알람 발생",
        B3: "1. 수압시험",
        E3: "2. 기밀시험",
        H3: "수리 완료",
        B4: "N.G.",
        C4: "↓",
        B5: "누수 개소 교환",

        // block 2: header row 10, label row 12
        A10: "2. 두 번째 알람 발생",
        B12: "1. PARAMETER 확인",
        E12: "수리 완료",
        B13: "↓",
        E13: "N.G.",
        E14: "PARAMETER 변경",
      },
    },
    drawing: null,
  };
}

test("extractTroubleshootingMatrix: one entry per numbered symptom header", () => {
  const { entries } = extractTroubleshootingMatrix(buildFixtureSheet());
  assert.equal(entries.length, 2);
  assert.equal(entries[0].symptom, "1. 테스트 알람 발생");
  assert.equal(entries[1].symptom, "2. 두 번째 알람 발생");
});

test("extractTroubleshootingMatrix: the normal chain joins every step label found in the label row", () => {
  const { entries } = extractTroubleshootingMatrix(buildFixtureSheet());
  assert.equal(entries[0].normalNextAction, "1. 수압시험 → 2. 기밀시험 → 수리 완료");
  assert.equal(entries[0].inspectionAction, "1. 수압시험");
});

test("extractTroubleshootingMatrix: NG-adjacent corrective action text is collected regardless of column alignment", () => {
  const { entries } = extractTroubleshootingMatrix(buildFixtureSheet());
  assert.equal(entries[0].ngAction, "누수 개소 교환");
  assert.equal(entries[1].ngAction, "PARAMETER 변경");
});

test("extractTroubleshootingMatrix: produces exactly one TROUBLESHOOTING-type node for the whole sheet", () => {
  const { node } = extractTroubleshootingMatrix(buildFixtureSheet());
  assert.equal(node.nodeType, "TROUBLESHOOTING");
  assert.equal(node.sourceWorksheet, "(TEST) 고장 진단표");
});
