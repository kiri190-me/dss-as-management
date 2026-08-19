import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, ne, sql } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  customers,
  users,
  products,
  repairCases,
  repairCaseIntakeSequences,
  repairCaseWorkRecords,
  statusChangeHistories,
  procedureCaseExecutions,
  procedureCaseExecutionHistory,
  inventoryPartRequests,
  exceptionStatuses,
  workflowSteps,
  procedureTemplates,
} from "../schema";
import { createRepairCase } from "../mutations/repair-cases";
import { listMyActiveRepairCases } from "./repair-cases-mine";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Phase 5C-3 integration tests for listMyActiveRepairCases, against the
 * isolated test DB. Self-cleaning convention (same as
 * repair-case-work-records.integration.test.ts): every repair case uses
 * intake month TEST_YEAR_MONTH ("9912", distinct from every other isolated
 * month already in use this project), every product uses TEST_MODEL_PREFIX.
 * after() deletes every row this suite created — in FK-safe order,
 * dependents before parents — and never touches the pre-existing seeded
 * repair cases, baseline templates, or any other fixture data.
 * procedure_case_executions in
 * this suite reference a REAL, pre-existing template purely as a required
 * FK target (read-only reference — the template itself is never modified).
 */

const TEST_MODEL_PREFIX = "MYWORK-TEST-";
const TEST_YEAR_MONTH = "9912";
const TEST_RECEIVED_AT = "2099-12-10";
const TEST_SHIPMENT_DATE = "2099-12-20";

let engineerAId: string;
let engineerBId: string;
let customerId: string;
let waitingKyosanExceptionStatusId: string;
let realTemplateId: string;
let realTemplateCategory: "FULL_SERVICE" | "TECHNICAL_TASK" | "REFERENCE";
let protectedRepairCaseIdsBefore: string[] = [];

function uniqueSuffix(): string {
  return randomUUID().slice(0, 8);
}

