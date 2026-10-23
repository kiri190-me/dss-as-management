import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EMPTY_PORTAL_INBOX } from "@/lib/domain/portal-notification-inbox";
import {
  acknowledgePortalNotification,
  dismissPortalNotifications,
  fetchPortalNotificationInbox,
  notifyPortalApprovalCreated,
  type PortalInboxCredentials,
} from "./portal-inbox";

/**
 * 포털로 나가는 왕복 **넷** — 묻는 쪽 · 「그만 보겠다」를 적는 쪽 · 「확인했다」를
 * 적는 쪽 · 「이 사람에게 결재할 것이 생겼다」를 알리는 쪽(파일 맨 아래,
 * 2026-10-24). 🔴 이 파일이 지키는 것은 **한 문장**이다: 무슨 일이 있어도 던지지
 * 않는다.
 *
 * 앞의 셋은 그 값이 모든 화면에 딸려 오는 머리말에 실리기 때문이다 — 포털이
 * 죽었다고 A/S 가 안 뜨면 통합의 대가가 너무 크다. 적는 쪽은 사람이 ✕ 를 누른
 * **그 순간** 불리므로 같은 선을 더 세게 지켜야 한다. 🔴 맨 아래 하나는 더
 * 세다: 거기서 던지면 **이미 저장된 결재가 사람에게 실패로 보인다.**
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

/* ==========================================================================
 * 「이 알림은 그만 보겠다」를 적는 쪽 (2026-10-20)
 * ==========================================================================
 * 🔴 묻는 쪽과 **같은 한 문장**을 지킨다: 무슨 일이 있어도 던지지 않는다. 그
 * 함수는 종이 누름 처리 한가운데서 부르므로, 던지면 모든 화면의 머리말이 깨진다.
 *
 * 🔴 여기서만 재는 것이 하나 더 있다 — **200개씩 나눠 보내는가.** 넘겨 보내면
 * 포털이 400 으로 **통째로** 거절한다(앞의 200개만 받아 주지 않는다). A/S 에만
 * 「보이는 알림 지우기 n건」이 있어서, 사내 일곱 가운데 이 상한에 실제로 닿을
 * 수 있는 곳은 여기뿐이다.
 * ========================================================================== */

/** 보낸 묶음들의 열쇠 목록을 요청 차례대로. */
function 보낸묶음들(calls: { init: RequestInit }[]): string[][] {
  return calls.map(({ init }) => {
    const keys = new URLSearchParams(String(init.body)).get("keys") ?? "";
    return keys === "" ? [] : keys.split(",");
  });
}

/** `n` 개의 서로 다른 열쇠. */
function 열쇠들(n: number): string[] {
  return Array.from({ length: n }, (_, at) => `rf-service-system:APPROVAL:${at}`);
}

test("🔴 규격서대로 적는다 — 지움 통로 주소 · POST · Basic · sub 과 keys · 상한", async () => {
  const { fetchImpl, calls } = recordingFetch(
    () => new Response(JSON.stringify({ recorded: 2, dropped: 0 }), { status: 200 })
  );
  const recorded = await dismissPortalNotifications(
    "portal-user-1",
    ["rf-service-system:APPROVAL:1", "njlee:CAL:3"],
    { fetch: fetchImpl, readCredentials }
  );

  assert.equal(recorded, true);
  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;
  // 🔴 **묻는 통로가 아니다.** 주소 한 글자가 틀리면 「알림은 오는데 지움만 안
  //    먹히는」 상태가 되고, 그 어긋남은 신고로만 드러난다.
  assert.equal(url, "http://portal.test:3100/api/integration/notification-dismissals");
  assert.equal(init.method, "POST");

  const headers = init.headers as Record<string, string>;
  assert.equal(headers["content-type"], "application/x-www-form-urlencoded");
  const [scheme, token] = headers.authorization.split(" ");
  assert.equal(scheme, "Basic");
  assert.equal(
    Buffer.from(token, "base64").toString("utf8"),
    `${encodeURIComponent(CREDENTIALS.clientId)}:${encodeURIComponent(CREDENTIALS.clientSecret)}`,
    "🔴 묻는 쪽과 자격증명을 다르게 실었다"
  );

  const body = new URLSearchParams(String(init.body));
  assert.equal(body.get("sub"), "portal-user-1");
  assert.equal(body.get("keys"), "rf-service-system:APPROVAL:1,njlee:CAL:3");

  assert.ok(!url.includes(CREDENTIALS.clientSecret), "주소에 비밀값이 실렸다");
  assert.ok(init.signal instanceof AbortSignal, "왕복에 상한(AbortSignal)이 없다");
  assert.equal(init.cache, "no-store");
});

