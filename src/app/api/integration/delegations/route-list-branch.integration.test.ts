import "../../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey } from "jose";
import { inArray, like, or } from "drizzle-orm";
import { db, pgClient } from "@/lib/db/connection";
import { portalApprovalDelegations, users } from "@/lib/db/schema";
import { PORTAL_TOKEN_PURPOSES } from "@/lib/auth/portal-service-token";
import { guardPreexistingRows, type PreexistingRowsGuard } from "@/lib/db/test-cleanup-guard";
import { POST } from "./route";

/**
 * ============================================================================
 * 위임 통로의 **읽기 갈래**를 실제로 불러 본다 (조각 9a · 설계 B-14)
 * ============================================================================
 * 이 집의 통합 통로는 보통 **소스 글자로** 지킨다(route-source.test.ts) — 포털의 JWKS 로
 * 서명을 검증하고 DB 를 읽어서 단위 목록에서는 불러올 수조차 없기 때문이다. 🔵 그런데
 * **db 목록에는 DATABASE_URL 이 있고**, 포털의 서명 노릇은 이 시험이 127.0.0.1 에 직접
 * 띄운 가짜 JWKS 서버가 할 수 있다. 그래서 이 갈래만은 **값으로** 잰다 — 글자로는 못
 * 재는 것이 여기 둘이기 때문이다:
 *
 *  1. 🔴 **쓰기 토큰으로 읽을 수 없고, 읽기 토큰으로 쓸 수 없다.** 쓰임새를 가르는 자리가
 *     소스에 보인다고 그 토큰이 실제로 거절되는 것은 아니다(`purpose` 검사는 검증기
 *     안에 있다).
 *  2. 🔴 **쓰기 갈래가 안 깨졌다.** 갈래를 가리려고 몸통을 엿보는데, **원본**을 읽으면
 *     아래 쓰기 갈래의 `request.json()` 이 **빈 몸통**을 받아 모든 쓰기가 **조용히 400**
 *     이 된다. 소스에 `request.clone()` 이 적혀 있는지만 봐서는 그 사고를 못 막는다 —
 *     여기서 **몸통이 실제로 살아서 쓰기 갈래까지 가는지**를 본다.
 *
 * 🔴 **DB 에 쓰는 것은 읽기 갈래가 돌려줄 줄 둘뿐**이다. 쓰기 갈래 시험은 A/S 에 계정이
 * 없는 포털 번호로 부르므로 `not_applicable` 로 끝나고 **한 줄도 안 만든다**(그래서 답이
 * 200 인 것 자체가 「몸통이 살아서 모양 검사를 지나갔다」는 증거다).
 *
 * 🔵 사내망에 나가지 않는다 — 발급자는 127.0.0.1 의 가짜 JWKS 서버이고, DB 는 시험 DB 다.
 * 🔴 실제 사람·고객사 이름을 한 자도 쓰지 않는다.
 * ============================================================================
 */

const TEST_EMAIL_PREFIX = "portaldelegroute-test-";
/** 🔵 이웃 시험들의 접두사(`portaldeleg-test-` · `portaldelegq-test-` ·
 *  `portaldelegaudit-test-`)와 서로 걸리지 않는다 — 치우기가 `…-test-%` 로 지우는데
 *  이 파일의 이메일은 `portaldeleg` 뒤에 `route` 가 온다. */

const CLIENT_ID = "dss-as-delegation-list-test";
const CALLER_SUB = "11111111-2222-4333-8444-555555555555";

const createdTestUserIds: string[] = [];
const insertedIds: string[] = [];
let delegationGuard: PreexistingRowsGuard;

let jwks: Server;
let portalKeys: { privateKey: CryptoKey; publicKey: CryptoKey };
let issuer: string;

async function createTestUser(name: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      email: `${TEST_EMAIL_PREFIX}${randomUUID().slice(0, 8)}@example.test`,
      name,
      role: "AS_ENGINEER",
      approvalStatus: "APPROVED",
      isActive: true,
    })
    .returning({ id: users.id });
  createdTestUserIds.push(row.id);
  return row.id;
}

