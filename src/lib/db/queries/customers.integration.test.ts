import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { customers, endUsers, products, repairCaseIntakeSequences, repairCases, users } from "../schema";
import { createRepairCase } from "../mutations/repair-cases";
import { getCustomerDetailById, listCustomersWithCounts, listEndUsersByCustomerId } from "./customers";
import { listRepairCasesByCustomerId } from "./repair-cases";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Real-DB integration test against dss-as-postgres-dev for the Customer
 * Management phase 1 read queries (list/detail/related End-Users/A/S
 * history). Deliberately self-cleaning and isolated to a test-only
 * customer-name prefix ("AS-TEST-CUSTOMER-QUERY-") and intake month
 * ("9804") — distinct from customers.integration.test.ts's own "9803" and
 * every other integration test file's reserved month; the intake number's
 * year-month is derived from receivedAt, so TEST_YEAR_MONTH and
 * TEST_RECEIVED_AT must always agree — so no two files ever race on the
 * same sequence row or customer namespace.
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-CUSTOMER-QUERY-";
const TEST_MODEL_PREFIX = "CUSTOMER-QUERY-TEST-";
const TEST_YEAR_MONTH = "9804";
const TEST_RECEIVED_AT = "2098-04-01";

let engineerId: string;

before(async () => {
  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(engineer, "expected at least one approved AS_ENGINEER in the dev DB");
  engineerId = engineer.id;
});

after(async () => {
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(endUsers).where(like(endUsers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

async function createTestCustomer(nameSuffix: string) {
  const [row] = await db
    .insert(customers)
    .values({ name: `${TEST_CUSTOMER_NAME_PREFIX}${nameSuffix}-${randomUUID().slice(0, 8)}` })
    .returning();
  return row;
}

async function createTestEndUser(customerId: string, nameSuffix: string) {
  const [row] = await db
    .insert(endUsers)
    .values({ customerId, name: `${TEST_CUSTOMER_NAME_PREFIX}EU-${nameSuffix}-${randomUUID().slice(0, 8)}` })
    .returning();
  return row;
}

function baseCreateInput(
  customerId: string,
  overrides: Partial<ValidatedCreateRepairCaseInput> = {}
): ValidatedCreateRepairCaseInput {
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

describe("customers queries", () => {
  test("listCustomersWithCounts: counts active End-Users and repair cases, excludes soft-deleted rows of both", async () => {
    const customer = await createTestCustomer("COUNTS");
    await createTestEndUser(customer.id, "1");
    const deletedEndUser = await createTestEndUser(customer.id, "2-DELETED");
    await db.update(endUsers).set({ isDeleted: true }).where(eq(endUsers.id, deletedEndUser.id));

    const created1 = await createRepairCase(baseCreateInput(customer.id));
    assert.equal(created1.ok, true, `setup create failed: ${JSON.stringify(created1)}`);
    const created2 = await createRepairCase(baseCreateInput(customer.id));
    assert.equal(created2.ok, true, `setup create failed: ${JSON.stringify(created2)}`);
    if (!created1.ok || !created2.ok) return;
    await db.update(repairCases).set({ isDeleted: true }).where(eq(repairCases.id, created2.id));

    const rows = await listCustomersWithCounts();
    const row = rows.find((r) => r.id === customer.id);
    assert.ok(row, "expected the test customer in the list");
    assert.equal(row!.endUserCount, 1, "only the non-deleted End-User should count");
    assert.equal(row!.repairCaseCount, 1, "only the non-deleted repair case should count");
  });

  test("listCustomersWithCounts: a customer with no End-Users or repair cases shows zeros, not omitted", async () => {
    const customer = await createTestCustomer("ZERO");
    const rows = await listCustomersWithCounts();
    const row = rows.find((r) => r.id === customer.id);
    assert.ok(row, "expected the test customer in the list even with zero related rows");
    assert.equal(row!.endUserCount, 0);
    assert.equal(row!.repairCaseCount, 0);
  });

  test("getCustomerDetailById: returns full contact detail; null for nonexistent, malformed, and soft-deleted ids", async () => {
    const customer = await createTestCustomer("DETAIL");
    const detail = await getCustomerDetailById(customer.id);
    assert.ok(detail);
    assert.equal(detail!.name, customer.name);
    assert.equal(detail!.contactName, null);
    assert.equal(detail!.contactEmail, null);
    assert.equal(detail!.contactPhone, null);

    assert.equal(await getCustomerDetailById("not-a-uuid"), null);
    assert.equal(await getCustomerDetailById(randomUUID()), null);

    await db.update(customers).set({ isDeleted: true }).where(eq(customers.id, customer.id));
    assert.equal(await getCustomerDetailById(customer.id), null);
  });

  test("listEndUsersByCustomerId: only this customer's active End-Users — never another customer's or a soft-deleted one", async () => {
    const customerA = await createTestCustomer("EU-A");
    const customerB = await createTestCustomer("EU-B");
    const euA = await createTestEndUser(customerA.id, "A1");
    await createTestEndUser(customerB.id, "B1");
    const deletedEu = await createTestEndUser(customerA.id, "A2-DELETED");
    await db.update(endUsers).set({ isDeleted: true }).where(eq(endUsers.id, deletedEu.id));

    const rows = await listEndUsersByCustomerId(customerA.id);
    assert.deepEqual(rows.map((r) => r.id), [euA.id]);
  });

  test("listRepairCasesByCustomerId: only this customer's repair cases, same shape listRepairCases/getRepairCaseById produce", async () => {
    const customerA = await createTestCustomer("HISTORY-A");
    const customerB = await createTestCustomer("HISTORY-B");
    const createdA = await createRepairCase(baseCreateInput(customerA.id));
    const createdB = await createRepairCase(baseCreateInput(customerB.id));
    assert.equal(createdA.ok, true);
    assert.equal(createdB.ok, true);
    if (!createdA.ok || !createdB.ok) return;

    const rows = await listRepairCasesByCustomerId(customerA.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, createdA.id);
    assert.equal(rows[0].customerId, customerA.id);
    assert.equal(rows[0].source, "DATABASE");
  });
});