test("🔴 200개가 넘으면 **나눠** 보낸다 — 통째로 보내면 포털이 400 으로 거절한다", async () => {
  // 경계를 둘러싸고 본다. 200 에서 한 번, 201 에서 두 번이 되어야 한다 —
  // `>` 와 `>=` 를 뒤집어 쓰면 201 에서만 어긋나고 그 외에는 전부 통과한다.
  for (const [총수, 묶음수] of [
    [1, 1],
    [199, 1],
    [200, 1],
    [201, 2],
    [400, 2],
    [450, 3],
  ] as const) {
    const { fetchImpl, calls } = recordingFetch(() => new Response("{}", { status: 200 }));
    const recorded = await dismissPortalNotifications("portal-user-1", 열쇠들(총수), {
      fetch: fetchImpl,
      readCredentials,
    });

    const 묶음 = 보낸묶음들(calls);
    assert.equal(recorded, true, `${총수}: 적히지 않았다`);
    assert.equal(묶음.length, 묶음수, `${총수}개를 ${묶음.length}번에 나눠 보냈다`);
    // 🔴 **한 묶음도 200 을 넘지 않는다.** 넘으면 그 묶음 전체가 거절된다.
    for (const chunk of 묶음) {
      assert.ok(chunk.length <= 200, `${총수}: 한 묶음에 ${chunk.length}개를 실었다`);
      assert.ok(chunk.length > 0, `${총수}: 빈 묶음을 보냈다`);
    }
    // 🔴 **한 줄도 빠지지 않는다.** 잘라서 보내면 남은 줄이 조용히 안 지워진다.
    assert.deepEqual(묶음.flat(), 열쇠들(총수), `${총수}: 보낸 열쇠가 받은 것과 다르다`);
  }
});

test("🔴 묶음 하나가 거절돼도 나머지는 보낸다 — 돌려주는 값만 거짓이다", async () => {
  // 450개면 묶음 셋이다. 가운데가 거절돼도 셋째를 보내지 않으면 그 줄들이
  // 아무 흔적 없이 안 지워진다.
  let 몇번째 = 0;
  const { fetchImpl, calls } = recordingFetch(() => {
    몇번째 += 1;
    return 몇번째 === 2 ? new Response("{}", { status: 503 }) : new Response("{}", { status: 200 });
  });
  const { value, logged } = await captureErrors(() =>
    dismissPortalNotifications("portal-user-1", 열쇠들(450), { fetch: fetchImpl, readCredentials })
  );

  assert.equal(value, false, "하나라도 거절되면 거짓이어야 한다");
  assert.equal(calls.length, 3, "거절된 묶음에서 멈췄다");
  assert.deepEqual(보낸묶음들(calls).flat(), 열쇠들(450));
  assert.ok(logged.includes("503"), "무엇이 거절인지 알 수 없다");
});

