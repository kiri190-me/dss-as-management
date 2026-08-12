import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { mockUsers } from "@/lib/domain/mock-data";

// session.ts reads AUTH_SESSION_SECRET lazily, and route.ts reads
// DEMO_LOGIN_ENABLED/AUTH_SOURCE lazily too (function calls at request
// time) — same convention as session.test.ts. AUTH_SOURCE is pinned to
// "mock" so this file's own test bodies never reach the database branch.
//
// route.ts still statically (eagerly) imports resolveDbLogin, which
// transitively imports the drizzle/postgres.js client — that module
// throws at import time if DATABASE_URL is unset at all, regardless of
// which auth-source branch actually runs. DATABASE_URL is set to an
// unreachable placeholder purely to satisfy that import-time check;
// postgres.js connects lazily (on first query), and AUTH_SOURCE=mock
// guarantees no query is ever issued, so no real database is needed. The
// dynamic import (rather than a static one) is required so this
// assignment — a plain top-level statement — actually runs before
// route.ts is evaluated; a static `import { POST } from "./route"` would
// be hoisted above it per ESM semantics and would throw first.
process.env.DATABASE_URL = "postgres://unused:unused@localhost:5432/unused_never_connected";
process.env.AUTH_SESSION_SECRET = "test-secret-only-for-unit-tests";
process.env.DEMO_LOGIN_ENABLED = "true";
process.env.AUTH_SOURCE = "mock";

// Plain CJS require (this file compiles to CJS, unlike a static ESM
// `import`) — required specifically because it is NOT hoisted, so it runs
// after the env vars above are set, unlike a static import would be.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require("./route") as typeof import("./route");

const approvedUser = mockUsers.find((u) => u.approvalStatus === "APPROVED")!;
const pendingUser = mockUsers.find((u) => u.approvalStatus === "PENDING")!;

/**
 * Mobile-LAN redirect-bug regression coverage — reproduces exactly the
 * scenario the live dev-server diagnostic captured: the request's own URL
 * (and therefore request.url/request.nextUrl) reports `localhost:3000`,
 * while Host/X-Forwarded-Host/Origin all independently agree on a real
 * LAN address. Every test below uses this request shape as its default,
 * not just one dedicated case — the fix (a relative Location header) must
 * be correct regardless of what request.url says, so this mismatch must
 * never affect the outcome.
 */
function lanRequest(formFields: Record<string, string>): NextRequest {
  const formData = new FormData();
  for (const [key, value] of Object.entries(formFields)) formData.set(key, value);
  return new NextRequest("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: {
      origin: "http://192.168.1.132:3000",
      host: "192.168.1.132:3000",
      "x-forwarded-host": "192.168.1.132:3000",
      "x-forwarded-proto": "http",
    },
    body: formData,
  });
}

test("POST /api/auth/login: a successful login (APPROVED user) returns 303 with a RELATIVE Location: /dashboard, even though request.url reports localhost", async () => {
  const response = await POST(lanRequest({ userId: approvedUser.id }));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/dashboard");
});

test("POST /api/auth/login: a PENDING user's successful login returns 303 with a RELATIVE Location: /pending-approval", async () => {
  const response = await POST(lanRequest({ userId: pendingUser.id }));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/pending-approval");
});

test("POST /api/auth/login: an unknown userId (rejected login) returns 303 with a RELATIVE Location: /login", async () => {
  const response = await POST(lanRequest({ userId: "not-a-real-user-id" }));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/login");
});

test("POST /api/auth/login: a missing userId field returns 303 with a RELATIVE Location: /login", async () => {
  const response = await POST(lanRequest({}));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/login");
});

test("POST /api/auth/login: a cross-origin request is still rejected with 403 (CSRF/origin validation unchanged by the redirect fix)", async () => {
  const formData = new FormData();
  formData.set("userId", approvedUser.id);
  const request = new NextRequest("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { origin: "https://attacker.example", host: "192.168.1.132:3000" },
    body: formData,
  });
  const response = await POST(request);
  assert.equal(response.status, 403);
});
