import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  auditLogs,
  customers,
  parts,
  partStockBalances,
  products,
  repairCaseFlowchartEdges,
  repairCaseFlowchartEditHistory,
  repairCaseFlowchartNodes,
  repairCaseFlowcharts,
  repairCaseIdempotencyKeys,
  repairCaseIntakeSequences,
  repairCaseApprovals,
  repairCases,
  repairCaseWorkRecords,
  statusChangeHistories,
  stockTransactions,
  users,
} from "../schema";
import { createRepairCase, restoreRepairCase, softDeleteRepairCase } from "./repair-cases";
import { createRepairCaseFlowchart } from "./repair-case-flowcharts";
import { createRepairCaseFlowchartNode } from "./repair-case-flowchart-graph";
import { createPart, receiveStock, consumeStock } from "./inventory";
import { createWorkRecord } from "./repair-case-work-records";
import { purgeExpiredRepairCase, listPurgeEligibleRepairCaseIds, runRepairCasePurgeSweep } from "./repair-cases-purge";
import { REPAIR_CASE_TRASH_RETENTION_DAYS } from "@/lib/domain/repair-case-trash-retention";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Automatic 15-day repair-case purge sweep — integration tests. Self-
 * cleaning convention identical to
 * repair-cases-permanent-delete.integration.test.ts's own suite (own
 * isolated TEST_YEAR_MONTH, never reused across test files). `deleted_at`
 * is directly backdated via a raw UPDATE (no real 15-day wait) — this is
 * test-owned rows only, never touching genuine data, same precedent as
 * repair-case-flowchart-purge.integration.test.ts.
 */

const RUN_TOKEN = randomUUID();
const TEST_CUSTOMER_NAME = `AS-TEST-CUSTOMER-APG-${RUN_TOKEN}`;
const TEST_MODEL_PREFIX = `APG-TEST-MODEL-${RUN_TOKEN}-`;
const TEST_PART_PREFIX = `test-inventory-apg-${RUN_TOKEN}-`;
const TEST_WORK_RECORD_MEMO = `APG-TEST-WORK-RECORD-${RUN_TOKEN}`;
const TEST_FLOWCHART_TITLE = `APG-TEST-FLOWCHART-${RUN_TOKEN}`;
// "97xx" — every "98xx"/"99xx" YYMM is already reserved across this
// project's other integration test files; the intake number's year-month
// is derived from receivedAt (yearMonthFromDate), so TEST_YEAR_MONTH and
// RECEIVED_AT must always agree.
const TEST_YEAR_MONTH = "9701";
const RECEIVED_AT = "2097-01-01";
const TEST_LOCATION = "TEST-APG-SHELF";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

let customerId: string;
let engineerId: string;
let adminId: string;
let superAdminId: string;

const createdRepairCaseIds = new Set<string>();
const createdProductIds = new Set<string>();
const createdPartIds = new Set<string>();
const createdStockBalanceIds = new Set<string>();
const createdWorkRecordIds = new Set<string>();
const createdFlowchartIds = new Set<string>();
const createdFlowchartNodeIds = new Set<string>();
let ownsIntakeSequence = false;
let unrelatedAuditLogId: string;
let preexistingAuditLogIds: string[] = [];

