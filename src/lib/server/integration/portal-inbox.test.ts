import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EMPTY_PORTAL_INBOX } from "@/lib/domain/portal-notification-inbox";
import { fetchPortalNotificationInbox, type PortalInboxCredentials } from "./portal-inbox";

/**
 * 포털에 묻는 왕복 하나. 🔴 이 파일이 지키는 것은 **한 문장**이다:
 * 무슨 일이 있어도 던지지 않고 빈 목록을 돌려준다.
 *
 * 그 값이 모든 화면에 딸려 오는 머리말에 실리기 때문이다 — 포털이 죽었다고
 * A/S 가 안 뜨면 통합의 대가가 너무 크다.
 *
 * 망을 타지 않는다: `fetch` 와 자격증명 읽기를 둘 다 인자로 받아(PortalInboxDeps)
 * 거절 · 시간 초과 · 이상한 JSON 을 값으로 재현한다.
 */

const CREDENTIALS: PortalInboxCredentials = {
  issuer: "http://portal.test:3100",
  clientId: "rf-service-system",
  // 🔴 일부러 인코딩이 필요한 글자를 넣는다 — 규격서가 urlencode 를 못 박는다.
  clientSecret: "se:cret/+ 값",
};

const readCredentials = () => CREDENTIALS;

/** 규격서의 아홉 칸이 다 든 한 줄. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    key: "dss-improvements:IMPROVEMENT:7",
    sourceId: "dss-improvements",
    sourceName: "DSS 개선요청",
    id: "IMPROVEMENT:7",
    kind: "IMPROVEMENT",
    kindLabel: "검토 대기",
    subject: "IMP-2026-0031",
    detail: "검토를 기다리고 있습니다.",
    href: "http://192.168.1.132:3300/improvements/7",
    ...overrides,
  };
}

/** 부른 기록을 남기는 가짜 fetch. */
function recordingFetch(reply: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    calls.push({ url, init: init ?? {} });
    return reply(url, init ?? {});
  }) as unknown as typeof globalThis.fetch;
  return { fetchImpl, calls };
}

/**
 * 이 안에서 나간 console.error 를 삼켜 모아 준다. 시험 출력이 거절 로그로
 * 뒤덮이지 않게 하고, 🔴 **자격증명이 로그에 섞이지 않는지**도 여기서 본다.
 */
async function captureErrors<T>(run: () => Promise<T>): Promise<{ value: T; logged: string }> {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => {
    lines.push(args.map((one) => String(one)).join(" "));
  };
  try {
    return { value: await run(), logged: lines.join("\n") };
  } finally {
    console.error = original;
  }
}

test("🔴 `sub` 이 없으면 포털에 묻지 않는다 — 포털 계정에 이어지지 않은 사람이다", async () => {
  const { fetchImpl, calls } = recordingFetch(() => new Response("{}"));
  const inbox = await fetchPortalNotificationInbox("", { fetch: fetchImpl, readCredentials });

  assert.deepEqual(inbox, EMPTY_PORTAL_INBOX);
  assert.equal(calls.length, 0, "빈 sub 으로 포털을 불렀다");
});

