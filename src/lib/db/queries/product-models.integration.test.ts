import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { customers, productModels, products, repairCaseIntakeSequences, repairCases, users } from "../schema";
import { createRepairCase } from "../mutations/repair-cases";
import { getProductModelDetailById, listProductModels } from "./product-models";
import { listRepairCasesByProductModelId } from "./repair-cases";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Real-DB integration test against dss-as-postgres-dev for Product Model
 * Master queries (listProductModels, getProductModelDetailById,
 * listRepairCasesByProductModelId), converted from the phase-1 raw
 * products.model_name grouping to the real product_models master table
 * (migration 0030). Deliberately self-cleaning and isolated to a test-only
 * customer-name prefix ("AS-TEST-CUSTOMER-PM-") and intake month ("9806" —
 * distinct from every other integration test file's own reserved month; the
 * intake number's year-month is derived from receivedAt, so TEST_YEAR_MONTH
 * and TEST_RECEIVED_AT must always agree) so no two files ever race on the
 * same sequence row or customer namespace.
 *
 * resolveProduct() is unchanged this checkpoint — createRepairCase() still
 * creates `products` rows with product_model_id = NULL. Tests that need a
 * linked master row simulate the (future) intake-linking step directly via
 * a raw UPDATE, the same way migration 0030's backfill linked existing rows
 * — this keeps the test scoped to the query logic under product_model_id
 * linkage, independent of whether/how intake eventually sets it.
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-CUSTOMER-PM-";
const TEST_MODEL_PREFIX = "AS-TEST-MODEL-PM-";
const TEST_YEAR_MONTH = "9806";
const TEST_RECEIVED_AT = "2098-06-01";
const TEST_RECEIVED_AT_LATER = "2098-06-20";

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
  await db.delete(productModels).where(like(productModels.modelName, `${TEST_MODEL_PREFIX}%`));
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
    modelName: `${TEST_MODEL_PREFIX}${suffix}`,
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

/**
 * Simulates the intake-linking step resolveProduct() does not perform yet:
 * inserts a product_models master row for `modelName`, then links every
 * `products` row currently bearing that exact model_name to it. Must be
 * called after all createRepairCase() calls for that model name.
 */
async function insertMasterAndLinkUnits(modelName: string): Promise<string> {
  const [master] = await db.insert(productModels).values({ modelName }).returning({ id: productModels.id });
  await db.update(products).set({ productModelId: master.id }).where(eq(products.modelName, modelName));
  return master.id;
}

