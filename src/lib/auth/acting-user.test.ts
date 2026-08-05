// acting-user.ts statically imports the DB query layer (same pattern as
// repair-case-resolver.ts) for its database-mode branch, so merely
// importing this suite requires DATABASE_URL to be set even though every
// test below only exercises the mock-mode branch — hence load-env and
// living in test:db rather than the plain unit test script.
import "../../../scripts/load-env";

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveActingUserForSession } from "./acting-user";
import { mockUsers } from "@/lib/domain/mock-data";
import type { SessionPayload } from "./session";

// AUTH_SOURCE is deliberately left unset in this suite (mock is the
// default) — this exercises the exact branch every existing deployment
// runs today, so mock/local behavior must stay unchanged.

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
