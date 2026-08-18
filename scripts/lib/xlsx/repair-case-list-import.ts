import type { ParsedCellMetadata, WorkbookStyles } from "./ooxml-parser";
import type { LoadedSheet, LoadedWorkbook } from "./workbook-loader";

export const REPAIR_CASE_IMPORT_SHEET = "목록";
export const REPAIR_CASE_IMPORT_FIRST_ROW = 4;
export const REPAIR_CASE_IMPORT_DATE_MINIMUM = "2000-01-01";

const COLUMNS = "ABCDEFGHIJKLMNOPQRSTUVWXY".split("");
const EXPECTED_HEADERS: Readonly<Record<string, string>> = {
  A: "번호バンゴウ",
  B: "인수 번호ヒキトリ",
  C: "인수일ハッコウビ",
  D: "고객처",
  E: "End_User",
  F: "제품",
  G: "型式カタシキ",
  H: "L/N",
  // Blank in the legacy workbook: same-L/N historical receipt count, never an import field.
  I: "",
  J: "S/N",
  K: "DSS 견적번호",
  L: "발주현황(유.무상)",
  M: "선적일(여부)",
  N: "납입일(여부)→고객",
  O: "수리보고서",
  P: "세금계산서발행",
  Q: "기재자キサイシャ",
  R: "장소",
  S: "고객반출사유備考(原因)ビコウゲンイン",
  T: "교산출하일",
  U: "인수검사 완료 / P.O 발행 후 통전 예정",
  V: "점검 완료일 (예상)",
  W: "수리완료일(예상)",
  X: "담당자",
  Y: "수리소 출하확인",
};

export type RepairCaseImportSeverity = "WARNING" | "REVIEW" | "ERROR";

export type RepairCaseImportIssue = {
  code: string;
  severity: RepairCaseImportSeverity;
  rowNumber?: number;
  cellAddress?: string;
};

export type RepairCaseRawCell = {
  value: string | null;
  metadata: ParsedCellMetadata | null;
};

export type RepairCaseNormalizedCandidate = {
  legacyReportNumber: string | null;
  intakeNumber: string | null;
  receivedDate: string | null;
  customerName: string | null;
  endUserName: string | null;
  productName: string | null;
  modelName: string | null;
  lotNumber: string | null;
  serialNumber: string | null;
  billingType: "PAID" | "PARTIAL_PAID" | "WARRANTY" | "PENDING_DECISION";
  status: RepairCaseLegacyStatusCandidate | null;
  legacyDisposition: "COMPLETED" | "IN_PROGRESS" | null;
  actualShipmentDate: string | null;
  legacyNotes: string | null;
  legacyBusinessColor: LegacyBusinessColor;
};

export type LegacyBusinessColor =
  | "BUSINESS_WHITE"
  | "BUSINESS_YELLOW"
  | "BUSINESS_COLOR_REQUIRES_REVIEW";

export type RepairCaseLegacyStatusCandidate =
  | "WAITING_INTAKE_INSPECTION"
  | "WAITING_PO"
  | "WAITING_PARTS_SUPPLY"
  | "IN_REPAIR"
  | "WAITING_SHIPMENT"
  | "SHIPMENT_COMPLETED";

export type RepairCaseImportRow = {
  sourceSheet: typeof REPAIR_CASE_IMPORT_SHEET;
  sourceRowNumber: number;
  rawCells: Record<string, RepairCaseRawCell>;
  normalized: RepairCaseNormalizedCandidate;
  /**
   * Source parsing readiness only. SOURCE_READY never means DB masters,
   * workflow selection, or existing-record duplicate checks are resolved;
   * a future UI must compute a separate IMPORT_READY state.
   */
  sourceClassification: "SOURCE_READY" | "SOURCE_REVIEW";
  issues: RepairCaseImportIssue[];
};

