import "../../../scripts/load-env";

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, ne, or } from "drizzle-orm";
import { db, pgClient } from "@/lib/db/connection";
import { auditLogs, users } from "@/lib/db/schema";
import { restoreDeletedSsoUser } from "@/lib/db/queries/users";
import type { Role } from "@/lib/domain/types";
import { resolveDbLogin } from "./db-login";
import { resolveSsoLogin } from "./sso-login";

/**
 * ============================================================================
 * 포털 로그인으로 삭제 계정 되살리기 — resolveSsoLogin 실DB 시험
 * ============================================================================
 * 사용자 결정(2026-09-13): 이 시스템의 삭제는 「목록에서 치우고 일을 넘기는 것」이고
 * 진짜 차단은 포털 권한 회수다. 그래서 같은 sso_subject 로 포털 로그인하면 계정이
 * 되살아난다. 이메일 로그인으로는 되살리지 않는다.
 *
 * 확인하는 것:
 *  1. 삭제된 SSO 계정 → 세션 · 삭제 네 칸 비움 · 이메일과 subject 그대로 · RESTORE
 *     감사 1행(이메일 · 이름 없음) · 포털 역할 반영.
 *  2. 같은 subject 로 동시에 두 번 → 둘 다 세션, RESTORE 감사는 정확히 1행.
 *     되살리기 함수 자체를 동시에 두 번 불러도 행은 하나만 받는다.
 *  3. 삭제 + 잠김 → 되살아난 뒤 ACCOUNT_LOCKED(승인된 판단).
 *  4. 삭제 + 비활성 → 되살아난 뒤 ACCOUNT_DISABLED.
 *  5. 삭제되지 않은 계정 → 감사 행 없음, 결과는 전과 같다.
 *  6. 삭제된 계정의 이메일 로그인 → 여전히 거절, 되살아나지 않는다.
 *     (db-login.integration.test.ts 에는 삭제 계정 경우가 없어 여기서 잡는다.)
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 스위트가 만드는 사람은 이메일이 "sso-restore-test-" 로 시작한다. after() 는
 * 그 사람들을 가리키는 감사 행을 먼저 지우고(audit_logs.actor_user_id 가 RESTRICT 라
 * 지우지 않으면 사람을 지울 수 없다 — customers-trash 시험과 같은 처리) 사람을 지운다.
 * 삭제자(deleted_by)로 쓰는 사람은 맨 나중에 지운다(deleted_by 도 RESTRICT).
 * 앞선 실행이 중간에 끊겨 남은 행도 접두사로 함께 치운다.
 * ============================================================================
 */

const PREFIX = "sso-restore-test-";
const DELETE_REASON = "퇴사 — 시험";

let deleterId: string;

type Seeded = { id: string; version: number; subject: string; email: string; name: string };

async function seedSsoUser(options: {
  deleted?: boolean;
  locked?: boolean;
  active?: boolean;
  role?: Role;
}): Promise<Seeded & { deletedAt: Date | null }> {
  const tag = randomUUID().slice(0, 8);
  const subject = `${PREFIX}${randomUUID()}`;
  const email = `${PREFIX}${tag}@example.test`;
  const name = `SSO복원시험${tag}`;
  const deletedAt = options.deleted ? new Date(Date.now() - 60_000) : null;
  const [row] = await db
    .insert(users)
    .values({
      email,
      name,
      role: options.role ?? "AS_ENGINEER",
      approvalStatus: "APPROVED",
      isActive: options.active ?? true,
      lockedAt: options.locked ? new Date() : null,
      ssoSubject: subject,
      ssoLinkedAt: new Date(),
      isDeleted: options.deleted ?? false,
      deletedAt,
      deletedBy: options.deleted ? deleterId : null,
      deleteReason: options.deleted ? DELETE_REASON : null,
    })
    .returning({ id: users.id, version: users.version });
  return { id: row.id, version: row.version, subject, email, name, deletedAt };
}

async function readUser(id: string) {
  const [row] = await db
    .select({
      email: users.email,
      ssoSubject: users.ssoSubject,
      role: users.role,
      isActive: users.isActive,
      lockedAt: users.lockedAt,
      version: users.version,
      isDeleted: users.isDeleted,
      deletedAt: users.deletedAt,
      deletedBy: users.deletedBy,
      deleteReason: users.deleteReason,
    })
    .from(users)
    .where(eq(users.id, id));
  assert.ok(row, "시험 사람 행이 있어야 한다");
  return row;
}

async function auditRowsFor(userId: string) {
  return db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.targetEntity, "users"), eq(auditLogs.targetRecordId, userId)));
}

