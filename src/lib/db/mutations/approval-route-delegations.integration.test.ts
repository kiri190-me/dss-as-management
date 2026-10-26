import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { approvalRouteDelegations, auditLogs, users } from "../schema";
import {
  createApprovalRouteDelegation,
  revokeApprovalRouteDelegation,
} from "./approval-route-delegations";
import {
  listApprovalRouteDelegationsForUser,
  resolveActingApproverUserIds,
} from "../queries/approval-route-delegations";
import { guardPreexistingRows, type PreexistingRowsGuard } from "../test-cleanup-guard";

/**
 * ============================================================================
 * 결재선 **단계** 위임 — 쓰기·읽기 통로 (실제 DB)
 * ============================================================================
 * 표는 `approval_route_delegations`(0119). 🔴 **옛 `shipment_approval_delegations`
 * (출하 대표 위임)를 한 줄도 건드리지 않는다** — 이 파일은 그 표를 import 조차 하지
 * 않는다. 둘은 쓰이는 때가 갈려 있어(표 머리말) 한쪽 시험이 다른 쪽 자료를 지우면
 * 남의 기능이 조용히 깨진다.
 *
 * 스스로 치운다: `routedeleg-test-` 로 시작하는 던지기용 계정과 그 계정이 걸린
 * 위임 줄·감사 줄만 만들고 after() 에서 전부 지운다. 접수 건을 하나도 만들지 않으므로
 * 접수번호 차례(D…)와 공유 폴더에는 손이 닿지 않는다.
 *
 * 🔴 **치우기가 남의 줄을 지우지 않는지**를 지문으로 증명한다(test-cleanup-guard) —
 * 위임 표와 감사 로그 둘 다. 지문이 어긋나면 그 자체가 실패다.
 *
 * 여기서 재는 것:
 *  · 인가 — 본인 / 권한 없는 남 / 관리 권한자, 그리고 🔴 **관리자가 자기를 대리인으로**
 *    세우는 것은 **막지 않는다**(2026-10-26 사용자 결정).
 *  · 🔴 되돌림 **두 칸이 함께** 채워진다(표의 짝 CHECK).
 *  · 🔴 **겹치는 기간이 거절되지 않는다** — 옛 위임과 반대다. 본보기를 옮겨 적다
 *    겹침 검사가 따라 들어오면 여기서 걸린다.
 *  · 🔴 「누를 수 있는 자리들」이 본인 + 살아 있는 위임만 주고, **트랜잭션을 받으면
 *    그 트랜잭션의 되돌리기를 본다**(안 보이면 되돌린 위임으로 결재가 통과한다).
 * ============================================================================
 */

const TEST_EMAIL_PREFIX = "routedeleg-test-";

/** 관리 권한(users.shipmentRepresentatives MANAGE)을 가진 표본. */
let managerId: string;
/** 권한이 없는 남 — 기본 정책에서 관리자(ADMIN)는 이 권한을 갖지 않는다. */
let outsiderAdminId: string;
const createdTestUserIds: string[] = [];
let delegationGuard: PreexistingRowsGuard;
let auditGuard: PreexistingRowsGuard;

async function createTestUser(name: string, overrides: Partial<typeof users.$inferInsert> = {}) {
  const [row] = await db
    .insert(users)
    .values({
      email: `${TEST_EMAIL_PREFIX}${randomUUID().slice(0, 8)}@example.test`,
      name,
      role: "AS_ENGINEER",
      approvalStatus: "APPROVED",
      isActive: true,
      ...overrides,
    })
    .returning({ id: users.id });
  createdTestUserIds.push(row.id);
  return row.id;
}

function hoursFromNow(h: number): Date {
  return new Date(Date.now() + h * 60 * 60 * 1000);
}

/** 지금 살아 있는 창(窓). 대부분의 시험이 이 기간으로 만든다. */
function liveWindow() {
  return { startsAt: hoursFromNow(-1), endsAt: hoursFromNow(48) };
}

async function readDelegation(id: string) {
  const [row] = await db
    .select()
    .from(approvalRouteDelegations)
    .where(eq(approvalRouteDelegations.id, id));
  return row;
}

