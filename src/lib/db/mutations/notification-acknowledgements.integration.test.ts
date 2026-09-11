import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { auditLogs, notificationAcknowledgements, users } from "../schema";
import { acknowledgeNotification } from "./notification-acknowledgements";
import { listAcknowledgedNotificationKeys } from "../queries/notification-acknowledgements";

/**
 * ============================================================================
 * acknowledgeNotification() · listAcknowledgedNotificationKeys() — 실제 DB (시험 DB)
 * ============================================================================
 * 🔴 이 파일은 마이그레이션 0091(notification_acknowledgements 표)이 시험 DB 에
 * 적용된 뒤에야 돈다. 작성한 조각(2026-09-11)에서는 적용하지 않았으므로 돌리지
 * 않았다.
 *
 * 이 파일이 만든 "notifack-test-" 계정만 쓰고, after() 에서 그 계정을 지운다 —
 * 확인 기록은 user_id → users 가 CASCADE 라 계정과 함께 사라진다. 씨앗 계정은
 * 읽지 않는다.
 *
 * 여기서 지키려는 것:
 *  1. **두 번 눌러도 한 줄**이고, 두 번째도 성공이며 처음 확인한 시각이 그대로다.
 *     두 기기에서 동시에 눌러도 마찬가지다.
 *  2. 🔴 **남의 확인 기록이 섞이지 않는다** — 같은 키를 남이 확인했다고 내 알림이
 *     사라지면 안 된다.
 *  3. 조회는 **넘긴 키로만** 답한다(내가 확인한 다른 키가 끼지 않는다).
 *  4. 빈 키 목록은 **DB 를 부르지 않는다.**
 *  5. 형식이 틀린 키는 거절되고 행이 남지 않는다. 형식이 맞아도 할 일 알림의
 *     키(눌러서 확인하는 종류가 아닌 것)는 거절된다. 입구를 거치지 않고 표에 직접
 *     넣어도 CHECK(1~200자)가 막는다.
 *  6. 사용자 행이 지워지면 그 사람의 확인 기록도 함께 사라진다(CASCADE).
 *  7. 감사 로그를 남기지 않는다 — 업무 자료가 아니다.
 * ============================================================================
 */

const TEST_EMAIL_PREFIX = "notifack-test-";

let userAId: string;
let userBId: string;

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
  return row.id;
}

/** 시험마다 겹치지 않는 키. 형식은 실제 알림 id 와 같은 `종류:나머지` 다. */
function freshKey(kind = "APPROVAL_GRANTED"): string {
  return `${kind}:${randomUUID()}`;
}

async function rowsFor(userId: string) {
  return db
    .select({
      notificationKey: notificationAcknowledgements.notificationKey,
      acknowledgedAt: notificationAcknowledgements.acknowledgedAt,
    })
    .from(notificationAcknowledgements)
    .where(eq(notificationAcknowledgements.userId, userId));
}

/**
 * 이 파일의 계정을 지운다. 접두사로 고르므로 이전 실행이 중간에 끊겨 남은 것까지
 * 걷는다. 확인 기록은 CASCADE 로 함께 사라진다.
 */
async function removeTestUsersByPrefix(): Promise<void> {
  const leftovers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  const ids = leftovers.map((row) => row.id);
  if (ids.length === 0) return;
  // 이 파일의 mutation 은 감사 로그를 남기지 않는다(시험 7). 그래도 그 약속이 깨진
  // 실행이 남긴 행이 계정 삭제를 막지 않도록(audit_logs.actor_user_id → users 는
  // restrict) 행위자로만 좁혀 걷는다 — target_record_id 로 고르는 모양은
  // test-cleanup-static-safety.test.ts 가 금지한다.
  await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, ids));
  await db.delete(users).where(inArray(users.id, ids));
}

before(async () => {
  await removeTestUsersByPrefix();
  userAId = await createTestUser("알림확인 시험 A");
  userBId = await createTestUser("알림확인 시험 B");
});

after(async () => {
  await removeTestUsersByPrefix();
  await pgClient.end({ timeout: 5 });
});