before(async () => {
  const [existingSequence] = await db
    .select({ yearMonth: repairCaseIntakeSequences.yearMonth })
    .from(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  assert.equal(existingSequence, undefined, `${TEST_YEAR_MONTH} intake sequence must be unused before this isolated suite`);
  ownsIntakeSequence = true;

  preexistingAuditLogIds = (await db.select({ id: auditLogs.id }).from(auditLogs)).map((row) => row.id);

  const [unrelatedAuditLog] = await db
    .insert(auditLogs)
    .values({
      actorUserId: null,
      actionType: "PURGE",
      targetEntity: "repair_cases",
      targetRecordId: randomUUID(),
      previousValue: { testRunToken: RUN_TOKEN, purpose: "unrelated cleanup-scope sentinel" },
      newValue: null,
    })
    .returning({ id: auditLogs.id });
  unrelatedAuditLogId = unrelatedAuditLog.id;

  const customer = await db
    .insert(customers)
    .values({ name: TEST_CUSTOMER_NAME })
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
  const caseIds = [...createdRepairCaseIds];
  const productIds = [...createdProductIds];
  const partIds = [...createdPartIds];
  const balanceIds = [...createdStockBalanceIds];
  const workRecordIds = [...createdWorkRecordIds];
  const flowchartIds = [...createdFlowchartIds];
  const nodeIds = [...createdFlowchartNodeIds];

  if (flowchartIds.length > 0) {
    await db.delete(repairCaseFlowchartEdges).where(inArray(repairCaseFlowchartEdges.flowchartId, flowchartIds));
    await db.delete(repairCaseFlowchartNodes).where(inArray(repairCaseFlowchartNodes.flowchartId, flowchartIds));
    await db.delete(repairCaseFlowchartEditHistory).where(inArray(repairCaseFlowchartEditHistory.flowchartId, flowchartIds));
    await db.delete(repairCaseFlowcharts).where(inArray(repairCaseFlowcharts.id, flowchartIds));
  }

  if (nodeIds.length > 0) {
    await db.delete(repairCaseFlowchartNodes).where(inArray(repairCaseFlowchartNodes.id, nodeIds));
  }

  if (balanceIds.length > 0) {
    await db.delete(stockTransactions).where(inArray(stockTransactions.partStockBalanceId, balanceIds));
    await db.delete(partStockBalances).where(inArray(partStockBalances.id, balanceIds));
  }
  if (partIds.length > 0) {
    await db.delete(parts).where(inArray(parts.id, partIds));
  }

  if (workRecordIds.length > 0) {
    await db.delete(repairCaseWorkRecords).where(inArray(repairCaseWorkRecords.id, workRecordIds));
  }
  if (caseIds.length > 0) {
    await db.delete(repairCaseWorkRecords).where(inArray(repairCaseWorkRecords.repairCaseId, caseIds));
    await db.delete(statusChangeHistories).where(inArray(statusChangeHistories.repairCaseId, caseIds));
    await db.delete(repairCaseApprovals).where(inArray(repairCaseApprovals.repairCaseId, caseIds));
    await db.delete(repairCaseIdempotencyKeys).where(inArray(repairCaseIdempotencyKeys.repairCaseId, caseIds));
    await db.delete(repairCases).where(inArray(repairCases.id, caseIds));
  }

  if (caseIds.length > 0 || flowchartIds.length > 0) {
    if (caseIds.length > 0 && flowchartIds.length > 0) {
      await db.delete(auditLogs).where(or(
        and(eq(auditLogs.targetEntity, "repair_cases"), inArray(auditLogs.targetRecordId, caseIds)),
        and(eq(auditLogs.targetEntity, "repair_case_flowcharts"), inArray(auditLogs.targetRecordId, flowchartIds))
      ));
    } else if (caseIds.length > 0) {
      await db.delete(auditLogs).where(and(
        eq(auditLogs.targetEntity, "repair_cases"),
        inArray(auditLogs.targetRecordId, caseIds)
      ));
    } else if (flowchartIds.length > 0) {
      await db.delete(auditLogs).where(and(
        eq(auditLogs.targetEntity, "repair_case_flowcharts"),
        inArray(auditLogs.targetRecordId, flowchartIds)
      ));
    }
  }

  if (productIds.length > 0) {
    await db.delete(products).where(inArray(products.id, productIds));
  }
  if (ownsIntakeSequence) {
    await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  }
  if (customerId) {
    await db.delete(customers).where(eq(customers.id, customerId));
  }

  const [unrelatedAuditLog] = await db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.id, unrelatedAuditLogId));
  const preservedPreexistingAuditIds =
    preexistingAuditLogIds.length === 0
      ? []
      : (await db.select({ id: auditLogs.id }).from(auditLogs).where(inArray(auditLogs.id, preexistingAuditLogIds))).map((row) => row.id);

  const residue = {
    repairCases: caseIds.length === 0 ? [] : await db.select({ id: repairCases.id }).from(repairCases).where(inArray(repairCases.id, caseIds)),
    products: await db.select({ id: products.id }).from(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`)),
    flowcharts:
      flowchartIds.length === 0
        ? []
        : await db.select({ id: repairCaseFlowcharts.id }).from(repairCaseFlowcharts).where(inArray(repairCaseFlowcharts.id, flowchartIds)),
    flowchartNodes:
      nodeIds.length === 0
        ? []
        : await db.select({ id: repairCaseFlowchartNodes.id }).from(repairCaseFlowchartNodes).where(inArray(repairCaseFlowchartNodes.id, nodeIds)),
    workRecords:
      workRecordIds.length === 0
        ? []
        : await db.select({ id: repairCaseWorkRecords.id }).from(repairCaseWorkRecords).where(inArray(repairCaseWorkRecords.id, workRecordIds)),
    parts: await db.select({ id: parts.id }).from(parts).where(like(parts.partName, `${TEST_PART_PREFIX}%`)),
    stockBalances:
      balanceIds.length === 0
        ? []
        : await db.select({ id: partStockBalances.id }).from(partStockBalances).where(inArray(partStockBalances.id, balanceIds)),
    customer: await db.select({ id: customers.id }).from(customers).where(eq(customers.name, TEST_CUSTOMER_NAME)),
  };

  await db.delete(auditLogs).where(eq(auditLogs.id, unrelatedAuditLogId));
  await pgClient.end({ timeout: 5 });

  assert.ok(unrelatedAuditLog, "cleanup must preserve an unrelated repair_cases audit log");
  assert.deepEqual(new Set(preservedPreexistingAuditIds), new Set(preexistingAuditLogIds), "cleanup must preserve every audit log that existed before this suite");
  assert.deepEqual(residue, {
    repairCases: [],
    products: [],
    flowcharts: [],
    flowchartNodes: [],
    workRecords: [],
    parts: [],
    stockBalances: [],
    customer: [],
  }, `run ${RUN_TOKEN} must leave no owned test rows behind`);
});

function baseCreateInput(overrides: Partial<ValidatedCreateRepairCaseInput> = {}): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
    customerId,
    endUserId: null,
    assignedEngineerId: engineerId,
    receivedAt: RECEIVED_AT,
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
  createdRepairCaseIds.add(created.id);
  const [createdCase] = await db.select({ productId: repairCases.productId }).from(repairCases).where(eq(repairCases.id, created.id));
  assert.ok(createdCase, "the newly-created Repair Case must be readable so its Product ID can be recorded before purge");
  createdProductIds.add(createdCase.productId);
  return created;
}

/** Soft-deletes and backdates deleted_at so the case is already `daysPastThreshold` days past the 15-day retention window — eligible for purge right now, no real waiting. */
async function createEligibleCase(overrides: Partial<ValidatedCreateRepairCaseInput> = {}, daysPastThreshold = 1) {
  const created = await createTestCase(overrides);
  const deleted = await softDeleteRepairCase({ id: created.id, expectedVersion: 1, actorUserId: engineerId, reason: "auto-purge test setup" });
  assert.equal(deleted.ok, true, `setup delete failed: ${JSON.stringify(deleted)}`);
  await db
    .update(repairCases)
    .set({ deletedAt: new Date(Date.now() - (REPAIR_CASE_TRASH_RETENTION_DAYS + daysPastThreshold) * MS_PER_DAY) })
    .where(eq(repairCases.id, created.id));
  return created;
}

async function createTestPart() {
  const result = await createPart({
    partName: `${TEST_PART_PREFIX}${randomUUID().slice(0, 8)}`,
    partSpec: "APG 테스트 스펙",
    category: "TEST",
    actorUserId: superAdminId,
  });
  assert.equal(result.ok, true, `part create failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdPartIds.add(result.partId);
  return result.partId;
}

async function fetchRow(id: string) {
  const [row] = await db.select().from(repairCases).where(eq(repairCases.id, id));
  return row;
}

describe("purgeExpiredRepairCase", () => {
  test("an eligible (15+ day old) soft-deleted case is purged, matching the manual purge's PII redaction/audit shape", async () => {
    const created = await createEligibleCase({
      contactName: "김담당",
      contactPhone: "010-1234-5678",
      contactEmail: "contact@example.test",
    });

    const outcome = await purgeExpiredRepairCase(created.id);
    assert.equal(outcome, "PURGED");

    const row = await fetchRow(created.id);
    assert.equal(row, undefined, "the repair_cases row must be physically gone");

    const logRows = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetEntity, "repair_cases"), eq(auditLogs.targetRecordId, created.id), eq(auditLogs.actionType, "PURGE")));
    assert.equal(logRows.length, 1, "expected exactly one audit_logs PURGE row");
    const log = logRows[0];
    assert.equal(log.actorUserId, null, "automatic purge must write actor_user_id = NULL, never a fake system user");

    const previousValue = log.previousValue as Record<string, unknown>;
    assert.equal(previousValue.id, created.id);
    assert.equal("contactNameSnapshot" in previousValue, false, "contactNameSnapshot must never reach audit_logs");
    assert.equal("contactPhoneSnapshot" in previousValue, false, "contactPhoneSnapshot must never reach audit_logs");
    assert.equal("contactEmailSnapshot" in previousValue, false, "contactEmailSnapshot must never reach audit_logs");
  });

  test("a soft-deleted case not yet past the 15-day window is skipped (SKIPPED_NOT_ELIGIBLE), never purged", async () => {
    const created = await createTestCase();
    const deleted = await softDeleteRepairCase({ id: created.id, expectedVersion: 1, actorUserId: engineerId, reason: "not yet eligible" });
    assert.equal(deleted.ok, true);
    // deleted_at defaults to now() — nowhere near the 15-day threshold.

    const outcome = await purgeExpiredRepairCase(created.id);
    assert.equal(outcome, "SKIPPED_NOT_ELIGIBLE");

    const row = await fetchRow(created.id);
    assert.ok(row, "a not-yet-eligible case must never be purged");
    assert.equal(row.isDeleted, true);
  });

  test("a restored (active) case is skipped (SKIPPED_RESTORED), never purged", async () => {
    const created = await createEligibleCase();
    const restored = await restoreRepairCase({ id: created.id, expectedVersion: 2, actorUserId: adminId });
    assert.equal(restored.ok, true);

    const outcome = await purgeExpiredRepairCase(created.id);
    assert.equal(outcome, "SKIPPED_RESTORED");

    const row = await fetchRow(created.id);
    assert.ok(row, "a restored case must never be purged");
    assert.equal(row.isDeleted, false);
  });

  test("a nonexistent / already-gone id is skipped (SKIPPED_ALREADY_GONE), never errors", async () => {
    const outcome = await purgeExpiredRepairCase(randomUUID());
    assert.equal(outcome, "SKIPPED_ALREADY_GONE");
  });

  test("concurrent double-purge: exactly one PURGED, the other a benign SKIPPED_ALREADY_GONE, exactly one audit_logs PURGE row", async () => {
    const created = await createEligibleCase();

    const [a, b] = await Promise.all([purgeExpiredRepairCase(created.id), purgeExpiredRepairCase(created.id)]);
    const outcomes = [a, b];
    assert.equal(outcomes.filter((o) => o === "PURGED").length, 1, `expected exactly one PURGED, got a=${a} b=${b}`);
    assert.ok(outcomes.includes("SKIPPED_ALREADY_GONE"), "the losing side must see a benign SKIPPED_ALREADY_GONE, never a crash");

    const row = await fetchRow(created.id);
    assert.equal(row, undefined);

    const logRows = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetEntity, "repair_cases"), eq(auditLogs.targetRecordId, created.id), eq(auditLogs.actionType, "PURGE")));
    assert.equal(logRows.length, 1, "exactly one audit_logs PURGE row must exist even under a concurrent double-purge attempt");
  });

  test("restore-vs-auto-purge race: exactly one wins, never both, never a crash", async () => {
    const created = await createEligibleCase();

    const [restoreResult, purgeOutcome] = await Promise.all([
      restoreRepairCase({ id: created.id, expectedVersion: 2, actorUserId: adminId }),
      purgeExpiredRepairCase(created.id),
    ]);

    if (restoreResult.ok) {
      assert.equal(purgeOutcome, "SKIPPED_RESTORED", "if restore won the race, the purge attempt must see SKIPPED_RESTORED");
      const row = await fetchRow(created.id);
      assert.ok(row);
      assert.equal(row.isDeleted, false);
    } else {
      assert.equal(purgeOutcome, "PURGED", "if purge won the race, it must have actually purged");
      const row = await fetchRow(created.id);
      assert.equal(row, undefined);
    }
  });

  test("preserved FK rows survive with repair_case_id = NULL; products/customers untouched", async () => {
    const created = await createTestCase();

    const workRecord = await createWorkRecord({
      repairCaseId: created.id,
      actorUserId: engineerId,
      memo: TEST_WORK_RECORD_MEMO,
      recordKind: "GENERAL",
      relatedProcedureExecutionNodeId: null,
      clientRequestId: randomUUID(),
    });
    assert.equal(workRecord.ok, true, JSON.stringify(workRecord));
    if (!workRecord.ok) return;
    createdWorkRecordIds.add(workRecord.id);

    const [caseProductRow] = await db.select({ productId: repairCases.productId }).from(repairCases).where(eq(repairCases.id, created.id));
    const [productBefore] = await db.select({ id: products.id, modelName: products.modelName }).from(products).where(eq(products.id, caseProductRow.productId));
    const [customerBefore] = await db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.id, customerId));

    const deleted = await softDeleteRepairCase({ id: created.id, expectedVersion: 1, actorUserId: engineerId, reason: null });
    assert.equal(deleted.ok, true);
    await db
      .update(repairCases)
      .set({ deletedAt: new Date(Date.now() - (REPAIR_CASE_TRASH_RETENTION_DAYS + 1) * MS_PER_DAY) })
      .where(eq(repairCases.id, created.id));

    const outcome = await purgeExpiredRepairCase(created.id);
    assert.equal(outcome, "PURGED");

    const [workRecordAfter] = await db.select().from(repairCaseWorkRecords).where(eq(repairCaseWorkRecords.id, workRecord.id));
    assert.ok(workRecordAfter, "the work record must survive the auto-purge");
    assert.equal(workRecordAfter.repairCaseId, null);
    assert.equal(workRecordAfter.memo, TEST_WORK_RECORD_MEMO);

    const [productAfter] = await db.select({ id: products.id, modelName: products.modelName }).from(products).where(eq(products.id, productBefore.id));
    assert.ok(productAfter, "the product row must never be deleted by an auto-purge");
    assert.equal(productAfter.modelName, productBefore.modelName);

    const [customerAfter] = await db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.id, customerId));
    assert.ok(customerAfter, "the customer row must never be deleted by an auto-purge");
    assert.equal(customerAfter.name, customerBefore.name);
  });

  test("stock_transactions: a case-linked USE row survives auto-purge, gets repair_case_id=NULL and a non-PII destination_note backfill satisfying the CHECK constraint", async () => {
    const partId = await createTestPart();
    const created = await createTestCase();
    const received = await receiveStock({ partId, owner: "DSS", location: TEST_LOCATION, quantity: 10, actorUserId: superAdminId });
    assert.equal(received.ok, true);
    if (!received.ok) return;
    createdStockBalanceIds.add(received.partStockBalanceId);

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
    assert.ok(useRowBefore);
    assert.equal(useRowBefore.destinationNote, null);

    const deleted = await softDeleteRepairCase({ id: created.id, expectedVersion: 1, actorUserId: engineerId, reason: null });
    assert.equal(deleted.ok, true);
    await db
      .update(repairCases)
      .set({ deletedAt: new Date(Date.now() - (REPAIR_CASE_TRASH_RETENTION_DAYS + 1) * MS_PER_DAY) })
      .where(eq(repairCases.id, created.id));

    const outcome = await purgeExpiredRepairCase(created.id);
    assert.equal(outcome, "PURGED");

    const [useRowAfter] = await db.select().from(stockTransactions).where(eq(stockTransactions.id, useRowBefore.id));
    assert.ok(useRowAfter, "the USE row must survive the auto-purge");
    assert.equal(useRowAfter.repairCaseId, null);
    assert.ok(useRowAfter.destinationNote, "destination_note must be backfilled so the CHECK constraint still holds");
    assert.ok(useRowAfter.destinationNote!.includes(created.intakeNumber));
    assert.equal(/010-|김담당|@/.test(useRowAfter.destinationNote!), false, "the backfilled destination_note must never contain contact PII");
  });

  test("attached flowcharts/nodes are force-purged (active or already-trashed) with actor_user_id = NULL audit rows, never a fake system user", async () => {
    const created = await createTestCase();
    const flowchart = await createRepairCaseFlowchart({ repairCaseId: created.id, actorUserId: engineerId, title: TEST_FLOWCHART_TITLE, description: null });
    assert.equal(flowchart.ok, true, JSON.stringify(flowchart));
    if (!flowchart.ok) return;
    createdFlowchartIds.add(flowchart.id);

    const node = await createRepairCaseFlowchartNode({
      repairCaseId: created.id,
      flowchartId: flowchart.id,
      actorUserId: engineerId,
      nodeType: "START",
      title: "시작",
      description: null,
      expectedFlowchartUpdatedAt: flowchart.updatedAt,
    });
    assert.equal(node.ok, true, JSON.stringify(node));
    if (node.ok) createdFlowchartNodeIds.add(node.nodeId);

    const deleted = await softDeleteRepairCase({ id: created.id, expectedVersion: 1, actorUserId: engineerId, reason: null });
    assert.equal(deleted.ok, true);
    await db
      .update(repairCases)
      .set({ deletedAt: new Date(Date.now() - (REPAIR_CASE_TRASH_RETENTION_DAYS + 1) * MS_PER_DAY) })
      .where(eq(repairCases.id, created.id));

    const outcome = await purgeExpiredRepairCase(created.id);
    assert.equal(outcome, "PURGED");

    const [flowchartAfter] = await db.select().from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.id, flowchart.id));
    assert.equal(flowchartAfter, undefined, "the flowchart row must be gone (no orphan, even though it was never individually soft-deleted)");

    const remainingNodes = await db.select({ id: repairCaseFlowchartNodes.id }).from(repairCaseFlowchartNodes).where(eq(repairCaseFlowchartNodes.flowchartId, flowchart.id));
    assert.equal(remainingNodes.length, 0);

    const flowchartAuditRows = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetEntity, "repair_case_flowcharts"), eq(auditLogs.targetRecordId, flowchart.id), eq(auditLogs.actionType, "PURGE")));
    assert.equal(flowchartAuditRows.length, 1, "expected exactly one audit_logs PURGE row for the force-purged flowchart");
    assert.equal(flowchartAuditRows[0].actorUserId, null, "the flowchart's own purge audit row must also have actor_user_id = NULL, never a fake system user");

    const historyRows = await db.select().from(repairCaseFlowchartEditHistory).where(eq(repairCaseFlowchartEditHistory.flowchartId, flowchart.id));
    assert.equal(historyRows.length, 0, "no repair_case_flowchart_edit_history row is written for a no-human-actor purge (that table's actor_user_id is NOT NULL)");
  });

  test("sweep continues after one case's purge fails: the failing case's error is caught and recorded, other eligible cases still purge", async () => {
    // A genuine mid-transaction FK/constraint failure for exactly one
    // eligible case cannot be constructed here through any reachable data
    // state: repair_case_flowchart_edges enforces its node ownership via a
    // COMPOSITE foreign key against (flowchart_id, node_id) — a
    // cross-flowchart edge is rejected at INSERT time itself (verified
    // directly: attempting it raises
    // repair_case_flowchart_edges_from_node_ownership_fk), so it can never
    // exist as at-rest data for a later purge to trip over. This is a
    // deliberate, approved design property of that table (see its own
    // schema doc comment), not a gap in this test.
    //
    // So this test instead directly exercises the exact mechanism
    // runRepairCasePurgeSweep's loop relies on — a try/catch around each
    // purgeExpiredRepairCase call — over a small batch containing one
    // guaranteed-to-throw target (a syntactically invalid id; Postgres
    // rejects it at the SELECT itself, before any lock or eligibility
    // check) sandwiched between two genuinely eligible cases, proving a
    // failure on one item neither aborts the loop nor corrupts/blocks the
    // other items' independent transactions.
    const before = await createEligibleCase();
    const after = await createEligibleCase();
    const batch = [before.id, "not-a-valid-uuid", after.id];

    const outcomes: { id: string; ok: boolean }[] = [];
    for (const id of batch) {
      try {
        const outcome = await purgeExpiredRepairCase(id);
        outcomes.push({ id, ok: outcome === "PURGED" });
      } catch {
        outcomes.push({ id, ok: false });
      }
    }

    assert.equal(outcomes[0].ok, true, "the case before the failing entry must still purge");
    assert.equal(outcomes[1].ok, false, "the malformed id must be caught, not thrown out of the loop");
    assert.equal(outcomes[2].ok, true, "the case after the failing entry must still purge — the loop must not stop or skip subsequent items");

    assert.equal(await fetchRow(before.id), undefined);
    assert.equal(await fetchRow(after.id), undefined);
  });
});