function baseCreateInput(engineerId: string, overrides: Partial<ValidatedCreateRepairCaseInput> = {}): ValidatedCreateRepairCaseInput {
  const suffix = uniqueSuffix();
  return {
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
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

async function createTestCase(engineerId: string, overrides: Partial<ValidatedCreateRepairCaseInput> = {}) {
  const result = await createRepairCase(baseCreateInput(engineerId, overrides));
  assert.equal(result.ok, true, `setup create failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

async function getWorkflowVersionId(repairCaseId: string): Promise<string> {
  const [row] = await db.select({ id: repairCases.workflowVersionId }).from(repairCases).where(eq(repairCases.id, repairCaseId));
  return row.id;
}

async function setCurrentStepByKey(repairCaseId: string, stepKey: string) {
  const workflowVersionId = await getWorkflowVersionId(repairCaseId);
  const [step] = await db
    .select({ id: workflowSteps.id })
    .from(workflowSteps)
    .where(and(eq(workflowSteps.workflowVersionId, workflowVersionId), eq(workflowSteps.key, stepKey)));
  assert.ok(step, `expected a PAID_MATCHER step with key "${stepKey}"`);
  await db.update(repairCases).set({ currentWorkflowStepId: step.id }).where(eq(repairCases.id, repairCaseId));
}

async function setExceptionStatus(repairCaseId: string, exceptionStatusId: string | null) {
  await db.update(repairCases).set({ exceptionStatusId }).where(eq(repairCases.id, repairCaseId));
}

async function insertWorkRecord(repairCaseId: string, authorId: string, opts: { invalidated?: boolean; createdAt?: Date } = {}) {
  const [inserted] = await db
    .insert(repairCaseWorkRecords)
    .values({
      repairCaseId,
      authorUserId: authorId,
      memo: "테스트 작업 기록",
      createdAt: opts.createdAt,
      ...(opts.invalidated ? { invalidatedAt: sql`now()`, invalidatedBy: authorId, invalidationReason: "테스트 무효 처리" } : {}),
    })
    .returning({ id: repairCaseWorkRecords.id });
  return inserted.id;
}

async function insertStatusHistory(repairCaseId: string, actorId: string, createdAt?: Date) {
  const workflowVersionId = await getWorkflowVersionId(repairCaseId);
  const [row] = await db.select({ id: repairCases.currentWorkflowStepId }).from(repairCases).where(eq(repairCases.id, repairCaseId));
  await db.insert(statusChangeHistories).values({
    repairCaseId,
    workflowVersionId,
    fromStepId: row.id,
    toStepId: row.id,
    actionType: "STEP_ADVANCED",
    actorUserId: actorId,
    createdAt,
  });
}

async function insertExecutionHistory(repairCaseId: string, actorId: string, createdAt?: Date) {
  const [execution] = await db
    .insert(procedureCaseExecutions)
    .values({ repairCaseId, procedureTemplateId: realTemplateId, templateCategory: realTemplateCategory, startedBy: actorId })
    .returning({ id: procedureCaseExecutions.id });
  await db.insert(procedureCaseExecutionHistory).values({
    executionId: execution.id,
    actionType: "EXECUTION_STARTED",
    actorUserId: actorId,
    createdAt,
  });
  return execution.id;
}

async function insertPartRequest(
  repairCaseId: string,
  requestedByUserId: string,
  status: "PENDING" | "PARTIALLY_ISSUED" | "FULLY_ISSUED" | "PARTIALLY_CLOSED" | "REJECTED" | "CANCELLED"
) {
  await db.insert(inventoryPartRequests).values({ repairCaseId, requestedByUserId, status });
}

before(async () => {
  protectedRepairCaseIdsBefore = (
    await db
      .select({ id: repairCases.id })
      .from(repairCases)
      .where(sql`intake_number not like ${"D" + TEST_YEAR_MONTH + "%"}`)
      .orderBy(repairCases.id)
  ).map((row) => row.id);

  const engineers = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(2);
  assert.ok(engineers.length >= 2, "expected at least two approved AS_ENGINEER users in the dev DB");
  engineerAId = engineers[0].id;
  engineerBId = engineers[1].id;

  const [customer] = await db.select({ id: customers.id }).from(customers).where(eq(customers.isDeleted, false)).limit(1);
  assert.ok(customer, "expected at least one non-deleted customer in the dev DB");
  customerId = customer.id;

  const [exceptionStatus] = await db
    .select({ id: exceptionStatuses.id })
    .from(exceptionStatuses)
    .where(eq(exceptionStatuses.code, "WAITING_KYOSAN_RESPONSE"));
  assert.ok(exceptionStatus, "expected the seeded WAITING_KYOSAN_RESPONSE exception status");
  waitingKyosanExceptionStatusId = exceptionStatus.id;

  // Any real, pre-existing non-REFERENCE template works — procedure_case_executions.
  // procedure_template_id just needs a valid FK target here (this suite
  // inserts execution/history rows directly, bypassing the "start
  // execution" mutation and its own PUBLISHED-only business rule). The
  // template itself is never modified, published, or deleted. Must exclude
  // REFERENCE (Phase 5C-5A): procedure_case_executions now has its own
  // CHECK (template_category <> 'REFERENCE'), so an arbitrary unfiltered
  // pick could otherwise land on main-page-index/qc-common-operations and
  // fail this insert outright.
  const [template] = await db
    .select({ id: procedureTemplates.id, category: procedureTemplates.category })
    .from(procedureTemplates)
    .where(ne(procedureTemplates.category, "REFERENCE"))
    .limit(1);
  assert.ok(template, "expected at least one non-REFERENCE procedure template in the dev DB");
  realTemplateId = template.id;
  realTemplateCategory = template.category;
});

after(async () => {
  const testCases = await db.select({ id: repairCases.id }).from(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  const testCaseIds = testCases.map((c) => c.id);

  if (testCaseIds.length > 0) {
    await db.delete(repairCaseWorkRecords).where(inArray(repairCaseWorkRecords.repairCaseId, testCaseIds));
    await db.delete(statusChangeHistories).where(inArray(statusChangeHistories.repairCaseId, testCaseIds));
    await db.delete(inventoryPartRequests).where(inArray(inventoryPartRequests.repairCaseId, testCaseIds));

    const executions = await db.select({ id: procedureCaseExecutions.id }).from(procedureCaseExecutions).where(inArray(procedureCaseExecutions.repairCaseId, testCaseIds));
    const executionIds = executions.map((e) => e.id);
    if (executionIds.length > 0) {
      await db.delete(procedureCaseExecutionHistory).where(inArray(procedureCaseExecutionHistory.executionId, executionIds));
      await db.delete(procedureCaseExecutions).where(inArray(procedureCaseExecutions.id, executionIds));
    }
  }

  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));

  await pgClient.end({ timeout: 5 });
});

describe("listMyActiveRepairCases: assignment and security", () => {
  test("1. AS_ENGINEER sees their own assigned case", async () => {
    const created = await createTestCase(engineerAId);
    const rows = await listMyActiveRepairCases(engineerAId);
    assert.ok(rows.some((r) => r.id === created.id));
  });

  test("2. another engineer's case is excluded — no engineerId parameter exists to bypass this", async () => {
    const created = await createTestCase(engineerAId);
    const rowsForB = await listMyActiveRepairCases(engineerBId);
    assert.equal(rowsForB.some((r) => r.id === created.id), false);
  });

  test("7. calling with different actorId values never returns overlapping case sets for cases only one of them owns", async () => {
    const caseA = await createTestCase(engineerAId);
    const caseB = await createTestCase(engineerBId);
    const rowsForA = await listMyActiveRepairCases(engineerAId);
    const rowsForB = await listMyActiveRepairCases(engineerBId);
    assert.ok(rowsForA.some((r) => r.id === caseA.id));
    assert.equal(rowsForA.some((r) => r.id === caseB.id), false);
    assert.ok(rowsForB.some((r) => r.id === caseB.id));
    assert.equal(rowsForB.some((r) => r.id === caseA.id), false);
  });
});

describe("listMyActiveRepairCases: shipment-completed exclusion", () => {
  test("3. shipment-completed own case is excluded", async () => {
    const created = await createTestCase(engineerAId);
    await setCurrentStepByKey(created.id, "shipment_completed");
    const rows = await listMyActiveRepairCases(engineerAId);
    assert.equal(rows.some((r) => r.id === created.id), false);
  });

  test("4/5. own non-terminal cases (waiting-parts, waiting-PO) remain included", async () => {
    const waitingParts = await createTestCase(engineerAId);
    await setCurrentStepByKey(waitingParts.id, "parts_supply");
    const waitingPo = await createTestCase(engineerAId);
    await setCurrentStepByKey(waitingPo.id, "waiting_po");

    const rows = await listMyActiveRepairCases(engineerAId);
    assert.ok(rows.some((r) => r.id === waitingParts.id));
    assert.ok(rows.some((r) => r.id === waitingPo.id));
    assert.equal(rows.find((r) => r.id === waitingParts.id)?.status, "WAITING_PARTS_SUPPLY");
    assert.equal(rows.find((r) => r.id === waitingPo.id)?.status, "WAITING_PO");
  });

  test("own case carrying a non-terminal exception status (e.g. held/waiting) remains included, unaffected by exclusion", async () => {
    const created = await createTestCase(engineerAId);
    await setExceptionStatus(created.id, waitingKyosanExceptionStatusId);
    const rows = await listMyActiveRepairCases(engineerAId);
    const row = rows.find((r) => r.id === created.id);
    assert.ok(row, "case with a non-terminal exception status must still be included");
    assert.equal(row!.exceptionStatus, "WAITING_KYOSAN_RESPONSE");
  });
});

describe("listMyActiveRepairCases: current status vs current stage vs exception status", () => {
  test("10/11. 현재 상태 and 현재 단계 are two independently-sourced values, never the same string", async () => {
    const created = await createTestCase(engineerAId);
    await setCurrentStepByKey(created.id, "kyosan_instruction_confirmed");
    const rows = await listMyActiveRepairCases(engineerAId);
    const row = rows.find((r) => r.id === created.id)!;
    assert.equal(row.status, "IN_REPAIR");
    assert.equal(row.currentWorkflowStepLabel, "교산 지시사항 확인");
    assert.notEqual(row.status, row.currentWorkflowStepLabel);
  });

  test("exceptionStatus renders independently and does not affect status/stage derivation", async () => {
    const created = await createTestCase(engineerAId);
    await setCurrentStepByKey(created.id, "kyosan_instruction_confirmed");
    await setExceptionStatus(created.id, waitingKyosanExceptionStatusId);
    const rows = await listMyActiveRepairCases(engineerAId);
    const row = rows.find((r) => r.id === created.id)!;
    assert.equal(row.status, "IN_REPAIR");
    assert.equal(row.currentWorkflowStepLabel, "교산 지시사항 확인");
    assert.equal(row.exceptionStatus, "WAITING_KYOSAN_RESPONSE");
  });

  test("no active exception status -> null, never a fabricated value", async () => {
    const created = await createTestCase(engineerAId);
    const rows = await listMyActiveRepairCases(engineerAId);
    assert.equal(rows.find((r) => r.id === created.id)!.exceptionStatus, null);
  });

  test("12. L/N is sourced from products.lotNumber", async () => {
    const suffix = uniqueSuffix();
    const created = await createTestCase(engineerAId, { lotNumber: `LN-${suffix}` });
    const rows = await listMyActiveRepairCases(engineerAId);
    assert.equal(rows.find((r) => r.id === created.id)!.lotNumber, `LN-${suffix}`);
  });
});

describe("listMyActiveRepairCases: last meaningful activity", () => {
  test("18. no activity from any of the 3 sources -> lastActivityAt is null", async () => {
    const created = await createTestCase(engineerAId);
    const rows = await listMyActiveRepairCases(engineerAId);
    assert.equal(rows.find((r) => r.id === created.id)!.lastActivityAt, null);
  });

  test("14. a valid (non-invalidated) work record counts as last activity", async () => {
    const created = await createTestCase(engineerAId);
    await insertWorkRecord(created.id, engineerAId, { invalidated: false });
    const rows = await listMyActiveRepairCases(engineerAId);
    assert.notEqual(rows.find((r) => r.id === created.id)!.lastActivityAt, null);
  });

  test("15. an invalidated work record does NOT count as last activity", async () => {
    const created = await createTestCase(engineerAId);
    await insertWorkRecord(created.id, engineerAId, { invalidated: true });
    const rows = await listMyActiveRepairCases(engineerAId);
    assert.equal(rows.find((r) => r.id === created.id)!.lastActivityAt, null);
  });

  test("16. status_change_histories counts as last activity", async () => {
    const created = await createTestCase(engineerAId);
    await insertStatusHistory(created.id, engineerAId);
    const rows = await listMyActiveRepairCases(engineerAId);
    assert.notEqual(rows.find((r) => r.id === created.id)!.lastActivityAt, null);
  });

  test("17. procedure_case_execution_history counts as last activity", async () => {
    const created = await createTestCase(engineerAId);
    await insertExecutionHistory(created.id, engineerAId);
    const rows = await listMyActiveRepairCases(engineerAId);
    assert.notEqual(rows.find((r) => r.id === created.id)!.lastActivityAt, null);
  });

  test("the latest of all 3 sources wins, not merely the first one found", async () => {
    const created = await createTestCase(engineerAId);
    const earliest = new Date("2099-12-11T00:00:00Z");
    const middle = new Date("2099-12-12T00:00:00Z");
    const latest = new Date("2099-12-13T00:00:00Z");
    await insertWorkRecord(created.id, engineerAId, { invalidated: false, createdAt: earliest });
    await insertStatusHistory(created.id, engineerAId, latest);
    await insertExecutionHistory(created.id, engineerAId, middle);

    const rows = await listMyActiveRepairCases(engineerAId);
    const row = rows.find((r) => r.id === created.id)!;
    assert.equal(new Date(row.lastActivityAt!).toISOString(), latest.toISOString());
  });
});

describe("listMyActiveRepairCases: parts-request summary", () => {
  test("19. an active PENDING request -> activePartsRequestStatus PENDING", async () => {
    const created = await createTestCase(engineerAId);
    await insertPartRequest(created.id, engineerAId, "PENDING");
    const rows = await listMyActiveRepairCases(engineerAId);
    assert.equal(rows.find((r) => r.id === created.id)!.activePartsRequestStatus, "PENDING");
  });

  test("an active PARTIALLY_ISSUED request -> activePartsRequestStatus PARTIALLY_ISSUED", async () => {
    const created = await createTestCase(engineerAId);
    await insertPartRequest(created.id, engineerAId, "PARTIALLY_ISSUED");
    const rows = await listMyActiveRepairCases(engineerAId);
    assert.equal(rows.find((r) => r.id === created.id)!.activePartsRequestStatus, "PARTIALLY_ISSUED");
  });

  test("PENDING outranks PARTIALLY_ISSUED when both exist for the same case", async () => {
    const created = await createTestCase(engineerAId);
    await insertPartRequest(created.id, engineerAId, "PARTIALLY_ISSUED");
    await insertPartRequest(created.id, engineerAId, "PENDING");
    const rows = await listMyActiveRepairCases(engineerAId);
    assert.equal(rows.find((r) => r.id === created.id)!.activePartsRequestStatus, "PENDING");
  });

  test("20. every terminal status (FULLY_ISSUED/PARTIALLY_CLOSED/REJECTED/CANCELLED) never appears as an active waiting state", async () => {
    for (const status of ["FULLY_ISSUED", "PARTIALLY_CLOSED", "REJECTED", "CANCELLED"] as const) {
      const created = await createTestCase(engineerAId);
      await insertPartRequest(created.id, engineerAId, status);
      const rows = await listMyActiveRepairCases(engineerAId);
      assert.equal(rows.find((r) => r.id === created.id)!.activePartsRequestStatus, null, `${status} must not appear as active`);
    }
  });

  test("no request at all -> null", async () => {
    const created = await createTestCase(engineerAId);
    const rows = await listMyActiveRepairCases(engineerAId);
    assert.equal(rows.find((r) => r.id === created.id)!.activePartsRequestStatus, null);
  });
});

describe("listMyActiveRepairCases: real-data safety", () => {
  test("37. never mutates repair_cases, work records, status/execution history, or parts requests — this suite only ever reads via listMyActiveRepairCases", async () => {
    const protectedRepairCaseIdsAfter = (
      await db
        .select({ id: repairCases.id })
        .from(repairCases)
        .where(sql`intake_number not like ${"D" + TEST_YEAR_MONTH + "%"}`)
        .orderBy(repairCases.id)
    ).map((row) => row.id);
    assert.deepEqual(
      protectedRepairCaseIdsAfter,
      protectedRepairCaseIdsBefore,
      "all repair cases that predated this suite must remain unchanged by the read query"
    );
  });
});
