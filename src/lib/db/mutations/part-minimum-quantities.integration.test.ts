import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { auditLogs, partMinimumQuantities, partStockBalances, parts, stockTransactions, users } from "../schema";
import { createPart } from "./inventory";
import { savePartMinimumQuantities } from "./part-minimum-quantities";
import type { Role } from "@/lib/domain/types";

/**
 * ============================================================================
 * 한계수량 저장 — 통합 시험
 * ============================================================================
 * 여기서 못 박는 것은 둘이 제일 중요하다.
 *  1. **빈 값은 0 으로 저장되지 않고 줄이 지워진다.** "정하지 않음"과 "0 으로
 *     정함"이 DB 에서도 갈라져 있어야 한다.
 *  2. **하나라도 틀리면 한 줄도 저장되지 않는다.** 넷을 한 트랜잭션으로 쓴다.
 *
 * 격리 규약은 이 디렉터리의 다른 통합 시험과 같다 — 부품명 접두사
 * "test-min-qty-mutation-". after() 가 이 스위트가 만든 부품만 지운다.
 * ============================================================================
 */

const TEST_PART_PREFIX = "test-min-qty-mutation-";

let superAdminId: string;
let inventoryManagerId: string;
let engineerId: string;
let salesId: string;

const createdPartIds: string[] = [];

async function findUserId(role: Role): Promise<string> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, role),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false),
        eq(users.isActive, true)
      )
    )
    .limit(1);
  assert.ok(row, `expected an approved ${role} in the test DB`);
  return row.id;
}

