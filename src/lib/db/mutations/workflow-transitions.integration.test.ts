import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, like, ne } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  customers,
  users,
  products,
  repairCases,
  repairCaseIntakeSequences,
  statusChangeHistories,
  workflowSteps,
  workflowTemplates,
  workflowVersions,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import { transitionWorkflow } from "./workflow-transitions";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Real-DB integration test for transitionWorkflow(), the mutation behind
 * transition-workflow.ts's Server Action. Calls the mutation directly with
 * real DB user UUIDs (not through readSession()) — same layering choice
 * every other *.integration.test.ts file in this directory already makes,
 * and necessary here for an additional, pre-existing reason: this
 * codebase's only login path (DEMO_LOGIN_ENABLED) creates sessions from
 * mock-data.ts user ids ("u-001", ...), which never match a real `users.id`
 * UUID — see the final report's "remaining risks" for why that also
 * affects the shipped create/idempotency features, not just this one.
 *
 * Deliberately self-cleaning and isolated to test month "9904" (distinct
 * from every other isolated month already in use) and a "WORKFLOW-TEST-"
 * product prefix. Must never touch D2608, customers, users, End-Users, or
 * workflows.
 *
 * Approval-gated transitions (every workflow's SHIPMENT_COMPLETED, plus one
 * REPAIR_INSPECTION-gated advance per workflow) are now backed by
 * repair_case_approvals — see
 * workflow-transitions-approval-gating.integration.test.ts for the
 * dedicated suite proving those transitions actually succeed once a valid
 * approval exists. Test 12 below stays in *this* file only to confirm the
 * no-approval-yet rejection path leaves no side effects; tests 12/13 both
 * directly UPDATE test rows' current_workflow_step_id/is_locked in their
 * arrange phase (bypassing transitionWorkflow itself, clearly commented)
 * purely to reach the specific state under test, since no legitimate
 * transition chain can reach "waiting_shipment" without a satisfied
 * REPAIR_INSPECTION approval first.
 */

const TEST_RECEIVED_AT = "2099-04-10";
const TEST_SHIPMENT_DATE = "2099-04-20";
const TEST_MODEL_PREFIX = "WORKFLOW-TEST-";
const TEST_YEAR_MONTH = "9904";

let customerId: string;
let engineerId: string;
let adminId: string;
let salesId: string;
let matcherWorkflowVersionId: string;

before(async () => {
  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.isDeleted, false))
    .limit(1);
  assert.ok(customer, "expected at least one non-deleted customer in the dev DB");
  customerId = customer.id;

  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(engineer, "expected at least one approved AS_ENGINEER in the dev DB");
  engineerId = engineer.id;

  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        ne(users.role, "AS_ENGINEER"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false),
        eq(users.role, "ADMIN")
      )
    )
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

  const [sales] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SALES"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(sales, "expected at least one approved SALES user in the dev DB");
  salesId = sales.id;

  const [version] = await db
    .select({ id: workflowVersions.id })
    .from(workflowVersions)
    .innerJoin(workflowTemplates, eq(workflowVersions.workflowTemplateId, workflowTemplates.id))
    .where(and(eq(workflowTemplates.code, "MATCHER"), eq(workflowVersions.isCurrent, true)));
  assert.ok(version, "expected a PUBLISHED/current MATCHER workflow_versions row");
  matcherWorkflowVersionId = version.id;
});

after(async () => {
  // Deletion order: status_change_histories references repair_cases with
  // ON DELETE RESTRICT — delete history for each test case first.
  const testCaseIds = await db
    .select({ id: repairCases.id })
    .from(repairCases)
    .where(like(repairCases.intakeNumber, "D9904%"));
  if (testCaseIds.length > 0) {
    for (const { id } of testCaseIds) {
      await db.delete(statusChangeHistories).where(eq(statusChangeHistories.repairCaseId, id));
    }
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, "D9904%"));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await pgClient.end({ timeout: 5 });
});

function baseCreateInput(overrides: Partial<ValidatedCreateRepairCaseInput> = {}): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "MATCHER",
    customerId,
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

