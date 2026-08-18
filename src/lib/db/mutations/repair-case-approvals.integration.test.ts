import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  customers,
  users,
  products,
  repairCases,
  repairCaseIntakeSequences,
  repairCaseApprovals,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import { requestRepairCaseApproval, decideRepairCaseApproval } from "./repair-case-approvals";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Real-DB integration test for the approval request/decision mutations —
 * the core of the database-backed approval persistence task's final
 * report. Calls the mutations directly with real DB user UUIDs (not
 * through readSession()), same layering choice every other
 * *.integration.test.ts file in this directory already makes.
 *
 * Self-cleaning and isolated to test month "9906" / product prefix
 * "APPROVAL-TEST-", distinct from every other isolated-month suite in this
 * directory (9901/9902/9903/9904/9905). Must never touch D2608, customers,
 * users, End-Users, or workflows.
 */

const TEST_RECEIVED_AT = "2099-06-10";
const TEST_SHIPMENT_DATE = "2099-06-20";
const TEST_MODEL_PREFIX = "APPROVAL-TEST-";
const TEST_YEAR_MONTH = "9906";

let customerId: string;
let engineerId: string; // AS_ENGINEER, request-eligible, inspection-decide-eligible
let adminId: string; // ADMIN, NOT the shipment representative
let salesId: string; // SALES, not request-eligible
let representativeId: string; // SUPER_ADMIN with is_shipment_representative = true

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

  const [sales] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SALES"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(sales, "expected at least one approved SALES user in the dev DB");
  salesId = sales.id;

  const [representative] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isShipmentRepresentative, true), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(representative, "expected a seeded users.is_shipment_representative = true row");
  representativeId = representative.id;
});

after(async () => {
  const testCaseIds = await db
    .select({ id: repairCases.id })
    .from(repairCases)
    .where(like(repairCases.intakeNumber, "D9906%"));
  for (const { id } of testCaseIds) {
    await db.delete(repairCaseApprovals).where(eq(repairCaseApprovals.repairCaseId, id));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, "D9906%"));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await pgClient.end({ timeout: 5 });
});

