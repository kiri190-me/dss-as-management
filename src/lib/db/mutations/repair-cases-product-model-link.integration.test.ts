import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { customers, productModels, products, repairCaseIntakeSequences, repairCases, users } from "../schema";
import { createRepairCase, resolveProduct, updateRepairCase } from "./repair-cases";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Real-DB integration test against dss-as-postgres-dev for the "connect
 * Repair Case Model input to Product Model Master" checkpoint —
 * createRepairCase()/updateRepairCase()'s new productModelId/
 * newProductModelName resolution, and resolveProduct()'s product_model_id
 * linking/healing behavior. Deliberately self-cleaning and isolated to a
 * test-only customer-name prefix ("AS-TEST-CUSTOMER-PML-") and intake month
 * ("9809" — distinct from every other integration test file's own reserved
 * month; the intake number's year-month is derived from receivedAt, so
 * TEST_YEAR_MONTH and TEST_RECEIVED_AT must always agree) so no two files
 * ever race on the same sequence row or namespace.
 *
 * Legacy (no productModelId/newProductModelName at all) behavior is already
 * covered by repair-cases.integration.test.ts/repair-cases-update.
 * integration.test.ts and deliberately left untouched by this checkpoint —
 * not re-tested here.
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-CUSTOMER-PML-";
const TEST_PRODUCT_MODEL_NAME_PREFIX = "PML-MODEL-";
const TEST_YEAR_MONTH = "9809";
const TEST_RECEIVED_AT = "2098-09-01";

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
  // Any products row created directly (not via a repair case) inside a
  // single-statement resolveProduct() test also carries the same prefix in
  // its modelName, so this prefix-based sweep catches those too.
  await db.delete(products).where(like(products.modelName, `${TEST_PRODUCT_MODEL_NAME_PREFIX}%`));
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
    modelName: `${TEST_PRODUCT_MODEL_NAME_PREFIX}IGNORED-${suffix}`,
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

describe("createRepairCase: Product Model Master resolution", () => {
  test("productModelId selects an existing master — products.model_name snapshots the master's CURRENT name, not the client's stale text", async () => {
    const master = await createTestMaster("EXISTING");
    const suffix = randomUUID().slice(0, 8);

    const created = await createRepairCase(
      baseCreateInput({
        modelName: "stale client text — must be ignored",
        productModelId: master.id,
        lotNumber: `LOT-${suffix}`,
        serialNumber: `SN-${suffix}`,
      })
    );
    assert.equal(created.ok, true, `create failed: ${JSON.stringify(created)}`);
    if (!created.ok) return;

    const [row] = await db.select().from(repairCases).where(eq(repairCases.id, created.id));
    const [product] = await db.select().from(products).where(eq(products.id, row.productId));
    assert.equal(product.modelName, master.modelName);
    assert.equal(product.productModelId, master.id);
  });

  test("newProductModelName registers a brand-new master (kind=NULL) and links it", async () => {
    const newName = `${TEST_PRODUCT_MODEL_NAME_PREFIX}NEW-${randomUUID().slice(0, 8)}`;
    const suffix = randomUUID().slice(0, 8);

    const created = await createRepairCase(
      baseCreateInput({
        newProductModelName: newName,
        lotNumber: `LOT-${suffix}`,
        serialNumber: `SN-${suffix}`,
      })
    );
    assert.equal(created.ok, true, `create failed: ${JSON.stringify(created)}`);
    if (!created.ok) return;

    const [master] = await db.select().from(productModels).where(eq(productModels.modelName, newName));
    assert.ok(master, "expected a new product_models row to have been created");
    assert.equal(master.kind, null, "kind must never be inferred — stays NULL on registration");

    const [row] = await db.select().from(repairCases).where(eq(repairCases.id, created.id));
    const [product] = await db.select().from(products).where(eq(products.id, row.productId));
    assert.equal(product.modelName, newName);
    assert.equal(product.productModelId, master.id);
  });

  test("newProductModelName reuses an existing normalized-equivalent master instead of creating a duplicate", async () => {
    const master = await createTestMaster("DUPGUARD");
    const suffix = randomUUID().slice(0, 8);

    const created = await createRepairCase(
      baseCreateInput({
        newProductModelName: `  ${master.modelName.toUpperCase()}  `,
        lotNumber: `LOT-${suffix}`,
        serialNumber: `SN-${suffix}`,
      })
    );
    assert.equal(created.ok, true, `create failed: ${JSON.stringify(created)}`);
    if (!created.ok) return;

    const [row] = await db.select().from(repairCases).where(eq(repairCases.id, created.id));
    const [product] = await db.select().from(products).where(eq(products.id, row.productId));
    assert.equal(product.productModelId, master.id, "must reuse the existing master, never create a duplicate");
  });

  test("a nonexistent productModelId is rejected with REFERENCE_NOT_FOUND, and no product/repair case is created", async () => {
    const bogusId = randomUUID();
    const suffix = randomUUID().slice(0, 8);

    const result = await createRepairCase(
      baseCreateInput({
        productModelId: bogusId,
        lotNumber: `LOT-${suffix}`,
        serialNumber: `SN-${suffix}`,
      })
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "REFERENCE_NOT_FOUND");

    const [product] = await db.select().from(products).where(eq(products.serialNumber, `SN-${suffix}`));
    assert.equal(product, undefined, "no orphan product row should be created on rejection");
  });
});

