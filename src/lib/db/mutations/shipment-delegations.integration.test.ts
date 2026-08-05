import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { users, shipmentApprovalDelegations, representativeChangeHistory } from "../schema";
import { createShipmentDelegation, revokeShipmentDelegation } from "./shipment-delegations";
import { setShipmentRepresentative } from "./shipment-representatives";

/**
 * Real-DB integration test for createShipmentDelegation() /
 * revokeShipmentDelegation(). Self-cleaning: only inserts throwaway
 * "shipfix-deleg-test-" users and their delegation/representative-history
 * rows, all deleted in after(). Never touches D2608 or the 2608 sequence
 * (this file never creates a repair case).
 */

const TEST_EMAIL_PREFIX = "shipfix-deleg-test-";

let superAdminId: string;
let nonSuperAdminId: string;
const createdTestUserIds: string[] = [];

async function createTestUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const [row] = await db
    .insert(users)
    .values({
      email: `${TEST_EMAIL_PREFIX}${randomUUID().slice(0, 8)}@example.test`,
      name: "ShipFix Delegation Test User",
      role: "AS_ENGINEER",
      approvalStatus: "APPROVED",
      isActive: true,
      ...overrides,
    })
    .returning({ id: users.id });
  createdTestUserIds.push(row.id);
  return row.id;
}

async function createTestRepresentative() {
  const id = await createTestUser();
  const result = await setShipmentRepresentative(id, true, superAdminId, null, false);
  assert.equal(result.ok, true, `setup: failed to flag test representative: ${JSON.stringify(result)}`);
  return id;
}

function hoursFromNow(h: number): Date {
  return new Date(Date.now() + h * 60 * 60 * 1000);
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
});

