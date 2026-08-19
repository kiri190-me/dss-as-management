import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  auditLogs,
  customers,
  repairCaseIntakeSequences,
  repairCases,
  repairCaseWorkRecords,
  repairCaseIdempotencyKeys,
  products,
  users,
} from "../schema";
import { createRepairCase, softDeleteRepairCase } from "./repair-cases";
import { getRepairCaseById, listRepairCases } from "../queries/repair-cases";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Real-DB integration test against dss-as-postgres-dev for the bulk
 * soft-delete checkpoint's core mutation (softDeleteRepairCase) — one case
 * per transaction, version-based optimistic concurrency, the audit_logs
 * SOFT_DELETE row it must write inside that same transaction (with contact
 * PII redacted from previous_value), and that list/detail queries already
 * exclude the result. The Server Action's own auth/role gate
 * (canBulkDeleteRepairCases) is unit-tested separately in
 * repair-case-edit-authorization.test.ts and not re-exercised here — same
 * layering precedent as every other mutation-layer integration test in this
 * project.
 *
 * Deliberately self-cleaning and isolated to a test-only customer-name
 * prefix ("AS-TEST-CUSTOMER-BD-") and intake month ("9810" — distinct from
 * every other integration test file's own reserved month; the intake
 * number's year-month is derived from receivedAt, so TEST_YEAR_MONTH and
 * TEST_RECEIVED_AT must always agree) so no two files ever race on the same
 * sequence row or namespace.
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-CUSTOMER-BD-";
const TEST_MODEL_PREFIX = "BD-TEST-MODEL-";
const TEST_YEAR_MONTH = "9810";
const TEST_RECEIVED_AT = "2098-10-01";

let customerId: string;
let engineerId: string;
const createdCaseIds = new Set<string>();
const createdProductIds = new Set<string>();
const createdWorkRecordIds = new Set<string>();
let protectedAuditLogIds: string[] = [];
let protectedWorkRecordIds: string[] = [];
let protectedIdempotencyKeys: string[] = [];

before(async () => {
  protectedAuditLogIds = (await db.select({ id: auditLogs.id }).from(auditLogs)).map((row) => row.id);
  protectedWorkRecordIds = (await db.select({ id: repairCaseWorkRecords.id }).from(repairCaseWorkRecords)).map((row) => row.id);
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
});

after(async () => {
  const caseIds = [...createdCaseIds];
  if (caseIds.length > 0) {
    const createdAuditIds = (
      await db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(and(eq(auditLogs.targetEntity, "repair_cases"), inArray(auditLogs.targetRecordId, caseIds)))
    ).map((row) => row.id);
    if (createdAuditIds.length > 0) {
      await db.delete(auditLogs).where(inArray(auditLogs.id, createdAuditIds));
    }
  }
  const workRecordIds = [...createdWorkRecordIds];
  if (workRecordIds.length > 0) {
    await db.delete(repairCaseWorkRecords).where(inArray(repairCaseWorkRecords.id, workRecordIds));
  }
  if (caseIds.length > 0) {
    await db.delete(repairCases).where(inArray(repairCases.id, caseIds));
  }
  const productIds = [...createdProductIds];
  if (productIds.length > 0) {
    await db.delete(products).where(inArray(products.id, productIds));
  }
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(customers).where(eq(customers.id, customerId));

  const preservedAuditIds = protectedAuditLogIds.length === 0 ? [] : (await db.select({ id: auditLogs.id }).from(auditLogs).where(inArray(auditLogs.id, protectedAuditLogIds))).map((row) => row.id);
  const preservedWorkRecordIds = protectedWorkRecordIds.length === 0 ? [] : (await db.select({ id: repairCaseWorkRecords.id }).from(repairCaseWorkRecords).where(inArray(repairCaseWorkRecords.id, protectedWorkRecordIds))).map((row) => row.id);
  const preservedIdempotencyKeys = protectedIdempotencyKeys.length === 0 ? [] : (await db.select({ id: repairCaseIdempotencyKeys.idempotencyKey }).from(repairCaseIdempotencyKeys).where(inArray(repairCaseIdempotencyKeys.idempotencyKey, protectedIdempotencyKeys))).map((row) => row.id);
  assert.deepEqual(new Set(preservedAuditIds), new Set(protectedAuditLogIds));
  assert.deepEqual(new Set(preservedWorkRecordIds), new Set(protectedWorkRecordIds));
  assert.deepEqual(new Set(preservedIdempotencyKeys), new Set(protectedIdempotencyKeys));
  await pgClient.end({ timeout: 5 });
});

function baseCreateInput(overrides: Partial<ValidatedCreateRepairCaseInput> = {}): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "PAID_MATCHER",
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
  createdCaseIds.add(created.id);
  const [createdCase] = await db.select({ productId: repairCases.productId }).from(repairCases).where(eq(repairCases.id, created.id));
  assert.ok(createdCase);
  createdProductIds.add(createdCase.productId);
  return created;
}

async function fetchRow(id: string) {
  const [row] = await db.select().from(repairCases).where(eq(repairCases.id, id));
  return row;
}