async function auditRowsFor(delegationId: string) {
  return db
    .select({
      actionType: auditLogs.actionType,
      actorUserId: auditLogs.actorUserId,
      targetEntity: auditLogs.targetEntity,
      previousValue: auditLogs.previousValue,
      newValue: auditLogs.newValue,
    })
    .from(auditLogs)
    .where(
      and(eq(auditLogs.targetEntity, "approval_route_delegations"), eq(auditLogs.targetRecordId, delegationId))
    );
}

before(async () => {
  const [manager] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "SUPER_ADMIN"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false),
        eq(users.isActive, true)
      )
    )
    .limit(1);
  assert.ok(manager, "승인된 SUPER_ADMIN 이 시험 DB 에 있어야 한다");
  managerId = manager.id;

  const [outsider] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "ADMIN"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false),
        eq(users.isActive, true)
      )
    )
    .limit(1);
  assert.ok(outsider, "승인된 ADMIN 이 시험 DB 에 있어야 한다");
  outsiderAdminId = outsider.id;

  delegationGuard = await guardPreexistingRows({
    label: "approval_route_delegations",
    table: approvalRouteDelegations,
    idColumn: approvalRouteDelegations.id,
    createdAtColumn: approvalRouteDelegations.createdAt,
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
    // 이 파일이 만든 위임은 **맡긴 쪽이나 맡은 쪽 가운데 적어도 하나가 던지기용
    // 계정**이다(관리자 표본은 actor 로만 쓰거나 대리인으로만 쓴다). 그래서 그 둘로
    // 추리면 남의 줄에는 닿지 않는다.
    const mine = await db
      .select({ id: approvalRouteDelegations.id })
      .from(approvalRouteDelegations)
      .where(
        or(
          inArray(approvalRouteDelegations.delegatorUserId, createdTestUserIds),
          inArray(approvalRouteDelegations.delegateUserId, createdTestUserIds)
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
            eq(auditLogs.targetEntity, "approval_route_delegations"),
            inArray(auditLogs.targetRecordId, mineIds)
          )
        );
      await db.delete(approvalRouteDelegations).where(inArray(approvalRouteDelegations.id, mineIds));
    }
  }
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%`));

  // 🔴 치우기가 **만들기 전부터 있던 줄**을 건드리지 않았는지. 지문이 어긋나면
  // 이 시험 전체가 실패해야 한다 — 조용히 넘어가면 남의 자료가 사라진 채로 남는다.
  assert.deepEqual(await delegationGuard.current(), delegationGuard.baseline);
  assert.deepEqual(await auditGuard.current(), auditGuard.baseline);

  await pgClient.end({ timeout: 5 });
});

describe("createApprovalRouteDelegation — 인가", () => {
  test("본인이 자기 결재권을 맡긴다 → 된다, created_by 에 본인이 남는다", async () => {
    const delegatorId = await createTestUser("위임 시험 결재권자");
    const delegateId = await createTestUser("위임 시험 대리인");

    const result = await createApprovalRouteDelegation({
      delegatorUserId: delegatorId,
      delegateUserId: delegateId,
      ...liveWindow(),
      reason: "출장",
      actorUserId: delegatorId,
    });
    assert.equal(result.ok, true, `본인 위임이 거절됐다: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const row = await readDelegation(result.id);
    assert.equal(row.delegatorUserId, delegatorId);
    assert.equal(row.delegateUserId, delegateId);
    assert.equal(row.createdByUserId, delegatorId, "본인이 만든 줄인데 created_by 가 다르다");
    assert.equal(row.reason, "출장");
    assert.equal(row.revokedAt, null);
    assert.equal(row.revokedByUserId, null);
  });

  test("🔴 권한 없는 남이 남의 결재권을 맡긴다 → 거절, 줄이 생기지 않는다", async () => {
    const delegatorId = await createTestUser("위임 시험 결재권자");
    const delegateId = await createTestUser("위임 시험 대리인");
    const strangerId = await createTestUser("위임 시험 제삼자");

    for (const actorUserId of [strangerId, outsiderAdminId]) {
      const result = await createApprovalRouteDelegation({
        delegatorUserId: delegatorId,
        delegateUserId: delegateId,
        ...liveWindow(),
        reason: "",
        actorUserId,
      });
      assert.equal(result.ok, false, "권한 없는 사람의 위임 지정이 통과했다");
      if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    }

    const rows = await db
      .select({ id: approvalRouteDelegations.id })
      .from(approvalRouteDelegations)
      .where(eq(approvalRouteDelegations.delegatorUserId, delegatorId));
    assert.equal(rows.length, 0, "거절했는데 줄이 남았다");
  });

  test("관리 권한자가 남의 결재권을 맡긴다 → 된다, created_by 로 남이 세운 것이 드러난다", async () => {
    const delegatorId = await createTestUser("위임 시험 결재권자");
    const delegateId = await createTestUser("위임 시험 대리인");

    const result = await createApprovalRouteDelegation({
      delegatorUserId: delegatorId,
      delegateUserId: delegateId,
      ...liveWindow(),
      reason: "",
      actorUserId: managerId,
    });
    assert.equal(result.ok, true, `관리 권한자의 위임 지정이 거절됐다: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const row = await readDelegation(result.id);
    assert.equal(row.createdByUserId, managerId);
    assert.notEqual(row.createdByUserId, row.delegatorUserId, "남이 세운 줄인데 구분이 안 된다");
    // 사유를 안 적으면 널이 아니라 **빈 글자**다(표가 널을 받지 않는다).
    assert.equal(row.reason, "");
  });

  test("🔴 관리 권한자가 **자기를 대리인으로** 세운다 → 된다 (막지 않기로 했다)", async () => {
    // 2026-10-26 사용자 결정. 막을 자리는 created_by 가 남기는 기록이지 제약이 아니다 —
    // 여기서 거절되기 시작하면 그 결정이 뒤집힌 것이므로 사람이 한 번 봐야 한다.
    const delegatorId = await createTestUser("위임 시험 결재권자");

    const result = await createApprovalRouteDelegation({
      delegatorUserId: delegatorId,
      delegateUserId: managerId,
      ...liveWindow(),
      reason: "",
      actorUserId: managerId,
    });
    assert.equal(result.ok, true, `관리자가 자기를 대리인으로 세우는 것이 막혔다: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const row = await readDelegation(result.id);
    assert.equal(row.delegateUserId, managerId);
    assert.equal(row.createdByUserId, managerId, "자기를 세운 사실이 created_by 에 남아야 한다");
  });
});

