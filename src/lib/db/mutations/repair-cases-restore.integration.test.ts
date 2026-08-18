import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  auditLogs,
  customers,
  repairCaseIntakeSequences,
  repairCases,
  repairCaseWorkRecords,
  products,
  users,
} from "../schema";
import { createRepairCase, restoreRepairCase, softDeleteRepairCase } from "./repair-cases";
import { getRepairCaseById, listDeletedRepairCases, listRepairCases } from "../queries/repair-cases";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Real-DB integration test against dss-as-postgres-dev for the Repair Case
 * Trash + Restore checkpoint's core mutation (restoreRepairCase) — one case
 * per transaction, version-based optimistic concurrency, the audit_logs
 * RESTORE row it must write inside that same transaction (with contact PII
 * redacted from previous_value), that a restored case reappears in
 * list/detail queries and disappears from the trash query, and that
 * restore never touches linked data. The Server Action's own auth/role gate
 * (canRestoreRepairCases) is unit-tested separately in
 * repair-case-edit-authorization.test.ts and not re-exercised here — same
 * layering precedent as repair-cases-bulk-delete.integration.test.ts.
 *
 * Deliberately self-cleaning and isolated to a test-only customer-name
 * prefix ("AS-TEST-CUSTOMER-RS-") and intake month ("9811" — distinct from
 * every other integration test file's own reserved month; the intake
 * number's year-month is derived from receivedAt, so TEST_YEAR_MONTH and
 * TEST_RECEIVED_AT must always agree) so no two files ever race on the same
 * sequence row or namespace.
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-CUSTOMER-RS-";
const TEST_MODEL_PREFIX = "RS-TEST-MODEL-";
const TEST_YEAR_MONTH = "9811";
const TEST_RECEIVED_AT = "2098-11-01";

let customerId: string;
let engineerId: string;
let adminId: string;

before(async () => {
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
});

