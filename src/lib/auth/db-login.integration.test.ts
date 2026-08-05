import "../../../scripts/load-env";

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, pgClient } from "@/lib/db/connection";
import { users } from "@/lib/db/schema";
import { resolveDbLogin } from "./db-login";

/**
 * Real-DB integration test for resolveDbLogin() — the function behind the
 * AUTH_SOURCE=database login branch. Confirms every session it produces
 * carries a real users.id UUID (the actual fix for the session/DB user
 * mismatch), and that account-state gating (locked/disabled) rejects before
 * a session is ever created.
 *
 * Self-cleaning and isolated to a dedicated "authfix-test-" email prefix —
 * never touches seeded users.
 */

const TEST_EMAIL_PREFIX = "authfix-test-";

let seededEmail: string;
let seededUserId: string;
let seededRole: string;
let pendingEmail: string | null;
let lockedTestEmail: string;
let disabledTestEmail: string;

before(async () => {
  // isActive/isDeleted/lockedAt are all filtered too, not just
  // approvalStatus — a genuinely loginable "seeded reference user" must
  // never accidentally resolve to a leftover authfix-test-* fixture row
  // from a prior interrupted run (those are deliberately locked/deactivated
  // and would make this file's own "resolves to a SESSION" tests fail).
  const [approved] = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(
      and(
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isActive, true),
        eq(users.isDeleted, false),
        isNull(users.lockedAt)
      )
    )
    .limit(1);
  assert.ok(approved, "expected at least one APPROVED, active, unlocked user in the dev DB");
  seededEmail = approved.email;
  seededUserId = approved.id;
  seededRole = approved.role;

  const [pending] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.approvalStatus, "PENDING"))
    .limit(1);
  pendingEmail = pending?.email ?? null;

  lockedTestEmail = `${TEST_EMAIL_PREFIX}locked-${randomUUID().slice(0, 8)}@example.test`;
  disabledTestEmail = `${TEST_EMAIL_PREFIX}disabled-${randomUUID().slice(0, 8)}@example.test`;

  await db.insert(users).values([
    {
      email: lockedTestEmail,
      name: "AuthFix Locked Test",
      role: "AS_ENGINEER",
      approvalStatus: "APPROVED",
      isActive: true,
      lockedAt: new Date(),
    },
    {
      email: disabledTestEmail,
      name: "AuthFix Disabled Test",
      role: "AS_ENGINEER",
      approvalStatus: "APPROVED",
      isActive: false,
      lockedAt: null,
    },
  ]);
});

after(async () => {
  await db.delete(users).where(eq(users.email, lockedTestEmail));
  await db.delete(users).where(eq(users.email, disabledTestEmail));
  await pgClient.end({ timeout: 5 });
});

test("a valid, approved/active email resolves to a SESSION carrying the real users.id UUID", async () => {
  const result = await resolveDbLogin(seededEmail);
  assert.equal(result.outcome, "SESSION");
  if (result.outcome !== "SESSION") return;
  assert.equal(result.user.id, seededUserId);
  assert.equal(result.user.role, seededRole);
  assert.match(
    result.user.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "session userId must be a real UUID, never a mock-style id like 'u-001'"
  );
});

test("email lookup is case-insensitive", async () => {
  const result = await resolveDbLogin(seededEmail.toUpperCase());
  assert.equal(result.outcome, "SESSION");
  if (result.outcome !== "SESSION") return;
  assert.equal(result.user.id, seededUserId);
});

test("a PENDING account still resolves to a SESSION (routing, not rejection)", async (t) => {
  if (!pendingEmail) {
    t.skip("no PENDING user seeded in this dev DB");
    return;
  }
  const result = await resolveDbLogin(pendingEmail);
  assert.equal(result.outcome, "SESSION");
  if (result.outcome !== "SESSION") return;
  assert.equal(result.user.approvalStatus, "PENDING");
});

test("an unknown email is REJECTED with INVALID_CREDENTIALS", async () => {
  const result = await resolveDbLogin(`${TEST_EMAIL_PREFIX}nobody-${randomUUID().slice(0, 8)}@example.test`);
  assert.equal(result.outcome, "REJECTED");
  if (result.outcome !== "REJECTED") return;
  assert.equal(result.code, "INVALID_CREDENTIALS");
});

test("a malformed email is REJECTED with INVALID_CREDENTIALS without touching the DB", async () => {
  const result = await resolveDbLogin("not-an-email");
  assert.equal(result.outcome, "REJECTED");
  if (result.outcome !== "REJECTED") return;
  assert.equal(result.code, "INVALID_CREDENTIALS");
});

test("a locked account is REJECTED with ACCOUNT_LOCKED", async () => {
  const result = await resolveDbLogin(lockedTestEmail);
  assert.equal(result.outcome, "REJECTED");
  if (result.outcome !== "REJECTED") return;
  assert.equal(result.code, "ACCOUNT_LOCKED");
});

test("a deactivated account is REJECTED with ACCOUNT_DISABLED", async () => {
  const result = await resolveDbLogin(disabledTestEmail);
  assert.equal(result.outcome, "REJECTED");
  if (result.outcome !== "REJECTED") return;
  assert.equal(result.code, "ACCOUNT_DISABLED");
});