async function countBySubject(subject: string): Promise<number> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.ssoSubject, subject));
  return rows.length;
}

before(async () => {
  const [deleter] = await db
    .insert(users)
    .values({
      email: `${PREFIX}deleter-${randomUUID().slice(0, 8)}@example.test`,
      name: "SSO복원시험 삭제자",
      role: "SUPER_ADMIN",
      approvalStatus: "APPROVED",
      isActive: true,
    })
    .returning({ id: users.id });
  deleterId = deleter.id;
});

after(async () => {
  const fixtures = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${PREFIX}%`));
  const ids = fixtures.map((row) => row.id);
  if (ids.length > 0) {
    await db
      .delete(auditLogs)
      .where(
        or(
          inArray(auditLogs.actorUserId, ids),
          and(eq(auditLogs.targetEntity, "users"), inArray(auditLogs.targetRecordId, ids))
        )
      );
    // 삭제자를 가리키는 deleted_by 가 먼저 사라지도록 삭제자는 맨 나중이다.
    await db.delete(users).where(and(like(users.email, `${PREFIX}%`), ne(users.id, deleterId)));
    await db.delete(users).where(like(users.email, `${PREFIX}%`));
  }
  await pgClient.end({ timeout: 5 });
});

test("삭제된 SSO 계정으로 포털 로그인하면 같은 계정이 되살아나고 세션이 나온다", async () => {
  const seeded = await seedSsoUser({ deleted: true, role: "AS_ENGINEER" });

  const result = await resolveSsoLogin(seeded.subject, {
    role: "SALES",
    email: seeded.email,
    name: seeded.name,
  });

  assert.equal(result.outcome, "SESSION", `세션이 나와야 한다: ${JSON.stringify(result)}`);
  if (result.outcome !== "SESSION") return;
  assert.equal(result.user.id, seeded.id, "새 계정이 아니라 같은 계정이어야 한다");
  assert.equal(result.user.role, "SALES", "포털이 준 역할이 세션에 실려야 한다");
  assert.equal(result.user.approvalStatus, "APPROVED");

  const row = await readUser(seeded.id);
  assert.equal(row.isDeleted, false);
  assert.equal(row.deletedAt, null);
  assert.equal(row.deletedBy, null);
  assert.equal(row.deleteReason, null);
  assert.equal(row.email, seeded.email, "이메일은 바뀌지 않는다");
  assert.equal(row.ssoSubject, seeded.subject, "sso_subject 는 바뀌지 않는다");
  assert.equal(row.role, "SALES", "포털이 준 역할이 계정에 반영된다");
  assert.equal(row.version, seeded.version + 1, "되살리기가 version 을 올린다");
  assert.equal(await countBySubject(seeded.subject), 1, "같은 subject 의 새 계정이 생기면 안 된다");

  const logs = await auditRowsFor(seeded.id);
  assert.equal(logs.length, 1, "감사 행은 RESTORE 하나뿐이어야 한다");
  const [log] = logs;
  assert.equal(log.actionType, "RESTORE");
  assert.equal(log.actorUserId, seeded.id, "행위자는 되살아난 본인이다");
  assert.deepEqual(log.previousValue, {
    isDeleted: true,
    deletedAt: seeded.deletedAt?.toISOString(),
    deletedBy: deleterId,
    deleteReason: DELETE_REASON,
  });
  assert.deepEqual(log.newValue, { isDeleted: false, via: "SSO_LOGIN" });

  const serialized = JSON.stringify([log.previousValue, log.newValue]);
  assert.ok(!serialized.includes(seeded.email), "감사 로그에 이메일이 실리면 안 된다");
  assert.ok(!serialized.includes(seeded.name), "감사 로그에 이름이 실리면 안 된다");
});

test("같은 subject 로 동시에 두 번 로그인해도 둘 다 세션을 받고 RESTORE 감사는 정확히 1행이다", async () => {
  const seeded = await seedSsoUser({ deleted: true });
  const claims = { role: "AS_ENGINEER", email: seeded.email, name: seeded.name };

  const [first, second] = await Promise.all([
    resolveSsoLogin(seeded.subject, claims),
    resolveSsoLogin(seeded.subject, claims),
  ]);

  assert.equal(first.outcome, "SESSION", `첫째: ${JSON.stringify(first)}`);
  assert.equal(second.outcome, "SESSION", `둘째: ${JSON.stringify(second)}`);
  if (first.outcome !== "SESSION" || second.outcome !== "SESSION") return;
  assert.equal(first.user.id, seeded.id);
  assert.equal(second.user.id, seeded.id);

  const restores = (await auditRowsFor(seeded.id)).filter((log) => log.actionType === "RESTORE");
  assert.equal(restores.length, 1);
  assert.equal(await countBySubject(seeded.subject), 1);
  assert.equal((await readUser(seeded.id)).isDeleted, false);
});

test("되살리기 함수를 동시에 두 번 불러도 행은 하나만 받고 감사도 하나다", async () => {
  const seeded = await seedSsoUser({ deleted: true });

  const results = await Promise.all([
    restoreDeletedSsoUser(seeded.subject),
    restoreDeletedSsoUser(seeded.subject),
  ]);

  assert.equal(results.filter((row) => row !== null).length, 1, "행을 받는 쪽은 하나뿐이어야 한다");
  const restored = results.find((row) => row !== null);
  assert.equal(restored?.id, seeded.id);
  assert.equal((await auditRowsFor(seeded.id)).length, 1);
});

test("되살릴 삭제 행이 없으면 null — 모르는 subject도, 살아 있는 계정도", async () => {
  assert.equal(await restoreDeletedSsoUser(`${PREFIX}${randomUUID()}`), null);
  assert.equal(await restoreDeletedSsoUser(""), null);

  const alive = await seedSsoUser({});
  assert.equal(await restoreDeletedSsoUser(alive.subject), null);
  assert.equal((await readUser(alive.id)).version, alive.version, "살아 있는 계정은 건드리지 않는다");
  assert.equal((await auditRowsFor(alive.id)).length, 0);
});

test("삭제 + 잠김: 되살아난 뒤 ACCOUNT_LOCKED 로 거절된다", async () => {
  const seeded = await seedSsoUser({ deleted: true, locked: true });

  const result = await resolveSsoLogin(seeded.subject, { role: "AS_ENGINEER" });

  assert.equal(result.outcome, "REJECTED");
  if (result.outcome !== "REJECTED") return;
  assert.equal(result.code, "ACCOUNT_LOCKED");

  const row = await readUser(seeded.id);
  assert.equal(row.isDeleted, false, "되살아나는 것은 승인된 판단이다");
  assert.notEqual(row.lockedAt, null, "잠금은 그대로다");
  const restores = (await auditRowsFor(seeded.id)).filter((log) => log.actionType === "RESTORE");
  assert.equal(restores.length, 1);
});

test("삭제 + 비활성: 되살아난 뒤 ACCOUNT_DISABLED 로 거절된다", async () => {
  const seeded = await seedSsoUser({ deleted: true, active: false });

  const result = await resolveSsoLogin(seeded.subject, { role: "AS_ENGINEER" });

  assert.equal(result.outcome, "REJECTED");
  if (result.outcome !== "REJECTED") return;
  assert.equal(result.code, "ACCOUNT_DISABLED");

  const row = await readUser(seeded.id);
  assert.equal(row.isDeleted, false);
  assert.equal(row.isActive, false, "사용 중지는 그대로다");
  const restores = (await auditRowsFor(seeded.id)).filter((log) => log.actionType === "RESTORE");
  assert.equal(restores.length, 1);
});

test("삭제되지 않은 계정: 감사 행이 없고 결과는 전과 같다", async () => {
  const seeded = await seedSsoUser({ role: "AS_ENGINEER" });

  const result = await resolveSsoLogin(seeded.subject, {
    role: "SALES",
    email: seeded.email,
    name: seeded.name,
  });

  assert.equal(result.outcome, "SESSION", JSON.stringify(result));
  if (result.outcome !== "SESSION") return;
  assert.deepEqual(result.user, {
    id: seeded.id,
    role: "SALES",
    approvalStatus: "APPROVED",
    name: seeded.name,
  });
  assert.equal((await auditRowsFor(seeded.id)).length, 0, "되살리기가 돌지 않았으니 감사 행이 없다");
  const row = await readUser(seeded.id);
  assert.equal(row.isDeleted, false);
  assert.equal(row.role, "SALES");
});

test("삭제된 계정의 이메일 로그인은 여전히 거절되고 되살아나지 않는다", async () => {
  const seeded = await seedSsoUser({ deleted: true });

  const result = await resolveDbLogin(seeded.email);

  assert.equal(result.outcome, "REJECTED");
  if (result.outcome !== "REJECTED") return;
  assert.equal(result.code, "INVALID_CREDENTIALS");

  const row = await readUser(seeded.id);
  assert.equal(row.isDeleted, true, "이메일 로그인은 되살리지 않는다");
  assert.equal(row.deleteReason, DELETE_REASON);
  assert.equal((await auditRowsFor(seeded.id)).length, 0);
});
