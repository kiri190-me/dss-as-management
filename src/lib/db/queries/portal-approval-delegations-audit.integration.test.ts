import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inArray, like, or } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { portalApprovalDelegations, users } from "../schema";
import {
  listPortalApprovalDelegationsForAudit,
  portalDelegationsForAuditQuery,
} from "./portal-approval-delegations";
import { DELEGATION_LIST_LIMIT } from "@/lib/server/integration/portal-delegation-list";
import { guardPreexistingRows, type PreexistingRowsGuard } from "../test-cleanup-guard";

/**
 * ============================================================================
 * 포털의 **어긋남 점검**이 읽어 갈 위임 장부 — 실제 DB 로 잰다 (조각 9a · 설계 B-14)
 * ============================================================================
 * 옆 `portal-approval-delegations.integration.test.ts` 는 **화면용** 조회를 잰다. 이
 * 파일이 재는 것은 그 반대편 — 🔴 **거르개가 하나도 없고 사람 칸을 한 개도 안 고르는**
 * 조회다. 둘을 한 파일에 두지 않은 까닭은 재는 뜻이 정반대라서다(한쪽은 「보는 사람의
 * 줄만 · 끝난 것은 접어서」, 이쪽은 「전부 · 거둔 것까지」).
 *
 * 여기서 재는 것:
 *  1. 🔴 **사람 칸을 고르지도 않는다** — 글자가 아니라 **구워진 SQL** 로 본다.
 *  2. 🔴 **`where` 가 한 줄도 없다** — 거른 목록으로는 「포털은 거뒀는데 집에서는 살아
 *     있는」 줄이 양쪽에서 똑같이 안 보인다(설계 B-13 이 더 위험하다고 한 쪽).
 *  3. 🔴 **차례가 번호 오름차순**이고 **상한보다 한 줄 더** 묻는다.
 *  4. 🔴 **실제로 세 모양의 줄이 다 나온다** — 살아 있는 것 · 기간이 끝난 것 · **거둔 것**.
 *     🔵 1~3 은 「무엇을 묻는가」까지만 보고, 실제로 어느 줄이 집히는지는 이 네 번째가
 *     값으로 본다.
 *
 * 🔴 **표가 비어 있다고 가정하지 않는다.** 이 조회는 표를 통째로 읽으므로 남의 줄이
 * 섞여 온다 — 그래서 **제가 넣은 번호로만** 센다.
 *
 * 스스로 치운다: `portaldelegaudit-test-` 로 시작하는 던지기용 계정과 그 계정이 걸린
 * 위임 줄만 만들고 after() 에서 전부 지운다. 접수 건을 하나도 만들지 않으므로 접수번호
 * 차례(D…)와 공유 폴더에는 손이 닿지 않는다.
 * 🔵 이웃 두 시험의 접두사(`portaldeleg-test-` · `portaldelegq-test-`)와 **서로 걸리지
 * 않는다** — 그쪽 치우기는 각각 `portaldeleg-test-%` · `portaldelegq-test-%` 로 지우는데,
 * 이 파일의 이메일은 `portaldeleg` 뒤에 `audit` 이 온다.
 *
 * 🔴 치우기가 남의 줄을 지우지 않는지를 지문으로 증명한다(test-cleanup-guard).
 * ============================================================================
 */

const TEST_EMAIL_PREFIX = "portaldelegaudit-test-";

const createdTestUserIds: string[] = [];
/** 🔴 이 파일이 **직접 넣은** 번호들. 남의 줄과 가르는 자가 이것뿐이다. */
const insertedIds: string[] = [];
let delegationGuard: PreexistingRowsGuard;

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

