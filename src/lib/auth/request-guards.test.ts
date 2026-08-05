import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { isHttpsRequest, isTrustedOrigin } from "./request-guards";

function requestWithHeaders(url: string, headers: Record<string, string>): NextRequest {
  return new NextRequest(url, { headers });
}

test("isTrustedOrigin accepts a same-origin Origin header", () => {
  const request = requestWithHeaders("https://app.example.test/api/auth/login", {
    origin: "https://app.example.test",
  });
  assert.equal(isTrustedOrigin(request), true);
});

test("isTrustedOrigin rejects a cross-origin Origin header (the logout/login CSRF guard)", () => {
  const request = requestWithHeaders("https://app.example.test/api/auth/logout", {
    origin: "https://attacker.example",
  });
  assert.equal(isTrustedOrigin(request), false);
});

test("isTrustedOrigin rejects a request with no Origin header at all", () => {
  const request = requestWithHeaders("https://app.example.test/api/auth/logout", {});
  assert.equal(isTrustedOrigin(request), false);
});

test("isHttpsRequest prefers x-forwarded-proto when present", () => {
  const httpsForwarded = requestWithHeaders("http://app.example.test/api/auth/login", {
    "x-forwarded-proto": "https",
  });
  assert.equal(isHttpsRequest(httpsForwarded), true);

  const httpForwarded = requestWithHeaders("https://app.example.test/api/auth/login", {
    "x-forwarded-proto": "http",
  });
  assert.equal(isHttpsRequest(httpForwarded), false);
});

test("isHttpsRequest falls back to the request URL's own protocol", () => {
  const httpsRequest = requestWithHeaders("https://app.example.test/api/auth/login", {});
  assert.equal(isHttpsRequest(httpsRequest), true);

  const httpRequest = requestWithHeaders("http://localhost:3000/api/auth/login", {});
  assert.equal(isHttpsRequest(httpRequest), false);
});
