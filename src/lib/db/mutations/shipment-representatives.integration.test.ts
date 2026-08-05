import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  users,
  representativeChangeHistory,
  repairCaseApprovals,
  repairCases,
  products,
  customers,
  repairCaseIntakeSequences,
  statusChangeHistories,
} from "../schema";
import { setShipmentRepresentative } from "./shipment-representatives";
import { createRepairCase } from "./repair-cases";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Real-DB integration test for setShipmentRepresentative(). Self-cleaning:
 * only inserts throwaway "shipfix-test-" users, deletes them (and their
 * representative_change_history rows) in after(); the one test that must
 * temporarily unflag the real seeded representative to exercise
 * LAST_REPRESENTATIVE restores it before finishing. Never touches D2608 or
 * the 2608 sequence.
 */

const TEST_EMAIL_PREFIX = "shipfix-test-";
const TEST_MODEL_PREFIX = "REPFIX-TEST-";
const TEST_YEAR_MONTH = "9909";

let superAdminId: string;
let nonSuperAdminId: string;
let engineerId: string;
const createdTestUserIds: string[] = [];

async function createTestUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const [row] = await db
    .insert(users)
    .values({
      email: `${TEST_EMAIL_PREFIX}${randomUUID().slice(0, 8)}@example.test`,
      name: "ShipFix Test User",
      role: "AS_ENGINEER",
      approvalStatus: "APPROVED",
      isActive: true,
      ...overrides,
    })
    .returning({ id: users.id });
  createdTestUserIds.push(row.id);
  return row.id;
}

