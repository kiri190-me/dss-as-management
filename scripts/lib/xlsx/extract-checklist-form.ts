import type { LoadedSheet } from "./workbook-loader";
import { colLettersToNum, splitCellRef } from "./ooxml-parser";
import type {
  ExtractedChecklistItem,
  ExtractedChecklistSection,
  ExtractedNode,
  ExtractedValidationIssue,
} from "./types";

// unitSuffix is the literal token that follows the number in the source
// text (case-insensitive) — kept separate from the display `unit` because
// the workbook writes some units inconsistently (e.g. "Mpa" for MPa).
const MEASUREMENT_PATTERNS: { unit: string; type: string; unitSuffix: string }[] = [
  { unit: "kV", type: "VOLTAGE", unitSuffix: "kV" },
  { unit: "V", type: "VOLTAGE", unitSuffix: "V" },
  { unit: "MPa", type: "PRESSURE", unitSuffix: "Mpa" },
  { unit: "MΩ", type: "RESISTANCE", unitSuffix: "MΩ" },
  { unit: "mA", type: "CURRENT", unitSuffix: "mA" },
];

/** Parses a "0.500~0.505Mpa"-style range, or a single "1.3Mpa" value. */
function extractMeasurement(text: string): Pick<ExtractedChecklistItem, "measurementType" | "measurementUnit" | "minValue" | "maxValue"> {
  for (const { unit, type, unitSuffix } of MEASUREMENT_PATTERNS) {
    const num = "\\d+(?:\\.\\d+)?";
    const rangeMatch = text.match(new RegExp(`(${num})\\s*[~-]\\s*(${num})\\s*${unitSuffix}`, "i"));
    if (rangeMatch) {
      return { measurementType: type, measurementUnit: unit, minValue: rangeMatch[1], maxValue: rangeMatch[2] };
    }
    const single = text.match(new RegExp(`(${num})\\s*${unitSuffix}(?![a-zA-Z])`, "i"));
    if (single) {
      return { measurementType: type, measurementUnit: unit, minValue: single[1], maxValue: single[1] };
    }
  }
  return { measurementType: null, measurementUnit: null, minValue: null, maxValue: null };
}

function sheetLastColumn(dimension: string | null): string {
  if (!dimension) return "Z";
  const m = dimension.match(/:([A-Z]+)\d+$/);
  return m ? m[1] : "Z";
}

/**
 * Strategy B (Phase 1 report §7): a sheet with no drawing connectors, whose
 * content is a sequence of sections each anchored by a recurring
 * 'Main page'!A1 return hyperlink cell — (MB) 외관 및 내부 검사's exact
 * shape (16 sections across 1,439 rows). One CHECKLIST-type node per
 * sheet; one procedure_checklist_section per anchor, with the section's
 * body text collected into a single representative item (Phase 1 report
 * §19: full per-row decomposition of a 1,439-row form was judged out of
 * scope for this phase — see the Phase 2 report's "content deferred").
 * Every #VALUE! formula-error cell in the section becomes its own
 * FORMULA_ERROR issue rather than being silently imported as content.
 */
