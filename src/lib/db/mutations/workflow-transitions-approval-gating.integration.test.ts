import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, like, sql } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  customers,
  users,
  products,
  repairCases,
  repairCaseIntakeSequences,
  repairCaseApprovals,
  statusChangeHistories,
  workflowSteps,
  workflowTemplates,
  workflowVersions,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import { requestRepairCaseApproval, decideRepairCaseApproval } from "./repair-case-approvals";
import { transitionWorkflow } from "./workflow-transitions";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Real-DB integration test proving transitionWorkflow() actually enforces
 * (rather than unconditionally blocking) approval-gated transitions —
 * REPAIR_INSPECTION on MATCHER's power_on_test->waiting_kyosan_shipment_
 * approval advance, and FINAL_SHIPMENT on the terminal SHIPMENT_COMPLETED
 * action from waiting_shipment. This is the direct proof of the approval-
 * persistence task's core requirement: approval-gated transitions must work
 * end-to-end against real repair_case_approvals rows.
 *
 * Arrange-only direct SQL is used to place a case at power_on_test/
 * waiting_shipment — same documented, no-legitimate-path-exists pattern
 * workflow-transitions.integration.test.ts's tests 12/13 already use (a
 * full legitimate MATCHER chain is 16+ transitions deep and not the
 * behavior under test here).
 *
 * Self-cleaning and isolated to test month "9907" / product prefix
 * "APPROVALGATE-TEST-", distinct from every other isolated-month suite in
 * this directory.
 */

const TEST_RECEIVED_AT = "2099-07-10";
const TEST_SHIPMENT_DATE = "2099-07-20";
const TEST_MODEL_PREFIX = "APPROVALGATE-TEST-";
const TEST_YEAR_MONTH = "9907";

let customerId: string;
let engineerId: string;
let adminId: string;
let representativeId: string;
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
        eq(users.role, "ADMIN"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false),
        eq(users.isShipmentRepresentative, false)
      )
    )
    .limit(1);
  assert.ok(admin, "expected at least one approved, non-representative ADMIN in the dev DB");
  adminId = admin.id;

  const [representative] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isShipmentRepresentative, true), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(representative, "expected a seeded users.is_shipment_representative = true row");
  representativeId = representative.id;

  const [version] = await db
    .select({ id: workflowVersions.id })
    .from(workflowVersions)
    .innerJoin(workflowTemplates, eq(workflowVersions.workflowTemplateId, workflowTemplates.id))
    .where(and(eq(workflowTemplates.code, "MATCHER"), eq(workflowVersions.isCurrent, true)));
  assert.ok(version, "expected a PUBLISHED/current MATCHER workflow_versions row");
  matcherWorkflowVersionId = version.id;
});

after(async () => {
  const testCaseIds = await db
    .select({ id: repairCases.id })
    .from(repairCases)
    .where(like(repairCases.intakeNumber, "D9907%"));
  for (const { id } of testCaseIds) {
    await db.delete(repairCaseApprovals).where(eq(repairCaseApprovals.repairCaseId, id));
    await db.delete(statusChangeHistories).where(eq(statusChangeHistories.repairCaseId, id));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, "D9907%"));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await pgClient.end({ timeout: 5 });
});

function baseCreateInput(): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "MATCHER",
    customerId,
    endUserId: null,
    assignedEngineerId: engineerId,
    receivedAt: TEST_RECEIVED_AT,
    customerRequestedDueDate: null,
    internalTargetShipmentDate: TEST_SHIPMENT_DATE,
    modelName: `${TEST_MODEL_PREFIX}${randomUUID().slice(0, 8)}`,
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
  };
}

