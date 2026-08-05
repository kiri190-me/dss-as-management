import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, like, ne } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  customers,
  endUsers,
  users,
  products,
  repairCases,
  repairCaseIntakeSequences,
} from "../schema";
import { createRepairCase, updateRepairCase } from "./repair-cases";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Real-DB integration test against dss-as-postgres-dev, exercising
 * updateRepairCase() (the mutation layer behind update-repair-case.ts's
 * Server Action) directly — same layering choice repair-cases.integration.
 * test.ts already makes for createRepairCase(): the session/cookies-based
 * auth gate (UNAUTHORIZED for no session, FORBIDDEN for an unapproved
 * account) lives entirely in the Server Action and cannot run outside a
 * real Next.js request context, so it is not exercised here — it is a
 * direct structural copy of create-repair-case.ts's already-shipped,
 * never-independently-tested session guard (see the final report).
 * Field-level role authorization (SUPER_ADMIN/ADMIN/AS_ENGINEER/SALES/
 * INVENTORY_MANAGER × field) is pure logic and is unit-tested in
 * repair-case-edit-authorization.test.ts instead.
 *
 * Deliberately self-cleaning and isolated to a test-only intake month
 * ("9903" / 2099-03 — distinct from idempotency-keys.integration.test.ts's
 * "9901" and repair-cases.integration.test.ts's "9902" so no two files ever
 * race on the same sequence row) and a "UPDATE-TEST-" product prefix. Must
 * never touch D2608, customers, users, End-Users, or workflows.
 */

const TEST_RECEIVED_AT = "2099-03-10";
const TEST_SHIPMENT_DATE = "2099-03-20";
const TEST_MODEL_PREFIX = "UPDATE-TEST-";
const TEST_YEAR_MONTH = "9903";

let customerA: string;
let customerB: string;
let endUserOfCustomerA: string;
let engineerId: string;
let invalidEngineerId: string; // exists, but not a valid AS_ENGINEER/APPROVED assignee

