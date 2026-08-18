import "../../../../scripts/load-env";

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import { EXCEL_IMPORT_COLUMNS, type ExcelImportParsedRowInput, type ExcelImportRawCellInput } from "@/lib/domain/excel-import-preview";
import { db, pgClient } from "../connection";
import { auditLogs, customers, endUsers, excelImportBatches, excelImportRowAttempts, excelImportRows, productModels, products, repairCaseApprovals, repairCaseFlowcharts, repairCaseIdempotencyKeys, repairCases, repairCaseWorkRecords, statusChangeHistories, users, workflowSteps } from "../schema";
import { persistExcelImportPreview } from "./excel-import-preview";
import { confirmExcelImportExecution, reconcileFailedExcelImportBatch, runExcelImportChunk } from "./excel-import-execution";
import { getExcelImportPreflightPlan } from "../queries/excel-import-preflight";

const TOKEN = randomUUID();
const createdBatchIds: string[] = [];
const createdCaseIds: string[] = [];
const createdProductIds: string[] = [];
const createdCustomerIds: string[] = [];
const createdEndUserIds: string[] = [];
const createdModelIds: string[] = [];
const createdImportRowIds: string[] = [];
const blockerCaseIds: string[] = [];
const createdHistoryIds: string[] = [];
const createdAuditIds: string[] = [];
let adminId: string;
let engineerId: string;