export type RepairCaseListParseResult =
  | {
      ok: true;
      sourceSheet: typeof REPAIR_CASE_IMPORT_SHEET;
      headerValid: true;
      totalDataRowsConsidered: number;
      blankRowsSkipped: number;
      rows: RepairCaseImportRow[];
      issues: RepairCaseImportIssue[];
    }
  | {
      ok: false;
      sourceSheet: typeof REPAIR_CASE_IMPORT_SHEET;
      headerValid: false;
      issues: RepairCaseImportIssue[];
    };

export type RepairCaseListParseOptions = {
  /** ISO calendar date supplied by the caller; the pure parser never reads today's clock. */
  referenceDate: string;
};

function normalizeHeader(value: string | null): string {
  return (value ?? "").replace(/[\r\n\t ]+/g, " ").trim();
}

function sourceTextToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function trimToNull(value: string | null): string | null {
  const trimmed = sourceTextToNull(value) ?? "";
  return trimmed && trimmed !== "-" ? trimmed : null;
}

function columnNumber(letters: string): number {
  let result = 0;
  for (const char of letters) result = result * 26 + char.charCodeAt(0) - 64;
  return result;
}

function worksheetLastRow(sheet: LoadedSheet): number {
  let last = 3;
  const refs = new Set([
    ...Object.keys(sheet.worksheet.cells),
    ...Object.keys(sheet.worksheet.cellMetadata ?? {}),
  ]);
  for (const ref of refs) {
    const match = ref.match(/^[A-Z]+(\d+)$/);
    if (match) last = Math.max(last, Number(match[1]));
  }
  return last;
}

function metadataFor(sheet: LoadedSheet, ref: string): ParsedCellMetadata | null {
  return sheet.worksheet.cellMetadata?.[ref] ?? null;
}

function hasUsableCellValue(sheet: LoadedSheet, ref: string): boolean {
  return sourceTextToNull(sheet.worksheet.cells[ref] ?? null) !== null;
}

function rawCellsForRow(sheet: LoadedSheet, rowNumber: number): Record<string, RepairCaseRawCell> {
  return Object.fromEntries(
    COLUMNS.map((column) => {
      const ref = `${column}${rowNumber}`;
      return [column, { value: sheet.worksheet.cells[ref] ?? null, metadata: metadataFor(sheet, ref) }];
    })
  );
}

function isDateFormatCode(code: string): boolean {
  const stripped = code
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[[^\]]*]/g, "")
    .replace(/_.|\*./g, "")
    .toLowerCase();
  return /[ymd]/.test(stripped);
}

export function isDateLikeStyle(styleIndex: number | null, styles?: WorkbookStyles): boolean {
  if (styleIndex === null || !styles) return false;
  const numFmtId = styles.cellXfsNumFmtIds[styleIndex];
  if (numFmtId === undefined) return false;
  if ((numFmtId >= 14 && numFmtId <= 22) || (numFmtId >= 45 && numFmtId <= 47)) return true;
  const custom = styles.customNumberFormats[numFmtId];
  return custom ? isDateFormatCode(custom) : false;
}

