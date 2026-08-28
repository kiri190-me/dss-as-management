import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  customers,
  productModelCustomers,
  productModels,
  products,
  repairCaseIntakeSequences,
  repairCases,
  users,
} from "../schema";
import { listCustomersForProductModel } from "../queries/product-model-customers";
import { createRepairCase } from "./repair-cases";
import { updateProductModel } from "./product-models";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Real-DB integration test against dss-as-postgres-dev, exercising the
 * Product Model Master mutation layer (updateProductModel) directly — same
 * layering choice end-users.integration.test.ts/customers.integration.test.ts
 * make: the session/role-authorization gate lives entirely in
 * update-product-model.ts's Server Action (unit-tested separately in
 * product-model-authorization.test.ts) and is not exercised here.
 *
 * Deliberately self-cleaning and isolated to test-only prefixes
 * ("AS-TEST-CUSTOMER-PMMUT-" / "PMMUT-TEST-" for products / model names
 * starting with "PMMUT-MODEL-" for product_models rows) and intake month
 * ("9808" — distinct from every other integration test file's own reserved
 * month; the intake number's year-month is derived from receivedAt, so
 * TEST_YEAR_MONTH and TEST_RECEIVED_AT must always agree) so no two files
 * ever race on the same sequence row or namespace.
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-CUSTOMER-PMMUT-";
const TEST_PRODUCT_MODEL_NAME_PREFIX = "PMMUT-MODEL-";
const TEST_YEAR_MONTH = "9808";
const TEST_RECEIVED_AT = "2098-08-01";

let customerId: string;
let engineerId: string;

before(async () => {
  const customer = await db
    .insert(customers)
    .values({ name: `${TEST_CUSTOMER_NAME_PREFIX}${randomUUID().slice(0, 8)}` })
    .returning();
  customerId = customer[0].id;

  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(engineer, "expected at least one approved AS_ENGINEER in the dev DB");
  engineerId = engineer.id;
});

