import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { auditLogs, users } from "../schema";
import { setDeveloperFlag } from "./developer-flag";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { mayManageDeveloperFlag } from "@/lib/auth/developer-flag-authorization";
import { actorMay, DEVELOPER_PROMOTED_ROLE } from "@/lib/auth/developer-promotion";
import { hasPermission } from "@/lib/auth/permission-resolver";
import type { SessionPayload } from "@/lib/auth/session";

/**
 * ============================================================================
 * setDeveloperFlag() — 실제 DB (시험 DB)
 * ============================================================================
 * 형제 시험(shipment-representatives.integration.test.ts)과 같은 방식이다: 이
 * 파일이 만든 "devflagfix-test-" 계정만 쓰고, after() 에서 그 계정들이 남긴 감사
 * 기록까지 지운다(audit_logs.actor_user_id → users 가 restrict 라 순서가 있다).
 * 씨앗 계정은 읽지도 않는다 — 행위자(최고관리자·관리자·…)까지 전부 여기서 만든다.
 *
 * 🔴 여기서 지키는 것 하나: **개발자 표시가 켜진 A/S 엔지니어는 다른 사람의 표시를
 * 켤 수 없다.** 「최고관리자 동급」 규칙의 유일하고 의도된 예외다
 * (auth/developer-flag-authorization.ts).
 * ============================================================================
 */

const TEST_EMAIL_PREFIX = "devflagfix-test-";

let originalAuthSource: string | undefined;
let superAdminId: string;
let developerEngineerId: string;
let adminId: string;
let salesId: string;
let inventoryManagerId: string;
let pendingSuperAdminId: string;
const createdTestUserIds: string[] = [];

async function createTestUser(overrides: Partial<typeof users.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      email: `${TEST_EMAIL_PREFIX}${randomUUID().slice(0, 8)}@example.test`,
      name: "DevFlag Test User",
      role: "AS_ENGINEER",
      approvalStatus: "APPROVED",
      isActive: true,
      ...overrides,
    })
    .returning({ id: users.id });
  createdTestUserIds.push(row.id);
  return row.id;
}

function sessionFor(userId: string): SessionPayload {
  const now = Math.floor(Date.now() / 1000);
  return { userId, role: "AS_ENGINEER", approvalStatus: "APPROVED", issuedAt: now, expiresAt: now + 3600 };
}

async function isDeveloperOf(userId: string): Promise<boolean> {
  const [row] = await db.select({ isDeveloper: users.isDeveloper }).from(users).where(eq(users.id, userId));
  assert.ok(row, "대상 행이 없다");
  return row.isDeveloper;
}

async function updatedAtOf(userId: string): Promise<number> {
  const [row] = await db.select({ updatedAt: users.updatedAt }).from(users).where(eq(users.id, userId));
  assert.ok(row, "대상 행이 없다");
  return row.updatedAt.getTime();
}

/** 이 파일이 만든 행위자가 그 대상에 남긴 감사 기록 — 조회다(지우는 쪽은 행위자로만 고른다). */
async function auditRowsFor(actorUserId: string, targetUserId: string) {
  return db
    .select({
      actorUserId: auditLogs.actorUserId,
      actionType: auditLogs.actionType,
      targetEntity: auditLogs.targetEntity,
      targetRecordId: auditLogs.targetRecordId,
      previousValue: auditLogs.previousValue,
      newValue: auditLogs.newValue,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.actorUserId, actorUserId), eq(auditLogs.targetRecordId, targetUserId)));
}

async function auditCountBy(actorUserId: string): Promise<number> {
  const rows = await db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.actorUserId, actorUserId));
  return rows.length;
}

function newIsDeveloperOf(row: { newValue: unknown }): boolean | undefined {
  return (row.newValue as { isDeveloper?: boolean } | null)?.isDeveloper;
}

/**
 * 이 파일의 계정과 그 계정들이 남긴 감사 기록을 지운다 — 접두사로 고르므로, 이전
 * 실행이 중간에 끊겨 남은 것까지 함께 걷는다(남으면 개발자 표시가 켜진 채로 남아
 * developer-permissions.integration.test.ts 의 「개발자는 하나뿐」 단언을 깨뜨린다).
 */