export function extractChecklistForm(
  sheet: LoadedSheet
): { node: ExtractedNode; sections: ExtractedChecklistSection[]; issues: ExtractedValidationIssue[] } {
  const { worksheet } = sheet;
  const issues: ExtractedValidationIssue[] = [];
  const lastCol = sheetLastColumn(worksheet.dimension);

  const anchorRows = worksheet.hyperlinks
    .filter((h) => h.ref && (h.target === "'Main page'!A1" || h.location === "'Main page'!A1"))
    .map((h) => splitCellRef(h.ref!).row)
    .sort((a, b) => a - b);

  const maxRow = worksheet.dimension ? parseInt(worksheet.dimension.match(/(\d+)$/)?.[1] ?? "0", 10) : 0;
  const boundaries = [1, ...anchorRows, maxRow + 1];
  const uniqueBoundaries = [...new Set(boundaries)].sort((a, b) => a - b);

  const sections: ExtractedChecklistSection[] = [];
  const nodeCode = `s${sheet.sheetId}-checklist`;

  for (let i = 0; i < uniqueBoundaries.length - 1; i++) {
    const start = uniqueBoundaries[i];
    const end = uniqueBoundaries[i + 1] - 1;
    if (end < start) continue;

    const rowsInSection = Object.entries(worksheet.cells).filter(([ref]) => {
      const { row } = splitCellRef(ref);
      return row >= start && row <= end;
    });
    if (rowsInSection.length === 0) continue;

    // Title: the workbook consistently marks a section's real title with a
    // leading bullet (Phase 1 report §3 — "・REV확인", "・차압의 확인",
    // etc.), distinct from stray numeric cross-reference ids in the same
    // rows. Preferring that bullet over a fixed row-window avoids picking
    // up an unrelated "204"-style id or a "#VALUE!" error cell as the
    // title. Falls back to the first three rows' last text cell only for
    // sections with no bulleted line at all (the sheet's introductory
    // section, and a handful of sections whose title text lives only on
    // Main page — see the Phase 2 report's "remaining ambiguities").
    // The source uses two visually near-identical bullet characters
    // interchangeably (fullwidth ・ U+30FB on most sections, halfwidth ･
    // U+FF65 on the airtightness section) — both accepted here. The
    // trickier quirk: the workbook places a topic's Japanese heading line
    // on the *last* row of the PRECEDING section (one row before that
    // topic's own "Main page" anchor), so a naive scan of a whole
    // section's range can pick up the *next* topic's Japanese heading
    // instead of its own. Restricting the search to a window right after
    // the section's own start row avoids that bleed-over; within that
    // window the Korean line still reliably comes right after the
    // Japanese one (Phase 1 report §3), so the *last* match in the window
    // is preferred.
    const BULLET_RE = /^[・･•‧]/;
    const TITLE_SEARCH_WINDOW = 10;
    const bulletTitleMatches = rowsInSection
      .filter(
        ([ref, val]) => BULLET_RE.test(val) && val !== "#VALUE!" && splitCellRef(ref).row <= start + TITLE_SEARCH_WINDOW
      )
      .sort(([a], [b]) => splitCellRef(a).row - splitCellRef(b).row);
    const bulletTitle = bulletTitleMatches.at(-1);
    let title: string;
    if (bulletTitle) {
      title = bulletTitle[1].replace(BULLET_RE, "").trim();
    } else {
      const fallbackCandidates = rowsInSection
        .filter(([ref, val]) => {
          const { col, row } = splitCellRef(ref);
          return (
            row <= start + 2 &&
            colLettersToNum(col) <= 6 &&
            val !== "Main page" &&
            val !== "#VALUE!" &&
            !/^\d+$/.test(val)
          );
        })
        .sort(([a], [b]) => splitCellRef(a).row - splitCellRef(b).row);
      title = fallbackCandidates.length > 0 ? fallbackCandidates[fallbackCandidates.length - 1][1] : `섹션 (행 ${start})`;
    }

    const bodyParts: string[] = [];
    const errorCells: string[] = [];
    for (const [ref, val] of rowsInSection) {
      const { col } = splitCellRef(ref);
      if (col === "A") continue; // "Main page" nav link / row-marker column
      if (val === "Main page") continue;
      if (val === "#VALUE!") {
        errorCells.push(ref);
        continue;
      }
      if (/^\d+$/.test(val) && val.length <= 4) continue; // bare cross-reference IDs (Phase 1 report §4/§6) — not instructional content
      if (val === title || val.replace(BULLET_RE, "").trim() === title) continue; // the title line itself (bulleted or not)
      bodyParts.push(val);
    }

    for (const ref of errorCells) {
      issues.push({
        severity: "WARNING",
        issueType: "FORMULA_ERROR",
        message: `셀 ${ref}이(가) #VALUE! 수식 오류를 포함하고 있어 해당 항목의 내용을 가져오지 못했습니다.`,
        sourceWorksheet: sheet.name,
        sourceReference: ref,
      });
    }

    const instructions = bodyParts.join(" ").trim();
    const measurement = extractMeasurement(instructions);
    const sourceCellRange = `A${start}:${lastCol}${end}`;
    const sectionCode = `${nodeCode}-sec${i + 1}`;

    const item: ExtractedChecklistItem = {
      itemCode: `${sectionCode}-1`,
      title,
      instructions: instructions || null,
      required: true,
      sortOrder: 0,
      sourceCellRange,
      ...measurement,
    };

    sections.push({
      nodeCode,
      sectionCode,
      title,
      sortOrder: sections.length,
      sourceWorksheet: sheet.name,
      sourceCellRange,
      items: [item],
    });
  }

  const node: ExtractedNode = {
    nodeCode,
    nodeType: "CHECKLIST",
    title: sheet.name.replace(/^\(MB\)\s*/, ""),
    description: `${sections.length}개 섹션으로 구성된 검사 체크리스트 (원본: ${sheet.name}).`,
    positionX: 0,
    positionY: 0,
    sortOrder: 0,
    sourceWorksheet: sheet.name,
    sourceShapeId: null,
    sourceCellRange: worksheet.dimension,
  };

  return { node, sections, issues };
}
