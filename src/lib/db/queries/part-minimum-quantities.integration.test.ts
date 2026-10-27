import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { partMinimumQuantities, partStockBalances, parts, stockTransactions, users } from "../schema";
import { createPart, receiveStock } from "../mutations/inventory";
import { savePartMinimumQuantities } from "../mutations/part-minimum-quantities";
import { getPartMinimumQuantities, listPartsBelowMinimumQuantity } from "./part-minimum-quantities";
import { listMyNotifications } from "./notifications";
import type { Role } from "@/lib/domain/types";

/**
 * ============================================================================
 * 부족 조회 + 재고 부족 종 알림 — 통합 시험
 * ============================================================================
 * 🔴 이 파일에서 가장 중요한 시험은 하나다: **재고 행이 아예 없는 소유자에
 * 한계수량을 걸면 알림이 뜬다.** part_stock_balances 는 입고가 있어야 행이
 * 생기므로, INNER JOIN 으로 짜면 "하나도 없는" 부품이 통째로 빠진다 — 그런데
 * 그것이 가장 알려야 할 경우다.
 *
 * 그다음이 "한계수량이 하나도 없으면 이 알림이 하나도 안 뜬다"이다. 표를
 * 만들었다는 이유로 종 알림이 달라지면 그것이 이 작업의 가장 나쁜 결과다.
 *
 * 격리 규약 — 부품명 접두사 "test-min-qty-query-". after() 가 이 스위트가 만든
 * 부품만 지운다.
 * ============================================================================
 */

const TEST_PART_PREFIX = "test-min-qty-query-";
const LOCATION_A = "TEST-MINQTY-A";
const LOCATION_B = "TEST-MINQTY-B";

let superAdminId: string;
let adminId: string;
let inventoryManagerId: string;
let engineerId: string;
let salesId: string;

const createdPartIds: string[] = [];

/** 한계수량을 하나도 만들기 전에 재어 둔 값 — "지금과 같다"를 증명하는 데 쓴다. */
let shortagesBeforeAnyMinimum: number;
let lowStockItemsBeforeAnyMinimum: number;