async function insertDelegation(params: {
  delegatorUserId: string;
  delegateUserId: string;
  revokedAt?: Date | null;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(portalApprovalDelegations).values({
    id,
    delegatorUserId: params.delegatorUserId,
    delegateUserId: params.delegateUserId,
    startsAt: new Date("2026-11-17T00:00:00.000Z"),
    endsAt: new Date("2026-11-24T00:00:00.000Z"),
    reason: "자리비움",
    revokedAt: params.revokedAt ?? null,
  });
  insertedIds.push(id);
  return id;
}

/** 포털이 구운 척하는 토큰. 기본은 **읽기 쓰임새**다. */
async function token(
  over: { purpose?: string; key?: CryptoKey; audience?: string } = {}
): Promise<string> {
  return new SignJWT({ purpose: over.purpose ?? PORTAL_TOKEN_PURPOSES.delegationsRead })
    .setProtectedHeader({ alg: "RS256", kid: "portal-1" })
    .setIssuer(issuer)
    .setAudience(over.audience ?? CLIENT_ID)
    .setSubject(CALLER_SUB)
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(over.key ?? portalKeys.privateKey);
}

/** 통로를 실제로 부른다. 🔴 자격증명이 없으면 머리말을 아예 안 붙인다. */
async function post(params: { token?: string; body?: string; contentType?: string }) {
  const headers: Record<string, string> = {
    "content-type": params.contentType ?? "application/json",
  };
  if (params.token) headers.authorization = `Bearer ${params.token}`;
  const request = new Request("http://127.0.0.1:3000/api/integration/delegations", {
    method: "POST",
    headers,
    body: params.body ?? '{"action":"list"}',
  });
  // 소리 없이 — 거절 까닭은 서버 로그로 나간다(portal-service-token.ts).
  const 진짜 = console.error;
  console.error = () => {};
  try {
    const response = await POST(request as unknown as Parameters<typeof POST>[0]);
    return { response, body: (await response.json()) as Record<string, unknown> };
  } finally {
    console.error = 진짜;
  }
}

before(async () => {
  portalKeys = await generateKeyPair("RS256", { extractable: true });
  const jwk = {
    ...(await exportJWK(portalKeys.publicKey)),
    kid: "portal-1",
    alg: "RS256",
    use: "sig",
  };
  jwks = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) => jwks.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${(jwks.address() as AddressInfo).port}`;

  // 🔴 이 시험이 쓰는 값으로 **덮어쓴다.** .env.local 의 진짜 포털을 두드리면 안 된다.
  process.env.LOGIN_MODE = "sso";
  process.env.AUTH_SOURCE = "database";
  process.env.SSO_ISSUER = issuer;
  process.env.SSO_CLIENT_ID = CLIENT_ID;

  delegationGuard = await guardPreexistingRows({
    label: "portal_approval_delegations",
    table: portalApprovalDelegations,
    idColumn: portalApprovalDelegations.id,
    createdAtColumn: portalApprovalDelegations.syncedAt,
  });
});

after(async () => {
  if (createdTestUserIds.length > 0) {
    const mine = await db
      .select({ id: portalApprovalDelegations.id })
      .from(portalApprovalDelegations)
      .where(
        or(
          inArray(portalApprovalDelegations.delegatorUserId, createdTestUserIds),
          inArray(portalApprovalDelegations.delegateUserId, createdTestUserIds)
        )
      );
    const mineIds = mine.map((row) => row.id);
    if (mineIds.length > 0) {
      await db
        .delete(portalApprovalDelegations)
        .where(inArray(portalApprovalDelegations.id, mineIds));
    }
  }
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%`));

  // 🔴 치우기가 **만들기 전부터 있던 줄**을 건드리지 않았는지.
  assert.deepEqual(await delegationGuard.current(), delegationGuard.baseline);

  jwks.closeAllConnections();
  await new Promise<void>((resolve) => jwks.close(() => resolve()));
  await pgClient.end({ timeout: 5 });
});

describe("🔴 쓰임새 울타리 — 갈래마다 다른 토큰", () => {
  test("자격증명이 없으면 401 이다 (JSON · 폼 인코딩 둘 다)", async () => {
    const json = await post({});
    assert.equal(json.response.status, 401);
    assert.equal(json.body.error, "invalid_token");
    assert.equal(json.response.headers.get("www-authenticate"), "Bearer");
    // 🔴 위임 장부가 캐시되면 거둔 위임이 살아 있는 것처럼 남는다.
    assert.equal(json.response.headers.get("cache-control"), "no-store");

    const form = await post({
      body: "action=list",
      contentType: "application/x-www-form-urlencoded",
    });
    assert.equal(form.response.status, 401, "🔴 폼 인코딩이 읽기 갈래로 안 갔다");
  });

  test("🔴 **쓰기 토큰으로 읽을 수 없다** — 장부 전체를 여는 열쇠가 되면 안 된다", async () => {
    const { response } = await post({
      token: await token({ purpose: PORTAL_TOKEN_PURPOSES.delegationsWrite }),
    });
    assert.equal(response.status, 401);
  });

  test("🔴 **읽기 토큰으로 쓸 수 없다**", async () => {
    const { response } = await post({
      token: await token({ purpose: PORTAL_TOKEN_PURPOSES.delegationsRead }),
      body: JSON.stringify({
        action: "upsert",
        id: randomUUID(),
        delegatorSub: randomUUID(),
        delegateSub: randomUUID(),
        startsAt: "2027-03-01T00:00:00.000Z",
        endsAt: "2027-03-08T00:00:00.000Z",
        reason: "",
      }),
    });
    assert.equal(response.status, 401);
  });

  test("알림 읽기용 토큰으로도 안 열린다", async () => {
    const { response } = await post({
      token: await token({ purpose: PORTAL_TOKEN_PURPOSES.notificationsRead }),
    });
    assert.equal(response.status, 401);
  });

  test("남의 서명·남에게 발급된 토큰도 거절한다", async () => {
    const 남의열쇠 = await generateKeyPair("RS256", { extractable: true });
    const 남의서명 = await post({ token: await token({ key: 남의열쇠.privateKey }) });
    assert.equal(남의서명.response.status, 401);
    const 남의수신자 = await post({ token: await token({ audience: "dss-po" }) });
    assert.equal(남의수신자.response.status, 401);
  });
});

