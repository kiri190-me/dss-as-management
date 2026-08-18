import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildExcelImportPreviewHref,
  excelImportPreviewClassificationReason,
  matchesExcelImportPreviewFilter,
  parseExcelImportPreviewFilter,
} from "./excel-import-preview-filter";

describe("Excel Import Preview filters", () => {
  test("accepts only the allow-listed URL values and defaults invalid values to ALL", () => {
    assert.equal(parseExcelImportPreviewFilter("EXECUTABLE"), "EXECUTABLE");
    assert.equal(parseExcelImportPreviewFilter("IMPORTED"), "IMPORTED");
    assert.equal(parseExcelImportPreviewFilter("FAILED"), "ALL");
    assert.equal(parseExcelImportPreviewFilter("anything"), "ALL");
    assert.equal(parseExcelImportPreviewFilter(undefined), "ALL");
  });

  test("keeps classifications disjoint while ALL includes every row", () => {
    const classifications = ["EXECUTABLE", "AUTO_EXCLUDED", "CONFLICT", "IMPORTED", "FAILED"] as const;
    for (const classification of classifications) {
      assert.equal(matchesExcelImportPreviewFilter(classification, "ALL"), true);
    }
    assert.equal(matchesExcelImportPreviewFilter("CONFLICT", "CONFLICT"), true);
    assert.equal(matchesExcelImportPreviewFilter("AUTO_EXCLUDED", "CONFLICT"), false);
    assert.equal(matchesExcelImportPreviewFilter("IMPORTED", "EXECUTABLE"), false);
  });

  test("resets filter changes to page one and preserves a filter during pagination", () => {
    assert.equal(
      buildExcelImportPreviewHref({ batchId: "batch-id", filter: "CONFLICT" }),
      "/excel-imports/repair-cases?batch=batch-id&filter=CONFLICT",
    );
    assert.equal(
      buildExcelImportPreviewHref({ batchId: "batch-id", filter: "CONFLICT", page: 3 }),
      "/excel-imports/repair-cases?batch=batch-id&filter=CONFLICT&page=3",
    );
    assert.equal(
      buildExcelImportPreviewHref({ batchId: "batch-id", filter: "ALL", page: 1 }),
      "/excel-imports/repair-cases?batch=batch-id",
    );
  });

  test("provides a safe Korean reason for every row classification", () => {
    for (const classification of ["EXECUTABLE", "AUTO_EXCLUDED", "CONFLICT", "IMPORTED", "FAILED"] as const) {
      assert.notEqual(excelImportPreviewClassificationReason(classification).trim(), "");
    }
  });
});
