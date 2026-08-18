import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { customers, productModels, products, repairCaseIntakeSequences, repairCases, users } from "../schema";
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
    workflowType: "MATCHER",
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

function baseUpdateFields(overrides: Partial<Parameters<typeof updateProductModel>[0]> = {}) {
  return {
    id: "",
    expectedUpdatedAt: "",
    modelName: "",
    kind: null,
    manufacturer: null,
    description: null,
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