export function excelSerialToDateOnly(
  serial: number,
  dateSystem: "1900" | "1904"
): string | null {
  if (!Number.isFinite(serial) || serial < 0) return null;
  const wholeDays = Math.floor(serial);
  if (dateSystem === "1900" && wholeDays === 60) return null; // Excel's fictional 1900-02-29.
  const epoch = dateSystem === "1904" ? Date.UTC(1904, 0, 1) : Date.UTC(1900, 0, 1);
  const dayOffset = dateSystem === "1904" ? wholeDays : wholeDays - (wholeDays > 60 ? 2 : 1);
  const date = new Date(epoch + dayOffset * 86_400_000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function repairCaseImportDateMaximum(referenceDate: string): string {
  const parsed = parseIsoDateParts(referenceDate);
  if (!parsed || !isValidCalendarDate(parsed.year, parsed.month, parsed.day)) {
    throw new Error("referenceDate must be a valid YYYY-MM-DD calendar date");
  }
  const targetYear = parsed.year + 1;
  const lastDay = new Date(Date.UTC(targetYear, parsed.month, 0)).getUTCDate();
  return formatDate(targetYear, parsed.month, Math.min(parsed.day, lastDay));
}

type ReceivedDateIssueCode =
  | "RECEIVED_DATE_PARTIAL"
  | "RECEIVED_DATE_TWO_DIGIT_YEAR"
  | "RECEIVED_DATE_INVALID_CALENDAR_DATE"
  | "RECEIVED_DATE_SERIAL_OUT_OF_RANGE"
  | "RECEIVED_DATE_UNINTERPRETABLE";

type NormalizedReceivedDate =
  | { value: string; issueCode: null }
  | { value: null; issueCode: ReceivedDateIssueCode };

function parseIsoDateParts(value: string): { year: number; month: number; day: number } | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeDate(
  cell: RepairCaseRawCell,
  dateSystem: "1900" | "1904",
  maximumDate: string
): NormalizedReceivedDate {
  const value = trimToNull(cell.value);
  if (!value) return { value: null, issueCode: "RECEIVED_DATE_UNINTERPRETABLE" };

  const compact = value.replace(/[\r\n\t ]+/g, " ").trim();
  const punctuationDate = compact.match(
    /^(\d{4})\s*([.\/-])\s*(\d{1,2})\s*\2\s*(\d{1,2})\s*\.?$/
  );
  const koreanDate = compact.match(/^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*\.?$/);
  const fullDate = punctuationDate
    ? { year: Number(punctuationDate[1]), month: Number(punctuationDate[3]), day: Number(punctuationDate[4]) }
    : koreanDate
      ? { year: Number(koreanDate[1]), month: Number(koreanDate[2]), day: Number(koreanDate[3]) }
      : null;
  if (fullDate) {
    return isValidCalendarDate(fullDate.year, fullDate.month, fullDate.day)
      ? { value: formatDate(fullDate.year, fullDate.month, fullDate.day), issueCode: null }
      : { value: null, issueCode: "RECEIVED_DATE_INVALID_CALENDAR_DATE" };
  }

  if (
    /^\d{2}\s*[.\/-]\s*\d{1,2}\s*[.\/-]\s*\d{1,2}\s*\.?$/.test(compact) ||
    /^\d{2}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일\s*\.?$/.test(compact)
  ) {
    return { value: null, issueCode: "RECEIVED_DATE_TWO_DIGIT_YEAR" };
  }
  if (
    /^\d{4}\s*(?:[.\/-]|년)\s*\d{1,2}\s*(?:월)?\s*\.?$/.test(compact) ||
    /^\d{1,2}\s*(?:[.\/-]|월)\s*\d{1,2}\s*(?:일)?\s*\.?$/.test(compact)
  ) {
    return { value: null, issueCode: "RECEIVED_DATE_PARTIAL" };
  }

  const numericType = cell.metadata?.cellType === "n";
  const numericCandidate = /^\d+$/.test(value) && Number.isSafeInteger(Number(value));
  if (numericType && numericCandidate) {
    const serial = Number(value);
    if (dateSystem === "1900" && serial === 60) {
      return { value: null, issueCode: "RECEIVED_DATE_INVALID_CALENDAR_DATE" };
    }
    const converted = excelSerialToDateOnly(serial, dateSystem);
    if (
      converted &&
      converted >= REPAIR_CASE_IMPORT_DATE_MINIMUM &&
      converted <= maximumDate
    ) {
      return { value: converted, issueCode: null };
    }
    return { value: null, issueCode: "RECEIVED_DATE_SERIAL_OUT_OF_RANGE" };
  }
  if (numericType) return { value: null, issueCode: "RECEIVED_DATE_SERIAL_OUT_OF_RANGE" };
  return { value: null, issueCode: "RECEIVED_DATE_UNINTERPRETABLE" };
}

function normalizeIdentityCell(
  cell: RepairCaseRawCell,
  cellAddress: string,
  issues: RepairCaseImportIssue[],
  styles?: WorkbookStyles
): string | null {
  const value = trimToNull(cell.value);
  if (!value) return null;
  if (!cell.metadata || cell.metadata.cellType === "s" || cell.metadata.cellType === "inlineStr" || cell.metadata.cellType === "str") {
    return value;
  }
  const rawValue = sourceTextToNull(cell.metadata.rawValue) ?? value;
  const styleIndex = cell.metadata.styleIndex;
  const numFmtId = styleIndex === null || !styles
    ? null
    : styles.cellXfsNumFmtIds[styleIndex] ?? null;
  const customFormat = numFmtId === null ? null : styles?.customNumberFormats[numFmtId] ?? null;
  const strippedFormat = customFormat
    ?.split(";")[0]
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[[^\]]*]/g, "")
    .replace(/_.|\*./g, "") ?? null;
  const unsafeFormat =
    (numFmtId !== null && ![0, 1, 49].includes(numFmtId) && !customFormat) ||
    (strippedFormat !== null &&
      ((strippedFormat.match(/0/g) ?? []).length > 1 || /[Ee.,#?]/.test(strippedFormat)));
  const safeIntegerText = /^\d{1,15}$/.test(rawValue);
  if (!safeIntegerText || unsafeFormat) {
    issues.push({ code: "NUMERIC_IDENTITY_FORMAT_RISK", severity: "REVIEW", cellAddress });
    return null;
  }
  issues.push({ code: "NUMERIC_IDENTITY_NORMALIZED", severity: "WARNING", cellAddress });
  return rawValue;
}

/**
 * Legacy report numbers are identifiers, never counters. Numeric cells use
 * only an explicit all-zero display format (for example `0000`) to restore
 * visible leading zeroes; no year/length/sequence rule is imposed.
 */
function normalizeLegacyReportNumber(
  cell: RepairCaseRawCell,
  cellAddress: string,
  issues: RepairCaseImportIssue[],
  styles?: WorkbookStyles
): string | null {
  const value = sourceTextToNull(cell.value);
  if (!value) return null;
  const type = cell.metadata?.cellType;
  if (!cell.metadata || type === "s" || type === "inlineStr" || type === "str") return value.trim();

  const raw = sourceTextToNull(cell.metadata.rawValue) ?? value;
  const styleIndex = cell.metadata.styleIndex;
  const numFmtId = styleIndex === null || !styles ? null : styles.cellXfsNumFmtIds[styleIndex] ?? null;
  const custom = numFmtId === null ? null : styles?.customNumberFormats[numFmtId] ?? null;
  const primaryFormat = custom
    ?.split(";")[0]
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[[^\]]*]/g, "")
    .replace(/_.|\*./g, "")
    .trim() ?? null;
  if (/^\d+$/.test(raw) && primaryFormat && /^0+$/.test(primaryFormat)) {
    return raw.padStart(primaryFormat.length, "0");
  }
  if (!/^\d{1,15}$/.test(raw)) {
    issues.push({ code: "LEGACY_REPORT_NUMBER_FORMAT_RISK", severity: "WARNING", cellAddress });
  }
  return value.trim();
}

function normalizeBilling(
  value: string | null
): "PAID" | "PARTIAL_PAID" | "WARRANTY" | "PENDING_DECISION" {
  const normalized = (value ?? "").normalize("NFKC").replace(/[\s._-]+/g, "").toLowerCase();
  if (normalized === "유상" || normalized === "paid") return "PAID";
  if (normalized === "일부유상" || normalized === "부분유상" || normalized === "partialpaid") {
    return "PARTIAL_PAID";
  }
  if (normalized === "무상" || normalized === "warranty" || normalized === "보증") return "WARRANTY";
  return "PENDING_DECISION";
}

const STATUS_PATTERNS: ReadonlyArray<[RepairCaseLegacyStatusCandidate, RegExp]> = [
  ["WAITING_INTAKE_INSPECTION", /(?:인수\s*)?(?:검사|점검)\s*(?:중|완료|대기|예정)/],
  ["WAITING_PO", /(?:p\s*\.?\s*o|po)\s*(?:발행\s*)?(?:대기|대기중|예정)/i],
  ["WAITING_PARTS_SUPPLY", /^부품\s*(?:수급\s*)?대기$/],
  ["IN_REPAIR", /수리\s*(?:중|진행)/],
  ["WAITING_SHIPMENT", /(?:출하|납품)\s*(?:대기|예정)/],
  ["SHIPMENT_COMPLETED", /(?:출하\s*(?:완료|완)|출고\s*완료|납품(?!\s*(?:대기|예정))(?:\s*완료)?)/],
];

/**
 * Versioned business rule for the approved legacy `목록` workbook only.
 * It must never leak into the generic OOXML renderer: theme=0 remains Dark 1.
 */
export function legacyBusinessColor(cell: RepairCaseRawCell): LegacyBusinessColor {
  const fill = cell.metadata?.fill;
  if (!fill || fill.fillId === 0 || !fill.patternType || fill.patternType === "none") return "BUSINESS_WHITE";
  const foreground = fill.foreground;
  const rgb = foreground?.resolvedRgb?.toUpperCase() ?? null;
  if (fill.patternType === "solid" && rgb === "FFFF00") return "BUSINESS_YELLOW";
  const exactLegacyWhite =
    fill.fillId === 5 &&
    fill.patternType === "solid" &&
    foreground?.source === "theme" &&
    foreground.value === "0" &&
    foreground.tint === null &&
    fill.background?.source === "indexed" &&
    fill.background.value === "64" &&
    fill.cellXfApplyFill === true &&
    fill.cellXfId === 0;
  return exactLegacyWhite ? "BUSINESS_WHITE" : "BUSINESS_COLOR_REQUIRES_REVIEW";
}

const FULL_YEAR_DATE_PATTERN = /(?:19|20)\d{2}\s*(?:년\s*|[.\/-]\s*)\d{1,2}\s*(?:월\s*|[.\/-]\s*)\d{1,2}\s*(?:일)?/g;
const LOOSE_DATE_PATTERN = /\d{1,4}\s*[.\/-]\s*\d{1,2}(?:\s*[.\/-]\s*\d{1,2})?/g;

function parseLegacyDateToken(token: string): string | null {
  const numbers = token.match(/\d+/g)?.map(Number) ?? [];
  if (numbers.length !== 3 || numbers[0] < 1900 || numbers[0] > 9999) return null;
  return isValidCalendarDate(numbers[0], numbers[1], numbers[2])
    ? formatDate(numbers[0], numbers[1], numbers[2])
    : null;
}

function notesWithoutDate(source: string, dateSpan: { index: number; length: number } | null): string | null {
  if (!dateSpan) return trimToNull(source);
  const joined = `${source.slice(0, dateSpan.index)} ${source.slice(dateSpan.index + dateSpan.length)}`
    .replace(/^[\s/|,;:-]+|[\s/|,;:-]+$/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
  return joined || null;
}

function normalizeLegacyStatus(
  rawCells: Record<string, RepairCaseRawCell>,
  styles: WorkbookStyles | undefined,
  dateSystem: "1900" | "1904"
): {
  candidate: RepairCaseLegacyStatusCandidate | null;
  disposition: "COMPLETED" | "IN_PROGRESS" | null;
  shipmentDate: string | null;
  notes: string | null;
  businessColor: LegacyBusinessColor;
  issues: Array<{ code: string; severity: RepairCaseImportSeverity }>;
} {
  const source = sourceTextToNull(rawCells.U.value) ?? "";
  const canonicalSource = source.normalize("NFKC");
  const normalized = canonicalSource.replace(/[\t\r\n ]+/g, " ").trim();
  const explicit = STATUS_PATTERNS.filter(([, pattern]) => pattern.test(normalized)).map(([candidate]) => candidate);
  const explicitCandidates = [...new Set(explicit)];
  const numericDateCell = rawCells.U.metadata?.cellType === "n"
    && /^\d+(?:\.\d+)?$/.test(rawCells.U.metadata.rawValue ?? "")
    && isDateLikeStyle(rawCells.U.metadata.styleIndex, styles);
  const numericDate = numericDateCell
    ? excelSerialToDateOnly(Number(rawCells.U.metadata?.rawValue), dateSystem)
    : null;
  const fullMatches = numericDateCell ? [] : [...canonicalSource.matchAll(FULL_YEAR_DATE_PATTERN)];
  const fullTokens = fullMatches.map((match) => match[0]);
  const looseTokens = [...canonicalSource.matchAll(LOOSE_DATE_PATTERN)].map((match) => match[0]);
  const validDates = numericDate ? [numericDate] : fullTokens.map(parseLegacyDateToken).filter((value): value is string => value !== null);
  const hasMultipleDates = fullTokens.length > 1 || looseTokens.length > 1;
  const hasUninterpretableDate = !hasMultipleDates && (numericDateCell || looseTokens.length > 0 || fullTokens.length > 0) && validDates.length !== 1;
  const safeDate = !hasMultipleDates && !hasUninterpretableDate && validDates.length === 1 ? validDates[0] : null;
  const businessColor = legacyBusinessColor(rawCells.U);
  const issues: Array<{ code: string; severity: RepairCaseImportSeverity }> = [];

  if (hasMultipleDates) issues.push({ code: "SHIPMENT_DATE_MULTIPLE", severity: "REVIEW" });
  if (hasUninterpretableDate) issues.push({ code: "SHIPMENT_DATE_UNINTERPRETABLE", severity: "REVIEW" });
  if (businessColor === "BUSINESS_COLOR_REQUIRES_REVIEW") {
    issues.push({ code: "BUSINESS_COLOR_REQUIRES_REVIEW", severity: "REVIEW" });
  }

  let candidate: RepairCaseLegacyStatusCandidate | null = null;
  let disposition: "COMPLETED" | "IN_PROGRESS" | null = null;
  if (businessColor === "BUSINESS_WHITE") {
    candidate = "SHIPMENT_COMPLETED";
    disposition = "COMPLETED";
  } else if (businessColor === "BUSINESS_YELLOW") {
    disposition = "IN_PROGRESS";
    const ongoing = explicitCandidates.filter((value) => value !== "SHIPMENT_COMPLETED");
    candidate = ongoing.length === 1 ? ongoing[0] : null;
  }

  if (disposition === "COMPLETED" && !safeDate && !hasMultipleDates && !hasUninterpretableDate) {
    issues.push({ code: "SHIPMENT_DATE_NOT_AVAILABLE", severity: "WARNING" });
  }
  return {
    candidate,
    disposition,
    shipmentDate: disposition === "COMPLETED" ? safeDate : null,
    notes: hasMultipleDates || hasUninterpretableDate
      ? trimToNull(source)
      : numericDateCell
        ? null
        : notesWithoutDate(source, fullMatches.length === 1 && fullMatches[0].index !== undefined
          ? { index: fullMatches[0].index, length: fullMatches[0][0].length }
          : null),
    businessColor,
    issues,
  };
}

function containsMultipleDates(value: string): boolean {
  return (value.match(/\d{1,4}[.\/-]\d{1,2}(?:[.\/-]\d{1,2})?/g) ?? []).length > 1;
}

function validateHeader(sheet: LoadedSheet): RepairCaseImportIssue[] {
  const issues: RepairCaseImportIssue[] = [];
  for (const column of COLUMNS) {
    const ref = `${column}3`;
    const actual = normalizeHeader(sheet.worksheet.cells[ref] ?? null);
    const expected = normalizeHeader(EXPECTED_HEADERS[column]);
    if (actual !== expected) {
      issues.push({ code: "HEADER_MISMATCH", severity: "ERROR", rowNumber: 3, cellAddress: ref });
    }
  }
  return issues;
}

export function parseRepairCaseListWorkbook(
  workbook: LoadedWorkbook,
  options: RepairCaseListParseOptions
): RepairCaseListParseResult {
  const sheet = workbook.sheets.find((candidate) => candidate.name === REPAIR_CASE_IMPORT_SHEET);
  if (!sheet) {
    return {
      ok: false,
      sourceSheet: REPAIR_CASE_IMPORT_SHEET,
      headerValid: false,
      issues: [{ code: "REQUIRED_SHEET_MISSING", severity: "ERROR" }],
    };
  }

  const headerIssues = validateHeader(sheet);
  if (headerIssues.length > 0) {
    return { ok: false, sourceSheet: REPAIR_CASE_IMPORT_SHEET, headerValid: false, issues: headerIssues };
  }

  const rows: RepairCaseImportRow[] = [];
  const workbookIssues: RepairCaseImportIssue[] = [];
  let blankRowsSkipped = 0;
  const lastRow = worksheetLastRow(sheet);
  const dateSystem = workbook.dateSystem ?? "1900";
  const maximumDate = repairCaseImportDateMaximum(options.referenceDate);
  const outsideRefsByRow = new Map<number, string[]>();
  const allRefs = new Set([
    ...Object.keys(sheet.worksheet.cells),
    ...Object.keys(sheet.worksheet.cellMetadata ?? {}),
  ]);
  for (const ref of allRefs) {
    const match = ref.match(/^([A-Z]+)(\d+)$/);
    if (!match || columnNumber(match[1]) <= 25 || !hasUsableCellValue(sheet, ref)) continue;
    const rowNumber = Number(match[2]);
    outsideRefsByRow.set(rowNumber, [...(outsideRefsByRow.get(rowNumber) ?? []), ref]);
  }

  for (let rowNumber = REPAIR_CASE_IMPORT_FIRST_ROW; rowNumber <= lastRow; rowNumber++) {
    const rawCells = rawCellsForRow(sheet, rowNumber);
    const hasImportData = COLUMNS.some(
      (column) => sourceTextToNull(rawCells[column].value) !== null
    );
    for (const ref of outsideRefsByRow.get(rowNumber) ?? []) {
      workbookIssues.push({
        code: "UNEXPECTED_DATA_OUTSIDE_IMPORT_RANGE",
        severity: "WARNING",
        rowNumber,
        cellAddress: ref,
      });
    }
    if (!hasImportData) {
      blankRowsSkipped++;
      continue;
    }

    const issues: RepairCaseImportIssue[] = [];
    const legacyReportNumber = normalizeLegacyReportNumber(
      rawCells.A,
      `A${rowNumber}`,
      issues,
      workbook.styles
    );
    const intakeRaw = trimToNull(rawCells.B.value);
    const intakeNumber = intakeRaw?.toUpperCase() ?? null;
    if (
      sourceTextToNull(rawCells.B.value) &&
      !/^D\d{2}(?:0[1-9]|1[0-2])\d{2}$/.test(intakeNumber ?? "")
    ) {
      issues.push({ code: "INTAKE_NUMBER_MALFORMED", severity: "REVIEW", rowNumber, cellAddress: `B${rowNumber}` });
    }

    const receivedDateResult = normalizeDate(rawCells.C, dateSystem, maximumDate);
    const receivedDate = receivedDateResult.value;
    if (!receivedDate && sourceTextToNull(rawCells.C.value)) {
      issues.push({
        code: receivedDateResult.issueCode ?? "RECEIVED_DATE_UNINTERPRETABLE",
        severity: "REVIEW",
        rowNumber,
        cellAddress: `C${rowNumber}`,
      });
    }
    for (const requiredFormulaColumn of ["B", "C"]) {
      const cell = rawCells[requiredFormulaColumn];
      if (cell.metadata?.formula !== null && cell.metadata?.formula !== undefined && !cell.metadata.cachedFormulaValue) {
        issues.push({ code: "REQUIRED_FORMULA_CACHE_MISSING", severity: "REVIEW", rowNumber, cellAddress: `${requiredFormulaColumn}${rowNumber}` });
      }
    }

    for (const [column, code] of [
      ["D", "CUSTOMER_MAPPING_PENDING"],
      ["E", "END_USER_MAPPING_PENDING"],
      ["G", "PRODUCT_MODEL_MAPPING_PENDING"],
    ] as const) {
      if (trimToNull(rawCells[column].value)) {
        issues.push({ code, severity: "WARNING", rowNumber, cellAddress: `${column}${rowNumber}` });
      }
    }

    const lotNumber = normalizeIdentityCell(rawCells.H, `H${rowNumber}`, issues, workbook.styles);
    const serialNumber = normalizeIdentityCell(rawCells.J, `J${rowNumber}`, issues, workbook.styles);

    const billingSource = sourceTextToNull(rawCells.L.value);
    const billingRaw = trimToNull(rawCells.L.value);
    const billingType = normalizeBilling(billingRaw);
    if (!billingSource) {
      issues.push({ code: "BILLING_PENDING_EMPTY", severity: "WARNING", rowNumber, cellAddress: `L${rowNumber}` });
    } else if (billingType === "PENDING_DECISION") {
      issues.push({ code: "BILLING_PENDING_UNRESOLVED", severity: "WARNING", rowNumber, cellAddress: `L${rowNumber}` });
    }

    const status = normalizeLegacyStatus(rawCells, workbook.styles, dateSystem);
    for (const issue of status.issues) issues.push({ ...issue, rowNumber, cellAddress: `U${rowNumber}` });
    if (status.candidate) issues.push({ code: "STATUS_MAPPING_PENDING", severity: "WARNING", rowNumber, cellAddress: `U${rowNumber}` });
    for (const column of COLUMNS.slice(10)) {
      if (column === "U") continue;
      const value = trimToNull(rawCells[column].value);
      if (value && containsMultipleDates(value)) {
        issues.push({ code: "MULTIPLE_DATES_IN_CELL", severity: "REVIEW", rowNumber, cellAddress: `${column}${rowNumber}` });
      }
    }
    if (sourceTextToNull(rawCells.X.value)) {
      issues.push({ code: "ASSIGNEE_MAPPING_PENDING", severity: "WARNING", rowNumber, cellAddress: `X${rowNumber}` });
    }

    rows.push({
      sourceSheet: REPAIR_CASE_IMPORT_SHEET,
      sourceRowNumber: rowNumber,
      rawCells,
      normalized: {
        legacyReportNumber,
        intakeNumber: /^D\d{2}(?:0[1-9]|1[0-2])\d{2}$/.test(intakeNumber ?? "") ? intakeNumber : null,
        receivedDate,
        customerName: trimToNull(rawCells.D.value),
        endUserName: trimToNull(rawCells.E.value),
        productName: trimToNull(rawCells.F.value),
        modelName: trimToNull(rawCells.G.value),
        lotNumber,
        serialNumber,
        billingType,
        status: status.candidate,
        legacyDisposition: status.disposition,
        actualShipmentDate: status.shipmentDate,
        legacyNotes: status.notes,
        legacyBusinessColor: status.businessColor,
      },
      sourceClassification: issues.some((issue) => issue.severity === "REVIEW")
        ? "SOURCE_REVIEW"
        : "SOURCE_READY",
      issues,
    });
  }

  const duplicateGroups = new Map<string, RepairCaseImportRow[]>();
  for (const row of rows) {
    if (!row.normalized.intakeNumber) continue;
    const group = duplicateGroups.get(row.normalized.intakeNumber) ?? [];
    group.push(row);
    duplicateGroups.set(row.normalized.intakeNumber, group);
  }
  for (const group of duplicateGroups.values()) {
    if (group.length < 2) continue;
    for (const row of group) {
      row.issues.push({ code: "INTAKE_NUMBER_DUPLICATED", severity: "REVIEW", rowNumber: row.sourceRowNumber, cellAddress: `B${row.sourceRowNumber}` });
      row.sourceClassification = "SOURCE_REVIEW";
    }
  }

  return {
    ok: true,
    sourceSheet: REPAIR_CASE_IMPORT_SHEET,
    headerValid: true,
    totalDataRowsConsidered: Math.max(0, lastRow - REPAIR_CASE_IMPORT_FIRST_ROW + 1),
    blankRowsSkipped,
    rows,
    issues: workbookIssues,
  };
}
