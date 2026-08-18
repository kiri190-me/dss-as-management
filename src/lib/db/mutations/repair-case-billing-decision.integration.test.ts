import "../../../../scripts/load-env";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  auditLogs, customers, productModels, products, repairCaseBillingDecisionHistories,
  repairCaseFlowchartEditHistory, repairCaseFlowchartNodes, repairCaseFlowcharts,
  repairCaseIdempotencyKeys, repairCaseWorkRecords, repairCases, users,
  workflowSteps, workflowTemplates, workflowVersions,
} from "../schema";
import { createRepairCaseWithIdempotency } from "@/lib/server/services/create-repair-case";
import type { IntakeSubmissionInput } from "@/lib/domain/local/submit-intake";
import { resolveRepairCaseBillingDecision } from "./repair-case-billing-decision";
import { transitionWorkflow } from "./workflow-transitions";
import { requestRepairCaseApproval } from "./repair-case-approvals";
import { createWorkRecord, invalidateWorkRecord } from "./repair-case-work-records";
import { startProcedureExecution } from "./procedure-case-execution";
import { createRepairCaseFlowchart, updateRepairCaseFlowchartMetadata } from "./repair-case-flowcharts";
import { createRepairCaseFlowchartNode } from "./repair-case-flowchart-graph";
import { createPartRequest } from "./inventory-part-requests";
import { consumeStock } from "./inventory";

const runToken = randomUUID().slice(0, 8);
const createdCaseIds: string[] = [];
const createdProductIds: string[] = [];
const createdIdempotencyKeys: string[] = [];
const createdFlowchartIds: string[] = [];
const createdWorkRecordIds: string[] = [];

let customerId: string;
let productModelId: string;
let adminId: string;
let engineerId: string;

before(async () => {
  const [customer] = await db.select({ id: customers.id }).from(customers).where(eq(customers.isDeleted, false)).limit(1);
  const [model] = await db.select({ id: productModels.id }).from(productModels).where(eq(productModels.isDeleted, false)).limit(1);
  const [admin] = await db.select({ id: users.id }).from(users).where(and(
    eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"),
    eq(users.isActive, true), eq(users.isDeleted, false)
  )).limit(1);
  const [engineer] = await db.select({ id: users.id }).from(users).where(and(
    eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"),
    eq(users.isActive, true), eq(users.isDeleted, false)
  )).limit(1);
  assert.ok(customer && model && admin && engineer);
  customerId = customer.id;
  productModelId = model.id;
  adminId = admin.id;
  engineerId = engineer.id;
});

after(async () => {
  if (createdFlowchartIds.length > 0) {
    await db.delete(repairCaseFlowchartEditHistory).where(inArray(repairCaseFlowchartEditHistory.flowchartId, createdFlowchartIds));
    await db.delete(repairCaseFlowchartNodes).where(inArray(repairCaseFlowchartNodes.flowchartId, createdFlowchartIds));
    await db.delete(repairCaseFlowcharts).where(inArray(repairCaseFlowcharts.id, createdFlowchartIds));
  }
  if (createdWorkRecordIds.length > 0) await db.delete(repairCaseWorkRecords).where(inArray(repairCaseWorkRecords.id, createdWorkRecordIds));
  if (createdCaseIds.length > 0) {
    const auditRows = await db.select({ id: auditLogs.id }).from(auditLogs).where(and(
      eq(auditLogs.targetEntity, "repair_cases"), inArray(auditLogs.targetRecordId, createdCaseIds)
    ));
    if (auditRows.length > 0) await db.delete(auditLogs).where(inArray(auditLogs.id, auditRows.map((row) => row.id)));
    await db.delete(repairCaseBillingDecisionHistories).where(inArray(repairCaseBillingDecisionHistories.repairCaseId, createdCaseIds));
  }
  if (createdIdempotencyKeys.length > 0) await db.delete(repairCaseIdempotencyKeys).where(inArray(repairCaseIdempotencyKeys.idempotencyKey, createdIdempotencyKeys));
  if (createdCaseIds.length > 0) await db.delete(repairCases).where(inArray(repairCases.id, createdCaseIds));
  if (createdProductIds.length > 0) await db.delete(products).where(inArray(products.id, createdProductIds));
  await pgClient.end({ timeout: 5 });
});

