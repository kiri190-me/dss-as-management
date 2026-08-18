import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseWorkbookDateSystem,
  parseWorkbookStyles,
  parseWorksheet,
  type ParsedCellMetadata,
} from "./ooxml-parser";
import type { LoadedWorkbook } from "./workbook-loader";
import {
  excelSerialToDateOnly,
  isDateLikeStyle,
  legacyBusinessColor,
  parseRepairCaseListWorkbook,
  repairCaseImportDateMaximum,
  type RepairCaseNormalizedCandidate,
} from "./repair-case-list-import";

const REFERENCE_DATE = "2026-08-17";

function parse(workbook: LoadedWorkbook, referenceDate = REFERENCE_DATE) {
  return parseRepairCaseListWorkbook(workbook, { referenceDate });
}

const HEADERS: Record<string, string> = {
  A: "번호バンゴウ", B: "인수 번호ヒキトリ", C: "인수일ハッコウビ", D: "고객처",
  // I3 is intentionally blank: I contains the same-L/N historical receipt count, not an import field.
  E: "End_User", F: "제품", G: "型式カタシキ", H: "L/N", I: "", J: "S/N",
  K: "DSS 견적번호", L: "발주현황(유.무상)", M: "선적일(여부)", N: "납입일(여부)→고객",
  O: "수리보고서", P: "세금계산서발행", Q: "기재자キサイシャ", R: "장소",
  S: "고객반출사유備考(原因)ビコウゲンイン", T: "교산출하일",
  U: "인수검사 완료 / P.O 발행 후 통전 예정", V: "점검 완료일 (예상)",
  W: "수리완료일(예상)", X: "담당자", Y: "수리소 출하확인",
};

function metadata(value: string, type = "s", styleIndex: number | null = null): ParsedCellMetadata {
  return { cellType: type, rawValue: value, cachedFormulaValue: null, formula: null, styleIndex };
}

const YELLOW_FILL: NonNullable<ParsedCellMetadata["fill"]> = {
  fillId: 4,
  patternType: "solid",
  foreground: { source: "rgb", value: "FFFFFF00", tint: null, resolvedRgb: "FFFF00" },
  background: null,
};

const LEGACY_BUSINESS_WHITE_FILL: NonNullable<ParsedCellMetadata["fill"]> = {
  fillId: 5,
  patternType: "solid",
  foreground: { source: "theme", value: "0", tint: null, resolvedRgb: "000000" },
  background: { source: "indexed", value: "64", tint: null, resolvedRgb: null },
  cellXfApplyFill: true,
  cellXfId: 0,
};

function fixture(overrides: Record<string, string | null> = {}): LoadedWorkbook {
  const cells: Record<string, string> = {};
  const cellMetadata: Record<string, ParsedCellMetadata> = {};
  for (const [column, value] of Object.entries(HEADERS)) {
    if (value) {
      cells[`${column}3`] = value;
      cellMetadata[`${column}3`] = metadata(value);
    }
  }
  for (const column of Object.keys(HEADERS)) {
    cellMetadata[`${column}4`] = { ...metadata(""), rawValue: null, fill: YELLOW_FILL };
  }
  const row = {
    A4: "1", B4: "D260601", C4: "2026-06-01", D4: "Customer", E4: "End User",
    F4: "Generator", G4: "Model", H4: "LOT", J4: "SERIAL", L4: "유상", U4: "수리 중",
    ...overrides,
  };
  for (const [ref, value] of Object.entries(row)) {
    if (value === null) {
      delete cells[ref];
    } else {
      cells[ref] = value;
      cellMetadata[ref] = { ...metadata(value), fill: YELLOW_FILL };
    }
  }
  return {
    sourceFileName: "synthetic.xlsx",
    sourceFileHash: "synthetic",
    dateSystem: "1900",
    styles: { cellXfsNumFmtIds: [0, 185], cellXfsFillIds: [], fills: [], themeColors: [], customNumberFormats: { 185: 'mm"월" dd"일"' } },
    sheets: [{
      name: "목록", sheetId: "2", worksheetPath: "xl/worksheets/sheet2.xml",
      drawingPath: null, drawing: null,
      worksheet: { dimension: "A1:Y4", merges: [], hyperlinks: [], cells, cellMetadata },
    }],
  };
}

