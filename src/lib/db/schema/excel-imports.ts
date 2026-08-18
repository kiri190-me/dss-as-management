import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { customers, endUsers } from "./customers";
import { productModels } from "./product-models";
import { products } from "./products";
import { repairCases } from "./repair-cases";
import { users } from "./users";
import { exceptionStatuses, workflowSteps, workflowVersions } from "./workflow";

export const excelImportBatchStatusEnum = pgEnum("excel_import_batch_status", [
  "PREVIEWED",
  "REVIEW_REQUIRED",
  "READY",
  "IMPORTING",
  "PARTIAL_SUCCESS",
  "COMPLETED",
  "FAILED",
  "EXPIRED",
]);

export const excelImportSourceClassificationEnum = pgEnum(
  "excel_import_source_classification",
  ["SOURCE_READY", "SOURCE_REVIEW"]
);

export const excelImportRowStatusEnum = pgEnum("excel_import_row_status", [
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

export const excelImportAttemptStatusEnum = pgEnum(
  "excel_import_attempt_status",
  ["STARTED", "SUCCEEDED", "FAILED", "ABORTED"]
);

/**
 * Import-only batch metadata. The source workbook itself is temporary and is
 * never stored here. `original_file_name` must be a sanitized display basename,
 * never an absolute client/server path.
 *
 * Exact-file identity deliberately excludes parser/header versions. The
 * unconditional unique index below gives one durable batch identity to one file
 * hash + `목록` sheet. An expired, unconfirmed preview is reparsed by a future
 * guarded reset of the same batch ID; it never creates a second batch. COMPLETED
 * is an irreversible application lifecycle state and must never be reset.
 * Concurrent uploads race safely on the same DB constraint.
 *
 * Static CHECK constraints validate current row shapes but cannot prove state
 * history. Future reset/import mutations must use conditional status + version
 * updates so a terminal batch cannot be changed to EXPIRED even if several
 * columns are changed together.
 *
 * `summary` is aggregate, non-sensitive preview metadata only. It must not hold
 * raw cell values or copies of the row-level sensitive JSON.
 */
export const excelImportBatches = pgTable(
  "excel_import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceFileSha256: text("source_file_sha256").notNull(),
    parserVersion: text("parser_version").notNull(),
    sourceSheet: text("source_sheet").notNull(),
    headerFingerprint: text("header_fingerprint").notNull(),
    originalFileName: text("original_file_name").notNull(),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }).notNull(),
    mimeType: text("mime_type").notNull(),
    status: excelImportBatchStatusEnum("status").notNull(),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull(),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    confirmedBy: uuid("confirmed_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    previewExpiresAt: timestamp("preview_expires_at", { withTimezone: true }).notNull(),
    sensitiveDataRetainUntil: timestamp("sensitive_data_retain_until", {
      withTimezone: true,
    }),
    sensitiveDataPurgedAt: timestamp("sensitive_data_purged_at", {
      withTimezone: true,
    }),
    sourceFileDeletedAt: timestamp("source_file_deleted_at", {
      withTimezone: true,
    }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "excel_import_batches_source_sha256_format",
      sql`${table.sourceFileSha256} ~ '^[0-9a-f]{64}$'`
    ),
    check("excel_import_batches_source_sheet", sql`${table.sourceSheet} = '목록'`),
    check(
      "excel_import_batches_nonblank_metadata",
      sql`btrim(${table.parserVersion}) <> '' and btrim(${table.headerFingerprint}) <> '' and btrim(${table.originalFileName}) <> '' and btrim(${table.mimeType}) <> ''`
    ),
    check(
      "excel_import_batches_sanitized_file_name",
      sql`${table.originalFileName} not in ('.', '..') and position('/' in ${table.originalFileName}) = 0 and position(chr(92) in ${table.originalFileName}) = 0`
    ),
    check("excel_import_batches_file_size_nonnegative", sql`${table.fileSizeBytes} >= 0`),
    check("excel_import_batches_version_positive", sql`${table.version} > 0`),
    check(
      "excel_import_batches_confirmation_pair",
      sql`(${table.confirmedBy} is null) = (${table.confirmedAt} is null)`
    ),
    check(
      "excel_import_batches_status_confirmation",
      sql`(${table.status} in ('PREVIEWED', 'REVIEW_REQUIRED', 'READY', 'EXPIRED') and ${table.confirmedAt} is null) or (${table.status} in ('IMPORTING', 'PARTIAL_SUCCESS', 'COMPLETED', 'FAILED') and ${table.confirmedAt} is not null)`
    ),
    check(
      "excel_import_batches_status_completion",
      sql`(${table.status} in ('PARTIAL_SUCCESS', 'COMPLETED', 'FAILED') and ${table.completedAt} is not null) or (${table.status} in ('PREVIEWED', 'REVIEW_REQUIRED', 'READY', 'IMPORTING', 'EXPIRED') and ${table.completedAt} is null)`
    ),
    check(
      "excel_import_batches_preview_expiration_after_upload",
      sql`${table.previewExpiresAt} > ${table.uploadedAt}`
    ),
    check(
      "excel_import_batches_source_deletion_after_upload",
      sql`${table.sourceFileDeletedAt} is null or ${table.sourceFileDeletedAt} >= ${table.uploadedAt}`
    ),
    check(
      "excel_import_batches_retention_after_completion",
      sql`${table.sensitiveDataRetainUntil} is null or ${table.completedAt} is null or ${table.sensitiveDataRetainUntil} >= ${table.completedAt}`
    ),
    check(
      "excel_import_batches_sensitive_purge_timing",
      sql`${table.sensitiveDataPurgedAt} is null or (${table.sensitiveDataRetainUntil} is not null and ${table.sensitiveDataPurgedAt} >= ${table.sensitiveDataRetainUntil})`
    ),
    uniqueIndex("excel_import_batches_source_unique").on(
      table.sourceFileSha256,
      table.sourceSheet
    ),
    index("excel_import_batches_status_uploaded_at_idx").on(
      table.status,
      table.uploadedAt
    ),
    index("excel_import_batches_uploaded_by_uploaded_at_idx").on(
      table.uploadedBy,
      table.uploadedAt
    ),
    index("excel_import_batches_preview_expires_at_idx").on(
      table.previewExpiresAt
    ),
    index("excel_import_batches_sensitive_retention_idx").on(
      table.sensitiveDataRetainUntil,
      table.sensitiveDataPurgedAt
    ),
  ]
);

