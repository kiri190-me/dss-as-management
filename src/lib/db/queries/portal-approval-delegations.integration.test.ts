import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inArray, like, or } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { portalApprovalDelegations, users } from "../schema";
import { listPortalApprovalDelegationsForUser } from "./portal-approval-delegations";
import { FINISHED_DELEGATION_LIMIT } from "./approval-route-delegations";
import { guardPreexistingRows, type PreexistingRowsGuard } from "../test-cleanup-guard";

/**
 * ============================================================================
 * 통합 승인함에서 맡긴 위임을 **화면에 보여 줄 값**으로 읽기 (실제 DB)
 * ============================================================================
 * [결재권 위임] 탭의 네 번째 묶음이 쓰는 조회다. 화면 쪽 구조는
 * components/users/portal-approval-delegation-section.test.ts 가 원본 글자로
 * 지키고, **값**은 여기서 실제 DB 로 잰다 — 글자로는 「살아 있다」와 「끝났다」가
 * 실제로 어느 줄을 집는지 알 수 없다.
 *
 * 여기서 재는 것:
 *  1. 방향 — 맡긴 줄은 `given`, 맡은 줄은 `received`. 🔴 **한 줄이 양쪽에 들어가지
 *     않는다**(표의 `…_different_users` CHECK 가 그런 줄을 막는다).
 *  2. 🔴 **「끝났다」의 자** — 거뒀거나(기간이 남아 있어도) 기간이 끝났거나.
 *     옆 `approval_route_delegations` 와 같은 자다.
 *  3. 🔴 **반열린 구간** — `ends_at` 그 순간은 이미 끝난 것이다.
 *  4. 🔴 **아직 시작 안 한 줄도 살아 있다** — 「살아 있다」는 시작 시각을 보지
 *     않는다(화면이 「예정」 딱지로 가른다). 여기서 빼면 맡겨 둔 위임이 시작 전까지
 *     화면에서 **사라진다.**
 *  5. 남의 줄은 안 나온다.
 *  6. 사람 이름이 실려 온다 — 화면이 다시 묻지 않는다.
 *
 * 🔴 **표가 비어 있다고 가정하지 않는다.** 개발·시험 DB 에는 이미 다른 사람의 줄이
 * 들어 있을 수 있고, 실제로 개발 DB 에는 둘(살아 있는 것·거둔 것)이 있다. 이 파일은
 * **제가 만든 계정의 id 로만** 묻고 제가 넣은 번호로만 센다 — 그래서 남의 줄이 몇
 * 개든 답이 달라지지 않는다.
 *
 * 스스로 치운다: `portaldelegq-test-` 로 시작하는 던지기용 계정과 그 계정이 걸린
 * 위임 줄만 만들고 after() 에서 전부 지운다. 접수 건을 하나도 만들지 않으므로
 * 접수번호 차례(D…)와 공유 폴더에는 손이 닿지 않는다.
 * 🔵 옆 mutations/portal-approval-delegations.integration.test.ts 의 접두사
 * (`portaldeleg-test-`)와 **서로 걸리지 않는다** — 그쪽 치우기는 `portaldeleg-test-%`
 * 로 지우는데, 이 파일의 이메일은 그 뒤에 `-` 가 아니라 `q` 가 온다.
 *
 * 🔴 치우기가 남의 줄을 지우지 않는지를 지문으로 증명한다(test-cleanup-guard).
 * ============================================================================
 */

const TEST_EMAIL_PREFIX = "portaldelegq-test-";

const createdTestUserIds: string[] = [];
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

  // 🔴 치우기가 **만들기 전부터 있던 줄**을 건드리지 않았는지. 지문이 어긋나면
  // 이 시험 전체가 실패해야 한다 — 조용히 넘어가면 남의 자료가 사라진 채로 남는다.
  assert.deepEqual(await delegationGuard.current(), delegationGuard.baseline);

  await pgClient.end({ timeout: 5 });
});

