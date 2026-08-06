import type { LoadedSheet } from "./workbook-loader";
import { colLettersToNum, splitCellRef } from "./ooxml-parser";
import type { ExtractedReferenceItem, ExtractedValidationIssue } from "./types";

const SHEET_LOCATION_RE = /^'([^']+)'!/;

function parseRange(ref: string): { c1: number; r1: number; c2: number; r2: number } {
  const [start, end] = ref.split(":");
  const s = splitCellRef(start);
  const e = end ? splitCellRef(end) : s;
  return { c1: colLettersToNum(s.col), r1: s.row, c2: colLettersToNum(e.col), r2: e.row };
}

function cellInRange(cellRef: string, range: { c1: number; r1: number; c2: number; r2: number }): boolean {
  const { col, row } = splitCellRef(cellRef);
  const c = colLettersToNum(col);
  return c >= range.c1 && c <= range.c2 && row >= range.r1 && row <= range.r2;
}

function sortKey(ref: string): { row: number; col: number } {
  const { col, row } = splitCellRef(ref);
  return { row, col: colLettersToNum(col) };
}

/**
 * Strategy E (Phase 2.5): "Main page" and "QC" — pure navigation/reference
 * sheets with no drawing layer, no shape graph, and no checklist-anchor
 * structure. Produces zero ExtractedNode/ExtractedEdge rows by design (the
 * task brief: "Do not duplicate its boxes as executable technical nodes
 * when they only link to detailed sheets") — every row of content becomes
 * one ExtractedReferenceItem instead, classified deterministically:
 *
 *  - a hyperlink whose `location` resolves to another worksheet in this
 *    workbook (`'SheetName'!A1`) -> NAV_LINK
 *  - any other hyperlink (a UNC path / relative file link outside the
 *    workbook) -> EXTERNAL_FILE_LINK
 *  - a bare numeric cell not covered by any hyperlink's range -> a
 *    CROSS_REFERENCE_ID item, and *always* also an ORPHAN_REFERENCE_ITEM
 *    validation issue (INFO) — verified by inspection that none of these
 *    numbers resolve to anything else in this workbook. This is
 *    intentionally uniform: some of these numbers are plainly a hierarchical
 *    list counter (QC's "1./2./3." column) and some are an unexplained
 *    cross-reference to an external document, but the cell value alone
 *    gives no deterministic way to tell which is which, and guessing would
 *    violate the task's "do not guess targets" rule — so every one is
 *    surfaced as an open question for a human to resolve, never silently
 *    imported as if it were self-explanatory.
 *  - any other non-empty text cell -> TEXT_NOTE
 *
 * A hyperlink's own `ref` range (e.g. "A3:A4") frequently spans more than
 * one cell with content (Main page: the top cell holds the stage label, a
 * cell below it holds a stray number belonging to the same link) — every
 * cell inside a hyperlink's range is treated as already represented by that
 * hyperlink's reference item and is not separately re-emitted.
 */
export function extractReferenceIndex(
  sheet: LoadedSheet
): { referenceItems: ExtractedReferenceItem[]; issues: ExtractedValidationIssue[] } {
  const { worksheet } = sheet;
  const issues: ExtractedValidationIssue[] = [];
  const items: { key: { row: number; col: number }; item: ExtractedReferenceItem }[] = [];
  const consumed = new Set<string>();

  for (const link of worksheet.hyperlinks) {
    if (!link.ref) continue;
    const range = parseRange(link.ref);
    for (const ref of Object.keys(worksheet.cells)) {
      if (cellInRange(ref, range)) consumed.add(ref);
    }

    const firstCellRef = link.ref.split(":")[0];
    const firstCellValue = worksheet.cells[firstCellRef] ?? null;
    const sheetLocationMatch = link.location?.match(SHEET_LOCATION_RE) ?? null;

    if (sheetLocationMatch) {
      const targetSheet = sheetLocationMatch[1];
      const label =
        link.display && link.display !== link.location ? link.display : firstCellValue ?? targetSheet;
      items.push({
        key: sortKey(firstCellRef),
        item: {
          itemType: "NAV_LINK",
          label,
          sourceWorksheet: sheet.name,
          sourceCellRange: link.ref,
          hyperlinkTarget: targetSheet,
          crossReferenceNumber: null,
          sortOrder: 0,
        },
      });
    } else {
      const target = link.target ?? link.location;
      const label = link.display ?? firstCellValue ?? target ?? "(제목 없음)";
      items.push({
        key: sortKey(firstCellRef),
        item: {
          itemType: "EXTERNAL_FILE_LINK",
          label,
          sourceWorksheet: sheet.name,
          sourceCellRange: link.ref,
          hyperlinkTarget: target,
          crossReferenceNumber: null,
          sortOrder: 0,
        },
      });
    }
  }

  for (const [ref, value] of Object.entries(worksheet.cells)) {
    if (consumed.has(ref)) continue;
    if (value === "Main page" || value.trim().length === 0) continue;

    if (/^\d+$/.test(value)) {
      items.push({
        key: sortKey(ref),
        item: {
          itemType: "CROSS_REFERENCE_ID",
          label: value,
          sourceWorksheet: sheet.name,
          sourceCellRange: ref,
          hyperlinkTarget: null,
          crossReferenceNumber: value,
          sortOrder: 0,
        },
      });
      issues.push({
        severity: "INFO",
        issueType: "ORPHAN_REFERENCE_ITEM",
        message: `셀 ${ref}의 교차 참조 번호 "${value}"이(가) 이 워크북 내의 다른 위치로 해석되지 않습니다.`,
        sourceWorksheet: sheet.name,
        sourceReference: ref,
      });
      continue;
    }

    items.push({
      key: sortKey(ref),
      item: {
        itemType: "TEXT_NOTE",
        label: value,
        sourceWorksheet: sheet.name,
        sourceCellRange: ref,
        hyperlinkTarget: null,
        crossReferenceNumber: null,
        sortOrder: 0,
      },
    });
  }

  items.sort((a, b) => a.key.row - b.key.row || a.key.col - b.key.col);
  const referenceItems = items.map(({ item }, i) => ({ ...item, sortOrder: i }));

  return { referenceItems, issues };
}
