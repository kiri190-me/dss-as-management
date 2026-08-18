import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  auditLogs,
  customers,
  inventoryPartRequestItems,
  inventoryPartRequests,
  parts,
  partStockBalances,
  products,
  repairCaseApprovals,
  repairCaseFlowchartEditHistory,
  repairCaseFlowchartNodes,
  repairCaseFlowcharts,
  repairCaseIdempotencyKeys,
  repairCaseIntakeSequences,
  repairCases,
  repairCaseWorkRecords,
  statusChangeHistories,
  stockTransactions,
  users,
} from "../schema";
import { createRepairCase, permanentlyDeleteRepairCase, restoreRepairCase, softDeleteRepairCase } from "./repair-cases";
import { createRepairCaseFlowchart } from "./repair-case-flowcharts";
import { createRepairCaseFlowchartNode, createRepairCaseFlowchartEdge } from "./repair-case-flowchart-graph";
import { createPart, receiveStock, consumeStock } from "./inventory";
import { createPartRequest } from "./inventory-part-requests";
import { createWorkRecord } from "./repair-case-work-records";
import { getRepairCaseById, listDeletedRepairCases } from "../queries/repair-cases";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Repair Case Permanent Delete checkpoint — integration tests against the
 * real dev DB for permanentlyDeleteRepairCase: one case per transaction,
 * version-based optimistic concurrency (+ a pessimistic FOR UPDATE row
 * lock, unlike soft-delete/restore), the audit_logs PURGE row it must
 * write (with contact PII redacted from previous_value), the 6 preserved
 * history/accounting tables surviving with repair_case_id = NULL, the
 * stock_transactions destination_note backfill/no-overwrite behavior, the
 * cascade-purge of every attached repair_case_flowchart (edges/nodes gone,
 * history survives), and restore-vs-purge / double-purge race behavior.
 * The Server Action's own auth/role gate (canPermanentlyDeleteRepairCases)
 * is unit-tested separately in repair-case-edit-authorization.test.ts and
 * not re-exercised here — same layering precedent as every other
 * mutation-layer integration test in this project.
 *
 * Deliberately self-cleaning and isolated to a test-only customer-name
 * prefix ("AS-TEST-CUSTOMER-PD-") and intake month ("9812" — distinct from
 * every other integration test file's own reserved month). Every purged
 * repair case leaves its FK-preserved rows with repair_case_id = NULL — by
 * design, that's exactly what this suite tests — so cleanup below never
 * relies on repair_case_id to find those rows again; it tracks created ids
 * explicitly (createdPartIds/createdRequestIds/createdFlowchartIds) and
 * cascades from there, same "createdXIds array, not a repair_case_id
 * lookup" precedent inventory.integration.test.ts already uses for parts.
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-CUSTOMER-PD-";
const TEST_MODEL_PREFIX = "PD-TEST-MODEL-";
const TEST_PART_PREFIX = "test-inventory-pd-";
const TEST_YEAR_MONTH = "9812";
const TEST_RECEIVED_AT = "2098-12-01";
const TEST_LOCATION = "TEST-PD-SHELF";

let customerId: string;
let engineerId: string;
let adminId: string;
let superAdminId: string;

const createdPartIds: string[] = [];
const createdRequestIds: string[] = [];
const createdFlowchartIds: string[] = [];
const createdCaseIds: string[] = [];
const createdProductIds: string[] = [];
const createdWorkRecordIds: string[] = [];
const createdStatusHistoryIds: string[] = [];
const createdApprovalIds: string[] = [];
let protectedAuditLogIds: string[] = [];
let protectedIdempotencyKeys: string[] = [];

before(async () => {
  protectedAuditLogIds = (await db.select({ id: auditLogs.id }).from(auditLogs)).map((row) => row.id);
  protectedIdempotencyKeys = (await db.select({ id: repairCaseIdempotencyKeys.idempotencyKey }).from(repairCaseIdempotencyKeys)).map((row) => row.id);
  const customer = await db
    .insert(customers)
    .values({ name: `${TEST_CUSTOMER_NAME_PREFIX}${randomUUID().slice(0, 8)}` })
    .returning();
  customerId = customer[0].id;

  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(engineer, "expected at least one approved AS_ENGINEER in the dev DB");
  engineerId = engineer.id;

  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(admin, "expected an approved ADMIN in the dev DB");
  adminId = admin.id;

  const [superAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(superAdmin, "expected an approved SUPER_ADMIN in the dev DB");
  superAdminId = superAdmin.id;
});

after(async () => {
  // Flowcharts: any not already purged by a test (still-active fixtures)
  // are cleaned the normal way; any test id whose flowchart WAS purged is
  // already gone (that's what's being tested) — deleting again is a no-op.
  if (createdFlowchartIds.length > 0) {
    const { repairCaseFlowchartEdges } = await import("../schema");
    await db.delete(repairCaseFlowchartEdges).where(inArray(repairCaseFlowchartEdges.flowchartId, createdFlowchartIds));
    await db.delete(repairCaseFlowchartNodes).where(inArray(repairCaseFlowchartNodes.flowchartId, createdFlowchartIds));
    await db.delete(repairCaseFlowchartEditHistory).where(inArray(repairCaseFlowchartEditHistory.flowchartId, createdFlowchartIds));
    await db.delete(repairCaseFlowcharts).where(inArray(repairCaseFlowcharts.id, createdFlowchartIds));
  }
  // Purged flowcharts leave history with flowchart_id = NULL. Locate those
  // rows by the exact flowchart IDs embedded in their snapshots.
  for (const flowchartId of createdFlowchartIds) {
    await db.delete(repairCaseFlowchartEditHistory).where(
      sql`${repairCaseFlowchartEditHistory.beforeState}->>'id' = ${flowchartId} OR ${repairCaseFlowchartEditHistory.afterState}->>'id' = ${flowchartId}`
    );
  }

  // Parts request rows: tracked explicitly (repair_case_id is nulled by the
  // very purge this suite tests, so it can't be used to find them after).
  if (createdRequestIds.length > 0) {
    const { inventoryPartRequestIssues, inventoryPartRequestHistory, inventoryPartRequestIdempotencyKeys } = await import("../schema");
    await db.delete(inventoryPartRequestIdempotencyKeys).where(inArray(inventoryPartRequestIdempotencyKeys.requestId, createdRequestIds));
    await db.delete(inventoryPartRequestHistory).where(inArray(inventoryPartRequestHistory.requestId, createdRequestIds));
    await db.delete(inventoryPartRequestIssues).where(inArray(inventoryPartRequestIssues.requestId, createdRequestIds));
    await db.delete(inventoryPartRequestItems).where(inArray(inventoryPartRequestItems.requestId, createdRequestIds));
    await db.delete(inventoryPartRequests).where(inArray(inventoryPartRequests.id, createdRequestIds));
  }

  // Parts and stock rows are limited to IDs captured immediately at create.
  const allPartIds = [...new Set(createdPartIds)];
  if (allPartIds.length > 0) {
    const balances = await db.select({ id: partStockBalances.id }).from(partStockBalances).where(inArray(partStockBalances.partId, allPartIds));
    const balanceIds = balances.map((b) => b.id);
    if (balanceIds.length > 0) {
      await db.delete(stockTransactions).where(inArray(stockTransactions.partStockBalanceId, balanceIds));
      await db.delete(partStockBalances).where(inArray(partStockBalances.id, balanceIds));
    }
    await db.delete(parts).where(inArray(parts.id, allPartIds));
  }

  if (createdWorkRecordIds.length > 0) {
    await db.delete(repairCaseWorkRecords).where(inArray(repairCaseWorkRecords.id, [...new Set(createdWorkRecordIds)]));
  }
  if (createdStatusHistoryIds.length > 0) {
    await db.delete(statusChangeHistories).where(inArray(statusChangeHistories.id, [...new Set(createdStatusHistoryIds)]));
  }
  if (createdApprovalIds.length > 0) {
    await db.delete(repairCaseApprovals).where(inArray(repairCaseApprovals.id, [...new Set(createdApprovalIds)]));
  }

  // Never delete another suite's or an existing business record's audit
  // history. Purged cases are gone, but their exact ids remain in memory.
  if (createdCaseIds.length > 0) {
    await db.delete(auditLogs).where(
      and(
        eq(auditLogs.targetEntity, "repair_cases"),
        inArray(auditLogs.targetRecordId, createdCaseIds)
      )
    );
  }

  if (createdCaseIds.length > 0) {
    await db.delete(repairCases).where(inArray(repairCases.id, [...new Set(createdCaseIds)]));
  }
  if (createdProductIds.length > 0) {
    await db.delete(products).where(inArray(products.id, [...new Set(createdProductIds)]));
  }
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(customers).where(eq(customers.id, customerId));
  if (protectedAuditLogIds.length > 0) {
    const preserved = await db.select({ id: auditLogs.id }).from(auditLogs).where(inArray(auditLogs.id, protectedAuditLogIds));
    assert.deepEqual(preserved.map((row) => row.id).sort(), [...protectedAuditLogIds].sort());
  }
  if (protectedIdempotencyKeys.length > 0) {
    const preserved = await db.select({ id: repairCaseIdempotencyKeys.idempotencyKey }).from(repairCaseIdempotencyKeys).where(inArray(repairCaseIdempotencyKeys.idempotencyKey, protectedIdempotencyKeys));
    assert.deepEqual(preserved.map((row) => row.id).sort(), [...protectedIdempotencyKeys].sort());
  }
  await pgClient.end({ timeout: 5 });
});

function baseCreateInput(overrides: Partial<ValidatedCreateRepairCaseInput> = {}): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "MATCHER",
    billingType: "PAID",
    customerId,
    endUserId: null,
    assignedEngineerId: engineerId,
    receivedAt: TEST_RECEIVED_AT,
    customerRequestedDueDate: null,
    internalTargetShipmentDate: null,
    modelName: `${TEST_MODEL_PREFIX}${suffix}`,
    lotNumber: `LOT-${suffix}`,
    serialNumber: `SN-${suffix}`,
    partNumber: null,
    accessoryList: null,
    externalConditionSummary: null,
    reasonForRemoval: null,
    reportedSymptom: null,
    intakeInspectionResult: null,
    currentDiagnosisSummary: null,
    nextPlannedAction: null,
    notes: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    ...overrides,
  };
}