describe("listPortalApprovalDelegationsForUser — 방향", () => {
  test("🔴 맡긴 줄은 given, 맡은 줄은 received — 둘이 섞이지 않는다", async () => {
    const 나 = await createTestUser("승인함위임 조회 본인");
    const 대리인 = await createTestUser("승인함위임 조회 대리인");
    const 상사 = await createTestUser("승인함위임 조회 상사");

    const 맡긴줄 = await insertDelegation({
      delegatorUserId: 나,
      delegateUserId: 대리인,
      startsAt: hours(-1),
      endsAt: hours(24),
      reason: "출장",
    });
    const 맡은줄 = await insertDelegation({
      delegatorUserId: 상사,
      delegateUserId: 나,
      startsAt: hours(-1),
      endsAt: hours(24),
    });

    const view = await listPortalApprovalDelegationsForUser(나, NOW);

    assert.deepEqual(
      view.given.map((row) => row.id),
      [맡긴줄],
      "🔴 승인함에서 맡긴 줄이 「내가 맡긴 것」에 안 들어온다"
    );
    assert.deepEqual(
      view.received.map((row) => row.id),
      [맡은줄],
      "🔴 승인함에서 맡은 줄이 「내가 대신하고 있는 것」에 안 들어온다"
    );
    // 🔴 한 줄이 양쪽에 동시에 들어가지 않는다.
    assert.equal(
      view.given.filter((row) => view.received.some((other) => other.id === row.id)).length,
      0,
      "같은 줄이 두 목록에 함께 들어갔다"
    );
    assert.deepEqual(view.finished, [], "살아 있는 줄이 끝난 목록에도 들어갔다");
  });

  test("사람 이름이 실려 온다 — 화면이 다시 묻지 않는다", async () => {
    const 결재권자 = await createTestUser("승인함위임 이름 결재권자");
    const 대리인 = await createTestUser("승인함위임 이름 대리인");
    await insertDelegation({
      delegatorUserId: 결재권자,
      delegateUserId: 대리인,
      startsAt: hours(-1),
      endsAt: hours(24),
      reason: "휴가",
    });

    const view = await listPortalApprovalDelegationsForUser(결재권자, NOW);
    assert.equal(view.given.length, 1);
    const [row] = view.given;
    assert.equal(row.delegatorName, "승인함위임 이름 결재권자");
    assert.equal(row.delegateName, "승인함위임 이름 대리인");
    assert.equal(row.reason, "휴가");
    assert.equal(row.revokedAt, null);
    assert.ok(row.startsAt instanceof Date, "시각이 Date 가 아니다 — 딱지 함수가 못 받는다");
    assert.ok(row.endsAt instanceof Date);
  });

  test("🔴 남의 줄은 안 나온다", async () => {
    const 나 = await createTestUser("승인함위임 남의줄 본인");
    const 남1 = await createTestUser("승인함위임 남의줄 하나");
    const 남2 = await createTestUser("승인함위임 남의줄 둘");
    await insertDelegation({
      delegatorUserId: 남1,
      delegateUserId: 남2,
      startsAt: hours(-1),
      endsAt: hours(24),
    });

    const view = await listPortalApprovalDelegationsForUser(나, NOW);
    assert.deepEqual(view.given, []);
    assert.deepEqual(view.received, []);
    assert.deepEqual(view.finished, []);
  });
});

