import "../../../scripts/load-env";

import { after, before, beforeEach, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pgClient } from "@/lib/db/connection";
import { users } from "@/lib/db/schema";
import { resolveActingUserForSession } from "./acting-user";
import type { SessionPayload } from "./session";

/**
 * Real-DB integration test for resolveActingUserForSession() in
 * AUTH_SOURCE=database mode — the centralized resolver that replaced the 6
 * duplicated mockUsers.find(session.userId) call sites. Confirms it reads
 * the real users row (not mock-data), fails closed on an unknown/deleted
 * id, and never falls back to a mock lookup while in database mode.
 *
 * Self-cleaning: only inserts one soft-deleted throwaway row, deleted in
 * after(). Never touches seeded users.
 */

function sessionFor(userId: string): SessionPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    userId,
    role: "AS_ENGINEER",
    approvalStatus: "APPROVED",
    issuedAt: now,
    expiresAt: now + 3600,
  };
}

let originalAuthSource: string | undefined;
let seededUserId: string;
let seededName: string;
let seededRole: string;
let seededApprovalStatus: string;
let deletedTestUserId: string;

before(async () => {
  const [row] = await db
    .select({ id: users.id, name: users.name, role: users.role, approvalStatus: users.approvalStatus })
    .from(users)
    .where(eq(users.isDeleted, false))
    .limit(1);
  assert.ok(row, "expected at least one non-deleted user in the dev DB");
  seededUserId = row.id;
  seededName = row.name;
  seededRole = row.role;
  seededApprovalStatus = row.approvalStatus;

  const [deleted] = await db
    .insert(users)
    .values({
      email: `authfix-test-deleted-${randomUUID().slice(0, 8)}@example.test`,
      name: "AuthFix Deleted Test",
      role: "AS_ENGINEER",
      approvalStatus: "APPROVED",
      isActive: true,
      isDeleted: true,
      deletedAt: new Date(),
    })
    .returning({ id: users.id });
  deletedTestUserId = deleted.id;
});

after(async () => {
  await db.delete(users).where(eq(users.id, deletedTestUserId));
  await pgClient.end({ timeout: 5 });
});

beforeEach(() => {
  originalAuthSource = process.env.AUTH_SOURCE;
  process.env.AUTH_SOURCE = "database";
});

afterEach(() => {
  if (originalAuthSource === undefined) delete process.env.AUTH_SOURCE;
  else process.env.AUTH_SOURCE = originalAuthSource;
});

test("database mode: resolves a real users.id UUID to that row's data, not a mock lookup", async () => {
  const result = await resolveActingUserForSession(sessionFor(seededUserId));
  assert.deepEqual(result, {
    id: seededUserId,
    name: seededName,
    role: seededRole,
    approvalStatus: seededApprovalStatus,
  });
});

test("database mode: a mock-style id ('u-001') never resolves (documents the pre-fix mismatch is closed)", async () => {
  const result = await resolveActingUserForSession(sessionFor("u-001"));
  assert.equal(result, null);
});

test("database mode: an unknown UUID resolves to null (fails closed)", async () => {
  const result = await resolveActingUserForSession(sessionFor(randomUUID()));
  assert.equal(result, null);
});

test("database mode: a soft-deleted user resolves to null", async () => {
  const result = await resolveActingUserForSession(sessionFor(deletedTestUserId));
  assert.equal(result, null);
});
