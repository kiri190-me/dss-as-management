import { createHash } from "node:crypto";

export const EXCEL_IMPORT_SOURCE_SHEET = "목록" as const;
export const EXCEL_IMPORT_FIRST_SOURCE_ROW = 4;
export const EXCEL_IMPORT_MAX_ROWS = 10_000;
export const EXCEL_IMPORT_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const EXCEL_IMPORT_MAX_CELL_TEXT_LENGTH = 32_767;
export const EXCEL_IMPORT_PREVIEW_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const REPAIR_CASE_SOURCE_ROW_FINGERPRINT_VERSION =
  "repair-case-list-source-row-v3";

export const EXCEL_IMPORT_COLUMNS = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
  "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y",
] as const;

type ExcelImportColumn = (typeof EXCEL_IMPORT_COLUMNS)[number];
type SourceClassification = "SOURCE_READY" | "SOURCE_REVIEW";
type IssueSeverity = "WARNING" | "REVIEW" | "ERROR";

export type ExcelImportRawCellInput = {
  value: string | null;
  metadata: {
    cellType: string;
    rawValue: string | null;
    cachedFormulaValue: string | null;
    formula: string | null;
    styleIndex: number | null;
    fill?: {
      fillId: number;
      patternType: string | null;
      foreground: { source: "rgb" | "indexed" | "theme" | "auto"; value: string; tint: number | null; resolvedRgb: string | null } | null;
      background: { source: "rgb" | "indexed" | "theme" | "auto"; value: string; tint: number | null; resolvedRgb: string | null } | null;
      cellXfApplyFill?: boolean | null;
      cellXfId?: number | null;
    } | null;
  } | null;
};

export type ExcelImportNormalizedCandidateInput = {
  legacyReportNumber?: string | null;
  intakeNumber: string | null;
  receivedDate: string | null;
  customerName: string | null;
  endUserName: string | null;
  productName: string | null;
  modelName: string | null;
  lotNumber: string | null;
  serialNumber: string | null;
  billingType: "PAID" | "PARTIAL_PAID" | "WARRANTY" | "PENDING_DECISION" | null;
  status:
    | "WAITING_INTAKE_INSPECTION"
    | "WAITING_PO"
    | "WAITING_PARTS_SUPPLY"
    | "IN_REPAIR"
    | "WAITING_SHIPMENT"
    | "SHIPMENT_COMPLETED"
    | null;
  legacyDisposition?: "COMPLETED" | "IN_PROGRESS" | null;
  actualShipmentDate?: string | null;
  legacyNotes?: string | null;
  legacyBusinessColor?: "BUSINESS_WHITE" | "BUSINESS_YELLOW" | "BUSINESS_COLOR_REQUIRES_REVIEW";
};

export type ExcelImportIssueInput = {
  code: string;
  severity: IssueSeverity;
  rowNumber?: number;
  cellAddress?: string;
};

export type ExcelImportParsedRowInput = {
  sourceSheet: string;
  sourceRowNumber: number;
  rawCells: Record<string, ExcelImportRawCellInput>;
  normalized: ExcelImportNormalizedCandidateInput;
  sourceClassification: SourceClassification;
  issues: ExcelImportIssueInput[];
};

export type ExcelImportSafetyInput = {
  ok: boolean;
  issues: Array<{ code: string; severity: "ERROR" | "WARNING" }>;
};

export type ExcelImportParseInput = {
  ok: boolean;
  sourceSheet: string;
  headerValid: boolean;
  totalDataRowsConsidered?: number;
  blankRowsSkipped?: number;
  rows?: ExcelImportParsedRowInput[];
  issues: ExcelImportIssueInput[];
};

export type ExcelImportPreviewBoundaryInput = {
  sourceFileSha256: string;
  parserVersion: string;
  sourceSheet: string;
  headerFingerprint: string;
  originalFileName: string;
  fileSizeBytes: number;
  mimeType: string;
  uploadedBy: string;
  now: Date;
  safetyValidation: ExcelImportSafetyInput;
  parsedPreview: ExcelImportParseInput;
  resetExpiredBatchId?: string;
  refreshExistingBatchId?: string;
  expectedBatchVersion?: number;
  confirmExpiredReset?: boolean;
  confirmParserRefresh?: boolean;
};

