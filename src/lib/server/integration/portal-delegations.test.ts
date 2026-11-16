import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  fetchPortalActingSubjects,
  resolvePortalRouteDelegations,
  type PortalDelegationCredentials,
  type PortalDelegationQueries,
} from "./portal-delegations";

/**
 * ============================================================================
 * 포털에 결재권 위임을 묻는 왕복 — 값으로 재는 자리
 * ============================================================================
 * 🔴 이 파일이 지키는 것은 **두 문장**이다.
 *
 *  1. **무슨 일이 있어도 던지지 않는다.** 이 함수는 사람이 [승인]을 누른 그 자리에서
 *     불린다 — 여기서 던지면 포털이 죽은 날 A/S 의 결재가 통째로 멈춘다(설계 B-6 이
 *     「거절한다」를 버린 바로 그 까닭).
 *  2. 🔴 **「물었더니 없더라」와 「못 물었다」를 뭉개지 않는다.** 둘 다 빈 목록이지만
 *     뒤쪽만 안내를 띄워야 한다(설계 B-7). 뭉개면 안내할 자리에서 구별할 길이 영영
 *     없어지고, 그때 대리인은 **조용히 막힌다** — 이 저장소들에서 가장 비싼 결함이다.
 *
 * 망도 DB 도 타지 않는다: `fetch` · 자격증명 · 조회 둘을 전부 인자로 받아
 * 거절 · 시간 초과 · 이상한 JSON · 열쇠 변환 실패를 값으로 재현한다.
 * ============================================================================
 */

const CREDENTIALS: PortalDelegationCredentials = {
  issuer: "http://portal.test:3100",
  clientId: "rf-service-system",
  clientSecret: "s3cr3t",
};

const ME = "11111111-1111-4111-8111-111111111111";
const MY_SUB = "portal-sub-me";
const BOSS = "22222222-2222-4222-8222-222222222222";
const BOSS_SUB = "portal-sub-boss";

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** 기본 조회 둘 — 나 하나와 상사 하나가 포털 번호를 들고 있다. */
function queries(overrides: Partial<PortalDelegationQueries> = {}): PortalDelegationQueries {
  const 명부 = new Map([
    [MY_SUB, ME],
    [BOSS_SUB, BOSS],
  ]);
  return {
    readPortalSubject: async (userId) => (userId === ME ? MY_SUB : null),
    readUserIdsBySubjects: async (subjects) =>
      subjects.flatMap((ssoSubject) => {
        const id = 명부.get(ssoSubject);
        return id ? [{ id, ssoSubject }] : [];
      }),
    ...overrides,
  };
}

/* ── 1. 묻는 왕복 그 자체 ────────────────────────────────────────────── */

test("포털이 준 번호를 그대로 돌려준다 — 맨 앞의 본인도 버리지 않는다", async () => {
  const answer = await fetchPortalActingSubjects(MY_SUB, {
    readCredentials: () => CREDENTIALS,
    fetch: async () => ok({ subs: [MY_SUB, BOSS_SUB], count: 2 }),
  });
  assert.deepEqual(answer, { asked: true, subs: [MY_SUB, BOSS_SUB] });
});

test("🔴 보내는 몸통에 `action=acting` 이 실린다 — 방향을 바꿔 꽂으면 아무도 못 누른다", async () => {
  const 보낸것 = { 주소: "", 몸통: "", 머리말: "" };
  await fetchPortalActingSubjects(MY_SUB, {
    readCredentials: () => CREDENTIALS,
    fetch: async (url, init) => {
      보낸것.주소 = String(url);
      보낸것.몸통 = String(init?.body ?? "");
      보낸것.머리말 = String(
        (init?.headers as Record<string, string> | undefined)?.authorization ?? ""
      );
      return ok({ subs: [MY_SUB] });
    },
  });
  assert.equal(보낸것.주소, "http://portal.test:3100/api/integration/delegations");
  assert.notEqual(보낸것.몸통, "", "몸통이 비었다 — 이 시험이 아무것도 안 본다");
  const 몸통 = new URLSearchParams(보낸것.몸통);
  assert.equal(몸통.get("sub"), MY_SUB);
  assert.equal(몸통.get("action"), "acting");
  // 🔴 자격증명은 **머리말로만** 나간다. 주소에 실으면 포털이 400 으로 거절하고,
  //    그 값은 이미 접근 로그에 남아 다시 발급해야 한다(규격).
  assert.equal(
    보낸것.머리말,
    `Basic ${Buffer.from("rf-service-system:s3cr3t", "utf8").toString("base64")}`
  );
  assert.ok(!보낸것.주소.includes("s3cr3t"), "🔴 시크릿이 주소에 실렸다");
});

