import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  users,
  customers,
  products,
  repairCases,
  repairCaseIntakeSequences,
  repairCaseApprovals,
  shipmentApprovalDelegations,
  representativeChangeHistory,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import { decideRepairCaseApproval } from "./repair-case-approvals";
import { createShipmentDelegation, revokeShipmentDelegation } from "./shipment-delegations";
import { setShipmentRepresentative } from "./shipment-representatives";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Real-DB integration test proving decideRepairCaseApproval() actually
 * enforces delegation validity end-to-end (window, revocation,
 * representative/delegate eligibility), and correctly records
 * decided_by_user_id/delegated_from_user_id for both direct and delegated
 * FINAL_SHIPMENT decisions. Also confirms REPAIR_INSPECTION's decide path
 * is untouched by any of this.
 *
 * Self-cleaning and isolated to test month "9910" / product prefix
 * "DELEGDEC-TEST-", distinct from every other isolated-month suite in this
 * directory. Delegation/representative-history fixtures are scoped to
 * throwaway "shipfix-decide-test-" users, deleted in after().
 */

const TEST_RECEIVED_AT = "2099-10-10";
const TEST_SHIPMENT_DATE = "2099-10-20";
const TEST_MODEL_PREFIX = "DELEGDEC-TEST-";
const TEST_YEAR_MONTH = "9910";
const TEST_EMAIL_PREFIX = "shipfix-decide-test-";

let customerId: string;
let engineerId: string;
let adminId: string;
let superAdminId: string;
const createdTestUserIds: string[] = [];
const createdCaseIds: string[] = [];

async function createTestUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const [row] = await db
    .insert(users)
    .values({
      email: `${TEST_EMAIL_PREFIX}${randomUUID().slice(0, 8)}@example.test`,
      name: "ShipFix Decide Test User",
      role: "AS_ENGINEER",
      approvalStatus: "APPROVED",
      isActive: true,
      ...overrides,
    })
    .returning({ id: users.id });
  createdTestUserIds.push(row.id);
  return row.id;
}

async function createTestRepresentative(overrides: Partial<typeof users.$inferInsert> = {}) {
  const id = await createTestUser(overrides);
  // superAdminId is assigned in before(), which always runs before any
  // test (and therefore this helper) — safe despite the textual order.
  const result = await setShipmentRepresentative(id, true, superAdminId, null, false);
  assert.equal(result.ok, true, `setup: failed to flag test representative: ${JSON.stringify(result)}`);
  return id;
}

function hoursFromNow(h: number): Date {
  return new Date(Date.now() + h * 60 * 60 * 1000);
}

function baseCreateInput(): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "MATCHER",
    customerId,
    endUserId: null,
    assignedEngineerId: engineerId,
    receivedAt: TEST_RECEIVED_AT,
    customerRequestedDueDate: null,
    internalTargetShipmentDate: TEST_SHIPMENT_DATE,
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
}

/** Arrange-only: a fresh case with a REQUESTED FINAL_SHIPMENT row, bypassing
 * requestRepairCaseApproval's own REPAIR_INSPECTION prerequisite (irrelevant
 * to these decide-time tests — decideRepairCaseApproval never re-checks the
 * workflow step itself, only the approval row's own status). */