let partNoMinimumId: string;
let partNoBalanceRowId: string;
let partMultiLocationId: string;
let partExactlyEqualId: string;
let partPerOwnerId: string;
let partDeletedId: string;

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
    partSpec: "부족 조회 시험용",
    category: "TEST",
    actorUserId: superAdminId,
  });
  assert.equal(result.ok, true, `part create failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdPartIds.push(result.partId);
  return result.partId;
}

async function receive(partId: string, owner: "DSS" | "KYOSAN", location: string, quantity: number) {
  const result = await receiveStock({ partId, owner, location, quantity, actorUserId: inventoryManagerId });
  assert.equal(result.ok, true, `receive failed: ${JSON.stringify(result)}`);
}

async function setMinimum(partId: string, entries: { owner: string; minimumQuantity: string }[]) {
  const result = await savePartMinimumQuantities({ partId, entries, actorUserId: superAdminId });
  assert.equal(result.ok, true, `minimum save failed: ${JSON.stringify(result)}`);
}

/** 이 스위트가 만든 부품의 부족 줄만. 다른 자료에 흔들리지 않게 한다. */
async function shortagesOf(partId: string) {
  const rows = await listPartsBelowMinimumQuantity();
  return rows.filter((row) => row.partId === partId);
}

/**
 * 이 스위트가 만든 부품을 가리키는 **종 알림 줄 전부**.
 *
 * 🔴 2026-10-27(13-C4)까지는 `kind === "PART_STOCK_BELOW_MINIMUM"` 으로도 걸렀다.
 * 그 종류가 없어져 **종류로 거르면 무엇이 와도 빈 목록**이 되므로, 지금은 종류를
 * 보지 않고 「이 부품을 가리키는 줄이 하나라도 있는가」만 본다 — 재고 알림이
 * 되살아나면 종류 이름이 무엇이든 여기 걸린다.
 */
async function bellItemsPointingAtTestParts(actorUserId: string, actorRole: Role) {
  const items = await listMyNotifications(actorUserId, actorRole);
  return items.filter((item) => createdPartIds.some((id) => item.href.includes(id)));
}

before(async () => {
  superAdminId = await findUserId("SUPER_ADMIN");
  adminId = await findUserId("ADMIN");
  inventoryManagerId = await findUserId("INVENTORY_MANAGER");
  engineerId = await findUserId("AS_ENGINEER");
  salesId = await findUserId("SALES");

  const existing = await db.select({ id: partMinimumQuantities.id }).from(partMinimumQuantities);
  assert.equal(existing.length, 0, "이 시험은 한계수량이 하나도 없는 상태를 전제로 합니다");

  // ── 한계수량을 하나도 만들기 전의 상태 ────────────────────────────────
  shortagesBeforeAnyMinimum = (await listPartsBelowMinimumQuantity()).length;
  // 🔵 종류로 거르던 것을 2026-10-27 에 「재고를 가리키는 주소인가」로 바꿨다 —
  //    종류가 사라져 종류로 세면 무엇이 와도 0 이 된다(위 헬퍼 주석).
  lowStockItemsBeforeAnyMinimum = (await listMyNotifications(superAdminId, "SUPER_ADMIN")).filter((item) =>
    item.href.startsWith("/inventory")
  ).length;

  // ── 한계 없음 · 재고 있음 ─────────────────────────────────────────────
  partNoMinimumId = await createTestPart();
  await receive(partNoMinimumId, "DSS", LOCATION_A, 5);

  // ── 🔴 재고 행이 아예 없는 소유자 · 한계 1 ────────────────────────────
  partNoBalanceRowId = await createTestPart();
  await setMinimum(partNoBalanceRowId, [{ owner: "DSS", minimumQuantity: "1" }]);

  // ── 위치 둘(3 + 4 = 7) · 한계 8 ──────────────────────────────────────
  partMultiLocationId = await createTestPart();
  await receive(partMultiLocationId, "DSS", LOCATION_A, 3);
  await receive(partMultiLocationId, "DSS", LOCATION_B, 4);
  await setMinimum(partMultiLocationId, [{ owner: "DSS", minimumQuantity: "8" }]);

  // ── 합계 == 한계(5 == 5) ─────────────────────────────────────────────
  partExactlyEqualId = await createTestPart();
  await receive(partExactlyEqualId, "DSS", LOCATION_A, 5);
  await setMinimum(partExactlyEqualId, [{ owner: "DSS", minimumQuantity: "5" }]);

  // ── 소유자마다 따로 (DSS 2 < 5 부족, 교산 10 >= 5 충분) ──────────────
  partPerOwnerId = await createTestPart();
  await receive(partPerOwnerId, "DSS", LOCATION_A, 2);
  await receive(partPerOwnerId, "KYOSAN", LOCATION_A, 10);
  await setMinimum(partPerOwnerId, [
    { owner: "DSS", minimumQuantity: "5" },
    { owner: "KYOSAN", minimumQuantity: "5" },
  ]);

  // ── 지워진 부품 (재고 0 · 한계 9) ────────────────────────────────────
  partDeletedId = await createTestPart();
  await setMinimum(partDeletedId, [{ owner: "DSS", minimumQuantity: "9" }]);
  await db
    .update(parts)
    .set({ isDeleted: true, deletedAt: new Date(), deletedBy: superAdminId })
    .where(eq(parts.id, partDeletedId));
});

after(async () => {
  const leftovers = await db.select({ id: parts.id }).from(parts).where(like(parts.partName, `${TEST_PART_PREFIX}%`));
  const allPartIds = [...new Set([...createdPartIds, ...leftovers.map((row) => row.id)])];

  if (allPartIds.length > 0) {
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

describe("부족 조회", () => {
  test("1. 🔴 한계수량이 하나도 없으면 부족도 알림도 하나도 없다 — 지금과 같다", () => {
    assert.equal(shortagesBeforeAnyMinimum, 0, "한계수량 없이 부족이 잡히면 안 된다");
    assert.equal(lowStockItemsBeforeAnyMinimum, 0, "한계수량 없이 알림이 뜨면 안 된다");
  });

  test("2. 한계수량을 정하지 않은 부품은 재고가 아무리 적어도 뜨지 않는다", async () => {
    assert.deepEqual(await shortagesOf(partNoMinimumId), []);
  });

  test("3. 🔴 재고 줄이 아예 없는 소유자에 한계를 걸면 뜬다 — 지금 0 으로", async () => {
    // LEFT JOIN 이 아니면 이 부품은 통째로 빠진다. part_stock_balances 에 이
    // (부품, DSS) 짝의 행이 실제로 없는 것부터 확인한다.
    const balanceRows = await db
      .select({ id: partStockBalances.id })
      .from(partStockBalances)
      .where(eq(partStockBalances.partId, partNoBalanceRowId));
    assert.equal(balanceRows.length, 0, "이 부품에는 재고 행이 하나도 없어야 시험이 뜻을 갖는다");

    const rows = await shortagesOf(partNoBalanceRowId);
    assert.equal(rows.length, 1, "재고 행이 없다는 이유로 빠지면 안 된다");
    assert.equal(rows[0].owner, "DSS");
    assert.equal(rows[0].currentQuantity, 0, "행이 없으면 0 이다 — '알 수 없음'이 아니다");
    assert.equal(rows[0].minimumQuantity, 1);
    assert.ok(rows[0].partName.startsWith(TEST_PART_PREFIX), "알림 한 줄에 필요한 품명이 실려야 한다");
  });

  test("4. 위치가 여럿이면 합쳐서 견준다 — 위치마다 따로 보지 않는다", async () => {
    const rows = await shortagesOf(partMultiLocationId);
    assert.equal(rows.length, 1, "위치가 둘이어도 (부품, 소유자) 한 줄이다");
    assert.equal(rows[0].currentQuantity, 7, "3 + 4 = 7 이어야 한다");
    assert.equal(rows[0].minimumQuantity, 8);
  });

  test("5. 합계가 한계와 같으면 부족이 아니다 — '그 밑으로 떨어지면'이다", async () => {
    assert.deepEqual(await shortagesOf(partExactlyEqualId), []);
  });

  test("6. 합계가 한계보다 하나만 적어도 부족이다 — 경계값", async () => {
    // 위 부품의 한계를 하나 올려 5 < 6 을 만든다.
    await setMinimum(partExactlyEqualId, [{ owner: "DSS", minimumQuantity: "6" }]);
    const rows = await shortagesOf(partExactlyEqualId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].currentQuantity, 5);
    assert.equal(rows[0].minimumQuantity, 6);

    // 원래대로 돌려놓는다 — 뒤 시험이 이 부품을 다시 보지 않도록.
    await setMinimum(partExactlyEqualId, [{ owner: "DSS", minimumQuantity: "5" }]);
    assert.deepEqual(await shortagesOf(partExactlyEqualId), []);
  });

  test("7. 소유자마다 따로 본다 — 한쪽이 넉넉해도 다른 쪽 부족을 가리지 않는다", async () => {
    const rows = await shortagesOf(partPerOwnerId);
    assert.equal(rows.length, 1, "부족한 소유자만 나와야 한다");
    assert.equal(rows[0].owner, "DSS");
    assert.equal(rows[0].currentQuantity, 2);
    assert.equal(rows[0].minimumQuantity, 5);
  });

  test("8. 지워진 부품은 뜨지 않는다", async () => {
    assert.deepEqual(await shortagesOf(partDeletedId), []);
  });

  test("9. 부품이 지워지면 한계수량 줄도 함께 사라진다 — ON DELETE CASCADE", async () => {
    const partId = await createTestPart();
    await setMinimum(partId, [{ owner: "DSS", minimumQuantity: "3" }]);
    assert.equal((await getPartMinimumQuantities(partId)).length, 1);

    // 완전삭제 경로(permanentlyDeletePart / purgeExpiredPart)는 잔량 버킷만
    // 지우고 부품을 지운다 — 이 표를 모르는 채로도 막히지 않아야 한다.
    await db.delete(parts).where(eq(parts.id, partId));
    assert.equal((await getPartMinimumQuantities(partId)).length, 0);
  });
});

describe("한계수량 읽기", () => {
  test("10. 정해진 것만 돌아온다 — 없는 소유자를 0 으로 채워 주지 않는다", async () => {
    const rows = await getPartMinimumQuantities(partPerOwnerId);
    assert.deepEqual(
      rows.map((row) => [row.owner, row.minimumQuantity]),
      [
        ["DSS", 5],
        ["KYOSAN", 5],
      ]
    );

    assert.deepEqual(await getPartMinimumQuantities(partNoMinimumId), [], "정하지 않은 부품은 빈 목록이다");
  });
});

describe("재고 부족 종 알림 — 2026-10-27(13-C4)에 걷어냈다", () => {
  /**
   * 🔴 **여기 있던 시험 넷을 이 하나로 바꿨다.** 그 넷은 재고 부족 알림이
   *  ① 재고관리자·관리자·최고관리자에게 가고 ② 엔지니어·영업에게는 안 가고
   *  ③ 한 줄에 품명·소유자·두 숫자가 실리고 ④ 재고 행이 없는 소유자도 뜬다
   * 를 쟀다. 재고 기능이 별도 시스템(dss-inventory)으로 옮겨 가 **그쪽이 제 알림을
   * 포털로 직접 보내므로**, A/S 가 같은 줄을 또 올리면 종에 두 번 뜬다.
   *
   * 🔵 그래서 이 자리에는 「뜬다」가 아니라 **「이제 안 뜬다」**를 남긴다. 밑자락은
   * 그대로다 — 위 before() 가 실제로 **부족한 부품 다섯을 만들어 둔** 상태이고
   * (listPartsBelowMinimumQuantity 는 지금도 그 줄들을 내놓는다: 아래 첫 단언),
   * 그 상태에서 다섯 역할 **누구의 종에도** 재고를 가리키는 줄이 서지 않는 것을
   * 본다. 표본이 비어서 공짜로 통과하는 것이 아니라는 근거가 첫 단언이다.
   */
  test("11. 🔴 부족한 부품이 실제로 있는데도 다섯 역할 누구의 종에도 뜨지 않는다", async () => {
    // 표본이 비지 않았다는 근거 — 조회는 지금도 부족 줄을 내놓는다.
    const shortages = await listPartsBelowMinimumQuantity();
    assert.ok(
      shortages.some((row) => createdPartIds.includes(row.partId)),
      "이 시험이 만든 부족 줄이 하나도 없다 — 밑자락이 깨져 아래 단언이 공짜로 통과한다"
    );

    for (const [userId, role] of [
      [superAdminId, "SUPER_ADMIN"],
      [adminId, "ADMIN"],
      [inventoryManagerId, "INVENTORY_MANAGER"],
      [engineerId, "AS_ENGINEER"],
      [salesId, "SALES"],
    ] as const) {
      assert.deepEqual(
        await bellItemsPointingAtTestParts(userId, role),
        [],
        `${role} 의 종에 재고 줄이 다시 섰다 — 포털에서 dss-inventory 와 겹쳐 두 번 보인다`
      );
    }
  });
});