/**
 * Import preview rows. `raw_data`, `normalized_data`, `corrections`, and
 * `decisions` may contain customer/End-User names, Model, L/N, S/N, assignee
 * text, and fault descriptions. They must never be copied wholesale into
 * audit_logs, console logs, error messages, or default downloadable error
 * summaries. Retention cleanup is designed to NULL these JSON fields while
 * preserving fingerprints, stable issue/result codes, row location, and
 * Repair Case linkage when the linked case still exists. An IMPORTED row with
 * a NULL `result_repair_case_id` means that the successfully created Repair Case
 * was later permanently deleted; it does not mean that Import failed. The future
 * final-import mutation must still supply a non-null Repair Case when it first
 * changes a row to IMPORTED.
 *
 * `issues` is restricted by application contract to stable codes, locations,
 * and non-sensitive metadata; arbitrary source values must never be stored in
 * it. `source_row_fingerprint` is a lowercase SHA-256 hex digest over the
 * parser's documented deterministic canonical source-row representation.
 */
export const excelImportRows = pgTable(
  "excel_import_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => excelImportBatches.id, { onDelete: "cascade" }),
    sourceSheet: text("source_sheet").notNull(),
    sourceRowNumber: integer("source_row_number").notNull(),
    sourceRowFingerprint: text("source_row_fingerprint").notNull(),
    rawData: jsonb("raw_data").$type<Record<string, unknown>>(),
    normalizedData: jsonb("normalized_data").$type<Record<string, unknown>>(),
    issues: jsonb("issues").$type<unknown[]>().notNull(),
    corrections: jsonb("corrections").$type<Record<string, unknown>>(),
    decisions: jsonb("decisions").$type<Record<string, unknown>>(),
    sourceClassification: excelImportSourceClassificationEnum(
      "source_classification"
    ).notNull(),
    importStatus: excelImportRowStatusEnum("import_status").notNull(),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "restrict",
    }),
    endUserId: uuid("end_user_id").references(() => endUsers.id, {
      onDelete: "restrict",
    }),
    productModelId: uuid("product_model_id").references(() => productModels.id, {
      onDelete: "restrict",
    }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "restrict",
    }),
    assignedEngineerId: uuid("assigned_engineer_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    workflowVersionId: uuid("workflow_version_id").references(
      () => workflowVersions.id,
      { onDelete: "restrict" }
    ),
    workflowStepId: uuid("workflow_step_id").references(() => workflowSteps.id, {
      onDelete: "restrict",
    }),
    exceptionStatusId: uuid("exception_status_id").references(
      () => exceptionStatuses.id,
      { onDelete: "restrict" }
    ),
    matchedExistingRepairCaseId: uuid("matched_existing_repair_case_id").references(
      () => repairCases.id,
      { onDelete: "set null" }
    ),
    resultRepairCaseId: uuid("result_repair_case_id").references(
      () => repairCases.id,
      { onDelete: "set null" }
    ),
    lastErrorCode: text("last_error_code"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    importedBy: uuid("imported_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    importedAt: timestamp("imported_at", { withTimezone: true }),
    sensitiveDataPurgedAt: timestamp("sensitive_data_purged_at", {
      withTimezone: true,
    }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("excel_import_rows_batch_sheet_row_unique").on(
      table.batchId,
      table.sourceSheet,
      table.sourceRowNumber
    ),
    check("excel_import_rows_source_row_minimum", sql`${table.sourceRowNumber} >= 4`),
    check("excel_import_rows_source_sheet", sql`${table.sourceSheet} = '목록'`),
    check(
      "excel_import_rows_fingerprint_format",
      sql`${table.sourceRowFingerprint} ~ '^[0-9a-f]{64}$'`
    ),
    check("excel_import_rows_version_positive", sql`${table.version} > 0`),
    check(
      "excel_import_rows_imported_fields",
      sql`(${table.importStatus} = 'IMPORTED' and ${table.importedBy} is not null and ${table.importedAt} is not null) or (${table.importStatus} <> 'IMPORTED' and ${table.resultRepairCaseId} is null and ${table.importedBy} is null and ${table.importedAt} is null)`
    ),
    check(
      "excel_import_rows_failed_error",
      sql`${table.importStatus} <> 'FAILED' or (${table.lastErrorCode} is not null and btrim(${table.lastErrorCode}) <> '' and ${table.lastErrorAt} is not null)`
    ),
    check(
      "excel_import_rows_sensitive_purge",
      sql`${table.sensitiveDataPurgedAt} is null or (${table.rawData} is null and ${table.normalizedData} is null and ${table.corrections} is null and ${table.decisions} is null)`
    ),
    uniqueIndex("excel_import_rows_result_repair_case_unique")
      .on(table.resultRepairCaseId)
      .where(sql`result_repair_case_id is not null`),
    index("excel_import_rows_batch_status_idx").on(table.batchId, table.importStatus),
    index("excel_import_rows_batch_source_classification_idx").on(
      table.batchId,
      table.sourceClassification
    ),
    index("excel_import_rows_source_fingerprint_idx").on(
      table.sourceRowFingerprint
    ),
    index("excel_import_rows_matched_repair_case_idx").on(
      table.matchedExistingRepairCaseId
    ),
    index("excel_import_rows_sensitive_purge_idx").on(
      table.sensitiveDataPurgedAt
    ),
  ]
);

/**
 * Append-only row import attempts. Application mutations for UPDATE/DELETE are
 * intentionally absent. Store stable error/reason codes only—never raw failure
 * messages or source-cell values. A SUCCEEDED attempt with a NULL
 * `result_repair_case_id` means its Repair Case was later permanently deleted;
 * the success remains historical fact. The future completion mutation must
 * still provide a non-null Repair Case when it records SUCCEEDED.
 */
export const excelImportRowAttempts = pgTable(
  "excel_import_row_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importRowId: uuid("import_row_id")
      .notNull()
      .references(() => excelImportRows.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    status: excelImportAttemptStatusEnum("status").notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorCode: text("error_code"),
    resultRepairCaseId: uuid("result_repair_case_id").references(
      () => repairCases.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("excel_import_row_attempts_row_number_unique").on(
      table.importRowId,
      table.attemptNumber
    ),
    check(
      "excel_import_row_attempts_number_positive",
      sql`${table.attemptNumber} > 0`
    ),
    check(
      "excel_import_row_attempts_state_shape",
      sql`(${table.status} = 'STARTED' and ${table.completedAt} is null and ${table.errorCode} is null and ${table.resultRepairCaseId} is null) or (${table.status} = 'SUCCEEDED' and ${table.completedAt} is not null and ${table.errorCode} is null) or (${table.status} = 'FAILED' and ${table.completedAt} is not null and ${table.errorCode} is not null and btrim(${table.errorCode}) <> '' and ${table.resultRepairCaseId} is null) or (${table.status} = 'ABORTED' and ${table.completedAt} is not null and ${table.resultRepairCaseId} is null)`
    ),
    index("excel_import_row_attempts_status_started_at_idx").on(
      table.status,
      table.startedAt
    ),
    index("excel_import_row_attempts_result_repair_case_idx").on(
      table.resultRepairCaseId
    ),
  ]
);