/** 🔴 번호는 **포털이 정한다**(표에 defaultRandom 이 없다). 여기서도 넣어 준다. */
async function insertDelegation(params: {
  delegatorUserId: string;
  delegateUserId: string;
  startsAt: Date;
  endsAt: Date;
  reason?: string;
  revokedAt?: Date | null;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(portalApprovalDelegations).values({
    id,
    delegatorUserId: params.delegatorUserId,
    delegateUserId: params.delegateUserId,
    startsAt: params.startsAt,
    endsAt: params.endsAt,
    reason: params.reason ?? "",
    revokedAt: params.revokedAt ?? null,
  });
  insertedIds.push(id);
  return id;
}

const NOW = new Date("2026-11-17T03:00:00.000Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 60 * 60 * 1000);

before(async () => {
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

  // 🔴 치우기가 **만들기 전부터 있던 줄**을 건드리지 않았는지. 지문이 어긋나면 이 시험
  // 전체가 실패해야 한다 — 조용히 넘어가면 남의 자료가 사라진 채로 남는다.
  assert.deepEqual(await delegationGuard.current(), delegationGuard.baseline);

  await pgClient.end({ timeout: 5 });
});

describe("구워진 SQL — 🔵 질의를 만들기만 하고 돌리지 않는다", () => {
  const { sql, params } = portalDelegationsForAuditQuery(DELEGATION_LIST_LIMIT).toSQL();

  test("🔴 사람 칸을 **고르지도 않는다** — 고른 뒤에 안 싣는 것이 아니다", () => {
    // 🔵 표본이 비어 공짜로 통과하지 않게, 무엇을 읽었는지부터 못 박는다.
    assert.match(sql, /^select /);
    assert.ok(sql.includes('from "portal_approval_delegations"'), `엉뚱한 표를 읽는다: ${sql}`);
    for (const 칸 of ["id", "starts_at", "ends_at", "revoked_at"]) {
      assert.ok(sql.includes(`"${칸}"`), `${칸} 이 빠졌다: ${sql}`);
    }
    // 🔴 이 넷이 들어오면 「회사 전체의 결재 대리 관계」가 토큰 하나로 나간다.
    for (const 칸 of ["delegator", "delegate", "reason", "synced_at"]) {
      assert.ok(!sql.includes(칸), `${칸} 을 읽고 있다: ${sql}`);
    }
    // 사람 표를 붙이지도 않는다 — 이름을 실을 길 자체가 없어야 한다.
    assert.ok(!sql.includes("join"), `사람 표를 붙였다: ${sql}`);
  });

  test("🔴 **거르개가 없다** — 철회된 줄까지 전부", () => {
    assert.ok(!/ where /.test(sql), `거르개가 붙었다: ${sql}`);
    // 🔵 화면용 조회의 조건(`revoked_at is null` · `ends_at > $1`)이 실수로 따라오지
    //    않았는지 이름으로도 본다.
    assert.ok(!sql.includes("is null"), `살아 있는 줄만 보고 있다: ${sql}`);
  });

  test("🔴 차례를 못 박는다 — 잘릴 때 **같은 줄**이 잘린다", () => {
    assert.match(sql, /order by "portal_approval_delegations"\."id"/);
    assert.ok(!/order by .*desc/.test(sql), `내림차순이다: ${sql}`);
  });

  test("🔴 상한보다 **한 줄 더** 묻는다 — 넘침을 가리는 유일한 길", () => {
    assert.match(sql, /limit \$\d+/);
    assert.ok(
      params.includes(DELEGATION_LIST_LIMIT + 1),
      `상한이 ${DELEGATION_LIST_LIMIT + 1} 이 아니다: ${JSON.stringify(params)}`
    );
    // 🔵 상한을 바꿔도 **언제나 한 줄 더**다(통로가 숫자를 들고 내려온다).
    assert.ok(portalDelegationsForAuditQuery(5).toSQL().params.includes(6));
  });
});

describe("실제 줄 — 🔴 살아 있는 것·끝난 것·거둔 것이 **다 나온다**", () => {
  test("🔴 세 모양이 전부, 번호 오름차순으로, 칸 넷만", async () => {
    const 맡긴이 = await createTestUser("점검용 위임자");
    const 대리인 = await createTestUser("점검용 대리인");

    const 살아있는줄 = await insertDelegation({
      delegatorUserId: 맡긴이,
      delegateUserId: 대리인,
      startsAt: hours(-1),
      endsAt: hours(24),
      reason: "출장",
    });
    const 끝난줄 = await insertDelegation({
      delegatorUserId: 맡긴이,
      delegateUserId: 대리인,
      startsAt: hours(-48),
      endsAt: hours(-24),
    });
    const 거둔시각 = hours(-2);
    const 거둔줄 = await insertDelegation({
      delegatorUserId: 맡긴이,
      delegateUserId: 대리인,
      startsAt: hours(-5),
      endsAt: hours(24),
      revokedAt: 거둔시각,
    });

    const rows = await listPortalApprovalDelegationsForAudit(DELEGATION_LIST_LIMIT);
    const 내줄들 = rows.filter((row) => insertedIds.includes(row.id));

    // 🔴 **셋 다** 나와야 한다. 화면용 조회였다면 거둔 줄과 끝난 줄이 「끝난 목록」으로
    //    빠지거나 사람으로 걸러져 안 보인다 — 그러면 맞대어 보기가 눈이 먼다.
    assert.deepEqual(
      [...내줄들.map((row) => row.id)].sort(),
      [살아있는줄, 끝난줄, 거둔줄].sort(),
      "🔴 세 모양 가운데 빠진 줄이 있다"
    );

    // 🔴 차례 — 내 줄들이 번호 오름차순으로 와야 한다(상한에 잘릴 때 같은 줄이 잘린다).
    assert.deepEqual(
      내줄들.map((row) => row.id),
      [...내줄들.map((row) => row.id)].sort(),
      "🔴 번호 오름차순이 아니다"
    );

    // 🔴 거둔 시각이 **그대로** 실린다. 널로 뭉개면 점검이 「집에서는 살아 있다」로 읽는다.
    const 거둔것 = 내줄들.find((row) => row.id === 거둔줄);
    assert.ok(거둔것, "거둔 줄을 못 찾았다");
    assert.equal(거둔것?.revokedAt?.getTime(), 거둔시각.getTime());
    assert.equal(내줄들.find((row) => row.id === 살아있는줄)?.revokedAt, null);

    // 🔴 칸은 넷뿐이다 — 사유("출장")도 사람 번호도 올라오지 않는다.
    for (const row of 내줄들) {
      assert.deepEqual(Object.keys(row).sort(), ["endsAt", "id", "revokedAt", "startsAt"]);
    }
    assert.ok(!JSON.stringify(내줄들).includes("출장"), "사유가 읽혔다");
    assert.ok(!JSON.stringify(내줄들).includes(맡긴이), "사람 번호가 읽혔다");
  });

  test("🔴 상한을 넘겨 물으면 **한 줄 더**까지만 — 세는 것은 통로의 몫이다", async () => {
    // 🔵 제 줄을 하나 넣어 표가 비지 않게 한 뒤 상한 1 로 묻는다. 이 조회가 **스스로
    //    자르지 않는다**는 것(`truncated` 는 몸통 짓는 쪽이 센다)과 `limit + 1` 이 실제로
    //    도는 것을 함께 본다.
    const 맡긴이 = await createTestUser("상한 확인 위임자");
    const 대리인 = await createTestUser("상한 확인 대리인");
    await insertDelegation({
      delegatorUserId: 맡긴이,
      delegateUserId: 대리인,
      startsAt: hours(-1),
      endsAt: hours(24),
    });

    const 한줄상한 = await listPortalApprovalDelegationsForAudit(1);
    assert.ok(한줄상한.length <= 2, `${한줄상한.length} 줄이 왔다 — limit + 1 이 안 걸렸다`);
    // 🔵 표본이 비어 공짜로 통과하지 않게 — 방금 넣은 줄이 있으므로 비어 있을 수 없다.
    assert.ok(한줄상한.length >= 1, "표가 비었다 — 방금 넣은 줄이 사라졌다");
  });
});
