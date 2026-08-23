import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { auditLogs, parts, partStockBalances, stockTransactions, users } from "../schema";
import { receiveStock, softDeletePart, restorePart, permanentlyDeletePart } from "./inventory";
import { listPurgeEligiblePartIds, purgeExpiredPart, runMasterDataPurgeSweep } from "./master-data-purge";
import { MASTER_DATA_TRASH_RETENTION_DAYS } from "@/lib/domain/master-data-trash-retention";

/**
 * 부품 휴지통 — 실제 DB 통합 테스트.
 *
 * 고객사·제품 모델 쪽 통합 테스트와 확인하는 약속은 같다(무엇이 삭제를
 * 막는가, 복원이 무엇을 되살리는가, 만료된 것만 자동으로 지워지는가). 다른
 * 점은 이 모듈의 규약이다 — 권한을 트랜잭션 안에서 다시 보므로 **행위자가
 * 실제로 관리자여야** 하고, 낙관적 동시성은 updated_at이 아니라
 * parts.version으로 본다.
 *
 * 이 파일만의 이름 접두사를 쓰고 만든 것만 지운다. 15일은 deleted_at을 직접
 * 과거로 돌려 대신한다.
 */

const RUN_TOKEN = randomUUID();
const TEST_PART_PREFIX = `test-part-trash-${RUN_TOKEN}-`;
const TEST_LOCATION = "TEST-TRASH-SHELF";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

let adminId: string;
let inventoryManagerId: string;

const touchedRecordIds: string[] = [];

before(async () => {
  const [admin] = await db
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
  assert.ok(admin, "expected an approved ADMIN in the test DB");
  adminId = admin.id;

  const [manager] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "INVENTORY_MANAGER"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false),
        eq(users.isActive, true)
      )
    )
    .limit(1);
  assert.ok(manager, "expected an approved INVENTORY_MANAGER in the test DB");
  inventoryManagerId = manager.id;
});

after(async () => {
  if (touchedRecordIds.length > 0) {
    await db.delete(auditLogs).where(inArray(auditLogs.targetRecordId, touchedRecordIds));
  }
  const leftovers = await db
    .select({ id: parts.id })
    .from(parts)
    .where(like(parts.partName, `${TEST_PART_PREFIX}%`));
  const leftoverIds = leftovers.map((row) => row.id);
  if (leftoverIds.length > 0) {
    const balances = await db
      .select({ id: partStockBalances.id })
      .from(partStockBalances)
      .where(inArray(partStockBalances.partId, leftoverIds));
    const balanceIds = balances.map((row) => row.id);
    if (balanceIds.length > 0) {
      await db.delete(stockTransactions).where(inArray(stockTransactions.partStockBalanceId, balanceIds));
      await db.delete(partStockBalances).where(inArray(partStockBalances.id, balanceIds));
    }
    await db.delete(parts).where(inArray(parts.id, leftoverIds));
  }
  await pgClient.end({ timeout: 5 });
});

async function createTestPart(suffix: string) {
  const [row] = await db
    .insert(parts)
    .values({ partName: `${TEST_PART_PREFIX}${suffix}`, category: "TEST" })
    .returning();
  touchedRecordIds.push(row.id);
  return row;
}

async function readPart(id: string) {
  const [row] = await db.select().from(parts).where(eq(parts.id, id));
  return row;
}

/** deleted_at을 N일 과거로 돌린다 — 15일을 실제로 기다리는 대신. */
async function backdateDeletion(partId: string, days: number) {
  await db
    .update(parts)
    .set({ deletedAt: new Date(Date.now() - days * MS_PER_DAY) })
    .where(eq(parts.id, partId));
}

