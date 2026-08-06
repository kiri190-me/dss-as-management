import { test } from "node:test";
import assert from "node:assert/strict";
import { extractReferenceIndex } from "./extract-reference-index";
import type { LoadedSheet } from "./workbook-loader";

/**
 * Synthetic fixture modeled on the real "Main page"/"QC" shape (Phase 2.5):
 * a sheet-nav hyperlink whose range also covers a stray number, an external
 * UNC-style file hyperlink, an orphan bare-numeric cell, and a plain
 * descriptive text cell.
 */
function buildFixtureSheet(): LoadedSheet {
  return {
    name: "(TEST) Main page",
    sheetId: "995",
    worksheetPath: "xl/worksheets/sheetTest5.xml",
    drawingPath: null,
    worksheet: {
      dimension: "A1:D10",
      merges: [],
      hyperlinks: [
        {
          ref: "A3:A4",
          rId: null,
          location: "'(RFG) (1)고장 접수 확인'!A1",
          display: "1. 고장/이슈 발생",
          target: null,
        },
        {
          ref: "D9",
          rId: "rId1",
          location: null,
          display: null,
          target: "file:///\\\\192.168.0.222\\2_as센터\\1.%20수리%20관련",
        },
      ],
      cells: {
        A3: "1. 고장/이슈 발생",
        A4: "19", // stray number inside the hyperlink's own range — should NOT become an orphan item
        C5: "68", // bare numeric cell outside any hyperlink range — should become an orphan CROSS_REFERENCE_ID
        B2: "RF Generator", // plain descriptive text
        D9: "\\\\192.168.0.222\\2_as센터\\1. 수리 관련",
      },
    },
    drawing: null,
  };
}

test("extractReferenceIndex: classifies a sheet-nav hyperlink as NAV_LINK with the target sheet name", () => {
  const { referenceItems } = extractReferenceIndex(buildFixtureSheet());
  const navItem = referenceItems.find((i) => i.itemType === "NAV_LINK");
  assert.ok(navItem);
  assert.equal(navItem?.hyperlinkTarget, "(RFG) (1)고장 접수 확인");
  assert.equal(navItem?.label, "1. 고장/이슈 발생");
});

test("extractReferenceIndex: a cell inside a hyperlink's own range is not re-emitted as a separate item", () => {
  const { referenceItems } = extractReferenceIndex(buildFixtureSheet());
  const strayNumberItem = referenceItems.find((i) => i.sourceCellRange === "A4");
  assert.equal(strayNumberItem, undefined);
});

test("extractReferenceIndex: classifies a non-sheet hyperlink as EXTERNAL_FILE_LINK", () => {
  const { referenceItems } = extractReferenceIndex(buildFixtureSheet());
  const fileItem = referenceItems.find((i) => i.itemType === "EXTERNAL_FILE_LINK");
  assert.ok(fileItem);
  assert.ok(fileItem?.hyperlinkTarget?.includes("192.168.0.222"));
});

test("extractReferenceIndex: a bare numeric cell outside any hyperlink range becomes CROSS_REFERENCE_ID + ORPHAN_REFERENCE_ITEM issue", () => {
  const { referenceItems, issues } = extractReferenceIndex(buildFixtureSheet());
  const crossRefItem = referenceItems.find((i) => i.sourceCellRange === "C5");
  assert.ok(crossRefItem);
  assert.equal(crossRefItem?.itemType, "CROSS_REFERENCE_ID");
  assert.equal(crossRefItem?.crossReferenceNumber, "68");

  const issue = issues.find((i) => i.sourceReference === "C5");
  assert.ok(issue);
  assert.equal(issue?.issueType, "ORPHAN_REFERENCE_ITEM");
  assert.equal(issue?.severity, "INFO");
});

test("extractReferenceIndex: a plain descriptive text cell becomes TEXT_NOTE", () => {
  const { referenceItems } = extractReferenceIndex(buildFixtureSheet());
  const noteItem = referenceItems.find((i) => i.sourceCellRange === "B2");
  assert.ok(noteItem);
  assert.equal(noteItem?.itemType, "TEXT_NOTE");
  assert.equal(noteItem?.label, "RF Generator");
});

test("extractReferenceIndex: every non-empty cell is accounted for exactly once (no silent drops, no duplicates)", () => {
  const { referenceItems } = extractReferenceIndex(buildFixtureSheet());
  // A3 (consumed by the NAV_LINK item itself), C5, B2, D9 => 4 items;
  // A4 is consumed silently (inside the hyperlink range) and must not appear.
  assert.equal(referenceItems.length, 4);
  const ranges = referenceItems.map((i) => i.sourceCellRange).sort();
  assert.deepEqual(ranges, ["A3:A4", "B2", "C5", "D9"]);
});