test("🔴 보낼 것이 없으면 **아예 부르지 않는다** — 빈 목록은 포털이 400 으로 거절한다", async () => {
  for (const 보낼것 of [[], [""], ["", ""]]) {
    const { fetchImpl, calls } = recordingFetch(() => new Response("{}"));
    const recorded = await dismissPortalNotifications("portal-user-1", 보낼것, {
      fetch: fetchImpl,
      readCredentials,
    });

    assert.equal(recorded, false, `${JSON.stringify(보낼것)}: 적혔다고 답했다`);
    assert.equal(calls.length, 0, `${JSON.stringify(보낼것)}: 빈 묶음으로 포털을 불렀다`);
  }
});

test("🔴 `sub` 이 없으면 적으러 가지 않는다 — 포털 계정에 이어지지 않은 사람이다", async () => {
  const { fetchImpl, calls } = recordingFetch(() => new Response("{}"));
  const recorded = await dismissPortalNotifications("", ["rf-service-system:APPROVAL:1"], {
    fetch: fetchImpl,
    readCredentials,
  });

  assert.equal(recorded, false);
  assert.equal(calls.length, 0, "빈 sub 으로 포털을 불렀다");
});

test("같은 열쇠가 겹쳐 와도 한 번만 싣는다 — 200 칸을 겹친 값으로 채우지 않는다", async () => {
  const { fetchImpl, calls } = recordingFetch(() => new Response("{}"));
  await dismissPortalNotifications(
    "portal-user-1",
    ["a:1", "a:1", "b:2", "a:1"],
    { fetch: fetchImpl, readCredentials }
  );

  assert.deepEqual(보낸묶음들(calls), [["a:1", "b:2"]]);
});

test("🔴 어떤 거절이 와도 던지지 않는다 — 상태 코드만 남기고 거짓을 돌려준다", async () => {
  for (const status of [400, 401, 403, 405, 429, 500, 503]) {
    const { fetchImpl } = recordingFetch(
      () =>
        new Response(JSON.stringify({ error: "forbidden", error_description: "내부 사정" }), {
          status,
        })
    );
    const { value, logged } = await captureErrors(() =>
      dismissPortalNotifications("portal-user-1", ["rf-service-system:APPROVAL:1"], {
        fetch: fetchImpl,
        readCredentials,
      })
    );

    assert.equal(value, false, `${status} 에서 적혔다고 답했다`);
    assert.ok(logged.includes(String(status)), `${status}: 무엇이 거절인지 알 수 없다`);
    assert.ok(!logged.includes("내부 사정"), `${status}: 거절 본문을 로그에 남겼다`);
  }
});

test("🔴 포털이 죽었거나 시간이 넘어도 던지지 않는다 — 열쇠도 비밀값도 안 찍는다", async () => {
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
      dismissPortalNotifications("portal-user-1", ["rf-service-system:APPROVAL:D240913-1"], {
        fetch: fetchImpl,
        readCredentials,
      })
    );

    assert.equal(value, false, `${String(failure)} 에서 적혔다고 답했다`);
    // 🔴 열쇠에는 **수리 건 번호** 같은 업무 식별자가 들어 있다. 종류만 남긴다.
    assert.ok(!logged.includes("D240913"), "🔴 로그에 열쇠(업무 식별자)가 찍혔다");
    assert.ok(!logged.includes("fetch failed"), "오류 본문을 그대로 찍었다");
    assert.ok(!logged.includes(CREDENTIALS.clientSecret), "🔴 로그에 비밀값이 섞였다");
  }
});

test("🔴 설정이 빠져 있어도 ✕ 한 번이 화면을 깨지 않는다 — 묻는 쪽과 같은 처방", async () => {
  const { fetchImpl, calls } = recordingFetch(() => new Response("{}"));
  const { value } = await captureErrors(() =>
    dismissPortalNotifications("portal-user-1", ["rf-service-system:APPROVAL:1"], {
      fetch: fetchImpl,
      readCredentials: () => {
        throw new Error("SSO_CLIENT_SECRET is not set.");
      },
    })
  );

  assert.equal(value, false);
  assert.equal(calls.length, 0, "설정도 없이 포털을 불렀다");
});