describe("createApprovalRouteDelegation — 값과 계정 상태", () => {
  test("자기 자신을 대리인으로 지정하면 거절된다 (표의 different_users CHECK 앞에서)", async () => {
    const delegatorId = await createTestUser("위임 시험 결재권자");
    const result = await createApprovalRouteDelegation({
      delegatorUserId: delegatorId,
      delegateUserId: delegatorId,
      ...liveWindow(),
      reason: "",
      actorUserId: managerId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "VALIDATION_ERROR");
  });

  test("끝이 시작보다 앞이거나 같으면 거절된다", async () => {
    const delegatorId = await createTestUser("위임 시험 결재권자");
    const delegateId = await createTestUser("위임 시험 대리인");
    const sameMoment = hoursFromNow(1);

    for (const [startsAt, endsAt] of [
      [hoursFromNow(48), hoursFromNow(1)],
      [sameMoment, sameMoment],
    ]) {
      const result = await createApprovalRouteDelegation({
        delegatorUserId: delegatorId,
        delegateUserId: delegateId,
        startsAt,
        endsAt,
        reason: "",
        actorUserId: managerId,
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "INVALID_TIME_RANGE");
    }
  });

  test("지금 쓸 수 없는 계정은 양쪽 다 거절된다 — 미승인 · 잠김 · 비활성", async () => {
    const healthyId = await createTestUser("위임 시험 정상 계정");
    const ineligible = [
      await createTestUser("위임 시험 미승인", { approvalStatus: "PENDING" }),
      await createTestUser("위임 시험 잠김", { lockedAt: new Date() }),
      await createTestUser("위임 시험 비활성", { isActive: false }),
    ];

    for (const badId of ineligible) {
      const asDelegator = await createApprovalRouteDelegation({
        delegatorUserId: badId,
        delegateUserId: healthyId,
        ...liveWindow(),
        reason: "",
        actorUserId: managerId,
      });
      assert.equal(asDelegator.ok, false, "쓸 수 없는 계정의 결재권이 위임됐다");
      if (!asDelegator.ok) assert.equal(asDelegator.code, "INVALID_USER");

      const asDelegate = await createApprovalRouteDelegation({
        delegatorUserId: healthyId,
        delegateUserId: badId,
        ...liveWindow(),
        reason: "",
        actorUserId: managerId,
      });
      assert.equal(asDelegate.ok, false, "쓸 수 없는 계정이 대리인이 됐다");
      if (!asDelegate.ok) assert.equal(asDelegate.code, "INVALID_USER");
    }
  });

  test("🔴 기간이 겹치는 위임도 만들어진다 — 겹침은 정상이고, 중복은 판정 함수가 거른다", async () => {
    // 옛 위임(shipment_approval_delegations)은 여기서 OVERLAPPING_DELEGATION 으로
    // 거절한다. 이 표는 겹침을 막는 제약이 없고(표 머리말), 두 사람이 동시에 자리를
    // 비우는 일이 실제로 있다. 본보기를 옮겨 적다 겹침 검사가 따라 들어오면 여기서 걸린다.
    const delegatorId = await createTestUser("위임 시험 결재권자");
    const delegateId = await createTestUser("위임 시험 대리인");

    const first = await createApprovalRouteDelegation({
      delegatorUserId: delegatorId,
      delegateUserId: delegateId,
      startsAt: hoursFromNow(-1),
      endsAt: hoursFromNow(48),
      reason: "",
      actorUserId: managerId,
    });
    assert.equal(first.ok, true);
    const second = await createApprovalRouteDelegation({
      delegatorUserId: delegatorId,
      delegateUserId: delegateId,
      startsAt: hoursFromNow(24),
      endsAt: hoursFromNow(72),
      reason: "",
      actorUserId: managerId,
    });
    assert.equal(second.ok, true, `겹치는 기간이 거절됐다: ${JSON.stringify(second)}`);

    const rows = await db
      .select({ id: approvalRouteDelegations.id })
      .from(approvalRouteDelegations)
      .where(eq(approvalRouteDelegations.delegatorUserId, delegatorId));
    assert.equal(rows.length, 2, "겹치는 두 줄이 모두 남아 있어야 한다");

    // 그래도 결재권자 id 는 **한 번만** 나온다 — 겹침을 거르는 자리가 판정 함수라는 증거.
    const acting = await resolveActingApproverUserIds(delegateId, new Date());
    assert.deepEqual([...acting], [delegateId, delegatorId]);
  });
});

describe("revokeApprovalRouteDelegation", () => {
  async function createLiveDelegation() {
    const delegatorId = await createTestUser("위임 시험 결재권자");
    const delegateId = await createTestUser("위임 시험 대리인");
    const created = await createApprovalRouteDelegation({
      delegatorUserId: delegatorId,
      delegateUserId: delegateId,
      ...liveWindow(),
      reason: "",
      actorUserId: managerId,
    });
    assert.equal(created.ok, true, `준비 실패: ${JSON.stringify(created)}`);
    if (!created.ok) throw new Error("준비 실패");
    return { delegatorId, delegateId, delegationId: created.id };
  }

  test("🔴 본인이 되돌린다 → 된다, 되돌림 **두 칸이 함께** 채워진다", async () => {
    const { delegatorId, delegationId } = await createLiveDelegation();

    const result = await revokeApprovalRouteDelegation({ delegationId, actorUserId: delegatorId });
    assert.equal(result.ok, true, `본인 철회가 거절됐다: ${JSON.stringify(result)}`);

    const row = await readDelegation(delegationId);
    assert.ok(row.revokedAt instanceof Date, "revoked_at 이 비어 있다");
    assert.equal(row.revokedByUserId, delegatorId, "revoked_by_user_id 가 비었거나 다르다");
    // 줄은 지우지 않는다 — 기간 칸도 그대로다(되돌리기는 기간을 줄여 적는 것이 아니다).
    assert.ok(row.endsAt.getTime() > Date.now(), "되돌리면서 기간을 줄여 적었다");
  });

  test("🔴 권한 없는 남이 되돌린다 → 거절, 위임은 살아 있다", async () => {
    const { delegateId, delegationId } = await createLiveDelegation();
    const strangerId = await createTestUser("위임 시험 제삼자");

    // 🔵 **맡은 사람(대리인)도 못 되돌린다.** 맡은 쪽이 스스로 자격을 버리면 맡긴
    // 사람이 모르는 사이에 그 단계가 다시 멈춘다.
    for (const actorUserId of [strangerId, outsiderAdminId, delegateId]) {
      const result = await revokeApprovalRouteDelegation({ delegationId, actorUserId });
      assert.equal(result.ok, false, "권한 없는 사람의 철회가 통과했다");
      if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    }

    const row = await readDelegation(delegationId);
    assert.equal(row.revokedAt, null, "거절했는데 되돌려졌다");
    assert.equal(row.revokedByUserId, null);
  });

  test("관리 권한자가 되돌린다 → 된다", async () => {
    const { delegationId } = await createLiveDelegation();
    const result = await revokeApprovalRouteDelegation({ delegationId, actorUserId: managerId });
    assert.equal(result.ok, true, `관리 권한자의 철회가 거절됐다: ${JSON.stringify(result)}`);

    const row = await readDelegation(delegationId);
    assert.equal(row.revokedByUserId, managerId);
  });

  test("이미 되돌린 것을 또 되돌리면 거절된다 — 되돌린 사람·시각은 처음 것 그대로다", async () => {
    const { delegatorId, delegationId } = await createLiveDelegation();
    const first = await revokeApprovalRouteDelegation({ delegationId, actorUserId: delegatorId });
    assert.equal(first.ok, true);
    const before = await readDelegation(delegationId);

    const second = await revokeApprovalRouteDelegation({ delegationId, actorUserId: managerId });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "CONFLICT");

    const afterRow = await readDelegation(delegationId);
    assert.equal(afterRow.revokedByUserId, before.revokedByUserId, "두 번째 철회가 기록을 덮어썼다");
    assert.equal(afterRow.revokedAt?.getTime(), before.revokedAt?.getTime());
  });

  test("없는 위임을 되돌리면 NOT_FOUND", async () => {
    const result = await revokeApprovalRouteDelegation({
      delegationId: randomUUID(),
      actorUserId: managerId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });

  test("이미 기간이 끝난 위임은 되돌릴 것이 없다 — DELEGATION_EXPIRED", async () => {
    const delegatorId = await createTestUser("위임 시험 결재권자");
    const delegateId = await createTestUser("위임 시험 대리인");
    // 지난 기간으로 적는 것 자체는 막지 않는다(뒤늦게 기록해 두는 일이 있다).
    const created = await createApprovalRouteDelegation({
      delegatorUserId: delegatorId,
      delegateUserId: delegateId,
      startsAt: hoursFromNow(-48),
      endsAt: hoursFromNow(-1),
      reason: "",
      actorUserId: managerId,
    });
    assert.equal(created.ok, true, `지난 기간의 위임이 거절됐다: ${JSON.stringify(created)}`);
    if (!created.ok) return;

    const result = await revokeApprovalRouteDelegation({
      delegationId: created.id,
      actorUserId: delegatorId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "DELEGATION_EXPIRED");

    const row = await readDelegation(created.id);
    assert.equal(row.revokedAt, null, "만료된 줄에 철회 표시가 붙었다");
  });
});

describe("감사 기록", () => {
  test("만들기와 되돌리기가 각각 한 줄씩 남고, 이름까지 함께 남는다", async () => {
    const delegatorId = await createTestUser("위임 시험 감사 결재권자");
    const delegateId = await createTestUser("위임 시험 감사 대리인");

    const created = await createApprovalRouteDelegation({
      delegatorUserId: delegatorId,
      delegateUserId: delegateId,
      ...liveWindow(),
      reason: "감사 기록 확인",
      actorUserId: managerId,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const afterCreate = await auditRowsFor(created.id);
    assert.equal(afterCreate.length, 1, "만들기 감사 줄이 하나가 아니다");
    assert.equal(afterCreate[0].actionType, "CREATE");
    assert.equal(afterCreate[0].actorUserId, managerId);
    const createdValue = afterCreate[0].newValue as {
      delegator: { id: string; name: string };
      delegate: { id: string; name: string };
      createdBy: { id: string; name: string };
      reason: string;
      selfAssigned: boolean;
    };
    // 🔴 id 만이 아니라 이름도 — 나중에 계정이 소프트삭제돼도 로그만 읽고 누구였는지
    // 알 수 있어야 한다.
    assert.equal(createdValue.delegator.name, "위임 시험 감사 결재권자");
    assert.equal(createdValue.delegate.name, "위임 시험 감사 대리인");
    assert.equal(createdValue.createdBy.id, managerId);
    assert.equal(createdValue.reason, "감사 기록 확인");
    assert.equal(createdValue.selfAssigned, false);

    const revoked = await revokeApprovalRouteDelegation({
      delegationId: created.id,
      actorUserId: delegatorId,
    });
    assert.equal(revoked.ok, true);

    const afterRevoke = await auditRowsFor(created.id);
    assert.equal(afterRevoke.length, 2, "되돌리기 감사 줄이 안 남았다");
    const revokeRow = afterRevoke.find((row) => row.actionType === "UPDATE");
    assert.ok(revokeRow, "되돌리기는 UPDATE 로 남아야 한다 — 줄이 지워지는 것이 아니다");
    assert.equal(revokeRow.actorUserId, delegatorId);
    const revokedValue = revokeRow.newValue as {
      revokedBy: { id: string; name: string };
      selfRevoked: boolean;
    };
    assert.equal(revokedValue.revokedBy.id, delegatorId);
    assert.equal(revokedValue.selfRevoked, true);
    assert.deepEqual(revokeRow.previousValue, { revokedAt: null, revokedBy: null });
  });
});

describe("resolveActingApproverUserIds — 「지금 누를 수 있는 자리들」", () => {
  test("위임이 하나도 없으면 본인 하나뿐이다", async () => {
    const soloId = await createTestUser("위임 시험 혼자");
    const acting = await resolveActingApproverUserIds(soloId, new Date());
    assert.deepEqual([...acting], [soloId], "본인이 맨 앞에 혼자 있어야 한다");
  });

  test("🔴 살아 있는 위임만 붙는다 — 되돌린 것 · 끝난 것 · 아직 시작 안 한 것은 빠진다", async () => {
    const delegateId = await createTestUser("위임 시험 대리인");
    const liveId = await createTestUser("위임 시험 살아있는 결재권자");
    const revokedId = await createTestUser("위임 시험 철회된 결재권자");
    const expiredId = await createTestUser("위임 시험 만료된 결재권자");
    const futureId = await createTestUser("위임 시험 예정된 결재권자");

    const live = await createApprovalRouteDelegation({
      delegatorUserId: liveId,
      delegateUserId: delegateId,
      ...liveWindow(),
      reason: "",
      actorUserId: managerId,
    });
    assert.equal(live.ok, true);

    const toRevoke = await createApprovalRouteDelegation({
      delegatorUserId: revokedId,
      delegateUserId: delegateId,
      ...liveWindow(),
      reason: "",
      actorUserId: managerId,
    });
    assert.equal(toRevoke.ok, true);
    if (toRevoke.ok) {
      const done = await revokeApprovalRouteDelegation({
        delegationId: toRevoke.id,
        actorUserId: revokedId,
      });
      assert.equal(done.ok, true);
    }

    const expired = await createApprovalRouteDelegation({
      delegatorUserId: expiredId,
      delegateUserId: delegateId,
      startsAt: hoursFromNow(-48),
      endsAt: hoursFromNow(-1),
      reason: "",
      actorUserId: managerId,
    });
    assert.equal(expired.ok, true);

    // 🔵 아직 시작 안 한 줄은 **SQL 이 걸러 내지 않는다**(색인에 starts_at 이 없다).
    // 순수 함수가 버리는 것을 여기서 확인한다 — 그 분담이 깨지면 여기서 걸린다.
    const future = await createApprovalRouteDelegation({
      delegatorUserId: futureId,
      delegateUserId: delegateId,
      startsAt: hoursFromNow(24),
      endsAt: hoursFromNow(72),
      reason: "",
      actorUserId: managerId,
    });
    assert.equal(future.ok, true);

    const acting = await resolveActingApproverUserIds(delegateId, new Date());
    assert.deepEqual([...acting], [delegateId, liveId], "본인 + 살아 있는 위임만 나와야 한다");
  });

  test("🔴 트랜잭션을 넘기면 **그 트랜잭션 안의 되돌리기**가 바로 보인다", async () => {
    // 이것이 executor 인자가 있는 까닭 그대로다. 결재를 집는 쓰기와 같은 트랜잭션으로
    // 읽지 않으면, 읽은 직후 되돌려진 위임으로 결재가 통과한다 — 오류는 나지 않고
    // 로그에는 「되돌린 뒤에 눌렸다」만 남는다.
    const delegatorId = await createTestUser("위임 시험 결재권자");
    const delegateId = await createTestUser("위임 시험 대리인");
    const created = await createApprovalRouteDelegation({
      delegatorUserId: delegatorId,
      delegateUserId: delegateId,
      ...liveWindow(),
      reason: "",
      actorUserId: managerId,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const before = await resolveActingApproverUserIds(delegateId, new Date());
    assert.deepEqual([...before], [delegateId, delegatorId], "표본이 비어 있다 — 잴 것이 없다");

    // 🔵 단언 실패를 ROLLBACK 과 섞지 않는다 — 섞으면 「되돌리기용 오류가 아니다」라는
    // 엉뚱한 문구만 남고 무엇이 틀렸는지 사라진다.
    const ROLLBACK = new Error("rollback-on-purpose");
    let innerError: unknown = null;
    try {
      await db.transaction(async (tx) => {
        await tx
          .update(approvalRouteDelegations)
          .set({ revokedAt: new Date(), revokedByUserId: delegatorId })
          .where(eq(approvalRouteDelegations.id, created.id));

        try {
          const inTx = await resolveActingApproverUserIds(delegateId, new Date(), tx);
          assert.deepEqual([...inTx], [delegateId], "같은 트랜잭션의 되돌리기가 안 보인다");

          // 🔵 같은 순간 보통 연결로 읽으면 아직 살아 있다(아직 커밋 전이다). 두 답이
          // 갈리는 것이 정상이고, 그래서 결재 판정은 **반드시** 제 트랜잭션을 넘겨야 한다.
          const outside = await resolveActingApproverUserIds(delegateId, new Date());
          assert.deepEqual([...outside], [delegateId, delegatorId]);
        } catch (err) {
          innerError = err;
        }

        throw ROLLBACK;
      });
    } catch (err) {
      if (err !== ROLLBACK) throw err;
    }
    if (innerError) throw innerError;

    // 되돌아갔으므로 위임은 그대로 살아 있다.
    const row = await readDelegation(created.id);
    assert.equal(row.revokedAt, null);
  });
});

describe("listApprovalRouteDelegationsForUser", () => {
  test("맡긴 것과 맡은 것이 갈려 나오고, 사람 이름이 함께 온다", async () => {
    const meId = await createTestUser("위임 시험 나");
    const myDelegateId = await createTestUser("위임 시험 내 대리인");
    const otherDelegatorId = await createTestUser("위임 시험 남의 결재권자");

    const given = await createApprovalRouteDelegation({
      delegatorUserId: meId,
      delegateUserId: myDelegateId,
      ...liveWindow(),
      reason: "내가 맡긴 것",
      actorUserId: meId,
    });
    assert.equal(given.ok, true);
    const received = await createApprovalRouteDelegation({
      delegatorUserId: otherDelegatorId,
      delegateUserId: meId,
      ...liveWindow(),
      reason: "",
      actorUserId: managerId,
    });
    assert.equal(received.ok, true);

    const lists = await listApprovalRouteDelegationsForUser(meId);
    assert.equal(lists.given.length, 1, "내가 맡긴 것이 하나여야 한다");
    assert.equal(lists.received.length, 1, "내가 대신하고 있는 것이 하나여야 한다");

    const [givenRow] = lists.given;
    assert.equal(givenRow.delegatorName, "위임 시험 나");
    assert.equal(givenRow.delegateName, "위임 시험 내 대리인");
    assert.equal(givenRow.createdByName, "위임 시험 나");
    assert.equal(givenRow.reason, "내가 맡긴 것");
    assert.ok(givenRow.startsAt instanceof Date, "시각은 Date 그대로여야 한다 — 글자가 아니다");
    assert.equal(givenRow.revokedByName, null);

    const [receivedRow] = lists.received;
    assert.equal(receivedRow.delegatorName, "위임 시험 남의 결재권자");
    assert.equal(receivedRow.delegateName, "위임 시험 나");

    // 되돌리면 되돌린 사람 이름까지 함께 온다 — 화면이 다시 묻지 않게.
    if (given.ok) {
      const revoked = await revokeApprovalRouteDelegation({
        delegationId: given.id,
        actorUserId: meId,
      });
      assert.equal(revoked.ok, true);
    }
    const afterRevoke = await listApprovalRouteDelegationsForUser(meId);
    assert.equal(afterRevoke.given.length, 1, "되돌린 줄이 목록에서 사라졌다 — 줄은 남아야 한다");
    assert.equal(afterRevoke.given[0].revokedByName, "위임 시험 나");
    assert.ok(afterRevoke.given[0].revokedAt instanceof Date);
  });
});
