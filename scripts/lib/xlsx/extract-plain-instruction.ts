import type { LoadedSheet } from "./workbook-loader";
import { splitCellRef } from "./ooxml-parser";
import type { ExtractedNode, ExtractedValidationIssue } from "./types";

const REPORT_WORD_RE = /보고서|리포트|report/i;
const SUBMISSION_WORD_RE = /제출|업로드|송부/;

/**
 * Strategy D (Phase 2.5): a sheet with no drawing connectors at all and no
 * checklist-anchor hyperlinks — just a short instructional paragraph typed
 * directly into the cell grid. (MB) 고객 연락's exact shape: 2-3 sentences
 * telling the technician to write up and submit an inspection report, with
 * no flow diagram at all — unlike its RFG counterpart, (RFG) (8)고객 연락,
 * which does have a real connector-based flow and is handled by Strategy A
 * instead.
 *
 * Produces one TASK- or DOCUMENT_REFERENCE-type node for the whole sheet,
 * built from every non-"Main page" cell joined in reading order (top to
 * bottom, then left to right); zero edges. This node cannot be wired into a
 * flow — there is no shape graph to derive an edge from, and inventing one
 * would violate the "do not invent missing edges" rule — so it stays an
 * isolated node in whichever combined template it's added to (same as the
 * existing CHECKLIST/TROUBLESHOOTING container nodes already do).
 */
export function extractPlainInstruction(
  sheet: LoadedSheet
): { node: ExtractedNode; issues: ExtractedValidationIssue[] } {
  const { worksheet } = sheet;
  const issues: ExtractedValidationIssue[] = [];

  const entries = Object.entries(worksheet.cells)
    .filter(([, val]) => val !== "Main page")
    .sort(([a], [b]) => {
      const ra = splitCellRef(a);
      const rb = splitCellRef(b);
      return ra.row - rb.row || ra.col.length - rb.col.length || ra.col.localeCompare(rb.col);
    });

  const text = entries
    .map(([, val]) => val)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const nodeType =
    REPORT_WORD_RE.test(text) && SUBMISSION_WORD_RE.test(text) ? "DOCUMENT_REFERENCE" : "TASK";
  const title = sheet.name.replace(/^\((RFG|MB)\)\s*/, "");

  const node: ExtractedNode = {
    nodeCode: `s${sheet.sheetId}-instruction`,
    nodeType,
    title,
    description: text || null,
    instructions: text || null,
    positionX: 0,
    positionY: 0,
    sortOrder: 0,
    sourceWorksheet: sheet.name,
    sourceShapeId: null,
    sourceCellRange: worksheet.dimension,
  };

  if (!text) {
    issues.push({
      severity: "WARNING",
      issueType: "UNSUPPORTED_OBJECT",
      message: "이 시트에서 도형 기반 흐름도나 체크리스트 구조를 찾지 못했고, 대체할 지침 텍스트도 없습니다.",
      sourceWorksheet: sheet.name,
      sourceReference: null,
    });
  }

  return { node, issues };
}