test("repair-case list parser accepts the fixed A:Y header including blank I3", () => {
  const result = parse(fixture());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.headerValid, true);
  assert.equal(result.rows[0].sourceClassification, "SOURCE_READY");
  assert.equal(Object.keys(result.rows[0].rawCells).length, 25);
  assert.equal(result.rows[0].rawCells.I.value, null);
});

test("OOXML parser keeps a self-closing blank cell separate from the following cell", () => {
  const worksheet = parseWorksheet(
    '<worksheet><sheetData><row r="3"><c r="I3"/><c r="J3" t="s"><v>0</v></c></row></sheetData></worksheet>',
    ["S/N"],
    {}
  );
  assert.equal(worksheet.cells.I3, undefined);
  assert.equal(worksheet.cells.J3, "S/N");
  assert.equal(worksheet.cellMetadata?.I3.rawValue, null);
});

test("header validation is fixed-position and does not shift after blank I3", () => {
  const workbook = fixture();
  workbook.sheets[0].worksheet.cells.J3 = "DSS 견적번호";
  const result = parse(workbook);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "HEADER_MISMATCH" && issue.cellAddress === "J3"));
});

test("missing 목록 sheet is a structural error", () => {
  const workbook = fixture();
  workbook.sheets[0].name = "Sheet1";
  const result = parse(workbook);
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues.map((issue) => issue.code), ["REQUIRED_SHEET_MISSING"]);
});

test("blank rows are skipped and values outside A:Y only produce a stable warning", () => {
  const workbook = fixture();
  workbook.sheets[0].worksheet.cells.Z4 = "outside";
  workbook.sheets[0].worksheet.cellMetadata!.Z4 = metadata("outside");
  workbook.sheets[0].worksheet.cellMetadata!.A5 = metadata("");
  const result = parse(workbook);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.blankRowsSkipped, 1);
  assert.ok(result.issues.some((issue) => issue.code === "UNEXPECTED_DATA_OUTSIDE_IMPORT_RANGE" && issue.cellAddress === "Z4"));
});