after(async () => {
  // Every delegation created in this file always has a createTestUser()
  // row as both representative and delegate — superAdminId/nonSuperAdminId
  // are only ever actors, never delegation parties — so deleting by
  // representative/delegate id (the loop below) is sufficient and never
  // touches a real, non-test delegation.
  for (const id of createdTestUserIds) {
    await db.delete(shipmentApprovalDelegations).where(eq(shipmentApprovalDelegations.representativeUserId, id));
    await db.delete(shipmentApprovalDelegations).where(eq(shipmentApprovalDelegations.delegateUserId, id));
    await db.delete(representativeChangeHistory).where(eq(representativeChangeHistory.targetUserId, id));
    await db.delete(representativeChangeHistory).where(eq(representativeChangeHistory.changedByUserId, id));
  }
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

describe("createShipmentDelegation", () => {
  test("5. a representative delegates their own authority", async () => {
    const repId = await createTestRepresentative();
    const delegateId = await createTestUser();
    const result = await createShipmentDelegation(repId, delegateId, hoursFromNow(1), hoursFromNow(48), repId, "휴가");
    assert.equal(result.ok, true, `self-delegation failed: ${JSON.stringify(result)}`);
  });

  test("6. SUPER_ADMIN delegates on behalf of a representative", async () => {
    const repId = await createTestRepresentative();
    const delegateId = await createTestUser();
    const result = await createShipmentDelegation(repId, delegateId, hoursFromNow(1), hoursFromNow(48), superAdminId, null);
    assert.equal(result.ok, true, `admin-assigned delegation failed: ${JSON.stringify(result)}`);
  });

  test("7. an unrelated user cannot assign delegation for a representative (FORBIDDEN)", async () => {
    const repId = await createTestRepresentative();
    const delegateId = await createTestUser();
    const unrelatedActor = await createTestUser();
    const result = await createShipmentDelegation(repId, delegateId, hoursFromNow(1), hoursFromNow(48), unrelatedActor, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("7b. an ADMIN (not SUPER_ADMIN) cannot assign delegation for a representative (FORBIDDEN)", async () => {
    const repId = await createTestRepresentative();
    const delegateId = await createTestUser();
    const result = await createShipmentDelegation(repId, delegateId, hoursFromNow(1), hoursFromNow(48), nonSuperAdminId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("8. an invalid date range (ends before starts) is rejected", async () => {
    const repId = await createTestRepresentative();
    const delegateId = await createTestUser();
    const result = await createShipmentDelegation(repId, delegateId, hoursFromNow(48), hoursFromNow(1), superAdminId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_TIME_RANGE");
  });

  test("9. self-delegation (representative delegating to themselves) is rejected", async () => {
    const repId = await createTestRepresentative();
    const result = await createShipmentDelegation(repId, repId, hoursFromNow(1), hoursFromNow(48), superAdminId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "VALIDATION_ERROR");
  });

  test("rejects an ineligible (unapproved) representative", async () => {
    const repId = await createTestUser({ approvalStatus: "PENDING" });
    const delegateId = await createTestUser();
    const result = await createShipmentDelegation(repId, delegateId, hoursFromNow(1), hoursFromNow(48), superAdminId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_USER");
  });

  test("rejects an ineligible (locked) delegate", async () => {
    const repId = await createTestRepresentative();
    const delegateId = await createTestUser({ lockedAt: new Date() });
    const result = await createShipmentDelegation(repId, delegateId, hoursFromNow(1), hoursFromNow(48), superAdminId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_USER");
  });

  test("10. an overlapping delegation for the same representative+delegate pair is rejected", async () => {
    const repId = await createTestRepresentative();
    const delegateId = await createTestUser();
    const first = await createShipmentDelegation(repId, delegateId, hoursFromNow(1), hoursFromNow(48), superAdminId, null);
    assert.equal(first.ok, true);

    const overlapping = await createShipmentDelegation(repId, delegateId, hoursFromNow(24), hoursFromNow(72), superAdminId, null);
    assert.equal(overlapping.ok, false);
    if (!overlapping.ok) assert.equal(overlapping.code, "OVERLAPPING_DELEGATION");
  });

  test("a non-overlapping (back-to-back) delegation for the same pair succeeds", async () => {
    const repId = await createTestRepresentative();
    const delegateId = await createTestUser();
    const first = await createShipmentDelegation(repId, delegateId, hoursFromNow(1), hoursFromNow(24), superAdminId, null);
    assert.equal(first.ok, true);

    const second = await createShipmentDelegation(repId, delegateId, hoursFromNow(24), hoursFromNow(48), superAdminId, null);
    assert.equal(second.ok, true, `back-to-back delegation unexpectedly rejected: ${JSON.stringify(second)}`);
  });

  test("22. two concurrent overlapping-delegation creates for the same pair: exactly one succeeds", async () => {
    const repId = await createTestRepresentative();
    const delegateId = await createTestUser();
    const [a, b] = await Promise.all([
      createShipmentDelegation(repId, delegateId, hoursFromNow(1), hoursFromNow(48), superAdminId, null),
      createShipmentDelegation(repId, delegateId, hoursFromNow(2), hoursFromNow(50), superAdminId, null),
    ]);
    const successes = [a, b].filter((r) => r.ok);
    const overlaps = [a, b].filter((r) => !r.ok && r.code === "OVERLAPPING_DELEGATION");
    assert.equal(successes.length, 1, "exactly one concurrent create must succeed");
    assert.equal(overlaps.length, 1, "the other must fail with OVERLAPPING_DELEGATION");

    const rows = await db
      .select()
      .from(shipmentApprovalDelegations)
      .where(and(eq(shipmentApprovalDelegations.representativeUserId, repId), eq(shipmentApprovalDelegations.delegateUserId, delegateId)));
    assert.equal(rows.length, 1, "no duplicate overlapping row must exist");
  });
});

describe("revokeShipmentDelegation", () => {
  test("representative revokes their own delegation", async () => {
    const repId = await createTestRepresentative();
    const delegateId = await createTestUser();
    const created = await createShipmentDelegation(repId, delegateId, hoursFromNow(1), hoursFromNow(48), repId, null);
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const revoked = await revokeShipmentDelegation(created.id, repId);
    assert.equal(revoked.ok, true, `revoke failed: ${JSON.stringify(revoked)}`);

    const [row] = await db.select().from(shipmentApprovalDelegations).where(eq(shipmentApprovalDelegations.id, created.id));
    assert.equal(row!.status, "REVOKED");
    assert.equal(row!.revokedByUserId, repId);
    assert.ok(row!.revokedAt);
  });

  test("SUPER_ADMIN revokes on behalf of a representative", async () => {
    const repId = await createTestRepresentative();
    const delegateId = await createTestUser();
    const created = await createShipmentDelegation(repId, delegateId, hoursFromNow(1), hoursFromNow(48), superAdminId, null);
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const revoked = await revokeShipmentDelegation(created.id, superAdminId);
    assert.equal(revoked.ok, true);
  });

  test("an unrelated user cannot revoke (FORBIDDEN)", async () => {
    const repId = await createTestRepresentative();
    const delegateId = await createTestUser();
    const unrelatedActor = await createTestUser();
    const created = await createShipmentDelegation(repId, delegateId, hoursFromNow(1), hoursFromNow(48), superAdminId, null);
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const result = await revokeShipmentDelegation(created.id, unrelatedActor);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("double revocation returns CONFLICT", async () => {
    const repId = await createTestRepresentative();
    const delegateId = await createTestUser();
    const created = await createShipmentDelegation(repId, delegateId, hoursFromNow(1), hoursFromNow(48), superAdminId, null);
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const first = await revokeShipmentDelegation(created.id, superAdminId);
    assert.equal(first.ok, true);
    const second = await revokeShipmentDelegation(created.id, superAdminId);
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "CONFLICT");
  });

  test("revoking an unknown delegation returns NOT_FOUND", async () => {
    const result = await revokeShipmentDelegation(randomUUID(), superAdminId);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });

  test("a revoked delegation frees up its window for a new non-overlapping create", async () => {
    const repId = await createTestRepresentative();
    const delegateId = await createTestUser();
    const created = await createShipmentDelegation(repId, delegateId, hoursFromNow(1), hoursFromNow(48), superAdminId, null);
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const revoked = await revokeShipmentDelegation(created.id, superAdminId);
    assert.equal(revoked.ok, true);

    // A REVOKED row must not count toward the overlap check (only ACTIVE
    // rows do) — a new delegation for the exact same pair/window now
    // succeeds instead of being rejected as overlapping.
    const recreated = await createShipmentDelegation(repId, delegateId, hoursFromNow(1), hoursFromNow(48), superAdminId, null);
    assert.equal(recreated.ok, true, `re-creation after revoke unexpectedly rejected: ${JSON.stringify(recreated)}`);
  });
});
