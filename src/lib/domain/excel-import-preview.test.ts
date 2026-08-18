import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  EXCEL_IMPORT_COLUMNS,
  REPAIR_CASE_SOURCE_ROW_FINGERPRINT_VERSION,
  fingerprintRepairCaseSourceRow,
  validateExcelImportPreviewInput,
  type ExcelImportPreviewBoundaryInput,
  type ExcelImportRawCellInput,
} from "./excel-import-preview";

function rawCells(
  valueAt: Partial<Record<string, string | null>> = {}
): Record<string, ExcelImportRawCellInput> {
  return Object.fromEntries(
    EXCEL_IMPORT_COLUMNS.map((column) => [
      column,
      {
        value: valueAt[column] ?? null,
        metadata: null,
      } satisfies ExcelImportRawCellInput,
    ])
  );
}

function input(overrides: Partial<ExcelImportPreviewBoundaryInput> = {}): ExcelImportPreviewBoundaryInput {
  return {
    sourceFileSha256: "a".repeat(64),
    parserVersion: "repair-case-list-parser-v1",
    sourceSheet: "목록",
    headerFingerprint: "b".repeat(64),
    originalFileName: "repair-cases.xlsx",
    fileSizeBytes: 1024,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    uploadedBy: randomUUID(),
    now: new Date("2026-08-17T00:00:00.000Z"),
    safetyValidation: { ok: true, issues: [] },
    parsedPreview: {
      ok: true,
      sourceSheet: "목록",
      headerValid: true,
      totalDataRowsConsidered: 1,
      blankRowsSkipped: 0,
      issues: [],
      rows: [
        {
          sourceSheet: "목록",
          sourceRowNumber: 4,
          rawCells: rawCells({ A: "1", B: "D260801" }),
          normalized: {
            intakeNumber: "D260801",
            receivedDate: "2026-08-01",
            customerName: null,
            endUserName: null,
            productName: null,
            modelName: null,
            lotNumber: null,
            serialNumber: null,
            billingType: null,
            status: null,
          },
          sourceClassification: "SOURCE_REVIEW",
          issues: [
            {
              code: "BILLING_AMBIGUOUS",
              severity: "REVIEW",
              rowNumber: 4,
              cellAddress: "D4",
            },
          ],
        },
      ],
    },
    ...overrides,
  };
}