async function stepIdForKey(key: string): Promise<string> {
  const [step] = await db
    .select({ id: workflowSteps.id })
    .from(workflowSteps)
    .where(and(eq(workflowSteps.workflowVersionId, matcherWorkflowVersionId), eq(workflowSteps.key, key)));
  assert.ok(step, `expected workflow_steps row for MATCHER/${key}`);
  return step!.id;
}

describe("transitionWorkflow", () => {
  test("1. valid advance succeeds, 8. current step updates, 9. version increments exactly once", async () => {
    const created = await createTestCase();
    const result = await transitionWorkflow(created.id, 1, "STEP_ADVANCED", engineerId, null);
    assert.equal(result.ok, true, `advance failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.version, 2);
    assert.equal(result.currentWorkflowStepKey, "kyosan_contact_report_sent");

    const row = await fetchRow(created.id);
    assert.equal(row.version, 2);
    assert.equal(row.currentWorkflowStepId, await stepIdForKey("kyosan_contact_report_sent"));
  });

  test("2. valid return succeeds (ADMIN/SUPER_ADMIN, reason required)", async () => {
    const created = await createTestCase();
    const advanced = await transitionWorkflow(created.id, 1, "STEP_ADVANCED", engineerId, null);
    assert.equal(advanced.ok, true);
    if (!advanced.ok) return;

    const returned = await transitionWorkflow(created.id, advanced.version, "STEP_RETURNED", adminId, "지연 사유 확인");
    assert.equal(returned.ok, true, `return failed: ${JSON.stringify(returned)}`);
    if (!returned.ok) return;
    assert.equal(returned.currentWorkflowStepKey, "intake_inspection");
    assert.equal(returned.version, 3);
  });

  test("3. invalid transition (no such row) is rejected with INVALID_TRANSITION", async () => {
    const created = await createTestCase();
    // intake_inspection is MATCHER's first step — no STEP_RETURNED row exists from it.
    const result = await transitionWorkflow(created.id, 1, "STEP_RETURNED", adminId, "사유");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_TRANSITION");
  });

  test("4. role restriction is enforced (SALES cannot advance a TECHNICAL step)", async () => {
    const created = await createTestCase();
    const result = await transitionWorkflow(created.id, 1, "STEP_ADVANCED", salesId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("5. stale expectedVersion returns CONFLICT", async () => {
    const created = await createTestCase();
    const first = await transitionWorkflow(created.id, 1, "STEP_ADVANCED", engineerId, null);
    assert.equal(first.ok, true);

    const stale = await transitionWorkflow(created.id, 1, "STEP_ADVANCED", engineerId, null);
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.code, "CONFLICT");
  });

  test("6. two concurrent transitions with the same version: one success, one CONFLICT", async () => {
    const created = await createTestCase();
    const [a, b] = await Promise.all([
      transitionWorkflow(created.id, 1, "STEP_ADVANCED", engineerId, null),
      transitionWorkflow(created.id, 1, "STEP_ADVANCED", engineerId, null),
    ]);
    const successes = [a, b].filter((r) => r.ok);
    const conflicts = [a, b].filter((r) => !r.ok && r.code === "CONFLICT");
    assert.equal(successes.length, 1);
    assert.equal(conflicts.length, 1);

    const row = await fetchRow(created.id);
    assert.equal(row.version, 2, "version must have incremented exactly once, not twice");
  });

  test("7. history row is inserted exactly once per successful transition", async () => {
    const created = await createTestCase();
    const result = await transitionWorkflow(created.id, 1, "STEP_ADVANCED", engineerId, null);
    assert.equal(result.ok, true);

    const rows = await db
      .select()
      .from(statusChangeHistories)
      .where(eq(statusChangeHistories.repairCaseId, created.id));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actionType, "STEP_ADVANCED");
    assert.equal(rows[0].actorUserId, engineerId);
  });

  test("a CONFLICT does not leave a stray history row behind (insert rolls back with the failed update)", async () => {
    const created = await createTestCase();
    const first = await transitionWorkflow(created.id, 1, "STEP_ADVANCED", engineerId, null);
    assert.equal(first.ok, true);

    const stale = await transitionWorkflow(created.id, 1, "STEP_ADVANCED", engineerId, null);
    assert.equal(stale.ok, false);

    const rows = await db
      .select()
      .from(statusChangeHistories)
      .where(eq(statusChangeHistories.repairCaseId, created.id));
    assert.equal(rows.length, 1, "the stale/conflicting attempt must not have inserted a second history row");
  });

  test("10. hold requires a reason", async () => {
    const created = await createTestCase();
    const result = await transitionWorkflow(created.id, 1, "HOLD_STARTED", engineerId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "REASON_REQUIRED");
  });

  test("11. hold start + release hold works, and hold state is correctly derived afterward", async () => {
    const created = await createTestCase();
    const started = await transitionWorkflow(created.id, 1, "HOLD_STARTED", engineerId, "부품 대기");
    assert.equal(started.ok, true, `hold start failed: ${JSON.stringify(started)}`);
    if (!started.ok) return;
    assert.equal(started.currentWorkflowStepKey, "intake_inspection", "hold must not move the step");

    const released = await transitionWorkflow(created.id, started.version, "HOLD_RELEASED", engineerId, "부품 입고 완료");
    assert.equal(released.ok, true, `hold release failed: ${JSON.stringify(released)}`);

    const historyRows = await db
      .select({ actionType: statusChangeHistories.actionType })
      .from(statusChangeHistories)
      .where(eq(statusChangeHistories.repairCaseId, created.id))
      .orderBy(statusChangeHistories.createdAt);
    assert.deepEqual(
      historyRows.map((r) => r.actionType),
      ["HOLD_STARTED", "HOLD_RELEASED"]
    );

    // Starting hold again while already released must succeed (not stuck).
    const startedAgain = await transitionWorkflow(created.id, released.ok ? released.version : 0, "HOLD_STARTED", engineerId, "재보류");
    assert.equal(startedAgain.ok, true);

    // But starting hold while already on hold must fail.
    const doubleStart = await transitionWorkflow(
      created.id,
      startedAgain.ok ? startedAgain.version : 0,
      "HOLD_STARTED",
      engineerId,
      "재보류 시도"
    );
    assert.equal(doubleStart.ok, false);
    if (!doubleStart.ok) assert.equal(doubleStart.code, "INVALID_TRANSITION");
  });

  test("12. shipment completion without a granted approval is rejected with APPROVAL_REQUIRED and applies no side effects", async () => {
    const created = await createTestCase();
    // Arrange-only: directly place the case at "waiting_shipment" — no
    // legitimate transition chain can reach it without a satisfied
    // REPAIR_INSPECTION approval first (see module header comment). This
    // bypasses transitionWorkflow() entirely; it is not exercising product
    // code, only constructing the scenario under test.
    const waitingShipmentStepId = await stepIdForKey("waiting_shipment");
    await db.update(repairCases).set({ currentWorkflowStepId: waitingShipmentStepId }).where(eq(repairCases.id, created.id));

    const result = await transitionWorkflow(created.id, 1, "SHIPMENT_COMPLETED", adminId, "출하 메모");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "APPROVAL_REQUIRED");
      assert.match(result.message, /승인/);
    }

    const row = await fetchRow(created.id);
    assert.equal(row.isLocked, false, "a rejected shipment completion must not lock the case");
    assert.equal(row.actualShipmentDate, null);
    assert.equal(row.version, 1, "a rejected transition must not increment version");

    const historyRows = await db
      .select()
      .from(statusChangeHistories)
      .where(eq(statusChangeHistories.repairCaseId, created.id));
    assert.equal(historyRows.length, 0, "a rejected transition must not insert a history row");
  });

  test("13. a locked case blocks further transitions with CASE_LOCKED", async () => {
    const created = await createTestCase();
    // Arrange-only direct SQL — see test 12's note; there is no reachable
    // path to a real lock in this suite (locking only happens on a
    // successful SHIPMENT_COMPLETED, which is deferred).
    await db.update(repairCases).set({ isLocked: true }).where(eq(repairCases.id, created.id));

    const result = await transitionWorkflow(created.id, 1, "STEP_ADVANCED", engineerId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CASE_LOCKED");
  });

  test("missing repair case returns NOT_FOUND", async () => {
    const result = await transitionWorkflow(randomUUID(), 1, "STEP_ADVANCED", engineerId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });
});