async function removeTestUsersByPrefix(): Promise<void> {
  const leftovers = await db.select({ id: users.id }).from(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  const ids = leftovers.map((row) => row.id);
  if (ids.length === 0) return;
  // audit_logs.actor_user_id → users (restrict): 먼저 지운다. 행위자로만 고른다 —
  // target_record_id 로 고르는 모양은 test-cleanup-static-safety.test.ts 가 금지한다.
  await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, ids));
  await db.delete(users).where(inArray(users.id, ids));
}

before(async () => {
  originalAuthSource = process.env.AUTH_SOURCE;
  process.env.AUTH_SOURCE = "database";

  await removeTestUsersByPrefix();

  superAdminId = await createTestUser({ role: "SUPER_ADMIN", name: "DevFlag 최고관리자" });
  // 🔴 개발자 표시가 켜진 A/S 엔지니어 — 준비 단계의 직접 insert 다(시험 DB 에서만).
  developerEngineerId = await createTestUser({ isDeveloper: true, name: "DevFlag 개발자 엔지니어" });
  adminId = await createTestUser({ role: "ADMIN" });
  salesId = await createTestUser({ role: "SALES" });
  inventoryManagerId = await createTestUser({ role: "INVENTORY_MANAGER" });
  pendingSuperAdminId = await createTestUser({ role: "SUPER_ADMIN", approvalStatus: "PENDING" });
});

after(async () => {
  await removeTestUsersByPrefix();
  if (originalAuthSource === undefined) delete process.env.AUTH_SOURCE;
  else process.env.AUTH_SOURCE = originalAuthSource;
  await pgClient.end({ timeout: 5 });
});