export type ExcelImportIssueDto = {
  code: string;
  severity: "WARNING" | "REVIEW";
  rowNumber: number;
  cellAddress?: string;
};

export type ExcelImportRawDataDto = {
  schemaVersion: "repair-case-list-raw-row-v3";
  columns: Record<ExcelImportColumn, ExcelImportRawCellInput>;
};

export type ExcelImportNormalizedDataDto = {
  schemaVersion: "repair-case-list-normalized-candidate-v3";
  candidate: ExcelImportNormalizedCandidateInput;
};

export type ExcelImportPreviewRowDto = {
  sourceSheet: typeof EXCEL_IMPORT_SOURCE_SHEET;
  sourceRowNumber: number;
  sourceRowFingerprint: string;
  rawData: ExcelImportRawDataDto;
  normalizedData: ExcelImportNormalizedDataDto;
  issues: ExcelImportIssueDto[];
  sourceClassification: SourceClassification;
  importStatus: "PENDING_REVIEW" | "MAPPING_REQUIRED" | "IMPORT_READY";
};

export type ExcelImportPreviewSummary = {
  schemaVersion: "repair-case-list-preview-summary-v1";
  totalDataRowsConsidered: number;
  blankRowsSkipped: number;
  persistedRows: number;
  sourceReadyRows: number;
  sourceReviewRows: number;
  warningIssues: number;
  reviewIssues: number;
  issueCodeCounts: Record<string, number>;
};

export type ValidatedExcelImportPreview = {
  metadata: {
    sourceFileSha256: string;
    parserVersion: string;
    sourceSheet: typeof EXCEL_IMPORT_SOURCE_SHEET;
    headerFingerprint: string;
    originalFileName: string;
    fileSizeBytes: number;
    mimeType: string;
    uploadedBy: string;
    now: Date;
  };
  rows: ExcelImportPreviewRowDto[];
  summary: ExcelImportPreviewSummary;
  batchStatus: "PREVIEWED" | "REVIEW_REQUIRED";
  reset:
    | null
    | {
        batchId: string;
        expectedVersion: number;
        confirmed: true;
      };
  refresh:
    | null
    | {
        batchId: string;
        expectedVersion: number;
        confirmed: true;
      };
};

export type ExcelImportPreviewValidationResult =
  | { ok: true; value: ValidatedExcelImportPreview }
  | { ok: false; code: "INVALID_PREVIEW_INPUT" };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const STABLE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,95}$/;
const MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function isNullableBoundedString(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" && value.length <= EXCEL_IMPORT_MAX_CELL_TEXT_LENGTH)
  );
}

function isValidRawCell(value: unknown): value is ExcelImportRawCellInput {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["value", "metadata"])) return false;
  if (!isNullableBoundedString(value.value)) return false;
  if (value.metadata === null) return true;
  if (
    !isPlainObject(value.metadata) ||
    !hasOnlyKeys(value.metadata, [
      "cellType",
      "rawValue",
      "cachedFormulaValue",
      "formula",
      "styleIndex",
      "fill",
    ])
  ) {
    return false;
  }
  const styleIndex = value.metadata.styleIndex;
  const fill = value.metadata.fill;
  const validColor = (color: unknown): boolean => color === null || (
    isPlainObject(color) &&
    hasOnlyKeys(color, ["source", "value", "tint", "resolvedRgb"]) &&
    ["rgb", "indexed", "theme", "auto"].includes(color.source as string) &&
    typeof color.value === "string" &&
    (color.tint === null || (typeof color.tint === "number" && Number.isFinite(color.tint))) &&
    (color.resolvedRgb === null || (typeof color.resolvedRgb === "string" && /^[0-9A-F]{6}$/.test(color.resolvedRgb)))
  );
  const validFill = fill === undefined || fill === null || (
    isPlainObject(fill) &&
    hasOnlyKeys(fill, ["fillId", "patternType", "foreground", "background", "cellXfApplyFill", "cellXfId"]) &&
    Number.isInteger(fill.fillId) && Number(fill.fillId) >= 0 &&
    (fill.patternType === null || typeof fill.patternType === "string") &&
    validColor(fill.foreground) && validColor(fill.background) &&
    (fill.cellXfApplyFill === undefined || fill.cellXfApplyFill === null || typeof fill.cellXfApplyFill === "boolean") &&
    (fill.cellXfId === undefined || fill.cellXfId === null || (Number.isInteger(fill.cellXfId) && Number(fill.cellXfId) >= 0))
  );
  return (
    typeof value.metadata.cellType === "string" &&
    value.metadata.cellType.length > 0 &&
    value.metadata.cellType.length <= 32 &&
    isNullableBoundedString(value.metadata.rawValue) &&
    isNullableBoundedString(value.metadata.cachedFormulaValue) &&
    isNullableBoundedString(value.metadata.formula) &&
    validFill &&
    (styleIndex === null ||
      (typeof styleIndex === "number" && Number.isInteger(styleIndex) && styleIndex >= 0))
  );
}

