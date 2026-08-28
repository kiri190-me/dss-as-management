import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { partMinimumQuantities, partUnitPrices, parts, users } from "../schema";
import { createPart } from "./inventory";
import { savePartOwnerSettings } from "./part-minimum-quantities";
import { UNIT_PRICE_FIELD_ERROR_PREFIX } from "@/lib/validation/part-unit-price-input";
import type { Role } from "@/lib/domain/types";

/**
 * ============================================================================
 * 소유구분별 단가 저장 — 통합 시험
 * ============================================================================
 * 여기서 못 박는 것은 넷이다.
 *
 *  1. **🔴 빈 칸은 0 으로 저장되지 않고 줄이 지워진다.** "정하지 않음"과
 *     "0원(무상)"이 DB 에서도 갈라져 있어야 한다. 이게 무너지면 견적서가
 *     정하지 않은 부품을 0원으로 청구하게 된다.
 *  2. **한계수량과 단가가 한 트랜잭션이다.** 단가가 틀리면 한계수량도 저장되지
 *     않는다 — 한 표에서 한 단추로 저장하므로 반쪽 상태가 있으면 안 된다.
 *  3. **바뀌지 않은 칸은 쓰지 않는다.** "125000" 과 "125000.00" 은 DB 에서
 *     같은 값이다 — 글자로 대면 매번 다르다고 나와 updated_by 가 갈아엎어진다.
 *  4. **오류 키가 겹치지 않는다.** 단가 오류에는 `price:` 접두사가 붙는다.
 *
 * 격리 규약은 이 디렉터리의 다른 통합 시험과 같다 — 부품명 접두사
 * "test-unit-price-mutation-". after() 가 이 스위트가 만든 부품만 지운다
 * (단가·한계수량은 CASCADE 로 함께 사라진다).
 * ============================================================================
 */

const TEST_PART_PREFIX = "test-unit-price-mutation-";

