import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { getTableName } from "drizzle-orm";
import {
  excelImportAttemptStatusEnum,
  excelImportBatches,
  excelImportBatchStatusEnum,
  excelImportRowAttempts,
  excelImportRows,
  excelImportRowStatusEnum,
  excelImportSourceClassificationEnum,
} from "./excel-imports";

const migration = readFileSync(
  join(
    process.cwd(),
    "drizzle",
    "0032_excel_import_persistence_schema_foundation.sql"
  ),
  "utf8"
);

describe("Excel Import persistence schema foundation", () => {
  test("exports the approved tables and enum state models", () => {
    assert.equal(getTableName(excelImportBatches), "excel_import_batches");
    assert.equal(getTableName(excelImportRows), "excel_import_rows");
    assert.equal(getTableName(excelImportRowAttempts), "excel_import_row_attempts");

    assert.deepEqual(excelImportBatchStatusEnum.enumValues, [
      "PREVIEWED",
      "REVIEW_REQUIRED",
      "READY",
      "IMPORTING",
      "PARTIAL_SUCCESS",
      "COMPLETED",
      "FAILED",
      "EXPIRED",
    ]);
    assert.deepEqual(excelImportSourceClassificationEnum.enumValues, [
      "SOURCE_READY",
      "SOURCE_REVIEW",
    ]);
    assert.deepEqual(excelImportRowStatusEnum.enumValues, [
      "PENDING_REVIEW",
      "MAPPING_REQUIRED",
      "IMPORT_READY",
      "IMPORTING",
      "IMPORTED",
      "FAILED",
      "SKIPPED_EXISTING",
      "EXCLUDED",
      "EXPIRED",
    ]);
    assert.deepEqual(excelImportAttemptStatusEnum.enumValues, [
      "STARTED",
      "SUCCEEDED",
      "FAILED",
      "ABORTED",
    ]);
  });

  test("migration contains only the three approved tables", () => {
    const createdTables = [...migration.matchAll(/CREATE TABLE "([^"]+)"/g)].map(
      (match) => match[1]
    );
    assert.deepEqual(createdTables, [
      "excel_import_batches",
      "excel_import_row_attempts",
      "excel_import_rows",
    ]);
    assert.doesNotMatch(migration, /ALTER TABLE "(customers|end_users|products|repair_cases)"/);
  });

  test("exact-file idempotency is unconditional and excludes parser metadata", () => {
    assert.match(
      migration,
      /CREATE UNIQUE INDEX "excel_import_batches_source_unique"[\s\S]*\("source_file_sha256","source_sheet"\);/
    );
    const uniqueIndexStatement = migration.match(
      /CREATE UNIQUE INDEX "excel_import_batches_source_unique"[^;]+;/
    )?.[0];
    assert.ok(uniqueIndexStatement);
    assert.doesNotMatch(
      uniqueIndexStatement,
      /parser_version|header_fingerprint|WHERE/
    );
  });

  test("migration encodes approved child and business-reference deletion policies", () => {
    assert.match(
      migration,
      /"batch_id"\) REFERENCES "public"\."excel_import_batches"\("id"\) ON DELETE cascade/
    );
    assert.match(
      migration,
      /"import_row_id"\) REFERENCES "public"\."excel_import_rows"\("id"\) ON DELETE cascade/
    );
    assert.match(
      migration,
      /"result_repair_case_id"\) REFERENCES "public"\."repair_cases"\("id"\) ON DELETE set null/
    );
    assert.match(
      migration,
      /"customer_id"\) REFERENCES "public"\."customers"\("id"\) ON DELETE restrict/
    );
  });

  test("migration includes lifecycle, retention, row-result, and attempt-shape guards", () => {
    for (const constraint of [
      "excel_import_batches_source_sha256_format",
      "excel_import_batches_sanitized_file_name",
      "excel_import_batches_confirmation_pair",
      "excel_import_batches_status_confirmation",
      "excel_import_batches_status_completion",
      "excel_import_batches_sensitive_purge_timing",
      "excel_import_rows_fingerprint_format",
      "excel_import_rows_imported_fields",
      "excel_import_rows_sensitive_purge",
      "excel_import_row_attempts_state_shape",
    ]) {
      assert.match(migration, new RegExp(`CONSTRAINT "${constraint}"`));
    }
    assert.match(
      migration,
      /CREATE UNIQUE INDEX "excel_import_rows_result_repair_case_unique"[\s\S]*WHERE result_repair_case_id is not null/
    );
  });

  test("batch checks enforce every approved current-state timestamp shape", () => {
    const confirmationCheck = migration.match(
      /CONSTRAINT "excel_import_batches_status_confirmation" CHECK \((.+)\),/
    )?.[1];
    const completionCheck = migration.match(
      /CONSTRAINT "excel_import_batches_status_completion" CHECK \((.+)\),/
    )?.[1];
    assert.ok(confirmationCheck);
    assert.ok(completionCheck);
    assert.match(confirmationCheck, /'PREVIEWED', 'REVIEW_REQUIRED', 'READY', 'EXPIRED'/);
    assert.match(confirmationCheck, /'IMPORTING', 'PARTIAL_SUCCESS', 'COMPLETED', 'FAILED'/);
    assert.match(completionCheck, /'PARTIAL_SUCCESS', 'COMPLETED', 'FAILED'/);
    assert.match(completionCheck, /'PREVIEWED', 'REVIEW_REQUIRED', 'READY', 'IMPORTING', 'EXPIRED'/);
  });

  test("Repair Case SET NULL preserves successful historical states", () => {
    const importedCheck = migration.match(
      /CONSTRAINT "excel_import_rows_imported_fields" CHECK \((.+)\),/
    )?.[1];
    const attemptCheck = migration.match(
      /CONSTRAINT "excel_import_row_attempts_state_shape" CHECK \((.+)\)/
    )?.[1];
    assert.ok(importedCheck);
    assert.ok(attemptCheck);

    assert.match(importedCheck, /import_status" = 'IMPORTED'/);
    assert.match(importedCheck, /imported_by" is not null/);
    assert.match(importedCheck, /imported_at" is not null/);
    assert.doesNotMatch(importedCheck, /result_repair_case_id" is not null/);

    assert.match(attemptCheck, /status" = 'SUCCEEDED'/);
    assert.match(attemptCheck, /completed_at" is not null/);
    assert.match(attemptCheck, /status" = 'FAILED'/);
    assert.match(attemptCheck, /error_code" is not null/);
    assert.doesNotMatch(attemptCheck, /result_repair_case_id" is not null/);
  });

  test("does not generate indexes duplicated by approved unique indexes", () => {
    assert.doesNotMatch(migration, /excel_import_batches_source_identity_idx/);
    assert.doesNotMatch(migration, /excel_import_row_attempts_row_number_idx/);
    assert.doesNotMatch(migration, /excel_import_rows_result_repair_case_idx/);
    assert.match(migration, /excel_import_row_attempts_result_repair_case_idx/);
    assert.match(migration, /excel_import_rows_matched_repair_case_idx/);
  });
});