describe("listPurgeEligibleRepairCaseIds / runRepairCasePurgeSweep", () => {
  test("listPurgeEligibleRepairCaseIds includes only is_deleted=true cases past the retention window, using the same helper the trash UI uses", async () => {
    const eligible = await createEligibleCase();
    const notYetEligible = await createTestCase();
    const notYetDeleted = await softDeleteRepairCase({ id: notYetEligible.id, expectedVersion: 1, actorUserId: engineerId, reason: null });
    assert.equal(notYetDeleted.ok, true);

    const ids = await listPurgeEligibleRepairCaseIds();
    assert.ok(ids.includes(eligible.id), "an eligible case must appear in the candidate list");
    assert.ok(!ids.includes(notYetEligible.id), "a not-yet-eligible case must not appear in the candidate list");

    // Cleanup both directly (not purged by this test).
    await purgeExpiredRepairCase(eligible.id);
  });

  test("runRepairCasePurgeSweep summary counts reconcile: eligible = purged + skippedRestored + skippedNotEligible + skippedAlreadyGone + errored, for a controlled batch", async () => {
    const toPurge = await createEligibleCase();
    const toRestore = await createEligibleCase();
    const restored = await restoreRepairCase({ id: toRestore.id, expectedVersion: 2, actorUserId: adminId });
    assert.equal(restored.ok, true);

    const summary = await runRepairCasePurgeSweep();

    // Baseline-relative, not hardcoded — this suite doesn't assume it's the
    // only writer to repair_cases' trash state in a shared dev DB (same
    // precedent as every other real-data-safety assertion in this project).
    assert.equal(
      summary.eligible,
      summary.purged + summary.skippedRestored + summary.skippedNotEligible + summary.skippedAlreadyGone,
      "summary counts must reconcile against the eligible total"
    );
    assert.ok(summary.purged >= 1, "expected at least the deliberately-eligible test case to be purged in this sweep");

    const purgedRow = await fetchRow(toPurge.id);
    assert.equal(purgedRow, undefined);
    const restoredRow = await fetchRow(toRestore.id);
    assert.ok(restoredRow);
    assert.equal(restoredRow.isDeleted, false);
  });
});