describe("softDeleteRepairCase", () => {
  test("valid delete sets is_deleted/deleted_at/deleted_by/delete_reason and increments version", async () => {
    const created = await createTestCase();

    const result = await softDeleteRepairCase({
      id: created.id,
      expectedVersion: 1,
      actorUserId: engineerId,
      reason: "테스트 삭제 사유",
    });
    assert.equal(result.ok, true, `delete failed: ${JSON.stringify(result)}`);

    const row = await fetchRow(created.id);
    assert.equal(row.isDeleted, true);
    assert.ok(row.deletedAt);
    assert.equal(row.deletedBy, engineerId);
    assert.equal(row.deleteReason, "테스트 삭제 사유");
    assert.equal(row.version, 2);
  });

  test("a null reason is accepted and persists as NULL", async () => {
    const created = await createTestCase();

    const result = await softDeleteRepairCase({
      id: created.id,
      expectedVersion: 1,
      actorUserId: engineerId,
      reason: null,
    });
    assert.equal(result.ok, true);

    const row = await fetchRow(created.id);
    assert.equal(row.deleteReason, null);
  });

  test("stale expectedVersion returns CONFLICT and does not modify the row", async () => {
    const created = await createTestCase();

    const result = await softDeleteRepairCase({
      id: created.id,
      expectedVersion: 999,
      actorUserId: engineerId,
      reason: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CONFLICT");

    const row = await fetchRow(created.id);
    assert.equal(row.isDeleted, false);
    assert.equal(row.version, 1);
  });

  test("a nonexistent id returns NOT_FOUND", async () => {
    const result = await softDeleteRepairCase({
      id: randomUUID(),
      expectedVersion: 1,
      actorUserId: engineerId,
      reason: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });

  test("an already-deleted case returns NOT_FOUND on a second delete attempt (never re-deleted, never double-decremented)", async () => {
    const created = await createTestCase();
    const first = await softDeleteRepairCase({
      id: created.id,
      expectedVersion: 1,
      actorUserId: engineerId,
      reason: null,
    });
    assert.equal(first.ok, true);

    const second = await softDeleteRepairCase({
      id: created.id,
      expectedVersion: 2,
      actorUserId: engineerId,
      reason: null,
    });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "NOT_FOUND");
  });

  test("a locked (shipment-completed-style) case can still be deleted — no shipment/is_locked block exists", async () => {
    const created = await createTestCase();
    await db.update(repairCases).set({ isLocked: true }).where(eq(repairCases.id, created.id));

    const result = await softDeleteRepairCase({
      id: created.id,
      expectedVersion: 1,
      actorUserId: engineerId,
      reason: null,
    });
    assert.equal(result.ok, true, `delete unexpectedly blocked: ${JSON.stringify(result)}`);
  });

  test("a deleted case disappears from listRepairCases() and getRepairCaseById()", async () => {
    const created = await createTestCase();
    const foundBefore = await getRepairCaseById(created.id);
    assert.ok(foundBefore, "expected the case to be visible before deletion");

    const result = await softDeleteRepairCase({
      id: created.id,
      expectedVersion: 1,
      actorUserId: engineerId,
      reason: null,
    });
    assert.equal(result.ok, true);

    const foundAfter = await getRepairCaseById(created.id);
    assert.equal(foundAfter, null, "a soft-deleted case must not be resolvable by id anymore");

    const allRows = await listRepairCases();
    assert.ok(!allRows.some((r) => r.id === created.id), "a soft-deleted case must not appear in listRepairCases()");
  });

  test("related data (repair_case_work_records) is preserved, never cascaded/touched", async () => {
    const created = await createTestCase();
    const [workRecord] = await db
      .insert(repairCaseWorkRecords)
      .values({ repairCaseId: created.id, authorUserId: engineerId, memo: `BD-TEST-WORK-RECORD-${randomUUID()}` })
      .returning();
    createdWorkRecordIds.add(workRecord.id);

    const result = await softDeleteRepairCase({
      id: created.id,
      expectedVersion: 1,
      actorUserId: engineerId,
      reason: null,
    });
    assert.equal(result.ok, true);

    const [afterRow] = await db.select().from(repairCaseWorkRecords).where(eq(repairCaseWorkRecords.id, workRecord.id));
    assert.ok(afterRow, "the work record must still exist after the case is soft-deleted");
    assert.equal(afterRow.memo, workRecord.memo);
  });

  test("inserts exactly one audit_logs SOFT_DELETE row with previous_value redacting contact PII", async () => {
    const created = await createTestCase({
      contactName: "김담당",
      contactPhone: "010-1234-5678",
      contactEmail: "contact@example.test",
    });

    const result = await softDeleteRepairCase({
      id: created.id,
      expectedVersion: 1,
      actorUserId: engineerId,
      reason: "감사 로그 테스트",
    });
    assert.equal(result.ok, true);

    const logRows = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetEntity, "repair_cases"), eq(auditLogs.targetRecordId, created.id)));
    assert.equal(logRows.length, 1, "expected exactly one audit_logs row for this delete");

    const log = logRows[0];
    assert.equal(log.actionType, "SOFT_DELETE");
    assert.equal(log.actorUserId, engineerId);
    assert.equal(log.newValue, null);

    const previousValue = log.previousValue as Record<string, unknown>;
    assert.ok(previousValue, "expected a previous_value snapshot");
    assert.equal(previousValue.id, created.id);
    assert.equal("contactNameSnapshot" in previousValue, false, "contactNameSnapshot must never reach audit_logs");
    assert.equal("contactPhoneSnapshot" in previousValue, false, "contactPhoneSnapshot must never reach audit_logs");
    assert.equal("contactEmailSnapshot" in previousValue, false, "contactEmailSnapshot must never reach audit_logs");
  });
});
