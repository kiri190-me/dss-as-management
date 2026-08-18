import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeEntityName } from "../../../src/lib/domain/entity-name-match";
import { hashWorkbookFile, loadWorkbook } from "./workbook-loader";
import { parseRepairCaseListWorkbook } from "./repair-case-list-import";
import { validateRepairCaseXlsxFile } from "./repair-case-xlsx-safety";

const workbookPath = process.env.REPAIR_CASE_IMPORT_TEST_XLSX;
const SIMPLE_MISSING_ISSUE_CODES = new Set([
  "INTAKE_NUMBER_MISSING",
  "RECEIVED_DATE_MISSING",
  "CUSTOMER_MISSING",
  "END_USER_MISSING",
  "PRODUCT_MISSING",
  "MODEL_MISSING",
  "LOT_NUMBER_MISSING",
  "SERIAL_NUMBER_MISSING",
  "BILLING_MISSING",
]);

test(
  "repair-case list real-workbook smoke test",
  { skip: workbookPath ? false : "REPAIR_CASE_IMPORT_TEST_XLSX is not set" },
  () => {
    assert.ok(workbookPath);
    const beforeHash = hashWorkbookFile(workbookPath);
    const safety = validateRepairCaseXlsxFile(workbookPath);
    assert.equal(safety.ok, true);
    const workbook = loadWorkbook(workbookPath);
    const result = parseRepairCaseListWorkbook(workbook, { referenceDate: "2026-08-17" });
    const afterHash = hashWorkbookFile(workbookPath);

    const codeCounts: Record<string, number> = {};
    let ready = 0;
    let review = 0;
    let error = 0;
    let assigneeSourceRows = 0;
    let uniqueNormalizedAssignees = 0;
    let symptomSourceRows = 0;
    let statusSourceRows = 0;
    let legacyCompletedRows = 0;
    let legacyInProgressRows = 0;
    let shipmentDateRows = 0;
    let legacyNotesRows = 0;
    let pendingCompletedRows = 0;
    let pendingInProgressRows = 0;
    let legacyReportNumberRows = 0;
    let legacyReportNumberDuplicateRows = 0;
    const reviewCodeRows = new Map<string, Set<number>>();
    if (result.ok) {
      for (const issue of [...result.issues, ...result.rows.flatMap((row) => row.issues)]) {
        codeCounts[issue.code] = (codeCounts[issue.code] ?? 0) + 1;
      }
      for (const row of result.rows) {
        for (const issue of row.issues) {
          if (issue.severity !== "REVIEW") continue;
          const rowNumbers = reviewCodeRows.get(issue.code) ?? new Set<number>();
          rowNumbers.add(row.sourceRowNumber);
          reviewCodeRows.set(issue.code, rowNumbers);
        }
      }
      const assigneeSources = result.rows
        .map((row) => row.rawCells.X.value?.trim() ?? "")
        .filter(Boolean);
      assigneeSourceRows = assigneeSources.length;
      uniqueNormalizedAssignees = new Set(
        assigneeSources.map(normalizeEntityName)
      ).size;
      symptomSourceRows = result.rows.filter((row) => !!row.rawCells.S.value?.trim()).length;
      statusSourceRows = result.rows.filter((row) => !!row.rawCells.U.value?.trim()).length;
      legacyCompletedRows = result.rows.filter((row) => row.normalized.legacyDisposition === "COMPLETED").length;
      legacyInProgressRows = result.rows.filter((row) => row.normalized.legacyDisposition === "IN_PROGRESS").length;
      shipmentDateRows = result.rows.filter((row) => !!row.normalized.actualShipmentDate).length;
      legacyNotesRows = result.rows.filter((row) => !!row.normalized.legacyNotes).length;
      pendingCompletedRows = result.rows.filter((row) => row.normalized.billingType === "PENDING_DECISION" && row.normalized.legacyDisposition === "COMPLETED").length;
      pendingInProgressRows = result.rows.filter((row) => row.normalized.billingType === "PENDING_DECISION" && row.normalized.legacyDisposition === "IN_PROGRESS").length;
      const reportCounts = new Map<string, number>();
      for (const row of result.rows) {
        if (!row.normalized.legacyReportNumber) continue;
        legacyReportNumberRows++;
        reportCounts.set(row.normalized.legacyReportNumber, (reportCounts.get(row.normalized.legacyReportNumber) ?? 0) + 1);
      }
      legacyReportNumberDuplicateRows = [...reportCounts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
      ready = result.rows.filter((row) => row.sourceClassification === "SOURCE_READY").length;
      review = result.rows.filter((row) => row.sourceClassification === "SOURCE_REVIEW").length;
    } else {
      error = result.issues.length;
      for (const issue of result.issues) codeCounts[issue.code] = (codeCounts[issue.code] ?? 0) + 1;
    }

    console.log(JSON.stringify({
      safetyValidationPassed: safety.ok,
      safetyIssueCodeCounts: Object.fromEntries(
        [...new Set(safety.issues.map((candidate) => candidate.code))].map((code) => [
          code,
          safety.issues.filter((candidate) => candidate.code === code).length,
        ])
      ),
      selectedSheet: "목록",
      headerValid: result.headerValid,
      sourceClassificationCounts: { SOURCE_READY: ready, SOURCE_REVIEW: review, ERROR: error },
      missingIssueCodeCounts: Object.fromEntries(
        Object.entries(codeCounts).filter(([code]) => SIMPLE_MISSING_ISSUE_CODES.has(code))
      ),
      receivedDateIssueCodeCounts: Object.fromEntries(
        Object.entries(codeCounts).filter(([code]) => code.startsWith("RECEIVED_DATE_"))
      ),
      billingPendingNoticeCounts: Object.fromEntries(
        Object.entries(codeCounts).filter(([code]) => code.startsWith("BILLING_PENDING_"))
      ),
      assigneeSourceRows,
      uniqueNormalizedAssignees,
      symptomSourceRows,
      statusSourceRows,
      legacyDispositionCounts: { completed: legacyCompletedRows, inProgress: legacyInProgressRows, unresolved: result.ok ? result.rows.length - legacyCompletedRows - legacyInProgressRows : 0 },
      shipmentDateRows,
      legacyNotesRows,
      pendingBillingDispositionCounts: { completed: pendingCompletedRows, inProgress: pendingInProgressRows },
      legacyReportNumberCounts: { present: legacyReportNumberRows, duplicateRows: legacyReportNumberDuplicateRows },
      reviewCodeRowCounts: Object.fromEntries(
        [...reviewCodeRows.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([code, rows]) => [code, rows.size])
      ),
      sourceHashUnchanged: beforeHash === afterHash,
    }));

    assert.equal(result.ok, true);
    assert.equal(beforeHash, afterHash);
    assert.equal(ready, 602);
    assert.equal(review, 59);
    assert.equal(error, 0);
    assert.equal(assigneeSourceRows, 502);
    assert.equal(uniqueNormalizedAssignees, 173);
    assert.deepEqual(
      Object.fromEntries(
        [...reviewCodeRows.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([code, rows]) => [code, rows.size])
      ),
      {
        BUSINESS_COLOR_REQUIRES_REVIEW: 7,
        INTAKE_NUMBER_MALFORMED: 8,
        MULTIPLE_DATES_IN_CELL: 34,
        SHIPMENT_DATE_MULTIPLE: 5,
        SHIPMENT_DATE_UNINTERPRETABLE: 9,
      }
    );
    assert.equal(symptomSourceRows, 661);
    assert.equal(statusSourceRows, 659);
    assert.equal(legacyCompletedRows, 631);
    assert.equal(legacyInProgressRows, 23);
    assert.equal(result.rows.length - legacyCompletedRows - legacyInProgressRows, 7);
    assert.equal(pendingCompletedRows, 22);
    assert.equal(pendingInProgressRows, 0);
    assert.deepEqual(
      Object.fromEntries(Object.entries(codeCounts).filter(([code]) => code.startsWith("BILLING_PENDING_"))),
      { BILLING_PENDING_EMPTY: 6, BILLING_PENDING_UNRESOLVED: 17 }
    );
    assert.equal(
      Object.entries(codeCounts)
        .filter(([code]) => SIMPLE_MISSING_ISSUE_CODES.has(code))
        .reduce((total, [, count]) => total + count, 0),
      0
    );
  }
);