describe("softDeletePart", () => {
  test("이력이 없는 부품은 휴지통으로 가고 감사 로그가 남는다", async () => {
    const part = await createTestPart("PLAIN");

    const result = await softDeletePart({
      partId: part.id,
      actorUserId: adminId,
      expectedVersion: part.version,
      reason: "테스트 삭제",
    });
    assert.equal(result.ok, true, `soft delete failed: ${JSON.stringify(result)}`);

    const deleted = await readPart(part.id);
    assert.equal(deleted.isDeleted, true);
    assert.equal(deleted.deletedBy, adminId);
    assert.equal(deleted.deleteReason, "테스트 삭제");
    assert.ok(deleted.deletedAt);
    assert.equal(deleted.version, part.version + 1, "version이 올라가야 다음 조작이 최신 값을 요구한다");

    const [log] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetRecordId, part.id), eq(auditLogs.actionType, "SOFT_DELETE")));
    assert.ok(log, "expected a SOFT_DELETE audit row");
    assert.equal(log.actorUserId, adminId);
  });

  test("입출고 이력이 있으면 막고 아무것도 바꾸지 않는다", async () => {
    const part = await createTestPart("WITH-HISTORY");
    const received = await receiveStock({
      partId: part.id,
      owner: "DSS",
      location: TEST_LOCATION,
      quantity: 3,
      actorUserId: adminId,
    });
    assert.equal(received.ok, true, `receiveStock failed: ${JSON.stringify(received)}`);

    const refreshed = await readPart(part.id);
    const result = await softDeletePart({
      partId: part.id,
      actorUserId: adminId,
      expectedVersion: refreshed.version,
      reason: null,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "INVALID_INPUT");
    assert.match(result.message, /입출고 이력/);

    assert.equal((await readPart(part.id)).isDeleted, false, "막혔으면 그대로여야 한다");
  });

  test("재고 담당자는 부품을 지울 수 없다 — 등록·수정은 되지만 삭제는 관리자 이상이다", async () => {
    const part = await createTestPart("MANAGER-FORBIDDEN");
    const result = await softDeletePart({
      partId: part.id,
      actorUserId: inventoryManagerId,
      expectedVersion: part.version,
      reason: null,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "FORBIDDEN");
    assert.equal((await readPart(part.id)).isDeleted, false);
  });

  test("version이 어긋나면 CONFLICT", async () => {
    const part = await createTestPart("CONFLICT");
    const result = await softDeletePart({
      partId: part.id,
      actorUserId: adminId,
      expectedVersion: part.version + 99,
      reason: null,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "CONFLICT");
  });
});

describe("restorePart", () => {
  test("휴지통의 부품이 되살아난다", async () => {
    const part = await createTestPart("RESTORE");
    const deleted = await softDeletePart({
      partId: part.id,
      actorUserId: adminId,
      expectedVersion: part.version,
      reason: null,
    });
    assert.equal(deleted.ok, true);
    if (!deleted.ok) return;

    const restored = await restorePart({
      partId: part.id,
      actorUserId: adminId,
      expectedVersion: deleted.version,
    });
    assert.equal(restored.ok, true, `restore failed: ${JSON.stringify(restored)}`);

    const back = await readPart(part.id);
    assert.equal(back.isDeleted, false);
    assert.equal(back.deletedAt, null);
    assert.equal(back.deletedBy, null);
    assert.equal(back.deleteReason, null);
  });

  test("휴지통에 없는 부품은 복원 대상이 아니다", async () => {
    const part = await createTestPart("RESTORE-ACTIVE");
    const result = await restorePart({ partId: part.id, actorUserId: adminId, expectedVersion: part.version });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");
  });
});

describe("permanentlyDeletePart", () => {
  test("부품과 잔량 버킷이 함께 사라지고 PURGE 감사 로그가 남는다", async () => {
    const part = await createTestPart("PERMANENT");
    // 이력 없이 잔량 버킷만 있는 상태는 정상 경로로는 만들 수 없다(입고가 곧
    // 이력이다). 완전삭제가 FK 때문에 막히지 않는지 보려고 직접 만든다.
    const [balance] = await db
      .insert(partStockBalances)
      .values({ partId: part.id, owner: "DSS", location: TEST_LOCATION })
      .returning();

    const deleted = await softDeletePart({
      partId: part.id,
      actorUserId: adminId,
      expectedVersion: part.version,
      reason: null,
    });
    assert.equal(deleted.ok, true);
    if (!deleted.ok) return;

    const purged = await permanentlyDeletePart({
      partId: part.id,
      actorUserId: adminId,
      expectedVersion: deleted.version,
      reason: "테스트 완전 삭제",
    });
    assert.equal(purged.ok, true, `permanent delete failed: ${JSON.stringify(purged)}`);

    assert.equal(await readPart(part.id), undefined);
    assert.equal((await db.select().from(partStockBalances).where(eq(partStockBalances.id, balance.id))).length, 0);

    const [log] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetRecordId, part.id), eq(auditLogs.actionType, "PURGE")));
    assert.ok(log);
    assert.equal(log.actorUserId, adminId, "사람이 지웠으면 행위자가 남아야 한다");
  });

  test("사유 없이 완전 삭제할 수 없다", async () => {
    const part = await createTestPart("PERMANENT-NO-REASON");
    const deleted = await softDeletePart({
      partId: part.id,
      actorUserId: adminId,
      expectedVersion: part.version,
      reason: null,
    });
    assert.equal(deleted.ok, true);
    if (!deleted.ok) return;

    const result = await permanentlyDeletePart({
      partId: part.id,
      actorUserId: adminId,
      expectedVersion: deleted.version,
      reason: "   ",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "INVALID_INPUT");
    assert.ok(await readPart(part.id), "거절됐으면 부품은 그대로 있어야 한다");
  });
});