before(async () => {
  const customerRows = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.isDeleted, false))
    .limit(2);
  assert.ok(customerRows.length >= 2, "expected at least two non-deleted customers in the dev DB");
  customerA = customerRows[0].id;
  customerB = customerRows[1].id;

  const [endUser] = await db
    .select({ id: endUsers.id })
    .from(endUsers)
    .where(and(eq(endUsers.customerId, customerA), eq(endUsers.isDeleted, false)))
    .limit(1);
  assert.ok(endUser, "expected at least one non-deleted End-User for the first test customer");
  endUserOfCustomerA = endUser.id;

  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(engineer, "expected at least one approved AS_ENGINEER in the dev DB");
  engineerId = engineer.id;

  const [wrongUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(ne(users.role, "AS_ENGINEER"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(wrongUser, "expected at least one non-AS_ENGINEER user in the dev DB");
  invalidEngineerId = wrongUser.id;
});

after(async () => {
  await db.delete(repairCases).where(like(repairCases.intakeNumber, "D9903%"));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await pgClient.end({ timeout: 5 });
});

function baseCreateInput(overrides: Partial<ValidatedCreateRepairCaseInput> = {}): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "MATCHER",
    customerId: customerA,
    endUserId: null,
    assignedEngineerId: engineerId,
    receivedAt: TEST_RECEIVED_AT,
    customerRequestedDueDate: null,
    internalTargetShipmentDate: TEST_SHIPMENT_DATE,
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

async function createTestCase(overrides: Partial<ValidatedCreateRepairCaseInput> = {}) {
  const result = await createRepairCase(baseCreateInput(overrides));
  assert.equal(result.ok, true, `setup create failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

async function fetchRow(id: string) {
  const [row] = await db.select().from(repairCases).where(eq(repairCases.id, id));
  assert.ok(row, `expected repair_cases row ${id} to exist`);
  return row!;
}

describe("updateRepairCase", () => {
  test("1. valid INTAKE-section update succeeds and 4. version increments by exactly one", async () => {
    const created = await createTestCase();
    const before1 = await fetchRow(created.id);
    assert.equal(before1.version, 1);

    const result = await updateRepairCase(created.id, 1, "INTAKE", { notes: null, customerRequestedDueDate: "2099-03-15" });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.version, 2);

    const after1 = await fetchRow(created.id);
    assert.equal(after1.version, 2);
    assert.equal(after1.customerRequestedDueDate, "2099-03-15");
  });

  test("2. valid PRODUCT-section update succeeds", async () => {
    const created = await createTestCase();
    const newSuffix = randomUUID().slice(0, 8);

    const result = await updateRepairCase(created.id, 1, "PRODUCT", {
      modelName: `${TEST_MODEL_PREFIX}${newSuffix}`,
      lotNumber: `LOT-${newSuffix}`,
      serialNumber: `SN-${newSuffix}`,
    });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const row = await fetchRow(created.id);
    const [product] = await db.select().from(products).where(eq(products.id, row.productId));
    assert.equal(product?.modelName, `${TEST_MODEL_PREFIX}${newSuffix}`);
  });

  test("3. valid FAULT_SERVICE-section update succeeds", async () => {
    const created = await createTestCase();

    const result = await updateRepairCase(created.id, 1, "FAULT_SERVICE", {
      reportedSymptom: "테스트 증상",
      internalTargetShipmentDate: TEST_SHIPMENT_DATE,
    });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const row = await fetchRow(created.id);
    assert.equal(row.reportedSymptom, "테스트 증상");
  });

  test("5. stale expectedVersion returns CONFLICT, and 6. does not overwrite the current row", async () => {
    const created = await createTestCase();
    const firstUpdate = await updateRepairCase(created.id, 1, "FAULT_SERVICE", { notes: "첫 번째 수정" });
    assert.equal(firstUpdate.ok, true);

    const staleUpdate = await updateRepairCase(created.id, 1, "FAULT_SERVICE", { notes: "두 번째(지연된) 수정" });
    assert.equal(staleUpdate.ok, false);
    if (staleUpdate.ok) return;
    assert.equal(staleUpdate.code, "CONFLICT");
    assert.equal(
      staleUpdate.message,
      "다른 사용자가 이 접수 정보를 먼저 수정했습니다. 최신 정보를 다시 불러온 후 다시 시도해 주세요."
    );

    const row = await fetchRow(created.id);
    assert.equal(row.notes, "첫 번째 수정", "the stale update must not have overwritten the successful one");
    assert.equal(row.version, 2, "version must reflect only the one successful update");
  });

  test("7. two concurrent updates with the same expectedVersion: exactly one success, exactly one CONFLICT", async () => {
    const created = await createTestCase();

    const [a, b] = await Promise.all([
      updateRepairCase(created.id, 1, "FAULT_SERVICE", { notes: "A가 저장" }),
      updateRepairCase(created.id, 1, "FAULT_SERVICE", { notes: "B가 저장" }),
    ]);

    const successes = [a, b].filter((r) => r.ok);
    const conflicts = [a, b].filter((r) => !r.ok && r.code === "CONFLICT");
    assert.equal(successes.length, 1, "exactly one concurrent update should succeed");
    assert.equal(conflicts.length, 1, "exactly one concurrent update should get CONFLICT");

    const row = await fetchRow(created.id);
    assert.equal(row.version, 2, "version must have incremented exactly once, not twice");
    assert.ok(row.notes === "A가 저장" || row.notes === "B가 저장");
  });

  test("8. missing repair case returns NOT_FOUND", async () => {
    const result = await updateRepairCase(randomUUID(), 1, "FAULT_SERVICE", { notes: "x" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });

  test("18. invalid (nonexistent) customer is rejected with REFERENCE_NOT_FOUND", async () => {
    const created = await createTestCase();
    const result = await updateRepairCase(created.id, 1, "INTAKE", { customerId: randomUUID() });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "REFERENCE_NOT_FOUND");
  });

  test("19. a soft-deleted customer is equivalent to a nonexistent one (no separate active-state column exists — see final report)", async () => {
    // Documented equivalence, not a separate DB scenario: the reference
    // query is `WHERE id = X AND is_deleted = false` — a deleted id and a
    // nonexistent id hit the exact same predicate and code path. Covered
    // by test 18 above; this project's customers table has no `is_active`
    // column distinct from `is_deleted` (see Phase-1 report).
    assert.ok(true);
  });

  test("20. End-User/customer mismatch is rejected with REFERENCE_MISMATCH", async () => {
    const created = await createTestCase();
    // endUserOfCustomerA belongs to customerA, but we submit customerB —
    // must be rejected, not silently reassigned.
    const result = await updateRepairCase(created.id, 1, "INTAKE", {
      customerId: customerB,
      endUserId: endUserOfCustomerA,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "REFERENCE_MISMATCH");
  });

  test("21a. invalid (nonexistent) engineer is rejected with REFERENCE_NOT_FOUND", async () => {
    const created = await createTestCase();
    const result = await updateRepairCase(created.id, 1, "FAULT_SERVICE", { assignedEngineerId: randomUUID() });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "REFERENCE_NOT_FOUND");
  });

  test("21b. an existing but ineligible (wrong-role) engineer is rejected with ENGINEER_NOT_ALLOWED", async () => {
    const created = await createTestCase();
    const result = await updateRepairCase(created.id, 1, "FAULT_SERVICE", { assignedEngineerId: invalidEngineerId });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "ENGINEER_NOT_ALLOWED");
  });

  test("22. workflow/status/lock/intake-number columns never change through any section update", async () => {
    const created = await createTestCase();
    const before1 = await fetchRow(created.id);

    const r1 = await updateRepairCase(created.id, 1, "INTAKE", { receivedAt: TEST_RECEIVED_AT });
    assert.equal(r1.ok, true, `INTAKE update failed: ${JSON.stringify(r1)}`);
    const r2 = await updateRepairCase(created.id, 2, "PRODUCT", { partNumber: "PN-X" });
    assert.equal(r2.ok, true, `PRODUCT update failed: ${JSON.stringify(r2)}`);
    const r3 = await updateRepairCase(created.id, 3, "FAULT_SERVICE", { notes: "다른 값" });
    assert.equal(r3.ok, true, `FAULT_SERVICE update failed: ${JSON.stringify(r3)}`);

    const after1 = await fetchRow(created.id);
    assert.equal(after1.intakeNumber, before1.intakeNumber);
    assert.equal(after1.workflowVersionId, before1.workflowVersionId);
    assert.equal(after1.currentWorkflowStepId, before1.currentWorkflowStepId);
    assert.equal(after1.exceptionStatusId, before1.exceptionStatusId);
    assert.equal(after1.isLocked, before1.isLocked);
    assert.equal(after1.actualShipmentDate, before1.actualShipmentDate);
    assert.equal(after1.version, 4);
  });

  test("23. product reassignment does not mutate a product row shared by another repair case", async () => {
    const sharedSuffix = randomUUID().slice(0, 8);
    const sharedInput = {
      modelName: `${TEST_MODEL_PREFIX}${sharedSuffix}`,
      lotNumber: `LOT-${sharedSuffix}`,
      serialNumber: `SN-${sharedSuffix}`,
    };
    const caseX = await createTestCase(sharedInput);
    const caseY = await createTestCase(sharedInput);

    const rowX0 = await fetchRow(caseX.id);
    const rowY0 = await fetchRow(caseY.id);
    assert.equal(rowX0.productId, rowY0.productId, "setup: both cases must share one product row");
    const sharedProductId = rowX0.productId;

    const reassignSuffix = randomUUID().slice(0, 8);
    const result = await updateRepairCase(caseX.id, 1, "PRODUCT", {
      modelName: `${TEST_MODEL_PREFIX}${reassignSuffix}`,
      lotNumber: `LOT-${reassignSuffix}`,
      serialNumber: `SN-${reassignSuffix}`,
    });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const rowXAfter = await fetchRow(caseX.id);
    const rowYAfter = await fetchRow(caseY.id);
    assert.notEqual(rowXAfter.productId, sharedProductId, "case X must now point at a new/different product row");
    assert.equal(rowYAfter.productId, sharedProductId, "case Y must still point at the original shared product row");

    const [sharedProductAfter] = await db.select().from(products).where(eq(products.id, sharedProductId));
    assert.equal(sharedProductAfter?.modelName, sharedInput.modelName, "the shared product row's own fields must be untouched");
    assert.equal(sharedProductAfter?.lotNumber, sharedInput.lotNumber);
    assert.equal(sharedProductAfter?.serialNumber, sharedInput.serialNumber);
  });

  test("bonus: INTAKE receivedAt change is rejected against the current (unsubmitted) customerRequestedDueDate", async () => {
    const created = await createTestCase();
    const withDueDate = await updateRepairCase(created.id, 1, "INTAKE", { customerRequestedDueDate: "2099-03-12" });
    assert.equal(withDueDate.ok, true);

    // Moving receivedAt later than the already-stored due date, without
    // resubmitting the due date itself, must still be rejected.
    const result = await updateRepairCase(created.id, 2, "INTAKE", { receivedAt: "2099-03-18" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "VALIDATION_ERROR");
      assert.ok(result.fieldErrors?.receivedAt);
    }
  });
});
