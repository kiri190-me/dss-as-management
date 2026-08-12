import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "./route";

/**
 * Mobile-LAN redirect-bug regression coverage — same request shape as
 * login/route.test.ts's lanRequest: request.url reports `localhost:3000`
 * while Host/X-Forwarded-Host/Origin all agree on a real LAN address.
 */
function lanLogoutRequest(): NextRequest {
  return new NextRequest("http://localhost:3000/api/auth/logout", {
    method: "POST",
    headers: {
      origin: "http://192.168.1.132:3000",
      host: "192.168.1.132:3000",
      "x-forwarded-host": "192.168.1.132:3000",
      "x-forwarded-proto": "http",
    },
  });
}

test("POST /api/auth/logout: returns 303 with a RELATIVE Location: /login, even though request.url reports localhost", async () => {
  const response = await POST(lanLogoutRequest());
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/login");
});

test("POST /api/auth/logout: a cross-origin request is still rejected with 403 (CSRF/origin validation unchanged by the redirect fix)", async () => {
  const request = new NextRequest("http://localhost:3000/api/auth/logout", {
    method: "POST",
    headers: { origin: "https://attacker.example", host: "192.168.1.132:3000" },
  });
  const response = await POST(request);
  assert.equal(response.status, 403);
});