after(async () => {
  const testCaseRows = await db
    .select({ id: repairCases.id, productId: repairCases.productId })
    .from(repairCases)
    .where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  const caseIds = testCaseRows.map((r) => r.id);
  if (caseIds.length > 0) {
    await db.delete(auditLogs).where(and(eq(auditLogs.targetEntity, "repair_cases"), inArray(auditLogs.targetRecordId, caseIds)));
    await db.delete(repairCaseWorkRecords).where(inArray(repairCaseWorkRecords.repairCaseId, caseIds));
  }
  await db.delete(repairCaseWorkRecords).where(like(repairCaseWorkRecords.memo, "RS-TEST-WORK-RECORD%"));
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  if (testCaseRows.length > 0) {
    const productIds = [...new Set(testCaseRows.map((r) => r.productId))];
    for (const id of productIds) {
      await db.delete(products).where(eq(products.id, id));
    }
  }
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
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
  return created;
}

async function createAndDeleteTestCase(overrides: Partial<ValidatedCreateRepairCaseInput> = {}) {
  const created = await createTestCase(overrides);
  const deleted = await softDeleteRepairCase({
    id: created.id,
    expectedVersion: 1,
    actorUserId: engineerId,
    reason: "복원 테스트용 사전 삭제",
  });
  assert.equal(deleted.ok, true, `setup delete failed: ${JSON.stringify(deleted)}`);
  return created;
}

async function fetchRow(id: string) {
  const [row] = await db.select().from(repairCases).where(eq(repairCases.id, id));
  return row;
}

describe("restoreRepairCase", () => {
  test("valid restore clears is_deleted/deleted_at/deleted_by/delete_reason and increments version", async () => {
    const created = await createAndDeleteTestCase();

    const result = await restoreRepairCase({ id: created.id, expectedVersion: 2, actorUserId: adminId });
    assert.equal(result.ok, true, `restore failed: ${JSON.stringify(result)}`);

    const row = await fetchRow(created.id);
    assert.equal(row.isDeleted, false);
    assert.equal(row.deletedAt, null);
    assert.equal(row.deletedBy, null);
    assert.equal(row.deleteReason, null);
    assert.equal(row.version, 3);
  });

  test("stale expectedVersion returns CONFLICT and does not modify the row", async () => {
    const created = await createAndDeleteTestCase();

    const result = await restoreRepairCase({ id: created.id, expectedVersion: 999, actorUserId: adminId });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CONFLICT");

    const row = await fetchRow(created.id);
    assert.equal(row.isDeleted, true);
    assert.equal(row.version, 2);
  });

  test("a nonexistent id returns NOT_FOUND", async () => {
    const result = await restoreRepairCase({ id: randomUUID(), expectedVersion: 1, actorUserId: adminId });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });

  test("an active (never-deleted) case returns NOT_FOUND, never silently restored", async () => {
    const created = await createTestCase();

    const result = await restoreRepairCase({ id: created.id, expectedVersion: 1, actorUserId: adminId });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });

  test("an already-restored case returns NOT_FOUND on a second restore attempt (never double-incremented)", async () => {
    const created = await createAndDeleteTestCase();
    const first = await restoreRepairCase({ id: created.id, expectedVersion: 2, actorUserId: adminId });
    assert.equal(first.ok, true);

    const second = await restoreRepairCase({ id: created.id, expectedVersion: 3, actorUserId: adminId });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "NOT_FOUND");
  });

  test("a locked (shipment-completed-style) case can still be restored — no shipment/is_locked block exists", async () => {
    const created = await createAndDeleteTestCase();
    await db.update(repairCases).set({ isLocked: true }).where(eq(repairCases.id, created.id));

    const result = await restoreRepairCase({ id: created.id, expectedVersion: 2, actorUserId: adminId });
    assert.equal(result.ok, true, `restore unexpectedly blocked: ${JSON.stringify(result)}`);
  });

  test("a restored case reappears in listRepairCases()/getRepairCaseById() and disappears from listDeletedRepairCases()", async () => {
    const created = await createAndDeleteTestCase();

    const foundWhileDeleted = await getRepairCaseById(created.id);
    assert.equal(foundWhileDeleted, null, "must not be resolvable by id while deleted");
    const trashBefore = await listDeletedRepairCases();
    assert.ok(trashBefore.some((r) => r.id === created.id), "expected the case in the trash list before restore");

    const result = await restoreRepairCase({ id: created.id, expectedVersion: 2, actorUserId: adminId });
    assert.equal(result.ok, true);

    const foundAfter = await getRepairCaseById(created.id);
    assert.ok(foundAfter, "a restored case must be resolvable by id again");

    const allRows = await listRepairCases();
    assert.ok(allRows.some((r) => r.id === created.id), "a restored case must appear in listRepairCases()");

    const trashAfter = await listDeletedRepairCases();
    assert.ok(!trashAfter.some((r) => r.id === created.id), "a restored case must no longer appear in listDeletedRepairCases()");
  });

  test("related data (repair_case_work_records) is preserved, never recreated/touched by restore", async () => {
    const created = await createTestCase();
    const [workRecord] = await db
      .insert(repairCaseWorkRecords)
      .values({ repairCaseId: created.id, authorUserId: engineerId, memo: `RS-TEST-WORK-RECORD-${randomUUID()}` })
      .returning();

    const deleted = await softDeleteRepairCase({ id: created.id, expectedVersion: 1, actorUserId: engineerId, reason: null });
    assert.equal(deleted.ok, true);

    const result = await restoreRepairCase({ id: created.id, expectedVersion: 2, actorUserId: adminId });
    assert.equal(result.ok, true);

    const [afterRow] = await db.select().from(repairCaseWorkRecords).where(eq(repairCaseWorkRecords.id, workRecord.id));
    assert.ok(afterRow, "the work record must still exist after the case is restored");
    assert.equal(afterRow.memo, workRecord.memo);
  });

  test("inserts exactly one audit_logs RESTORE row with previous_value redacting contact PII", async () => {
    const created = await createAndDeleteTestCase({
      contactName: "김담당",
      contactPhone: "010-1234-5678",
      contactEmail: "contact@example.test",
    });

    const result = await restoreRepairCase({ id: created.id, expectedVersion: 2, actorUserId: adminId });
    assert.equal(result.ok, true);

    const logRows = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetEntity, "repair_cases"), eq(auditLogs.targetRecordId, created.id), eq(auditLogs.actionType, "RESTORE")));
    assert.equal(logRows.length, 1, "expected exactly one audit_logs RESTORE row for this restore");

    const log = logRows[0];
    assert.equal(log.actionType, "RESTORE");
    assert.equal(log.actorUserId, adminId);

    const previousValue = log.previousValue as Record<string, unknown>;
    assert.ok(previousValue, "expected a previous_value (deleted-state) snapshot");
    assert.equal(previousValue.id, created.id);
    assert.equal(previousValue.isDeleted, true, "previous_value must capture the pre-restore (deleted) state");
    assert.equal("contactNameSnapshot" in previousValue, false, "contactNameSnapshot must never reach audit_logs");
    assert.equal("contactPhoneSnapshot" in previousValue, false, "contactPhoneSnapshot must never reach audit_logs");
    assert.equal("contactEmailSnapshot" in previousValue, false, "contactEmailSnapshot must never reach audit_logs");

    const newValue = log.newValue as Record<string, unknown>;
    assert.ok(newValue, "expected a new_value (restored-state) snapshot");
    assert.equal(newValue.isDeleted, false, "new_value must capture the post-restore (active) state");
    assert.equal("contactNameSnapshot" in newValue, false, "contactNameSnapshot must never reach audit_logs");
    assert.equal("contactPhoneSnapshot" in newValue, false, "contactPhoneSnapshot must never reach audit_logs");
    assert.equal("contactEmailSnapshot" in newValue, false, "contactEmailSnapshot must never reach audit_logs");
  });
});