describe("listProductModels / getProductModelDetailById / listRepairCasesByProductModelId", () => {
  test("a model with 2 distinct units and a repeat-intake case: unitCount=2, repairCaseCount=3, lastReceivedAt is the max", async () => {
    const modelName = `${TEST_MODEL_PREFIX}${randomUUID().slice(0, 8)}`;

    const unitA = await createRepairCase(
      baseCreateInput({ modelName, lotNumber: "LOT-A", serialNumber: "SN-A", receivedAt: TEST_RECEIVED_AT })
    );
    assert.equal(unitA.ok, true, `setup failed: ${JSON.stringify(unitA)}`);
    const unitB = await createRepairCase(
      baseCreateInput({ modelName, lotNumber: "LOT-B", serialNumber: "SN-B", receivedAt: TEST_RECEIVED_AT_LATER })
    );
    assert.equal(unitB.ok, true, `setup failed: ${JSON.stringify(unitB)}`);
    // Same exact (model, lot, serial) triple as unitA — a repeat intake of
    // the SAME physical unit, must reuse unitA's product row, not create a
    // third one.
    const repeatOfA = await createRepairCase(
      baseCreateInput({ modelName, lotNumber: "LOT-A", serialNumber: "SN-A", receivedAt: TEST_RECEIVED_AT })
    );
    assert.equal(repeatOfA.ok, true, `setup failed: ${JSON.stringify(repeatOfA)}`);

    const masterId = await insertMasterAndLinkUnits(modelName);

    const listRows = await listProductModels();
    const row = listRows.find((r) => r.id === masterId);
    assert.ok(row, "expected the test model in the list");
    assert.equal(row!.modelName, modelName);
    assert.equal(row!.unitCount, 2, "two distinct (lot, serial) triples under this model → 2 units");
    assert.equal(row!.repairCaseCount, 3, "three repair cases total, including the repeat intake");
    assert.equal(row!.lastReceivedAt, TEST_RECEIVED_AT_LATER);

    const detail = await getProductModelDetailById(masterId);
    assert.ok(detail);
    assert.equal(detail!.unitCount, 2);
    assert.equal(detail!.repairCaseCount, 3);
    const unitARow = detail!.units.find((u) => u.serialNumber === "SN-A");
    assert.equal(unitARow?.repairCaseCount, 2, "unit A has 2 repair cases (original + repeat intake)");
    const unitBRow = detail!.units.find((u) => u.serialNumber === "SN-B");
    assert.equal(unitBRow?.repairCaseCount, 1);

    const history = await listRepairCasesByProductModelId(masterId);
    assert.equal(history.length, 3);
    assert.ok(history.every((c) => c.modelName === modelName));
  });

  test("getProductModelDetailById returns null for a nonexistent id", async () => {
    const detail = await getProductModelDetailById(randomUUID());
    assert.equal(detail, null);
  });

  test("listRepairCasesByProductModelId returns only cases for that exact master row, never a different one", async () => {
    const modelA = `${TEST_MODEL_PREFIX}SCOPE-A-${randomUUID().slice(0, 8)}`;
    const modelB = `${TEST_MODEL_PREFIX}SCOPE-B-${randomUUID().slice(0, 8)}`;
    const a = await createRepairCase(baseCreateInput({ modelName: modelA }));
    const b = await createRepairCase(baseCreateInput({ modelName: modelB }));
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);

    const masterAId = await insertMasterAndLinkUnits(modelA);
    await insertMasterAndLinkUnits(modelB);

    const historyA = await listRepairCasesByProductModelId(masterAId);
    assert.equal(historyA.length, 1);
    assert.equal(historyA[0].modelName, modelA);
  });

  test("a product_models row with no linked products still appears with unitCount=0, repairCaseCount=0, lastReceivedAt=null", async () => {
    const modelName = `${TEST_MODEL_PREFIX}EMPTY-${randomUUID().slice(0, 8)}`;
    const [master] = await db.insert(productModels).values({ modelName }).returning({ id: productModels.id });

    const listRows = await listProductModels();
    const row = listRows.find((r) => r.id === master.id);
    assert.ok(row, "expected the empty master row to still be listed");
    assert.equal(row!.unitCount, 0);
    assert.equal(row!.repairCaseCount, 0);
    assert.equal(row!.lastReceivedAt, null);

    const detail = await getProductModelDetailById(master.id);
    assert.ok(detail);
    assert.equal(detail!.unitCount, 0);
    assert.equal(detail!.repairCaseCount, 0);
    assert.equal(detail!.repeatRepairUnitCount, 0);
    assert.equal(detail!.currentlyInRepairCount, 0);
    assert.equal(detail!.averageRepairDurationDays, null);
    assert.equal(detail!.units.length, 0);
  });

  test("currentlyInRepairCount and averageRepairDurationDays follow actual_shipment_date, and a unit with 2 cases counts as a repeat repair", async () => {
    const modelName = `${TEST_MODEL_PREFIX}STATS-${randomUUID().slice(0, 8)}`;

    // Unit A: two cases (repeat repair), one completed with a known duration.
    const caseA1 = await createRepairCase(
      baseCreateInput({ modelName, lotNumber: "LOT-A", serialNumber: "SN-A", receivedAt: TEST_RECEIVED_AT })
    );
    assert.equal(caseA1.ok, true);
    const caseA2 = await createRepairCase(
      baseCreateInput({ modelName, lotNumber: "LOT-A", serialNumber: "SN-A", receivedAt: TEST_RECEIVED_AT_LATER })
    );
    assert.equal(caseA2.ok, true);
    // Unit B: one still-open case (no actual_shipment_date).
    const caseB = await createRepairCase(
      baseCreateInput({ modelName, lotNumber: "LOT-B", serialNumber: "SN-B", receivedAt: TEST_RECEIVED_AT })
    );
    assert.equal(caseB.ok, true);

    if (caseA1.ok) {
      // 10-day repair duration: 2098-06-01 -> 2098-06-11.
      await db
        .update(repairCases)
        .set({ actualShipmentDate: "2098-06-11" })
        .where(eq(repairCases.id, caseA1.id));
    }
    if (caseA2.ok) {
      // 6-day repair duration: 2098-06-20 -> 2098-06-26.
      await db
        .update(repairCases)
        .set({ actualShipmentDate: "2098-06-26" })
        .where(eq(repairCases.id, caseA2.id));
    }
    // caseB stays open (actual_shipment_date left null).

    const masterId = await insertMasterAndLinkUnits(modelName);
    const detail = await getProductModelDetailById(masterId);
    assert.ok(detail);
    assert.equal(detail!.unitCount, 2);
    assert.equal(detail!.repairCaseCount, 3);
    assert.equal(detail!.repeatRepairUnitCount, 1, "only unit A has more than one repair case");
    assert.equal(detail!.currentlyInRepairCount, 1, "only caseB has no actual_shipment_date");
    assert.equal(
      detail!.averageRepairDurationDays,
      8,
      "average of the two completed cases' durations: (10 + 6) / 2 = 8"
    );
  });
});
