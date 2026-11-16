import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { auditLogs, portalApprovalDelegations, users } from "../schema";
import {
  revokePortalApprovalDelegation,
  storePortalApprovalDelegation,
} from "./portal-approval-delegations";
import { guardPreexistingRows, type PreexistingRowsGuard } from "../test-cleanup-guard";

/**
 * ============================================================================
 * 포털이 전파한 결재권 위임을 받아 적기 (실제 DB)
 * ============================================================================
 * 표는 `portal_approval_delegations`(0129). 🔴 **옆의 `approval_route_delegations`
 * (A/S 화면에서 사람이 맡기는 위임)를 한 줄도 건드리지 않는다** — 이 파일은 그 표를
 * import 조차 하지 않는다. 설계 B-4 가 둘 다 살려 두기로 했고, 한쪽 시험이 다른 쪽
 * 자료를 지우면 남의 기능이 조용히 깨진다.
 *
 * 스스로 치운다: `portaldeleg-test-` 로 시작하는 던지기용 계정과 그 계정이 걸린
 * 위임 줄·감사 줄만 만들고 after() 에서 전부 지운다. 접수 건을 하나도 만들지 않으므로
 * 접수번호 차례(D…)와 공유 폴더에는 손이 닿지 않는다.
 *
 * 🔴 **치우기가 남의 줄을 지우지 않는지**를 지문으로 증명한다(test-cleanup-guard) —
 * 위임 표와 감사 로그 둘 다. 지문이 어긋나면 그 자체가 실패다.
 *
 * 여기서 재는 것:
 *  1. 🔴 **멱등** — 같은 `id` 로 두 번 저장하면 **한 줄**이고, 둘째가 덮어쓴다.
 *     (윗단의 판단은 server/integration/portal-delegation-push.test.ts 가 재고,
 *     여기서는 **DB 가 실제로 한 줄로 모으는지**를 잰다.)
 *  2. 🔴 **포털이 준 번호가 그대로 기본키다** — 저장한 뒤 그 번호로 찾아진다.
 *     못 찾으면 철회도 어긋남 점검도 오류 없이 안 된다.
 *  3. 🔴 **없는 줄을 거두면 `not_applicable`** — 오류가 아니다.
 *  4. 🔴 **`revoked_at` 이 한 방향으로만 움직인다** — `upsert` 에 실려 온 값은 그대로
 *     적히고(흘리면 포털은 거뒀다고 믿는데 여기선 살아 있다), 널은 이미 적힌 값을
 *     **지우지 않는다**(늦게 닿은 upsert 가 위임을 되살리지 않는다).
 *  5. 감사 기록이 CREATE / UPDATE 로 남고 `actor_user_id` 가 **널**이다(시스템이 한 일).
 *  6. 표의 제약 둘이 실제로 문다 — 기간이 거꾸로인 줄, 같은 사람인 줄.
 * ============================================================================
 */

const TEST_EMAIL_PREFIX = "portaldeleg-test-";

const createdTestUserIds: string[] = [];
let delegationGuard: PreexistingRowsGuard;
let auditGuard: PreexistingRowsGuard;

async function createTestUser(name: string) {
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

function hoursFromNow(h: number): Date {
  return new Date(Date.now() + h * 60 * 60 * 1000);
}

async function readDelegation(id: string) {
  const [row] = await db
    .select()
    .from(portalApprovalDelegations)
    .where(eq(portalApprovalDelegations.id, id));
  return row;
}

async function auditRowsFor(delegationId: string) {
  return db
    .select({
      actionType: auditLogs.actionType,
      actorUserId: auditLogs.actorUserId,
      previousValue: auditLogs.previousValue,
      newValue: auditLogs.newValue,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.targetEntity, "portal_approval_delegations"),
        eq(auditLogs.targetRecordId, delegationId)
      )
    );
}

before(async () => {
  delegationGuard = await guardPreexistingRows({
    label: "portal_approval_delegations",
    table: portalApprovalDelegations,
    idColumn: portalApprovalDelegations.id,
    createdAtColumn: portalApprovalDelegations.syncedAt,
  });
  auditGuard = await guardPreexistingRows({
    label: "audit_logs",
    table: auditLogs,
    idColumn: auditLogs.id,
    createdAtColumn: auditLogs.createdAt,
  });
});

