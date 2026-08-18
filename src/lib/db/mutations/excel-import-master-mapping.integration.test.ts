import "../../../../scripts/load-env";

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import { EXCEL_IMPORT_COLUMNS, type ExcelImportParsedRowInput, type ExcelImportRawCellInput } from "@/lib/domain/excel-import-preview";
import { excelImportMappingGroupKey, excelImportMappingSourceFromColumns } from "@/lib/domain/excel-import-master-mapping";
import { db, pgClient } from "../connection";
import { auditLogs, customers, endUsers, excelImportBatches, excelImportRows, productModels, products, repairCases, users } from "../schema";
import { persistExcelImportPreview } from "./excel-import-preview";
import { applyExcelImportMasterMapping, confirmExcelImportMasterPlan } from "./excel-import-master-mapping";
import { getExcelImportPreviewPage } from "../queries/excel-import-preview";

const TOKEN = randomUUID();
const createdUserIds: string[] = [];
const createdCustomerIds: string[] = [];
const createdEndUserIds: string[] = [];
const createdProductModelIds: string[] = [];
const createdBatchIds: string[] = [];
let adminId: string;
let otherAdminId: string;
let engineerId: string;
let customerId: string;
let endUserId: string;
let productModelId: string;

function hash(value: string) { return createHash("sha256").update(`${TOKEN}:${value}`).digest("hex"); }

function raw(values: Partial<Record<string, string | null>>): Record<string, ExcelImportRawCellInput> {
  return Object.fromEntries(EXCEL_IMPORT_COLUMNS.map((column) => [column, { value: values[column] ?? null, metadata: null }])) as Record<string, ExcelImportRawCellInput>;
}

function parsedRow(rowNumber: number, values: Partial<Record<string, string | null>>): ExcelImportParsedRowInput {
  const rawCells = raw({ A: String(rowNumber), ...values });
  const issues = [
    ...(rawCells.D.value ? [{ code: "CUSTOMER_MAPPING_PENDING", severity: "WARNING" as const, rowNumber, cellAddress: `D${rowNumber}` }] : []),
    ...(rawCells.E.value ? [{ code: "END_USER_MAPPING_PENDING", severity: "WARNING" as const, rowNumber, cellAddress: `E${rowNumber}` }] : []),
    ...(rawCells.G.value ? [{ code: "PRODUCT_MODEL_MAPPING_PENDING", severity: "WARNING" as const, rowNumber, cellAddress: `G${rowNumber}` }] : []),
    ...(rawCells.X.value ? [{ code: "ASSIGNEE_MAPPING_PENDING", severity: "WARNING" as const, rowNumber, cellAddress: `X${rowNumber}` }] : []),
  ];
  return { sourceSheet: "목록", sourceRowNumber: rowNumber, rawCells, normalized: { intakeNumber: null, receivedDate: null, customerName: rawCells.D.value, endUserName: rawCells.E.value, productName: rawCells.F.value, modelName: rawCells.G.value, lotNumber: null, serialNumber: null, billingType: null, status: null }, sourceClassification: "SOURCE_READY", issues };
}