/* ────────── 「확인했다」를 적는 쪽 (2026-10-22, acknowledgePortalNotification) ──────────
 *
 * 🔴 위 지움과 **뜻이 다르다**(지움은 재로그인하면 돌아오고 확인은 안 돌아온다).
 * 여기서 지키는 것은 그 뜻이 **주소로 갈린다**는 것이다 — 통로가 둘이고, 한
 * 글자만 틀려도 확인이 지움으로 적혀 「안 돌아와야 할 줄이 돌아온다」가 된다.
 * 나머지(자격증명 · 상한 · 거절 삼키기 · 로그에 값 안 찍기)는 지움과 **같아야**
 * 한다 — 그래서 같은 잣대로 다시 잰다.
 */

test("🔴 규격서대로 적는다 — **확인 통로** 주소 · POST · Basic · sub 과 keys · 상한", async () => {
  const { fetchImpl, calls } = recordingFetch(
    () => new Response(JSON.stringify({ recorded: 1, dropped: 0, skipped: 0 }), { status: 200 })
  );
  const recorded = await acknowledgePortalNotification(
    "portal-user-1",
    "dss-improvements:IMPROVEMENT:7",
    { fetch: fetchImpl, readCredentials }
  );

  assert.equal(recorded, true);
  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;
  // 🔴 **지움 통로가 아니다.** 여기로 적히면 「해소됐다」가 「지금은 그만
  //    보겠다」로 적혀, 재로그인했을 때 안 돌아와야 할 줄이 돌아온다.
  assert.equal(url, "http://portal.test:3100/api/integration/notification-acknowledgements");
  assert.notEqual(url, "http://portal.test:3100/api/integration/notification-dismissals");
  assert.equal(init.method, "POST");

  const headers = init.headers as Record<string, string>;
  assert.equal(headers["content-type"], "application/x-www-form-urlencoded");
  const [scheme, token] = headers.authorization.split(" ");
  assert.equal(scheme, "Basic");
  assert.equal(
    Buffer.from(token, "base64").toString("utf8"),
    `${encodeURIComponent(CREDENTIALS.clientId)}:${encodeURIComponent(CREDENTIALS.clientSecret)}`,
    "🔴 묻는 쪽·지움 쪽과 자격증명을 다르게 실었다"
  );

  const body = new URLSearchParams(String(init.body));
  assert.equal(body.get("sub"), "portal-user-1");
  // 🔴 하나여도 칸 이름은 `keys` 다 — 포털이 지움과 같은 파서를 쓴다.
  assert.equal(body.get("keys"), "dss-improvements:IMPROVEMENT:7");
  // 🔴 **지문 칸은 없다** — 「그때 본 내용」은 포털이 제 목록에서 직접 계산한다.
  //    사이트가 그 판정을 들고 있으면 한 곳만 어긋나도 오류 없이 영영 안 먹힌다.
  assert.equal(body.get("fingerprint"), null);
  assert.equal(body.get("digest"), null);

  assert.ok(!url.includes(CREDENTIALS.clientSecret), "주소에 비밀값이 실렸다");
  assert.ok(init.signal instanceof AbortSignal, "왕복에 상한(AbortSignal)이 없다");
  assert.equal(init.cache, "no-store");
});

test("🔴 `sub` 이나 열쇠가 비면 **아예 부르지 않는다** — 빈 열쇠는 포털이 400 으로 거절한다", async () => {
  for (const [subject, key] of [
    ["", "dss-improvements:IMPROVEMENT:7"],
    ["portal-user-1", ""],
    ["", ""],
  ] as const) {
    const { fetchImpl, calls } = recordingFetch(() => new Response("{}"));
    const recorded = await acknowledgePortalNotification(subject, key, {
      fetch: fetchImpl,
      readCredentials,
    });

    assert.equal(recorded, false, `sub="${subject}" key="${key}" 에서 적혔다고 답했다`);
    assert.equal(calls.length, 0, `sub="${subject}" key="${key}" 인데 포털을 불렀다`);
  }
});

