import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ============================================================================
 * SSO 콜백이 서비스 메뉴바 목록을 굽는 자리 — **소스로** 지킨다
 * ============================================================================
 * 이 라우트는 직접 부를 수 없다(포털의 JWKS 로 서명을 검증하고 토큰을 교환한다).
 * 이 저장소가 그런 라우트를 지키는 방식대로(api/quotes/parse-excel/
 * route-source.test.ts) 소스를 읽어 못 박는다. 목록을 거르고 서명하는 판단
 * 자체는 lib/auth/service-menu-cookie.test.ts 가 실제로 돌려 본다.
 *
 * 여기서 지키는 것 넷:
 *  1. 목록은 **검증이 끝난 payload** 에서 읽는다 — sub 와 같은 보증을 받는다.
 *  2. 세션 쿠키의 담긴 값(SessionPayload)에는 손대지 않는다 — 별도 쿠키다.
 *  3. 쿠키 속성(httpOnly · sameSite · secure · path)과 수명이 세션 쿠키와 같다.
 *  4. 목록이 없으면 굽지 않고 **지운다**(maxAge 0).
 * ============================================================================
 */

const route = readFileSync(
  join(process.cwd(), "src/app/api/auth/sso/callback/route.ts"),
  "utf8"
).replace(/\r\n/g, "\n");

const logout = readFileSync(
  join(process.cwd(), "src/app/api/auth/logout/route.ts"),
  "utf8"
).replace(/\r\n/g, "\n");

const login = readFileSync(
  join(process.cwd(), "src/app/api/auth/login/route.ts"),
  "utf8"
).replace(/\r\n/g, "\n");

test("🔴 dss_services 는 jwtVerify 가 끝난 payload 에서 읽는다 — 서명·발급자·수신자 보증을 함께 받는다", () => {
  const verifyAt = route.indexOf("const { payload } = await jwtVerify(");
  const claimAt = route.indexOf("serviceMenuClaim = payload.dss_services;");
  const subjectAt = route.indexOf("subject = payload.sub;");
  assert.ok(verifyAt > 0 && claimAt > 0, "검증 자리나 클레임을 읽는 자리를 찾지 못했다");
  assert.ok(claimAt > verifyAt, "검증보다 먼저 클레임을 읽는다");
  assert.ok(claimAt > subjectAt, "sub 를 확인하기 전에 클레임을 읽는다");
  // 검증에 실패하면 그 try 는 fail("sso") 로 끝난다 — 아래 쿠키까지 가지 않는다.
  assert.match(route, /\} catch \(error\) \{\n\s*console\.error\("\[sso\] id_token 검증 실패:", error\);\n\s*return fail\("sso"\);/);
});

test("🔴 세션 쿠키에 끼워 넣지 않는다 — 목록은 별도 쿠키다", () => {
  assert.match(route, /response\.cookies\.set\(SESSION_COOKIE_NAME, createSessionToken\(result\.user\)/);
  assert.equal(
    route.includes("createSessionToken({"),
    false,
    "세션 토큰에 무언가를 덧붙여 만들고 있다 — SessionPayload 는 그대로여야 한다"
  );
  assert.equal(
    /createSessionToken\([^)]*serviceMenu/i.test(route),
    false,
    "세션 토큰에 메뉴 목록이 섞여 들어간다"
  );
});

test("🔴 쿠키 속성과 수명이 세션 쿠키와 같다", () => {
  const menuAt = route.indexOf("response.cookies.set(SERVICE_MENU_COOKIE_NAME");
  assert.ok(menuAt > 0, "메뉴 쿠키를 굽지 않는다");
  const menuBlock = route.slice(menuAt, route.indexOf("});", menuAt));

  assert.match(menuBlock, /httpOnly: true/);
  assert.match(menuBlock, /sameSite: "lax"/);
  assert.match(menuBlock, /secure: isHttpsRequest\(request\)/);
  assert.match(menuBlock, /path: "\/"/);
  assert.match(menuBlock, /maxAge: serviceMenuToken === null \? 0 : SESSION_MAX_AGE_SECONDS/);
});

test("🔴 클레임이 없으면 굽지 않고 지운다 — 로그인은 예전과 똑같이 끝난다", () => {
  // 굽는 값은 createServiceMenuToken 이 정한다(없으면 null).
  assert.match(route, /const serviceMenuToken = createServiceMenuToken\(serviceMenuClaim\);/);
  assert.match(route, /SERVICE_MENU_COOKIE_NAME, serviceMenuToken \?\? ""/);
  // 목록이 없다고 로그인을 막지 않는다 — 쿠키를 굽는 자리 뒤로는 거절이 없고
  // 세션을 실은 응답이 그대로 나간다.
  const tail = route.slice(route.indexOf("const serviceMenuToken"));
  assert.equal(tail.includes("fail("), false, "메뉴 목록 때문에 로그인이 거절되는 길이 생겼다");
  assert.match(tail, /return response;\n\}\n$/);
});

test("🔴 로그아웃이 세션 쿠키와 함께 이 쿠키도 지운다", () => {
  assert.match(logout, /expire\(response, SESSION_COOKIE_NAME, request\);/);
  assert.match(logout, /expire\(response, SERVICE_MENU_COOKIE_NAME, request\);/);
});

test("데모·이메일 로그인 통로도 남아 있던 목록을 지운다 — 앞사람 목록이 뒷사람 화면에 남지 않게", () => {
  const menuAt = login.indexOf('response.cookies.set(SERVICE_MENU_COOKIE_NAME, ""');
  assert.ok(menuAt > 0, "로그인 통로가 메뉴 쿠키를 지우지 않는다");
  assert.match(login.slice(menuAt, login.indexOf("});", menuAt)), /maxAge: 0/);
});