after(async () => {
  const testCaseRows = await db
    .select({ id: repairCases.id, productId: repairCases.productId })
    .from(repairCases)
    .where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  if (testCaseRows.length > 0) {
    const productIds = [...new Set(testCaseRows.map((r) => r.productId))];
    for (const id of productIds) {
      await db.delete(products).where(eq(products.id, id));
    }
  }
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  await db.delete(productModels).where(like(productModels.modelName, `${TEST_PRODUCT_MODEL_NAME_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

function baseCreateInput(overrides: Partial<ValidatedCreateRepairCaseInput> = {}): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
    customerId,
    endUserId: null,
    assignedEngineerId: engineerId,
    receivedAt: TEST_RECEIVED_AT,
    customerRequestedDueDate: null,
    internalTargetShipmentDate: null,
    modelName: `${TEST_PRODUCT_MODEL_NAME_PREFIX}HISTORICAL-${suffix}`,
    lotNumber: `LOT-${suffix}`,
    serialNumber: `SN-${suffix}`,
    partNumber: null,
    accessoryList: null,
    externalConditionSummary: null,
    reasonForRemoval: null,
    reportedSymptom: null,
    intakeInspectionResult: null,
    currentDiagnosisSummary: null,
    nextPlannedAction: null,
    notes: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    ...overrides,
  };
}

async function createTestMaster(nameSuffix: string) {
  const [row] = await db
    .insert(productModels)
    .values({ modelName: `${TEST_PRODUCT_MODEL_NAME_PREFIX}${nameSuffix}-${randomUUID().slice(0, 8)}` })
    .returning();
  return row;
}

/**
 * 고객사 연결 시험이 쓰는 고객사. 위 after() 의 이름 접두어 정리에 그대로 걸리고,
 * product_model_customers 의 줄은 FK CASCADE 로 함께 사라진다.
 */
async function createTestCustomer(nameSuffix: string) {
  const [row] = await db
    .insert(customers)
    .values({ name: `${TEST_CUSTOMER_NAME_PREFIX}${nameSuffix}-${randomUUID().slice(0, 8)}` })
    .returning();
  return row;
}

function baseUpdateFields(overrides: Partial<Parameters<typeof updateProductModel>[0]> = {}) {
  return {
    id: "",
    expectedUpdatedAt: "",
    modelName: "",
    kind: null,
    manufacturer: null,
    description: null,
    customerIds: [],
    ...overrides,
  } as Parameters<typeof updateProductModel>[0];
}

describe("updateProductModel", () => {
  test("valid update persists all fields and returns the new modelName/updatedAt", async () => {
    const master = await createTestMaster("EDIT-OK");
    const newName = `${TEST_PRODUCT_MODEL_NAME_PREFIX}EDIT-OK-NEW-${randomUUID().slice(0, 8)}`;

    const result = await updateProductModel(
      baseUpdateFields({
        id: master.id,
        expectedUpdatedAt: master.updatedAt.toISOString(),
        modelName: newName,
        kind: "GENERATOR",
        manufacturer: "Acme",
        description: "설명",
      })
    );
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.modelName, newName);
    assert.ok(result.updatedAt);

    const [row] = await db.select().from(productModels).where(eq(productModels.id, master.id));
    assert.equal(row.modelName, newName);
    assert.equal(row.kind, "GENERATOR");
    assert.equal(row.manufacturer, "Acme");
    assert.equal(row.description, "설명");
  });

  test("renaming to another product model's normalized name is rejected", async () => {
    const a = await createTestMaster("DUP-A");
    const b = await createTestMaster("DUP-B");

    const result = await updateProductModel(
      baseUpdateFields({
        id: b.id,
        expectedUpdatedAt: b.updatedAt.toISOString(),
        modelName: `  ${a.modelName.toUpperCase()}  `,
      })
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "VALIDATION_ERROR");
    assert.ok(result.fieldErrors?.modelName);
  });

  test("stale expectedUpdatedAt returns CONFLICT and does not modify the row", async () => {
    const master = await createTestMaster("CONFLICT");
    const staleTimestamp = master.updatedAt.toISOString();

    const first = await updateProductModel(
      baseUpdateFields({
        id: master.id,
        expectedUpdatedAt: staleTimestamp,
        modelName: `${master.modelName}-v2`,
      })
    );
    assert.equal(first.ok, true, `setup update failed: ${JSON.stringify(first)}`);

    const second = await updateProductModel(
      baseUpdateFields({
        id: master.id,
        expectedUpdatedAt: staleTimestamp,
        modelName: `${master.modelName}-v3-should-not-apply`,
      })
    );
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "CONFLICT");

    const [row] = await db.select().from(productModels).where(eq(productModels.id, master.id));
    assert.equal(row.modelName, `${master.modelName}-v2`);
  });

  test("NOT_FOUND for a nonexistent product model id", async () => {
    const result = await updateProductModel(
      baseUpdateFields({
        id: randomUUID(),
        expectedUpdatedAt: new Date().toISOString(),
        modelName: `${TEST_PRODUCT_MODEL_NAME_PREFIX}NOT-FOUND`,
      })
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });

  test("concurrent renames of two different rows to the same normalized name — exactly one succeeds", async () => {
    const a = await createTestMaster("RACE-A");
    const b = await createTestMaster("RACE-B");
    const contestedName = `${TEST_PRODUCT_MODEL_NAME_PREFIX}RACE-TARGET-${randomUUID().slice(0, 8)}`;

    const [resultA, resultB] = await Promise.all([
      updateProductModel(baseUpdateFields({ id: a.id, expectedUpdatedAt: a.updatedAt.toISOString(), modelName: contestedName })),
      updateProductModel(baseUpdateFields({ id: b.id, expectedUpdatedAt: b.updatedAt.toISOString(), modelName: contestedName })),
    ]);
    assert.deepEqual(
      [resultA.ok, resultB.ok].sort(),
      [false, true],
      "exactly one of the two concurrent renames to the same normalized name should succeed"
    );
  });

  test("renaming product_models.model_name never rewrites the historical products.model_name of linked units", async () => {
    const historicalModelName = `${TEST_PRODUCT_MODEL_NAME_PREFIX}HISTORICAL-${randomUUID().slice(0, 8)}`;
    const created = await createRepairCase(baseCreateInput({ modelName: historicalModelName }));
    assert.equal(created.ok, true, `setup create failed: ${JSON.stringify(created)}`);
    if (!created.ok) return;

    const [productRow] = await db
      .select()
      .from(products)
      .where(eq(products.modelName, historicalModelName));
    assert.ok(productRow, "expected the intake to have created a products row with the historical model name");

    // Simulate the (future) intake-linking step resolveProduct() does not
    // perform yet, the same way migration 0030's backfill and the query
    // integration test's insertMasterAndLinkUnits() helper do.
    const [master] = await db
      .insert(productModels)
      .values({ modelName: historicalModelName })
      .returning();
    await db.update(products).set({ productModelId: master.id }).where(eq(products.id, productRow.id));

    const newMasterName = `${TEST_PRODUCT_MODEL_NAME_PREFIX}RENAMED-${randomUUID().slice(0, 8)}`;
    const renamed = await updateProductModel(
      baseUpdateFields({ id: master.id, expectedUpdatedAt: master.updatedAt.toISOString(), modelName: newMasterName })
    );
    assert.equal(renamed.ok, true, `rename failed: ${JSON.stringify(renamed)}`);

    const [masterAfter] = await db.select().from(productModels).where(eq(productModels.id, master.id));
    assert.equal(masterAfter.modelName, newMasterName);

    const [productAfter] = await db.select().from(products).where(eq(products.id, productRow.id));
    assert.equal(
      productAfter.modelName,
      historicalModelName,
      "products.model_name must stay exactly as the unit's own historical intake string"
    );
    assert.equal(productAfter.productModelId, master.id, "the FK linkage itself must be unaffected by the rename");
  });
});

/**
 * ============================================================================
 * 고객사 연결(product_model_customers)
 * ============================================================================
 * 저장은 updateProductModel 이 모델 행을 FOR UPDATE 로 잡은 **그 트랜잭션 안**에서
 * 하고, 조회는 queries/product-model-customers.ts 가 한다. 두 쪽이 한 쌍이라
 * 여기서 함께 시험한다 — 특히 "저장은 됐는데 조회가 걸러 낸다"가 어긋나면
 * 사용자에게는 저장이 안 된 것으로 보인다.
 * ============================================================================
 */
describe("updateProductModel — 고객사 연결", () => {
  test("고객사 둘을 붙이면 조회에 둘 다 이름순으로 나온다", async () => {
    const master = await createTestMaster("CUST-TWO");
    const a = await createTestCustomer("LINK-A");
    const b = await createTestCustomer("LINK-B");

    const result = await updateProductModel(
      baseUpdateFields({
        id: master.id,
        expectedUpdatedAt: master.updatedAt.toISOString(),
        modelName: master.modelName,
        // 일부러 이름 역순으로 보낸다 — 차례는 조회가 정한다.
        customerIds: [b.id, a.id],
      })
    );
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const linked = await listCustomersForProductModel(master.id);
    assert.deepEqual(
      linked,
      [
        { id: a.id, name: a.name },
        { id: b.id, name: b.name },
      ],
      "붙인 고객사 둘이 이름순으로 나와야 한다"
    );
  });

  test("하나를 빼고 다시 저장하면 하나만 남는다", async () => {
    const master = await createTestMaster("CUST-REMOVE-ONE");
    const a = await createTestCustomer("REMOVE-A");
    const b = await createTestCustomer("REMOVE-B");

    const first = await updateProductModel(
      baseUpdateFields({
        id: master.id,
        expectedUpdatedAt: master.updatedAt.toISOString(),
        modelName: master.modelName,
        customerIds: [a.id, b.id],
      })
    );
    assert.equal(first.ok, true, `setup update failed: ${JSON.stringify(first)}`);
    if (!first.ok) return;
    assert.equal((await listCustomersForProductModel(master.id)).length, 2);

    const second = await updateProductModel(
      baseUpdateFields({
        id: master.id,
        expectedUpdatedAt: first.updatedAt,
        modelName: master.modelName,
        customerIds: [a.id],
      })
    );
    assert.equal(second.ok, true, `second update failed: ${JSON.stringify(second)}`);

    assert.deepEqual(await listCustomersForProductModel(master.id), [{ id: a.id, name: a.name }]);
  });

  test("전부 빼면 하나도 남지 않는다", async () => {
    const master = await createTestMaster("CUST-CLEAR");
    const a = await createTestCustomer("CLEAR-A");

    const first = await updateProductModel(
      baseUpdateFields({
        id: master.id,
        expectedUpdatedAt: master.updatedAt.toISOString(),
        modelName: master.modelName,
        customerIds: [a.id],
      })
    );
    assert.equal(first.ok, true, `setup update failed: ${JSON.stringify(first)}`);
    if (!first.ok) return;

    const second = await updateProductModel(
      baseUpdateFields({
        id: master.id,
        expectedUpdatedAt: first.updatedAt,
        modelName: master.modelName,
        customerIds: [],
      })
    );
    assert.equal(second.ok, true, `clearing update failed: ${JSON.stringify(second)}`);

    assert.deepEqual(await listCustomersForProductModel(master.id), []);
    const rows = await db
      .select({ id: productModelCustomers.id })
      .from(productModelCustomers)
      .where(eq(productModelCustomers.productModelId, master.id));
    assert.deepEqual(rows, [], "연결 줄 자체가 지워져야 한다 — 조회가 가리는 것이 아니다");
  });

  test("휴지통에 든 고객사는 붙일 수 없다 — VALIDATION_ERROR, 기존 연결은 그대로", async () => {
    const master = await createTestMaster("CUST-TRASHED");
    const alive = await createTestCustomer("TRASH-ALIVE");
    const trashed = await createTestCustomer("TRASH-DELETED");

    const first = await updateProductModel(
      baseUpdateFields({
        id: master.id,
        expectedUpdatedAt: master.updatedAt.toISOString(),
        modelName: master.modelName,
        customerIds: [alive.id],
      })
    );
    assert.equal(first.ok, true, `setup update failed: ${JSON.stringify(first)}`);
    if (!first.ok) return;

    await db.update(customers).set({ isDeleted: true, deletedAt: new Date() }).where(eq(customers.id, trashed.id));

    const rejected = await updateProductModel(
      baseUpdateFields({
        id: master.id,
        expectedUpdatedAt: first.updatedAt,
        modelName: master.modelName,
        customerIds: [alive.id, trashed.id],
      })
    );
    assert.equal(rejected.ok, false, "휴지통에 든 고객사를 붙이는 저장은 거부되어야 한다");
    if (rejected.ok) return;
    assert.equal(rejected.code, "VALIDATION_ERROR");
    assert.ok(rejected.fieldErrors?.customerIds, "사람이 읽을 수 있는 문장이 customerIds 칸에 붙어야 한다");

    assert.deepEqual(
      await listCustomersForProductModel(master.id),
      [{ id: alive.id, name: alive.name }],
      "거부된 저장은 기존 연결을 건드리지 않아야 한다"
    );
  });

  test("없는 고객사 id 는 DB 오류가 아니라 VALIDATION_ERROR 로 거부된다", async () => {
    const master = await createTestMaster("CUST-MISSING");

    const result = await updateProductModel(
      baseUpdateFields({
        id: master.id,
        expectedUpdatedAt: master.updatedAt.toISOString(),
        modelName: master.modelName,
        customerIds: [randomUUID()],
      })
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "VALIDATION_ERROR");
    assert.ok(result.fieldErrors?.customerIds);

    assert.deepEqual(await listCustomersForProductModel(master.id), []);
  });

  test("🔴 조회는 휴지통에 든 고객사를 빼고 돌려준다", async () => {
    const master = await createTestMaster("CUST-READ-FILTER");
    const stays = await createTestCustomer("FILTER-STAYS");
    const goes = await createTestCustomer("FILTER-GOES");

    const saved = await updateProductModel(
      baseUpdateFields({
        id: master.id,
        expectedUpdatedAt: master.updatedAt.toISOString(),
        modelName: master.modelName,
        customerIds: [stays.id, goes.id],
      })
    );
    assert.equal(saved.ok, true, `setup update failed: ${JSON.stringify(saved)}`);
    assert.equal((await listCustomersForProductModel(master.id)).length, 2);

    // 휴지통에 넣는다 = customers 행은 그대로 남고 is_deleted 만 선다. FK CASCADE 는
    // 완전삭제 때만 움직이므로 연결 줄도 그대로 남아 있어야 정상이다.
    await db.update(customers).set({ isDeleted: true, deletedAt: new Date() }).where(eq(customers.id, goes.id));

    const linkRows = await db
      .select({ id: productModelCustomers.id })
      .from(productModelCustomers)
      .where(eq(productModelCustomers.productModelId, master.id));
    assert.equal(linkRows.length, 2, "소프트 삭제는 연결 줄을 지우지 않는다 — 거르는 것은 조회의 몫이다");

    assert.deepEqual(
      await listCustomersForProductModel(master.id),
      [{ id: stays.id, name: stays.name }],
      "휴지통에 든 고객사는 조회 결과에서 빠져야 한다"
    );
  });

  test("expectedUpdatedAt 이 낡으면 고객사 연결도 바뀌지 않는다", async () => {
    const master = await createTestMaster("CUST-CONFLICT");
    const kept = await createTestCustomer("CONFLICT-KEPT");
    const attempted = await createTestCustomer("CONFLICT-ATTEMPTED");
    const staleTimestamp = master.updatedAt.toISOString();

    const first = await updateProductModel(
      baseUpdateFields({
        id: master.id,
        expectedUpdatedAt: staleTimestamp,
        modelName: master.modelName,
        customerIds: [kept.id],
      })
    );
    assert.equal(first.ok, true, `setup update failed: ${JSON.stringify(first)}`);

    const second = await updateProductModel(
      baseUpdateFields({
        id: master.id,
        expectedUpdatedAt: staleTimestamp,
        modelName: master.modelName,
        customerIds: [attempted.id],
      })
    );
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "CONFLICT");

    assert.deepEqual(
      await listCustomersForProductModel(master.id),
      [{ id: kept.id, name: kept.name }],
      "충돌한 저장은 연결을 한 줄도 쓰지 않아야 한다"
    );
  });

  test("🔴 고객사를 완전삭제하면 연결 줄도 함께 사라진다 (ON DELETE CASCADE)", async () => {
    const master = await createTestMaster("CUST-CASCADE");
    const purged = await createTestCustomer("CASCADE-PURGED");
    const survivor = await createTestCustomer("CASCADE-SURVIVOR");

    const saved = await updateProductModel(
      baseUpdateFields({
        id: master.id,
        expectedUpdatedAt: master.updatedAt.toISOString(),
        modelName: master.modelName,
        customerIds: [purged.id, survivor.id],
      })
    );
    assert.equal(saved.ok, true, `setup update failed: ${JSON.stringify(saved)}`);

    // 완전삭제 경로들(permanentlyDeleteCustomer / purgeExpiredCustomer)은 이 표의
    // 존재를 모른 채 customers 행을 지운다. 그래도 23503 으로 멈추지 않고 연결이
    // 함께 사라지는 것이 schema/product-model-customers.ts 가 CASCADE 를 고른
    // 이유다 — 그 근거를 여기서 못 박는다.
    await db.delete(customers).where(eq(customers.id, purged.id));

    const linkRows = await db
      .select({ customerId: productModelCustomers.customerId })
      .from(productModelCustomers)
      .where(eq(productModelCustomers.productModelId, master.id));
    assert.deepEqual(
      linkRows,
      [{ customerId: survivor.id }],
      "완전삭제된 고객사의 연결 줄은 CASCADE 로 사라지고 나머지는 남아야 한다"
    );
  });

  test("고객사 연결만 바뀌어도 updated_at 이 갱신된다", async () => {
    const master = await createTestMaster("CUST-TOUCH");
    const a = await createTestCustomer("TOUCH-A");

    const [before] = await db.select().from(productModels).where(eq(productModels.id, master.id));

    const result = await updateProductModel(
      baseUpdateFields({
        id: master.id,
        expectedUpdatedAt: before.updatedAt.toISOString(),
        // 이름·종류·제조사·설명은 하나도 바뀌지 않는다. 바뀌는 것은 연결뿐이다.
        modelName: before.modelName,
        kind: before.kind,
        manufacturer: before.manufacturer,
        description: before.description,
        customerIds: [a.id],
      })
    );
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const [after] = await db.select().from(productModels).where(eq(productModels.id, master.id));
    assert.notEqual(
      after.updatedAt.toISOString(),
      before.updatedAt.toISOString(),
      "연결만 바뀐 저장에서도 updated_at 이 올라야 다음 사람의 낡은 토큰이 충돌로 잡힌다"
    );
    assert.equal(result.updatedAt, after.updatedAt.toISOString());

    // 그리고 그 새 토큰으로는 이어서 저장할 수 있어야 한다.
    const next = await updateProductModel(
      baseUpdateFields({
        id: master.id,
        expectedUpdatedAt: result.updatedAt,
        modelName: before.modelName,
        customerIds: [],
      })
    );
    assert.equal(next.ok, true, `follow-up update failed: ${JSON.stringify(next)}`);
  });
});