async function createTestCase(overrides: Partial<ValidatedCreateRepairCaseInput> = {}) {
  const created = await createRepairCase(baseCreateInput(overrides));
  assert.equal(created.ok, true, `setup failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("setup failed");
  createdCaseIds.push(created.id);
  const [createdCase] = await db.select({ productId: repairCases.productId }).from(repairCases).where(eq(repairCases.id, created.id));
  assert.ok(createdCase, "new Repair Case must be readable before a purge so its Product ID can be retained for cleanup");
  createdProductIds.push(createdCase.productId);
  return created;
}

async function createAndDeleteTestCase(overrides: Partial<ValidatedCreateRepairCaseInput> = {}) {
  const created = await createTestCase(overrides);
  const deleted = await softDeleteRepairCase({
    id: created.id,
    expectedVersion: 1,
    actorUserId: engineerId,
    reason: "영구 삭제 테스트용 사전 삭제",
  });
  assert.equal(deleted.ok, true, `setup delete failed: ${JSON.stringify(deleted)}`);
  return created;
}

async function createTestPart() {
  const result = await createPart({
    partName: `${TEST_PART_PREFIX}${randomUUID().slice(0, 8)}`,
    partSpec: "PD 테스트 스펙",
    category: "TEST",
    actorUserId: superAdminId,
  });
  assert.equal(result.ok, true, `part create failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdPartIds.push(result.partId);
  return result.partId;
}

async function fetchRow(id: string) {
  const [row] = await db.select().from(repairCases).where(eq(repairCases.id, id));
  return row;
}

describe("permanentlyDeleteRepairCase", () => {
  test("a nonexistent id returns NOT_FOUND", async () => {
    const result = await permanentlyDeleteRepairCase({
      id: randomUUID(),
      expectedVersion: 1,
      actorUserId: adminId,
      reason: "테스트",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });

  test("an active (never-deleted) case returns NOT_FOUND, never silently purged", async () => {
    const created = await createTestCase();

    const result = await permanentlyDeleteRepairCase({
      id: created.id,
      expectedVersion: 1,
      actorUserId: adminId,
      reason: "테스트",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");

    const row = await fetchRow(created.id);
    assert.ok(row, "an active case must never be removed by a rejected purge attempt");
  });

  test("stale expectedVersion returns CONFLICT and does not delete the row", async () => {
    const created = await createAndDeleteTestCase();

    const result = await permanentlyDeleteRepairCase({
      id: created.id,
      expectedVersion: 999,
      actorUserId: adminId,
      reason: "테스트",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CONFLICT");

    const row = await fetchRow(created.id);
    assert.ok(row, "a stale-version purge attempt must never delete the row");
  });

  test("inserts exactly one audit_logs PURGE row with previous_value redacting contact PII", async () => {
    const created = await createAndDeleteTestCase({
      contactName: "김담당",
      contactPhone: "010-1234-5678",
      contactEmail: "contact@example.test",
    });

    const result = await permanentlyDeleteRepairCase({
      id: created.id,
      expectedVersion: 2,
      actorUserId: adminId,
      reason: "PII 감사 테스트",
    });
    assert.equal(result.ok, true, `purge failed: ${JSON.stringify(result)}`);

    const row = await fetchRow(created.id);
    assert.equal(row, undefined, "the repair_cases row must be physically gone after purge");

    const logRows = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetEntity, "repair_cases"), eq(auditLogs.targetRecordId, created.id), eq(auditLogs.actionType, "PURGE")));
    assert.equal(logRows.length, 1, "expected exactly one audit_logs PURGE row for this purge");

    const log = logRows[0];
    assert.equal(log.actorUserId, adminId);
    assert.equal(log.newValue, null);

    const previousValue = log.previousValue as Record<string, unknown>;
    assert.ok(previousValue, "expected a previous_value snapshot");
    assert.equal(previousValue.id, created.id);
    assert.equal("contactNameSnapshot" in previousValue, false, "contactNameSnapshot must never reach audit_logs");
    assert.equal("contactPhoneSnapshot" in previousValue, false, "contactPhoneSnapshot must never reach audit_logs");
    assert.equal("contactEmailSnapshot" in previousValue, false, "contactEmailSnapshot must never reach audit_logs");
  });

  test("a purged case disappears from listDeletedRepairCases()/getRepairCaseById()", async () => {
    const created = await createAndDeleteTestCase();
    const trashBefore = await listDeletedRepairCases();
    assert.ok(trashBefore.some((r) => r.id === created.id), "expected the case in the trash list before purge");

    const result = await permanentlyDeleteRepairCase({ id: created.id, expectedVersion: 2, actorUserId: adminId, reason: "테스트" });
    assert.equal(result.ok, true);

    const trashAfter = await listDeletedRepairCases();
    assert.ok(!trashAfter.some((r) => r.id === created.id), "a purged case must no longer appear in listDeletedRepairCases()");
    const found = await getRepairCaseById(created.id);
    assert.equal(found, null);
  });

  test("preserved FK rows (work records, status history, approvals) survive with repair_case_id = NULL; products/customers untouched", async () => {
    const created = await createTestCase();

    const workRecord = await createWorkRecord({
      repairCaseId: created.id,
      actorUserId: engineerId,
      memo: "PD-TEST-WORK-RECORD",
      recordKind: "GENERAL",
      relatedProcedureExecutionNodeId: null,
      clientRequestId: randomUUID(),
    });
    assert.equal(workRecord.ok, true, JSON.stringify(workRecord));
    if (!workRecord.ok) return;
    createdWorkRecordIds.push(workRecord.id);

    const [caseRow] = await db.select({ workflowVersionId: repairCases.workflowVersionId }).from(repairCases).where(eq(repairCases.id, created.id));
    const [insertedHistory] = await db
      .insert(statusChangeHistories)
      .values({
        repairCaseId: created.id,
        workflowVersionId: caseRow.workflowVersionId,
        actionType: "HOLD_STARTED",
        actorUserId: engineerId,
      })
      .returning({ id: statusChangeHistories.id });
    createdStatusHistoryIds.push(insertedHistory.id);

    const [insertedApproval] = await db
      .insert(repairCaseApprovals)
      .values({
        repairCaseId: created.id,
        approvalType: "REPAIR_INSPECTION",
        requestedByUserId: engineerId,
        repairCaseVersionAtRequest: 1,
      })
      .returning({ id: repairCaseApprovals.id });
    createdApprovalIds.push(insertedApproval.id);

    const [caseProductRow] = await db.select({ productId: repairCases.productId }).from(repairCases).where(eq(repairCases.id, created.id));
    const [productBefore] = await db.select({ id: products.id, modelName: products.modelName }).from(products).where(eq(products.id, caseProductRow.productId));
    const [customerBefore] = await db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.id, customerId));

    const softDeleted = await softDeleteRepairCase({ id: created.id, expectedVersion: 1, actorUserId: engineerId, reason: null });
    assert.equal(softDeleted.ok, true);

    const purged = await permanentlyDeleteRepairCase({ id: created.id, expectedVersion: 2, actorUserId: adminId, reason: "보존 검증" });
    assert.equal(purged.ok, true, JSON.stringify(purged));

    const [workRecordAfter] = await db.select().from(repairCaseWorkRecords).where(eq(repairCaseWorkRecords.id, workRecord.id));
    assert.ok(workRecordAfter, "the work record must survive the purge");
    assert.equal(workRecordAfter.repairCaseId, null, "the work record's repair_case_id must be NULL after purge");
    assert.equal(workRecordAfter.memo, "PD-TEST-WORK-RECORD");

    const [historyAfter] = await db.select().from(statusChangeHistories).where(eq(statusChangeHistories.id, insertedHistory.id));
    assert.ok(historyAfter, "status_change_histories row must survive the purge");
    assert.equal(historyAfter.repairCaseId, null);

    const [approvalAfter] = await db.select().from(repairCaseApprovals).where(eq(repairCaseApprovals.id, insertedApproval.id));
    assert.ok(approvalAfter, "repair_case_approvals row must survive the purge");
    assert.equal(approvalAfter.repairCaseId, null);

    const [productAfter] = await db.select({ id: products.id, modelName: products.modelName }).from(products).where(eq(products.id, productBefore.id));
    assert.ok(productAfter, "the product row must never be deleted by a repair-case purge");
    assert.equal(productAfter.modelName, productBefore.modelName);

    const [customerAfter] = await db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.id, customerId));
    assert.ok(customerAfter, "the customer row must never be deleted by a repair-case purge");
    assert.equal(customerAfter.name, customerBefore.name);
  });

  test("stock_transactions: a case-linked USE row (destination_note NULL) survives, gets repair_case_id=NULL and a non-PII destination_note backfill satisfying the CHECK constraint", async () => {
    const partId = await createTestPart();
    const created = await createTestCase();
    const received = await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 10, actorUserId: superAdminId });
    assert.equal(received.ok, true);
    if (!received.ok) return;

    const used = await consumeStock({
      partStockBalanceId: received.partStockBalanceId,
      quantity: 2,
      repairCaseId: created.id,
      actorUserId: superAdminId,
      expectedVersion: received.version,
    });
    assert.equal(used.ok, true, JSON.stringify(used));

    const [useRowBefore] = await db
      .select()
      .from(stockTransactions)
      .where(and(eq(stockTransactions.repairCaseId, created.id), eq(stockTransactions.transactionType, "USE")));
    assert.ok(useRowBefore, "expected the USE row to exist before purge");
    assert.equal(useRowBefore.destinationNote, null, "setup: destination_note must start NULL for this scenario");

    const softDeleted = await softDeleteRepairCase({ id: created.id, expectedVersion: 1, actorUserId: engineerId, reason: null });
    assert.equal(softDeleted.ok, true);

    const purged = await permanentlyDeleteRepairCase({ id: created.id, expectedVersion: 2, actorUserId: adminId, reason: "재고 이력 보존 검증" });
    assert.equal(purged.ok, true, JSON.stringify(purged));

    const [useRowAfter] = await db.select().from(stockTransactions).where(eq(stockTransactions.id, useRowBefore.id));
    assert.ok(useRowAfter, "the USE row must survive the purge (accounting-relevant)");
    assert.equal(useRowAfter.repairCaseId, null, "repair_case_id must be NULL after purge");
    assert.ok(useRowAfter.destinationNote, "destination_note must be backfilled so the CHECK constraint still holds");
    assert.ok(
      useRowAfter.destinationNote!.includes(created.intakeNumber),
      "the backfilled destination_note should be identifiable via the intake number"
    );
    assert.equal(/010-|김담당|@/.test(useRowAfter.destinationNote!), false, "the backfilled destination_note must never contain contact PII");
  });

  test("stock_transactions: an existing destination_note is never overwritten by the purge backfill", async () => {
    const partId = await createTestPart();
    const created = await createTestCase();
    const received = await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 10, actorUserId: superAdminId });
    assert.equal(received.ok, true);
    if (!received.ok) return;

    const ORIGINAL_NOTE = "PD-TEST-EXISTING-DESTINATION-NOTE";
    const used = await consumeStock({
      partStockBalanceId: received.partStockBalanceId,
      quantity: 1,
      repairCaseId: created.id,
      destinationNote: ORIGINAL_NOTE,
      actorUserId: superAdminId,
      expectedVersion: received.version,
    });
    assert.equal(used.ok, true, JSON.stringify(used));

    const [useRowBefore] = await db
      .select()
      .from(stockTransactions)
      .where(and(eq(stockTransactions.repairCaseId, created.id), eq(stockTransactions.transactionType, "USE")));
    assert.equal(useRowBefore.destinationNote, ORIGINAL_NOTE);

    const softDeleted = await softDeleteRepairCase({ id: created.id, expectedVersion: 1, actorUserId: engineerId, reason: null });
    assert.equal(softDeleted.ok, true);
    const purged = await permanentlyDeleteRepairCase({ id: created.id, expectedVersion: 2, actorUserId: adminId, reason: "기존 메모 보존 검증" });
    assert.equal(purged.ok, true, JSON.stringify(purged));

    const [useRowAfter] = await db.select().from(stockTransactions).where(eq(stockTransactions.id, useRowBefore.id));
    assert.ok(useRowAfter);
    assert.equal(useRowAfter.repairCaseId, null);
    assert.equal(useRowAfter.destinationNote, ORIGINAL_NOTE, "an operator-entered destination_note must never be overwritten by the purge backfill");
  });

  test("inventory_part_requests survives purge with repair_case_id = NULL", async () => {
    const partId = await createTestPart();
    const created = await createTestCase();
    const request = await createPartRequest({
      repairCaseId: created.id,
      items: [{ partId, quantity: 3, owner: "DSS" }],
      actorUserId: engineerId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(request.ok, true, JSON.stringify(request));
    if (!request.ok) return;
    createdRequestIds.push(request.requestId);

    const softDeleted = await softDeleteRepairCase({ id: created.id, expectedVersion: 1, actorUserId: engineerId, reason: null });
    assert.equal(softDeleted.ok, true);
    const purged = await permanentlyDeleteRepairCase({ id: created.id, expectedVersion: 2, actorUserId: adminId, reason: "부품 요청 보존 검증" });
    assert.equal(purged.ok, true, JSON.stringify(purged));

    const [requestRow] = await db.select().from(inventoryPartRequests).where(eq(inventoryPartRequests.id, request.requestId));
    assert.ok(requestRow, "the inventory_part_requests row must survive the purge");
    assert.equal(requestRow.repairCaseId, null);
  });

  test("repair_case_idempotency_keys is deleted by the purge (short-lived operational data, no audit value)", async () => {
    const created = await createTestCase();
    const idempotencyKey = randomUUID();
    await db.insert(repairCaseIdempotencyKeys).values({
      idempotencyKey,
      requesterUserId: engineerId,
      repairCaseId: created.id,
      status: "SUCCEEDED",
      responseSnapshot: { repairCaseId: created.id, intakeNumber: created.intakeNumber },
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const before = await db.select().from(repairCaseIdempotencyKeys).where(eq(repairCaseIdempotencyKeys.idempotencyKey, idempotencyKey));
    assert.equal(before.length, 1);

    const softDeleted = await softDeleteRepairCase({ id: created.id, expectedVersion: 1, actorUserId: engineerId, reason: null });
    assert.equal(softDeleted.ok, true);
    const purged = await permanentlyDeleteRepairCase({ id: created.id, expectedVersion: 2, actorUserId: adminId, reason: "테스트" });
    assert.equal(purged.ok, true, JSON.stringify(purged));

    const after = await db.select().from(repairCaseIdempotencyKeys).where(eq(repairCaseIdempotencyKeys.idempotencyKey, idempotencyKey));
    assert.equal(after.length, 0, "the idempotency key row must be physically deleted by the purge, not merely nulled");
  });

  test("attached flowcharts/nodes/edges are removed and flowchart history survives with flowchart_id = NULL", async () => {
    const created = await createTestCase();
    const flowchart = await createRepairCaseFlowchart({
      repairCaseId: created.id,
      actorUserId: engineerId,
      title: "PD-TEST-FLOWCHART",
      description: null,
    });
    assert.equal(flowchart.ok, true, JSON.stringify(flowchart));
    if (!flowchart.ok) return;
    createdFlowchartIds.push(flowchart.id);

    const node1 = await createRepairCaseFlowchartNode({
      repairCaseId: created.id,
      flowchartId: flowchart.id,
      actorUserId: engineerId,
      nodeType: "START",
      title: "시작",
      description: null,
      expectedFlowchartUpdatedAt: flowchart.updatedAt,
    });
    assert.equal(node1.ok, true, JSON.stringify(node1));
    if (!node1.ok) return;

    const node2 = await createRepairCaseFlowchartNode({
      repairCaseId: created.id,
      flowchartId: flowchart.id,
      actorUserId: engineerId,
      nodeType: "TASK",
      title: "작업",
      description: null,
      expectedFlowchartUpdatedAt: node1.updatedAt,
    });
    assert.equal(node2.ok, true, JSON.stringify(node2));
    if (!node2.ok) return;

    const edge = await createRepairCaseFlowchartEdge({
      repairCaseId: created.id,
      flowchartId: flowchart.id,
      actorUserId: engineerId,
      fromNodeId: node1.nodeId,
      toNodeId: node2.nodeId,
      branchType: "DEFAULT",
      branchLabel: null,
      expectedFlowchartUpdatedAt: node2.updatedAt,
    });
    assert.equal(edge.ok, true, JSON.stringify(edge));

    const historyRowsBefore = await db
      .select({ id: repairCaseFlowchartEditHistory.id })
      .from(repairCaseFlowchartEditHistory)
      .where(eq(repairCaseFlowchartEditHistory.flowchartId, flowchart.id));
    assert.ok(historyRowsBefore.length > 0, "expected pre-purge history rows for this flowchart");
    const preExistingHistoryIds = historyRowsBefore.map((r) => r.id);

    const softDeleted = await softDeleteRepairCase({ id: created.id, expectedVersion: 1, actorUserId: engineerId, reason: null });
    assert.equal(softDeleted.ok, true);
    const purged = await permanentlyDeleteRepairCase({ id: created.id, expectedVersion: 2, actorUserId: adminId, reason: "PD-TEST-flowchart-cascade" });
    assert.equal(purged.ok, true, JSON.stringify(purged));

    const [flowchartAfter] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, flowchart.id));
    assert.equal(flowchartAfter, undefined, "the flowchart row must be gone (no orphan)");

    const remainingNodes = await db.select({ id: repairCaseFlowchartNodes.id }).from(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.flowchartId, flowchart.id));
    assert.equal(remainingNodes.length, 0, "no orphan nodes may remain");

    const historyRowsAfter = await db
      .select()
      .from(repairCaseFlowchartEditHistory)
      .where(inArray(repairCaseFlowchartEditHistory.id, preExistingHistoryIds));
    assert.equal(historyRowsAfter.length, preExistingHistoryIds.length, "every pre-purge history row must survive");
    for (const row of historyRowsAfter) {
      assert.equal(row.flowchartId, null, "surviving history rows must have flowchart_id nulled, not deleted");
    }

    const purgeRows = await db
      .select()
      .from(repairCaseFlowchartEditHistory)
      .where(eq(repairCaseFlowchartEditHistory.actionType, "PURGE_FLOWCHART"));
    assert.ok(
      purgeRows.some((r) => r.reason === "PD-TEST-flowchart-cascade"),
      "expected a PURGE_FLOWCHART history row written by the cascade purge"
    );
  });

  test("restore-vs-purge race: exactly one wins, the other is a clean NOT_FOUND, never both, never a crash", async () => {
    const created = await createAndDeleteTestCase();

    const [restoreResult, purgeResult] = await Promise.all([
      restoreRepairCase({ id: created.id, expectedVersion: 2, actorUserId: adminId }),
      permanentlyDeleteRepairCase({ id: created.id, expectedVersion: 2, actorUserId: adminId, reason: "race test" }),
    ]);

    const outcomes = [restoreResult.ok, purgeResult.ok];
    assert.equal(outcomes.filter(Boolean).length, 1, `expected exactly one winner, got restore=${restoreResult.ok} purge=${purgeResult.ok}`);

    const loser = restoreResult.ok ? purgeResult : restoreResult;
    assert.equal(loser.ok, false);
    if (!loser.ok) assert.equal(loser.code, "NOT_FOUND", "the losing side of the race must see a clean NOT_FOUND, never CONFLICT or a crash");

    if (restoreResult.ok) {
      const row = await fetchRow(created.id);
      assert.ok(row, "restore won: the case must still exist");
      assert.equal(row.isDeleted, false);
    } else {
      const row = await fetchRow(created.id);
      assert.equal(row, undefined, "purge won: the case must be gone");
    }
  });

  test("concurrent double-purge: exactly one succeeds, the other is a benign NOT_FOUND, exactly one audit_logs PURGE row is written", async () => {
    const created = await createAndDeleteTestCase();

    const [a, b] = await Promise.all([
      permanentlyDeleteRepairCase({ id: created.id, expectedVersion: 2, actorUserId: adminId, reason: "double purge A" }),
      permanentlyDeleteRepairCase({ id: created.id, expectedVersion: 2, actorUserId: adminId, reason: "double purge B" }),
    ]);

    const results = [a, b];
    assert.equal(results.filter((r) => r.ok).length, 1, `expected exactly one purge to succeed, got a=${a.ok} b=${b.ok}`);
    const loser = a.ok ? b : a;
    assert.equal(loser.ok, false);
    if (!loser.ok) assert.equal(loser.code, "NOT_FOUND");

    const row = await fetchRow(created.id);
    assert.equal(row, undefined);

    const logRows = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetEntity, "repair_cases"), eq(auditLogs.targetRecordId, created.id), eq(auditLogs.actionType, "PURGE")));
    assert.equal(logRows.length, 1, "exactly one audit_logs PURGE row must exist even under a concurrent double-purge attempt");
  });
});
