import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { customers, products, repairCaseIntakeSequences, repairCases, users } from "../schema";
import { createRepairCase } from "./repair-cases";
import { updateCustomer } from "./customers";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Real-DB integration test against dss-as-postgres-dev, exercising
 * updateCustomer() (the mutation layer behind update-customer.ts's Server
 * Action) directly — same layering choice repair-cases-update.integration.
 * test.ts makes for updateRepairCase(): the session/role-authorization gate
 * lives entirely in the Server Action (unit-tested separately in
 * customer-authorization.test.ts) and is not exercised here.
 *
 * Deliberately self-cleaning and isolated to a test-only customer-name
 * prefix ("AS-TEST-CUSTOMER-EDIT-") and intake month ("9803" — distinct
 * from every other integration test file's own reserved month; the intake
 * number's year-month is derived from receivedAt, so TEST_YEAR_MONTH and
 * TEST_RECEIVED_AT must always agree) so no two files ever race on the same
 * sequence row or customer namespace.
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-CUSTOMER-EDIT-";
const TEST_MODEL_PREFIX = "CUSTOMER-EDIT-TEST-";
const TEST_YEAR_MONTH = "9803";
const TEST_RECEIVED_AT = "2098-03-01";

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

function baseCreateInput(
  customerId: string,
  overrides: Partial<ValidatedCreateRepairCaseInput> = {}
): ValidatedCreateRepairCaseInput {
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

describe("updateCustomer", () => {
  test("valid update persists name/contact fields and returns a new updatedAt", async () => {
    const customer = await createTestCustomer("EDIT-OK");
    const result = await updateCustomer({
      customerId: customer.id,
      expectedUpdatedAt: customer.updatedAt.toISOString(),
      name: `${customer.name}-RENAMED`,
      contactName: "담당자",
      contactEmail: "contact@example.com",
      contactPhone: "010-1234-5678",
    });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const [row] = await db.select().from(customers).where(eq(customers.id, customer.id));
    assert.equal(row.name, `${customer.name}-RENAMED`);
    assert.equal(row.contactName, "담당자");
    assert.equal(row.contactEmail, "contact@example.com");
    assert.equal(row.contactPhone, "010-1234-5678");
    assert.equal(row.updatedAt.toISOString(), result.updatedAt);
    assert.notEqual(row.updatedAt.toISOString(), customer.updatedAt.toISOString());
  });

  test("contact fields can be cleared back to null", async () => {
    const customer = await createTestCustomer("EDIT-CLEAR");
    const first = await updateCustomer({
      customerId: customer.id,
      expectedUpdatedAt: customer.updatedAt.toISOString(),
      name: customer.name,
      contactName: "temp",
      contactEmail: "temp@example.com",
      contactPhone: "010-0000-0000",
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const result = await updateCustomer({
      customerId: customer.id,
      expectedUpdatedAt: first.updatedAt,
      name: customer.name,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
    });
    assert.equal(result.ok, true);

    const [row] = await db.select().from(customers).where(eq(customers.id, customer.id));
    assert.equal(row.contactName, null);
    assert.equal(row.contactEmail, null);
    assert.equal(row.contactPhone, null);
  });

  test("renaming to another active customer's normalized name is rejected (case/whitespace-insensitive)", async () => {
    const customerA = await createTestCustomer("DUP-A");
    const customerB = await createTestCustomer("DUP-B");

    const result = await updateCustomer({
      customerId: customerB.id,
      expectedUpdatedAt: customerB.updatedAt.toISOString(),
      name: `  ${customerA.name.toUpperCase()}  `,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "VALIDATION_ERROR");
    assert.ok(result.fieldErrors?.name);

    const [rowB] = await db.select().from(customers).where(eq(customers.id, customerB.id));
    assert.equal(rowB.name, customerB.name, "rejected rename must not have applied");
  });

  test("renaming a customer to its own current name (no-op rename) is allowed, never treated as a duplicate of itself", async () => {
    const customer = await createTestCustomer("SELF-RENAME");
    const result = await updateCustomer({
      customerId: customer.id,
      expectedUpdatedAt: customer.updatedAt.toISOString(),
      name: customer.name,
      contactName: "unchanged-update",
      contactEmail: null,
      contactPhone: null,
    });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);
  });

  test("stale expectedUpdatedAt returns CONFLICT and does not modify the row", async () => {
    const customer = await createTestCustomer("CONFLICT");
    const staleTimestamp = customer.updatedAt.toISOString();
    const first = await updateCustomer({
      customerId: customer.id,
      expectedUpdatedAt: staleTimestamp,
      name: customer.name,
      contactName: "v1",
      contactEmail: null,
      contactPhone: null,
    });
    assert.equal(first.ok, true);

    const result = await updateCustomer({
      customerId: customer.id,
      expectedUpdatedAt: staleTimestamp,
      name: customer.name,
      contactName: "v2-should-not-apply",
      contactEmail: null,
      contactPhone: null,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "CONFLICT");

    const [row] = await db.select().from(customers).where(eq(customers.id, customer.id));
    assert.equal(row.contactName, "v1", "the conflicting second update must not have applied");
  });

  test("NOT_FOUND for a nonexistent id and for an already soft-deleted customer", async () => {
    const missing = await updateCustomer({
      customerId: randomUUID(),
      expectedUpdatedAt: new Date().toISOString(),
      name: "x",
      contactName: null,
      contactEmail: null,
      contactPhone: null,
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.code, "NOT_FOUND");

    const customer = await createTestCustomer("DELETED-TARGET");
    await db.update(customers).set({ isDeleted: true }).where(eq(customers.id, customer.id));
    const result = await updateCustomer({
      customerId: customer.id,
      expectedUpdatedAt: customer.updatedAt.toISOString(),
      name: "y",
      contactName: null,
      contactEmail: null,
      contactPhone: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });

  test("concurrent rename race: two different customers renamed to the same normalized name at once — exactly one succeeds", async () => {
    const target = `${TEST_CUSTOMER_NAME_PREFIX}RACE-TARGET-${randomUUID().slice(0, 8)}`;
    const customerA = await createTestCustomer("RACE-A");
    const customerB = await createTestCustomer("RACE-B");

    const [resultA, resultB] = await Promise.all([
      updateCustomer({
        customerId: customerA.id,
        expectedUpdatedAt: customerA.updatedAt.toISOString(),
        name: target,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
      }),
      updateCustomer({
        customerId: customerB.id,
        expectedUpdatedAt: customerB.updatedAt.toISOString(),
        name: target,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
      }),
    ]);

    assert.deepEqual([resultA.ok, resultB.ok].sort(), [false, true], "exactly one of the two concurrent renames should succeed");
  });

  test("never rewrites an existing repair case's contact snapshot when the customer's master contact info changes", async () => {
    const customer = await createTestCustomer("SNAPSHOT");
    const created = await createRepairCase(
      baseCreateInput(customer.id, {
        contactName: "인수 시점 담당자",
        contactPhone: "010-1111-2222",
        contactEmail: "intake-snapshot@example.com",
      })
    );
    assert.equal(created.ok, true, `setup create failed: ${JSON.stringify(created)}`);
    if (!created.ok) return;

    const result = await updateCustomer({
      customerId: customer.id,
      expectedUpdatedAt: customer.updatedAt.toISOString(),
      name: customer.name,
      contactName: "새 마스터 담당자",
      contactEmail: "new-master@example.com",
      contactPhone: "010-9999-8888",
    });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const [caseRow] = await db.select().from(repairCases).where(eq(repairCases.id, created.id));
    assert.equal(caseRow.contactNameSnapshot, "인수 시점 담당자", "per-case snapshot must survive a customer-master contact edit unchanged");
    assert.equal(caseRow.contactPhoneSnapshot, "010-1111-2222");
    assert.equal(caseRow.contactEmailSnapshot, "intake-snapshot@example.com");
  });
});
