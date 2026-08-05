import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionToken, parseSessionToken } from "./session";
import { signPayload } from "./token";
import type { Role, AccountApprovalStatus } from "@/lib/domain/types";

// session.ts reads AUTH_SESSION_SECRET lazily (inside each function call),
// so setting it here before any call is sufficient — no module-load-order
// dependency to work around.
process.env.AUTH_SESSION_SECRET = "test-secret-only-for-unit-tests";

function testUser(overrides: Partial<{ id: string; role: Role; approvalStatus: AccountApprovalStatus }> = {}) {
  return {
    id: overrides.id ?? "11111111-1111-4111-8111-111111111111",
    role: overrides.role ?? "AS_ENGINEER",
    approvalStatus: overrides.approvalStatus ?? "APPROVED",
  };
}

test("a freshly created session token round-trips back to the same userId/role/approvalStatus", () => {
  const user = testUser();
  const token = createSessionToken(user);
  const parsed = parseSessionToken(token);
  assert.ok(parsed);
  assert.equal(parsed.userId, user.id);
  assert.equal(parsed.role, user.role);
  assert.equal(parsed.approvalStatus, user.approvalStatus);
  assert.ok(parsed.expiresAt > parsed.issuedAt);
});

test("a tampered payload fails signature verification and returns null", () => {
  const token = createSessionToken(testUser());
  const [, signature] = token.split(".");
  const tamperedPayload = Buffer.from(JSON.stringify({ userId: "attacker", role: "SUPER_ADMIN" })).toString("base64url");
  assert.equal(parseSessionToken(`${tamperedPayload}.${signature}`), null);
});

test("a token signed with a different secret is rejected", () => {
  const forged = createSessionToken(testUser());
  const originalSecret = process.env.AUTH_SESSION_SECRET;
  process.env.AUTH_SESSION_SECRET = "a-different-secret";
  try {
    assert.equal(parseSessionToken(forged), null);
  } finally {
    process.env.AUTH_SESSION_SECRET = originalSecret;
  }
});

test("a structurally malformed token returns null, never throws", () => {
  assert.equal(parseSessionToken(""), null);
  assert.equal(parseSessionToken("not-a-token"), null);
  assert.equal(parseSessionToken("a.b.c"), null);
});

test("a token with an out-of-range role/approvalStatus value is rejected even with a valid signature", () => {
  // Bypasses createSessionToken's typed input to simulate a forged-but-
  // correctly-signed payload carrying an invalid enum value — session.ts
  // must not trust the signature alone.
  const badToken = signPayload(
    {
      userId: "11111111-1111-4111-8111-111111111111",
      role: "NOT_A_REAL_ROLE",
      approvalStatus: "APPROVED",
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    },
    process.env.AUTH_SESSION_SECRET!
  );
  assert.equal(parseSessionToken(badToken), null);
});

test("an expired token returns null", () => {
  const now = Math.floor(Date.now() / 1000);
  const expiredToken = signPayload(
    {
      userId: "11111111-1111-4111-8111-111111111111",
      role: "AS_ENGINEER",
      approvalStatus: "APPROVED",
      issuedAt: now - 100,
      expiresAt: now - 1,
    },
    process.env.AUTH_SESSION_SECRET!
  );
  assert.equal(parseSessionToken(expiredToken), null);
});