test("🔴 어떤 거절이 와도 던지지 않는다 — 상태 코드만 남기고 거짓을 돌려준다(확인 쪽)", async () => {
  for (const status of [400, 401, 403, 405, 429, 500, 503]) {
    const { fetchImpl } = recordingFetch(
      () =>
        new Response(JSON.stringify({ error: "forbidden", error_description: "내부 사정" }), {
          status,
        })
    );
    const { value, logged } = await captureErrors(() =>
      acknowledgePortalNotification("portal-user-1", "dss-improvements:IMPROVEMENT:7", {
        fetch: fetchImpl,
        readCredentials,
      })
    );

    assert.equal(value, false, `${status} 에서 적혔다고 답했다`);
    assert.ok(logged.includes(String(status)), `${status}: 무엇이 거절인지 알 수 없다`);
    assert.ok(!logged.includes("내부 사정"), `${status}: 거절 본문을 로그에 남겼다`);
  }
});

test("🔴 포털이 죽었거나 시간이 넘어도 던지지 않는다 — 열쇠도 비밀값도 안 찍는다(확인 쪽)", async () => {
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
      acknowledgePortalNotification("portal-user-1", "rf-service-system:APPROVAL:D240913-1", {
        fetch: fetchImpl,
        readCredentials,
      })
    );

    assert.equal(value, false, `${String(failure)} 에서 적혔다고 답했다`);
    // 🔴 열쇠에는 **수리 건 번호** 같은 업무 식별자가 들어 있다. 종류만 남긴다.
    assert.ok(!logged.includes("D240913"), "🔴 로그에 열쇠(업무 식별자)가 찍혔다");
    assert.ok(!logged.includes("fetch failed"), "오류 본문을 그대로 찍었다");
    assert.ok(!logged.includes(CREDENTIALS.clientSecret), "🔴 로그에 비밀값이 섞였다");
  }
});

test("🔴 설정이 빠져 있어도 줄 한 번 누르기가 화면을 깨지 않는다 — 묻는 쪽·지움 쪽과 같은 처방", async () => {
  const { fetchImpl, calls } = recordingFetch(() => new Response("{}"));
  const { value } = await captureErrors(() =>
    acknowledgePortalNotification("portal-user-1", "dss-improvements:IMPROVEMENT:7", {
      fetch: fetchImpl,
      readCredentials: () => {
        throw new Error("SSO_CLIENT_SECRET is not set.");
      },
    })
  );

  assert.equal(value, false);
  assert.equal(calls.length, 0, "설정도 없이 포털을 불렀다");
});

test("🔴 확인과 지움이 **같은 상한**을 쓴다 — 한쪽만 늘리면 어느 쪽이 느린지 알 수 없다", async () => {
  // 규격서가 「같은 자격증명·같은 상한·같은 거절」을 못 박는다. 상한 값은 상수라
  // 글자로 읽을 수밖에 없는데, 🔴 그 토막이 빈 문자열이면 이 시험이 아무것도 안
  // 본다 — 그래서 자른 자리를 먼저 확인한다.
  //
  // 🔵 2026-10-24 에 넷이 됐다(결재 생성 알림이 더해졌다). 숫자를 세는 것이
  //    이 단언의 값어치다 — 상한 없는 왕복이 하나라도 생기면 그 요청은 포털이
  //    대답하지 않을 때 **끝나지 않는다.**
  const source = readFileSync(new URL("./portal-inbox.ts", import.meta.url), "utf8");
  const 상한들 = source.match(/AbortSignal\.timeout\([A-Z_]+\)/g) ?? [];
  assert.equal(상한들.length, 4, "왕복 넷이 저마다 상한을 들고 있지 않다");
  assert.equal(new Set(상한들).size, 1, "🔴 왕복마다 다른 상한을 쓴다");

  const 확인함수 = source.slice(source.indexOf("export async function acknowledgePortalNotification"));
  assert.ok(확인함수.length > 0, "확인 함수를 못 찾았다 — 이 시험이 아무것도 안 본다");
  assert.ok(확인함수.includes("notification-acknowledgements"), "자른 토막이 엉뚱한 자리다");
  // 🔴 확인 함수 안에서 **지움 통로를 부르지 않는다.** 둘이 한 몸이 되면
  //    「해소됐다」와 「그만 보겠다」가 섞인다.
  assert.ok(!확인함수.includes("notification-dismissals"), "🔴 확인이 지움 통로도 두드린다");
});

