import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { customers, endUserContacts, endUsers, products, repairCaseIntakeSequences, repairCases, users } from "../schema";
import { createRepairCase } from "./repair-cases";
import {
  createEndUser,
  createEndUserContact,
  removeEndUserContact,
  renameEndUser,
  updateEndUserContact,
} from "./end-users";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Real-DB integration test against dss-as-postgres-dev, exercising the
 * End-User + multi-contact management mutation layer directly — same
 * layering choice customers.integration.test.ts makes for updateCustomer():
 * the session/role-authorization gate lives entirely in end-users.ts's
 * Server Actions (unit-tested separately in customer-authorization.test.ts)
 * and is not exercised here.
 *
 * Deliberately self-cleaning and isolated to a test-only customer-name
 * prefix ("AS-TEST-CUSTOMER-EU-") and intake month ("9805" — distinct from
 * every other integration test file's own reserved month; the intake
 * number's year-month is derived from receivedAt, so TEST_YEAR_MONTH and
 * TEST_RECEIVED_AT must always agree) so no two files ever race on the same
 * sequence row or customer namespace.
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-CUSTOMER-EU-";
const TEST_MODEL_PREFIX = "CUSTOMER-EU-TEST-";
const TEST_YEAR_MONTH = "9805";
const TEST_RECEIVED_AT = "2098-05-01";

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

  // Contacts before end_users (FK-restrict on end_user_id), end_users before
  // customers (FK-restrict on customer_id) — every End-User/contact created
  // by this file is always test-prefixed by name (createEndUser is always
  // called with a TEST_CUSTOMER_NAME_PREFIX-prefixed name here).
  const prefixedEndUsers = await db
    .select({ id: endUsers.id })
    .from(endUsers)
    .where(like(endUsers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  for (const eu of prefixedEndUsers) {
    await db.delete(endUserContacts).where(eq(endUserContacts.endUserId, eu.id));
  }
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

describe("createEndUser", () => {
  test("valid creation succeeds and returns id/name/updatedAt", async () => {
    const customer = await createTestCustomer("CREATE-OK");
    const result = await createEndUser({ customerId: customer.id, name: `${TEST_CUSTOMER_NAME_PREFIX}본사-${randomUUID().slice(0, 8)}` });
    assert.equal(result.ok, true, `create failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.ok(result.id);
    assert.ok(result.updatedAt);
  });

  test("duplicate normalized name under the same customer is rejected", async () => {
    const customer = await createTestCustomer("DUP");
    const name = `${TEST_CUSTOMER_NAME_PREFIX}지사-${randomUUID().slice(0, 8)}`;
    const first = await createEndUser({ customerId: customer.id, name });
    assert.equal(first.ok, true);

    const second = await createEndUser({ customerId: customer.id, name: `  ${name.toUpperCase()}  ` });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "VALIDATION_ERROR");
    assert.ok(second.fieldErrors?.name);
  });

  test("the same name is allowed under a DIFFERENT customer — scoped per customer, not global", async () => {
    const customerA = await createTestCustomer("SCOPE-A");
    const customerB = await createTestCustomer("SCOPE-B");
    const name = `${TEST_CUSTOMER_NAME_PREFIX}본사-${randomUUID().slice(0, 8)}`;

    const first = await createEndUser({ customerId: customerA.id, name });
    const second = await createEndUser({ customerId: customerB.id, name });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true, `expected the same name under a different customer to succeed: ${JSON.stringify(second)}`);
  });

  test("NOT_FOUND for a nonexistent customer", async () => {
    const result = await createEndUser({ customerId: randomUUID(), name: `${TEST_CUSTOMER_NAME_PREFIX}x` });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });

  test("concurrent creates with the same normalized name under the same customer — exactly one succeeds", async () => {
    const customer = await createTestCustomer("RACE");
    const name = `${TEST_CUSTOMER_NAME_PREFIX}RACE-${randomUUID().slice(0, 8)}`;

    const [a, b] = await Promise.all([
      createEndUser({ customerId: customer.id, name }),
      createEndUser({ customerId: customer.id, name }),
    ]);
    assert.deepEqual([a.ok, b.ok].sort(), [false, true], "exactly one of the two concurrent creates should succeed");
  });
});

describe("renameEndUser", () => {
  test("valid rename succeeds", async () => {
    const customer = await createTestCustomer("RENAME-OK");
    const created = await createEndUser({ customerId: customer.id, name: `${TEST_CUSTOMER_NAME_PREFIX}old-${randomUUID().slice(0, 8)}` });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const newName = `${TEST_CUSTOMER_NAME_PREFIX}new-${randomUUID().slice(0, 8)}`;
    const result = await renameEndUser({ endUserId: created.id, expectedUpdatedAt: created.updatedAt, name: newName });
    assert.equal(result.ok, true, `rename failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.name, newName);
  });

  test("renaming to another End-User's normalized name under the same customer is rejected", async () => {
    const customer = await createTestCustomer("RENAME-DUP");
    const a = await createEndUser({ customerId: customer.id, name: `${TEST_CUSTOMER_NAME_PREFIX}A-${randomUUID().slice(0, 8)}` });
    const b = await createEndUser({ customerId: customer.id, name: `${TEST_CUSTOMER_NAME_PREFIX}B-${randomUUID().slice(0, 8)}` });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    if (!a.ok || !b.ok) return;

    const result = await renameEndUser({ endUserId: b.id, expectedUpdatedAt: b.updatedAt, name: a.name });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "VALIDATION_ERROR");
  });

  test("stale expectedUpdatedAt returns CONFLICT and does not modify the row", async () => {
    const customer = await createTestCustomer("RENAME-CONFLICT");
    const created = await createEndUser({ customerId: customer.id, name: `${TEST_CUSTOMER_NAME_PREFIX}v1-${randomUUID().slice(0, 8)}` });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const staleTimestamp = created.updatedAt;
    const first = await renameEndUser({ endUserId: created.id, expectedUpdatedAt: staleTimestamp, name: `${TEST_CUSTOMER_NAME_PREFIX}v2-${randomUUID().slice(0, 8)}` });
    assert.equal(first.ok, true);

    const second = await renameEndUser({ endUserId: created.id, expectedUpdatedAt: staleTimestamp, name: `${TEST_CUSTOMER_NAME_PREFIX}v3-should-not-apply` });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "CONFLICT");
  });

  test("NOT_FOUND for a nonexistent End-User id", async () => {
    const result = await renameEndUser({ endUserId: randomUUID(), expectedUpdatedAt: new Date().toISOString(), name: "x" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });
});

describe("End-User contacts (create/update/remove)", () => {
  test("createEndUserContact: valid creation succeeds; contactEmail is optional", async () => {
    const customer = await createTestCustomer("CONTACT-OK");
    const endUser = await createEndUser({ customerId: customer.id, name: `${TEST_CUSTOMER_NAME_PREFIX}eu-${randomUUID().slice(0, 8)}` });
    assert.equal(endUser.ok, true);
    if (!endUser.ok) return;

    const result = await createEndUserContact({ endUserId: endUser.id, contactName: "김담당", contactEmail: null });
    assert.equal(result.ok, true, `create contact failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.contactName, "김담당");
    assert.equal(result.contactEmail, null);
  });

  test("createEndUserContact: NOT_FOUND for a nonexistent End-User", async () => {
    const result = await createEndUserContact({ endUserId: randomUUID(), contactName: "x", contactEmail: null });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });

  test("updateEndUserContact: valid update persists both fields", async () => {
    const customer = await createTestCustomer("CONTACT-EDIT");
    const endUser = await createEndUser({ customerId: customer.id, name: `${TEST_CUSTOMER_NAME_PREFIX}eu-${randomUUID().slice(0, 8)}` });
    assert.equal(endUser.ok, true);
    if (!endUser.ok) return;
    const contact = await createEndUserContact({ endUserId: endUser.id, contactName: "이전", contactEmail: null });
    assert.equal(contact.ok, true);
    if (!contact.ok) return;

    const result = await updateEndUserContact({
      contactId: contact.id,
      expectedUpdatedAt: contact.updatedAt,
      contactName: "이후",
      contactEmail: "after@example.test",
    });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.contactName, "이후");
    assert.equal(result.contactEmail, "after@example.test");
  });

  test("updateEndUserContact: stale expectedUpdatedAt returns CONFLICT", async () => {
    const customer = await createTestCustomer("CONTACT-CONFLICT");
    const endUser = await createEndUser({ customerId: customer.id, name: `${TEST_CUSTOMER_NAME_PREFIX}eu-${randomUUID().slice(0, 8)}` });
    assert.equal(endUser.ok, true);
    if (!endUser.ok) return;
    const contact = await createEndUserContact({ endUserId: endUser.id, contactName: "v1", contactEmail: null });
    assert.equal(contact.ok, true);
    if (!contact.ok) return;

    const staleTimestamp = contact.updatedAt;
    const first = await updateEndUserContact({ contactId: contact.id, expectedUpdatedAt: staleTimestamp, contactName: "v2", contactEmail: null });
    assert.equal(first.ok, true);

    const second = await updateEndUserContact({ contactId: contact.id, expectedUpdatedAt: staleTimestamp, contactName: "v3-should-not-apply", contactEmail: null });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "CONFLICT");
  });

  test("removeEndUserContact: soft-deletes — no longer returned as active, and a second removal is NOT_FOUND", async () => {
    const customer = await createTestCustomer("CONTACT-REMOVE");
    const endUser = await createEndUser({ customerId: customer.id, name: `${TEST_CUSTOMER_NAME_PREFIX}eu-${randomUUID().slice(0, 8)}` });
    assert.equal(endUser.ok, true);
    if (!endUser.ok) return;
    const contact = await createEndUserContact({ endUserId: endUser.id, contactName: "제거대상", contactEmail: null });
    assert.equal(contact.ok, true);
    if (!contact.ok) return;

    const actorUserId = engineerId;
    const result = await removeEndUserContact({ contactId: contact.id, expectedUpdatedAt: contact.updatedAt, actorUserId });
    assert.equal(result.ok, true, `remove failed: ${JSON.stringify(result)}`);

    const [row] = await db.select().from(endUserContacts).where(eq(endUserContacts.id, contact.id));
    assert.equal(row.isDeleted, true);
    assert.equal(row.deletedBy, actorUserId);

    // Already soft-deleted — NOT_FOUND regardless of expectedUpdatedAt, since
    // the row is no longer found among active contacts at all (the
    // concurrency check never even runs).
    const second = await removeEndUserContact({ contactId: contact.id, expectedUpdatedAt: contact.updatedAt, actorUserId });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "NOT_FOUND");
  });

  test("End-User + contact CRUD never touches an existing repair case's contact snapshot", async () => {
    const customer = await createTestCustomer("SNAPSHOT");
    const endUser = await createEndUser({ customerId: customer.id, name: `${TEST_CUSTOMER_NAME_PREFIX}snap-${randomUUID().slice(0, 8)}` });
    assert.equal(endUser.ok, true);
    if (!endUser.ok) return;

    const created = await createRepairCase(
      baseCreateInput(customer.id, {
        endUserId: endUser.id,
        contactName: "인수 시점 담당자",
        contactPhone: "010-1111-2222",
        contactEmail: "intake-snapshot@example.test",
      })
    );
    assert.equal(created.ok, true, `setup create failed: ${JSON.stringify(created)}`);
    if (!created.ok) return;

    const renamed = await renameEndUser({ endUserId: endUser.id, expectedUpdatedAt: endUser.updatedAt, name: `${endUser.name}-renamed` });
    assert.equal(renamed.ok, true);
    const contact = await createEndUserContact({ endUserId: endUser.id, contactName: "새 담당자", contactEmail: "new@example.test" });
    assert.equal(contact.ok, true);
    if (!contact.ok) return;
    const edited = await updateEndUserContact({ contactId: contact.id, expectedUpdatedAt: contact.updatedAt, contactName: "수정된 담당자", contactEmail: "edited@example.test" });
    assert.equal(edited.ok, true);
    if (!edited.ok) return;
    const removed = await removeEndUserContact({ contactId: contact.id, expectedUpdatedAt: edited.updatedAt, actorUserId: engineerId });
    assert.equal(removed.ok, true);

    const [caseRow] = await db.select().from(repairCases).where(eq(repairCases.id, created.id));
    assert.equal(caseRow.contactNameSnapshot, "인수 시점 담당자", "per-case snapshot must survive End-User/contact CRUD unchanged");
    assert.equal(caseRow.contactPhoneSnapshot, "010-1111-2222");
    assert.equal(caseRow.contactEmailSnapshot, "intake-snapshot@example.test");
  });
});
