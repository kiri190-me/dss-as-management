import "../../../../scripts/load-env";

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import {
  EXCEL_IMPORT_COLUMNS,
  type ExcelImportParsedRowInput,
  type ExcelImportPreviewBoundaryInput,
  type ExcelImportRawCellInput,
} from "@/lib/domain/excel-import-preview";
import { db, pgClient } from "../connection";
import {
  auditLogs,
  customers,
  endUsers,
  excelImportBatches,
  excelImportRowAttempts,
  excelImportRows,
  inventoryPartRequests,
  productModels,
  products,
  repairCases,
  repairCaseWorkRecords,
  stockTransactions,
  users,
} from "../schema";
import { persistExcelImportPreview } from "./excel-import-preview";

const SUITE_ID = randomUUID();
const TEST_EMAIL_PREFIX = `excel-import-preview-${SUITE_ID}`;
const createdUserIds: string[] = [];
const createdBatchIds: string[] = [];
const createdCustomerIds: string[] = [];
const createdEndUserIds: string[] = [];
const createdProductModelIds: string[] = [];

type ProtectedCounts = Awaited<ReturnType<typeof protectedCounts>>;
let baseline: ProtectedCounts;
let actors: Record<
  | "superAdmin"
  | "admin"
  | "engineer"
  | "sales"
  | "inventory"
  | "deletedAdmin"
  | "pendingAdmin",
  string
>;

function testHash(label: string): string {
  return createHash("sha256")
    .update(`excel-import-preview-test:${SUITE_ID}:${label}`, "utf8")
    .digest("hex");
}

function rawCells(seed: string): Record<string, ExcelImportRawCellInput> {
  return Object.fromEntries(
    EXCEL_IMPORT_COLUMNS.map((column) => [
      column,
      {
        value: column === "A" ? seed : null,
        metadata: null,
      },
    ])
  );
}

function parsedRow(
  rowNumber: number,
  classification: "SOURCE_READY" | "SOURCE_REVIEW",
  seed = `row-${rowNumber}`
): ExcelImportParsedRowInput {
  return {
    sourceSheet: "목록",
    sourceRowNumber: rowNumber,
    rawCells: rawCells(seed),
    normalized: {
      intakeNumber: null,
      receivedDate: null,
      customerName: null,
      endUserName: null,
      productName: null,
      modelName: null,
      lotNumber: null,
      serialNumber: null,
      billingType: null,
      status: null,
    },
    sourceClassification: classification,
    issues:
      classification === "SOURCE_REVIEW"
        ? [{ code: "BILLING_AMBIGUOUS", severity: "REVIEW" as const, rowNumber, cellAddress: `L${rowNumber}` }]
        : [],
  };
}

function parsedAssigneeRow(rowNumber: number, assignee: string): ExcelImportParsedRowInput {
  const row = parsedRow(rowNumber, "SOURCE_READY");
  return {
    ...row,
    rawCells: {
      ...row.rawCells,
      X: { value: assignee, metadata: null },
    },
    issues: [
      {
        code: "ASSIGNEE_MAPPING_PENDING",
        severity: "WARNING" as const,
        rowNumber,
        cellAddress: `X${rowNumber}`,
      },
    ],
  };
}

function parsedReferenceRow(input: {
  rowNumber: number;
  customer: string;
  endUser: string;
  model: string;
  assignee: string;
  seed: string;
}): ExcelImportParsedRowInput {
  const row = parsedRow(input.rowNumber, "SOURCE_READY", input.seed);
  return {
    ...row,
    rawCells: {
      ...row.rawCells,
      D: { value: input.customer, metadata: null },
      E: { value: input.endUser, metadata: null },
      G: { value: input.model, metadata: null },
      X: { value: input.assignee, metadata: null },
    },
    normalized: {
      ...row.normalized,
      customerName: input.customer,
      endUserName: input.endUser,
      modelName: input.model,
    },
    issues: [
      { code: "CUSTOMER_MAPPING_PENDING", severity: "WARNING", rowNumber: input.rowNumber, cellAddress: `D${input.rowNumber}` },
      { code: "END_USER_MAPPING_PENDING", severity: "WARNING", rowNumber: input.rowNumber, cellAddress: `E${input.rowNumber}` },
      { code: "PRODUCT_MODEL_MAPPING_PENDING", severity: "WARNING", rowNumber: input.rowNumber, cellAddress: `G${input.rowNumber}` },
      { code: "ASSIGNEE_MAPPING_PENDING", severity: "WARNING", rowNumber: input.rowNumber, cellAddress: `X${input.rowNumber}` },
    ],
  };
}