async function createCaseWithPendingFinalShipment(): Promise<{ caseId: string; version: number }> {
  const created = await createRepairCase(baseCreateInput());
  assert.equal(created.ok, true, `setup create failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  createdCaseIds.push(created.id);

  await db.insert(repairCaseApprovals).values({
    repairCaseId: created.id,
    approvalType: "FINAL_SHIPMENT",
    status: "REQUESTED",
    requestedByUserId: engineerId,
    repairCaseVersionAtRequest: 1,
  });

  return { caseId: created.id, version: 1 };
}

async function createCaseWithPendingRepairInspection(): Promise<string> {
  const created = await createRepairCase(baseCreateInput());
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("unreachable");
  createdCaseIds.push(created.id);

  await db.insert(repairCaseApprovals).values({
    repairCaseId: created.id,
    approvalType: "REPAIR_INSPECTION",
    status: "REQUESTED",
    requestedByUserId: engineerId,
    repairCaseVersionAtRequest: 1,
  });
  return created.id;
}

before(async () => {
  const [customer] = await db.select({ id: customers.id }).from(customers).where(eq(customers.isDeleted, false)).limit(1);
  assert.ok(customer);
  customerId = customer.id;

  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(engineer);
  engineerId = engineer.id;

  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(admin);
  adminId = admin.id;

  const [superAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(superAdmin);
  superAdminId = superAdmin.id;
});

after(async () => {
  for (const caseId of createdCaseIds) {
    await db.delete(repairCaseApprovals).where(eq(repairCaseApprovals.repairCaseId, caseId));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, "D9910%"));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));

  for (const id of createdTestUserIds) {
    await db.delete(shipmentApprovalDelegations).where(eq(shipmentApprovalDelegations.representativeUserId, id));
    await db.delete(shipmentApprovalDelegations).where(eq(shipmentApprovalDelegations.delegateUserId, id));
    await db.delete(representativeChangeHistory).where(eq(representativeChangeHistory.targetUserId, id));
    await db.delete(representativeChangeHistory).where(eq(representativeChangeHistory.changedByUserId, id));
  }
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

describe("decideRepairCaseApproval: delegation validity", () => {
  test("11. a scheduled (not-yet-started) delegation does not authorize a decision", async () => {
    const repId = await createTestRepresentative();
    const delegateId = await createTestUser();
    const delegation = await createShipmentDelegation(repId, delegateId, hoursFromNow(2), hoursFromNow(48), repId, null);
    assert.equal(delegation.ok, true);

    const { caseId } = await createCaseWithPendingFinalShipment();
    const result = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", delegateId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("12. an active delegation (now within window) authorizes a decision", async () => {
    const repId = await createTestRepresentative();
    const delegateId = await createTestUser();
    const delegation = await createShipmentDelegation(repId, delegateId, hoursFromNow(-1), hoursFromNow(48), repId, null);
    assert.equal(delegation.ok, true);

    const { caseId } = await createCaseWithPendingFinalShipment();
    const result = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", delegateId, null);
    assert.equal(result.ok, true, `delegated decision failed: ${JSON.stringify(result)}`);
  });

  test("13. an expired (window already passed) delegation does not authorize a decision", async () => {
    const repId = await createTestRepresentative();
    const delegateId = await createTestUser();
    const delegation = await createShipmentDelegation(repId, delegateId, hoursFromNow(-48), hoursFromNow(-1), repId, null);
    assert.equal(delegation.ok, true);

    const { caseId } = await createCaseWithPendingFinalShipment();
    const result = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", delegateId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("14. a revoked delegation does not authorize a decision", async () => {
    const repId = await createTestRepresentative();
    const delegateId = await createTestUser();
    const delegation = await createShipmentDelegation(repId, delegateId, hoursFromNow(-1), hoursFromNow(48), repId, null);
    assert.equal(delegation.ok, true);
    if (!delegation.ok) return;
    const revoked = await revokeShipmentDelegation(delegation.id, repId);
    assert.equal(revoked.ok, true);

    const { caseId } = await createCaseWithPendingFinalShipment();
    const result = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", delegateId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("15. an active delegation whose representative was unflagged no longer authorizes a decision", async () => {
    const repId = await createTestRepresentative();
    const delegateId = await createTestUser();
    const delegation = await createShipmentDelegation(repId, delegateId, hoursFromNow(-1), hoursFromNow(48), repId, null);
    assert.equal(delegation.ok, true);

    const unflagged = await setShipmentRepresentative(repId, false, superAdminId, null, false);
    assert.equal(unflagged.ok, true, `setup: failed to unflag representative: ${JSON.stringify(unflagged)}`);

    const { caseId } = await createCaseWithPendingFinalShipment();
    const result = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", delegateId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("15b. an active delegation whose representative became inactive no longer authorizes a decision", async () => {
    const repId = await createTestRepresentative();
    const delegateId = await createTestUser();
    const delegation = await createShipmentDelegation(repId, delegateId, hoursFromNow(-1), hoursFromNow(48), repId, null);
    assert.equal(delegation.ok, true);

    await db.update(users).set({ isActive: false }).where(eq(users.id, repId));

    const { caseId } = await createCaseWithPendingFinalShipment();
    const result = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", delegateId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("16. a delegate who became inactive can no longer decide, even with an otherwise-valid delegation", async () => {
    const repId = await createTestRepresentative();
    const delegateId = await createTestUser();
    const delegation = await createShipmentDelegation(repId, delegateId, hoursFromNow(-1), hoursFromNow(48), repId, null);
    assert.equal(delegation.ok, true);

    await db.update(users).set({ isActive: false }).where(eq(users.id, delegateId));

    const { caseId } = await createCaseWithPendingFinalShipment();
    const result = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", delegateId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("16b. a locked delegate can no longer decide, even with an otherwise-valid delegation", async () => {
    const repId = await createTestRepresentative();
    const delegateId = await createTestUser();
    const delegation = await createShipmentDelegation(repId, delegateId, hoursFromNow(-1), hoursFromNow(48), repId, null);
    assert.equal(delegation.ok, true);

    await db.update(users).set({ lockedAt: new Date() }).where(eq(users.id, delegateId));

    const { caseId } = await createCaseWithPendingFinalShipment();
    const result = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", delegateId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });
});

describe("decideRepairCaseApproval: direct vs delegated recording", () => {
  test("17/18/19. a delegate deciding FINAL_SHIPMENT stores decided_by_user_id=delegate and delegated_from_user_id=representative", async () => {
    const repId = await createTestRepresentative();
    const delegateId = await createTestUser();
    const delegation = await createShipmentDelegation(repId, delegateId, hoursFromNow(-1), hoursFromNow(48), repId, null);
    assert.equal(delegation.ok, true);

    const { caseId } = await createCaseWithPendingFinalShipment();
    const result = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", delegateId, null);
    assert.equal(result.ok, true, `delegated decision failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const [row] = await db.select().from(repairCaseApprovals).where(eq(repairCaseApprovals.id, result.id));
    assert.equal(row!.decidedByUserId, delegateId, "decided_by_user_id must be the actual delegate");
    assert.equal(row!.delegatedFromUserId, repId, "delegated_from_user_id must be the representative");
  });

  test("20. a direct representative decision leaves delegated_from_user_id null", async () => {
    const repId = await createTestRepresentative();
    const { caseId } = await createCaseWithPendingFinalShipment();
    const result = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", repId, null);
    assert.equal(result.ok, true, `direct decision failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const [row] = await db.select().from(repairCaseApprovals).where(eq(repairCaseApprovals.id, result.id));
    assert.equal(row!.decidedByUserId, repId);
    assert.equal(row!.delegatedFromUserId, null, "a direct representative decision must never stamp delegated_from_user_id");
  });

  test("a representative deciding directly takes priority even while also holding an active delegation from someone else", async () => {
    // Confirms the direct-representative branch is checked before the
    // delegate-lookup branch — a representative's OWN decision is always
    // direct, never accidentally attributed as "delegated from" anyone.
    const repId = await createTestRepresentative();
    const otherRepId = await createTestRepresentative();
    const deleg = await createShipmentDelegation(otherRepId, repId, hoursFromNow(-1), hoursFromNow(48), otherRepId, null);
    assert.equal(deleg.ok, true);

    const { caseId } = await createCaseWithPendingFinalShipment();
    const result = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", repId, null);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const [row] = await db.select().from(repairCaseApprovals).where(eq(repairCaseApprovals.id, result.id));
    assert.equal(row!.delegatedFromUserId, null);
  });
});

describe("decideRepairCaseApproval: REPAIR_INSPECTION unaffected", () => {
  test("21. REPAIR_INSPECTION decisions are unaffected by delegation logic (role-eligible actor succeeds, delegated_from stays null)", async () => {
    const caseId = await createCaseWithPendingRepairInspection();
    const result = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", adminId, null);
    assert.equal(result.ok, true, `REPAIR_INSPECTION decision failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const [row] = await db.select().from(repairCaseApprovals).where(eq(repairCaseApprovals.id, result.id));
    assert.equal(row!.decidedByUserId, adminId);
    assert.equal(row!.delegatedFromUserId, null);
  });

  test("21b. a non-representative, non-delegate but role-eligible user can still decide REPAIR_INSPECTION", async () => {
    const engineerActor = await createTestUser({ role: "AS_ENGINEER" });
    const caseId = await createCaseWithPendingRepairInspection();
    const result = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", engineerActor, null);
    assert.equal(result.ok, true, `REPAIR_INSPECTION decision failed: ${JSON.stringify(result)}`);
  });
});