/* ========================================================================== */
/* 「이 사람에게 결재할 것이 생겼다」를 알리는 쪽 (2026-10-24)                  */
/*                                                                            */
/* 🔴 여기가 지키는 것은 둘이다: **몸통에 결재의 내용이 한 글자도 없다**(포털이 */
/*    제 통로로 다시 물어 보내기 때문이다)와, **무슨 일이 있어도 안 터진다**    */
/*    (부르는 자리가 이미 저장된 결재 뒤다).                                    */
/* ========================================================================== */

test("🔴 보내는 몸통은 **`approverSub` 하나뿐**이다 — 건 번호도 갈래도 제목도 없다", async () => {
  const { fetchImpl, calls } = recordingFetch(() => new Response("{}"));
  await notifyPortalApprovalCreated(["portal-user-1"], { fetch: fetchImpl, readCredentials });

  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;
  assert.equal(url, "http://portal.test:3100/api/integration/approval-created");
  assert.equal(init.method, "POST");
  // 🔴 **글자 하나까지 맞춰 본다.** 「칸 하나쯤 더 실어도 편하겠지」가 들어오는
  //    순간 이 단언이 빨개진다 — 그것이 이 줄의 값어치다.
  assert.equal(init.body, "approverSub=portal-user-1");

  const headers = init.headers as Record<string, string>;
  assert.equal(headers["content-type"], "application/x-www-form-urlencoded");
  const [scheme, token] = headers.authorization.split(" ");
  assert.equal(scheme, "Basic");
  assert.equal(
    Buffer.from(token, "base64").toString("utf8"),
    `${encodeURIComponent(CREDENTIALS.clientId)}:${encodeURIComponent(CREDENTIALS.clientSecret)}`
  );
  // 🔴 자격증명이 주소에 실리면 접근 로그에 남아 다시 발급해야 한다.
  assert.ok(!url.includes(CREDENTIALS.clientSecret));
  assert.equal(init.cache, "no-store");
  assert.ok(init.signal instanceof AbortSignal, "상한 없이 불렀다");
});

test("🔴 여럿이면 **한 번의 왕복**에 `approverSub` 를 여러 개 싣는다", async () => {
  // 사람마다 따로 부르면 상한(2초)이 사람 수만큼 곱해진다 — 사람이 [승인 요청]
  // 단추를 누르고 기다리는 자리다.
  const { fetchImpl, calls } = recordingFetch(() => new Response("{}"));
  await notifyPortalApprovalCreated(["portal-a", "portal-b"], {
    fetch: fetchImpl,
    readCredentials,
  });

  assert.equal(calls.length, 1, "사람 수만큼 포털을 불렀다");
  const body = new URLSearchParams(String(calls[0].init.body));
  assert.deepEqual(body.getAll("approverSub"), ["portal-a", "portal-b"]);
  // 🔴 다른 칸이 끼어들지 않았다.
  assert.deepEqual([...new Set([...body.keys()])], ["approverSub"]);
});