function isValidNormalizedCandidate(
  value: unknown
): value is ExcelImportNormalizedCandidateInput {
  const keys = [
    "intakeNumber",
    "legacyReportNumber",
    "receivedDate",
    "customerName",
    "endUserName",
    "productName",
    "modelName",
    "lotNumber",
    "serialNumber",
    "billingType",
    "status",
    "legacyDisposition",
    "actualShipmentDate",
    "legacyNotes",
    "legacyBusinessColor",
  ] as const;
  if (!isPlainObject(value) || !hasOnlyKeys(value, keys)) return false;
  if (!isNullableBoundedString(value.legacyReportNumber ?? null) ||
      !["intakeNumber", "receivedDate", "customerName", "endUserName", "productName", "modelName", "lotNumber", "serialNumber"].every((key) => isNullableBoundedString(value[key])) ||
      (value.actualShipmentDate !== undefined && !isNullableBoundedString(value.actualShipmentDate)) ||
      (value.legacyNotes !== undefined && !isNullableBoundedString(value.legacyNotes))) {
    return false;
  }
  if (![null, "PAID", "PARTIAL_PAID", "WARRANTY", "PENDING_DECISION"].includes(value.billingType as never)) return false;
  if (value.legacyDisposition !== undefined && ![null, "COMPLETED", "IN_PROGRESS"].includes(value.legacyDisposition as never)) return false;
  if (value.legacyBusinessColor !== undefined && !["BUSINESS_WHITE", "BUSINESS_YELLOW", "BUSINESS_COLOR_REQUIRES_REVIEW"].includes(value.legacyBusinessColor as never)) return false;
  return [
    null,
    "WAITING_INTAKE_INSPECTION",
    "WAITING_PO",
    "WAITING_PARTS_SUPPLY",
    "IN_REPAIR",
    "WAITING_SHIPMENT",
    "SHIPMENT_COMPLETED",
  ].includes(value.status as never);
}

function canonicalCell(cell: ExcelImportRawCellInput): unknown[] {
  return [
    cell.value,
    cell.metadata
      ? [
          cell.metadata.cellType,
          cell.metadata.rawValue,
          cell.metadata.cachedFormulaValue,
          cell.metadata.formula,
          cell.metadata.styleIndex,
          cell.metadata.fill ?? null,
        ]
      : null,
  ];
}

/**
 * Content-only fingerprint: source row number is deliberately excluded so an
 * identical A:Y row retains its identity if moved. Never log the canonical bytes.
 */