test("blank billing becomes pending with a non-blocking notice and no REVIEW issues", () => {
  const result = parse(fixture({
    B4: null,
    C4: null,
    D4: null,
    E4: null,
    F4: null,
    G4: null,
    H4: null,
    J4: null,
    L4: null,
    U4: null,
    X4: null,
  }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rows[0].sourceClassification, "SOURCE_READY");
  assert.deepEqual(result.rows[0].issues, [{
    code: "BILLING_PENDING_EMPTY",
    severity: "WARNING",
    rowNumber: 4,
    cellAddress: "L4",
  }]);
  assert.deepEqual(result.rows[0].normalized, {
    legacyReportNumber: "1",
    intakeNumber: null,
    receivedDate: null,
    customerName: null,
    endUserName: null,
    productName: null,
    modelName: null,
    lotNumber: null,
    serialNumber: null,
    billingType: "PENDING_DECISION",
    status: null,
    legacyDisposition: "IN_PROGRESS",
    actualShipmentDate: null,
    legacyNotes: null,
    legacyBusinessColor: "BUSINESS_YELLOW",
  });
});

test("blank status and assignee sources do not create review issues", () => {
  const result = parse(fixture({ U4: null, X4: null }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rows[0].sourceClassification, "SOURCE_READY");
  assert.ok(!result.rows[0].issues.some((issue) => issue.code === "STATUS_REQUIRES_REVIEW"));
  assert.ok(!result.rows[0].issues.some((issue) => issue.code === "ASSIGNEE_REQUIRES_RESOLUTION"));
});

test("an assignee source alone does not count as a status source", () => {
  const result = parse(fixture({ U4: null, X4: "담당자 미확정" }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(!result.rows[0].issues.some((issue) => issue.code === "STATUS_REQUIRES_REVIEW"));
  assert.equal(result.rows[0].sourceClassification, "SOURCE_READY");
  assert.ok(result.rows[0].issues.some((issue) => issue.code === "ASSIGNEE_MAPPING_PENDING" && issue.severity === "WARNING"));
});

test("U business color overrides conflicting status wording without changing notes", () => {
  const result = parse(fixture({ U4: "수리 중 / 출하 완료", X4: "담당자 미확정" }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rows[0].sourceClassification, "SOURCE_READY");
  assert.equal(result.rows[0].normalized.legacyDisposition, "IN_PROGRESS");
  assert.equal(result.rows[0].normalized.legacyNotes, "수리 중 / 출하 완료");
  assert.ok(result.rows[0].issues.some((issue) => issue.code === "ASSIGNEE_MAPPING_PENDING"));
});

test("U keeps status wording in notes while removing one safe shipment date", () => {
  const workbook = fixture({ U4: "출하 완료 / 2026-04-15" });
  for (const column of Object.keys(HEADERS)) {
    workbook.sheets[0].worksheet.cellMetadata![`${column}4`].fill = null;
  }
  const result = parse(workbook);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rows[0].normalized.status, "SHIPMENT_COMPLETED");
  assert.equal(result.rows[0].normalized.legacyDisposition, "COMPLETED");
  assert.equal(result.rows[0].normalized.actualShipmentDate, "2026-04-15");
  assert.equal(result.rows[0].normalized.legacyNotes, "출하 완료");
});

test("multiple or invalid U dates preserve the entire source as notes", () => {
  for (const source of ["출하 완료 2026-04-15 / 2026-04-16", "출하 완료 2026-02-30"]) {
    const result = parse(fixture({ U4: source }));
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.equal(result.rows[0].normalized.actualShipmentDate, null);
    assert.equal(result.rows[0].normalized.legacyNotes, source);
    assert.ok(result.rows[0].issues.some((issue) => issue.code === (source.includes("04-16") ? "SHIPMENT_DATE_MULTIPLE" : "SHIPMENT_DATE_UNINTERPRETABLE")));
  }
});

test("U numeric cells require a date style before serial conversion", () => {
  const styled = fixture({ U4: "46174" });
  styled.sheets[0].worksheet.cellMetadata!.U4 = { ...metadata("46174", "n", 1), fill: null };
  const styledResult = parse(styled);
  assert.equal(styledResult.ok, true);
  if (styledResult.ok) {
    assert.equal(styledResult.rows[0].normalized.actualShipmentDate, "2026-06-01");
    assert.equal(styledResult.rows[0].normalized.legacyNotes, null);
  }

  const general = fixture({ U4: "46174" });
  general.sheets[0].worksheet.cellMetadata!.U4 = { ...metadata("46174", "n", 0), fill: null };
  const generalResult = parse(general);
  assert.equal(generalResult.ok, true);
  if (generalResult.ok) assert.equal(generalResult.rows[0].normalized.actualShipmentDate, null);
});

test("yellow business color keeps an apparent completion phrase and date in progress", () => {
  const result = parse(fixture({ U4: "출하 완료 / 2026-04-15" }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rows[0].normalized.legacyDisposition, "IN_PROGRESS");
  assert.equal(result.rows[0].normalized.actualShipmentDate, null);
  assert.equal(result.rows[0].normalized.legacyNotes, "출하 완료");
  assert.equal(result.rows[0].sourceClassification, "SOURCE_READY");
});

test("only the exact versioned legacy style signature is BUSINESS_WHITE", () => {
  assert.equal(legacyBusinessColor({ value: null, metadata: { ...metadata(""), fill: null } }), "BUSINESS_WHITE");
  assert.equal(legacyBusinessColor({ value: null, metadata: { ...metadata(""), fill: LEGACY_BUSINESS_WHITE_FILL } }), "BUSINESS_WHITE");
  assert.equal(legacyBusinessColor({ value: null, metadata: { ...metadata(""), fill: YELLOW_FILL } }), "BUSINESS_YELLOW");
  for (const fill of [
    { ...LEGACY_BUSINESS_WHITE_FILL, fillId: 6 },
    { ...LEGACY_BUSINESS_WHITE_FILL, cellXfApplyFill: null },
    { ...LEGACY_BUSINESS_WHITE_FILL, cellXfId: 1 },
    { ...LEGACY_BUSINESS_WHITE_FILL, foreground: { ...LEGACY_BUSINESS_WHITE_FILL.foreground!, tint: 0.1 } },
  ]) {
    assert.equal(legacyBusinessColor({ value: null, metadata: { ...metadata(""), fill } }), "BUSINESS_COLOR_REQUIRES_REVIEW");
  }
});

test("OOXML styles expose RGB, indexed, theme, and tint fill evidence", () => {
  const styles = parseWorkbookStyles(
    '<styleSheet><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor indexed="5"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor theme="0" tint="0.25"/><bgColor rgb="FFFFFFFF"/></patternFill></fill></fills><cellXfs count="2"><xf numFmtId="0" fillId="1" xfId="0" applyFill="1"/><xf numFmtId="0" fillId="2" xfId="1"/></cellXfs></styleSheet>',
    '<a:theme xmlns:a="x"><a:themeElements><a:clrScheme name="x"><a:dk1><a:srgbClr val="112233"/></a:dk1></a:clrScheme></a:themeElements></a:theme>'
  );
  assert.equal(styles.fills[1].foreground?.source, "indexed");
  assert.equal(styles.fills[1].foreground?.resolvedRgb, "FFFF00");
  assert.equal(styles.fills[2].foreground?.source, "theme");
  assert.equal(styles.fills[2].foreground?.resolvedRgb, "112233");
  assert.equal(styles.fills[2].foreground?.tint, 0.25);
  assert.deepEqual(styles.cellXfsApplyFill, [true, null]);
  assert.deepEqual(styles.cellXfsBaseIds, [0, 1]);
});

test("duplicate intake numbers are REVIEW while ambiguous billing becomes pending NOTICE", () => {
  const workbook = fixture({ L4: "유상 / PO 확인" });
  const sheet = workbook.sheets[0].worksheet;
  for (const column of Object.keys(HEADERS)) {
    const source = `${column}4`;
    if (sheet.cells[source]) {
      sheet.cells[`${column}5`] = sheet.cells[source];
      sheet.cellMetadata![`${column}5`] = metadata(sheet.cells[source]);
    }
  }
  const result = parse(workbook);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rows.length, 2);
  assert.ok(result.rows.every((row) => row.sourceClassification === "SOURCE_REVIEW"));
  assert.ok(result.rows.every((row) => row.issues.some((issue) => issue.code === "INTAKE_NUMBER_DUPLICATED")));
  assert.ok(result.rows[0].issues.some((issue) => issue.code === "BILLING_PENDING_UNRESOLVED" && issue.severity === "WARNING"));
  assert.equal(result.rows[0].normalized.billingType, "PENDING_DECISION");
});

test("safe numeric L/N and S/N cells normalize with non-blocking notices", () => {
  const workbook = fixture({ H4: "123456", J4: "987654" });
  workbook.sheets[0].worksheet.cellMetadata!.H4 = metadata("123456", "n");
  workbook.sheets[0].worksheet.cellMetadata!.J4 = metadata("987654", "n");
  const result = parse(workbook);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rows[0].sourceClassification, "SOURCE_READY");
  assert.equal(result.rows[0].normalized.lotNumber, "123456");
  assert.equal(result.rows[0].normalized.serialNumber, "987654");
  assert.equal(
    result.rows[0].issues.filter(
      (issue) => issue.code === "NUMERIC_IDENTITY_NORMALIZED" && issue.severity === "WARNING"
    ).length,
    2
  );
});

test("legacy report number preserves text, restores 0000 display, permits duplicates, and never causes REVIEW", () => {
  const numeric = fixture({ A4: "7" });
  numeric.styles = {
    ...numeric.styles!,
    cellXfsNumFmtIds: [0, 186],
    customNumberFormats: { ...numeric.styles!.customNumberFormats, 186: "0000" },
  };
  numeric.sheets[0].worksheet.cellMetadata!.A4 = { ...metadata("7", "n", 1), fill: YELLOW_FILL };
  const numericResult = parse(numeric);
  assert.equal(numericResult.ok, true);
  if (numericResult.ok) {
    assert.equal(numericResult.rows[0].normalized.legacyReportNumber, "0007");
    assert.ok(!numericResult.rows[0].issues.some((issue) => issue.severity === "REVIEW" && issue.cellAddress === "A4"));
  }

  const textResult = parse(fixture({ A4: "  LEGACY-01  " }));
  assert.equal(textResult.ok, true);
  if (textResult.ok) assert.equal(textResult.rows[0].normalized.legacyReportNumber, "LEGACY-01");

  const duplicate = fixture({ A4: "0001" });
  const sheet = duplicate.sheets[0].worksheet;
  for (const column of Object.keys(HEADERS)) {
    const source = `${column}4`;
    if (sheet.cells[source]) sheet.cells[`${column}5`] = sheet.cells[source];
    if (sheet.cellMetadata?.[source]) sheet.cellMetadata[`${column}5`] = { ...sheet.cellMetadata[source] };
  }
  sheet.cells.B5 = "D260602";
  sheet.cellMetadata!.B5 = { ...metadata("D260602"), fill: YELLOW_FILL };
  const duplicateResult = parse(duplicate);
  assert.equal(duplicateResult.ok, true);
  if (duplicateResult.ok) assert.deepEqual(duplicateResult.rows.map((row) => row.normalized.legacyReportNumber), ["0001", "0001"]);
});

test("legacy report number formula uses its cached display value and risky numeric storage is NOTICE only", () => {
  const formula = fixture({ A4: "12" });
  formula.styles = { ...formula.styles!, cellXfsNumFmtIds: [0, 186], customNumberFormats: { 186: "0000" } };
  formula.sheets[0].worksheet.cellMetadata!.A4 = { ...metadata("12", "n", 1), formula: "1+11", cachedFormulaValue: "12", fill: YELLOW_FILL };
  const formulaResult = parse(formula);
  assert.equal(formulaResult.ok, true);
  if (formulaResult.ok) assert.equal(formulaResult.rows[0].normalized.legacyReportNumber, "0012");

  const risky = fixture({ A4: "1234567890123456" });
  risky.sheets[0].worksheet.cellMetadata!.A4 = { ...metadata("1234567890123456", "n"), fill: YELLOW_FILL };
  const riskyResult = parse(risky);
  assert.equal(riskyResult.ok, true);
  if (riskyResult.ok) {
    assert.ok(riskyResult.rows[0].issues.some((issue) => issue.code === "LEGACY_REPORT_NUMBER_FORMAT_RISK" && issue.severity === "WARNING"));
    assert.equal(riskyResult.rows[0].sourceClassification, "SOURCE_READY");
  }
});

test("I keeps the same-L/N historical receipt count as raw trace data only", () => {
  const withLot = fixture({ H4: "LOT-H", I4: "7" });
  withLot.sheets[0].worksheet.cellMetadata!.I4 = metadata("7", "n");
  const first = parse(withLot);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.rows[0].normalized.lotNumber, "LOT-H");
  assert.equal(first.rows[0].rawCells.I.value, "7");
  assert.ok(!first.rows[0].issues.some((issue) => issue.cellAddress?.startsWith("I")));

  const withoutLot = fixture({ H4: null, I4: "legacy-count" });
  const second = parse(withoutLot);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.rows[0].normalized.lotNumber, null);
  assert.ok(!second.rows[0].issues.some((issue) => issue.cellAddress?.startsWith("I")));
});

test("I numeric, text, decimal, and large values never affect import fields or issues", () => {
  const cases = [
    { value: "12", type: "n" },
    { value: "재입고", type: "s" },
    { value: "1.5", type: "n" },
    { value: "12345678901234567890", type: "n" },
  ];
  const normalizedResults: RepairCaseNormalizedCandidate[] = [];
  for (const candidate of cases) {
    const workbook = fixture({ H4: "LOT-H", I4: candidate.value });
    workbook.sheets[0].worksheet.cellMetadata!.I4 = metadata(candidate.value, candidate.type);
    const result = parse(workbook);
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    normalizedResults.push(result.rows[0].normalized);
    assert.equal(result.rows[0].normalized.lotNumber, "LOT-H");
    assert.equal(result.rows[0].rawCells.I.value, candidate.value);
    assert.ok(!result.rows[0].issues.some((issue) => issue.cellAddress?.startsWith("I")));
  }
  assert.ok(normalizedResults.every((value) => JSON.stringify(value) === JSON.stringify(normalizedResults[0])));
});

test("risky numeric identity formats remain REVIEW", () => {
  const cases: ReadonlyArray<{ value: string; styleIndex?: number }> = [
    { value: "1234567890123456" },
    { value: "1.25" },
    { value: "1E+12" },
    { value: "123", styleIndex: 1 },
  ];
  for (const candidate of cases) {
    const workbook = fixture({ H4: candidate.value });
    workbook.sheets[0].worksheet.cellMetadata!.H4 = metadata(
      candidate.value,
      "n",
      candidate.styleIndex ?? null
    );
    if (candidate.styleIndex === 1) {
      workbook.styles = {
        cellXfsNumFmtIds: [0, 185],
        cellXfsFillIds: [],
        fills: [],
        themeColors: [],
        customNumberFormats: { 185: "000000" },
      };
    }
    const result = parse(workbook);
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.equal(result.rows[0].sourceClassification, "SOURCE_REVIEW");
    assert.equal(result.rows[0].normalized.lotNumber, null);
    assert.ok(result.rows[0].issues.some((issue) => issue.code === "NUMERIC_IDENTITY_FORMAT_RISK"));
  }
});

test("custom Korean date format and both Excel date systems are deterministic", () => {
  const styles = { cellXfsNumFmtIds: [0, 185], cellXfsFillIds: [], fills: [], themeColors: [], customNumberFormats: { 185: 'mm"월" dd"일"' } };
  assert.equal(isDateLikeStyle(1, styles), true);
  assert.equal(excelSerialToDateOnly(1, "1900"), "1900-01-01");
  assert.equal(excelSerialToDateOnly(59, "1900"), "1900-02-28");
  assert.equal(excelSerialToDateOnly(60, "1900"), null);
  assert.equal(excelSerialToDateOnly(61, "1900"), "1900-03-01");
  assert.equal(excelSerialToDateOnly(1, "1904"), "1904-01-02");

  const workbook = fixture({ C4: "46174" });
  workbook.sheets[0].worksheet.cellMetadata!.C4 = metadata("46174", "n", 1);
  const result = parse(workbook);
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("expected parsed workbook");
  assert.equal(result.rows[0].normalized.receivedDate, "2026-06-01");
  assert.equal(repairCaseImportDateMaximum("2024-02-29"), "2025-02-28");
});

test("received date accepts confirmed separator, whitespace, trailing-period, and Korean forms", () => {
  const cases = [
    "2024.2.29",
    "2024-02-29",
    "2024/2/29",
    "2024.\n2.29",
    "2024.\r\n 2. 29",
    "2024.\t2.\t29.",
    "2024년 2월 29일",
  ];
  for (const value of cases) {
    const result = parse(fixture({ C4: value }));
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.equal(result.rows[0].normalized.receivedDate, "2024-02-29");
  }
});

test("received date returns specific REVIEW codes for unsafe text structures", () => {
  const cases: ReadonlyArray<[string, string]> = [
    ["24.2.29", "RECEIVED_DATE_TWO_DIGIT_YEAR"],
    ["24년 2월 29일", "RECEIVED_DATE_TWO_DIGIT_YEAR"],
    ["2024.2", "RECEIVED_DATE_PARTIAL"],
    ["2.29", "RECEIVED_DATE_PARTIAL"],
    ["2023.2.29", "RECEIVED_DATE_INVALID_CALENDAR_DATE"],
    ["2024년 13월 1일", "RECEIVED_DATE_INVALID_CALENDAR_DATE"],
    ["다음 달 예정", "RECEIVED_DATE_UNINTERPRETABLE"],
  ];
  for (const [value, expectedCode] of cases) {
    const result = parse(fixture({ C4: value }));
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.ok(result.rows[0].issues.some((candidate) => candidate.code === expectedCode));
    assert.equal(result.rows[0].sourceClassification, "SOURCE_REVIEW");
  }
});

test("general-format numeric C cell is accepted only inside the injected range", () => {
  const inRange = fixture({ C4: "46174" });
  inRange.sheets[0].worksheet.cellMetadata!.C4 = metadata("46174", "n", null);
  const accepted = parse(inRange);
  assert.equal(accepted.ok, true);
  if (!accepted.ok) assert.fail("expected parsed workbook");
  assert.equal(accepted.rows[0].normalized.receivedDate, "2026-06-01");

  const outOfRange = fixture({ C4: "1" });
  outOfRange.sheets[0].worksheet.cellMetadata!.C4 = metadata("1", "n", null);
  const rejected = parse(outOfRange);
  assert.equal(rejected.ok, true);
  if (!rejected.ok) assert.fail("expected parsed workbook");
  assert.ok(rejected.rows[0].issues.some((candidate) => candidate.code === "RECEIVED_DATE_SERIAL_OUT_OF_RANGE"));

  const system1904 = fixture({ C4: "44712" });
  system1904.dateSystem = "1904";
  system1904.sheets[0].worksheet.cellMetadata!.C4 = metadata("44712", "n", null);
  const parsed1904 = parse(system1904);
  assert.equal(parsed1904.ok, true);
  if (!parsed1904.ok) assert.fail("expected parsed workbook");
  assert.equal(parsed1904.rows[0].normalized.receivedDate, "2026-06-01");
});

test("numeric shared string is never interpreted as an Excel serial", () => {
  const workbook = fixture({ C4: "46174" });
  workbook.sheets[0].worksheet.cellMetadata!.C4 = metadata("46174", "s", null);
  const result = parse(workbook);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rows[0].normalized.receivedDate, null);
  assert.ok(result.rows[0].issues.some((candidate) => candidate.code === "RECEIVED_DATE_UNINTERPRETABLE"));
});