let superAdminId: string;
let inventoryManagerId: string;
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
    partSpec: "단가 시험용",
    category: "TEST",
    actorUserId: superAdminId,
  });
  assert.equal(result.ok, true, `part create failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdPartIds.push(result.partId);
  return result.partId;
}

/** 지금 저장돼 있는 단가 줄 전부 — 없는 소유자는 아예 나오지 않아야 한다. */
async function storedPrices(partId: string) {
  return db
    .select({
      owner: partUnitPrices.owner,
      unitPrice: partUnitPrices.unitPrice,
      updatedBy: partUnitPrices.updatedBy,
      updatedAt: partUnitPrices.updatedAt,
    })
    .from(partUnitPrices)
    .where(eq(partUnitPrices.partId, partId))
    .orderBy(partUnitPrices.owner);
}

async function storedMinimums(partId: string) {
  return db
    .select({ owner: partMinimumQuantities.owner, minimumQuantity: partMinimumQuantities.minimumQuantity })
    .from(partMinimumQuantities)
    .where(eq(partMinimumQuantities.partId, partId));
}

/** 한계수량은 건드리지 않고 단가만 보내는 저장. */
function savePrices(partId: string, prices: { owner: string; unitPrice: string }[], actorUserId: string) {
  return savePartOwnerSettings({ partId, entries: [], unitPriceEntries: prices, actorUserId });
}

before(async () => {
  superAdminId = await findUserId("SUPER_ADMIN");
  // 두 번째 행위자. inventory.parts WRITE 가 있어야 한다 — 없으면 이 시험이
  // 재고 권한을 시험하는 것이 되어 버린다(그건 다른 스위트의 몫이다).
  inventoryManagerId = await findUserId("INVENTORY_MANAGER");
});

after(async () => {
  const leftovers = await db
    .select({ id: parts.id })
    .from(parts)
    .where(like(parts.partName, `${TEST_PART_PREFIX}%`));
  const allPartIds = [...new Set([...createdPartIds, ...leftovers.map((row) => row.id)])];
  if (allPartIds.length > 0) {
    // 단가·한계수량은 ON DELETE CASCADE 라 부품만 지우면 함께 사라진다.
    await db.delete(parts).where(inArray(parts.id, allPartIds));
  }
  await pgClient.end({ timeout: 5 });
});

describe("단가 저장", () => {
  test("값을 적으면 그대로 들어가고, 적은 사람이 기록된다", async () => {
    const partId = await createTestPart();
    const result = await savePrices(
      partId,
      [
        { owner: "DSS", unitPrice: "125000" },
        { owner: "KYOSAN", unitPrice: "1,250,000.50" },
      ],
      superAdminId
    );
    assert.equal(result.ok, true, JSON.stringify(result));

    const rows = await storedPrices(partId);
    assert.deepEqual(
      rows.map((r) => [r.owner, r.unitPrice]),
      [
        ["DSS", "125000.00"],
        ["KYOSAN", "1250000.50"],
      ]
    );
    assert.equal(rows[0].updatedBy, superAdminId);
  });

  test("🔴 빈 칸은 0 으로 저장하지 않고 줄을 지운다 — 견적서가 0원으로 청구하면 안 된다", async () => {
    const partId = await createTestPart();
    await savePrices(partId, [{ owner: "DSS", unitPrice: "125000" }], superAdminId);
    assert.equal((await storedPrices(partId)).length, 1);

    await savePrices(partId, [{ owner: "DSS", unitPrice: "" }], superAdminId);
    assert.deepEqual(await storedPrices(partId), [], "빈 칸은 줄이 사라져야 한다");
  });

  test("0 은 '무상 부품'으로 저장된다 — 빈 칸과 다르다", async () => {
    const partId = await createTestPart();
    await savePrices(partId, [{ owner: "DSS", unitPrice: "0" }], superAdminId);

    const rows = await storedPrices(partId);
    assert.equal(rows.length, 1, "0 은 줄이 남아야 한다");
    assert.equal(Number(rows[0].unitPrice), 0);
  });

  test("바뀌지 않은 칸은 쓰지 않는다 — '125000'과 '125000.00'은 같은 값이다", async () => {
    const partId = await createTestPart();
    await savePrices(partId, [{ owner: "DSS", unitPrice: "125000" }], superAdminId);
    const [before] = await storedPrices(partId);

    // 다른 사람이 같은 값으로 다시 저장한다. 글자로 비교하면 여기서 덮어써진다.
    const result = await savePrices(partId, [{ owner: "DSS", unitPrice: "125000" }], inventoryManagerId);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.changedCount, 0, "쓰지 않았어야 한다");

    const [after] = await storedPrices(partId);
    assert.equal(after.updatedBy, before.updatedBy, "정한 사람이 바뀌면 안 된다");
    assert.deepEqual(after.updatedAt, before.updatedAt);
  });

  test("음수는 DB 가 아니라 검증에서 막힌다 — 사용자에게 이유가 보인다", async () => {
    const partId = await createTestPart();
    const result = await savePrices(partId, [{ owner: "DSS", unitPrice: "-1" }], superAdminId);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "INVALID_INPUT");
    assert.ok(result.fieldErrors?.[`${UNIT_PRICE_FIELD_ERROR_PREFIX}DSS`], "price: 접두사가 붙어야 한다");
    // 한계수량 칸 키로는 오지 않는다 — 그러면 엉뚱한 칸에 빨간 글씨가 붙는다.
    assert.ok(!result.fieldErrors?.DSS);
  });

  test("소유구분마다 따로 저장된다", async () => {
    const partId = await createTestPart();
    await savePrices(
      partId,
      [
        { owner: "DSS", unitPrice: "100" },
        { owner: "KYOSAN", unitPrice: "200" },
        { owner: "SERVICE_SPARE", unitPrice: "" },
        { owner: "TEST", unitPrice: "0" },
      ],
      superAdminId
    );
    assert.deepEqual(
      (await storedPrices(partId)).map((r) => [r.owner, Number(r.unitPrice)]),
      [
        ["DSS", 100],
        ["KYOSAN", 200],
        ["TEST", 0],
      ],
      "빈 칸(보수부재)만 줄이 없어야 한다"
    );
  });
});

describe("한계수량과 한 트랜잭션", () => {
  test("단가가 틀리면 한계수량도 저장되지 않는다", async () => {
    const partId = await createTestPart();

    const result = await savePartOwnerSettings({
      partId,
      entries: [{ owner: "DSS", minimumQuantity: "5" }],
      unitPriceEntries: [{ owner: "DSS", unitPrice: "말도 안 되는 값" }],
      actorUserId: superAdminId,
    });
    assert.equal(result.ok, false);

    assert.deepEqual(await storedMinimums(partId), [], "한계수량이 저장되면 안 된다");
    assert.deepEqual(await storedPrices(partId), []);
  });

  test("한계수량이 틀리면 단가도 저장되지 않는다", async () => {
    const partId = await createTestPart();

    const result = await savePartOwnerSettings({
      partId,
      entries: [{ owner: "DSS", minimumQuantity: "-3" }],
      unitPriceEntries: [{ owner: "DSS", unitPrice: "125000" }],
      actorUserId: superAdminId,
    });
    assert.equal(result.ok, false);

    assert.deepEqual(await storedPrices(partId), [], "단가가 저장되면 안 된다");
    assert.deepEqual(await storedMinimums(partId), []);
  });

  test("둘 다 맞으면 둘 다 저장된다", async () => {
    const partId = await createTestPart();

    const result = await savePartOwnerSettings({
      partId,
      entries: [{ owner: "DSS", minimumQuantity: "5" }],
      unitPriceEntries: [{ owner: "DSS", unitPrice: "125000" }],
      actorUserId: superAdminId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (result.ok) assert.equal(result.changedCount, 2);

    assert.deepEqual(
      (await storedMinimums(partId)).map((r) => [r.owner, r.minimumQuantity]),
      [["DSS", 5]]
    );
    assert.deepEqual(
      (await storedPrices(partId)).map((r) => [r.owner, Number(r.unitPrice)]),
      [["DSS", 125000]]
    );
  });

  test("단가를 안 보내면 단가는 건드리지 않는다 — 옛 진입점이 그대로 동작한다", async () => {
    const partId = await createTestPart();
    await savePrices(partId, [{ owner: "DSS", unitPrice: "125000" }], superAdminId);

    const result = await savePartOwnerSettings({
      partId,
      entries: [{ owner: "DSS", minimumQuantity: "7" }],
      // unitPriceEntries 를 주지 않는다.
      actorUserId: superAdminId,
    });
    assert.equal(result.ok, true);

    assert.equal((await storedPrices(partId)).length, 1, "단가가 지워지면 안 된다");
    assert.equal(Number((await storedPrices(partId))[0].unitPrice), 125000);
  });

  test("없는 부품은 NOT_FOUND", async () => {
    const result = await savePrices(randomUUID(), [{ owner: "DSS", unitPrice: "1" }], superAdminId);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");
  });
});

describe("부품이 지워질 때", () => {
  test("부품을 지우면 단가도 함께 사라진다 — CASCADE", async () => {
    const partId = await createTestPart();
    await savePrices(partId, [{ owner: "DSS", unitPrice: "125000" }], superAdminId);
    assert.equal((await storedPrices(partId)).length, 1);

    await db.delete(parts).where(eq(parts.id, partId));
    assert.deepEqual(await storedPrices(partId), []);
  });
});
