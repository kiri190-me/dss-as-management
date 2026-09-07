import "../../../scripts/load-env";

import { after, before, beforeEach, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, pgClient } from "@/lib/db/connection";
import { users } from "@/lib/db/schema";
import { resolveActingUserForSession } from "./acting-user";
import type { SessionPayload } from "./session";

/**
 * Real-DB integration test for resolveActingUserForSession() in
 * AUTH_SOURCE=database mode — the centralized resolver that replaced the 6
 * duplicated mockUsers.find(session.userId) call sites. Confirms it reads
 * the real users row (not mock-data), fails closed on an unknown/deleted/
 * deactivated/locked id, and never falls back to a mock lookup while in
 * database mode.
 *
 * Also the regression test for the login/logout UI bug (auth-fix-follow-up
 * task's final report): (app)/layout.tsx and /login now redirect based on
 * this function's null/non-null result rather than trusting a merely
 * signature-valid session token, so every fail-closed case proven here
 * translates directly into "session no longer grants access" at the page
 * level.
 *
 * Self-cleaning: only inserts throwaway rows (soft-deleted/deactivated/
 * locked), deleted in after(). Never touches seeded users.
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
let seededIsDeveloper: boolean;
let deletedTestUserId: string;
let deactivatedTestUserId: string;
let lockedTestUserId: string;

before(async () => {
  // Filters on isActive/lockedAt too, not just isDeleted — a genuinely
  // usable "seeded reference user" must never accidentally resolve to a
  // leftover authfix-test-* fixture row from a prior interrupted run (those
  // are deliberately deactivated/locked and would make this file's own
  // "resolves to that row's data" test fail against a row that fails
  // closed by design).
  const [row] = await db
    .select({ id: users.id, name: users.name, role: users.role, approvalStatus: users.approvalStatus, isDeveloper: users.isDeveloper })
    .from(users)
    .where(and(eq(users.isDeleted, false), eq(users.isActive, true), isNull(users.lockedAt)))
    .limit(1);
  assert.ok(row, "expected at least one non-deleted, active, unlocked user in the dev DB");
  seededUserId = row.id;
  seededName = row.name;
  seededRole = row.role;
  seededApprovalStatus = row.approvalStatus;
  seededIsDeveloper = row.isDeveloper;

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

  const [deactivated] = await db
    .insert(users)
    .values({
      email: `authfix-test-deactivated-${randomUUID().slice(0, 8)}@example.test`,
      name: "AuthFix Deactivated Test",
      role: "AS_ENGINEER",
      approvalStatus: "APPROVED",
      isActive: false,
    })
    .returning({ id: users.id });
  deactivatedTestUserId = deactivated.id;

  const [locked] = await db
    .insert(users)
    .values({
      email: `authfix-test-locked-${randomUUID().slice(0, 8)}@example.test`,
      name: "AuthFix Locked Test",
      role: "AS_ENGINEER",
      approvalStatus: "APPROVED",
      isActive: true,
      lockedAt: new Date(),
    })
    .returning({ id: users.id });
  lockedTestUserId = locked.id;
});

after(async () => {
  await db.delete(users).where(eq(users.id, deletedTestUserId));
  await db.delete(users).where(eq(users.id, deactivatedTestUserId));
  await db.delete(users).where(eq(users.id, lockedTestUserId));
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
    // users.is_developer 도 이 관문을 통해서만 앱으로 들어온다.
    isDeveloper: seededIsDeveloper,
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

test("database mode: a deactivated (is_active=false) user resolves to null — fails closed mid-session, not just at login", async () => {
  const result = await resolveActingUserForSession(sessionFor(deactivatedTestUserId));
  assert.equal(result, null);
});

test("database mode: a locked (locked_at set) user resolves to null — fails closed mid-session, not just at login", async () => {
  const result = await resolveActingUserForSession(sessionFor(lockedTestUserId));
  assert.equal(result, null);
});