function previewInput(
  label: string,
  uploadedBy: string,
  rows = [parsedRow(4, "SOURCE_REVIEW")],
  overrides: Partial<ExcelImportPreviewBoundaryInput> = {}
): ExcelImportPreviewBoundaryInput {
  return {
    sourceFileSha256: testHash(label),
    parserVersion: "repair-case-list-parser-v1",
    sourceSheet: "목록",
    headerFingerprint: testHash("approved-header-v1"),
    originalFileName: "test-repair-cases.xlsx",
    fileSizeBytes: 4096,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    uploadedBy,
    now: new Date("2026-08-17T01:00:00.000Z"),
    safetyValidation: { ok: true, issues: [] },
    parsedPreview: {
      ok: true,
      sourceSheet: "목록",
      headerValid: true,
      totalDataRowsConsidered: rows.length,
      blankRowsSkipped: 0,
      rows: rows as never,
      issues: [],
    },
    ...overrides,
  };
}

async function protectedCounts() {
  const results = await Promise.all([
    db.select({ value: sql<number>`count(*)::int` }).from(users),
    db.select({ value: sql<number>`count(*)::int` }).from(customers),
    db.select({ value: sql<number>`count(*)::int` }).from(endUsers),
    db.select({ value: sql<number>`count(*)::int` }).from(productModels),
    db.select({ value: sql<number>`count(*)::int` }).from(products),
    db.select({ value: sql<number>`count(*)::int` }).from(repairCases),
    db.select({ value: sql<number>`count(*)::int` }).from(auditLogs),
    db.select({ value: sql<number>`count(*)::int` }).from(repairCaseWorkRecords),
    db.select({ value: sql<number>`count(*)::int` }).from(stockTransactions),
    db.select({ value: sql<number>`count(*)::int` }).from(inventoryPartRequests),
  ]);
  return {
    users: results[0][0].value,
    customers: results[1][0].value,
    endUsers: results[2][0].value,
    productModels: results[3][0].value,
    products: results[4][0].value,
    repairCases: results[5][0].value,
    auditLogs: results[6][0].value,
    repairCaseWorkRecords: results[7][0].value,
    stockTransactions: results[8][0].value,
    inventoryPartRequests: results[9][0].value,
  };
}

async function rememberBatch(batchId: string) {
  if (!createdBatchIds.includes(batchId)) createdBatchIds.push(batchId);
}

async function createPreview(
  label: string,
  rows = [parsedRow(4, "SOURCE_REVIEW")],
  overrides: Partial<ExcelImportPreviewBoundaryInput> = {}
) {
  const result = await persistExcelImportPreview(previewInput(label, actors.admin, rows, overrides));
  assert.equal(result.ok, true, `expected test preview creation to succeed (${label})`);
  if (!result.ok) throw new Error("test setup failed");
  await rememberBatch(result.batch.batchId);
  return result;
}

before(async () => {
  baseline = await protectedCounts();
  const definitions = [
    ["superAdmin", "SUPER_ADMIN", "APPROVED", false],
    ["admin", "ADMIN", "APPROVED", false],
    ["engineer", "AS_ENGINEER", "APPROVED", false],
    ["sales", "SALES", "APPROVED", false],
    ["inventory", "INVENTORY_MANAGER", "APPROVED", false],
    ["deletedAdmin", "ADMIN", "APPROVED", true],
    ["pendingAdmin", "ADMIN", "PENDING", false],
  ] as const;
  actors = {} as typeof actors;
  for (const [key, role, approvalStatus, isDeleted] of definitions) {
    const [actor] = await db
      .insert(users)
      .values({
        email: `${TEST_EMAIL_PREFIX}-${key}@example.invalid`,
        name: `Excel Import Test ${key}`,
        role,
        approvalStatus,
        isDeleted,
      })
      .returning({ id: users.id });
    actors[key] = actor.id;
    createdUserIds.push(actor.id);
  }
});