before(async () => {
  const [superAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(superAdmin, "expected an approved SUPER_ADMIN in the dev DB");
  superAdminId = superAdmin.id;

  const [nonSuperAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(nonSuperAdmin, "expected an approved ADMIN in the dev DB");
  nonSuperAdminId = nonSuperAdmin.id;

  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(engineer, "expected an approved AS_ENGINEER in the dev DB");
  engineerId = engineer.id;
});

after(async () => {
  for (const id of createdTestUserIds) {
    await db.delete(representativeChangeHistory).where(eq(representativeChangeHistory.targetUserId, id));
    await db.delete(representativeChangeHistory).where(eq(representativeChangeHistory.changedByUserId, id));
  }
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

describe("setShipmentRepresentative", () => {
  test("1. flags an eligible (active/approved/unlocked) user as representative and records history", async () => {
    const targetId = await createTestUser();
    const result = await setShipmentRepresentative(targetId, true, superAdminId, "인수인계", false);
    assert.equal(result.ok, true, `flag failed: ${JSON.stringify(result)}`);

    const [row] = await db.select({ isShipmentRepresentative: users.isShipmentRepresentative }).from(users).where(eq(users.id, targetId));
    assert.equal(row!.isShipmentRepresentative, true);

    const [history] = await db.select().from(representativeChangeHistory).where(eq(representativeChangeHistory.targetUserId, targetId));
    assert.ok(history);
    assert.equal(history!.previousValue, false);
    assert.equal(history!.newValue, true);
    assert.equal(history!.changedByUserId, superAdminId);
    assert.equal(history!.reason, "인수인계");
  });

  test("2. rejects flagging an unapproved account (INVALID_USER)", async () => {
    const targetId = await createTestUser({ approvalStatus: "PENDING" });
    const result = await setShipmentRepresentative(targetId, true, superAdminId, null, false);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_USER");
  });

  test("2b. rejects flagging an inactive account (INVALID_USER)", async () => {
    const targetId = await createTestUser({ isActive: false });
    const result = await setShipmentRepresentative(targetId, true, superAdminId, null, false);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_USER");
  });

  test("2c. rejects flagging a locked account (INVALID_USER)", async () => {
    const targetId = await createTestUser({ lockedAt: new Date() });
    const result = await setShipmentRepresentative(targetId, true, superAdminId, null, false);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_USER");
  });

  test("non-SUPER_ADMIN cannot flag a representative (FORBIDDEN)", async () => {
    const targetId = await createTestUser();
    const result = await setShipmentRepresentative(targetId, true, nonSuperAdminId, null, false);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("3. unflags a representative", async () => {
    const targetId = await createTestUser();
    const flagged = await setShipmentRepresentative(targetId, true, superAdminId, null, false);
    assert.equal(flagged.ok, true);

    const unflagged = await setShipmentRepresentative(targetId, false, superAdminId, "역할 변경", false);
    assert.equal(unflagged.ok, true, `unflag failed: ${JSON.stringify(unflagged)}`);

    const [row] = await db.select({ isShipmentRepresentative: users.isShipmentRepresentative }).from(users).where(eq(users.id, targetId));
    assert.equal(row!.isShipmentRepresentative, false);
  });

  test("re-flagging an already-flagged user returns CONFLICT", async () => {
    const targetId = await createTestUser();
    const first = await setShipmentRepresentative(targetId, true, superAdminId, null, false);
    assert.equal(first.ok, true);
    const second = await setShipmentRepresentative(targetId, true, superAdminId, null, false);
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "CONFLICT");
  });

  test("10. two concurrent flag attempts on the same user: exactly one succeeds", async () => {
    const targetId = await createTestUser();
    const [a, b] = await Promise.all([
      setShipmentRepresentative(targetId, true, superAdminId, null, false),
      setShipmentRepresentative(targetId, true, superAdminId, null, false),
    ]);
    const successes = [a, b].filter((r) => r.ok);
    const conflicts = [a, b].filter((r) => !r.ok && r.code === "CONFLICT");
    assert.equal(successes.length, 1, "exactly one flag attempt must succeed");
    assert.equal(conflicts.length, 1, "the other must fail with CONFLICT");
  });

  test("4. prevents unsafe removal of the last representative when a pending FINAL_SHIPMENT request exists, unless confirmed", async () => {
    // Arrange: a temp repair case with a REQUESTED FINAL_SHIPMENT approval,
    // and exactly one representative in the whole system. Earlier tests in
    // this same file leave some temp users flagged (that's their own
    // point), so — rather than assuming only the seeded representative
    // exists — every *currently* flagged representative is temporarily
    // unflagged here and restored in the finally block below, alongside a
    // fresh temp user flagged in their place.
    const otherRepresentatives = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.isShipmentRepresentative, true), eq(users.isDeleted, false), eq(users.isActive, true)));

    const [customer] = await db.select({ id: customers.id }).from(customers).where(eq(customers.isDeleted, false)).limit(1);
    assert.ok(customer);
    const suffix = randomUUID().slice(0, 8);
    const input: ValidatedCreateRepairCaseInput = {
      workflowType: "MATCHER",
      customerId: customer.id,
      endUserId: null,
      assignedEngineerId: engineerId,
      receivedAt: "2099-09-10",
      customerRequestedDueDate: null,
      internalTargetShipmentDate: "2099-09-20",
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
    };
    const created = await createRepairCase(input);
    assert.equal(created.ok, true);
    if (!created.ok) return;

    await db.insert(repairCaseApprovals).values({
      repairCaseId: created.id,
      approvalType: "FINAL_SHIPMENT",
      status: "REQUESTED",
      requestedByUserId: superAdminId,
      repairCaseVersionAtRequest: 1,
    });

    const soleRepresentativeId = await createTestUser();
    const flagged = await setShipmentRepresentative(soleRepresentativeId, true, superAdminId, null, false);
    assert.equal(flagged.ok, true);

    // Arrange-only direct SQL: temporarily remove every other representative
    // so soleRepresentativeId really is the only one left, restored below.
    if (otherRepresentatives.length > 0) {
      await db.update(users).set({ isShipmentRepresentative: false }).where(
        inArray(users.id, otherRepresentatives.map((r) => r.id))
      );
    }

    try {
      const blocked = await setShipmentRepresentative(soleRepresentativeId, false, superAdminId, null, false);
      assert.equal(blocked.ok, false);
      if (!blocked.ok) assert.equal(blocked.code, "LAST_REPRESENTATIVE");

      const confirmed = await setShipmentRepresentative(soleRepresentativeId, false, superAdminId, null, true);
      assert.equal(confirmed.ok, true, `confirmed removal failed: ${JSON.stringify(confirmed)}`);
    } finally {
      if (otherRepresentatives.length > 0) {
        await db.update(users).set({ isShipmentRepresentative: true }).where(
          inArray(users.id, otherRepresentatives.map((r) => r.id))
        );
      }
      await db.delete(repairCaseApprovals).where(eq(repairCaseApprovals.repairCaseId, created.id));
      await db.delete(statusChangeHistories).where(eq(statusChangeHistories.repairCaseId, created.id));
      await db.delete(repairCases).where(eq(repairCases.id, created.id));
      await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
      await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
    }
  });
});
