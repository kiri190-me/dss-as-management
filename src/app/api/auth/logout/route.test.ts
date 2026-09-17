import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { SERVICE_MENU_COOKIE_NAME } from "@/lib/auth/service-menu-cookie";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
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

test("🔴 POST /api/auth/logout: 세션 쿠키와 **서비스 메뉴바 목록 쿠키**를 함께 지운다", async () => {
  const response = await POST(lanLogoutRequest());

  // 남겨 두면 로그아웃한 사람의 브라우저에 「이 사람이 어떤 시스템을 쓰는지」가
  // 그대로 남는다. 공용 PC 에서는 그것만으로도 알려 줄 이유가 없는 정보다.
  for (const name of [SESSION_COOKIE_NAME, SERVICE_MENU_COOKIE_NAME]) {
    const cookie = response.cookies.get(name);
    assert.ok(cookie, `${name} 을(를) 지우지 않는다`);
    assert.equal(cookie.value, "");
    assert.equal(cookie.maxAge, 0);
    assert.equal(cookie.path, "/");
    assert.equal(cookie.httpOnly, true);
  }
});

test("POST /api/auth/logout: a cross-origin request is still rejected with 403 (CSRF/origin validation unchanged by the redirect fix)", async () => {
  const request = new NextRequest("http://localhost:3000/api/auth/logout", {
    method: "POST",
    headers: { origin: "https://attacker.example", host: "192.168.1.132:3000" },
  });
  const response = await POST(request);
  assert.equal(response.status, 403);
});