test("🔴 포털이 거절해도 던지지 않는다 — 「못 물었다」가 값으로 나간다", async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    const answer = await fetchPortalActingSubjects(MY_SUB, {
      readCredentials: () => CREDENTIALS,
      fetch: async () => new Response("nope", { status }),
    });
    assert.deepEqual(answer, { asked: false }, `${status} 에서 갈라졌다`);
  }
});

test("🔴 시간이 넘치거나 연결이 끊겨도 던지지 않는다", async () => {
  const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
  const answer = await fetchPortalActingSubjects(MY_SUB, {
    readCredentials: () => CREDENTIALS,
    fetch: async () => {
      throw timeout;
    },
  });
  assert.deepEqual(answer, { asked: false });
});

test("🔴 설정이 빠져 자격증명 읽기가 던져도 삼킨다", async () => {
  const answer = await fetchPortalActingSubjects(MY_SUB, {
    readCredentials: () => {
      throw new Error("SSO_ISSUER is not set");
    },
    fetch: async () => ok({ subs: [MY_SUB] }),
  });
  assert.deepEqual(answer, { asked: false });
});

test("🔴 모르는 모양의 답은 **빈 목록이 아니라 「못 물었다」**다", async () => {
  // 🔵 먼저 제대로 된 답에서는 물었다고 나오는지 못 박는다 — 안 그러면 아래 넷이
  //    「언제나 asked:false」인 구현에서도 공짜로 통과한다.
  assert.deepEqual(
    await fetchPortalActingSubjects(MY_SUB, {
      readCredentials: () => CREDENTIALS,
      fetch: async () => ok({ subs: [] }),
    }),
    { asked: true, subs: [] }
  );

  for (const [무엇, 몸통] of [
    ["JSON 이 아니다", new Response("<html>", { status: 200 })],
    ["subs 칸이 없다", ok({ count: 0 })],
    ["subs 가 배열이 아니다", ok({ subs: "none" })],
    ["몸통이 null 이다", ok(null)],
  ] as const) {
    const answer = await fetchPortalActingSubjects(MY_SUB, {
      readCredentials: () => CREDENTIALS,
      fetch: async () => 몸통.clone(),
    });
    assert.deepEqual(answer, { asked: false }, `${무엇}: 「없다」로 읽혔다`);
  }
});

test("글자가 아닌 줄은 버린다 — 조건절에 이상한 값이 섞여 들어가지 않는다", async () => {
  const answer = await fetchPortalActingSubjects(MY_SUB, {
    readCredentials: () => CREDENTIALS,
    fetch: async () => ok({ subs: [MY_SUB, null, 7, "", BOSS_SUB] }),
  });
  assert.deepEqual(answer, { asked: true, subs: [MY_SUB, BOSS_SUB] });
});

/* ── 2. 열쇠 변환까지 — 이 조각의 입구 ───────────────────────────────── */

test("🔴 포털 번호를 A/S 번호로 바꿔 돌려준다 — 바꾸지 않으면 영원히 아무도 못 누른다", async () => {
  const result = await resolvePortalRouteDelegations(ME, {
    ...queries(),
    readCredentials: () => CREDENTIALS,
    fetch: async () => ok({ subs: [MY_SUB, BOSS_SUB], count: 2 }),
  });
  // 🔴 포털 번호가 아니라 **A/S users.id** 가 나와야 한다.
  assert.deepEqual(result, { delegatorUserIds: [ME, BOSS], unavailable: false });
});

test("🔴 포털 계정이 없는 사람은 **장애가 아니다** — 안내를 띄우면 안 된다", async () => {
  let 불렀나 = false;
  const result = await resolvePortalRouteDelegations("99999999-9999-4999-8999-999999999999", {
    ...queries(),
    readCredentials: () => CREDENTIALS,
    fetch: async () => {
      불렀나 = true;
      return ok({ subs: [] });
    },
  });
  assert.equal(불렀나, false, "포털 번호가 없는데 포털을 불렀다");
  assert.deepEqual(result, { delegatorUserIds: [], unavailable: false });
});

test("🔴 포털이 죽으면 `unavailable: true` — 빈 목록과 **다른 값**이다", async () => {
  const 죽음 = await resolvePortalRouteDelegations(ME, {
    ...queries(),
    readCredentials: () => CREDENTIALS,
    fetch: async () => new Response("", { status: 503 }),
  });
  const 없음 = await resolvePortalRouteDelegations(ME, {
    ...queries(),
    readCredentials: () => CREDENTIALS,
    fetch: async () => ok({ subs: [MY_SUB] }),
  });
  assert.deepEqual(죽음, { delegatorUserIds: [], unavailable: true });
  // 「물었더니 나 혼자더라」 — 목록은 결국 비지만(본인은 어차피 맨 앞에 붙는다)
  // 🔴 **깃발이 서로 다르다.** 이 한 줄이 설계 B-7 의 안내를 가능하게 한다.
  assert.equal(없음.unavailable, false);
  assert.notDeepEqual(죽음, 없음);
});