describe("resolveProduct: product_model_id linking/healing", () => {
  test("an orphaned (product_model_id NULL) row is healed when the same triple resolves again with a productModelId", async () => {
    const modelName = `${TEST_PRODUCT_MODEL_NAME_PREFIX}HEAL-${randomUUID().slice(0, 8)}`;
    const lotNumber = `LOT-${randomUUID().slice(0, 8)}`;
    const serialNumber = `SN-${randomUUID().slice(0, 8)}`;
    const master = await createTestMaster("HEAL");

    const orphanId = await db.transaction(async (tx) => {
      const first = await resolveProduct(tx, { modelName, lotNumber, serialNumber, partNumber: null });
      assert.equal(first.ok, true);
      return first.ok ? first.productId : "";
    });
    const [beforeHeal] = await db.select().from(products).where(eq(products.id, orphanId));
    assert.equal(beforeHeal.productModelId, null);

    const healedId = await db.transaction(async (tx) => {
      const second = await resolveProduct(tx, {
        modelName,
        lotNumber,
        serialNumber,
        partNumber: null,
        productModelId: master.id,
      });
      assert.equal(second.ok, true);
      return second.ok ? second.productId : "";
    });
    assert.equal(healedId, orphanId, "must reuse the exact same physical-unit row, never create a second one");

    const [afterHeal] = await db.select().from(products).where(eq(products.id, orphanId));
    assert.equal(afterHeal.productModelId, master.id);
  });

  test("an already-linked row's product_model_id is never overwritten by a later resolution (no silent model merging)", async () => {
    const modelName = `${TEST_PRODUCT_MODEL_NAME_PREFIX}NOMERGE-${randomUUID().slice(0, 8)}`;
    const lotNumber = `LOT-${randomUUID().slice(0, 8)}`;
    const serialNumber = `SN-${randomUUID().slice(0, 8)}`;
    const masterA = await createTestMaster("NOMERGE-A");
    const masterB = await createTestMaster("NOMERGE-B");

    const productId = await db.transaction(async (tx) => {
      const linked = await resolveProduct(tx, {
        modelName,
        lotNumber,
        serialNumber,
        partNumber: null,
        productModelId: masterA.id,
      });
      assert.equal(linked.ok, true);
      return linked.ok ? linked.productId : "";
    });

    await db.transaction(async (tx) => {
      const resolvedAgain = await resolveProduct(tx, {
        modelName,
        lotNumber,
        serialNumber,
        partNumber: null,
        productModelId: masterB.id,
      });
      assert.equal(resolvedAgain.ok, true);
      if (resolvedAgain.ok) assert.equal(resolvedAgain.productId, productId);
    });

    const [row] = await db.select().from(products).where(eq(products.id, productId));
    assert.equal(row.productModelId, masterA.id, "must stay linked to the original master, never silently repointed");
  });
});