describe("Repair Case Excel Import preview persistence boundary", () => {
  test("uses the approved fingerprint canonical version v3", () => {
    assert.equal(REPAIR_CASE_SOURCE_ROW_FINGERPRINT_VERSION, "repair-case-list-source-row-v3");
  });
  test("fingerprint is deterministic and uses fixed A:Y order", () => {
    const first = rawCells({ A: "first", Y: "last" });
    const reverse = Object.fromEntries(Object.entries(first).reverse());
    assert.equal(
      fingerprintRepairCaseSourceRow(first),
      fingerprintRepairCaseSourceRow(reverse)
    );
  });

  test("fingerprint distinguishes NULL from empty string", () => {
    assert.notEqual(
      fingerprintRepairCaseSourceRow(rawCells({ A: null })),
      fingerprintRepairCaseSourceRow(rawCells({ A: "" }))
    );
  });

  test("source row number and normalized/parser decisions do not affect content fingerprint", () => {
    const first = input();
    const second = input();
    second.parserVersion = "repair-case-list-parser-v99";
    second.parsedPreview.rows![0].sourceRowNumber = 99;
    second.parsedPreview.rows![0].normalized.customerName = "normalized-only-change";
    second.parsedPreview.rows![0].issues = [];
    const a = validateExcelImportPreviewInput(first);
    const b = validateExcelImportPreviewInput(second);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    if (!a.ok || !b.ok) return;
    assert.equal(a.value.rows[0].sourceRowFingerprint, b.value.rows[0].sourceRowFingerprint);
  });

  test("one raw cell change changes the fingerprint", () => {
    assert.notEqual(
      fingerprintRepairCaseSourceRow(rawCells({ M: "before" })),
      fingerprintRepairCaseSourceRow(rawCells({ M: "after" }))
    );
  });

  test("ignored legacy I receipt-count data remains part of the source fingerprint", () => {
    assert.notEqual(
      fingerprintRepairCaseSourceRow(rawCells({ I: "1" })),
      fingerprintRepairCaseSourceRow(rawCells({ I: "2" }))
    );
  });

  test("fingerprint includes approved formula/cache/type/style metadata", () => {
    const plain = rawCells({ C: "2026-08-01" });
    const formula = rawCells({ C: "2026-08-01" });
    formula.C.metadata = {
      cellType: "n",
      rawValue: "46235",
      cachedFormulaValue: "46235",
      formula: "DATE(2026,8,1)",
      styleIndex: 2,
    };
    assert.notEqual(
      fingerprintRepairCaseSourceRow(plain),
      fingerprintRepairCaseSourceRow(formula)
    );
  });

  test("fingerprint changes when legacy fill evidence changes", () => {
    const first = rawCells({ U: "출하 완료" });
    const second = rawCells({ U: "출하 완료" });
    second.U.metadata = {
      ...(second.U.metadata ?? { cellType: "s", rawValue: second.U.value, cachedFormulaValue: null, formula: null, styleIndex: 0 }),
      fill: { fillId: 4, patternType: "solid", foreground: { source: "rgb", value: "FFFFFF00", tint: null, resolvedRgb: "FFFF00" }, background: null },
    };
    assert.notEqual(fingerprintRepairCaseSourceRow(first), fingerprintRepairCaseSourceRow(second));
  });

  test("fingerprint includes A display text and U cell-XF business-color evidence", () => {
    const first = rawCells({ A: "0001", U: "출하 대기" });
    const changedReport = rawCells({ A: "0002", U: "출하 대기" });
    const changedStyle = rawCells({ A: "0001", U: "출하 대기" });
    changedStyle.U.metadata = {
      cellType: "s", rawValue: "출하 대기", cachedFormulaValue: null, formula: null, styleIndex: 119,
      fill: {
        fillId: 5, patternType: "solid",
        foreground: { source: "theme", value: "0", tint: null, resolvedRgb: "000000" },
        background: { source: "indexed", value: "64", tint: null, resolvedRgb: null },
        cellXfApplyFill: true, cellXfId: 0,
      },
    };
    assert.notEqual(fingerprintRepairCaseSourceRow(first), fingerprintRepairCaseSourceRow(changedReport));
    assert.notEqual(fingerprintRepairCaseSourceRow(first), fingerprintRepairCaseSourceRow(changedStyle));
  });

  test("issue DTO rejects arbitrary raw message/value fields", () => {
    const candidate = input();
    candidate.parsedPreview.rows![0].issues = [
      {
        code: "BILLING_AMBIGUOUS",
        severity: "REVIEW",
        rowNumber: 4,
        cellAddress: "D4",
        message: "raw source text must not persist",
      } as never,
    ];
    assert.deepEqual(validateExcelImportPreviewInput(candidate), {
      ok: false,
      code: "INVALID_PREVIEW_INPUT",
    });
  });

  test("malformed issue collections return a stable validation result instead of throwing", () => {
    const malformedSafety = input();
    malformedSafety.safetyValidation.issues = null as never;
    const malformedParse = input();
    malformedParse.parsedPreview.issues = [{ code: "WARNING_CODE", severity: "WARNING", rawValue: "forbidden" } as never];
    assert.deepEqual(validateExcelImportPreviewInput(malformedSafety), {
      ok: false,
      code: "INVALID_PREVIEW_INPUT",
    });
    assert.deepEqual(validateExcelImportPreviewInput(malformedParse), {
      ok: false,
      code: "INVALID_PREVIEW_INPUT",
    });
  });

  test("issue cell location must belong to its source row", () => {
    const candidate = input();
    candidate.parsedPreview.rows![0].issues![0].cellAddress = "D5";
    assert.equal(validateExcelImportPreviewInput(candidate).ok, false);
  });

  test("summary is constructed from stable codes and aggregate counts only", () => {
    const result = validateExcelImportPreviewInput(input());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value.summary, {
      schemaVersion: "repair-case-list-preview-summary-v1",
      totalDataRowsConsidered: 1,
      blankRowsSkipped: 0,
      persistedRows: 1,
      sourceReadyRows: 0,
      sourceReviewRows: 1,
      warningIssues: 0,
      reviewIssues: 1,
      issueCodeCounts: { BILLING_AMBIGUOUS: 1 },
    });
    assert.doesNotMatch(JSON.stringify(result.value.summary), /D260801|customerName|rawData/);
  });

  test("summary includes safe workbook and safety warning code counts", () => {
    const candidate = input({
      safetyValidation: {
        ok: true,
        issues: [{ code: "HYPERLINK_PRESENT", severity: "WARNING" }],
      },
    });
    candidate.parsedPreview.issues = [
      { code: "UNEXPECTED_DATA_OUTSIDE_IMPORT_RANGE", severity: "WARNING", rowNumber: 4, cellAddress: "Z4" },
    ];
    const result = validateExcelImportPreviewInput(candidate);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value.summary.issueCodeCounts, {
      BILLING_AMBIGUOUS: 1,
      HYPERLINK_PRESENT: 1,
      UNEXPECTED_DATA_OUTSIDE_IMPORT_RANGE: 1,
    });
    assert.equal(result.value.summary.warningIssues, 2);
  });

  test("rejects structural parser errors, unsafe files, paths, and oversized files", () => {
    const unsafe = input({ safetyValidation: { ok: false, issues: [{ code: "MACRO_CONTENT_DETECTED", severity: "ERROR" }] } });
    const path = input({ originalFileName: "C:\\private\\repair-cases.xlsx" });
    const structural = input();
    structural.parsedPreview.issues = [{ code: "HEADER_MISMATCH", severity: "ERROR" }];
    for (const candidate of [unsafe, path, structural]) {
      assert.equal(validateExcelImportPreviewInput(candidate).ok, false);
    }
  });
});
