import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ExcelImportNormalizedCandidateInput, ExcelImportRawCellInput } from "./excel-import-preview";
import { buildExcelImportIntakeInput, deriveExcelImportExecutionBatchStatus, intakeYearMonthMismatch, missingExcelImportRequiredFields, workflowKindFromLegacyProductName } from "./excel-import-execution";

function candidate(overrides: Partial<ExcelImportNormalizedCandidateInput> = {}): ExcelImportNormalizedCandidateInput {
  return { intakeNumber: "D240101", receivedDate: "2024-01-15", customerName: "Customer", endUserName: "Site", productName: "Generator", modelName: "MODEL", lotNumber: "LOT", serialNumber: "SERIAL", billingType: "WARRANTY", status: null, ...overrides };
}
function raw(overrides: Record<string, string | null> = {}): Record<string, ExcelImportRawCellInput> {
  return Object.fromEntries("ABCDEFGHIJKLMNOPQRSTUVWXY".split("").map((column) => [column, { value: overrides[column] ?? null, metadata: null }]));
}

describe("Excel Import execution mapping", () => {
  test("derives final batch status from actual row outcomes and keeps exclusions separate", () => {
    assert.equal(deriveExcelImportExecutionBatchStatus({ succeeded: 3, failed: 0, incomplete: 0, excluded: 2 }), "COMPLETED");
    assert.equal(deriveExcelImportExecutionBatchStatus({ succeeded: 2, failed: 1, incomplete: 0, excluded: 0 }), "PARTIAL_SUCCESS");
    assert.equal(deriveExcelImportExecutionBatchStatus({ succeeded: 0, failed: 3, incomplete: 0, excluded: 1 }), "FAILED");
    assert.equal(deriveExcelImportExecutionBatchStatus({ succeeded: 0, failed: 1, incomplete: 1, excluded: 0 }), "IMPORTING");
    assert.equal(deriveExcelImportExecutionBatchStatus({ succeeded: 0, failed: 0, incomplete: 0, excluded: 4 }), null);
  });
  test("uses F only for workflow and S only for reportedSymptom", () => {
    const input = buildExcelImportIntakeInput({ candidate: candidate(), rawColumns: raw({ S: "legacy removal reason" }), customerId: null, endUserId: null, productModelId: null, assignedEngineerId: null });
    assert.ok(input);
    assert.equal(input.workflowType, "WARRANTY_GENERATOR");
    assert.equal(input.reasonForRemoval, null);
    assert.equal(input.reportedSymptom, "legacy removal reason");
  });
  test("maps approved legacy product-kind labels without guessing unknown text", () => {
    for (const value of ["Matcher", "매처", "매쳐", "메처", "메쳐", "matching box", "MB"]) {
      assert.equal(workflowKindFromLegacyProductName(value), "MATCHER");
    }
    assert.equal(workflowKindFromLegacyProductName("RFG"), "GENERATOR");
    for (const value of ["T/C", "TC", "Total Controller", " total-controller ", "Ｔ／Ｃ"]) {
      assert.equal(workflowKindFromLegacyProductName(value), "TOTAL_CONTROLLER");
    }
    assert.equal(workflowKindFromLegacyProductName("unknown"), null);
    assert.equal(workflowKindFromLegacyProductName("T.C"), null);
  });
  test("treats YYMM mismatch as a non-blocking fact", () => {
    assert.equal(intakeYearMonthMismatch("D240101", "2024-02-01"), true);
    assert.equal(intakeYearMonthMismatch("D240101", "2024-01-31"), false);
  });
  test("separates genuinely blank required fields from populated values", () => {
    const missing = missingExcelImportRequiredFields(candidate({ customerName: null, lotNumber: null }), raw());
    assert.deepEqual(missing, ["customer", "lotNumber"]);
  });
  test("pending billing remains executable and resolves to the product-kind pending workflow", () => {
    const pendingCandidate = candidate({ productName: "T/C", billingType: "PENDING_DECISION" });
    assert.deepEqual(missingExcelImportRequiredFields(pendingCandidate, raw({ L: null })), []);
    const input = buildExcelImportIntakeInput({
      candidate: pendingCandidate,
      rawColumns: raw({ L: null }),
      customerId: null,
      endUserId: null,
      productModelId: null,
      assignedEngineerId: null,
    });
    assert.ok(input);
    assert.equal(input.workflowType, "PENDING_TOTAL_CONTROLLER");
    assert.equal(input.billingType, "PENDING_DECISION");
  });
});