async function createTestPart(): Promise<string> {
  const result = await createPart({
    partName: `${TEST_PART_PREFIX}${randomUUID().slice(0, 8)}`,
    partSpec: "한계수량 시험용",
    category: "TEST",
    actorUserId: superAdminId,
  });
  assert.equal(result.ok, true, `part create failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdPartIds.push(result.partId);
  return result.partId;
}

/**
 * DB 제약 위반을 확인한다. drizzle 이 던지는 오류의 메시지에는 이유가 없고
 * (실패한 SQL 문만 들어 있다) 원래 PostgresError 는 `.cause` 에 달려 있다 —
 * mutations/inventory.ts 의 isUniqueViolation 이 둘 다 보는 것과 같은 이유다.
 */
async function assertRejectsWithCause(run: Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(run, (err: unknown) => {
    const messages: string[] = [];
    let current: unknown = err;
    for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
      messages.push(current.message);
      current = current.cause;
    }
    const joined = messages.join(" | ");
    assert.match(joined, pattern);
    return true;
  });
}

/** 지금 저장돼 있는 줄 전부 — 없는 소유자는 아예 나오지 않아야 한다. */
async function storedRows(partId: string) {
  return db
    .select({
      id: partMinimumQuantities.id,
      owner: partMinimumQuantities.owner,
      minimumQuantity: partMinimumQuantities.minimumQuantity,
      updatedBy: partMinimumQuantities.updatedBy,
      updatedAt: partMinimumQuantities.updatedAt,
    })
    .from(partMinimumQuantities)
    .where(eq(partMinimumQuantities.partId, partId))
    .orderBy(partMinimumQuantities.owner);
}

before(async () => {
  superAdminId = await findUserId("SUPER_ADMIN");
  inventoryManagerId = await findUserId("INVENTORY_MANAGER");
  engineerId = await findUserId("AS_ENGINEER");
  salesId = await findUserId("SALES");
});

after(async () => {
  const leftovers = await db.select({ id: parts.id }).from(parts).where(like(parts.partName, `${TEST_PART_PREFIX}%`));
  const allPartIds = [...new Set([...createdPartIds, ...leftovers.map((row) => row.id)])];

  if (allPartIds.length > 0) {
    // 한계수량 줄은 ON DELETE CASCADE 라 부품만 지워도 따라 사라지지만, 시험이
    // 스키마의 그 성질에 기대어 뒷정리를 빠뜨리지 않도록 먼저 명시적으로 지운다.
    await db.delete(partMinimumQuantities).where(inArray(partMinimumQuantities.partId, allPartIds));

    const balances = await db
      .select({ id: partStockBalances.id })
      .from(partStockBalances)
      .where(inArray(partStockBalances.partId, allPartIds));
    const balanceIds = balances.map((row) => row.id);
    if (balanceIds.length > 0) {
      await db.delete(stockTransactions).where(inArray(stockTransactions.partStockBalanceId, balanceIds));
      await db.delete(partStockBalances).where(inArray(partStockBalances.id, balanceIds));
    }
    await db.delete(parts).where(inArray(parts.id, allPartIds));
  }

  await pgClient.end({ timeout: 5 });
});

describe("한계수량 저장: 넣기·고치기·지우기", () => {
  test("1. 값이 있는 칸만 줄이 생긴다 — 비운 칸은 줄을 만들지 않는다", async () => {
    const partId = await createTestPart();

    const result = await savePartMinimumQuantities({
      partId,
      entries: [
        { owner: "DSS", minimumQuantity: "20" },
        { owner: "KYOSAN", minimumQuantity: "" },
        { owner: "SERVICE_SPARE", minimumQuantity: "30" },
        { owner: "TEST", minimumQuantity: "" },
      ],
      actorUserId: inventoryManagerId,
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.equal(result.changedCount, 2, "값이 있는 둘만 써야 한다");

    const rows = await storedRows(partId);
    assert.deepEqual(
      rows.map((row) => [row.owner, row.minimumQuantity]),
      [
        ["DSS", 20],
        ["SERVICE_SPARE", 30],
      ]
    );
    assert.equal(rows[0].updatedBy, inventoryManagerId);
  });

  test("2. 🔴 빈 값은 0 으로 저장되지 않고 줄을 지운다", async () => {
    const partId = await createTestPart();
    await savePartMinimumQuantities({
      partId,
      entries: [{ owner: "DSS", minimumQuantity: "20" }],
      actorUserId: superAdminId,
    });
    assert.equal((await storedRows(partId)).length, 1);

    const cleared = await savePartMinimumQuantities({
      partId,
      entries: [{ owner: "DSS", minimumQuantity: "" }],
      actorUserId: superAdminId,
    });
    assert.equal(cleared.ok, true, JSON.stringify(cleared));
    if (!cleared.ok) return;
    assert.equal(cleared.changedCount, 1);

    const rows = await storedRows(partId);
    assert.equal(rows.length, 0, "0 으로 저장하지 않고 줄 자체를 지워야 한다");
  });

  test("3. 🔴 0 은 살아 있는 값이다 — 줄이 0 으로 남는다", async () => {
    const partId = await createTestPart();
    const result = await savePartMinimumQuantities({
      partId,
      entries: [{ owner: "DSS", minimumQuantity: "0" }],
      actorUserId: superAdminId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const rows = await storedRows(partId);
    assert.equal(rows.length, 1, "0 은 '정하지 않음'이 아니다");
    assert.equal(rows[0].minimumQuantity, 0);
  });

  test("4. 이미 있는 줄은 고쳐진다 — 줄이 늘지 않는다", async () => {
    const partId = await createTestPart();
    await savePartMinimumQuantities({
      partId,
      entries: [{ owner: "DSS", minimumQuantity: "20" }],
      actorUserId: superAdminId,
    });
    await savePartMinimumQuantities({
      partId,
      entries: [{ owner: "DSS", minimumQuantity: "35" }],
      actorUserId: inventoryManagerId,
    });

    const rows = await storedRows(partId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].minimumQuantity, 35);
    assert.equal(rows[0].updatedBy, inventoryManagerId, "마지막으로 고친 사람이 남아야 한다");
  });

  test("5. 바뀌지 않은 칸은 다시 쓰지 않는다 — updated_by 가 저장 단추 누른 사람으로 갈리지 않는다", async () => {
    const partId = await createTestPart();
    await savePartMinimumQuantities({
      partId,
      entries: [{ owner: "DSS", minimumQuantity: "20" }],
      actorUserId: superAdminId,
    });
    const [firstSave] = await storedRows(partId);

    const again = await savePartMinimumQuantities({
      partId,
      // 같은 값 + 원래 비어 있던 칸을 그대로 비운 채로 보낸다.
      entries: [
        { owner: "DSS", minimumQuantity: "20" },
        { owner: "KYOSAN", minimumQuantity: "" },
      ],
      actorUserId: inventoryManagerId,
    });
    assert.equal(again.ok, true, JSON.stringify(again));
    if (!again.ok) return;
    assert.equal(again.changedCount, 0, "바뀐 것이 없으면 0 이어야 한다");

    const [afterSave] = await storedRows(partId);
    assert.equal(afterSave.updatedBy, superAdminId, "실제로 정한 사람이 그대로 남아야 한다");
    assert.deepEqual(afterSave.updatedAt, firstSave.updatedAt);
  });

  test("6. 보내지 않은 소유자는 건드리지 않는다", async () => {
    const partId = await createTestPart();
    await savePartMinimumQuantities({
      partId,
      entries: [
        { owner: "DSS", minimumQuantity: "20" },
        { owner: "KYOSAN", minimumQuantity: "10" },
      ],
      actorUserId: superAdminId,
    });

    await savePartMinimumQuantities({
      partId,
      entries: [{ owner: "DSS", minimumQuantity: "25" }],
      actorUserId: superAdminId,
    });

    const rows = await storedRows(partId);
    assert.deepEqual(
      rows.map((row) => [row.owner, row.minimumQuantity]),
      [
        ["DSS", 25],
        ["KYOSAN", 10],
      ]
    );
  });
});

describe("한계수량 저장: 값 검증", () => {
  test("7. 🔴 하나라도 틀리면 한 줄도 저장되지 않는다", async () => {
    const partId = await createTestPart();

    const result = await savePartMinimumQuantities({
      partId,
      entries: [
        { owner: "DSS", minimumQuantity: "20" },
        { owner: "KYOSAN", minimumQuantity: "-5" },
      ],
      actorUserId: superAdminId,
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "INVALID_INPUT");
    assert.ok(result.fieldErrors?.KYOSAN, "틀린 칸이 어디인지 알려야 한다");
    assert.equal((await storedRows(partId)).length, 0, "앞의 맞는 값까지 저장되면 안 된다");
  });

  test("8. 음수·소수·숫자 아닌 것·모르는 소유자를 거절한다", async () => {
    const partId = await createTestPart();

    for (const entries of [
      [{ owner: "DSS", minimumQuantity: "-1" }],
      [{ owner: "DSS", minimumQuantity: "1.5" }],
      [{ owner: "DSS", minimumQuantity: "abc" }],
      [{ owner: "DSS", minimumQuantity: "1e3" }],
      [{ owner: "DSS2", minimumQuantity: "1" }],
      [{ owner: "dss", minimumQuantity: "1" }],
    ]) {
      const result = await savePartMinimumQuantities({ partId, entries, actorUserId: superAdminId });
      assert.equal(result.ok, false, JSON.stringify(entries));
      if (result.ok) continue;
      assert.equal(result.code, "INVALID_INPUT", JSON.stringify(entries));
    }

    assert.equal((await storedRows(partId)).length, 0);
  });

  test("9. DB 도 음수를 막는다 — CHECK 제약이 실제로 걸려 있다", async () => {
    const partId = await createTestPart();
    await assertRejectsWithCause(
      db.insert(partMinimumQuantities).values({
        partId,
        owner: "DSS",
        minimumQuantity: -1,
        updatedBy: superAdminId,
      }),
      /part_minimum_quantities_not_negative/i
    );
  });

  test("10. 같은 (부품, 소유자) 는 한 줄뿐이다 — 유니크 인덱스가 실제로 걸려 있다", async () => {
    const partId = await createTestPart();
    await db.insert(partMinimumQuantities).values({
      partId,
      owner: "DSS",
      minimumQuantity: 5,
      updatedBy: superAdminId,
    });
    await assertRejectsWithCause(
      db.insert(partMinimumQuantities).values({
        partId,
        owner: "DSS",
        minimumQuantity: 9,
        updatedBy: superAdminId,
      }),
      /part_minimum_quantities_part_owner_unique/i
    );
  });
});

describe("한계수량 저장: 권한과 대상", () => {
  test("11. 🔴 엔지니어와 영업은 한계수량을 고칠 수 없다", async () => {
    const partId = await createTestPart();

    for (const actorUserId of [engineerId, salesId]) {
      const result = await savePartMinimumQuantities({
        partId,
        entries: [{ owner: "DSS", minimumQuantity: "20" }],
        actorUserId,
      });
      assert.equal(result.ok, false);
      if (result.ok) continue;
      assert.equal(result.code, "FORBIDDEN");
    }

    assert.equal((await storedRows(partId)).length, 0);
  });

  test("12. 재고 담당자는 고칠 수 있다 — 부품 정보를 고치는 권한과 같다", async () => {
    const partId = await createTestPart();
    const result = await savePartMinimumQuantities({
      partId,
      entries: [{ owner: "DSS", minimumQuantity: "20" }],
      actorUserId: inventoryManagerId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  test("13. 없는 부품·지워진 부품에는 저장할 수 없다", async () => {
    const missing = await savePartMinimumQuantities({
      partId: randomUUID(),
      entries: [{ owner: "DSS", minimumQuantity: "20" }],
      actorUserId: superAdminId,
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.code, "NOT_FOUND");

    const partId = await createTestPart();
    await db
      .update(parts)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: superAdminId })
      .where(eq(parts.id, partId));

    const deleted = await savePartMinimumQuantities({
      partId,
      entries: [{ owner: "DSS", minimumQuantity: "20" }],
      actorUserId: superAdminId,
    });
    assert.equal(deleted.ok, false);
    if (!deleted.ok) assert.equal(deleted.code, "NOT_FOUND");
  });

  test("14. 없는 사용자로는 저장할 수 없다", async () => {
    const partId = await createTestPart();
    const result = await savePartMinimumQuantities({
      partId,
      entries: [{ owner: "DSS", minimumQuantity: "20" }],
      actorUserId: randomUUID(),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });
});

describe("한계수량 저장: 감사 로그", () => {
  test("15. 넣을 때 CREATE, 고칠 때 UPDATE, 지울 때 UPDATE 로 남는다", async () => {
    const partId = await createTestPart();

    await savePartMinimumQuantities({
      partId,
      entries: [{ owner: "DSS", minimumQuantity: "20" }],
      actorUserId: superAdminId,
    });
    const [created] = await storedRows(partId);

    await savePartMinimumQuantities({
      partId,
      entries: [{ owner: "DSS", minimumQuantity: "35" }],
      actorUserId: superAdminId,
    });
    await savePartMinimumQuantities({
      partId,
      entries: [{ owner: "DSS", minimumQuantity: "" }],
      actorUserId: superAdminId,
    });

    const logs = await db
      .select({
        actionType: auditLogs.actionType,
        actorUserId: auditLogs.actorUserId,
        newValue: auditLogs.newValue,
      })
      .from(auditLogs)
      .where(
        and(eq(auditLogs.targetEntity, "part_minimum_quantities"), eq(auditLogs.targetRecordId, created.id))
      )
      .orderBy(auditLogs.createdAt);

    assert.deepEqual(
      logs.map((log) => log.actionType),
      ["CREATE", "UPDATE", "UPDATE"],
      "지우는 것도 UPDATE 로 남긴다 — 업무 자료가 사라진 것이 아니라 기준을 없앤 것이다"
    );
    for (const log of logs) assert.equal(log.actorUserId, superAdminId);

    const last = logs[2].newValue as { minimumQuantity: number | null; cleared?: boolean };
    assert.equal(last.minimumQuantity, null);
    assert.equal(last.cleared, true);
  });
});
