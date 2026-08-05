import type { LoadedSheet } from "./workbook-loader";
import { splitCellRef } from "./ooxml-parser";
import type { ExtractedNode, ExtractedTroubleshootingEntry, ExtractedValidationIssue } from "./types";

const SYMPTOM_HEADER_RE = /^\d+\.\s/;
// Verified against all 11 symptom blocks in (MB) 수리 (Phase 1 report §3):
// every block's step-label row sits exactly 2 rows below its symptom
// header row, regardless of how many steps or columns that block uses.
const LABEL_ROW_OFFSET = 2;

function isNoiseCell(value: string): boolean {
  return value === "↓" || value === "N.G." || /^\d+$/.test(value);
}

/**
 * Strategy C (Phase 1 report §7): a sheet with no drawing layer at all,
 * where symptom rows, step sequences, and failure branches are all typed
 * directly into the cell grid using literal "↓" arrow characters and
 * literal "N.G." text — (MB) 수리's exact shape (11 independent
 * symptom→check→replace sequences). One TROUBLESHOOTING-type node for the
 * sheet; one procedure_troubleshooting_entry per symptom block.
 */
export function extractTroubleshootingMatrix(
  sheet: LoadedSheet
): { node: ExtractedNode; entries: ExtractedTroubleshootingEntry[]; issues: ExtractedValidationIssue[] } {
  const { worksheet } = sheet;
  const issues: ExtractedValidationIssue[] = [];

  const headerRows = Object.entries(worksheet.cells)
    .filter(([ref, val]) => splitCellRef(ref).col === "A" && SYMPTOM_HEADER_RE.test(val))
    .map(([ref, val]) => ({ row: splitCellRef(ref).row, symptom: val }))
    .sort((a, b) => a.row - b.row);

  if (headerRows.length === 0) {
    issues.push({
      severity: "WARNING",
      issueType: "UNSUPPORTED_OBJECT",
      message: "이 시트에서 증상별 헤더 행(예: \"1. ...\")을 찾지 못했습니다.",
      sourceWorksheet: sheet.name,
      sourceReference: null,
    });
  }

  const maxRow = worksheet.dimension ? parseInt(worksheet.dimension.match(/(\d+)$/)?.[1] ?? "0", 10) : 0;
  const lastCol = worksheet.dimension?.match(/:([A-Z]+)\d+$/)?.[1] ?? "AA";

  const entries: ExtractedTroubleshootingEntry[] = [];
  const nodeCode = `s${sheet.sheetId}-troubleshooting`;

  for (let i = 0; i < headerRows.length; i++) {
    const { row: headerRow, symptom } = headerRows[i];
    const blockEnd = (headerRows[i + 1]?.row ?? maxRow + 1) - 1;
    const labelRow = headerRow + LABEL_ROW_OFFSET;

    const labelRowCells = Object.entries(worksheet.cells)
      .filter(([ref, val]) => splitCellRef(ref).row === labelRow && !isNoiseCell(val))
      .sort(([a], [b]) => splitCellRef(a).col.length - splitCellRef(b).col.length || splitCellRef(a).col.localeCompare(splitCellRef(b).col));
    const stepLabels = labelRowCells.map(([, val]) => val);

    if (stepLabels.length === 0) {
      issues.push({
        severity: "WARNING",
        issueType: "AMBIGUOUS_LABEL_EDGE_MATCH",
        message: `증상 "${symptom}" 블록의 점검 단계 행(${labelRow}행)에서 단계 이름을 찾지 못했습니다.`,
        sourceWorksheet: sheet.name,
        sourceReference: `row${labelRow}`,
      });
    }

    // Corrective-action text: any non-noise cell strictly below the
    // step-label row within this block — captures every "…교환"/"…청소"
    // action regardless of which column's N.G. marker it sits under
    // (Phase 1 report §3 documents this as sufficient to preserve the
    // symptom's meaning without solving the full 2-D column alignment).
    const actionCells = Object.entries(worksheet.cells)
      .filter(([ref, val]) => {
        const { row } = splitCellRef(ref);
        return row > labelRow + 1 && row <= blockEnd && !isNoiseCell(val);
      })
      .sort(([a], [b]) => splitCellRef(a).row - splitCellRef(b).row || splitCellRef(a).col.localeCompare(splitCellRef(b).col));
    const ngAction = actionCells.map(([, val]) => val).join("; ") || null;

    entries.push({
      nodeCode,
      symptom,
      inspectionAction: stepLabels[0] ?? null,
      normalNextAction: stepLabels.length > 0 ? stepLabels.join(" → ") : null,
      ngAction,
      retryInstruction: null,
      sortOrder: i,
      sourceCellRange: `A${headerRow}:${lastCol}${blockEnd}`,
    });
  }

  const node: ExtractedNode = {
    nodeCode,
    nodeType: "TROUBLESHOOTING",
    title: sheet.name.replace(/^\(MB\)\s*/, ""),
    description: `${entries.length}개 고장 증상별 진단·조치 표 (원본: ${sheet.name}).`,
    positionX: 0,
    positionY: 0,
    sortOrder: 0,
    sourceWorksheet: sheet.name,
    sourceShapeId: null,
    sourceCellRange: worksheet.dimension,
  };

  return { node, entries, issues };
}