describe("🔴 올바른 읽기 토큰 — 장부가 그대로 나온다", () => {
  test("200 이고, **거둔 줄까지** 나오고, 사람은 한 칸도 안 실린다", async () => {
    const 맡긴이 = await createTestUser("통로 점검 위임자");
    const 대리인 = await createTestUser("통로 점검 대리인");
    const 살아있는줄 = await insertDelegation({
      delegatorUserId: 맡긴이,
      delegateUserId: 대리인,
    });
    const 거둔줄 = await insertDelegation({
      delegatorUserId: 대리인,
      delegateUserId: 맡긴이,
      revokedAt: new Date("2026-11-18T01:00:00.000Z"),
    });

    const { response, body } = await post({ token: await token() });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(body.truncated, false);

    const 줄들 = body.delegations as { id: string; revokedAt: string | null }[];
    // 🔵 표본이 비어 공짜로 통과하지 않게 — 방금 넣은 줄 둘이 **실제로** 있어야 한다.
    const 내줄들 = 줄들.filter((row) => insertedIds.includes(row.id));
    assert.equal(내줄들.length, 2, "🔴 방금 넣은 줄이 답에 없다");
    assert.equal(
      내줄들.find((row) => row.id === 거둔줄)?.revokedAt,
      "2026-11-18T01:00:00.000Z",
      "🔴 거둔 줄이 빠지거나 거둔 시각이 뭉개졌다"
    );
    assert.equal(내줄들.find((row) => row.id === 살아있는줄)?.revokedAt, null);
    for (const row of 내줄들) {
      assert.deepEqual(Object.keys(row).sort(), ["endsAt", "id", "revokedAt", "startsAt"]);
    }

    // 🔴 **사람이 한 자도 안 나간다.** 사유("자리비움")와 사람 번호가 몸통에 없어야 한다.
    const 글자 = JSON.stringify(body);
    for (const 새는값 of [맡긴이, 대리인, "자리비움", "delegator", "delegate", "reason"]) {
      assert.ok(!글자.includes(새는값), `${새는값} 가 몸통에 실렸다`);
    }
  });
});

describe("🔴 쓰기 갈래는 한 글자도 안 바뀌었다", () => {
  test("🔴 몸통이 **살아서** 쓰기 갈래까지 간다 — 엿보기가 원본을 먹지 않았다", async () => {
    // 🔴 이것이 이 파일에서 가장 중요한 시험이다. 엿보기가 **복제본**이 아니면 여기서
    //    400(`요청 본문을 읽을 수 없습니다`)이 돌아온다 — 오류도 경고도 없이 **모든
    //    전파가 조용히 막히는** 모양이다.
    // 🔵 A/S 에 계정이 없는 포털 번호로 부르므로 줄은 **한 개도 안 생긴다**(not_applicable).
    const { response, body } = await post({
      token: await token({ purpose: PORTAL_TOKEN_PURPOSES.delegationsWrite }),
      body: JSON.stringify({
        action: "upsert",
        id: randomUUID(),
        delegatorSub: randomUUID(),
        delegateSub: randomUUID(),
        startsAt: "2027-03-01T00:00:00.000Z",
        endsAt: "2027-03-08T00:00:00.000Z",
        reason: "",
      }),
    });
    assert.equal(response.status, 200, `몸통이 쓰기 갈래에 안 닿았다: ${JSON.stringify(body)}`);
    assert.equal(body.outcome, "not_applicable");
  });

  test("깨진 몸통은 예전 그대로 400 이고, 모르는 말도 예전 그대로다", async () => {
    const 쓰기토큰 = await token({ purpose: PORTAL_TOKEN_PURPOSES.delegationsWrite });
    const 깨진몸통 = await post({ token: 쓰기토큰, body: "{" });
    assert.equal(깨진몸통.response.status, 400);
    assert.equal(깨진몸통.body.error, "invalid_request");

    // 🔴 모르는 `action` 에 **새 규칙을 만들지 않았다** — 쓰기 갈래가 하던 말 그대로다.
    const 모르는말 = await post({
      token: 쓰기토큰,
      body: JSON.stringify({ action: "listen", id: randomUUID() }),
    });
    assert.equal(모르는말.response.status, 400);
    assert.match(String(모르는말.body.error_description), /upsert.*revoke/);
  });

  test("이 통로에는 POST 하나뿐이다", async () => {
    const 통로 = (await import("./route")) as Record<string, unknown>;
    for (const 메서드 of ["GET", "PUT", "PATCH", "DELETE"]) {
      assert.equal(통로[메서드], undefined, `${메서드} 가 열려 있다`);
    }
    assert.equal(typeof 통로.POST, "function");
  });
});