describe("purgeExpiredPart", () => {
  test("15일이 지나지 않았으면 지우지 않는다", async () => {
    const part = await createTestPart("PURGE-YOUNG");
    const deleted = await softDeletePart({
      partId: part.id,
      actorUserId: adminId,
      expectedVersion: part.version,
      reason: null,
    });
    assert.equal(deleted.ok, true);

    await backdateDeletion(part.id, MASTER_DATA_TRASH_RETENTION_DAYS - 1);
    assert.equal(await purgeExpiredPart(part.id), "SKIPPED_NOT_ELIGIBLE");
    assert.ok(await readPart(part.id));
    assert.equal((await listPurgeEligiblePartIds()).includes(part.id), false);
  });

  test("15일이 지나면 사라지고 감사 로그의 행위자는 비어 있다", async () => {
    const part = await createTestPart("PURGE-EXPIRED");
    const deleted = await softDeletePart({
      partId: part.id,
      actorUserId: adminId,
      expectedVersion: part.version,
      reason: null,
    });
    assert.equal(deleted.ok, true);
    await backdateDeletion(part.id, MASTER_DATA_TRASH_RETENTION_DAYS + 1);

    assert.ok((await listPurgeEligiblePartIds()).includes(part.id), "만료된 부품이 후보에 없다");
    assert.equal(await purgeExpiredPart(part.id), "PURGED");
    assert.equal(await readPart(part.id), undefined);

    const [log] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetRecordId, part.id), eq(auditLogs.actionType, "PURGE")));
    assert.ok(log);
    assert.equal(log.actorUserId, null, "자동 정리는 사람이 한 일이 아니다");
  });

  test("복원된 뒤라면 만료 목록에 있었더라도 지우지 않는다", async () => {
    const part = await createTestPart("PURGE-RESTORED");
    const deleted = await softDeletePart({
      partId: part.id,
      actorUserId: adminId,
      expectedVersion: part.version,
      reason: null,
    });
    assert.equal(deleted.ok, true);
    if (!deleted.ok) return;
    await backdateDeletion(part.id, MASTER_DATA_TRASH_RETENTION_DAYS + 1);

    const restored = await restorePart({
      partId: part.id,
      actorUserId: adminId,
      expectedVersion: deleted.version,
    });
    assert.equal(restored.ok, true);

    assert.equal(await purgeExpiredPart(part.id), "SKIPPED_RESTORED");
    assert.ok(await readPart(part.id));
  });

  test("이미 사라진 행은 오류가 아니라 건너뜀이다", async () => {
    assert.equal(await purgeExpiredPart(randomUUID()), "SKIPPED_ALREADY_GONE");
  });

  test("이력이 걸린 채 휴지통에 들어가 있으면 지우지 않고 이유 있는 건너뜀으로 보고한다", async () => {
    const part = await createTestPart("PURGE-REFERENCED");
    const received = await receiveStock({
      partId: part.id,
      owner: "DSS",
      location: TEST_LOCATION,
      quantity: 1,
      actorUserId: adminId,
    });
    assert.equal(received.ok, true);

    // 정상 경로로는 만들 수 없는 상태다 — softDeletePart가 이력을 보고 막는다.
    // 그 관문을 우회해 직접 만들어, 자동 정리가 DB 오류로 터지는 대신
    // 건너뛴다는 것을 확인한다.
    await db
      .update(parts)
      .set({
        isDeleted: true,
        deletedAt: new Date(Date.now() - (MASTER_DATA_TRASH_RETENTION_DAYS + 1) * MS_PER_DAY),
        deletedBy: adminId,
      })
      .where(eq(parts.id, part.id));

    assert.equal(await purgeExpiredPart(part.id), "SKIPPED_REFERENCED");
    assert.ok(await readPart(part.id));

    // 다음 테스트(정리 회차)의 숫자가 이 행 때문에 흐려지지 않게 되돌린다.
    await db.update(parts).set({ isDeleted: false, deletedAt: null }).where(eq(parts.id, part.id));
  });

  test("정리 회차가 부품까지 함께 돈다", async () => {
    const expired = await createTestPart("SWEEP-EXPIRED");
    const young = await createTestPart("SWEEP-YOUNG");

    for (const part of [expired, young]) {
      const deleted = await softDeletePart({
        partId: part.id,
        actorUserId: adminId,
        expectedVersion: part.version,
        reason: null,
      });
      assert.equal(deleted.ok, true);
    }
    await backdateDeletion(expired.id, MASTER_DATA_TRASH_RETENTION_DAYS + 1);
    await backdateDeletion(young.id, 1);

    const summary = await runMasterDataPurgeSweep();
    assert.ok(summary.parts.eligible >= 1);
    assert.ok(summary.parts.purged >= 1);
    assert.equal(summary.parts.errored, 0, JSON.stringify(summary.parts.errors));

    assert.equal(await readPart(expired.id), undefined, "만료된 부품은 지워져야 한다");
    assert.ok(await readPart(young.id), "아직 만료가 아닌 부품은 남아 있어야 한다");
  });
});