function hash(label: string) { return createHash("sha256").update(`${TOKEN}:${label}`).digest("hex"); }
function cells(values: Record<string, string | null>): Record<string, ExcelImportRawCellInput> {
  return Object.fromEntries(EXCEL_IMPORT_COLUMNS.map((column) => [column, { value: values[column] ?? null, metadata: null }]));
}
function parsedRow(rowNumber: number, suffix: string, intakeNumber: string): ExcelImportParsedRowInput {
  const customer = `Excel Execute Customer ${TOKEN} ${suffix}`;
  const model = `Excel Execute Model ${TOKEN} ${suffix}`;
  return { sourceSheet: "목록", sourceRowNumber: rowNumber, rawCells: cells({ A: `R-${suffix}`, B: intakeNumber, C: "2097-01-15", D: customer, E: `Site ${suffix}`, F: "Generator", G: model, H: `LOT-${suffix}`, J: `SERIAL-${suffix}`, L: "유상", S: `reason ${suffix}` }), normalized: { legacyReportNumber: `R-${suffix}`, intakeNumber, receivedDate: "2097-01-15", customerName: customer, endUserName: `Site ${suffix}`, productName: "Generator", modelName: model, lotNumber: `LOT-${suffix}`, serialNumber: `SERIAL-${suffix}`, billingType: "PAID", status: null }, sourceClassification: "SOURCE_READY", issues: [] };
}
async function preview(label: string, rows: ExcelImportParsedRowInput[]) {
  const result = await persistExcelImportPreview({ sourceFileSha256: hash(label), parserVersion: "repair-case-list-parser-v6", sourceSheet: "목록", headerFingerprint: hash("header"), originalFileName: `${label}.xlsx`, fileSizeBytes: 1024, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", uploadedBy: adminId, now: new Date(), safetyValidation: { ok: true, issues: [] }, parsedPreview: { ok: true, sourceSheet: "목록", headerValid: true, totalDataRowsConsidered: rows.length, blankRowsSkipped: 0, rows, issues: [] } });
  assert.equal(result.ok, true); if (!result.ok) throw new Error("preview failed");
  createdBatchIds.push(result.batch.batchId);
  const persistedRows = await db.select({ id: excelImportRows.id }).from(excelImportRows).where(eq(excelImportRows.batchId, result.batch.batchId));
  createdImportRowIds.push(...persistedRows.map((row) => row.id));
  return result.batch;
}
async function rememberCreated() {
  const importedRows = createdBatchIds.length ? await db.select({ resultRepairCaseId: excelImportRows.resultRepairCaseId }).from(excelImportRows).where(inArray(excelImportRows.batchId, createdBatchIds)) : [];
  const idempotencyRows = createdImportRowIds.length ? await db.select({ repairCaseId: repairCaseIdempotencyKeys.repairCaseId }).from(repairCaseIdempotencyKeys).where(inArray(repairCaseIdempotencyKeys.idempotencyKey, [...new Set(createdImportRowIds)])) : [];
  const exactCaseIds = [...new Set([
    ...importedRows.map((row) => row.resultRepairCaseId),
    ...idempotencyRows.map((row) => row.repairCaseId),
  ].filter((id): id is string => !!id))];
  const cases = exactCaseIds.length ? await db.select({ id: repairCases.id, customerId: repairCases.customerId, endUserId: repairCases.endUserId, productId: repairCases.productId }).from(repairCases).where(inArray(repairCases.id, exactCaseIds)) : [];
  for (const row of cases) { createdCaseIds.push(row.id); createdCustomerIds.push(row.customerId); if (row.endUserId) createdEndUserIds.push(row.endUserId); createdProductIds.push(row.productId); }
  const productRows = createdProductIds.length ? await db.select({ productModelId: products.productModelId }).from(products).where(inArray(products.id, [...new Set(createdProductIds)])) : [];
  for (const row of productRows) if (row.productModelId) createdModelIds.push(row.productModelId);
  const historyRows = exactCaseIds.length ? await db.select({ id: statusChangeHistories.id }).from(statusChangeHistories).where(inArray(statusChangeHistories.repairCaseId, exactCaseIds)) : [];
  createdHistoryIds.push(...historyRows.map((row) => row.id));
}

before(async () => {
  const [admin] = await db.insert(users).values({ email: `excel-execution-${TOKEN}@example.test`, name: `Excel Execution Admin ${TOKEN}`, role: "ADMIN", approvalStatus: "APPROVED" }).returning({ id: users.id });
  adminId = admin.id;
  const [engineer] = await db.insert(users).values({ email: `excel-execution-engineer-${TOKEN}@example.test`, name: `Excel Execution Engineer ${TOKEN}`, role: "AS_ENGINEER", approvalStatus: "APPROVED" }).returning({ id: users.id });
  engineerId = engineer.id;
});
after(async () => {
  await rememberCreated();
  if (createdHistoryIds.length) await db.delete(statusChangeHistories).where(inArray(statusChangeHistories.id, [...new Set(createdHistoryIds)]));
  if (createdAuditIds.length) await db.delete(auditLogs).where(inArray(auditLogs.id, [...new Set(createdAuditIds)]));
  if (createdImportRowIds.length) await db.delete(repairCaseIdempotencyKeys).where(inArray(repairCaseIdempotencyKeys.idempotencyKey, [...new Set(createdImportRowIds)]));
  if (createdBatchIds.length) await db.delete(excelImportBatches).where(inArray(excelImportBatches.id, [...new Set(createdBatchIds)]));
  const allCases = [...new Set([...createdCaseIds, ...blockerCaseIds])];
  if (allCases.length) await db.delete(repairCases).where(inArray(repairCases.id, allCases));
  if (createdProductIds.length) await db.delete(products).where(inArray(products.id, [...new Set(createdProductIds)]));
  if (createdEndUserIds.length) await db.delete(endUsers).where(inArray(endUsers.id, [...new Set(createdEndUserIds)]));
  if (createdCustomerIds.length) await db.delete(customers).where(inArray(customers.id, [...new Set(createdCustomerIds)]));
  if (createdModelIds.length) await db.delete(productModels).where(inArray(productModels.id, [...new Set(createdModelIds)]));
  await db.delete(users).where(inArray(users.id, [adminId, engineerId]));
  await pgClient.end({ timeout: 5 });
});

describe("Excel Import preflight and resumable execution", () => {
  test("plans existing references for reuse and leaves an unmatched assignee unassigned", async () => {
    const [customer] = await db.insert(customers).values({ name: `Existing Customer ${TOKEN}` }).returning({ id: customers.id });
    const [endUser] = await db.insert(endUsers).values({ customerId: customer.id, name: `Existing Site ${TOKEN}` }).returning({ id: endUsers.id });
    const [model] = await db.insert(productModels).values({ modelName: `Existing Model ${TOKEN}` }).returning({ id: productModels.id });
    const [product] = await db.insert(products).values({ modelName: `Existing Model ${TOKEN}`, productModelId: model.id, lotNumber: "LOT-EXISTING", serialNumber: "SERIAL-EXISTING" }).returning({ id: products.id });
    createdCustomerIds.push(customer.id); createdEndUserIds.push(endUser.id); createdModelIds.push(model.id); createdProductIds.push(product.id);
    const row = parsedRow(4, "existing", "D970105");
    row.rawCells.D.value = `  Existing   Customer ${TOKEN} `; row.rawCells.E.value = `Existing Site ${TOKEN}`; row.rawCells.G.value = `Existing Model ${TOKEN}`; row.rawCells.H.value = "LOT-EXISTING"; row.rawCells.J.value = "SERIAL-EXISTING"; row.rawCells.X.value = "no matching engineer";
    Object.assign(row.normalized, { customerName: row.rawCells.D.value.trim(), endUserName: row.rawCells.E.value, modelName: row.rawCells.G.value, lotNumber: "LOT-EXISTING", serialNumber: "SERIAL-EXISTING" });
    const batch = await preview("existing-plan", [row]);
    const plan = await getExcelImportPreflightPlan({ batchId: batch.batchId, actorUserId: adminId });
    assert.equal(plan.ok, true); if (!plan.ok) return;
    assert.equal(plan.value.rows[0].disposition, "EXECUTABLE");
    assert.deepEqual(plan.value.entities, { customer: { reuse: 1, create: 0 }, endUser: { reuse: 1, create: 0 }, productModel: { reuse: 1, create: 0 }, product: { reuse: 1, create: 0 } });
    assert.equal(plan.value.counts.assigneeUnassigned, 1);
  });

  test("separates blank required fields from actual batch duplicate conflicts", async () => {
    const excluded = parsedRow(4, "excluded", "D970106"); excluded.rawCells.D.value = null; excluded.normalized.customerName = null;
    const excludedBatch = await preview("excluded", [excluded]);
    const excludedPlan = await getExcelImportPreflightPlan({ batchId: excludedBatch.batchId, actorUserId: adminId });
    assert.equal(excludedPlan.ok, true); if (excludedPlan.ok) { assert.equal(excludedPlan.value.counts.autoExcluded, 1); assert.equal(excludedPlan.value.counts.conflicts, 0); }
    assert.deepEqual(await confirmExcelImportExecution({ batchId: excludedBatch.batchId, actorUserId: adminId, expectedBatchVersion: excludedBatch.version }), { ok: false, code: "NO_EXECUTABLE_ROWS" });
    assert.equal((await db.select({ status: excelImportBatches.status }).from(excelImportBatches).where(eq(excelImportBatches.id, excludedBatch.batchId)))[0].status, excludedBatch.status);
    const duplicateBatch = await preview("batch-duplicate", [parsedRow(4, "duplicate-a", "D970107"), parsedRow(5, "duplicate-b", "D970107")]);
    const duplicatePlan = await getExcelImportPreflightPlan({ batchId: duplicateBatch.batchId, actorUserId: adminId });
    assert.equal(duplicatePlan.ok, true); if (duplicatePlan.ok) { assert.equal(duplicatePlan.value.counts.intakeDuplicateInBatch, 2); assert.equal(duplicatePlan.value.counts.conflicts, 2); }
  });

  test("connects one exact engineer and does not block an absent account", async () => {
    const matched = parsedRow(4, "engineer-match", "D970108"); matched.rawCells.X.value = `  Excel   Execution Engineer ${TOKEN} `;
    const unmatched = parsedRow(5, "engineer-missing", "D970109"); unmatched.rawCells.X.value = "legacy engineer without account";
    const batch = await preview("engineers", [matched, unmatched]);
    const plan = await getExcelImportPreflightPlan({ batchId: batch.batchId, actorUserId: adminId });
    assert.equal(plan.ok, true); if (!plan.ok) return;
    assert.equal(plan.value.counts.assigneeLinked, 1); assert.equal(plan.value.counts.assigneeUnassigned, 1);
    assert.equal(plan.value.rows.every((row) => row.disposition === "EXECUTABLE"), true);
  });

  test("creates one case per row through normal intake rules and records attempts", async () => {
    const batch = await preview("success", [parsedRow(4, "success", "D970101")]);
    const confirmed = await confirmExcelImportExecution({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: batch.version });
    assert.equal(confirmed.ok, true); if (!confirmed.ok) return;
    const result = await runExcelImportChunk({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: confirmed.version });
    assert.equal(result.ok, true); if (!result.ok) return;
    assert.equal(result.status, "COMPLETED"); assert.equal(result.succeeded, 1);
    const [row] = await db.select().from(excelImportRows).where(eq(excelImportRows.batchId, batch.batchId));
    assert.equal(row.importStatus, "IMPORTED"); assert.ok(row.resultRepairCaseId);
    const [created] = await db.select().from(repairCases).where(eq(repairCases.id, row.resultRepairCaseId!));
    assert.equal(created.reasonForRemoval, null); assert.equal(created.reportedSymptom, "reason success"); assert.equal(created.legacyReportNumber, "R-success");
    const [attempt] = await db.select().from(excelImportRowAttempts).where(eq(excelImportRowAttempts.importRowId, row.id));
    assert.equal(attempt.status, "SUCCEEDED"); assert.equal(attempt.resultRepairCaseId, row.resultRepairCaseId);
  });

  test("creates completed legacy state atomically with shipment date, lock, and import history only", async () => {
    const row = parsedRow(4, "legacy-complete", "D970110");
    row.rawCells.U.value = "출하 완료 / 2097-02-03";
    Object.assign(row.normalized, {
      status: "SHIPMENT_COMPLETED",
      legacyDisposition: "COMPLETED",
      actualShipmentDate: "2097-02-03",
      legacyNotes: "출하 완료",
    });
    const batch = await preview("legacy-complete", [row]);
    const confirmed = await confirmExcelImportExecution({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: batch.version });
    assert.equal(confirmed.ok, true); if (!confirmed.ok) return;
    const result = await runExcelImportChunk({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: confirmed.version });
    assert.equal(result.ok, true); if (!result.ok) return;
    const [imported] = await db.select({ resultRepairCaseId: excelImportRows.resultRepairCaseId }).from(excelImportRows).where(eq(excelImportRows.batchId, batch.batchId));
    assert.ok(imported.resultRepairCaseId);
    const [created] = await db.select({ stepKey: workflowSteps.key, actualShipmentDate: repairCases.actualShipmentDate, isLocked: repairCases.isLocked, notes: repairCases.notes }).from(repairCases).innerJoin(workflowSteps, eq(workflowSteps.id, repairCases.currentWorkflowStepId)).where(eq(repairCases.id, imported.resultRepairCaseId!));
    assert.deepEqual(created, { stepKey: "shipment_completed", actualShipmentDate: "2097-02-03", isLocked: true, notes: "출하 완료" });
    const histories = await db.select({ actionType: statusChangeHistories.actionType, actorUserId: statusChangeHistories.actorUserId, metadata: statusChangeHistories.metadata }).from(statusChangeHistories).where(eq(statusChangeHistories.repairCaseId, imported.resultRepairCaseId!));
    assert.equal(histories.length, 1);
    assert.equal(histories[0].actionType, "LEGACY_IMPORT_STATE_SET");
    assert.equal(histories[0].actorUserId, adminId);
    assert.deepEqual(histories[0].metadata, { importBatchId: batch.batchId, sourceRowNumber: 4 });
    assert.equal((await db.select({ count: sql<number>`count(*)::int` }).from(repairCaseApprovals).where(eq(repairCaseApprovals.repairCaseId, imported.resultRepairCaseId!)))[0].count, 0);
    assert.equal((await db.select({ count: sql<number>`count(*)::int` }).from(repairCaseWorkRecords).where(eq(repairCaseWorkRecords.repairCaseId, imported.resultRepairCaseId!)))[0].count, 0);
    assert.equal((await db.select({ count: sql<number>`count(*)::int` }).from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.repairCaseId, imported.resultRepairCaseId!)))[0].count, 0);
  });

  test("applies an exact ongoing step and keeps an unavailable legacy step at intake with notice", async () => {
    const matcher = parsedRow(4, "matcher-waiting-po", "D970111");
    matcher.rawCells.F.value = "Matcher";
    Object.assign(matcher.normalized, { productName: "Matcher", status: "WAITING_PO", legacyDisposition: "IN_PROGRESS", legacyNotes: "P.O 대기중" });
    const unavailable = parsedRow(5, "generator-waiting-shipment", "D970112");
    Object.assign(unavailable.normalized, { status: "WAITING_SHIPMENT", legacyDisposition: "IN_PROGRESS", legacyNotes: "출하 대기" });
    const batch = await preview("legacy-ongoing", [matcher, unavailable]);
    const plan = await getExcelImportPreflightPlan({ batchId: batch.batchId, actorUserId: adminId });
    assert.equal(plan.ok, true); if (!plan.ok) return;
    assert.equal(plan.value.rows[0].legacyState.targetStepKey, "waiting_po");
    assert.equal(plan.value.rows[1].legacyState.apply, false);
    assert.ok(plan.value.rows[1].reasons.some((reason) => reason.code === "LEGACY_STATUS_NOT_APPLIED" && reason.kind === "NOTICE"));
    const confirmed = await confirmExcelImportExecution({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: batch.version });
    assert.equal(confirmed.ok, true); if (!confirmed.ok) return;
    const result = await runExcelImportChunk({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: confirmed.version });
    assert.equal(result.ok, true); if (!result.ok) return;
    const imported = await db.select({ sourceRowNumber: excelImportRows.sourceRowNumber, resultRepairCaseId: excelImportRows.resultRepairCaseId }).from(excelImportRows).where(eq(excelImportRows.batchId, batch.batchId));
    for (const item of imported) {
      const [created] = await db.select({ stepKey: workflowSteps.key }).from(repairCases).innerJoin(workflowSteps, eq(workflowSteps.id, repairCases.currentWorkflowStepId)).where(eq(repairCases.id, item.resultRepairCaseId!));
      assert.equal(created.stepKey, item.sourceRowNumber === 4 ? "waiting_po" : "intake_inspection");
    }
  });

  test("blocks completed pending billing but allows ongoing pending at the initial step", async () => {
    const completed = parsedRow(4, "pending-completed", "D970113");
    Object.assign(completed.normalized, { billingType: "PENDING_DECISION", status: "SHIPMENT_COMPLETED", legacyDisposition: "COMPLETED", actualShipmentDate: "2097-02-03" });
    const ongoing = parsedRow(5, "pending-ongoing", "D970114");
    Object.assign(ongoing.normalized, { billingType: "PENDING_DECISION", status: null, legacyDisposition: "IN_PROGRESS" });
    const batch = await preview("pending-status", [completed, ongoing]);
    const plan = await getExcelImportPreflightPlan({ batchId: batch.batchId, actorUserId: adminId });
    assert.equal(plan.ok, true); if (!plan.ok) return;
    assert.equal(plan.value.rows[0].disposition, "CONFLICT");
    assert.ok(plan.value.rows[0].reasons.some((reason) => reason.code === "PENDING_COMPLETED_REQUIRES_BILLING"));
    assert.equal(plan.value.rows[1].disposition, "EXECUTABLE");
    assert.equal(plan.value.rows[1].legacyState.targetStepKey, null);
    assert.ok(plan.value.rows[1].resolved.workflowStepId);
  });

  test("recovers the case-to-staging crash window without creating a duplicate", async () => {
    const batch = await preview("crash", [parsedRow(4, "crash", "D970102")]);
    const confirmed = await confirmExcelImportExecution({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: batch.version });
    assert.equal(confirmed.ok, true); if (!confirmed.ok) return;
    let crashed = false;
    const first = await runExcelImportChunk({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: confirmed.version }, { afterRepairCaseExecution: async () => { if (!crashed) { crashed = true; throw new Error("simulated crash"); } } });
    assert.deepEqual(first, { ok: false, code: "DATABASE_UNAVAILABLE" });
    const before = await db.select({ count: sql<number>`count(*)::int` }).from(repairCases).where(and(eq(repairCases.intakeNumber, "D970102"), eq(repairCases.legacyReportNumber, "R-crash")));
    assert.equal(before[0].count, 1);
    const resumed = await runExcelImportChunk({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: confirmed.version });
    assert.equal(resumed.ok, true); if (!resumed.ok) return;
    const afterCount = await db.select({ count: sql<number>`count(*)::int` }).from(repairCases).where(and(eq(repairCases.intakeNumber, "D970102"), eq(repairCases.legacyReportNumber, "R-crash")));
    assert.equal(afterCount[0].count, 1); assert.equal(resumed.status, "COMPLETED");
  });

  test("blocks a concurrent runner for the same batch", async () => {
    const batch = await preview("concurrency", [parsedRow(4, "concurrency", "D970103")]);
    const confirmed = await confirmExcelImportExecution({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: batch.version });
    assert.equal(confirmed.ok, true); if (!confirmed.ok) return;
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void; const enteredGate = new Promise<void>((resolve) => { entered = resolve; });
    const first = runExcelImportChunk({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: confirmed.version }, { beforeRowExecution: async () => { entered(); await gate; } });
    await enteredGate;
    const second = await runExcelImportChunk({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: confirmed.version });
    assert.deepEqual(second, { ok: false, code: "CONCURRENT_EXECUTION" });
    release(); assert.equal((await first).ok, true);
  });

  test("rolls back newly resolved masters and Product when the final case insert fails", async () => {
    const row = parsedRow(4, "rollback", "D970104");
    const batch = await preview("rollback", [row]);
    const confirmed = await confirmExcelImportExecution({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: batch.version });
    assert.equal(confirmed.ok, true); if (!confirmed.ok) return;
    const [reference] = await db.select({ customerId: repairCases.customerId, productId: repairCases.productId, workflowVersionId: repairCases.workflowVersionId, stepId: repairCases.currentWorkflowStepId }).from(repairCases).limit(1);
    assert.ok(reference);
    const result = await runExcelImportChunk({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: confirmed.version }, { beforeRowExecution: async () => {
      const [blocker] = await db.insert(repairCases).values({ intakeNumber: "D970104", customerId: reference.customerId, productId: reference.productId, workflowVersionId: reference.workflowVersionId, currentWorkflowStepId: reference.stepId, billingType: "PAID", receivedAt: "2097-01-15" }).returning({ id: repairCases.id });
      blockerCaseIds.push(blocker.id);
    } });
    assert.equal(result.ok, true); if (!result.ok) return;
    assert.equal(result.failed, 1);
    assert.equal(result.status, "FAILED");
    assert.equal((await db.select({ count: sql<number>`count(*)::int` }).from(customers).where(eq(customers.name, row.normalized.customerName!)))[0].count, 0);
    assert.equal((await db.select({ count: sql<number>`count(*)::int` }).from(productModels).where(eq(productModels.modelName, row.normalized.modelName!)))[0].count, 0);
    assert.equal((await db.select({ count: sql<number>`count(*)::int` }).from(products).where(and(eq(products.modelName, row.normalized.modelName!), eq(products.lotNumber, row.normalized.lotNumber!), eq(products.serialNumber, row.normalized.serialNumber!))))[0].count, 0);
  });

  test("keeps all-failed distinct, blocks an unchanged stable error, then retries only the failed row", async () => {
    const batch = await preview("retry-failed", [parsedRow(4, "retry-failed", "D970115")]);
    const confirmed = await confirmExcelImportExecution({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: batch.version });
    assert.equal(confirmed.ok, true); if (!confirmed.ok) return;
    const [reference] = await db.select({ customerId: repairCases.customerId, productId: repairCases.productId, workflowVersionId: repairCases.workflowVersionId, stepId: repairCases.currentWorkflowStepId }).from(repairCases).limit(1);
    const [blocker] = await db.insert(repairCases).values({ intakeNumber: "D970115", customerId: reference.customerId, productId: reference.productId, workflowVersionId: reference.workflowVersionId, currentWorkflowStepId: reference.stepId, billingType: "PAID", receivedAt: "2097-01-15" }).returning({ id: repairCases.id });
    blockerCaseIds.push(blocker.id);
    const failed = await runExcelImportChunk({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: confirmed.version });
    assert.equal(failed.ok, true); if (!failed.ok) return;
    assert.equal(failed.status, "FAILED");
    const blockedRetry = await runExcelImportChunk({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: failed.version, retryFailed: true });
    assert.deepEqual(blockedRetry, { ok: false, code: "RETRY_CONDITION_UNRESOLVED" });
    assert.equal((await db.select({ count: sql<number>`count(*)::int` }).from(excelImportRowAttempts).innerJoin(excelImportRows, eq(excelImportRows.id, excelImportRowAttempts.importRowId)).where(eq(excelImportRows.batchId, batch.batchId)))[0].count, 1);
    await db.delete(repairCases).where(eq(repairCases.id, blocker.id));
    const retried = await runExcelImportChunk({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: failed.version, retryFailed: true });
    assert.equal(retried.ok, true); if (!retried.ok) return;
    assert.equal(retried.status, "COMPLETED");
    const attempts = await db.select({ number: excelImportRowAttempts.attemptNumber, status: excelImportRowAttempts.status }).from(excelImportRowAttempts).innerJoin(excelImportRows, eq(excelImportRows.id, excelImportRowAttempts.importRowId)).where(eq(excelImportRows.batchId, batch.batchId));
    assert.deepEqual(attempts.sort((a, b) => a.number - b.number), [{ number: 1, status: "FAILED" }, { number: 2, status: "SUCCEEDED" }]);
  });

  test("reports PARTIAL_SUCCESS only when success and failure both exist", async () => {
    const rows = [parsedRow(4, "partial-success", "D970116"), parsedRow(5, "partial-failure", "D970117")];
    const batch = await preview("partial", rows);
    const confirmed = await confirmExcelImportExecution({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: batch.version });
    assert.equal(confirmed.ok, true); if (!confirmed.ok) return;
    const [reference] = await db.select({ customerId: repairCases.customerId, productId: repairCases.productId, workflowVersionId: repairCases.workflowVersionId, stepId: repairCases.currentWorkflowStepId }).from(repairCases).limit(1);
    const [blocker] = await db.insert(repairCases).values({ intakeNumber: "D970117", customerId: reference.customerId, productId: reference.productId, workflowVersionId: reference.workflowVersionId, currentWorkflowStepId: reference.stepId, billingType: "PAID", receivedAt: "2097-01-15" }).returning({ id: repairCases.id });
    blockerCaseIds.push(blocker.id);
    const result = await runExcelImportChunk({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: confirmed.version });
    assert.equal(result.ok, true); if (!result.ok) return;
    assert.equal(result.status, "PARTIAL_SUCCESS");
    assert.equal(result.succeeded, 1);
    assert.equal(result.failed, 1);
    await db.delete(repairCases).where(eq(repairCases.id, blocker.id));
    const retried = await runExcelImportChunk({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: result.version, retryFailed: true });
    assert.equal(retried.ok, true); if (!retried.ok) return;
    assert.equal(retried.status, "COMPLETED");
    const attemptsByRow = await db.select({ sourceRowNumber: excelImportRows.sourceRowNumber, count: sql<number>`count(*)::int` }).from(excelImportRowAttempts).innerJoin(excelImportRows, eq(excelImportRows.id, excelImportRowAttempts.importRowId)).where(eq(excelImportRows.batchId, batch.batchId)).groupBy(excelImportRows.sourceRowNumber);
    assert.deepEqual(attemptsByRow.sort((a, b) => a.sourceRowNumber - b.sourceRowNumber), [{ sourceRowNumber: 4, count: 1 }, { sourceRowNumber: 5, count: 2 }]);
  });

  test("guarded reconciliation changes only a proven historical all-failed batch", async () => {
    const batch = await preview("reconcile", Array.from({ length: 10 }, (_, index) => parsedRow(4 + index, `reconcile-${index}`, `D98${String(index).padStart(4, "0")}`)));
    const rows = await db.select({ id: excelImportRows.id }).from(excelImportRows).where(eq(excelImportRows.batchId, batch.batchId));
    await db.update(excelImportRows).set({ importStatus: "FAILED", lastErrorCode: "DATABASE_UNAVAILABLE", lastErrorAt: new Date() }).where(eq(excelImportRows.batchId, batch.batchId));
    await db.insert(excelImportRowAttempts).values(rows.flatMap((row) => [1, 2].map((attemptNumber) => ({ importRowId: row.id, attemptNumber, status: "FAILED" as const, requestedBy: adminId, completedAt: new Date(), errorCode: "DATABASE_UNAVAILABLE" }))));
    await db.insert(repairCaseIdempotencyKeys).values(rows.map((row) => ({ idempotencyKey: row.id, requesterUserId: adminId, status: "FAILED" as const, expiresAt: new Date(Date.now() + 60_000) })));
    const [legacy] = await db.update(excelImportBatches).set({ status: "PARTIAL_SUCCESS", confirmedBy: adminId, confirmedAt: new Date(), completedAt: new Date(), version: sql`${excelImportBatches.version} + 1` }).where(eq(excelImportBatches.id, batch.batchId)).returning({ version: excelImportBatches.version });
    assert.deepEqual(await reconcileFailedExcelImportBatch({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: legacy.version + 1 }), { ok: false, code: "STALE_BATCH_VERSION" });
    const corrected = await reconcileFailedExcelImportBatch({ batchId: batch.batchId, actorUserId: adminId, expectedBatchVersion: legacy.version });
    assert.equal(corrected.ok, true, JSON.stringify(corrected)); if (corrected.ok) assert.equal(corrected.status, "FAILED");
    const reconciliationAudits = await db.select({ id: auditLogs.id, newValue: auditLogs.newValue }).from(auditLogs).where(and(eq(auditLogs.targetEntity, "excel_import_batches"), eq(auditLogs.targetRecordId, batch.batchId)));
    createdAuditIds.push(...reconciliationAudits.map((row) => row.id));
    assert.deepEqual(reconciliationAudits.map((row) => row.newValue), [{ operation: "BATCH_STATUS_RECONCILIATION", status: "FAILED", version: legacy.version + 1, rows: 10, failedAttempts: 20, resultRepairCases: 0 }]);
  });
});