async function preview(label: string, rows: ExcelImportParsedRowInput[], uploadedBy = adminId) {
  const result = await persistExcelImportPreview({ sourceFileSha256: hash(label), parserVersion: "repair-case-list-parser-v6", sourceSheet: "목록", headerFingerprint: hash("header"), originalFileName: "mapping.xlsx", fileSizeBytes: 1000, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", uploadedBy, now: new Date("2026-08-17T00:00:00Z"), safetyValidation: { ok: true, issues: [] }, parsedPreview: { ok: true, sourceSheet: "목록", headerValid: true, totalDataRowsConsidered: rows.length, blankRowsSkipped: 0, rows, issues: [] } });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("setup failed");
  createdBatchIds.push(result.batch.batchId);
  return result.batch;
}

before(async () => {
  const people = await db.insert(users).values([
    { email: `mapping-${TOKEN}-admin@example.invalid`, name: `Mapping Admin ${TOKEN}`, role: "ADMIN", approvalStatus: "APPROVED" },
    { email: `mapping-${TOKEN}-other@example.invalid`, name: `Mapping Other ${TOKEN}`, role: "SUPER_ADMIN", approvalStatus: "APPROVED" },
    { email: `mapping-${TOKEN}-engineer@example.invalid`, name: `Mapping Engineer ${TOKEN}`, role: "AS_ENGINEER", approvalStatus: "APPROVED" },
  ]).returning({ id: users.id });
  [adminId, otherAdminId, engineerId] = people.map((row) => row.id); createdUserIds.push(...people.map((row) => row.id));
  const [customer] = await db.insert(customers).values({ name: `Mapping Customer ${TOKEN}` }).returning({ id: customers.id }); customerId = customer.id; createdCustomerIds.push(customer.id);
  const [endUser] = await db.insert(endUsers).values({ customerId, name: `Mapping Site ${TOKEN}` }).returning({ id: endUsers.id }); endUserId = endUser.id; createdEndUserIds.push(endUser.id);
  const [model] = await db.insert(productModels).values({ modelName: `Mapping Model ${TOKEN}`, kind: "GENERATOR" }).returning({ id: productModels.id }); productModelId = model.id; createdProductModelIds.push(model.id);
});

after(async () => {
  if (createdBatchIds.length) {
    const createdAuditIds = (await db.select({ id: auditLogs.id }).from(auditLogs).where(and(
      eq(auditLogs.targetEntity, "excel_import_batches"),
      eq(auditLogs.actionType, "EXCEL_IMPORT"),
      inArray(auditLogs.targetRecordId, createdBatchIds)
    ))).map((row) => row.id);
    if (createdAuditIds.length) await db.delete(auditLogs).where(inArray(auditLogs.id, createdAuditIds));
  }
  if (createdBatchIds.length) await db.delete(excelImportBatches).where(inArray(excelImportBatches.id, createdBatchIds));
  if (createdEndUserIds.length) await db.delete(endUsers).where(inArray(endUsers.id, createdEndUserIds));
  if (createdCustomerIds.length) await db.delete(customers).where(inArray(customers.id, createdCustomerIds));
  if (createdProductModelIds.length) await db.delete(productModels).where(inArray(productModels.id, createdProductModelIds));
  if (createdUserIds.length) await db.delete(users).where(inArray(users.id, createdUserIds));
  await pgClient.end({ timeout: 5 });
});

describe("Excel Import master mapping", () => {
  test("automatically connects only exact relationship-safe master matches", async () => {
    const batch = await preview("auto", [parsedRow(4, { D: `  Mapping   Customer ${TOKEN} `, E: `Mapping Site ${TOKEN}`, F: "legacy product text", G: `Mapping Model ${TOKEN}`, X: `Mapping Engineer ${TOKEN}` })]);
    const [row] = await db.select().from(excelImportRows).where(eq(excelImportRows.batchId, batch.batchId));
    assert.equal(row.customerId, customerId); assert.equal(row.endUserId, endUserId); assert.equal(row.productModelId, productModelId); assert.equal(row.assignedEngineerId, engineerId);
    assert.equal(row.importStatus, "IMPORT_READY");
    const page = await getExcelImportPreviewPage({ batchId: batch.batchId, actorUserId: adminId });
    assert.equal(page.ok, true);
    if (page.ok) {
      assert.equal(page.value.batch.counts.conflicts, 1);
      assert.equal(page.value.batch.counts.executable, 0);
    }
  });

  test("confirms customer-scoped relationships and creates one global G model without using F", async () => {
    const customerA = `Plan Customer A ${TOKEN}`;
    const customerB = `Plan Customer B ${TOKEN}`;
    const modelName = `Plan Global Model ${TOKEN}`;
    const beforeProtected = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(products),
      db.select({ count: sql<number>`count(*)::int` }).from(repairCases),
    ]);
    const batch = await preview("relationship-plan", [
      parsedRow(4, { D: customerA, E: `Shared Site ${TOKEN}`, F: "Generator", G: modelName }),
      parsedRow(5, { D: customerB, E: `Shared Site ${TOKEN}`, F: "Matcher", G: modelName }),
    ]);
    const beforeRows = await db.select({ fingerprint: excelImportRows.sourceRowFingerprint, rawData: excelImportRows.rawData })
      .from(excelImportRows).where(eq(excelImportRows.batchId, batch.batchId));
    const confirmed = await confirmExcelImportMasterPlan({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: batch.version });
    assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
    if (!confirmed.ok) return;
    assert.deepEqual(confirmed.plan, {
      customers: { reused: 0, created: 2 },
      endUsers: { reused: 0, created: 2 },
      productModels: { reused: 0, created: 1 },
    });
    const newCustomers = await db.select({ id: customers.id }).from(customers).where(inArray(customers.name, [customerA, customerB]));
    const newModels = await db.select({ id: productModels.id, kind: productModels.kind }).from(productModels).where(eq(productModels.modelName, modelName));
    assert.equal(newCustomers.length, 2); assert.equal(newModels.length, 1); assert.equal(newModels[0].kind, null);
    createdCustomerIds.push(...newCustomers.map((row) => row.id)); createdProductModelIds.push(newModels[0].id);
    const newEndUsers = await db.select({ id: endUsers.id, customerId: endUsers.customerId }).from(endUsers)
      .where(and(inArray(endUsers.customerId, newCustomers.map((row) => row.id)), eq(endUsers.name, `Shared Site ${TOKEN}`)));
    assert.equal(newEndUsers.length, 2); createdEndUserIds.push(...newEndUsers.map((row) => row.id));
    const afterRows = await db.select({ fingerprint: excelImportRows.sourceRowFingerprint, rawData: excelImportRows.rawData, customerId: excelImportRows.customerId, endUserId: excelImportRows.endUserId, productModelId: excelImportRows.productModelId })
      .from(excelImportRows).where(eq(excelImportRows.batchId, batch.batchId));
    assert.deepEqual(afterRows.map((row) => row.fingerprint).sort(), beforeRows.map((row) => row.fingerprint).sort());
    assert.equal(new Set(afterRows.map((row) => row.customerId)).size, 2);
    assert.equal(new Set(afterRows.map((row) => row.endUserId)).size, 2);
    assert.deepEqual([...new Set(afterRows.map((row) => row.productModelId))], [newModels[0].id]);
    assert.deepEqual(afterRows.map((row) => (row.rawData as { columns: Record<string, { value: string | null }> }).columns.F.value).sort(), ["Generator", "Matcher"]);
    const afterProtected = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(products),
      db.select({ count: sql<number>`count(*)::int` }).from(repairCases),
    ]);
    assert.deepEqual(afterProtected, beforeProtected, "relationship confirmation must not create Products or Repair Cases");
  });

  test("leaves no-match and multiple-match assignees pending", async () => {
    const duplicateName = `Duplicate Engineer ${TOKEN}`;
    const duplicates = await db.insert(users).values([
      { email: `mapping-${TOKEN}-dup-a@example.invalid`, name: duplicateName, role: "AS_ENGINEER", approvalStatus: "APPROVED" },
      { email: `mapping-${TOKEN}-dup-b@example.invalid`, name: duplicateName, role: "AS_ENGINEER", approvalStatus: "APPROVED" },
    ]).returning({ id: users.id });
    createdUserIds.push(...duplicates.map((row) => row.id));
    const batch = await preview("assignee-pending", [
      parsedRow(4, { X: `No Match ${TOKEN}` }),
      parsedRow(5, { X: duplicateName }),
    ]);
    const rows = await db.select().from(excelImportRows).where(eq(excelImportRows.batchId, batch.batchId));
    assert.equal(rows.every((row) => row.assignedEngineerId === null), true);
    assert.equal(rows.every((row) => row.importStatus === "MAPPING_REQUIRED"), true);
    assert.equal(rows.every((row) => row.sourceClassification === "SOURCE_READY"), true);
  });

  test("applies one group across pages, preserves other groups and fingerprints, then changes and clears it", async () => {
    const sourceName = `Unmatched Customer ${TOKEN}`;
    const rows = Array.from({ length: 60 }, (_, index) => parsedRow(index + 4, { D: index < 55 ? sourceName : `Other ${TOKEN}` }));
    const batch = await preview("bulk", rows);
    const before = await db.select({ id: excelImportRows.id, fingerprint: excelImportRows.sourceRowFingerprint, customerId: excelImportRows.customerId }).from(excelImportRows).where(eq(excelImportRows.batchId, batch.batchId));
    const groupKey = excelImportMappingGroupKey("CUSTOMER", excelImportMappingSourceFromColumns(raw({ D: sourceName })))!;
    const applied = await applyExcelImportMasterMapping({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: batch.version, type: "CUSTOMER", groupKey, targetId: customerId });
    assert.equal(applied.ok, true, JSON.stringify(applied)); if (!applied.ok) return; assert.equal(applied.affectedRows, 55);
    const after = await db.select({ id: excelImportRows.id, fingerprint: excelImportRows.sourceRowFingerprint, customerId: excelImportRows.customerId }).from(excelImportRows).where(eq(excelImportRows.batchId, batch.batchId));
    assert.equal(after.length, before.length); assert.deepEqual(after.map((row) => row.fingerprint).sort(), before.map((row) => row.fingerprint).sort());
    assert.equal(after.filter((row) => row.customerId === customerId).length, 55); assert.equal(after.filter((row) => row.customerId === null).length, 5);
    const stale = await applyExcelImportMasterMapping({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: batch.version, type: "CUSTOMER", groupKey, targetId: null });
    assert.deepEqual(stale, { ok: false, code: "STALE_BATCH_VERSION" });
    const [replacement] = await db.insert(customers).values({ name: `Replacement ${TOKEN}` }).returning({ id: customers.id }); createdCustomerIds.push(replacement.id);
    const changed = await applyExcelImportMasterMapping({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: applied.version, type: "CUSTOMER", groupKey, targetId: replacement.id });
    assert.equal(changed.ok, true); if (!changed.ok) return;
    const changedRows = await db.select({ customerId: excelImportRows.customerId }).from(excelImportRows).where(eq(excelImportRows.batchId, batch.batchId));
    assert.equal(changedRows.filter((row) => row.customerId === replacement.id).length, 55);
    const cleared = await applyExcelImportMasterMapping({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: changed.version, type: "CUSTOMER", groupKey, targetId: null });
    assert.equal(cleared.ok, true); if (!cleared.ok) return; assert.equal(cleared.affectedRows, 55);
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.targetRecordId, batch.batchId));
    const serialized = JSON.stringify(logs); assert.equal(serialized.includes(sourceName), false); assert.equal(logs.length, 3);
  });

  test("blocks ownership, terminal state, deleted targets, and unsafe End-User relationships", async () => {
    const sourceName = `Guard Customer ${TOKEN}`;
    const batch = await preview("guards", [parsedRow(4, { D: sourceName, E: `Mapping Site ${TOKEN}` })]);
    const customerKey = excelImportMappingGroupKey("CUSTOMER", excelImportMappingSourceFromColumns(raw({ D: sourceName })))!;
    assert.deepEqual(await applyExcelImportMasterMapping({ batchId: batch.batchId, actorUserId: otherAdminId, expectedBatchVersion: batch.version, type: "CUSTOMER", groupKey: customerKey, targetId: customerId }), { ok: false, code: "BATCH_NOT_FOUND" });
    assert.deepEqual(await applyExcelImportMasterMapping({ batchId: batch.batchId, actorUserId: engineerId, expectedBatchVersion: batch.version, type: "CUSTOMER", groupKey: customerKey, targetId: customerId }), { ok: false, code: "ACTOR_NOT_ALLOWED" });
    assert.deepEqual(await confirmExcelImportMasterPlan({ batchId: batch.batchId, actorUserId: otherAdminId, expectedBatchVersion: batch.version }), { ok: false, code: "BATCH_NOT_FOUND" });
    assert.deepEqual(await confirmExcelImportMasterPlan({ batchId: batch.batchId, actorUserId: engineerId, expectedBatchVersion: batch.version }), { ok: false, code: "ACTOR_NOT_ALLOWED" });
    assert.deepEqual(await confirmExcelImportMasterPlan({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: batch.version + 1 }), { ok: false, code: "STALE_BATCH_VERSION" });
    const endUserKey = excelImportMappingGroupKey("END_USER", excelImportMappingSourceFromColumns(raw({ D: sourceName, E: `Mapping Site ${TOKEN}` })))!;
    assert.deepEqual(await applyExcelImportMasterMapping({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: batch.version, type: "END_USER", groupKey: endUserKey, targetId: endUserId }), { ok: false, code: "RELATION_CONFLICT" });
    const [deleted] = await db.insert(customers).values({ name: `Deleted Mapping ${TOKEN}`, isDeleted: true }).returning({ id: customers.id }); createdCustomerIds.push(deleted.id);
    assert.deepEqual(await applyExcelImportMasterMapping({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: batch.version, type: "CUSTOMER", groupKey: customerKey, targetId: deleted.id }), { ok: false, code: "TARGET_NOT_FOUND" });
    await db.update(excelImportBatches).set({ parserVersion: "repair-case-list-parser-v2" }).where(eq(excelImportBatches.id, batch.batchId));
    assert.deepEqual(await applyExcelImportMasterMapping({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: batch.version, type: "CUSTOMER", groupKey: customerKey, targetId: customerId }), { ok: false, code: "PARSER_VERSION_NOT_SUPPORTED" });
    assert.deepEqual(await confirmExcelImportMasterPlan({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: batch.version }), { ok: false, code: "PARSER_VERSION_NOT_SUPPORTED" });
    await db.update(excelImportBatches).set({ parserVersion: "repair-case-list-parser-v6" }).where(eq(excelImportBatches.id, batch.batchId));
    await db.update(excelImportBatches).set({ status: "IMPORTING", confirmedBy: adminId, confirmedAt: new Date() }).where(eq(excelImportBatches.id, batch.batchId));
    assert.deepEqual(await applyExcelImportMasterMapping({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: batch.version, type: "CUSTOMER", groupKey: customerKey, targetId: customerId }), { ok: false, code: "BATCH_NOT_MUTABLE" });
    assert.deepEqual(await confirmExcelImportMasterPlan({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: batch.version }), { ok: false, code: "BATCH_NOT_MUTABLE" });
  });
});