describe("updateRepairCase PRODUCT section: Product Model Master resolution", () => {
  async function createTestCase() {
    const suffix = randomUUID().slice(0, 8);
    const created = await createRepairCase(
      baseCreateInput({
        modelName: `${TEST_PRODUCT_MODEL_NAME_PREFIX}ORIGINAL-${suffix}`,
        lotNumber: `LOT-${suffix}`,
        serialNumber: `SN-${suffix}`,
      })
    );
    assert.equal(created.ok, true, `setup failed: ${JSON.stringify(created)}`);
    if (!created.ok) throw new Error("setup failed");
    return created;
  }

  test("productModelId repoints the case to the selected master, snapshotting its current name", async () => {
    const created = await createTestCase();
    const master = await createTestMaster("REPOINT");

    const result = await updateRepairCase(created.id, 1, "PRODUCT", { productModelId: master.id });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const [row] = await db.select().from(repairCases).where(eq(repairCases.id, created.id));
    const [product] = await db.select().from(products).where(eq(products.id, row.productId));
    assert.equal(product.modelName, master.modelName);
    assert.equal(product.productModelId, master.id);
  });

  test("newProductModelName registers and links a brand-new master", async () => {
    const created = await createTestCase();
    const newName = `${TEST_PRODUCT_MODEL_NAME_PREFIX}NEWVIAEDIT-${randomUUID().slice(0, 8)}`;

    const result = await updateRepairCase(created.id, 1, "PRODUCT", { newProductModelName: newName });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const [master] = await db.select().from(productModels).where(eq(productModels.modelName, newName));
    assert.ok(master);
    const [row] = await db.select().from(repairCases).where(eq(repairCases.id, created.id));
    const [product] = await db.select().from(products).where(eq(products.id, row.productId));
    assert.equal(product.productModelId, master.id);
  });

  test("a nonexistent productModelId is rejected with REFERENCE_NOT_FOUND and does not repoint the case", async () => {
    const created = await createTestCase();
    const before = await db.select().from(repairCases).where(eq(repairCases.id, created.id));

    const result = await updateRepairCase(created.id, 1, "PRODUCT", { productModelId: randomUUID() });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "REFERENCE_NOT_FOUND");

    const after = await db.select().from(repairCases).where(eq(repairCases.id, created.id));
    assert.equal(after[0].productId, before[0].productId, "must not repoint on rejection");
  });

  test("editing only lotNumber carries the existing product_model_id forward unchanged", async () => {
    const master = await createTestMaster("CARRYFORWARD");
    const suffix = randomUUID().slice(0, 8);
    const created = await createRepairCase(
      baseCreateInput({
        productModelId: master.id,
        lotNumber: `LOT-${suffix}`,
        serialNumber: `SN-${suffix}`,
      })
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const result = await updateRepairCase(created.id, 1, "PRODUCT", { lotNumber: `LOT-CHANGED-${suffix}` });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const [row] = await db.select().from(repairCases).where(eq(repairCases.id, created.id));
    const [product] = await db.select().from(products).where(eq(products.id, row.productId));
    assert.equal(product.lotNumber, `LOT-CHANGED-${suffix}`);
    assert.equal(product.productModelId, master.id, "product_model_id must survive an unrelated lot/serial edit");
  });

  test("a legacy raw modelName edit clears product_model_id (no assumption that new free text still matches the old master)", async () => {
    const master = await createTestMaster("LEGACYCLEAR");
    const suffix = randomUUID().slice(0, 8);
    const created = await createRepairCase(
      baseCreateInput({
        productModelId: master.id,
        lotNumber: `LOT-${suffix}`,
        serialNumber: `SN-${suffix}`,
      })
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const result = await updateRepairCase(created.id, 1, "PRODUCT", {
      modelName: `${TEST_PRODUCT_MODEL_NAME_PREFIX}LEGACY-RENAME-${suffix}`,
    });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const [row] = await db.select().from(repairCases).where(eq(repairCases.id, created.id));
    const [product] = await db.select().from(products).where(eq(products.id, row.productId));
    assert.equal(product.productModelId, null);
  });
});