test("🔴 포털 번호를 읽다 DB 가 깨져도 던지지 않는다 — 「못 물었다」로 떨어진다", async () => {
  const result = await resolvePortalRouteDelegations(ME, {
    ...queries({
      readPortalSubject: async () => {
        throw new Error("connection refused");
      },
    }),
    readCredentials: () => CREDENTIALS,
    fetch: async () => ok({ subs: [MY_SUB] }),
  });
  assert.deepEqual(result, { delegatorUserIds: [], unavailable: true });
});

test("🔴 바꾸는 조회가 깨져도 던지지 않는다 — 물었어도 결과는 「못 물었다」다", async () => {
  const result = await resolvePortalRouteDelegations(ME, {
    ...queries({
      readUserIdsBySubjects: async () => {
        throw new Error("connection refused");
      },
    }),
    readCredentials: () => CREDENTIALS,
    fetch: async () => ok({ subs: [MY_SUB, BOSS_SUB] }),
  });
  assert.deepEqual(result, { delegatorUserIds: [], unavailable: true });
});

test("🔴 못 바꾼 번호는 **세어 로그에 남긴다** — 그 사람만 조용히 위임이 안 듣는다", async () => {
  const 경고: string[] = [];
  const 원래 = console.warn;
  console.warn = (...args: unknown[]) => {
    경고.push(args.map(String).join(" "));
  };
  try {
    const result = await resolvePortalRouteDelegations(ME, {
      ...queries(),
      readCredentials: () => CREDENTIALS,
      // 셋 가운데 하나(`portal-sub-ghost`)는 A/S 에 계정이 없다 — 2026-11-16 운영에는
      // 그런 사람이 0명이지만 「오늘은 0」이지 「영원히 0」이 아니다(설계 D-3).
      fetch: async () => ok({ subs: [MY_SUB, "portal-sub-ghost", BOSS_SUB], count: 3 }),
    });
    // 바뀐 둘은 그대로 쓰인다 — 한 명 때문에 묶음을 통째로 버리지 않는다.
    assert.deepEqual(result, { delegatorUserIds: [ME, BOSS], unavailable: false });
    assert.equal(경고.length, 1, `경고가 한 줄이 아니다: ${JSON.stringify(경고)}`);
    assert.match(경고[0], /3건 가운데 1건/);
    // 🔴 사람을 가리키는 값은 로그에 쌓지 않는다(이 묶음의 규약 — portal-inbox.ts).
    assert.ok(!경고[0].includes("portal-sub-ghost"), "🔴 포털 번호가 로그에 찍혔다");
  } finally {
    console.warn = 원래;
  }
});

test("전부 바뀌면 경고가 없다 — 평소에 로그가 더러워지지 않는다", async () => {
  const 경고: string[] = [];
  const 원래 = console.warn;
  console.warn = (...args: unknown[]) => {
    경고.push(args.map(String).join(" "));
  };
  try {
    await resolvePortalRouteDelegations(ME, {
      ...queries(),
      readCredentials: () => CREDENTIALS,
      fetch: async () => ok({ subs: [MY_SUB, BOSS_SUB] }),
    });
    assert.deepEqual(경고, []);
  } finally {
    console.warn = 원래;
  }
});

/* ── 3. 상한은 2초다 ─────────────────────────────────────────────────── */

test("🔴 왕복 상한이 2초다 — 설계서의 3초가 아니고, 이 집의 다른 포털 왕복과 같은 값이다", () => {
  const 이쪽 = readFileSync(new URL("./portal-delegations.ts", import.meta.url), "utf8");
  const 알림쪽 = readFileSync(new URL("./portal-inbox.ts", import.meta.url), "utf8");
  const 내값 = /const DELEGATIONS_TIMEOUT_MS = (\d+);/.exec(이쪽);
  const 알림값 = /const NOTIFICATIONS_TIMEOUT_MS = (\d+);/.exec(알림쪽);
  assert.ok(내값, "상한 상수를 못 찾았다 — 이름이 바뀌었다");
  assert.ok(알림값, "알림 쪽 상한 상수를 못 찾았다 — 이름이 바뀌었다");
  assert.equal(내값![1], "2000");
  // 🔴 **같은 포털을 부르는 상한이 둘이면 느릴 때 어느 쪽이 느린지 알 수 없다.**
  //    설계서가 3초라고 적은 것은 승인함이 결재함을 부를 때의 값이다 — 그 까닭은
  //    portal-delegations.ts 머리말에 적어 두었다.
  assert.equal(내값![1], 알림값![1]);
  assert.match(이쪽, /설계서의 3초가 아니다/);
});