describe("decideRepairCaseApproval: concurrency against revoke/unflag", () => {
  test("22a. representative unflagged concurrently with a delegate's decision resolves to exactly one consistent outcome", async () => {
    const repId = await createTestRepresentative();
    const delegateId = await createTestUser();
    const delegation = await createShipmentDelegation(repId, delegateId, hoursFromNow(-1), hoursFromNow(48), repId, null);
    assert.equal(delegation.ok, true);
    const { caseId } = await createCaseWithPendingFinalShipment();

    const [decideResult, unflagResult] = await Promise.all([
      decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", delegateId, null),
      setShipmentRepresentative(repId, false, superAdminId, null, false),
    ]);

    // Both racing operations must themselves resolve cleanly (the row locks
    // serialize them — neither throws or corrupts the other's state) —
    // which particular legitimate ordering won is not asserted, only that
    // the two are mutually consistent: the decision succeeded only if it
    // observed the representative as still eligible.
    assert.equal(unflagResult.ok, true, `unflag must always succeed regardless of ordering: ${JSON.stringify(unflagResult)}`);

    const [approvalRow] = await db.select().from(repairCaseApprovals).where(eq(repairCaseApprovals.repairCaseId, caseId));
    if (decideResult.ok) {
      assert.equal(approvalRow!.status, "APPROVED");
      assert.equal(approvalRow!.decidedByUserId, delegateId);
    } else {
      assert.equal(approvalRow!.status, "REQUESTED", "a failed decision must never partially apply");
      assert.equal(decideResult.code, "FORBIDDEN");
    }
  });

  test("delegation revoked concurrently with the delegate's decision resolves to exactly one consistent outcome", async () => {
    const repId = await createTestRepresentative();
    const delegateId = await createTestUser();
    const delegation = await createShipmentDelegation(repId, delegateId, hoursFromNow(-1), hoursFromNow(48), repId, null);
    assert.equal(delegation.ok, true);
    if (!delegation.ok) return;
    const { caseId } = await createCaseWithPendingFinalShipment();

    const [decideResult, revokeResult] = await Promise.all([
      decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", delegateId, null),
      revokeShipmentDelegation(delegation.id, repId),
    ]);

    assert.equal(revokeResult.ok, true, `revoke must always succeed regardless of ordering: ${JSON.stringify(revokeResult)}`);

    const [approvalRow] = await db.select().from(repairCaseApprovals).where(eq(repairCaseApprovals.repairCaseId, caseId));
    if (decideResult.ok) {
      assert.equal(approvalRow!.status, "APPROVED");
      assert.equal(approvalRow!.decidedByUserId, delegateId);
    } else {
      assert.equal(approvalRow!.status, "REQUESTED", "a failed decision must never partially apply");
      assert.equal(decideResult.code, "FORBIDDEN");
    }
  });
});