describe("acknowledgeNotification / listAcknowledgedNotificationKeys", () => {
  test("1. 확인하면 한 줄이 생기고, 조회가 그 키를 돌려준다", async () => {
    const key = freshKey();
    const result = await acknowledgeNotification({ userId: userAId, notificationKey: key });

    assert.deepEqual(result, { ok: true, newlyAcknowledged: true });
    const acknowledged = await listAcknowledgedNotificationKeys(userAId, [key]);
    assert.deepEqual([...acknowledged], [key]);
  });

  test("🔴 2. 두 번 눌러도 한 줄이고 두 번째도 성공이다 — 처음 확인한 시각을 덮지 않는다", async () => {
    const key = freshKey();
    const first = await acknowledgeNotification({ userId: userAId, notificationKey: key });
    assert.deepEqual(first, { ok: true, newlyAcknowledged: true });
    const [firstRow] = (await rowsFor(userAId)).filter((row) => row.notificationKey === key);
    assert.ok(firstRow, "첫 확인이 적히지 않았다");

    const second = await acknowledgeNotification({ userId: userAId, notificationKey: key });
    assert.deepEqual(second, { ok: true, newlyAcknowledged: false }, "이미 확인한 것은 성공이어야 한다");

    const rows = (await rowsFor(userAId)).filter((row) => row.notificationKey === key);
    assert.equal(rows.length, 1, "같은 알림이 두 줄이 됐다");
    assert.equal(
      rows[0].acknowledgedAt.getTime(),
      firstRow.acknowledgedAt.getTime(),
      "두 번째 누름이 처음 확인한 시각을 덮었다"
    );
  });

  test("2b. 두 기기에서 동시에 눌러도 둘 다 성공하고 한 줄이다", async () => {
    const key = freshKey();
    const results = await Promise.all([
      acknowledgeNotification({ userId: userAId, notificationKey: key }),
      acknowledgeNotification({ userId: userAId, notificationKey: key }),
    ]);

    for (const result of results) assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(
      results.filter((result) => result.ok && result.newlyAcknowledged).length,
      1,
      "새로 적은 쪽은 정확히 하나여야 한다"
    );
    const rows = (await rowsFor(userAId)).filter((row) => row.notificationKey === key);
    assert.equal(rows.length, 1);
  });

  test("🔴 3. 남의 확인 기록이 섞이지 않는다 — 같은 키를 A 가 확인해도 B 에게는 확인 안 됨이다", async () => {
    const sharedKey = freshKey();
    await acknowledgeNotification({ userId: userAId, notificationKey: sharedKey });

    const forB = await listAcknowledgedNotificationKeys(userBId, [sharedKey]);
    assert.equal(forB.size, 0, "A 가 누른 기록 때문에 B 의 알림이 사라진다");

    const forA = await listAcknowledgedNotificationKeys(userAId, [sharedKey]);
    assert.deepEqual([...forA], [sharedKey]);

    // B 가 따로 누르면 B 의 줄이 따로 생긴다 — 유니크는 (사람, 키) 짝이다.
    const byB = await acknowledgeNotification({ userId: userBId, notificationKey: sharedKey });
    assert.deepEqual(byB, { ok: true, newlyAcknowledged: true });
    assert.deepEqual([...(await listAcknowledgedNotificationKeys(userBId, [sharedKey]))], [sharedKey]);
  });

  test("4. 조회는 넘긴 키로만 답한다 — 확인한 다른 키도, 확인 안 한 키도 끼지 않는다", async () => {
    const askedAndAcked = freshKey();
    const askedNotAcked = freshKey();
    const ackedNotAsked = freshKey();
    await acknowledgeNotification({ userId: userAId, notificationKey: askedAndAcked });
    await acknowledgeNotification({ userId: userAId, notificationKey: ackedNotAsked });

    const result = await listAcknowledgedNotificationKeys(userAId, [
      askedAndAcked,
      askedNotAcked,
      askedAndAcked, // 같은 키가 두 번 와도 된다
    ]);
    assert.deepEqual([...result].sort(), [askedAndAcked]);
  });

  test("🔴 5. 빈 키 목록은 DB 를 부르지 않는다", async () => {
    // uuid 가 아닌 사용자 id 로 DB 를 부르면 Postgres 가 22P02 로 던진다. 빈 목록에서
    // 던지지 않고 빈 Set 이 나오면 조회가 DB 까지 가지 않았다는 뜻이다.
    const result = await listAcknowledgedNotificationKeys("not-a-uuid", []);
    assert.equal(result.size, 0);

    // 대조군 — 키가 하나라도 있으면 실제로 DB 를 부르고, 그래서 던진다. 이것이
    // 던지지 않으면 위의 확인은 아무것도 증명하지 못한다.
    await assert.rejects(
      () => listAcknowledgedNotificationKeys("not-a-uuid", [freshKey()]),
      (err: unknown) => {
        const cause = (err as { cause?: { code?: string } }).cause;
        assert.equal(cause?.code, "22P02", "DB 가 uuid 형식 오류로 던진 것이 아니다");
        return true;
      }
    );
  });

  test("6. 형식이 틀린 키는 거절되고 행이 남지 않는다", async () => {
    const before = (await rowsFor(userAId)).length;
    const badKeys = [
      "",
      "no-colon",
      "lowercase:abc",
      "APPROVAL_GRANTED:",
      " APPROVAL_GRANTED:abc",
      "APPROVAL_GRANTED:한글",
      "APPROVAL_GRANTED:%",
      `APPROVAL_GRANTED:${"a".repeat(200)}`,
    ];
    for (const notificationKey of badKeys) {
      const result = await acknowledgeNotification({ userId: userAId, notificationKey });
      assert.equal(result.ok, false, `통과했다: ${JSON.stringify(notificationKey)}`);
      if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
    }
    assert.equal((await rowsFor(userAId)).length, before, "거절됐는데 행이 남았다");
  });

  test("🔴 6a. 형식이 맞아도 할 일 알림의 키는 거절되고 행이 남지 않는다 — 확인으로 숨기는 길이 없다", async () => {
    const before = (await rowsFor(userAId)).length;
    const todoKeys = [
      `REPAIR_CASE_APPROVAL:${randomUUID()}:FINAL_SHIPMENT`,
      `PART_REQUEST_PENDING:${randomUUID()}`,
      `PART_STOCK_BELOW_MINIMUM:${randomUUID()}:DSS`,
      `CUSTOMER_REPAIR_REQUEST_NEW:${randomUUID()}`,
      `PART_ISSUE_APPROVAL_PENDING:${randomUUID()}`,
      `SOME_FUTURE_KIND:${randomUUID()}`,
    ];
    for (const notificationKey of todoKeys) {
      const result = await acknowledgeNotification({ userId: userAId, notificationKey });
      assert.equal(result.ok, false, `통과했다: ${notificationKey}`);
      if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
    }
    assert.equal((await rowsFor(userAId)).length, before, "거절됐는데 행이 남았다");

    // 대조 — 눌러서 확인하는 두 종류의 키는 통과한다.
    for (const kind of ["APPROVAL_GRANTED", "APPROVAL_REJECTED"]) {
      const result = await acknowledgeNotification({ userId: userAId, notificationKey: freshKey(kind) });
      assert.deepEqual(result, { ok: true, newlyAcknowledged: true }, kind);
    }
  });

  test("6b. 입구를 거치지 않고 표에 직접 넣어도 CHECK 가 1~200자를 지킨다", async () => {
    for (const notificationKey of ["", "A".repeat(201)]) {
      await assert.rejects(
        () => db.insert(notificationAcknowledgements).values({ userId: userAId, notificationKey }),
        // Drizzle 이 "Failed query: ..." 로 한 겹 감싸므로 코드와 제약 이름은 cause 에
        // 있다(attachments.integration.test.ts 와 같은 확인). 겉 message 만 보면 어떤
        // 오류든 통과해 버린다.
        (err: unknown) => {
          const cause = (err as { cause?: unknown }).cause;
          assert.ok(cause instanceof Error, "PostgresError 가 cause 로 실려 있어야 한다");
          assert.equal((cause as { code?: string }).code, "23514", "CHECK 위반(23514)이 아니다");
          assert.match(cause.message, /notification_acknowledgements_key_length/);
          return true;
        }
      );
    }
    // 200자는 들어간다 — 상한이 한 글자 어긋나지 않았다.
    const exact = "A".repeat(200);
    await db.insert(notificationAcknowledgements).values({ userId: userAId, notificationKey: exact });
    assert.equal((await rowsFor(userAId)).filter((row) => row.notificationKey === exact).length, 1);
  });

  test("7. 감사 로그를 남기지 않는다 — 업무 자료가 아니다", async () => {
    const auditRows = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(inArray(auditLogs.actorUserId, [userAId, userBId]));
    assert.equal(auditRows.length, 0, "알림 확인이 감사 기록을 남겼다");
  });

  test("🔴 8. 사용자 행이 지워지면 그 사람의 확인 기록도 함께 사라진다(CASCADE)", async () => {
    const doomedId = await createTestUser("알림확인 시험 삭제 대상");
    const keys = [freshKey(), freshKey()];
    for (const notificationKey of keys) {
      await acknowledgeNotification({ userId: doomedId, notificationKey });
    }
    assert.equal((await rowsFor(doomedId)).length, 2);

    // RESTRICT 였다면 여기서 23503 으로 막힌다.
    await db.delete(users).where(eq(users.id, doomedId));

    assert.equal((await rowsFor(doomedId)).length, 0, "사람이 지워졌는데 확인 기록이 남았다");
    // 남의 기록은 그대로다.
    assert.ok((await rowsFor(userAId)).length > 0, "다른 사람의 확인 기록까지 사라졌다");
  });
});