async function createTestCase() {
  const result = await createRepairCase(baseCreateInput());
  assert.equal(result.ok, true, `setup create failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result.id;
}

async function stepIdForKey(key: string): Promise<string> {
  const [step] = await db
    .select({ id: workflowSteps.id })
    .from(workflowSteps)
    .where(and(eq(workflowSteps.workflowVersionId, matcherWorkflowVersionId), eq(workflowSteps.key, key)));
  assert.ok(step, `expected workflow_steps row for MATCHER/${key}`);
  return step!.id;
}

async function placeCaseAtStep(caseId: string, key: string) {
  const stepId = await stepIdForKey(key);
  await db.update(repairCases).set({ currentWorkflowStepId: stepId }).where(eq(repairCases.id, caseId));
}

describe("transitionWorkflow: approval-gated transitions", () => {
  test("12. REPAIR_INSPECTION-gated advance is blocked with APPROVAL_REQUIRED when no approval exists", async () => {
    const caseId = await createTestCase();
    await placeCaseAtStep(caseId, "power_on_test");

    const result = await transitionWorkflow(caseId, 1, "STEP_ADVANCED", engineerId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "APPROVAL_REQUIRED");
  });

  test("REPAIR_INSPECTION-gated advance is blocked with APPROVAL_REQUIRED when the request was rejected", async () => {
    const caseId = await createTestCase();
    await placeCaseAtStep(caseId, "power_on_test");
    await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);
    await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "REJECTED", adminId, "재점검 필요");

    const result = await transitionWorkflow(caseId, 1, "STEP_ADVANCED", engineerId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "APPROVAL_REQUIRED");
  });

  test("13. REPAIR_INSPECTION-gated advance succeeds once a valid APPROVED approval exists", async () => {
    const caseId = await createTestCase();
    await placeCaseAtStep(caseId, "power_on_test");
    await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);
    const decision = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", adminId, null);
    assert.equal(decision.ok, true);

    const result = await transitionWorkflow(caseId, 1, "STEP_ADVANCED", engineerId, null);
    assert.equal(result.ok, true, `transition failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.version, 2);
    assert.equal(result.currentWorkflowStepKey, "waiting_kyosan_shipment_approval");
  });

  test("14. an approval requested before a material case edit is APPROVAL_STALE and blocks reuse", async () => {
    const caseId = await createTestCase();
    await placeCaseAtStep(caseId, "power_on_test");
    await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);
    const decision = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", adminId, null);
    assert.equal(decision.ok, true);

    // Arrange-only: simulate a material edit to the case bumping its
    // version, independent of the approval that was granted against
    // version 1 — mirrors what update-repair-case.ts's Server Action does
    // to repair_cases.version on every field edit.
    await db
      .update(repairCases)
      .set({ version: sql`${repairCases.version} + 1` })
      .where(eq(repairCases.id, caseId));

    const result = await transitionWorkflow(caseId, 2, "STEP_ADVANCED", engineerId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "APPROVAL_STALE");
  });

  test("15/16/17. FINAL_SHIPMENT-gated SHIPMENT_COMPLETED sets actualShipmentDate/isLocked, writes history, preserves approvals", async () => {
    const caseId = await createTestCase();
    await placeCaseAtStep(caseId, "waiting_shipment");

    await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);
    const inspectionDecision = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", adminId, null);
    assert.equal(inspectionDecision.ok, true);

    const shipmentRequest = await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, null);
    assert.equal(shipmentRequest.ok, true, `shipment request failed: ${JSON.stringify(shipmentRequest)}`);
    const shipmentDecision = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", representativeId, null);
    assert.equal(shipmentDecision.ok, true, `shipment decision failed: ${JSON.stringify(shipmentDecision)}`);

    const result = await transitionWorkflow(caseId, 1, "SHIPMENT_COMPLETED", representativeId, "출하 완료 메모");
    assert.equal(result.ok, true, `shipment completion failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.currentWorkflowStepKey, "shipment_completed");

    const [row] = await db.select().from(repairCases).where(eq(repairCases.id, caseId));
    assert.ok(row);
    assert.equal(row!.isLocked, true);
    assert.ok(row!.actualShipmentDate, "actualShipmentDate must be set on shipment completion");
    assert.equal(row!.version, 2);

    const historyRows = await db
      .select()
      .from(statusChangeHistories)
      .where(eq(statusChangeHistories.repairCaseId, caseId));
    assert.equal(historyRows.filter((h) => h.actionType === "SHIPMENT_COMPLETED").length, 1);

    const approvalRows = await db
      .select()
      .from(repairCaseApprovals)
      .where(eq(repairCaseApprovals.repairCaseId, caseId));
    assert.equal(approvalRows.length, 2, "both approval rows (inspection + shipment) must be preserved, not deleted");
    assert.ok(approvalRows.every((r) => r.status === "APPROVED"));

    // 18. Locked case blocks further transitions.
    const blocked = await transitionWorkflow(caseId, 2, "STEP_ADVANCED", engineerId, null);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "CASE_LOCKED");
  });
});