test("정상 응답 — 목록과 개수를 그대로 가져온다", async () => {
  const { fetchImpl } = recordingFetch(
    () =>
      new Response(JSON.stringify({ items: [row(), row({ key: "njlee:CAL:3" })], count: 5 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
  );
  const inbox = await fetchPortalNotificationInbox("portal-user-1", {
    fetch: fetchImpl,
    readCredentials,
  });

  assert.deepEqual(
    inbox.items.map((item) => item.key),
    ["dss-improvements:IMPROVEMENT:7", "njlee:CAL:3"]
  );
  assert.equal(inbox.count, 5, "포털이 센 값을 그대로 가져와야 한다");
  assert.equal(inbox.degraded, false);
});

test("🔴 규격서대로 묻는다 — POST · Basic 머리말 · 본문의 sub · 주소에 비밀값 없음 · 왕복 상한", async () => {
  const { fetchImpl, calls } = recordingFetch(() => new Response(JSON.stringify({ items: [], count: 0 })));
  await fetchPortalNotificationInbox("portal-user-1", { fetch: fetchImpl, readCredentials });

  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;
  assert.equal(url, "http://portal.test:3100/api/integration/notifications");
  assert.equal(init.method, "POST");

  const headers = init.headers as Record<string, string>;
  assert.equal(headers["content-type"], "application/x-www-form-urlencoded");
  const [scheme, token] = headers.authorization.split(" ");
  assert.equal(scheme, "Basic");
  assert.equal(
    Buffer.from(token, "base64").toString("utf8"),
    `${encodeURIComponent(CREDENTIALS.clientId)}:${encodeURIComponent(CREDENTIALS.clientSecret)}`,
    "자격증명을 규격서와 다르게 실었다(urlencode 후 base64)"
  );

  assert.equal(new URLSearchParams(String(init.body)).get("sub"), "portal-user-1");

  // 🔴 비밀값이 주소에 실리면 포털이 400 으로 거절하고, 그 값은 이미 접근
  //    로그에 남아 **다시 발급**해야 한다(규격서).
  assert.ok(!url.includes("client_secret"), "주소에 비밀값이 실렸다");
  assert.ok(!url.includes(CREDENTIALS.clientSecret), "주소에 비밀값이 실렸다");

  // 🔴 왕복에 상한이 걸려 있다 — 포털이 대답하지 않으면 그 요청의 렌더가
  //    영영 붙잡힌다.
  assert.ok(init.signal instanceof AbortSignal, "왕복에 상한(AbortSignal)이 없다");
  assert.equal(init.cache, "no-store", "답은 사람마다 다르고 방금 처리한 일이 바로 빠져야 한다");
});

test("🔴 어떤 거절이 와도 던지지 않고 빈 목록이다 — 상태 코드만 남긴다", async () => {
  for (const status of [400, 401, 403, 405, 429, 500, 503]) {
    const { fetchImpl } = recordingFetch(
      () =>
        new Response(JSON.stringify({ error: "forbidden", error_description: "내부 사정" }), {
          status,
        })
    );
    const { value, logged } = await captureErrors(() =>
      fetchPortalNotificationInbox("portal-user-1", { fetch: fetchImpl, readCredentials })
    );

    assert.deepEqual(value, EMPTY_PORTAL_INBOX, `${status} 에서 빈 목록이 아니다`);
    assert.ok(logged.includes(String(status)), `${status}: 무엇이 거절인지 알 수 없다`);
    assert.ok(!logged.includes("내부 사정"), `${status}: 거절 본문을 로그에 남겼다`);
  }
});

test("🔴 포털이 죽었거나 시간이 넘어도 던지지 않는다 — 오류의 종류만 남긴다", async () => {
  const failures = [
    new DOMException("The operation was aborted due to timeout", "TimeoutError"),
    new TypeError("fetch failed"),
    "문자열을 던짐",
  ];
  for (const failure of failures) {
    const { fetchImpl } = recordingFetch(() => {
      throw failure;
    });
    const { value, logged } = await captureErrors(() =>
      fetchPortalNotificationInbox("portal-user-1", { fetch: fetchImpl, readCredentials })
    );

    assert.deepEqual(value, EMPTY_PORTAL_INBOX, `${String(failure)} 에서 빈 목록이 아니다`);
    assert.ok(!logged.includes("fetch failed"), "오류 본문을 그대로 찍었다");
    assert.ok(!logged.includes(CREDENTIALS.clientSecret), "🔴 로그에 비밀값이 섞였다");
  }
});

test("🔴 이상한 JSON 도, 답이 아닌 것도 빈 목록이다", async () => {
  const bodies = ["<html>포털 오류 화면</html>", "", "null", "[1,2,3]", '{"items":"목록"}'];
  for (const body of bodies) {
    const { fetchImpl } = recordingFetch(() => new Response(body, { status: 200 }));
    const { value } = await captureErrors(() =>
      fetchPortalNotificationInbox("portal-user-1", { fetch: fetchImpl, readCredentials })
    );
    assert.deepEqual(value.items, [], `${body} 에서 목록이 비지 않았다`);
    assert.equal(value.count, 0, `${body} 에서 개수가 0 이 아니다`);
  }
});

test("🔴 이상한 줄이 섞여 와도 그 줄만 빠진다 — 나머지 시스템의 알림은 남는다", async () => {
  const { fetchImpl } = recordingFetch(
    () =>
      new Response(
        JSON.stringify({
          items: [row({ href: "javascript:alert(1)" }), { key: "반쪽" }, row({ key: "ok:1" })],
          count: 3,
        })
      )
  );
  const inbox = await fetchPortalNotificationInbox("portal-user-1", {
    fetch: fetchImpl,
    readCredentials,
  });

  assert.deepEqual(
    inbox.items.map((item) => item.key),
    ["ok:1"]
  );
  assert.equal(inbox.count, 3, "포털이 센 값은 그대로다 — 우리가 고쳐 세지 않는다");
});

test("🔴 설정이 빠져 있어도 머리말이 깨지지 않는다 — 묻지 않고 빈 목록", async () => {
  // 환경변수를 읽는 함수들은 값이 없으면 **던진다**(config/sso.ts). 그것이
  // 렌더를 깨지 않게 try 안에서 읽는다.
  const { fetchImpl, calls } = recordingFetch(() => new Response("{}"));
  const { value } = await captureErrors(() =>
    fetchPortalNotificationInbox("portal-user-1", {
      fetch: fetchImpl,
      readCredentials: () => {
        throw new Error("SSO_CLIENT_SECRET is not set.");
      },
    })
  );

  assert.deepEqual(value, EMPTY_PORTAL_INBOX);
  assert.equal(calls.length, 0, "설정도 없이 포털을 불렀다");
});

test("🔴 새 환경변수를 만들지 않는다 — 통합 로그인이 쓰는 값 그대로다", () => {
  const source = readFileSync(new URL("./portal-inbox.ts", import.meta.url), "utf8");

  assert.match(
    source,
    /from "@\/lib\/config\/sso"/,
    "자격증명을 통합 로그인 설정에서 가져오지 않는다"
  );
  // 이 파일이 직접 process.env 를 뒤지면 이름을 새로 만든 것이나 같다.
  assert.ok(!source.includes("process.env"), "이 파일이 환경변수를 직접 읽는다");
  // 브라우저로 새는 것을 막는 한 줄. 이 값은 client_secret 을 쓴다.
  assert.match(source, /^import "server-only";/m, "server-only 가 빠졌다");
  // 상한 값 자체는 부르는 쪽에서 볼 수 없다 — 여기서 못 박는다.
  assert.match(source, /NOTIFICATIONS_TIMEOUT_MS = 2000;/, "왕복 상한이 2초가 아니다");
  assert.match(source, /AbortSignal\.timeout\(NOTIFICATIONS_TIMEOUT_MS\)/, "상한을 걸지 않는다");
});
