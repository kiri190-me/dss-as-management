// acting-user.ts statically imports the DB query layer (same pattern as
// repair-case-resolver.ts) for its database-mode branch, so merely
// importing this suite requires DATABASE_URL to be set even though every
// test below only exercises the mock-mode branch — hence load-env and
// living in test:db rather than the plain unit test script.
import "../../../scripts/load-env";

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { resolveActingUserForSession } from "./acting-user";
import { mockUsers } from "@/lib/domain/mock-data";
import type { SessionPayload } from "./session";

// This suite must exercise the mock branch regardless of the developer's
// .env.local (load-env above applies it via dotenv before these tests run,
// and .env.local commonly sets AUTH_SOURCE=database for day-to-day work).
// beforeEach/afterEach save and restore the ambient value so each test
// controls its own AUTH_SOURCE explicitly instead of relying on it being
// unset — mirrors the isolation pattern in acting-user.integration.test.ts.
let originalAuthSource: string | undefined;

beforeEach(() => {
  originalAuthSource = process.env.AUTH_SOURCE;
  delete process.env.AUTH_SOURCE;
});

afterEach(() => {
  if (originalAuthSource === undefined) delete process.env.AUTH_SOURCE;
  else process.env.AUTH_SOURCE = originalAuthSource;
});

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

test("mock mode: resolves a known mock user id to the matching ActingUser", async () => {
  const known = mockUsers[0];
  const result = await resolveActingUserForSession(sessionFor(known.id));
  assert.deepEqual(result, {
    id: known.id,
    name: known.name,
    role: known.role,
    approvalStatus: known.approvalStatus,
  });
});

test("mock mode: unknown user id resolves to null (fails closed)", async () => {
  const result = await resolveActingUserForSession(sessionFor("no-such-user"));
  assert.equal(result, null);
});

test("mock mode: a real database UUID never matches a mock id (documents the pre-fix mismatch)", async () => {
  const result = await resolveActingUserForSession(sessionFor("11111111-1111-4111-8111-111111111111"));
  assert.equal(result, null);
});

test('mock mode: resolves correctly with AUTH_SOURCE explicitly set to "mock"', async () => {
  process.env.AUTH_SOURCE = "mock";
  const known = mockUsers[0];
  const result = await resolveActingUserForSession(sessionFor(known.id));
  assert.deepEqual(result, {
    id: known.id,
    name: known.name,
    role: known.role,
    approvalStatus: known.approvalStatus,
  });
});

test("environment isolation: beforeEach clears AUTH_SOURCE regardless of the ambient value load-env applied", () => {
  // Regression test for the original failure: this repo's own .env.local
  // sets AUTH_SOURCE=database, and load-env (imported above) applies it via
  // dotenv before any test runs. Every test in this suite must still see
  // AUTH_SOURCE unset by the time it runs — proving beforeEach's
  // unconditional `delete` (not a conditional skip) is what makes the mock
  // tests above immune to that ambient value.
  assert.equal(process.env.AUTH_SOURCE, undefined);
});
