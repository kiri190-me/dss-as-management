import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createServiceMenuToken,
  parseServiceMenuToken,
  SERVICE_MENU_COOKIE_NAME,
} from "./service-menu-cookie";
import { SESSION_MAX_AGE_SECONDS } from "./session";
import { signPayload } from "./token";

/**
 * ============================================================================
 * 서비스 메뉴바 목록을 나르는 별도 서명 쿠키
 * ============================================================================
 * 세션 쿠키(dss_session)와 **갈라 둔** 값이다. 담긴 것은 인가 자료가 아니라
 * 「그릴 목록」이고, 그래서 이 파일이 지키는 것도 셋뿐이다:
 *
 *  1. 포털이 목록을 안 보내면(아직 배포 전이다) 쿠키를 굽지 않는다 —
 *     로그인은 예전과 똑같이 끝나고 띠도 안 그려진다.
 *  2. 보내면 굽고, 그 쿠키는 **서명되어 있다** — 위조·변조하면 거절된다.
 *  3. 수명은 세션 쿠키와 같다.
 * ============================================================================
 */

// session.ts 와 마찬가지로 비밀값을 함수 안에서 그때그때 읽으므로, 첫 호출
// 전에 여기서 넣어 두면 충분하다(모듈 적재 순서에 매이지 않는다).
process.env.AUTH_SESSION_SECRET = "test-secret-only-for-unit-tests";

const SERVICES = [
  { id: "rf-service-system", name: "A/S 관리", url: "http://10.0.0.5:3000", icon: "🔧" },
  { id: "njlee", name: "계측기", url: "http://10.0.0.5:3200" },
];

test("쿠키 이름은 세션 쿠키와 다른 이름이다 — 지우고 굽는 곳이 이 이름을 공유한다", () => {
  assert.equal(SERVICE_MENU_COOKIE_NAME, "dss_service_menu");
});

test("🔴 dss_services 클레임이 없으면 토큰이 null 이다 — 쿠키를 굽지 않는다(포털 배포 전 상태)", () => {
  assert.equal(createServiceMenuToken(undefined), null);
  assert.equal(createServiceMenuToken(null), null);
  // 배열이 아니거나, 배열이어도 그릴 수 있는 칸이 하나도 없으면 같은 취급이다.
  assert.equal(createServiceMenuToken("rf-service-system"), null);
  assert.equal(createServiceMenuToken([]), null);
  assert.equal(createServiceMenuToken([{ id: "x", name: "이름 없음" }]), null);
  assert.equal(
    createServiceMenuToken([{ id: "x", name: "나쁜 주소", url: "javascript:alert(1)" }]),
    null
  );
});

test("클레임이 있으면 구운 토큰이 같은 목록으로 되돌아온다(차례도 그대로)", () => {
  const token = createServiceMenuToken(SERVICES);
  assert.ok(token);
  assert.deepEqual(parseServiceMenuToken(token), SERVICES);
});

test("그릴 수 없는 칸만 걸러 낸다 — 나머지 칸은 남는다", () => {
  const token = createServiceMenuToken([
    { id: "rf-service-system", name: "A/S 관리", url: "/dashboard" },
    { id: "", name: "빈 id", url: "http://10.0.0.5:3200" },
    { id: "bad", name: "나쁜 주소", url: "javascript:alert(1)" },
    { id: "rf-service-system", name: "겹친 id", url: "http://10.0.0.5:3300" },
  ]);
  assert.ok(token);
  assert.deepEqual(parseServiceMenuToken(token), [
    { id: "rf-service-system", name: "A/S 관리", url: "/dashboard" },
  ]);
});

test("🔴 서명이 붙어 있다 — 페이로드를 고치면 서명이 어긋나 빈 목록이 된다", () => {
  const token = createServiceMenuToken(SERVICES);
  assert.ok(token);
  const [payload, signature] = token.split(".");
  assert.ok(payload && signature, "토큰이 payload.signature 모양이 아니다");

  // 브라우저에서 값을 바꿔 가짜 링크를 심으려는 시도.
  const forgedPayload = Buffer.from(
    JSON.stringify({
      services: [{ id: "evil", name: "가짜", url: "http://10.0.0.9:9999" }],
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
    }),
    "utf8"
  ).toString("base64url");

  assert.deepEqual(parseServiceMenuToken(`${forgedPayload}.${signature}`), []);
  assert.deepEqual(parseServiceMenuToken(`${payload}.${signature}xx`), []);
  assert.deepEqual(parseServiceMenuToken(forgedPayload), []);
  assert.deepEqual(parseServiceMenuToken(""), []);
});

test("🔴 다른 비밀값으로 서명한 토큰은 거절된다", () => {
  const foreign = signPayload(
    {
      services: SERVICES,
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
    },
    "another-secret"
  );
  assert.deepEqual(parseServiceMenuToken(foreign), []);
});

test("수명이 세션 쿠키와 같고, 지난 토큰은 빈 목록이 된다", () => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const token = createServiceMenuToken(SERVICES);
  assert.ok(token);

  const decoded = JSON.parse(
    Buffer.from(token.split(".")[0], "base64url").toString("utf8")
  ) as { issuedAt: number; expiresAt: number };
  assert.equal(decoded.expiresAt - decoded.issuedAt, SESSION_MAX_AGE_SECONDS);
  assert.ok(Math.abs(decoded.issuedAt - nowSeconds) <= 5);

  const expired = signPayload(
    { services: SERVICES, issuedAt: nowSeconds - 10, expiresAt: nowSeconds - 1 },
    process.env.AUTH_SESSION_SECRET as string
  );
  assert.deepEqual(parseServiceMenuToken(expired), []);
});

test("서명은 맞지만 안이 이상한 토큰도 죽지 않고 빈 목록이 된다 — 띠 때문에 본문이 죽어서는 안 된다", () => {
  const secret = process.env.AUTH_SESSION_SECRET as string;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const after = nowSeconds + SESSION_MAX_AGE_SECONDS;

  assert.deepEqual(parseServiceMenuToken(signPayload("문자열", secret)), []);
  assert.deepEqual(parseServiceMenuToken(signPayload({ services: SERVICES }, secret)), []);
  assert.deepEqual(
    parseServiceMenuToken(signPayload({ services: "배열이 아님", expiresAt: after }, secret)),
    []
  );
  assert.deepEqual(
    parseServiceMenuToken(signPayload({ services: [1, 2, 3], expiresAt: after }, secret)),
    []
  );
});