describe("listPortalApprovalDelegationsForUser — 「끝났다」의 자", () => {
  test("🔴 거둔 줄은 기간이 남아 있어도 끝난 쪽이다", async () => {
    const 나 = await createTestUser("승인함위임 거둠 본인");
    const 대리인 = await createTestUser("승인함위임 거둠 대리인");
    const 거둔줄 = await insertDelegation({
      delegatorUserId: 나,
      delegateUserId: 대리인,
      // 기간은 한참 남았다 — 그래도 거둬졌으면 끝난 것이다.
      startsAt: hours(-1),
      endsAt: hours(240),
      revokedAt: hours(-0.5),
    });

    const view = await listPortalApprovalDelegationsForUser(나, NOW);
    assert.deepEqual(view.given, [], "거둔 줄이 아직 살아 있는 것으로 보인다");
    assert.deepEqual(
      view.finished.map((row) => row.id),
      [거둔줄],
      "🔴 거둔 줄이 끝난 목록에 없다 — 어디에도 안 보이게 된다"
    );
    assert.ok(view.finished[0].revokedAt instanceof Date, "거둔 시각이 안 실려 온다");
  });

  test("🔴 기간이 끝난 줄도 끝난 쪽이다", async () => {
    const 나 = await createTestUser("승인함위임 만료 본인");
    const 대리인 = await createTestUser("승인함위임 만료 대리인");
    const 끝난줄 = await insertDelegation({
      delegatorUserId: 나,
      delegateUserId: 대리인,
      startsAt: hours(-48),
      endsAt: hours(-1),
    });

    const view = await listPortalApprovalDelegationsForUser(나, NOW);
    assert.deepEqual(view.given, []);
    assert.deepEqual(view.finished.map((row) => row.id), [끝난줄]);
    assert.equal(view.finished[0].revokedAt, null, "기간이 다 돼 끝난 줄에 거둔 시각이 찍혔다");
  });

  test("🔴 반열린 구간 — `ends_at` 그 순간은 이미 끝난 것이다", async () => {
    const 나 = await createTestUser("승인함위임 경계 본인");
    const 대리인 = await createTestUser("승인함위임 경계 대리인");
    const 경계줄 = await insertDelegation({
      delegatorUserId: 나,
      delegateUserId: 대리인,
      startsAt: hours(-24),
      endsAt: NOW,
    });

    // 그 순간: 끝난 쪽이다.
    const at = await listPortalApprovalDelegationsForUser(나, NOW);
    assert.deepEqual(at.given, [], "끝나는 그 순간을 아직 살아 있다고 본다");
    assert.deepEqual(at.finished.map((row) => row.id), [경계줄]);

    // 그 직전: 살아 있다. 🔵 한쪽만 재면 「언제나 끝난 것」인 조회도 통과한다.
    const before = await listPortalApprovalDelegationsForUser(
      나,
      new Date(NOW.getTime() - 1)
    );
    assert.deepEqual(before.given.map((row) => row.id), [경계줄], "끝나기 직전인데 이미 끝났다");
    assert.deepEqual(before.finished, []);
  });

  test("🔴 아직 시작 안 한 줄도 **살아 있는 쪽**이다 — 시작 시각을 보지 않는다", async () => {
    // 여기서 빼면 맡겨 둔 위임이 시작할 때까지 화면에서 **사라진다.** 「예정」으로
    // 가르는 것은 화면의 딱지 함수 몫이다
    // (domain/approval-route-delegation.ts 의 SCHEDULED).
    const 나 = await createTestUser("승인함위임 예정 본인");
    const 대리인 = await createTestUser("승인함위임 예정 대리인");
    const 예정줄 = await insertDelegation({
      delegatorUserId: 나,
      delegateUserId: 대리인,
      startsAt: hours(24),
      endsAt: hours(48),
    });

    const view = await listPortalApprovalDelegationsForUser(나, NOW);
    assert.deepEqual(
      view.given.map((row) => row.id),
      [예정줄],
      "🔴 아직 시작 안 한 위임이 목록에서 사라졌다"
    );
    assert.deepEqual(view.finished, []);
  });

  test("끝난 줄은 두 방향이 **한 목록**에 모인다", async () => {
    const 나 = await createTestUser("승인함위임 끝난둘 본인");
    const 대리인 = await createTestUser("승인함위임 끝난둘 대리인");
    const 상사 = await createTestUser("승인함위임 끝난둘 상사");
    const 내가맡긴_끝난줄 = await insertDelegation({
      delegatorUserId: 나,
      delegateUserId: 대리인,
      startsAt: hours(-48),
      endsAt: hours(-1),
    });
    const 내가맡은_끝난줄 = await insertDelegation({
      delegatorUserId: 상사,
      delegateUserId: 나,
      startsAt: hours(-72),
      endsAt: hours(-2),
    });

    const view = await listPortalApprovalDelegationsForUser(나, NOW);
    assert.deepEqual(view.given, []);
    assert.deepEqual(view.received, []);
    assert.deepEqual(
      view.finished.map((row) => row.id),
      // 차례는 `starts_at` 내림차순 — 늦게 시작한 것이 위다.
      [내가맡긴_끝난줄, 내가맡은_끝난줄],
      "끝난 목록에 두 방향이 최근 순으로 모이지 않는다"
    );
  });

  test("🔴 상한을 옆 조회와 **같은 상수**로 말한다 — 화면이 숫자를 안 박는다", async () => {
    const 나 = await createTestUser("승인함위임 상한 본인");
    const view = await listPortalApprovalDelegationsForUser(나, NOW);
    assert.equal(
      view.finishedLimit,
      FINISHED_DELEGATION_LIMIT,
      "상한이 옆 조회와 갈렸다 — 묶음마다 「최근 N건」의 N 이 달라진다"
    );
    assert.ok(FINISHED_DELEGATION_LIMIT > 0, "상한이 0 이다 — 끝난 줄이 영영 안 보인다");
    assert.equal(view.finishedTruncated, false, "줄이 없는데 잘렸다고 말한다");
  });
});
