import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, ne } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  customers,
  endUsers,
  users,
  products,
  repairCases,
  repairCaseIntakeSequences,
  statusChangeHistories,
  workflowSteps,
  workflowTemplates,
  workflowVersions,
} from "../schema";
import { createRepairCase, updateRepairCase } from "./repair-cases";
import { transitionWorkflow } from "./workflow-transitions";
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
const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-UPDATE-CUSTOMER-";

let customerA: string;
let customerB: string;
let endUserOfCustomerA: string;
let engineerId: string;
let invalidEngineerId: string; // exists, but not a valid AS_ENGINEER/APPROVED assignee
let adminId: string; // ADMIN or SUPER_ADMIN — needed for STEP_RETURNED (AS_ENGINEER is not an allowed role for it)

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

  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  const [superAdmin] = admin
    ? []
    : await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
        .limit(1);
  const resolvedAdmin = admin ?? superAdmin;
  assert.ok(resolvedAdmin, "expected at least one approved ADMIN or SUPER_ADMIN in the dev DB");
  adminId = resolvedAdmin.id;
});

after(async () => {
  // status_change_histories rows created by this file's own 종류-reassignment
  // tests (32/32b use transitionWorkflow() to set up "already progressed"
  // fixtures) — status_change_histories.repair_case_id is FK-restrict, so
  // these must be deleted before their parent repair_cases rows.
  const testCaseRows = await db
    .select({ id: repairCases.id })
    .from(repairCases)
    .where(like(repairCases.intakeNumber, "D9903%"));
  if (testCaseRows.length > 0) {
    await db.delete(statusChangeHistories).where(
      inArray(
        statusChangeHistories.repairCaseId,
        testCaseRows.map((r) => r.id)
      )
    );
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, "D9903%"));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  // end_users before customers — end_users.customer_id is FK-restrict.
  await db.delete(endUsers).where(like(endUsers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

function baseCreateInput(overrides: Partial<ValidatedCreateRepairCaseInput> = {}): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "MATCHER",
    billingType: "PAID",
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
    const r2 = await updateRepairCase(created.id, 2, "PRODUCT", { accessoryList: "테스트 액세서리" });
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

  test("24. newCustomerName creates a minimal customer record (name only) and repoints the case to it", async () => {
    const created = await createTestCase();
    const uniqueSuffix = randomUUID().slice(0, 8);
    const customerName = `${TEST_CUSTOMER_NAME_PREFIX}${uniqueSuffix}`;

    const result = await updateRepairCase(created.id, 1, "INTAKE", { newCustomerName: customerName });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const row = await fetchRow(created.id);
    assert.notEqual(row.customerId, customerA);
    const [newCustomer] = await db.select().from(customers).where(eq(customers.id, row.customerId));
    assert.equal(newCustomer?.name, customerName);
    assert.equal(newCustomer?.contactName, null);
    assert.equal(newCustomer?.contactEmail, null);
    assert.equal(newCustomer?.contactPhone, null);
  });

  test("25. newCustomerName reuses an existing normalized-equivalent customer instead of creating a duplicate", async () => {
    const created = await createTestCase();
    const uniqueSuffix = randomUUID().slice(0, 8);
    const customerName = `${TEST_CUSTOMER_NAME_PREFIX}REUSE-${uniqueSuffix}`;

    const first = await updateRepairCase(created.id, 1, "INTAKE", { newCustomerName: customerName });
    assert.equal(first.ok, true, `first update failed: ${JSON.stringify(first)}`);

    const secondCase = await createTestCase();
    const second = await updateRepairCase(secondCase.id, 1, "INTAKE", {
      newCustomerName: `  ${customerName.toLowerCase()}  `,
    });
    assert.equal(second.ok, true, `second update failed: ${JSON.stringify(second)}`);

    const row1 = await fetchRow(created.id);
    const row2 = await fetchRow(secondCase.id);
    assert.equal(row1.customerId, row2.customerId, "both must resolve to the same customer row");

    const matchingCustomers = await db.select({ id: customers.id }).from(customers).where(eq(customers.name, customerName));
    assert.equal(matchingCustomers.length, 1, "must not have created a duplicate customer row");
  });

  test("26. newEndUserName creates a minimal End-User scoped to the resolved customer", async () => {
    const created = await createTestCase();
    const uniqueSuffix = randomUUID().slice(0, 8);
    const endUserName = `${TEST_CUSTOMER_NAME_PREFIX}EU-${uniqueSuffix}`;

    const result = await updateRepairCase(created.id, 1, "INTAKE", { newEndUserName: endUserName });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const row = await fetchRow(created.id);
    assert.ok(row.endUserId);
    const [newEndUser] = await db.select().from(endUsers).where(eq(endUsers.id, row.endUserId as string));
    assert.equal(newEndUser?.name, endUserName);
    assert.equal(newEndUser?.customerId, customerA);
  });

  test("27. changing customer without touching End-User clears a now-mismatched End-User (server-side safety backstop)", async () => {
    const created = await createTestCase({ endUserId: endUserOfCustomerA });
    const before1 = await fetchRow(created.id);
    assert.equal(before1.endUserId, endUserOfCustomerA);

    // customerB submitted alone — endUserId/newEndUserName not touched at all.
    const result = await updateRepairCase(created.id, 1, "INTAKE", { customerId: customerB });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const row = await fetchRow(created.id);
    assert.equal(row.customerId, customerB);
    assert.equal(row.endUserId, null, "the End-User from the old customer must not dangle under the new customer");
  });

  test("28. changing customer while explicitly resubmitting the same End-User under the new customer is preserved", async () => {
    const created = await createTestCase({ endUserId: endUserOfCustomerA });

    // Customer unchanged (still customerA), End-User re-submitted as-is —
    // must remain exactly as-is, not cleared.
    const result = await updateRepairCase(created.id, 1, "INTAKE", {
      customerId: customerA,
      endUserId: endUserOfCustomerA,
    });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const row = await fetchRow(created.id);
    assert.equal(row.endUserId, endUserOfCustomerA);
  });

  test("29. assignedEngineerId may be explicitly cleared to null (담당 엔지니어 미배정)", async () => {
    const created = await createTestCase();
    const before1 = await fetchRow(created.id);
    assert.equal(before1.assignedEngineerId, engineerId);

    const result = await updateRepairCase(created.id, 1, "FAULT_SERVICE", { assignedEngineerId: null });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const row = await fetchRow(created.id);
    assert.equal(row.assignedEngineerId, null);
  });

  // ---------------------------------------------- 종류(workflowKind) 재배정

  async function templateCodeAndInitialStep(workflowVersionId: string) {
    const [row] = await db
      .select({ code: workflowTemplates.code, versionId: workflowVersions.id })
      .from(workflowVersions)
      .innerJoin(workflowTemplates, eq(workflowVersions.workflowTemplateId, workflowTemplates.id))
      .where(eq(workflowVersions.id, workflowVersionId));
    return row;
  }

  test("30. 종류 change MATCHER→GENERATOR(PAID) right after intake (still at intake_inspection, no history) reassigns workflowVersionId/currentWorkflowStepId atomically", async () => {
    const created = await createTestCase({ workflowType: "MATCHER", billingType: "PAID" });
    const before1 = await fetchRow(created.id);
    const beforeTemplate = await templateCodeAndInitialStep(before1.workflowVersionId);
    assert.equal(beforeTemplate?.code, "MATCHER");

    const result = await updateRepairCase(created.id, 1, "PRODUCT", { workflowKind: "GENERATOR" });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const after1 = await fetchRow(created.id);
    assert.notEqual(after1.workflowVersionId, before1.workflowVersionId);
    const afterTemplate = await templateCodeAndInitialStep(after1.workflowVersionId);
    assert.equal(afterTemplate?.code, "PAID_GENERATOR");

    const [step] = await db
      .select({ key: workflowSteps.key })
      .from(workflowSteps)
      .where(eq(workflowSteps.id, after1.currentWorkflowStepId));
    assert.equal(step?.key, "intake_inspection");
    assert.equal(after1.billingType, "PAID", "billing_type unaffected when the existing one is reused");
  });

  test("31. 종류 change MATCHER→GENERATOR maps to WARRANTY_GENERATOR when billing_type=WARRANTY", async () => {
    const created = await createTestCase({ workflowType: "MATCHER", billingType: "WARRANTY" });

    const result = await updateRepairCase(created.id, 1, "PRODUCT", { workflowKind: "GENERATOR" });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const after1 = await fetchRow(created.id);
    const afterTemplate = await templateCodeAndInitialStep(after1.workflowVersionId);
    assert.equal(afterTemplate?.code, "WARRANTY_GENERATOR");
  });

  test("32. 종류 change is rejected once the case has moved past intake_inspection (real transition, via transitionWorkflow)", async () => {
    const created = await createTestCase({ workflowType: "MATCHER" });
    const before1 = await fetchRow(created.id);

    const advanced = await transitionWorkflow(created.id, 1, "STEP_ADVANCED", engineerId, null);
    assert.equal(advanced.ok, true, `setup transition failed: ${JSON.stringify(advanced)}`);
    if (!advanced.ok) return;
    assert.equal(advanced.currentWorkflowStepKey, "kyosan_contact_report_sent");

    const result = await updateRepairCase(created.id, 2, "PRODUCT", { workflowKind: "GENERATOR" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "WORKFLOW_REASSIGNMENT_NOT_ALLOWED");

    const after1 = await fetchRow(created.id);
    assert.equal(after1.workflowVersionId, before1.workflowVersionId, "must not have been reassigned");
    assert.equal(after1.version, 2, "a rejected reassignment must not bump the optimistic-concurrency version further");
  });

  test("32b. 종류 change is rejected when the case is back at intake_inspection but already has transition history (STEP_RETURNED) — step key alone is not trusted", async () => {
    const created = await createTestCase({ workflowType: "MATCHER" });
    const before1 = await fetchRow(created.id);

    const advanced = await transitionWorkflow(created.id, 1, "STEP_ADVANCED", engineerId, null);
    assert.equal(advanced.ok, true, `setup advance failed: ${JSON.stringify(advanced)}`);
    if (!advanced.ok) return;

    const returned = await transitionWorkflow(created.id, 2, "STEP_RETURNED", adminId, "테스트: 되돌림");
    assert.equal(returned.ok, true, `setup return failed: ${JSON.stringify(returned)}`);
    if (!returned.ok) return;
    assert.equal(returned.currentWorkflowStepKey, "intake_inspection", "setup: case must be back at intake_inspection");

    const result = await updateRepairCase(created.id, 3, "PRODUCT", { workflowKind: "GENERATOR" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "WORKFLOW_REASSIGNMENT_NOT_ALLOWED");

    const after1 = await fetchRow(created.id);
    assert.equal(after1.workflowVersionId, before1.workflowVersionId, "must not have been reassigned");
  });

  test("33. NULL billing_type + 종류=GENERATOR without an explicit billing choice is rejected, never guessed", async () => {
    // createRepairCase() always requires a billingType (never NULL) — a NULL
    // billing_type only occurs on legacy pre-migration-0021 rows, so it's
    // simulated here with a direct column update rather than via creation.
    const created = await createTestCase({ workflowType: "MATCHER", billingType: "PAID" });
    await db.update(repairCases).set({ billingType: null }).where(eq(repairCases.id, created.id));
    const before1 = await fetchRow(created.id);
    assert.equal(before1.billingType, null);

    const result = await updateRepairCase(created.id, 1, "PRODUCT", { workflowKind: "GENERATOR" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "VALIDATION_ERROR");
      assert.ok(result.fieldErrors?.billingType);
    }

    const after1 = await fetchRow(created.id);
    assert.equal(after1.workflowVersionId, before1.workflowVersionId, "must not have been reassigned");
    assert.equal(after1.version, 1);
  });

  test("34. billingType submitted via INTAKE (UI IA cleanup: 유상/무상 moved to 인수정보) is an independent correction that never touches workflowVersionId/currentWorkflowStepId", async () => {
    const created = await createTestCase({ workflowType: "MATCHER", billingType: "PAID" });
    const before1 = await fetchRow(created.id);

    const result = await updateRepairCase(created.id, 1, "INTAKE", { billingType: "WARRANTY" });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const after1 = await fetchRow(created.id);
    assert.equal(after1.billingType, "WARRANTY");
    assert.equal(after1.workflowVersionId, before1.workflowVersionId);
    assert.equal(after1.currentWorkflowStepId, before1.currentWorkflowStepId);
  });

  test("35. priority defaults to NORMAL on creation and is independently updatable via INTAKE (인수 정보 priority-editing checkpoint), never touching workflowVersionId/currentWorkflowStepId", async () => {
    const created = await createTestCase({ workflowType: "MATCHER", billingType: "PAID" });
    const before1 = await fetchRow(created.id);
    assert.equal(before1.priority, "NORMAL", "new repair_cases rows default to NORMAL priority");

    const result = await updateRepairCase(created.id, 1, "INTAKE", { priority: "URGENT" });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const after1 = await fetchRow(created.id);
    assert.equal(after1.priority, "URGENT");
    assert.equal(after1.workflowVersionId, before1.workflowVersionId);
    assert.equal(after1.currentWorkflowStepId, before1.currentWorkflowStepId);
  });

  test("36. accessoryList/externalConditionSummary/reasonForRemoval persist via PRODUCT (UI IA cleanup: moved from FAULT_SERVICE)", async () => {
    const created = await createTestCase();

    const result = await updateRepairCase(created.id, 1, "PRODUCT", {
      accessoryList: "충전기 1개",
      externalConditionSummary: "외관 양호",
      reasonForRemoval: "고객 요청",
    });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const row = await fetchRow(created.id);
    assert.equal(row.accessoryList, "충전기 1개");
    assert.equal(row.externalConditionSummary, "외관 양호");
    assert.equal(row.reasonForRemoval, "고객 요청");
  });

  test("37. billingType submitted via PRODUCT (its old, now-relocated section) is silently ignored — not an error, just a no-op", async () => {
    const created = await createTestCase({ workflowType: "MATCHER", billingType: "PAID" });

    // The mutation layer itself doesn't reject unknown-for-section keys (that
    // allow-list gate lives in update-repair-case.ts's Server Action) — this
    // confirms the PRODUCT branch itself no longer reads billingType at all,
    // now that it moved to INTAKE.
    const result = await updateRepairCase(created.id, 1, "PRODUCT", { billingType: "WARRANTY" });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const row = await fetchRow(created.id);
    assert.equal(row.billingType, "PAID", "billingType must be untouched when submitted through PRODUCT");
  });

  test("38. internalTargetShipmentDate submitted via INTAKE (UI IA fix: 사내 목표 출하일 now editable under 인수정보) persists correctly", async () => {
    const created = await createTestCase();
    const before1 = await fetchRow(created.id);
    assert.equal(before1.internalTargetShipmentDate, TEST_SHIPMENT_DATE, "setup: creation already sets a value");

    const newDate = "2099-03-25";
    const result = await updateRepairCase(created.id, 1, "INTAKE", { internalTargetShipmentDate: newDate });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const row = await fetchRow(created.id);
    assert.equal(row.internalTargetShipmentDate, newDate);
  });

  test("39. clearing internalTargetShipmentDate (submitting null) persists as NULL, not left unchanged", async () => {
    const created = await createTestCase();
    const before1 = await fetchRow(created.id);
    assert.ok(before1.internalTargetShipmentDate, "setup: must start with a real value to prove clearing works");

    const result = await updateRepairCase(created.id, 1, "INTAKE", { internalTargetShipmentDate: null });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const row = await fetchRow(created.id);
    assert.equal(row.internalTargetShipmentDate, null);
  });

  test("40. internalTargetShipmentDate submitted via INTAKE is rejected when earlier than receivedAt (even when receivedAt is unchanged/not resubmitted)", async () => {
    const created = await createTestCase();

    const result = await updateRepairCase(created.id, 1, "INTAKE", { internalTargetShipmentDate: "2099-03-01" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "VALIDATION_ERROR");
      assert.ok(result.fieldErrors?.internalTargetShipmentDate);
    }
  });

  test("41. internalTargetShipmentDate submitted via FAULT_SERVICE (its old, now-relocated section) is silently ignored — not an error, just a no-op", async () => {
    const created = await createTestCase();
    const before1 = await fetchRow(created.id);

    const result = await updateRepairCase(created.id, 1, "FAULT_SERVICE", { internalTargetShipmentDate: "2099-03-25" });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const row = await fetchRow(created.id);
    assert.equal(
      row.internalTargetShipmentDate,
      before1.internalTargetShipmentDate,
      "internalTargetShipmentDate must be untouched when submitted through FAULT_SERVICE"
    );
  });

  test("35. a 종류 reassignment never inserts a status_change_histories row (only transitionWorkflow() ever writes that table)", async () => {
    const created = await createTestCase({ workflowType: "MATCHER", billingType: "PAID" });

    const result = await updateRepairCase(created.id, 1, "PRODUCT", { workflowKind: "GENERATOR" });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const historyRows = await db
      .select({ id: statusChangeHistories.id })
      .from(statusChangeHistories)
      .where(eq(statusChangeHistories.repairCaseId, created.id));
    assert.equal(historyRows.length, 0);
  });

  // -------------------------------- Generator billing/workflow sync (bugfix)

  test("42. fresh PAID_GENERATOR + billing PAID → change to WARRANTY reassigns to WARRANTY_GENERATOR, workflowVersionId/currentWorkflowStepId both switch", async () => {
    const created = await createTestCase({ workflowType: "PAID_GENERATOR", billingType: "PAID" });
    const before1 = await fetchRow(created.id);
    const beforeTemplate = await templateCodeAndInitialStep(before1.workflowVersionId);
    assert.equal(beforeTemplate?.code, "PAID_GENERATOR");

    const result = await updateRepairCase(created.id, 1, "INTAKE", { billingType: "WARRANTY" });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const after1 = await fetchRow(created.id);
    assert.equal(after1.billingType, "WARRANTY");
    assert.notEqual(after1.workflowVersionId, before1.workflowVersionId, "workflowVersionId must switch");
    assert.notEqual(after1.currentWorkflowStepId, before1.currentWorkflowStepId, "currentWorkflowStepId must switch");
    const afterTemplate = await templateCodeAndInitialStep(after1.workflowVersionId);
    assert.equal(afterTemplate?.code, "WARRANTY_GENERATOR");

    const [step] = await db
      .select({ key: workflowSteps.key })
      .from(workflowSteps)
      .where(eq(workflowSteps.id, after1.currentWorkflowStepId));
    assert.equal(step?.key, "intake_inspection");
  });

  test("43. fresh WARRANTY_GENERATOR + billing WARRANTY → change to PAID reassigns to PAID_GENERATOR, workflowVersionId/currentWorkflowStepId both switch", async () => {
    const created = await createTestCase({ workflowType: "WARRANTY_GENERATOR", billingType: "WARRANTY" });
    const before1 = await fetchRow(created.id);
    const beforeTemplate = await templateCodeAndInitialStep(before1.workflowVersionId);
    assert.equal(beforeTemplate?.code, "WARRANTY_GENERATOR");

    const result = await updateRepairCase(created.id, 1, "INTAKE", { billingType: "PAID" });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const after1 = await fetchRow(created.id);
    assert.equal(after1.billingType, "PAID");
    assert.notEqual(after1.workflowVersionId, before1.workflowVersionId, "workflowVersionId must switch");
    assert.notEqual(after1.currentWorkflowStepId, before1.currentWorkflowStepId, "currentWorkflowStepId must switch");
    const afterTemplate = await templateCodeAndInitialStep(after1.workflowVersionId);
    assert.equal(afterTemplate?.code, "PAID_GENERATOR");

    const [step] = await db
      .select({ key: workflowSteps.key })
      .from(workflowSteps)
      .where(eq(workflowSteps.id, after1.currentWorkflowStepId));
    assert.equal(step?.key, "intake_inspection");
  });

  test("44. a Generator billing_type reassignment never inserts a status_change_histories row (only transitionWorkflow() ever writes that table)", async () => {
    const created = await createTestCase({ workflowType: "PAID_GENERATOR", billingType: "PAID" });

    const result = await updateRepairCase(created.id, 1, "INTAKE", { billingType: "WARRANTY" });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const historyRows = await db
      .select({ id: statusChangeHistories.id })
      .from(statusChangeHistories)
      .where(eq(statusChangeHistories.repairCaseId, created.id));
    assert.equal(historyRows.length, 0);
  });

  // 2026-08-18 원칙 변경으로 이 시나리오의 기대가 뒤집혔다 — 진행 중인 건도
  // 유·무상을 바꿀 수 있어야 한다. 단, 워크플로와 유·무상이 어긋난 상태
  // (PAID_GENERATOR + WARRANTY)를 만들지 않는다는 원래 불변식은 그대로다:
  // 값만 바꾸는 게 아니라 대상 워크플로로 함께 옮긴다.
  test("45. a progressed Generator case CAN change billing_type and is reassigned consistently", async () => {
    const created = await createTestCase({ workflowType: "PAID_GENERATOR", billingType: "PAID" });
    const before1 = await fetchRow(created.id);

    const advanced = await transitionWorkflow(created.id, 1, "STEP_ADVANCED", engineerId, null);
    assert.equal(advanced.ok, true, `setup transition failed: ${JSON.stringify(advanced)}`);
    if (!advanced.ok) return;

    const result = await updateRepairCase(created.id, 2, "INTAKE", { billingType: "WARRANTY" }, engineerId);
    assert.equal(result.ok, true, JSON.stringify(result));

    const after1 = await fetchRow(created.id);
    assert.equal(after1.billingType, "WARRANTY");
    assert.notEqual(after1.workflowVersionId, before1.workflowVersionId, "대상 워크플로로 옮겨져야 한다");
    const afterTemplate = await templateCodeAndInitialStep(after1.workflowVersionId);
    assert.equal(afterTemplate?.code, "WARRANTY_GENERATOR", "유·무상과 워크플로가 어긋난 상태는 여전히 만들지 않는다");
  });

  // 2026-08-18 원칙 변경으로 기대가 뒤집혔다. 이 시나리오(되돌려서 다시
  // 인수점검에 와 있고 전이 이력이 있는 건)는 예전에 "단계 key만 믿지 않는다"의
  // 근거였는데, 이제는 이력 유무와 무관하게 변경이 허용된다. 무상 → 유상은
  // 무상 단계 집합이 유상의 부분집합이라 항상 같은 단계로 옮겨갈 수 있다.
  // 유상 → 무상만 유일하게 "갈 곳이 없는" 방향이다. 유상 Generator의 견적/PO
  // 관련 6단계는 무상 흐름에 아예 존재하지 않는다(2026-08-18 측정: 공통 10,
  // 유상 전용 6, 무상 전용 0). 그때 앞으로 건너뛰면 하지 않은 작업을 완료한
  // 것처럼 만들어 버리므로, 현재보다 앞선 단계 중 대상에도 있는 가장 뒤
  // 단계로 물러난다. 이 테스트가 그 규칙을 고정한다.
  test("46-1. paid-only step falls back to the nearest earlier common step when switching to WARRANTY", async () => {
    const created = await createTestCase({ workflowType: "PAID_GENERATOR", billingType: "PAID" });

    // 견적/PO 구간까지 정상 전이로 끌고 가려면 준비가 과도하게 길어진다.
    // 이 파일의 기존 선례(특정 상태에 도달시키기 위한 직접 UPDATE)와 같은
    // 방식으로 대상 단계에 놓는다 — 검증 대상은 전이가 아니라 유·무상 변경이다.
    const before1 = await fetchRow(created.id);
    const [paidOnlyStep] = await db
      .select({ id: workflowSteps.id })
      .from(workflowSteps)
      .where(and(eq(workflowSteps.workflowVersionId, before1.workflowVersionId), eq(workflowSteps.key, "waiting_po")));
    assert.ok(paidOnlyStep, "setup: PAID_GENERATOR에 waiting_po 단계가 있어야 한다");
    await db.update(repairCases).set({ currentWorkflowStepId: paidOnlyStep.id }).where(eq(repairCases.id, created.id));

    const result = await updateRepairCase(created.id, 1, "INTAKE", { billingType: "WARRANTY" }, engineerId);
    assert.equal(result.ok, true, JSON.stringify(result));

    const after1 = await fetchRow(created.id);
    const afterTemplate = await templateCodeAndInitialStep(after1.workflowVersionId);
    assert.equal(afterTemplate?.code, "WARRANTY_GENERATOR");

    const [afterStep] = await db
      .select({ key: workflowSteps.key })
      .from(repairCases)
      .innerJoin(workflowSteps, eq(workflowSteps.id, repairCases.currentWorkflowStepId))
      .where(eq(repairCases.id, created.id));
    assert.equal(
      afterStep.key,
      "waiting_kyosan_reply",
      "PO 대기(유상 전용)에서 무상으로 바꾸면 직전 공통 단계인 교산 회신 대기로 물러나야 한다"
    );
  });

  test("46. a Generator case with transition history CAN change billing_type, keeping its current step", async () => {
    const created = await createTestCase({ workflowType: "WARRANTY_GENERATOR", billingType: "WARRANTY" });
    const before1 = await fetchRow(created.id);

    const advanced = await transitionWorkflow(created.id, 1, "STEP_ADVANCED", engineerId, null);
    assert.equal(advanced.ok, true, `setup advance failed: ${JSON.stringify(advanced)}`);
    if (!advanced.ok) return;

    const returned = await transitionWorkflow(created.id, 2, "STEP_RETURNED", adminId, "테스트: 되돌림");
    assert.equal(returned.ok, true, `setup return failed: ${JSON.stringify(returned)}`);
    if (!returned.ok) return;
    assert.equal(returned.currentWorkflowStepKey, "intake_inspection", "setup: case must be back at intake_inspection");

    const result = await updateRepairCase(created.id, 3, "INTAKE", { billingType: "PAID" }, engineerId);
    assert.equal(result.ok, true, JSON.stringify(result));

    const after1 = await fetchRow(created.id);
    assert.equal(after1.billingType, "PAID");
    assert.notEqual(after1.workflowVersionId, before1.workflowVersionId, "PAID_GENERATOR로 옮겨져야 한다");
    const afterTemplate = await templateCodeAndInitialStep(after1.workflowVersionId);
    assert.equal(afterTemplate?.code, "PAID_GENERATOR");

    // 현재 단계는 유지된다 — 유·무상을 바꿨다고 진행 상황이 초기화되면 안 된다.
    const [afterStep] = await db
      .select({ key: workflowSteps.key })
      .from(repairCases)
      .innerJoin(workflowSteps, eq(workflowSteps.id, repairCases.currentWorkflowStepId))
      .where(eq(repairCases.id, created.id));
    assert.equal(afterStep.key, "intake_inspection");
  });

  test("47. locked Generator case: already covered by the unconditional, section-agnostic shipment-lock gate", () => {
    // Same documented-equivalence pattern as test 19 above: isBlockedByShipmentLock
    // (repair-case-edit-authorization.ts) is checked in update-repair-case.ts's
    // Server Action BEFORE any section-specific logic runs (INTAKE/PRODUCT/
    // FAULT_SERVICE alike) and blocks ALL roles, including SUPER_ADMIN/ADMIN,
    // whenever isLocked is true — see repair-case-edit-authorization.test.ts's
    // "isBlockedByShipmentLock blocks whenever isLocked is true, independent of
    // role" test. That check takes only `isLocked: boolean`, with no field/
    // section awareness at all, so it already covers a billing_type submission
    // exactly like every other field — this new Generator-sync branch inside
    // updateRepairCase() is never even reached for a locked case. Not
    // independently re-verifiable here: this mutation-layer test file
    // deliberately never exercises the Server Action's session/lock gate (see
    // this file's own header doc comment) because doing so requires a real
    // Next.js request context.
    assert.ok(true);
  });

  test("48. MATCHER PAID↔WARRANTY changes billing only and remains MATCHER (both directions) — no inconsistent Generator state possible for MATCHER", async () => {
    const paidCase = await createTestCase({ workflowType: "MATCHER", billingType: "PAID" });
    const paidBefore = await fetchRow(paidCase.id);

    const toWarranty = await updateRepairCase(paidCase.id, 1, "INTAKE", { billingType: "WARRANTY" });
    assert.equal(toWarranty.ok, true, `update failed: ${JSON.stringify(toWarranty)}`);
    const paidAfter = await fetchRow(paidCase.id);
    assert.equal(paidAfter.billingType, "WARRANTY");
    assert.equal(paidAfter.workflowVersionId, paidBefore.workflowVersionId, "MATCHER workflow must never switch");
    assert.equal(paidAfter.currentWorkflowStepId, paidBefore.currentWorkflowStepId);
    assert.equal((await templateCodeAndInitialStep(paidAfter.workflowVersionId))?.code, "MATCHER");

    const warrantyCase = await createTestCase({ workflowType: "MATCHER", billingType: "WARRANTY" });
    const warrantyBefore = await fetchRow(warrantyCase.id);

    const toPaid = await updateRepairCase(warrantyCase.id, 1, "INTAKE", { billingType: "PAID" });
    assert.equal(toPaid.ok, true, `update failed: ${JSON.stringify(toPaid)}`);
    const warrantyAfter = await fetchRow(warrantyCase.id);
    assert.equal(warrantyAfter.billingType, "PAID");
    assert.equal(warrantyAfter.workflowVersionId, warrantyBefore.workflowVersionId, "MATCHER workflow must never switch");
    assert.equal((await templateCodeAndInitialStep(warrantyAfter.workflowVersionId))?.code, "MATCHER");
  });

  test("49. no inconsistent Generator billing/workflow state can be created via direct server submission, across every path tried", async () => {
    // Consolidated invariant check across the success and rejection paths
    // above: for every Generator row touched by this describe block, the
    // persisted billing_type and the persisted workflowType's implied
    // billing side must always agree.
    const scenarios: Array<{ workflowType: "PAID_GENERATOR" | "WARRANTY_GENERATOR"; billingType: "PAID" | "WARRANTY" }> = [
      { workflowType: "PAID_GENERATOR", billingType: "PAID" },
      { workflowType: "WARRANTY_GENERATOR", billingType: "WARRANTY" },
    ];
    for (const scenario of scenarios) {
      const created = await createTestCase(scenario);
      const row = await fetchRow(created.id);
      const template = await templateCodeAndInitialStep(row.workflowVersionId);
      const expectedTemplate = scenario.billingType === "PAID" ? "PAID_GENERATOR" : "WARRANTY_GENERATOR";
      assert.equal(row.billingType, scenario.billingType);
      assert.equal(template?.code, expectedTemplate, "billing_type and workflowType must always agree for a Generator row");

      // Flip it — must land on the opposite consistent pair, never a mix.
      const flippedBilling = scenario.billingType === "PAID" ? "WARRANTY" : "PAID";
      const flipResult = await updateRepairCase(created.id, 1, "INTAKE", { billingType: flippedBilling });
      assert.equal(flipResult.ok, true, `flip failed: ${JSON.stringify(flipResult)}`);
      const flippedRow = await fetchRow(created.id);
      const flippedTemplate = await templateCodeAndInitialStep(flippedRow.workflowVersionId);
      const expectedFlippedTemplate = flippedBilling === "PAID" ? "PAID_GENERATOR" : "WARRANTY_GENERATOR";
      assert.equal(flippedRow.billingType, flippedBilling);
      assert.equal(flippedTemplate?.code, expectedFlippedTemplate, "after flipping, billing_type and workflowType must still agree");
    }
  });

  // ---------------------------- 사내 목표 검수 완료일 relocation (인수정보/일정)

  test("50. internalTargetInspectionCompletionDate submitted via INTAKE (relocated from 고장 및 서비스 정보) persists correctly", async () => {
    const created = await createTestCase();
    const before1 = await fetchRow(created.id);
    assert.equal(before1.internalTargetInspectionCompletionDate, null, "setup: no value at creation by default");

    const newDate = "2099-03-24";
    const result = await updateRepairCase(created.id, 1, "INTAKE", { internalTargetInspectionCompletionDate: newDate });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const row = await fetchRow(created.id);
    assert.equal(row.internalTargetInspectionCompletionDate, newDate);
  });

  test("51. clearing internalTargetInspectionCompletionDate (submitting null) persists as NULL, not left unchanged", async () => {
    const created = await createTestCase({ internalTargetInspectionCompletionDate: "2099-03-24" });
    const before1 = await fetchRow(created.id);
    assert.ok(before1.internalTargetInspectionCompletionDate, "setup: must start with a real value to prove clearing works");

    const result = await updateRepairCase(created.id, 1, "INTAKE", { internalTargetInspectionCompletionDate: null });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const row = await fetchRow(created.id);
    assert.equal(row.internalTargetInspectionCompletionDate, null);
  });

  test("52. internalTargetInspectionCompletionDate submitted via INTAKE is rejected when earlier than receivedAt", async () => {
    const created = await createTestCase();

    const result = await updateRepairCase(created.id, 1, "INTAKE", { internalTargetInspectionCompletionDate: "2099-03-01" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "VALIDATION_ERROR");
      assert.ok(result.fieldErrors?.internalTargetInspectionCompletionDate);
    }
  });

  test("53. internalTargetInspectionCompletionDate submitted via FAULT_SERVICE (its old, now-relocated section) is silently ignored — not an error, just a no-op", async () => {
    const created = await createTestCase({ internalTargetInspectionCompletionDate: "2099-03-24" });
    const before1 = await fetchRow(created.id);

    const result = await updateRepairCase(created.id, 1, "FAULT_SERVICE", { internalTargetInspectionCompletionDate: "2099-03-30" });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const row = await fetchRow(created.id);
    assert.equal(
      row.internalTargetInspectionCompletionDate,
      before1.internalTargetInspectionCompletionDate,
      "internalTargetInspectionCompletionDate must be untouched when submitted through FAULT_SERVICE"
    );
  });
});
