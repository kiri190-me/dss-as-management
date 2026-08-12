import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { isHttpsRequest, isTrustedOrigin } from "./request-guards";

/**
 * `NextRequest` constructed directly (as every test here does) never
 * auto-populates a `Host` header from the URL the way a real HTTP
 * connection would — so a `host` matching the URL is injected by default
 * here (overridable per test) to keep fixtures realistic. This is also
 * what makes the LAN-vs-nextUrl-mismatch scenario reproducible below: a
 * test can set the request's own URL to `http://localhost:3000/...` (so
 * `request.nextUrl.origin` reports `localhost`, exactly like the real
 * `next dev` bug this module works around) while `host`/`x-forwarded-host`
 * independently report the real LAN address, same as the live diagnostic.
 */
function requestWithHeaders(url: string, headers: Record<string, string>): NextRequest {
  const withDefaultHost = { host: new URL(url).host, ...headers };
  return new NextRequest(url, { headers: withDefaultHost });
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

test("isTrustedOrigin rejects a request with no Origin, Sec-Fetch-Site, or Referer at all", () => {
  const request = requestWithHeaders("https://app.example.test/api/auth/logout", {});
  assert.equal(isTrustedOrigin(request), false);
});

/**
 * Mobile-LAN login fix — a plain HTML `<form method="post">` top-level
 * navigation can legitimately omit `Origin` even for a same-origin
 * request (unlike fetch/XHR, where it's mandatory), which was blocking
 * genuine same-origin LAN access (e.g. http://192.168.1.132:3000) with no
 * way to distinguish it from a cross-site request. These cases lock down
 * the Sec-Fetch-Site / Referer fallback precedence without introducing
 * any allowlist or hardcoded host.
 */
test("isTrustedOrigin: missing Origin + Sec-Fetch-Site same-origin -> allowed", () => {
  const request = requestWithHeaders("http://192.168.1.132:3000/api/auth/login", {
    "sec-fetch-site": "same-origin",
  });
  assert.equal(isTrustedOrigin(request), true);
});

test("isTrustedOrigin: missing Origin + Sec-Fetch-Site cross-site -> rejected", () => {
  const request = requestWithHeaders("http://192.168.1.132:3000/api/auth/login", {
    "sec-fetch-site": "cross-site",
  });
  assert.equal(isTrustedOrigin(request), false);
});

test("isTrustedOrigin: missing Origin + no Sec-Fetch-Site + same-origin Referer -> allowed", () => {
  const request = requestWithHeaders("http://192.168.1.132:3000/api/auth/login", {
    referer: "http://192.168.1.132:3000/login",
  });
  assert.equal(isTrustedOrigin(request), true);
});

test("isTrustedOrigin: missing Origin + no Sec-Fetch-Site + foreign Referer -> rejected", () => {
  const request = requestWithHeaders("http://192.168.1.132:3000/api/auth/login", {
    referer: "https://attacker.example/login",
  });
  assert.equal(isTrustedOrigin(request), false);
});

test("isTrustedOrigin: malformed Referer is rejected safely, never throws", () => {
  const request = requestWithHeaders("http://192.168.1.132:3000/api/auth/login", {
    referer: "not a valid url::",
  });
  assert.doesNotThrow(() => isTrustedOrigin(request));
  assert.equal(isTrustedOrigin(request), false);
});

test("isTrustedOrigin: no usable Origin, Sec-Fetch-Site, or Referer -> rejected", () => {
  const request = requestWithHeaders("http://192.168.1.132:3000/api/auth/login", {});
  assert.equal(isTrustedOrigin(request), false);
});

test("isTrustedOrigin: a mismatched Origin is never overridden by a same-origin Sec-Fetch-Site — Origin stays authoritative", () => {
  const request = requestWithHeaders("http://192.168.1.132:3000/api/auth/login", {
    origin: "https://attacker.example",
    "sec-fetch-site": "same-origin",
  });
  assert.equal(isTrustedOrigin(request), false);
});

test("isTrustedOrigin: Sec-Fetch-Site takes precedence over Referer when Origin is missing but Sec-Fetch-Site is present (cross-site Sec-Fetch-Site rejects even with a same-origin Referer)", () => {
  const request = requestWithHeaders("http://192.168.1.132:3000/api/auth/login", {
    "sec-fetch-site": "cross-site",
    referer: "http://192.168.1.132:3000/login",
  });
  assert.equal(isTrustedOrigin(request), false);
});

/**
 * Root-cause fix — the live dev-server diagnostic confirmed
 * `request.nextUrl.origin` can report the server's own bind address
 * (`http://localhost:3000`) even on a request a LAN client genuinely
 * addressed to `http://192.168.1.132:3000`, while Origin/Host/
 * X-Forwarded-Host on that same request all agreed on the real LAN
 * address. isTrustedOrigin now derives its own comparison origin from
 * Host/X-Forwarded-Host + protocol instead of trusting `nextUrl.origin`.
 * Every request below sets its own URL to `http://localhost:3000/...` —
 * exactly reproducing the confirmed bug scenario — and relies on
 * host/forwarded headers to carry the real LAN identity.
 */
test("isTrustedOrigin: LAN Origin matches the derived expected origin via X-Forwarded-Host/Proto, even though nextUrl.origin still reports localhost", () => {
  const request = requestWithHeaders("http://localhost:3000/api/auth/login", {
    origin: "http://192.168.1.132:3000",
    "x-forwarded-host": "192.168.1.132:3000",
    "x-forwarded-proto": "http",
  });
  assert.equal(isTrustedOrigin(request), true);
});

test("isTrustedOrigin: LAN Origin matches the derived expected origin via the plain Host header alone (no forwarded headers)", () => {
  const request = requestWithHeaders("http://localhost:3000/api/auth/login", {
    origin: "http://192.168.1.132:3000",
    host: "192.168.1.132:3000",
  });
  assert.equal(isTrustedOrigin(request), true);
});

test("isTrustedOrigin: existing localhost dev access (Host matches Origin, no forwarded headers) still passes", () => {
  const request = requestWithHeaders("http://localhost:3000/api/auth/login", {
    origin: "http://localhost:3000",
  });
  assert.equal(isTrustedOrigin(request), true);
});

test("isTrustedOrigin: a spoofed/mismatched X-Forwarded-Host cannot pass by itself — Origin must still match whatever expected origin is derived", () => {
  const request = requestWithHeaders("http://localhost:3000/api/auth/login", {
    origin: "http://192.168.1.132:3000",
    "x-forwarded-host": "attacker.example",
  });
  assert.equal(isTrustedOrigin(request), false);
});

test("isTrustedOrigin: an X-Forwarded-Proto value other than http/https is treated as untrustworthy and rejects outright, even with a matching Origin/Host", () => {
  const request = requestWithHeaders("http://localhost:3000/api/auth/login", {
    origin: "http://192.168.1.132:3000",
    host: "192.168.1.132:3000",
    "x-forwarded-proto": "ftp",
  });
  assert.equal(isTrustedOrigin(request), false);
});

test("isTrustedOrigin: Referer fallback compares against the derived (LAN) expected origin, not nextUrl.origin", () => {
  const request = requestWithHeaders("http://localhost:3000/api/auth/login", {
    host: "192.168.1.132:3000",
    referer: "http://192.168.1.132:3000/login",
  });
  assert.equal(isTrustedOrigin(request), true);
});

test("isTrustedOrigin: no Host, no X-Forwarded-Host, and no derivable protocol source -> fails closed even with a technically-matching Origin", () => {
  // Bypasses the test helper's default Host injection to simulate the
  // (HTTP-spec-impossible, but defensively handled) case of no Host
  // reaching deriveExpectedOrigin at all.
  const request = new NextRequest("http://localhost:3000/api/auth/login", {
    headers: { origin: "http://localhost:3000" },
  });
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