export function fingerprintRepairCaseSourceRow(
  rawCells: Record<string, ExcelImportRawCellInput>
): string {
  const canonical = JSON.stringify([
    REPAIR_CASE_SOURCE_ROW_FINGERPRINT_VERSION,
    EXCEL_IMPORT_COLUMNS.map((column) => [column, canonicalCell(rawCells[column])]),
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function validateIssue(
  issue: unknown,
  sourceRowNumber: number
): ExcelImportIssueDto | null {
  if (
    !isPlainObject(issue) ||
    !hasOnlyKeys(issue, ["code", "severity", "rowNumber", "cellAddress"]) ||
    typeof issue.code !== "string" ||
    !STABLE_CODE_PATTERN.test(issue.code) ||
    (issue.severity !== "WARNING" && issue.severity !== "REVIEW") ||
    (issue.rowNumber !== undefined && issue.rowNumber !== sourceRowNumber) ||
    (issue.cellAddress !== undefined &&
      (typeof issue.cellAddress !== "string" ||
        !/^[A-Y]\d+(?::[A-Y]\d+)?$/.test(issue.cellAddress) ||
        issue.cellAddress
          .split(":")
          .some((address) => Number(address.replace(/^[A-Y]/, "")) !== sourceRowNumber)))
  ) {
    return null;
  }
  return {
    code: issue.code,
    severity: issue.severity,
    rowNumber: sourceRowNumber,
    ...(issue.cellAddress === undefined ? {} : { cellAddress: issue.cellAddress }),
  };
}

function validateRow(row: unknown): ExcelImportPreviewRowDto | null {
  if (
    !isPlainObject(row) ||
    !hasOnlyKeys(row, [
      "sourceSheet",
      "sourceRowNumber",
      "rawCells",
      "normalized",
      "sourceClassification",
      "issues",
    ]) ||
    row.sourceSheet !== EXCEL_IMPORT_SOURCE_SHEET ||
    !Number.isInteger(row.sourceRowNumber) ||
    (row.sourceRowNumber as number) < EXCEL_IMPORT_FIRST_SOURCE_ROW ||
    (row.sourceRowNumber as number) >=
      EXCEL_IMPORT_FIRST_SOURCE_ROW + EXCEL_IMPORT_MAX_ROWS ||
    !isPlainObject(row.rawCells) ||
    Object.keys(row.rawCells).length !== EXCEL_IMPORT_COLUMNS.length ||
    !EXCEL_IMPORT_COLUMNS.every((column) =>
      isValidRawCell((row.rawCells as Record<string, unknown>)[column])
    ) ||
    !isValidNormalizedCandidate(row.normalized) ||
    (row.sourceClassification !== "SOURCE_READY" &&
      row.sourceClassification !== "SOURCE_REVIEW") ||
    !Array.isArray(row.issues)
  ) {
    return null;
  }
  const issues = row.issues.map((issue) => validateIssue(issue, row.sourceRowNumber as number));
  if (issues.some((issue) => issue === null)) return null;
  const rawColumns = Object.fromEntries(
    EXCEL_IMPORT_COLUMNS.map((column) => [
      column,
      (row.rawCells as Record<string, ExcelImportRawCellInput>)[column],
    ])
  ) as Record<ExcelImportColumn, ExcelImportRawCellInput>;
  const sourceClassification = row.sourceClassification as SourceClassification;
  return {
    sourceSheet: EXCEL_IMPORT_SOURCE_SHEET,
    sourceRowNumber: row.sourceRowNumber as number,
    sourceRowFingerprint: fingerprintRepairCaseSourceRow(rawColumns),
    rawData: { schemaVersion: "repair-case-list-raw-row-v3", columns: rawColumns },
    normalizedData: {
      schemaVersion: "repair-case-list-normalized-candidate-v3",
      candidate: {
        ...(row.normalized as ExcelImportNormalizedCandidateInput),
        legacyDisposition: (row.normalized as ExcelImportNormalizedCandidateInput).legacyDisposition ?? null,
        actualShipmentDate: (row.normalized as ExcelImportNormalizedCandidateInput).actualShipmentDate ?? null,
        legacyNotes: (row.normalized as ExcelImportNormalizedCandidateInput).legacyNotes ?? null,
        legacyReportNumber: (row.normalized as ExcelImportNormalizedCandidateInput).legacyReportNumber ?? null,
        legacyBusinessColor: (row.normalized as ExcelImportNormalizedCandidateInput).legacyBusinessColor,
      },
    },
    issues: issues as ExcelImportIssueDto[],
    sourceClassification,
    importStatus:
      sourceClassification === "SOURCE_REVIEW" ? "PENDING_REVIEW" : "MAPPING_REQUIRED",
  };
}

function buildSummary(
  rows: ExcelImportPreviewRowDto[],
  totalDataRowsConsidered: number,
  blankRowsSkipped: number,
  additionalIssues: Array<{ code: string; severity: "WARNING" | "REVIEW" }>
): ExcelImportPreviewSummary {
  const issueCounts = new Map<string, number>();
  let warningIssues = 0;
  let reviewIssues = 0;
  for (const row of rows) {
    for (const issue of row.issues) {
      issueCounts.set(issue.code, (issueCounts.get(issue.code) ?? 0) + 1);
      if (issue.severity === "WARNING") warningIssues++;
      else reviewIssues++;
    }
  }
  for (const issue of additionalIssues) {
    issueCounts.set(issue.code, (issueCounts.get(issue.code) ?? 0) + 1);
    if (issue.severity === "WARNING") warningIssues++;
    else reviewIssues++;
  }
  return {
    schemaVersion: "repair-case-list-preview-summary-v1",
    totalDataRowsConsidered,
    blankRowsSkipped,
    persistedRows: rows.length,
    sourceReadyRows: rows.filter((row) => row.sourceClassification === "SOURCE_READY").length,
    sourceReviewRows: rows.filter((row) => row.sourceClassification === "SOURCE_REVIEW").length,
    warningIssues,
    reviewIssues,
    issueCodeCounts: Object.fromEntries([...issueCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

export function validateExcelImportPreviewInput(
  input: ExcelImportPreviewBoundaryInput
): ExcelImportPreviewValidationResult {
  const fileName = input.originalFileName;
  const parsed = input.parsedPreview;
  const safety = input.safetyValidation;
  const safetyIssuesValid =
    isPlainObject(safety) &&
    Array.isArray(safety.issues) &&
    safety.issues.every(
      (issue) =>
        isPlainObject(issue) &&
        hasOnlyKeys(issue, ["code", "severity"]) &&
        typeof issue.code === "string" &&
        STABLE_CODE_PATTERN.test(issue.code) &&
        (issue.severity === "ERROR" || issue.severity === "WARNING")
    );
  const parseIssuesValid =
    isPlainObject(parsed) &&
    Array.isArray(parsed.issues) &&
    parsed.issues.every(
      (issue) =>
        isPlainObject(issue) &&
        hasOnlyKeys(issue, ["code", "severity", "rowNumber", "cellAddress"]) &&
        typeof issue.code === "string" &&
        STABLE_CODE_PATTERN.test(issue.code) &&
        (issue.severity === "ERROR" ||
          issue.severity === "WARNING" ||
          issue.severity === "REVIEW") &&
        (issue.rowNumber === undefined ||
          (Number.isInteger(issue.rowNumber) &&
            (issue.rowNumber as number) >= EXCEL_IMPORT_FIRST_SOURCE_ROW)) &&
        (issue.cellAddress === undefined ||
          (typeof issue.cellAddress === "string" &&
            /^[A-Z]+\d+(?::[A-Z]+\d+)?$/.test(issue.cellAddress)))
    );
  if (
    !SHA256_PATTERN.test(input.sourceFileSha256) ||
    !SHA256_PATTERN.test(input.headerFingerprint) ||
    input.sourceSheet !== EXCEL_IMPORT_SOURCE_SHEET ||
    typeof input.parserVersion !== "string" ||
    input.parserVersion.trim().length === 0 ||
    input.parserVersion.length > 128 ||
    typeof fileName !== "string" ||
    fileName.trim().length === 0 ||
    fileName.length > 255 ||
    fileName === "." ||
    fileName === ".." ||
    /[\\/]/.test(fileName) ||
    !fileName.toLowerCase().endsWith(".xlsx") ||
    !Number.isSafeInteger(input.fileSizeBytes) ||
    input.fileSizeBytes < 0 ||
    input.fileSizeBytes > EXCEL_IMPORT_MAX_FILE_BYTES ||
    input.mimeType !== MIME_TYPE ||
    !UUID_PATTERN.test(input.uploadedBy) ||
    !(input.now instanceof Date) ||
    Number.isNaN(input.now.getTime()) ||
    !safetyIssuesValid ||
    safety.ok !== true ||
    safety.issues.some((issue) => issue.severity === "ERROR") ||
    !parseIssuesValid ||
    parsed.ok !== true ||
    parsed.headerValid !== true ||
    parsed.sourceSheet !== EXCEL_IMPORT_SOURCE_SHEET ||
    parsed.issues.some((issue) => issue.severity === "ERROR") ||
    !Array.isArray(parsed.rows) ||
    parsed.rows.length === 0 ||
    parsed.rows.length > EXCEL_IMPORT_MAX_ROWS ||
    !Number.isInteger(parsed.totalDataRowsConsidered) ||
    (parsed.totalDataRowsConsidered as number) < parsed.rows.length ||
    (parsed.totalDataRowsConsidered as number) > EXCEL_IMPORT_MAX_ROWS ||
    !Number.isInteger(parsed.blankRowsSkipped) ||
    (parsed.blankRowsSkipped as number) < 0 ||
    (parsed.blankRowsSkipped as number) > (parsed.totalDataRowsConsidered as number)
  ) {
    return { ok: false, code: "INVALID_PREVIEW_INPUT" };
  }

  const rows = parsed.rows.map(validateRow);
  if (rows.some((row) => row === null)) {
    return { ok: false, code: "INVALID_PREVIEW_INPUT" };
  }
  const validRows = rows as ExcelImportPreviewRowDto[];
  if (new Set(validRows.map((row) => row.sourceRowNumber)).size !== validRows.length) {
    return { ok: false, code: "INVALID_PREVIEW_INPUT" };
  }

  const hasAnyResetField =
    input.resetExpiredBatchId !== undefined || input.confirmExpiredReset !== undefined;
  const hasAnyRefreshField =
    input.refreshExistingBatchId !== undefined || input.confirmParserRefresh !== undefined;
  const hasValidReset =
    UUID_PATTERN.test(input.resetExpiredBatchId ?? "") &&
    Number.isInteger(input.expectedBatchVersion) &&
    (input.expectedBatchVersion ?? 0) > 0 &&
    input.confirmExpiredReset === true;
  const hasValidRefresh =
    UUID_PATTERN.test(input.refreshExistingBatchId ?? "") &&
    Number.isInteger(input.expectedBatchVersion) &&
    (input.expectedBatchVersion ?? 0) > 0 &&
    input.confirmParserRefresh === true;
  if (
    (hasAnyResetField && !hasValidReset) ||
    (hasAnyRefreshField && !hasValidRefresh) ||
    (hasAnyResetField && hasAnyRefreshField) ||
    (input.expectedBatchVersion !== undefined && !hasAnyResetField && !hasAnyRefreshField)
  ) {
    return { ok: false, code: "INVALID_PREVIEW_INPUT" };
  }

  const summary = buildSummary(
    validRows,
    parsed.totalDataRowsConsidered as number,
    parsed.blankRowsSkipped as number,
    [
      ...safety.issues
        .filter((issue) => issue.severity === "WARNING")
        .map((issue) => ({ code: issue.code, severity: "WARNING" as const })),
      ...parsed.issues
        .filter(
          (issue): issue is ExcelImportIssueInput & { severity: "WARNING" | "REVIEW" } =>
            issue.severity === "WARNING" || issue.severity === "REVIEW"
        )
        .map((issue) => ({ code: issue.code, severity: issue.severity })),
    ]
  );
  return {
    ok: true,
    value: {
      metadata: {
        sourceFileSha256: input.sourceFileSha256,
        parserVersion: input.parserVersion.trim(),
        sourceSheet: EXCEL_IMPORT_SOURCE_SHEET,
        headerFingerprint: input.headerFingerprint,
        originalFileName: fileName,
        fileSizeBytes: input.fileSizeBytes,
        mimeType: input.mimeType,
        uploadedBy: input.uploadedBy,
        now: new Date(input.now.getTime()),
      },
      rows: validRows,
      summary,
      batchStatus:
        summary.sourceReviewRows > 0 ? "REVIEW_REQUIRED" : "PREVIEWED",
      reset: hasValidReset
        ? {
            batchId: input.resetExpiredBatchId as string,
            expectedVersion: input.expectedBatchVersion as number,
            confirmed: true,
          }
        : null,
      refresh: hasValidRefresh
        ? {
            batchId: input.refreshExistingBatchId as string,
            expectedVersion: input.expectedBatchVersion as number,
            confirmed: true,
          }
        : null,
    },
  };
}