async function createPendingCase(sequence: number) {
  const key = randomUUID();
  createdIdempotencyKeys.push(key);
  const intake: IntakeSubmissionInput = {
    workflowType: "PENDING_MATCHER", billingType: "PENDING_DECISION",
    customerId, endUserId: null, assignedEngineerId: engineerId, priority: "NORMAL",
    receivedAt: "2099-11-10", customerRequestedDueDate: null,
    internalTargetShipmentDate: null, internalTargetInspectionCompletionDate: null,
    intakeNumber: `D9911${String(sequence).padStart(2, "0")}`,
    modelName: `PENDING-BILLING-${runToken}-${sequence}`,
    productModelId, newProductModelName: null,
    lotNumber: `LOT-${runToken}-${sequence}`, serialNumber: `SN-${runToken}-${sequence}`,
    partNumber: null, accessoryList: null, externalConditionSummary: null,
    reasonForRemoval: null, reportedSymptom: null, notes: null,
    contactName: null, contactPhone: null, contactEmail: null,
  };
  const result = await createRepairCaseWithIdempotency({
    actor: { userId: adminId, role: "SUPER_ADMIN", approvalStatus: "APPROVED" },
    intake, idempotencyKey: key, logContext: "EXCEL_IMPORT",
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("pending setup failed");
  createdCaseIds.push(result.id);
  const [row] = await db.select({ productId: repairCases.productId, version: repairCases.version }).from(repairCases).where(eq(repairCases.id, result.id));
  assert.ok(row);
  createdProductIds.push(row.productId);
  return { ...result, version: row.version };
}

function assertBillingBlocked(result: { ok: boolean; code?: string }): void {
  assert.equal(result.ok, false);
  assert.equal(result.code, "BILLING_DECISION_REQUIRED");
}

describe("Partial Paid + Pending Billing foundation", () => {
  test("pending workflows are independent two-step current published snapshots", async () => {
    const allStepIds = new Set<string>();
    for (const code of ["PENDING_MATCHER", "PENDING_GENERATOR", "PENDING_TOTAL_CONTROLLER"] as const) {
      const rows = await db.select({ id: workflowSteps.id, key: workflowSteps.key })
        .from(workflowSteps)
        .innerJoin(workflowVersions, eq(workflowVersions.id, workflowSteps.workflowVersionId))
        .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId))
        .where(and(eq(workflowTemplates.code, code), eq(workflowVersions.status, "PUBLISHED"), eq(workflowVersions.isCurrent, true)))
        .orderBy(workflowSteps.stepOrder);
      assert.deepEqual(rows.map((row) => row.key), ["product_intake", "intake_inspection"]);
      for (const row of rows) assert.equal(allStepIds.has(row.id), false, `${code} must own independent step IDs`);
      for (const row of rows) allStepIds.add(row.id);
    }
    assert.equal(allStepIds.size, 6);
  });

  test("every repair-progress boundary rejects pending billing", async () => {
    const pending = await createPendingCase(81);
    assertBillingBlocked(await transitionWorkflow(pending.id, pending.version, "HOLD_STARTED", engineerId, "test"));
    assertBillingBlocked(await requestRepairCaseApproval(pending.id, "REPAIR_INSPECTION", engineerId, null));
    assertBillingBlocked(await createWorkRecord({ repairCaseId: pending.id, actorUserId: engineerId, memo: "test", recordKind: "GENERAL", relatedProcedureExecutionNodeId: null, clientRequestId: randomUUID() }));
    assertBillingBlocked(await startProcedureExecution(pending.id, randomUUID(), engineerId));
    assertBillingBlocked(await createRepairCaseFlowchart({ repairCaseId: pending.id, actorUserId: engineerId, title: "test", description: null }));
    assertBillingBlocked(await createPartRequest({ repairCaseId: pending.id, items: [{ partId: randomUUID(), quantity: 1, owner: "DSS", note: null }], actorUserId: engineerId, idempotencyKey: randomUUID() }));
    assertBillingBlocked(await consumeStock({ partStockBalanceId: randomUUID(), quantity: 1, repairCaseId: pending.id, actorUserId: adminId, expectedVersion: 1 }));

    const [workRecord] = await db.insert(repairCaseWorkRecords).values({ repairCaseId: pending.id, authorUserId: engineerId, memo: "fixture", recordKind: "GENERAL", clientRequestId: randomUUID() }).returning({ id: repairCaseWorkRecords.id });
    createdWorkRecordIds.push(workRecord.id);
    assertBillingBlocked(await invalidateWorkRecord({ workRecordId: workRecord.id, actorUserId: adminId, reason: "test" }));

    const [flowchart] = await db.insert(repairCaseFlowcharts).values({ repairCaseId: pending.id, title: "fixture", description: null, createdBy: adminId, updatedBy: adminId }).returning({ id: repairCaseFlowcharts.id, updatedAt: repairCaseFlowcharts.updatedAt });
    createdFlowchartIds.push(flowchart.id);
    assertBillingBlocked(await updateRepairCaseFlowchartMetadata({ repairCaseId: pending.id, flowchartId: flowchart.id, actorUserId: adminId, title: "changed", description: null, expectedUpdatedAt: flowchart.updatedAt.toISOString() }));
    assertBillingBlocked(await createRepairCaseFlowchartNode({ repairCaseId: pending.id, flowchartId: flowchart.id, actorUserId: adminId, nodeType: "TASK", title: "node", description: null, expectedFlowchartUpdatedAt: flowchart.updatedAt.toISOString() }));
  });

  test("PARTIAL_PAID resolves atomically to the paid workflow and records history", async () => {
    const pending = await createPendingCase(82);
    const result = await resolveRepairCaseBillingDecision({ repairCaseId: pending.id, expectedVersion: pending.version, nextBillingType: "PARTIAL_PAID", actorUserId: adminId });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    const [row] = await db.select({ billingType: repairCases.billingType, version: repairCases.version, workflowType: workflowTemplates.code, stepKey: workflowSteps.key })
      .from(repairCases).innerJoin(workflowVersions, eq(workflowVersions.id, repairCases.workflowVersionId))
      .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId))
      .innerJoin(workflowSteps, eq(workflowSteps.id, repairCases.currentWorkflowStepId)).where(eq(repairCases.id, pending.id));
    assert.deepEqual(row, { billingType: "PARTIAL_PAID", version: pending.version + 1, workflowType: "PAID_MATCHER", stepKey: "intake_inspection" });
    const histories = await db.select().from(repairCaseBillingDecisionHistories).where(eq(repairCaseBillingDecisionHistories.repairCaseId, pending.id));
    assert.equal(histories.length, 1);
    assert.equal(histories[0].previousBillingType, "PENDING_DECISION");
    assert.equal(histories[0].nextBillingType, "PARTIAL_PAID");
    const second = await resolveRepairCaseBillingDecision({ repairCaseId: pending.id, expectedVersion: result.version, nextBillingType: "WARRANTY", actorUserId: adminId });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "BILLING_ALREADY_DECIDED");
  });

  test("concurrent decisions allow exactly one winner", async () => {
    const pending = await createPendingCase(83);
    const [first, second] = await Promise.all([
      resolveRepairCaseBillingDecision({ repairCaseId: pending.id, expectedVersion: pending.version, nextBillingType: "PAID", actorUserId: adminId }),
      resolveRepairCaseBillingDecision({ repairCaseId: pending.id, expectedVersion: pending.version, nextBillingType: "WARRANTY", actorUserId: adminId }),
    ]);
    assert.equal([first, second].filter((result) => result.ok).length, 1);
    const loser = [first, second].find((result) => !result.ok);
    assert.ok(loser && !loser.ok);
    if (loser && !loser.ok) assert.equal(loser.code, "STALE_VERSION");
  });

  test("related activity blocks resolution without partial changes", async () => {
    const pending = await createPendingCase(84);
    const [flowchart] = await db.insert(repairCaseFlowcharts).values({ repairCaseId: pending.id, title: "resolution blocker", description: null, createdBy: adminId, updatedBy: adminId }).returning({ id: repairCaseFlowcharts.id });
    createdFlowchartIds.push(flowchart.id);
    const result = await resolveRepairCaseBillingDecision({ repairCaseId: pending.id, expectedVersion: pending.version, nextBillingType: "PAID", actorUserId: adminId });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "RELATED_ACTIVITY_EXISTS");
    const [row] = await db.select({ billingType: repairCases.billingType, version: repairCases.version }).from(repairCases).where(eq(repairCases.id, pending.id));
    assert.deepEqual(row, { billingType: "PENDING_DECISION", version: pending.version });
  });
});