function baseCreateInput(): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "MATCHER",
    billingType: "PAID",
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("requestRepairCaseApproval / decideRepairCaseApproval", () => {
  test("1. a valid REPAIR_INSPECTION request succeeds and stores the real requester UUID", async () => {
    const caseId = await createTestCase();
    const result = await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, "검수 요청합니다");
    assert.equal(result.ok, true, `request failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const [row] = await db.select().from(repairCaseApprovals).where(eq(repairCaseApprovals.id, result.id));
    assert.ok(row);
    assert.equal(row.status, "REQUESTED");
    assert.equal(row.requestedByUserId, engineerId);
    assert.match(row.requestedByUserId, UUID_PATTERN, "requester id must be a real UUID, never a mock-style id");
    assert.equal(row.requestReason, "검수 요청합니다");
  });

  test("3. a duplicate pending request is rejected with ALREADY_REQUESTED", async () => {
    const caseId = await createTestCase();
    const first = await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);
    assert.equal(first.ok, true);

    const second = await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "ALREADY_REQUESTED");
  });

  test("4. an unauthorized requester (SALES) is rejected with FORBIDDEN", async () => {
    const caseId = await createTestCase();
    const result = await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", salesId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("2. a FINAL_SHIPMENT request is blocked until REPAIR_INSPECTION is approved, then succeeds", async () => {
    const caseId = await createTestCase();

    const tooEarly = await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, null);
    assert.equal(tooEarly.ok, false);
    if (!tooEarly.ok) assert.equal(tooEarly.code, "FORBIDDEN");

    const inspectionRequest = await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);
    assert.equal(inspectionRequest.ok, true);
    const inspectionDecision = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", adminId, null);
    assert.equal(inspectionDecision.ok, true, `inspection approval failed: ${JSON.stringify(inspectionDecision)}`);

    const shipmentRequest = await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, "출하 승인 요청");
    assert.equal(shipmentRequest.ok, true, `shipment request failed: ${JSON.stringify(shipmentRequest)}`);
  });

  test("5/7. an unauthorized (non-representative) approver is rejected; the representative succeeds", async () => {
    const caseId = await createTestCase();
    await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);
    await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", adminId, null);
    await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, null);

    const byAdmin = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", adminId, null);
    assert.equal(byAdmin.ok, false);
    if (!byAdmin.ok) assert.equal(byAdmin.code, "FORBIDDEN");

    const byRepresentative = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", representativeId, null);
    assert.equal(byRepresentative.ok, true, `representative decision failed: ${JSON.stringify(byRepresentative)}`);
  });

  test("8. a second decision on an already-decided request is rejected with CONFLICT (double decision)", async () => {
    const caseId = await createTestCase();
    await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);
    const first = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", adminId, null);
    assert.equal(first.ok, true);

    const second = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "REJECTED", adminId, "재고");
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "CONFLICT");
  });

  test("6. self-approval is allowed (no restriction defined in local-demo mode either)", async () => {
    const caseId = await createTestCase();
    await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);
    const decision = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", engineerId, null);
    assert.equal(decision.ok, true, `self-approval unexpectedly rejected: ${JSON.stringify(decision)}`);
  });

  test("rejection requires a decision reason; a rejected request can be resubmitted", async () => {
    const caseId = await createTestCase();
    await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);

    const noReason = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "REJECTED", adminId, null);
    assert.equal(noReason.ok, false);
    if (!noReason.ok) assert.equal(noReason.code, "VALIDATION_ERROR");

    const rejected = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "REJECTED", adminId, "재작업 필요");
    assert.equal(rejected.ok, true);

    const resubmitted = await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, "재요청");
    assert.equal(resubmitted.ok, true, `resubmission failed: ${JSON.stringify(resubmitted)}`);

    const rows = await db
      .select()
      .from(repairCaseApprovals)
      .where(and(eq(repairCaseApprovals.repairCaseId, caseId), eq(repairCaseApprovals.approvalType, "REPAIR_INSPECTION")));
    assert.equal(rows.length, 2, "history must preserve both the rejected and the resubmitted rows");
    assert.equal(rows.filter((r) => r.status === "REJECTED").length, 1);
    assert.equal(rows.filter((r) => r.status === "REQUESTED").length, 1);
  });

  test("10. two concurrent decisions on the same request: exactly one succeeds, the other gets CONFLICT", async () => {
    const caseId = await createTestCase();
    await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);

    const [a, b] = await Promise.all([
      decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", adminId, null),
      decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "REJECTED", engineerId, "동시 처리 시도"),
    ]);
    const successes = [a, b].filter((r) => r.ok);
    const conflicts = [a, b].filter((r) => !r.ok && r.code === "CONFLICT");
    assert.equal(successes.length, 1, "exactly one decision must succeed");
    assert.equal(conflicts.length, 1, "the other must fail with CONFLICT");

    const decidedRows = await db
      .select()
      .from(repairCaseApprovals)
      .where(and(eq(repairCaseApprovals.repairCaseId, caseId), eq(repairCaseApprovals.approvalType, "REPAIR_INSPECTION")));
    assert.equal(decidedRows.length, 1, "no duplicate decision row must exist");
  });

  test("NOT_FOUND: missing repair case (request and decide)", async () => {
    const missingId = randomUUID();
    const requestResult = await requestRepairCaseApproval(missingId, "REPAIR_INSPECTION", engineerId, null);
    assert.equal(requestResult.ok, false);
    if (!requestResult.ok) assert.equal(requestResult.code, "NOT_FOUND");

    const decideResult = await decideRepairCaseApproval(missingId, "REPAIR_INSPECTION", "APPROVED", adminId, null);
    assert.equal(decideResult.ok, false);
    if (!decideResult.ok) assert.equal(decideResult.code, "NOT_FOUND");
  });

  test("NOT_FOUND: deciding a type that was never requested", async () => {
    const caseId = await createTestCase();
    const result = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", adminId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });

  test("CASE_LOCKED blocks a new approval request", async () => {
    const caseId = await createTestCase();
    // Arrange-only direct SQL — no legitimate path reaches isLocked=true
    // without a full SHIPMENT_COMPLETED transition (see
    // workflow-transitions.integration.test.ts's identical note).
    await db.update(repairCases).set({ isLocked: true }).where(eq(repairCases.id, caseId));

    const result = await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CASE_LOCKED");
  });
});
