import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { checkWriteApiToken, getWriteApiToken } from "./write-token";

/**
 * ============================================================================
 * 쓰기 공유 토큰 문지기 — 실제로 돌려 본다
 * ============================================================================
 * 이 문 하나가 「PO 가 내자 줄을 완료 처리·완료 해제해 달라」는 통로의 자격이다.
 * 라우트는 DB 를 부르므로 여기서 직접 못 부르지만(`lib/db/connection.ts` 는
 * DATABASE_URL 이 없으면 불러오는 순간 던진다), 문지기 자체는 환경변수와 머리말만
 * 보므로 그대로 돌려 볼 수 있다. 읽기 쪽 거울은 `shared-token.test.ts` 다.
 *
 * 🔴 **이 파일이 지키는 가장 중요한 한 줄**: 설정이 비었을 때 빈 토큰으로
 * 통과하지 않는가. 빈 글자끼리 비교해 통과하는 구멍은 겉으로 아무 증상이 없고,
 * 환경변수를 빠뜨린 서버가 **아무에게나 쓰기를 내주는 문**이 된다.
 * ============================================================================
 */

const ORIGINAL = process.env.AS_WRITE_TOKEN;
const ORIGINAL_ERROR = console.error;
let logged: string[] = [];

function setToken(value: string | undefined): void {
  if (value === undefined) delete process.env.AS_WRITE_TOKEN;
  else process.env.AS_WRITE_TOKEN = value;
}

beforeEach(() => {
  logged = [];
  // 문지기는 거절할 때마다 까닭을 로그에 남긴다 — 시험 출력에 섞이지 않게
  // 받아 두고, 그 글자에 토큰이 새지 않았는지도 함께 본다.
  console.error = (...args: unknown[]) => {
    logged.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
  };
});

afterEach(() => {
  console.error = ORIGINAL_ERROR;
  setToken(ORIGINAL);
});

function post(headers: Record<string, string> = {}): Request {
  return new Request("http://as.example.test/api/v1/domestic-orders/x/completion", {
    method: "POST",
    headers,
  });
}

const TOKEN = "w0ite-token-0123456789abcdef0123456789";

describe("쓰기 토큰 문지기", () => {
  test("맞는 토큰이면 통과한다 — null 을 돌려주고 로그도 남기지 않는다", () => {
    setToken(TOKEN);
    assert.equal(checkWriteApiToken(post({ authorization: `Bearer ${TOKEN}` })), null);
    assert.deepEqual(logged, []);
  });

  test("Bearer 는 대소문자를 가리지 않는다", () => {
    setToken(TOKEN);
    assert.equal(checkWriteApiToken(post({ authorization: `bearer ${TOKEN}` })), null);
  });

  test("토큰이 없으면 401 + www-authenticate: Bearer", async () => {
    setToken(TOKEN);
    const denied = checkWriteApiToken(post());
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
    const denied = checkWriteApiToken(post({ authorization: "Bearer wrong-token" }));
    assert.ok(denied);
    assert.equal(denied.status, 401);
  });

  test("길이만 같고 내용이 다른 토큰도 401 — timingSafeEqual 이 던지지 않는다", () => {
    setToken(TOKEN);
    const sameLengthButWrong = "x".repeat(TOKEN.length);
    assert.equal(sameLengthButWrong.length, TOKEN.length);
    const denied = checkWriteApiToken(post({ authorization: `Bearer ${sameLengthButWrong}` }));
    assert.ok(denied);
    assert.equal(denied.status, 401);
  });

  test("🔴 읽기 토큰으로는 열리지 않는다 — 가르는 것은 하는 일이다", () => {
    setToken(TOKEN);
    const readToken = "r3ad-token-0123456789abcdef0123456789";
    const savedReadToken = process.env.AS_API_TOKEN;
    process.env.AS_API_TOKEN = readToken;
    try {
      const denied = checkWriteApiToken(post({ authorization: `Bearer ${readToken}` }));
      assert.ok(denied, "읽기 토큰으로 쓰기 통로가 열렸다");
      assert.equal(denied.status, 401);
    } finally {
      if (savedReadToken === undefined) delete process.env.AS_API_TOKEN;
      else process.env.AS_API_TOKEN = savedReadToken;
    }
  });

  test("🔴 설정이 비면 **빈 토큰으로 통과하지 않는다** — 503 으로 닫는다", async () => {
    for (const blank of [undefined, "", "   "]) {
      setToken(blank);
      // 빈 Bearer · 공백 Bearer · 머리말 없음 — 어느 쪽으로도 열리면 안 된다.
      const cases: Record<string, string>[] = [{}, { authorization: "Bearer " }, { authorization: "Bearer    " }];
      for (const headers of cases) {
        const denied = checkWriteApiToken(post(headers));
        assert.ok(denied, `설정이 「${String(blank)}」 일 때 통과했다 — 통로가 통째로 열린다`);
        assert.equal(denied.status, 503);
      }
    }
    setToken(undefined);
    const denied = checkWriteApiToken(post({ authorization: "Bearer anything" }));
    assert.ok(denied);
    assert.equal(denied.headers.get("cache-control"), "no-store");
    assert.deepEqual(await denied.json(), {
      error: "api_closed",
      message: "API 토큰이 설정되지 않아 통로가 닫혀 있습니다.",
    });
  });

  test("🔴 설정이 안 됐다는 사실은 **서버 로그**로만 간다", () => {
    setToken(undefined);
    checkWriteApiToken(post({ authorization: "Bearer anything" }));
    assert.equal(logged.length, 1);
    assert.match(logged[0], /AS_WRITE_TOKEN/);
  });

  test("🔴 응답에도 로그에도 토큰이 섞여 나가지 않는다", async () => {
    setToken(TOKEN);
    const denied = checkWriteApiToken(post({ authorization: "Bearer wrong-token" }));
    assert.ok(denied);
    const body = JSON.stringify(await denied.json());
    for (const text of [body, logged.join(" ")]) {
      assert.ok(!text.includes(TOKEN), "설정된 토큰이 들어 있다");
      assert.ok(!text.includes(TOKEN.slice(0, 8)), "토큰 앞자리가 들어 있다");
      assert.ok(!text.includes("wrong-token"), "받은 토큰이 되비친다");
    }
  });
});

describe("환경변수 읽기", () => {
  test("앞뒤 공백은 떼고, 없으면 빈 글자다", () => {
    setToken("  abc  ");
    assert.equal(getWriteApiToken(), "abc");
    setToken(undefined);
    assert.equal(getWriteApiToken(), "");
  });
});