describe("setDeveloperFlag", () => {
  test("🔴 1. 최고관리자가 A/S 엔지니어의 표시를 켠다 — is_developer = true, 감사 한 줄", async () => {
    const targetId = await createTestUser();
    const result = await setDeveloperFlag(targetId, true, superAdminId);
    assert.equal(result.ok, true, `켜기 실패: ${JSON.stringify(result)}`);
    assert.equal(await isDeveloperOf(targetId), true);

    const rows = await auditRowsFor(superAdminId, targetId);
    assert.equal(rows.length, 1, "감사 기록이 정확히 한 줄이어야 한다");
    assert.equal(rows[0].actionType, "UPDATE");
    assert.equal(rows[0].targetEntity, "users");
    assert.equal(rows[0].targetRecordId, targetId);
    assert.equal(rows[0].actorUserId, superAdminId);
    assert.deepEqual(rows[0].previousValue, { isDeveloper: false });
    assert.deepEqual(rows[0].newValue, { isDeveloper: true });
  });

  test("🔴 2. 개발자 표시가 켜진 A/S 엔지니어는 다른 사람의 표시를 켤 수 없다 — FORBIDDEN (「동급」의 유일한 예외)", async () => {
    // 이 사람은 승격 창구로는 최고관리자다 — 다른 자리에서는 전부 통과한다.
    const developer = await resolveActingUserForSession(sessionFor(developerEngineerId));
    assert.ok(developer, "세션 관문에서 개발자 엔지니어를 얻지 못했다");
    assert.equal(developer.isDeveloper, true);
    assert.equal(developer.role, "AS_ENGINEER");
    assert.equal(
      actorMay(developer, (role) => role === DEVELOPER_PROMOTED_ROLE),
      true,
      "승격 창구가 개발자를 최고관리자로 보지 않는다 — 이 시험의 전제가 사라졌다"
    );
    assert.equal(
      await hasPermission(developer, "users.shipmentRepresentatives", "MANAGE"),
      true,
      "대표 지정 판정은 개발자를 통과시켜야 한다(대조 기준)"
    );
    // 그런데 이 판정만은 아니다.
    assert.equal(mayManageDeveloperFlag(developer), false);

    const targetId = await createTestUser();
    const turnOn = await setDeveloperFlag(targetId, true, developerEngineerId);
    assert.equal(turnOn.ok, false, "개발자가 개발자를 만들었다");
    assert.equal(turnOn.ok === false ? turnOn.code : null, "FORBIDDEN");
    assert.equal(await isDeveloperOf(targetId), false);

    // 끄는 쪽도 같다 — 남의 표시를 걷는 것도 최고관리자의 일이다.
    const flaggedId = await createTestUser({ isDeveloper: true });
    const turnOff = await setDeveloperFlag(flaggedId, false, developerEngineerId);
    assert.equal(turnOff.ok === false ? turnOff.code : null, "FORBIDDEN");
    assert.equal(await isDeveloperOf(flaggedId), true);

    // 자기 자신의 표시를 끄는 것도 안 된다 — 이 판정에는 「본인」 예외가 없다.
    const self = await setDeveloperFlag(developerEngineerId, false, developerEngineerId);
    assert.equal(self.ok === false ? self.code : null, "FORBIDDEN");
    assert.equal(await isDeveloperOf(developerEngineerId), true);

    // 거절은 감사 기록을 남기지 않는다.
    assert.equal(await auditCountBy(developerEngineerId), 0);
  });

  test("3. 관리자·영업 담당자·재고 담당자는 FORBIDDEN — 진짜 최고관리자만", async () => {
    const targetId = await createTestUser();
    for (const actorId of [adminId, salesId, inventoryManagerId]) {
      const result = await setDeveloperFlag(targetId, true, actorId);
      assert.equal(result.ok, false);
      assert.equal(result.ok === false ? result.code : null, "FORBIDDEN");
      assert.equal(await auditCountBy(actorId), 0);
    }
    assert.equal(await isDeveloperOf(targetId), false);
  });

  test("4. 승인 안 된 최고관리자는 FORBIDDEN — 승인 검사", async () => {
    const targetId = await createTestUser();
    const result = await setDeveloperFlag(targetId, true, pendingSuperAdminId);
    assert.equal(result.ok === false ? result.code : null, "FORBIDDEN");
    assert.equal(await isDeveloperOf(targetId), false);
    assert.equal(await auditCountBy(pendingSuperAdminId), 0);
  });

  test("4b. 없는 행위자·삭제된 행위자는 FORBIDDEN", async () => {
    const targetId = await createTestUser();
    const missingActor = await setDeveloperFlag(targetId, true, randomUUID());
    assert.equal(missingActor.ok === false ? missingActor.code : null, "FORBIDDEN");

    const deletedSuperAdminId = await createTestUser({ role: "SUPER_ADMIN", isDeleted: true, deletedAt: new Date() });
    const deletedActor = await setDeveloperFlag(targetId, true, deletedSuperAdminId);
    assert.equal(deletedActor.ok === false ? deletedActor.code : null, "FORBIDDEN");
    assert.equal(await isDeveloperOf(targetId), false);
  });

  test("5. 이미 같은 값이면 CONFLICT — 켜기·끄기 양쪽, 감사도 더 남지 않는다", async () => {
    const targetId = await createTestUser();
    const offAgain = await setDeveloperFlag(targetId, false, superAdminId);
    assert.equal(offAgain.ok === false ? offAgain.code : null, "CONFLICT");

    assert.equal((await setDeveloperFlag(targetId, true, superAdminId)).ok, true);
    const onAgain = await setDeveloperFlag(targetId, true, superAdminId);
    assert.equal(onAgain.ok === false ? onAgain.code : null, "CONFLICT");

    assert.equal(await isDeveloperOf(targetId), true);
    assert.equal((await auditRowsFor(superAdminId, targetId)).length, 1);
  });

  test("6. 승인 안 됨·비활성·잠긴 대상은 켤 수 없다(INVALID_USER) — 끄는 것은 된다", async () => {
    const ineligible: { label: string; overrides: Partial<typeof users.$inferInsert> }[] = [
      { label: "승인 대기", overrides: { approvalStatus: "PENDING" } },
      { label: "비활성", overrides: { isActive: false } },
      { label: "잠김", overrides: { lockedAt: new Date() } },
    ];
    for (const { label, overrides } of ineligible) {
      const targetId = await createTestUser(overrides);
      const result = await setDeveloperFlag(targetId, true, superAdminId);
      assert.equal(result.ok === false ? result.code : null, "INVALID_USER", `${label}: 켜기가 거절되지 않았다`);
      assert.equal(await isDeveloperOf(targetId), false, `${label}: 거절됐는데 칸이 바뀌었다`);
      assert.equal((await auditRowsFor(superAdminId, targetId)).length, 0, `${label}: 거절됐는데 감사가 남았다`);

      // 같은 조건의 계정이라도 이미 켜져 있으면 끌 수 있다 — 승격을 걷는 길은 막히지 않는다.
      const flaggedId = await createTestUser({ ...overrides, isDeveloper: true });
      const turnOff = await setDeveloperFlag(flaggedId, false, superAdminId);
      assert.equal(turnOff.ok, true, `${label}: 끄기가 거절됐다: ${JSON.stringify(turnOff)}`);
      assert.equal(await isDeveloperOf(flaggedId), false);
      const rows = await auditRowsFor(superAdminId, flaggedId);
      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0].previousValue, { isDeveloper: true });
      assert.deepEqual(rows[0].newValue, { isDeveloper: false });
    }
  });

  test("7. 없는 대상·삭제된 대상은 NOT_FOUND", async () => {
    const missing = await setDeveloperFlag(randomUUID(), true, superAdminId);
    assert.equal(missing.ok === false ? missing.code : null, "NOT_FOUND");

    const deletedId = await createTestUser({ isDeleted: true, deletedAt: new Date() });
    const deleted = await setDeveloperFlag(deletedId, true, superAdminId);
    assert.equal(deleted.ok === false ? deleted.code : null, "NOT_FOUND");
    assert.equal(await isDeveloperOf(deletedId), false);

    // 삭제된 행은 켜져 있어도 없는 것으로 다룬다(형제와 같다) — 세션 관문이 삭제된
    // 계정을 걸러내므로 그 표시가 효과를 낼 길은 없다.
    const deletedFlaggedId = await createTestUser({ isDeleted: true, deletedAt: new Date(), isDeveloper: true });
    const deletedOff = await setDeveloperFlag(deletedFlaggedId, false, superAdminId);
    assert.equal(deletedOff.ok === false ? deletedOff.code : null, "NOT_FOUND");
  });

  test("8. 거절되면 아무것도 안 바뀌고 감사도 안 남는다 — 트랜잭션째 되돌아간다", async () => {
    const auditBefore = await auditCountBy(superAdminId);
    const targetId = await createTestUser({ isActive: false });
    const updatedAtBefore = await updatedAtOf(targetId);

    // 관문은 지났지만 대상 자격에서 막히는 경우 → INVALID_USER
    assert.equal((await setDeveloperFlag(targetId, true, superAdminId)).ok, false);
    // 없는 대상 → NOT_FOUND
    assert.equal((await setDeveloperFlag(randomUUID(), true, superAdminId)).ok, false);
    // 같은 값 → CONFLICT
    assert.equal((await setDeveloperFlag(targetId, false, superAdminId)).ok, false);

    assert.equal(await isDeveloperOf(targetId), false);
    assert.equal(await updatedAtOf(targetId), updatedAtBefore, "거절됐는데 updated_at 이 움직였다");
    assert.equal(await auditCountBy(superAdminId), auditBefore, "거절된 호출이 감사 기록을 남겼다");

    // 관문에서 막힌 행위자들은 한 줄도 남기지 않았다(2·3·4 의 합).
    for (const actorId of [developerEngineerId, adminId, salesId, inventoryManagerId, pendingSuperAdminId]) {
      assert.equal(await auditCountBy(actorId), 0, `거절된 행위자 ${actorId} 가 감사 기록을 남겼다`);
    }
  });

  test("🔴 9. 켠 직후 resolveActingUserForSession 이 isDeveloper: true 를 돌려준다 — 다음 요청부터 적용된다", async () => {
    const targetId = await createTestUser();
    const beforeOn = await resolveActingUserForSession(sessionFor(targetId));
    assert.ok(beforeOn);
    assert.equal(beforeOn.isDeveloper, false);
    assert.equal(actorMay(beforeOn, (role) => role === DEVELOPER_PROMOTED_ROLE), false);

    assert.equal((await setDeveloperFlag(targetId, true, superAdminId)).ok, true);
    const afterOn = await resolveActingUserForSession(sessionFor(targetId));
    assert.ok(afterOn, "켠 뒤 세션 관문이 계정을 잃었다");
    assert.equal(afterOn.isDeveloper, true, "켠 뒤에도 관문이 예전 값을 돌려준다");
    assert.equal(afterOn.role, "AS_ENGINEER", "표시를 켰더니 역할이 바뀌었다");
    // 이제 이 사람은 승격 창구를 통과한다 — 다음 요청부터 권한이 달라지는 근거다.
    assert.equal(actorMay(afterOn, (role) => role === DEVELOPER_PROMOTED_ROLE), true);
    assert.equal(await hasPermission(afterOn, "users.shipmentRepresentatives", "MANAGE"), true);
    // 그래도 개발자 표시는 여전히 못 켠다 — 승격이 이 판정에는 닿지 않는다.
    assert.equal(mayManageDeveloperFlag(afterOn), false);

    assert.equal((await setDeveloperFlag(targetId, false, superAdminId)).ok, true);
    const afterOff = await resolveActingUserForSession(sessionFor(targetId));
    assert.ok(afterOff);
    assert.equal(afterOff.isDeveloper, false, "끈 뒤에도 관문이 승격을 돌려준다");
    assert.equal(actorMay(afterOff, (role) => role === DEVELOPER_PROMOTED_ROLE), false);
  });

  test("10. 감사 기록의 모양 — 켜고 끈 두 줄, 각각 이전·이후 값이 맞다", async () => {
    const targetId = await createTestUser();
    assert.equal((await setDeveloperFlag(targetId, true, superAdminId)).ok, true);
    assert.equal((await setDeveloperFlag(targetId, false, superAdminId)).ok, true);

    const rows = await auditRowsFor(superAdminId, targetId);
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.actorUserId, superAdminId);
      assert.equal(row.actionType, "UPDATE");
      assert.equal(row.targetEntity, "users");
      assert.equal(row.targetRecordId, targetId);
    }
    const turnedOn = rows.find((row) => newIsDeveloperOf(row) === true);
    const turnedOff = rows.find((row) => newIsDeveloperOf(row) === false);
    assert.ok(turnedOn, "켠 기록이 없다");
    assert.ok(turnedOff, "끈 기록이 없다");
    assert.deepEqual(turnedOn.previousValue, { isDeveloper: false });
    assert.deepEqual(turnedOn.newValue, { isDeveloper: true });
    assert.deepEqual(turnedOff.previousValue, { isDeveloper: true });
    assert.deepEqual(turnedOff.newValue, { isDeveloper: false });
  });

  test("11. 같은 사람에게 동시에 두 번 켜면 정확히 하나만 성공한다", async () => {
    const targetId = await createTestUser();
    const [a, b] = await Promise.all([
      setDeveloperFlag(targetId, true, superAdminId),
      setDeveloperFlag(targetId, true, superAdminId),
    ]);
    const successes = [a, b].filter((result) => result.ok);
    const conflicts = [a, b].filter((result) => !result.ok && result.code === "CONFLICT");
    assert.equal(successes.length, 1, "정확히 하나만 성공해야 한다");
    assert.equal(conflicts.length, 1, "나머지는 CONFLICT 여야 한다");
    assert.equal(await isDeveloperOf(targetId), true);
    assert.equal((await auditRowsFor(superAdminId, targetId)).length, 1, "감사 기록도 한 줄뿐이어야 한다");
  });

  test("12. 최고관리자는 자기 자신의 표시도 켜고 끈다 — 본인 특별 취급이 없다", async () => {
    const selfAdminId = await createTestUser({ role: "SUPER_ADMIN" });
    assert.equal((await setDeveloperFlag(selfAdminId, true, selfAdminId)).ok, true);
    assert.equal(await isDeveloperOf(selfAdminId), true);
    // 켜진 뒤에도 여전히 진짜 최고관리자다 — 진짜 역할로 통과하므로 자기 표시를 다시 끌 수 있다.
    assert.equal((await setDeveloperFlag(selfAdminId, false, selfAdminId)).ok, true);
    assert.equal(await isDeveloperOf(selfAdminId), false);
  });

  test("개발자로 표시된 계정은 이 파일이 만든 것뿐이다 — 시험이 다른 계정을 승격하지 않았다", async () => {
    const flagged = await db.select({ id: users.id }).from(users).where(eq(users.isDeveloper, true));
    for (const row of flagged) {
      assert.ok(createdTestUserIds.includes(row.id), `이 파일이 만들지 않은 계정에 개발자 표시가 켜져 있다: ${row.id}`);
    }
  });
});