test("Excel serial 60 remains an invalid calendar date", () => {
  const workbook = fixture({ C4: "60" });
  workbook.sheets[0].worksheet.cellMetadata!.C4 = metadata("60", "n", null);
  const result = parse(workbook);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.rows[0].issues.some((candidate) => candidate.code === "RECEIVED_DATE_INVALID_CALENDAR_DATE"));
});

test("OOXML workbook metadata exposes date system and cellXfs number formats", () => {
  assert.equal(parseWorkbookDateSystem('<workbook><workbookPr date1904="1"/></workbook>'), "1904");
  assert.equal(parseWorkbookDateSystem("<workbook/>"), "1900");
  const styles = parseWorkbookStyles(
    '<styleSheet><numFmts><numFmt numFmtId="185" formatCode="mm&quot;월&quot; dd&quot;일&quot;"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="185"/></cellXfs></styleSheet>'
  );
  assert.deepEqual(styles.cellXfsNumFmtIds, [0, 185]);
  assert.equal(styles.customNumberFormats[185], 'mm"월" dd"일"');
});

test("required formula without a cached value is surfaced without recalculation", () => {
  const workbook = fixture();
  workbook.sheets[0].worksheet.cellMetadata!.C4 = {
    cellType: "n", rawValue: null, cachedFormulaValue: null, formula: "TODAY()", styleIndex: 1,
  };
  delete workbook.sheets[0].worksheet.cells.C4;
  const result = parse(workbook);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.rows[0].issues.some((issue) => issue.code === "REQUIRED_FORMULA_CACHE_MISSING"));
  assert.equal(result.rows[0].sourceClassification, "SOURCE_REVIEW");
});

test("raw source cells and formula metadata remain attached to the source row", () => {
  const workbook = fixture();
  workbook.sheets[0].worksheet.cellMetadata!.K4 = {
    cellType: "str", rawValue: "cached", cachedFormulaValue: "cached", formula: "A4", styleIndex: 0,
  };
  workbook.sheets[0].worksheet.cells.K4 = "cached";
  const result = parse(workbook);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rows[0].sourceRowNumber, 4);
  assert.equal(result.rows[0].rawCells.K.metadata?.formula, "A4");
  assert.equal(result.rows[0].rawCells.K.metadata?.cachedFormulaValue, "cached");
});