after(async () => {
  if (createdBatchIds.length > 0) {
    await db.delete(excelImportBatches).where(inArray(excelImportBatches.id, createdBatchIds));
  }
  if (createdEndUserIds.length > 0) {
    await db.delete(endUsers).where(inArray(endUsers.id, createdEndUserIds));
  }
  if (createdCustomerIds.length > 0) {
    await db.delete(customers).where(inArray(customers.id, createdCustomerIds));
  }
  if (createdProductModelIds.length > 0) {
    await db.delete(productModels).where(inArray(productModels.id, createdProductModelIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
  assert.deepEqual(await protectedCounts(), baseline);
  await pgClient.end({ timeout: 5 });
});

describe("persistExcelImportPreview", () => {
  test("allows approved ADMIN and SUPER_ADMIN actors", async () => {
    for (const [label, actor] of [
      ["authorized-admin", actors.admin],
      ["authorized-super-admin", actors.superAdmin],
    ] as const) {
      const result = await persistExcelImportPreview(previewInput(label, actor));
      assert.equal(result.ok, true);
      if (result.ok) await rememberBatch(result.batch.batchId);
    }
  });

  test("denies every non-admin role without creating a batch", async () => {
    for (const [label, actor] of [
      ["denied-engineer", actors.engineer],
      ["denied-sales", actors.sales],
      ["denied-inventory", actors.inventory],
    ] as const) {
      const result = await persistExcelImportPreview(previewInput(label, actor));
      assert.deepEqual(result, { ok: false, code: "ACTOR_NOT_ALLOWED" });
      const [row] = await db
        .select({ id: excelImportBatches.id })
        .from(excelImportBatches)
        .where(eq(excelImportBatches.sourceFileSha256, testHash(label)));
      assert.equal(row, undefined);
    }
  });

  test("denies deleted, unapproved, and missing actors", async () => {
    for (const [label, actor] of [
      ["denied-deleted", actors.deletedAdmin],
      ["denied-pending", actors.pendingAdmin],
      ["denied-missing", randomUUID()],
    ] as const) {
      const result = await persistExcelImportPreview(previewInput(label, actor));
      assert.deepEqual(result, { ok: false, code: "ACTOR_NOT_ALLOWED" });
    }
  });

  test("atomically persists mixed rows with safe initial states and NULL links", async () => {
    const result = await createPreview("mixed", [
      parsedRow(4, "SOURCE_READY"),
      parsedRow(5, "SOURCE_REVIEW"),
    ]);
    assert.equal(result.batch.status, "REVIEW_REQUIRED");
    const [batch] = await db
      .select()
      .from(excelImportBatches)
      .where(eq(excelImportBatches.id, result.batch.batchId));
    assert.equal(batch.sourceFileDeletedAt, null);
    assert.equal(batch.confirmedAt, null);
    assert.equal(batch.completedAt, null);
    assert.equal(batch.version, 1);
    assert.equal(
      batch.previewExpiresAt.getTime() - batch.uploadedAt.getTime(),
      7 * 24 * 60 * 60 * 1000
    );

    const rows = await db
      .select()
      .from(excelImportRows)
      .where(eq(excelImportRows.batchId, result.batch.batchId));
    assert.deepEqual(
      rows.map((row) => [row.sourceRowNumber, row.sourceClassification, row.importStatus]),
      [
        [4, "SOURCE_READY", "IMPORT_READY"],
        [5, "SOURCE_REVIEW", "PENDING_REVIEW"],
      ]
    );
    for (const row of rows) {
      assert.equal(row.customerId, null);
      assert.equal(row.endUserId, null);
      assert.equal(row.productModelId, null);
      assert.equal(row.productId, null);
      assert.equal(row.assignedEngineerId, null);
      assert.equal(row.workflowVersionId, null);
      assert.equal(row.workflowStepId, null);
      assert.equal(row.exceptionStatusId, null);
      assert.equal(row.matchedExistingRepairCaseId, null);
      assert.equal(row.resultRepairCaseId, null);
      assert.equal(row.importedBy, null);
      assert.equal(row.importedAt, null);
    }
  });

  test("all SOURCE_READY rows produce a PREVIEWED batch", async () => {
    const result = await createPreview("all-ready", [
      parsedRow(4, "SOURCE_READY"),
      parsedRow(5, "SOURCE_READY"),
    ]);
    assert.equal(result.batch.status, "PREVIEWED");
  });

  test("resolves assignee groups once and separates exact, pending, and multiple matches", async () => {
    const duplicateName = `Excel Import Duplicate ${SUITE_ID}`;
    const duplicates = await db
      .insert(users)
      .values([
        { email: `${TEST_EMAIL_PREFIX}-duplicate-a@example.invalid`, name: duplicateName, role: "AS_ENGINEER", approvalStatus: "APPROVED" },
        { email: `${TEST_EMAIL_PREFIX}-duplicate-b@example.invalid`, name: duplicateName, role: "AS_ENGINEER", approvalStatus: "APPROVED" },
      ])
      .returning({ id: users.id });
    createdUserIds.push(...duplicates.map((user) => user.id));

    const result = await createPreview("assignee-resolution", [
      parsedAssigneeRow(4, "  Excel   Import Test engineer  "),
      parsedAssigneeRow(5, `Unmatched ${SUITE_ID}`),
      parsedAssigneeRow(6, duplicateName),
    ]);
    assert.deepEqual(result.batch.rowCounts, { total: 3, sourceReady: 3, sourceReview: 0 });
    const rows = await db
      .select({
        rowNumber: excelImportRows.sourceRowNumber,
        classification: excelImportRows.sourceClassification,
        assignedEngineerId: excelImportRows.assignedEngineerId,
        issues: excelImportRows.issues,
      })
      .from(excelImportRows)
      .where(eq(excelImportRows.batchId, result.batch.batchId));
    const exact = rows.find((row) => row.rowNumber === 4);
    const pending = rows.find((row) => row.rowNumber === 5);
    const multiple = rows.find((row) => row.rowNumber === 6);
    assert.equal(exact?.assignedEngineerId, actors.engineer);
    assert.ok((exact?.issues as Array<{ code: string }>).some((issue) => issue.code === "ASSIGNEE_AUTO_MATCHED"));
    assert.equal(pending?.assignedEngineerId, null);
    assert.equal(pending?.classification, "SOURCE_READY");
    assert.ok((pending?.issues as Array<{ code: string }>).some((issue) => issue.code === "ASSIGNEE_MAPPING_PENDING"));
    assert.equal(multiple?.assignedEngineerId, null);
    assert.equal(multiple?.classification, "SOURCE_READY");
    assert.ok((multiple?.issues as Array<{ code: string }>).some((issue) => issue.code === "ASSIGNEE_MAPPING_PENDING"));
  });

  test("confirmed v3 refresh discards preview mappings and recalculates all resolver FKs from v6 source", async () => {
    const [oldCustomer] = await db.insert(customers).values({ name: `Refresh Old Customer ${SUITE_ID}` }).returning({ id: customers.id });
    const [nextCustomer] = await db.insert(customers).values({ name: `Refresh Next Customer ${SUITE_ID}` }).returning({ id: customers.id });
    createdCustomerIds.push(oldCustomer.id, nextCustomer.id);
    const [oldEndUser] = await db.insert(endUsers).values({ customerId: oldCustomer.id, name: `Refresh Old End User ${SUITE_ID}` }).returning({ id: endUsers.id });
    const [nextEndUser] = await db.insert(endUsers).values({ customerId: nextCustomer.id, name: `Refresh Next End User ${SUITE_ID}` }).returning({ id: endUsers.id });
    createdEndUserIds.push(oldEndUser.id, nextEndUser.id);
    const [oldModel] = await db.insert(productModels).values({ modelName: `Refresh Old Model ${SUITE_ID}` }).returning({ id: productModels.id });
    const [nextModel] = await db.insert(productModels).values({ modelName: `Refresh Next Model ${SUITE_ID}` }).returning({ id: productModels.id });
    createdProductModelIds.push(oldModel.id, nextModel.id);
    const [nextEngineer] = await db.insert(users).values({
      email: `${TEST_EMAIL_PREFIX}-refresh-engineer@example.invalid`,
      name: `Refresh Next Engineer ${SUITE_ID}`,
      role: "AS_ENGINEER",
      approvalStatus: "APPROVED",
    }).returning({ id: users.id });
    createdUserIds.push(nextEngineer.id);

    const oldRow = parsedReferenceRow({
      rowNumber: 4,
      customer: `Refresh Old Customer ${SUITE_ID}`,
      endUser: `Refresh Old End User ${SUITE_ID}`,
      model: `Refresh Old Model ${SUITE_ID}`,
      assignee: "Excel Import Test engineer",
      seed: "parser-v3",
    });
    const created = await createPreview(
      "parser-refresh",
      [oldRow],
      { parserVersion: "repair-case-list-parser-v3" }
    );
    const [storedOld] = await db.select({
      id: excelImportRows.id,
      fingerprint: excelImportRows.sourceRowFingerprint,
      customerId: excelImportRows.customerId,
      endUserId: excelImportRows.endUserId,
      productModelId: excelImportRows.productModelId,
      assignedEngineerId: excelImportRows.assignedEngineerId,
    }).from(excelImportRows).where(eq(excelImportRows.batchId, created.batch.batchId));
    assert.deepEqual(
      [storedOld.customerId, storedOld.endUserId, storedOld.productModelId, storedOld.assignedEngineerId],
      [oldCustomer.id, oldEndUser.id, oldModel.id, actors.engineer]
    );
    await db.update(excelImportRows).set({
      decisions: {
        schemaVersion: "excel-import-master-mapping-v1",
        customer: "USER_SELECTED",
        endUser: "USER_SELECTED",
        productModel: "USER_SELECTED",
        assignee: "USER_SELECTED",
      },
    }).where(eq(excelImportRows.id, storedOld.id));

    const nextRow = parsedReferenceRow({
      rowNumber: 4,
      customer: `Refresh Next Customer ${SUITE_ID}`,
      endUser: `Refresh Next End User ${SUITE_ID}`,
      model: `Refresh Next Model ${SUITE_ID}`,
      assignee: `Refresh Next Engineer ${SUITE_ID}`,
      seed: "parser-v6",
    });
    const nextInput = previewInput(
      "parser-refresh",
      actors.admin,
      [nextRow],
      { parserVersion: "repair-case-list-parser-v6" }
    );
    const requiresConfirmation = await persistExcelImportPreview(nextInput);
    assert.equal(requiresConfirmation.ok, false);
    if (requiresConfirmation.ok) return;
    assert.equal(requiresConfirmation.code, "PARSER_REFRESH_REQUIRES_CONFIRMATION");
    assert.equal(requiresConfirmation.batch?.version, created.batch.version);

    const stale = await persistExcelImportPreview({
      ...nextInput,
      refreshExistingBatchId: created.batch.batchId,
      expectedBatchVersion: created.batch.version + 1,
      confirmParserRefresh: true,
    });
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.code, "STALE_BATCH_VERSION");

    const refreshed = await persistExcelImportPreview({
      ...nextInput,
      refreshExistingBatchId: created.batch.batchId,
      expectedBatchVersion: created.batch.version,
      confirmParserRefresh: true,
    });
    assert.equal(refreshed.ok, true);
    if (!refreshed.ok) return;
    assert.equal(refreshed.outcome, "REFRESH");
    assert.equal(refreshed.batch.batchId, created.batch.batchId);
    assert.equal(refreshed.batch.version, created.batch.version + 1);
    const [batch] = await db.select({ parserVersion: excelImportBatches.parserVersion }).from(excelImportBatches).where(eq(excelImportBatches.id, created.batch.batchId));
    assert.equal(batch.parserVersion, "repair-case-list-parser-v6");
    const [storedNext] = await db.select({
      id: excelImportRows.id,
      fingerprint: excelImportRows.sourceRowFingerprint,
      customerId: excelImportRows.customerId,
      endUserId: excelImportRows.endUserId,
      productModelId: excelImportRows.productModelId,
      assignedEngineerId: excelImportRows.assignedEngineerId,
      decisions: excelImportRows.decisions,
    }).from(excelImportRows).where(eq(excelImportRows.batchId, created.batch.batchId));
    assert.notEqual(storedNext.id, storedOld.id);
    assert.notEqual(storedNext.fingerprint, storedOld.fingerprint);
    assert.deepEqual(
      [storedNext.customerId, storedNext.endUserId, storedNext.productModelId, storedNext.assignedEngineerId],
      [nextCustomer.id, nextEndUser.id, nextModel.id, nextEngineer.id]
    );
    assert.deepEqual(storedNext.decisions, {
      schemaVersion: "excel-import-master-mapping-v1",
      customer: "AUTO_EXACT",
      endUser: "AUTO_EXACT",
      productModel: "AUTO_EXACT",
      assignee: "AUTO_EXACT",
    });

    const sameParser = await persistExcelImportPreview(nextInput);
    assert.equal(sameParser.ok, false);
    if (!sameParser.ok) assert.equal(sameParser.code, "EXISTING_PREVIEW");
  });

  test("persists 661 rows through bounded chunks in one batch", async () => {
    const rows = Array.from({ length: 661 }, (_, index) =>
      parsedRow(index + 4, "SOURCE_READY", `bulk-${index}`)
    );
    const result = await createPreview("bulk-661", rows);
    assert.deepEqual(result.batch.rowCounts, {
      total: 661,
      sourceReady: 661,
      sourceReview: 0,
    });
    const [count] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(excelImportRows)
      .where(eq(excelImportRows.batchId, result.batch.batchId));
    assert.equal(count.value, 661);
  });

  test("same-file sequential persistence returns EXISTING_PREVIEW without duplicate rows", async () => {
    const created = await createPreview("sequential-reuse");
    const reused = await persistExcelImportPreview(previewInput("sequential-reuse", actors.admin));
    assert.equal(reused.ok, false);
    if (reused.ok) return;
    assert.equal(reused.code, "EXISTING_PREVIEW");
    assert.equal(reused.batch?.batchId, created.batch.batchId);
    const rows = await db
      .select({ id: excelImportRows.id })
      .from(excelImportRows)
      .where(eq(excelImportRows.batchId, created.batch.batchId));
    assert.equal(rows.length, 1);
  });

  test("concurrent same-file persistence creates one batch and no duplicate rows", async () => {
    const candidate = previewInput("concurrent-race", actors.admin);
    const [a, b] = await Promise.all([
      persistExcelImportPreview(candidate),
      persistExcelImportPreview(candidate),
    ]);
    const created = [a, b].find((result) => result.ok);
    const existing = [a, b].find((result) => !result.ok);
    assert.ok(created?.ok);
    assert.equal(existing?.ok, false);
    if (!created?.ok || !existing || existing.ok) return;
    assert.equal(existing.code, "EXISTING_PREVIEW");
    assert.equal(existing.batch?.batchId, created.batch.batchId);
    await rememberBatch(created.batch.batchId);
    const rows = await db
      .select({ id: excelImportRows.id })
      .from(excelImportRows)
      .where(eq(excelImportRows.batchId, created.batch.batchId));
    assert.equal(rows.length, 1);
  });

  test("invalid rows are rejected before persistence and leave no partial batch", async () => {
    const duplicateRows = [parsedRow(4, "SOURCE_READY"), parsedRow(4, "SOURCE_REVIEW")];
    const result = await persistExcelImportPreview(
      previewInput("invalid-rollback", actors.admin, duplicateRows)
    );
    assert.deepEqual(result, { ok: false, code: "INVALID_PREVIEW_INPUT" });
    const [batch] = await db
      .select({ id: excelImportBatches.id })
      .from(excelImportBatches)
      .where(eq(excelImportBatches.sourceFileSha256, testHash("invalid-rollback")));
    assert.equal(batch, undefined);
  });

  test("confirmed, IMPORTING, and COMPLETED batches cannot parser-refresh", async () => {
    const importing = await createPreview("existing-importing", undefined, { parserVersion: "repair-case-list-parser-v3" });
    await db
      .update(excelImportBatches)
      .set({ status: "IMPORTING", confirmedBy: actors.admin, confirmedAt: new Date() })
      .where(eq(excelImportBatches.id, importing.batch.batchId));
    const importingResult = await persistExcelImportPreview(
      previewInput("existing-importing", actors.admin, undefined, { parserVersion: "repair-case-list-parser-v6" })
    );
    assert.equal(importingResult.ok, false);
    if (!importingResult.ok) assert.equal(importingResult.code, "EXISTING_IMPORT_IN_PROGRESS");

    const completed = await createPreview("existing-completed", undefined, { parserVersion: "repair-case-list-parser-v3" });
    const completedAt = new Date();
    await db
      .update(excelImportBatches)
      .set({
        status: "COMPLETED",
        confirmedBy: actors.admin,
        confirmedAt: completedAt,
        completedAt,
      })
      .where(eq(excelImportBatches.id, completed.batch.batchId));
    const completedResult = await persistExcelImportPreview(
      previewInput("existing-completed", actors.admin, undefined, { parserVersion: "repair-case-list-parser-v6" })
    );
    assert.equal(completedResult.ok, false);
    if (!completedResult.ok) assert.equal(completedResult.code, "EXISTING_COMPLETED_IMPORT");
  });

  test("EXPIRED requires confirmation, then resets the same batch ID and increments version", async () => {
    const created = await createPreview("expired-reset", [parsedRow(4, "SOURCE_REVIEW", "old")]);
    await db
      .update(excelImportBatches)
      .set({ status: "EXPIRED" })
      .where(eq(excelImportBatches.id, created.batch.batchId));

    const withoutConfirmation = await persistExcelImportPreview(
      previewInput("expired-reset", actors.admin)
    );
    assert.equal(withoutConfirmation.ok, false);
    if (!withoutConfirmation.ok) {
      assert.equal(withoutConfirmation.code, "EXPIRED_RESET_REQUIRES_CONFIRMATION");
    }

    const reset = await persistExcelImportPreview(
      previewInput("expired-reset", actors.superAdmin, [parsedRow(8, "SOURCE_READY", "new")], {
        resetExpiredBatchId: created.batch.batchId,
        expectedBatchVersion: 1,
        confirmExpiredReset: true,
        now: new Date("2026-08-18T01:00:00.000Z"),
      })
    );
    assert.equal(reset.ok, true);
    if (!reset.ok) return;
    assert.equal(reset.outcome, "RESET");
    assert.equal(reset.batch.batchId, created.batch.batchId);
    assert.equal(reset.batch.version, 2);
    assert.equal(reset.batch.status, "PREVIEWED");
    const rows = await db
      .select({ rowNumber: excelImportRows.sourceRowNumber })
      .from(excelImportRows)
      .where(eq(excelImportRows.batchId, created.batch.batchId));
    assert.deepEqual(rows, [{ rowNumber: 8 }]);
  });

  test("stale reset and invalid replacement preserve the expired batch and rows", async () => {
    const created = await createPreview("expired-preserve", [parsedRow(4, "SOURCE_REVIEW", "preserve")]);
    await db
      .update(excelImportBatches)
      .set({ status: "EXPIRED" })
      .where(eq(excelImportBatches.id, created.batch.batchId));
    const [beforeRow] = await db
      .select({ id: excelImportRows.id, fingerprint: excelImportRows.sourceRowFingerprint })
      .from(excelImportRows)
      .where(eq(excelImportRows.batchId, created.batch.batchId));

    const stale = await persistExcelImportPreview(
      previewInput("expired-preserve", actors.admin, undefined, {
        resetExpiredBatchId: created.batch.batchId,
        expectedBatchVersion: 999,
        confirmExpiredReset: true,
      })
    );
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.code, "STALE_BATCH_VERSION");

    const invalidRows = [parsedRow(4, "SOURCE_READY"), parsedRow(4, "SOURCE_REVIEW")];
    const invalid = await persistExcelImportPreview(
      previewInput("expired-preserve", actors.admin, invalidRows, {
        resetExpiredBatchId: created.batch.batchId,
        expectedBatchVersion: 1,
        confirmExpiredReset: true,
      })
    );
    assert.deepEqual(invalid, { ok: false, code: "INVALID_PREVIEW_INPUT" });

    const [batchAfter] = await db
      .select({ status: excelImportBatches.status, version: excelImportBatches.version })
      .from(excelImportBatches)
      .where(eq(excelImportBatches.id, created.batch.batchId));
    const rowsAfter = await db
      .select({ id: excelImportRows.id, fingerprint: excelImportRows.sourceRowFingerprint })
      .from(excelImportRows)
      .where(eq(excelImportRows.batchId, created.batch.batchId));
    assert.deepEqual(batchAfter, { status: "EXPIRED", version: 1 });
    assert.deepEqual(rowsAfter, [beforeRow]);
  });

  test("attempt-linked expired batch cannot reset", async () => {
    const created = await createPreview("expired-attempt-linked");
    await db
      .update(excelImportBatches)
      .set({ status: "EXPIRED" })
      .where(eq(excelImportBatches.id, created.batch.batchId));
    const [row] = await db
      .select({ id: excelImportRows.id })
      .from(excelImportRows)
      .where(eq(excelImportRows.batchId, created.batch.batchId));
    await db.insert(excelImportRowAttempts).values({
      importRowId: row.id,
      attemptNumber: 1,
      status: "STARTED",
      requestedBy: actors.admin,
    });
    const result = await persistExcelImportPreview(
      previewInput("expired-attempt-linked", actors.admin, undefined, {
        resetExpiredBatchId: created.batch.batchId,
        expectedBatchVersion: 1,
        confirmExpiredReset: true,
      })
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "BATCH_RESET_NOT_ALLOWED");
  });

  test("attempt-linked unconfirmed v3 batch cannot parser-refresh", async () => {
    const created = await createPreview("refresh-attempt-linked", undefined, { parserVersion: "repair-case-list-parser-v3" });
    const [row] = await db.select({ id: excelImportRows.id }).from(excelImportRows).where(eq(excelImportRows.batchId, created.batch.batchId));
    await db.insert(excelImportRowAttempts).values({
      importRowId: row.id,
      attemptNumber: 1,
      status: "STARTED",
      requestedBy: actors.admin,
    });
    const result = await persistExcelImportPreview(previewInput("refresh-attempt-linked", actors.admin, undefined, {
      parserVersion: "repair-case-list-parser-v6",
      refreshExistingBatchId: created.batch.batchId,
      expectedBatchVersion: created.batch.version,
      confirmParserRefresh: true,
    }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "BATCH_RESET_NOT_ALLOWED");
  });

  test("result Repair Case evidence blocks parser refresh even if the batch was not finalized", async () => {
    const created = await createPreview("refresh-result-linked", undefined, { parserVersion: "repair-case-list-parser-v3" });
    const [existingCase] = await db.select({ id: repairCases.id }).from(repairCases).limit(1);
    assert.ok(existingCase);
    await db.update(excelImportRows).set({
      importStatus: "IMPORTED",
      resultRepairCaseId: existingCase.id,
      importedBy: actors.admin,
      importedAt: new Date(),
    }).where(eq(excelImportRows.batchId, created.batch.batchId));
    const result = await persistExcelImportPreview(previewInput("refresh-result-linked", actors.admin, undefined, {
      parserVersion: "repair-case-list-parser-v6",
      refreshExistingBatchId: created.batch.batchId,
      expectedBatchVersion: created.batch.version,
      confirmParserRefresh: true,
    }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "BATCH_RESET_NOT_ALLOWED");
  });

  test("mutation writes no audit log", async () => {
    const [before] = await db.select({ value: sql<number>`count(*)::int` }).from(auditLogs);
    await createPreview("no-audit-log");
    const [afterCount] = await db.select({ value: sql<number>`count(*)::int` }).from(auditLogs);
    assert.equal(afterCount.value, before.value);
  });
});