after(async () => {
  if (createdTestUserIds.length > 0) {
    // 이 파일이 만든 위임은 **맡긴 쪽과 맡은 쪽이 둘 다 던지기용 계정**이다.
    // 그 둘로 추리면 남의 줄에는 닿지 않는다.
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
      // 🔴 targetRecordId 만으로 지우지 않는다 — 다른 표의 같은 uuid 를 가리키는 줄까지
      // 쓸어 갈 수 있다(test-cleanup-static-safety.test.ts 가 그 모양을 금지한다).
      await db
        .delete(auditLogs)
        .where(
          and(
            eq(auditLogs.targetEntity, "portal_approval_delegations"),
            inArray(auditLogs.targetRecordId, mineIds)
          )
        );
      await db
        .delete(portalApprovalDelegations)
        .where(inArray(portalApprovalDelegations.id, mineIds));
    }
  }
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%`));

  // 🔴 치우기가 **만들기 전부터 있던 줄**을 건드리지 않았는지. 지문이 어긋나면
  // 이 시험 전체가 실패해야 한다 — 조용히 넘어가면 남의 자료가 사라진 채로 남는다.
  assert.deepEqual(await delegationGuard.current(), delegationGuard.baseline);
  assert.deepEqual(await auditGuard.current(), auditGuard.baseline);

  await pgClient.end({ timeout: 5 });
});

describe("storePortalApprovalDelegation — 받아 적기", () => {
  test("🔴 포털이 준 번호가 그대로 기본키다 — 그 번호로 찾아진다", async () => {
    const delegatorId = await createTestUser("포털위임 시험 결재권자");
    const delegateId = await createTestUser("포털위임 시험 대리인");
    const 포털번호 = randomUUID();

    const outcome = await storePortalApprovalDelegation({
      id: 포털번호,
      delegatorUserId: delegatorId,
      delegateUserId: delegateId,
      startsAt: hoursFromNow(-1),
      endsAt: hoursFromNow(48),
      reason: "출장",
      revokedAt: null,
    });
    assert.equal(outcome, "stored");

    const row = await readDelegation(포털번호);
    assert.ok(row, "🔴 포털이 준 번호로 줄을 못 찾는다 — 철회도 점검도 못 한다");
    assert.equal(row.id, 포털번호);
    assert.equal(row.delegatorUserId, delegatorId);
    assert.equal(row.delegateUserId, delegateId);
    assert.equal(row.reason, "출장");
    assert.equal(row.revokedAt, null);
    assert.ok(row.syncedAt instanceof Date, "언제 받았나가 비어 있다");
  });

  test("🔴 같은 번호로 두 번 → **한 줄**이고 둘째가 덮어쓴다(멱등)", async () => {
    const delegatorId = await createTestUser("포털위임 시험 결재권자");
    const delegateId = await createTestUser("포털위임 시험 대리인");
    const 포털번호 = randomUUID();
    const 첫끝 = hoursFromNow(24);
    const 늘린끝 = hoursFromNow(72);

    await storePortalApprovalDelegation({
      id: 포털번호,
      delegatorUserId: delegatorId,
      delegateUserId: delegateId,
      startsAt: hoursFromNow(-1),
      endsAt: 첫끝,
      reason: "출장",
      revokedAt: null,
    });
    const 둘째 = await storePortalApprovalDelegation({
      id: 포털번호,
      delegatorUserId: delegatorId,
      delegateUserId: delegateId,
      startsAt: hoursFromNow(-1),
      endsAt: 늘린끝,
      reason: "출장(연장)",
      revokedAt: null,
    });
    assert.equal(둘째, "stored");

    const rows = await db
      .select({ id: portalApprovalDelegations.id })
      .from(portalApprovalDelegations)
      .where(eq(portalApprovalDelegations.id, 포털번호));
    assert.equal(rows.length, 1, "🔴 재시도가 줄을 하나 더 만들었다");

    const row = await readDelegation(포털번호);
    assert.equal(row.reason, "출장(연장)", "둘째가 덮어쓰지 않았다");
    assert.equal(row.endsAt.getTime(), 늘린끝.getTime());
  });

  test("감사 기록 — 처음은 CREATE, 덮어쓰면 UPDATE, actor 는 **널**(시스템이 한 일)", async () => {
    const delegatorId = await createTestUser("포털위임 시험 결재권자");
    const delegateId = await createTestUser("포털위임 시험 대리인");
    const 포털번호 = randomUUID();
    const 공통 = {
      id: 포털번호,
      delegatorUserId: delegatorId,
      delegateUserId: delegateId,
      startsAt: hoursFromNow(-1),
      reason: "출장",
      revokedAt: null,
    };

    await storePortalApprovalDelegation({ ...공통, endsAt: hoursFromNow(24) });
    const 처음 = await auditRowsFor(포털번호);
    assert.equal(처음.length, 1);
    assert.equal(처음[0].actionType, "CREATE");
    assert.equal(처음[0].actorUserId, null, "🔴 사람이 한 일이 아니다 — 널이어야 한다");
    assert.equal(처음[0].previousValue, null);
    const 새값 = 처음[0].newValue as Record<string, unknown>;
    assert.equal((새값.delegate as { name: string }).name, "포털위임 시험 대리인");
    assert.equal(새값.source, "portal");

    await storePortalApprovalDelegation({ ...공통, endsAt: hoursFromNow(72) });
    const 다음 = await auditRowsFor(포털번호);
    assert.equal(다음.length, 2, "덮어쓴 기록이 안 남았다");
    const 고침 = 다음.find((row) => row.actionType === "UPDATE");
    assert.ok(고침, "UPDATE 기록이 없다");
    assert.ok(고침.previousValue, "앞 모습이 안 남았다 — 기간이 어떻게 바뀌었는지 못 읽는다");
  });

  test("🔴 표의 제약이 실제로 문다 — 거꾸로 된 기간과 같은 사람", async () => {
    const delegatorId = await createTestUser("포털위임 시험 결재권자");
    const delegateId = await createTestUser("포털위임 시험 대리인");

    await assert.rejects(
      () =>
        storePortalApprovalDelegation({
          id: randomUUID(),
          delegatorUserId: delegatorId,
          delegateUserId: delegateId,
          startsAt: hoursFromNow(48),
          endsAt: hoursFromNow(1),
          reason: "",
          revokedAt: null,
        }),
      "기간이 거꾸로인 줄이 들어갔다"
    );
    await assert.rejects(
      () =>
        storePortalApprovalDelegation({
          id: randomUUID(),
          delegatorUserId: delegatorId,
          delegateUserId: delegatorId,
          startsAt: hoursFromNow(-1),
          endsAt: hoursFromNow(48),
          reason: "",
          revokedAt: null,
        }),
      "자기가 자기를 대신하는 줄이 들어갔다"
    );
    // 🔵 통로는 이 둘을 **400 으로 먼저** 거른다(parsePortalDelegationPush). 여기서
    //    재는 것은 그 통로를 안 거친 길이 생겼을 때의 마지막 벽이다.
  });

  test("🔴 upsert 에 실려 온 철회 시각은 **그대로 적힌다** — 거둔 줄로 들어온다", async () => {
    // 포털이 객체를 통째로 보내면 거둔 줄도 `upsert` 로 온다. 그 값을 흘리면
    // **포털은 거뒀다고 믿는데 여기서는 살아 있는** 줄이 남는다(설계 B-13).
    const delegatorId = await createTestUser("포털위임 시험 결재권자");
    const delegateId = await createTestUser("포털위임 시험 대리인");
    const 포털번호 = randomUUID();
    const 거둔시각 = new Date("2026-11-18T09:00:00.000Z");

    await storePortalApprovalDelegation({
      id: 포털번호,
      delegatorUserId: delegatorId,
      delegateUserId: delegateId,
      startsAt: hoursFromNow(-1),
      endsAt: hoursFromNow(48),
      reason: "출장",
      revokedAt: 거둔시각,
    });

    const row = await readDelegation(포털번호);
    assert.equal(row.revokedAt?.getTime(), 거둔시각.getTime(), "🔴 철회 시각을 흘렸다");
    const 새값 = (await auditRowsFor(포털번호))[0].newValue as Record<string, unknown>;
    assert.equal(새값.revokedAt, 거둔시각.toISOString(), "감사 기록이 적힌 값과 다르다");
  });
});

describe("revokePortalApprovalDelegation — 거두기", () => {
  test("살아 있는 줄을 거둔다 — 줄은 남고 revoked_at 이 포털이 적은 시각으로 찬다", async () => {
    const delegatorId = await createTestUser("포털위임 시험 결재권자");
    const delegateId = await createTestUser("포털위임 시험 대리인");
    const 포털번호 = randomUUID();
    const 거둔시각 = new Date("2026-11-18T09:00:00.000Z");

    await storePortalApprovalDelegation({
      id: 포털번호,
      delegatorUserId: delegatorId,
      delegateUserId: delegateId,
      startsAt: hoursFromNow(-1),
      endsAt: hoursFromNow(48),
      reason: "출장",
      revokedAt: null,
    });
    assert.equal(await revokePortalApprovalDelegation({ id: 포털번호, revokedAt: 거둔시각 }), "stored");

    const row = await readDelegation(포털번호);
    assert.ok(row, "거두면서 줄을 지웠다 — 남겨야 한다");
    assert.equal(row.revokedAt?.getTime(), 거둔시각.getTime());

    const 기록 = await auditRowsFor(포털번호);
    const 거둠 = 기록.filter((one) => one.actionType === "UPDATE");
    assert.equal(거둠.length, 1);
    assert.equal(거둠[0].actorUserId, null);
  });

  test("🔴 없는 줄을 거두면 not_applicable 이다 — 오류가 아니다", async () => {
    const 없는번호 = randomUUID();
    assert.equal(
      await revokePortalApprovalDelegation({ id: 없는번호, revokedAt: new Date() }),
      "not_applicable",
      "🔴 오류로 답하면 포털이 철회를 거절해 거두려는 사람이 영영 못 거둔다"
    );
    assert.equal(await readDelegation(없는번호), undefined, "없던 줄이 생겼다");
    assert.deepEqual(await auditRowsFor(없는번호), [], "없는 줄에 감사 기록을 남겼다");
  });

  test("🔴 같은 시각으로 두 번 거둬도 같은 결과고 감사 기록이 더 쌓이지 않는다", async () => {
    const delegatorId = await createTestUser("포털위임 시험 결재권자");
    const delegateId = await createTestUser("포털위임 시험 대리인");
    const 포털번호 = randomUUID();
    const 거둔시각 = new Date("2026-11-18T09:00:00.000Z");

    await storePortalApprovalDelegation({
      id: 포털번호,
      delegatorUserId: delegatorId,
      delegateUserId: delegateId,
      startsAt: hoursFromNow(-1),
      endsAt: hoursFromNow(48),
      reason: "",
      revokedAt: null,
    });
    await revokePortalApprovalDelegation({ id: 포털번호, revokedAt: 거둔시각 });
    assert.equal(await revokePortalApprovalDelegation({ id: 포털번호, revokedAt: 거둔시각 }), "stored");

    const 거둠 = (await auditRowsFor(포털번호)).filter((one) => one.actionType === "UPDATE");
    assert.equal(거둠.length, 1, "재시도마다 기록이 쌓이면 「몇 번 거뒀나」가 거짓이 된다");
  });

  test("🔴 늦게 닿은 upsert 가 **철회를 되살리지 않는다**", async () => {
    const delegatorId = await createTestUser("포털위임 시험 결재권자");
    const delegateId = await createTestUser("포털위임 시험 대리인");
    const 포털번호 = randomUUID();
    const 거둔시각 = new Date("2026-11-18T09:00:00.000Z");
    const 공통 = {
      id: 포털번호,
      delegatorUserId: delegatorId,
      delegateUserId: delegateId,
      startsAt: hoursFromNow(-1),
      reason: "출장",
      revokedAt: null,
    };

    const 늘린끝 = hoursFromNow(96);
    await storePortalApprovalDelegation({ ...공통, endsAt: hoursFromNow(48) });
    await revokePortalApprovalDelegation({ id: 포털번호, revokedAt: 거둔시각 });
    await storePortalApprovalDelegation({ ...공통, endsAt: 늘린끝 });

    const row = await readDelegation(포털번호);
    assert.equal(
      row.revokedAt?.getTime(),
      거둔시각.getTime(),
      "🔴 되살아난 위임은 아무 오류 없이 남의 결재를 누르게 한다"
    );
    // 🔵 나머지 칸은 덮어써진다 — 「거뒀다」 하나만 지킨다. 그 비대칭을 여기 적어
    //    두지 않으면 다음 사람이 「덮어쓰기가 반만 된다」로 읽고 고치려 든다.
    assert.equal(row.endsAt.getTime(), 늘린끝.getTime(), "덮어쓰기가 통째로 막혔다");
  });

  test("🔴 기간이 끝난 줄에 늦게 닿은 철회도 받아 적는다 — 거절하면 전파가 영영 성공 못 한다", async () => {
    const delegatorId = await createTestUser("포털위임 시험 결재권자");
    const delegateId = await createTestUser("포털위임 시험 대리인");
    const 포털번호 = randomUUID();

    await storePortalApprovalDelegation({
      id: 포털번호,
      delegatorUserId: delegatorId,
      delegateUserId: delegateId,
      startsAt: hoursFromNow(-48),
      endsAt: hoursFromNow(-1),
      reason: "지난 위임",
      revokedAt: null,
    });
    const 거둔시각 = new Date();
    assert.equal(await revokePortalApprovalDelegation({ id: 포털번호, revokedAt: 거둔시각 }), "stored");
    assert.equal((await readDelegation(포털번호)).revokedAt?.getTime(), 거둔시각.getTime());
  });
});