test("같은 사람이 겹쳐 들어오면 한 번만 싣는다", async () => {
  const { fetchImpl, calls } = recordingFetch(() => new Response("{}"));
  await notifyPortalApprovalCreated(["portal-a", "portal-a", "portal-b"], {
    fetch: fetchImpl,
    readCredentials,
  });

  const body = new URLSearchParams(String(calls[0].init.body));
  assert.deepEqual(body.getAll("approverSub"), ["portal-a", "portal-b"]);
});

test("🔴 보낼 사람이 없으면 **아예 부르지 않는다** — 거절 한 줄을 쌓을 뿐이다", async () => {
  const { fetchImpl, calls } = recordingFetch(() => new Response("{}"));

  for (const subjects of [[], [""], ["", ""]]) {
    assert.equal(await notifyPortalApprovalCreated(subjects, { fetch: fetchImpl, readCredentials }), false);
  }
  assert.equal(calls.length, 0, "빈 몸통으로 포털을 불렀다");
});

test("🔴 통로가 아직 없어 404 여도 **던지지 않는다** — 결재는 이미 저장됐다", async () => {
  // 포털 쪽 통로는 다른 조각이 만든다. 그때까지 여기로 오는 것은 404 뿐이고,
  // 그 404 가 사람 눈에 보이면 「승인 요청이 실패했다」로 읽힌다.
  for (const status of [404, 401, 429, 500, 503]) {
    const { fetchImpl } = recordingFetch(
      () => new Response(JSON.stringify({ error: "내부 사정" }), { status })
    );
    const { value, logged } = await captureErrors(() =>
      notifyPortalApprovalCreated(["portal-user-1"], { fetch: fetchImpl, readCredentials })
    );

    assert.equal(value, false, `${status} 에서 보냈다고 답했다`);
    assert.ok(logged.includes(String(status)), `${status}: 상태를 안 남겼다`);
    // 거절 본문은 포털의 내부 설정을 설명할 수 있다.
    assert.ok(!logged.includes("내부 사정"), `${status}: 거절 본문을 로그에 남겼다`);
  }
});

test("🔴 시간 초과 · 연결 거부 · 이상한 것을 던져도 **던지지 않는다** — 사람 번호도 안 찍는다", async () => {
  const failures = [
    new DOMException("The operation was aborted due to timeout", "TimeoutError"),
    // 포털이 꺼져 있을 때 fetch 가 내는 모양(ECONNREFUSED).
    new TypeError("fetch failed"),
    "문자열을 던짐",
  ];
  for (const failure of failures) {
    const { fetchImpl } = recordingFetch(() => {
      throw failure;
    });
    const { value, logged } = await captureErrors(() =>
      notifyPortalApprovalCreated(["portal-user-1"], { fetch: fetchImpl, readCredentials })
    );

    assert.equal(value, false, `${String(failure)} 에서 보냈다고 답했다`);
    assert.ok(!logged.includes("portal-user-1"), "🔴 로그에 포털 번호를 실었다");
    assert.ok(!logged.includes("fetch failed"), "오류 본문을 그대로 찍었다");
    assert.ok(!logged.includes(CREDENTIALS.clientSecret), "🔴 로그에 비밀값이 섞였다");
  }
});

test("🔴 설정이 빠져 있어도 [승인 요청] 단추가 실패하지 않는다", async () => {
  const { fetchImpl, calls } = recordingFetch(() => new Response("{}"));
  const { value } = await captureErrors(() =>
    notifyPortalApprovalCreated(["portal-user-1"], {
      fetch: fetchImpl,
      readCredentials: () => {
        throw new Error("SSO_CLIENT_SECRET is not set.");
      },
    })
  );

  assert.equal(value, false);
  assert.equal(calls.length, 0, "설정도 없이 포털을 불렀다");
});

test("정상 응답이면 알렸다고 답한다", async () => {
  const { fetchImpl } = recordingFetch(() => new Response(JSON.stringify({ queued: 1 })));
  assert.equal(
    await notifyPortalApprovalCreated(["portal-user-1"], { fetch: fetchImpl, readCredentials }),
    true
  );
});
