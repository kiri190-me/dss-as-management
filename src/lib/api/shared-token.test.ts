import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { checkSharedApiToken, readBearerToken, safeEqual } from "./shared-token";

/**
 * ============================================================================
 * 공유 토큰 문지기 — 네 갈래를 실제로 돌려 본다
 * ============================================================================
 * 이 문 하나가 `/api/v1/**` 통로 셋 전부의 자격이다. 라우트는 DB 를 부르므로
 * 시험이 직접 못 부르지만(`lib/db/connection.ts` 는 DATABASE_URL 이 없으면 불러오는
 * 순간 던진다), 문지기 자체는 환경변수와 머리말만 보므로 그대로 돌려 볼 수 있다.
 *
 * 환경변수를 갈아 끼우는 방식은 `src/lib/config/*.test.ts` 의 것을 따른다 —
 * 문지기가 부를 때마다 `process.env` 를 읽기 때문에 가능하다.
 * ============================================================================
 */

const ORIGINAL = process.env.AS_API_TOKEN;

function setToken(value: string | undefined): void {
  if (value === undefined) delete process.env.AS_API_TOKEN;
  else process.env.AS_API_TOKEN = value;
}

afterEach(() => {
  setToken(ORIGINAL);
});

function get(headers: Record<string, string> = {}): Request {
  return new Request("http://as.example.test/api/v1/users", { headers });
}

const TOKEN = "s3cret-token-0123456789abcdef0123456789";

describe("공유 토큰 문지기", () => {
  test("맞는 토큰이면 통과한다 — null 을 돌려준다", () => {
    setToken(TOKEN);
    assert.equal(checkSharedApiToken(get({ authorization: `Bearer ${TOKEN}` })), null);
  });

  test("Bearer 는 대소문자를 가리지 않는다", () => {
    setToken(TOKEN);
    assert.equal(checkSharedApiToken(get({ authorization: `bearer ${TOKEN}` })), null);
  });

  test("토큰이 없으면 401 + www-authenticate: Bearer", async () => {
    setToken(TOKEN);
    const denied = checkSharedApiToken(get());
    assert.ok(denied, "막지 않았다");
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get("www-authenticate"), "Bearer");
    assert.equal(denied.headers.get("cache-control"), "no-store");
    assert.deepEqual(await denied.json(), {
      error: "unauthorized",
      message: "토큰이 없거나 맞지 않습니다.",
    });
  });

  test("틀린 토큰이면 401", () => {
    setToken(TOKEN);
    const denied = checkSharedApiToken(get({ authorization: "Bearer wrong-token" }));
    assert.ok(denied);
    assert.equal(denied.status, 401);
  });

  test("길이만 같고 내용이 다른 토큰도 401 — timingSafeEqual 이 던지지 않는다", () => {
    setToken(TOKEN);
    const sameLengthButWrong = "x".repeat(TOKEN.length);
    assert.equal(sameLengthButWrong.length, TOKEN.length);
    const denied = checkSharedApiToken(get({ authorization: `Bearer ${sameLengthButWrong}` }));
    assert.ok(denied);
    assert.equal(denied.status, 401);
  });

  test("Bearer 가 아닌 자격 방식은 401 — Basic 으로 들어오면 토큰 없음과 같다", () => {
    setToken(TOKEN);
    const denied = checkSharedApiToken(get({ authorization: `Basic ${TOKEN}` }));
    assert.ok(denied);
    assert.equal(denied.status, 401);
  });

  test("🔴 토큰이 설정되지 않았으면 503 — 비었다고 열어 두지 않는다", async () => {
    setToken(undefined);
    const denied = checkSharedApiToken(get({ authorization: `Bearer ${TOKEN}` }));
    assert.ok(denied, "토큰이 없는데 통과시켰다 — 통로가 통째로 열린다");
    assert.equal(denied.status, 503);
    assert.equal(denied.headers.get("cache-control"), "no-store");
    assert.deepEqual(await denied.json(), {
      error: "api_closed",
      message: "API 토큰이 설정되지 않아 통로가 닫혀 있습니다.",
    });
  });

  test("🔴 빈 글자나 공백뿐인 토큰도 「설정 안 됨」이다 — 빈 Bearer 로 뚫리지 않는다", () => {
    for (const blank of ["", "   "]) {
      setToken(blank);
      const denied = checkSharedApiToken(get({ authorization: "Bearer  " }));
      assert.ok(denied, `「${blank}」 로 통과했다`);
      assert.equal(denied.status, 503);
    }
  });

  test("🔴 오류 본문에 토큰이 섞여 나가지 않는다", async () => {
    setToken(TOKEN);
    const denied = checkSharedApiToken(get({ authorization: "Bearer wrong-token" }));
    assert.ok(denied);
    const body = JSON.stringify(await denied.json());
    assert.ok(!body.includes(TOKEN), "응답에 설정된 토큰이 들어 있다");
    assert.ok(!body.includes(TOKEN.slice(0, 8)), "응답에 토큰 앞자리가 들어 있다");
    assert.ok(!body.includes("wrong-token"), "응답에 받은 토큰이 되비친다");
  });
});

describe("머리말에서 토큰 꺼내기", () => {
  test("머리말이 없거나 모양이 다르면 빈 글자다", () => {
    assert.equal(readBearerToken(null), "");
    assert.equal(readBearerToken(""), "");
    assert.equal(readBearerToken("Bearer"), "");
    assert.equal(readBearerToken("abc"), "");
  });

  test("앞뒤 공백은 떼고 토큰만 돌려준다", () => {
    assert.equal(readBearerToken("Bearer abc "), "abc");
    assert.equal(readBearerToken("Bearer\tabc"), "abc");
  });
});

describe("safeEqual", () => {
  test("같으면 true, 다르면 false, 길이가 달라도 던지지 않는다", () => {
    assert.equal(safeEqual("abc", "abc"), true);
    assert.equal(safeEqual("abc", "abd"), false);
    assert.equal(safeEqual("abc", "abcd"), false);
    assert.equal(safeEqual("", ""), true);
  });

  test("여러 바이트 글자도 그대로 비교한다", () => {
    assert.equal(safeEqual("토큰", "토큰"), true);
    assert.equal(safeEqual("토큰", "토큰 "), false);
  });
});
