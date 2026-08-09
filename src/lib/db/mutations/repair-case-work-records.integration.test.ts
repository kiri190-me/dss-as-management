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
  procedureTemplates,
  procedureTemplateNodes,
  procedureTemplateEdges,
  procedureTemplateEditHistory,
  procedureTemplateValidationIssues,
  procedureCaseExecutions,
  procedureCaseExecutionNodes,
  procedureCaseExecutionHistory,
  statusChangeHistories,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import { createDraftProcedureTemplateFromImport, publishProcedureTemplate } from "./procedure-templates";
import { startProcedureExecution } from "./procedure-case-execution";
import { transitionWorkflow } from "./workflow-transitions";
import * as workRecordMutations from "./repair-case-work-records";
import { createWorkRecord, invalidateWorkRecord } from "./repair-case-work-records";
import { getRecentWorkRecordsForCase, getWorkRecordHistoryForCase } from "../queries/repair-case-work-records";
import type { ExtractedTemplate } from "../../../../scripts/lib/xlsx/types";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Phase 5C-2 integration tests for repair-case work records, against the
 * real dev DB. Self-cleaning convention (same as
 * procedure-case-execution.integration.test.ts): every repair case uses
 * intake month TEST_YEAR_MONTH ("9911", distinct from every other isolated
 * month already in use), every product uses TEST_MODEL_PREFIX, every
 * template uses TEST_CODE_PREFIX. after() deletes every row this suite
 * created (work records, status-change histories, and procedure-execution
 * rows before their parent repair cases, respecting FK restrict) and never
 * touches the 19 real repair cases, 4 real templates,
 * their 403+14 nodes / 542+9 edges, or the 13 tracked ERROR issues.
 */

const TEST_CODE_PREFIX = "test-workrecord-";
const TEST_MODEL_PREFIX = "WORKRECORD-TEST-";
const TEST_YEAR_MONTH = "9911";
const TEST_RECEIVED_AT = "2099-11-10";
const TEST_SHIPMENT_DATE = "2099-11-20";

let superAdminId: string;
let adminId: string;
let engineerId: string;
let engineer2Id: string;
let salesId: string;
let inventoryManagerId: string;
let customerId: string;

const createdTemplateIds: string[] = [];

let realDataBaseline: { repairCaseCount: number; templateCount: number; nodeCount: number; edgeCount: number; errorIssueCount: number };

function uniqueCode(suffix: string): string {
  return `${TEST_CODE_PREFIX}${suffix}-${randomUUID().slice(0, 8)}`;
}

/** Minimal valid graph: START -> TASK -> END. Copied from the proven-good shape in procedure-case-execution.integration.test.ts, trimmed to the minimum this suite needs (one non-system executable node). */
function makeMinimalTestTemplate(code: string): ExtractedTemplate {
  const sheet = "(TEST) 작업기록 테스트 시트";
  return {
    code,
    name: `작업기록 테스트 ${code}`,
    equipmentType: "RFG",
    description: "Phase 5C-2 work-record integration test fixture",
    sourceWorksheets: [sheet],
    isReferenceOnly: false,
    referenceItems: [],
    nodes: [
      { nodeCode: "n1", nodeType: "START", title: "시작", positionX: 0, positionY: 0, sortOrder: 0, sourceWorksheet: sheet, sourceShapeId: "1" },
      { nodeCode: "n2", nodeType: "TASK", title: "점검", positionX: 100, positionY: 0, sortOrder: 1, sourceWorksheet: sheet, sourceShapeId: "2" },
      { nodeCode: "n3", nodeType: "END", title: "종료", positionX: 200, positionY: 0, sortOrder: 2, sourceWorksheet: sheet, sourceShapeId: "3" },
    ],
    edges: [
      { fromNodeCode: "n1", toNodeCode: "n2", branchType: "DEFAULT", branchLabel: null, sortOrder: 0, sourceConnectorId: "c1" },
      { fromNodeCode: "n2", toNodeCode: "n3", branchType: "DEFAULT", branchLabel: null, sortOrder: 1, sourceConnectorId: "c2" },
    ],
    checklistSections: [],
    troubleshootingEntries: [],
    issues: [],
  };
}

async function createPublishedTemplateAndExecution(repairCaseId: string, actorUserId: string) {
  const code = uniqueCode("fixture");
  const draftResult = await createDraftProcedureTemplateFromImport(makeMinimalTestTemplate(code), superAdminId, {
    sourceFileName: "workrecord-fixture.xlsx",
    sourceFileHash: `hash-${code}`,
  });
  assert.equal(draftResult.ok, true, `fixture import failed: ${JSON.stringify(draftResult)}`);
  if (!draftResult.ok) throw new Error("unreachable");
  createdTemplateIds.push(draftResult.id);

  const publishResult = await publishProcedureTemplate(draftResult.id, superAdminId);
  assert.equal(publishResult.ok, true, `fixture publish failed: ${JSON.stringify(publishResult)}`);

  const startResult = await startProcedureExecution(repairCaseId, draftResult.id, actorUserId);
  assert.equal(startResult.ok, true, `fixture execution start failed: ${JSON.stringify(startResult)}`);
  if (!startResult.ok) throw new Error("unreachable");

  const execNodes = await db
    .select({ id: procedureCaseExecutionNodes.id })
    .from(procedureCaseExecutionNodes)
    .where(eq(procedureCaseExecutionNodes.executionId, startResult.executionId));
  assert.ok(execNodes.length > 0, "expected at least one execution node");

  return { templateId: draftResult.id, executionId: startResult.executionId, nodeId: execNodes[0].id };
}

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

async function lockCase(repairCaseId: string) {
  await db.update(repairCases).set({ isLocked: true }).where(eq(repairCases.id, repairCaseId));
}

async function getCurrentWorkflowStepId(repairCaseId: string): Promise<string> {
  const [row] = await db.select({ id: repairCases.currentWorkflowStepId }).from(repairCases).where(eq(repairCases.id, repairCaseId));
  return row.id;
}

before(async () => {
  const [superAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(superAdmin, "expected an approved SUPER_ADMIN in the dev DB");
  superAdminId = superAdmin.id;

  const admins = await db
    .select({ id: users.id })
    .from(users)
    .where(and(ne(users.role, "AS_ENGINEER"), eq(users.role, "ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(admins[0], "expected an approved ADMIN in the dev DB");
  adminId = admins[0].id;

  const engineers = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(2);
  assert.ok(engineers.length >= 2, "expected at least two approved AS_ENGINEER users in the dev DB");
  engineerId = engineers[0].id;
  engineer2Id = engineers[1].id;

  const [sales] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SALES"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(sales, "expected an approved SALES user in the dev DB");
  salesId = sales.id;

  const [inventoryManager] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "INVENTORY_MANAGER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(inventoryManager, "expected an approved INVENTORY_MANAGER in the dev DB");
  inventoryManagerId = inventoryManager.id;

  const [customer] = await db.select({ id: customers.id }).from(customers).where(eq(customers.isDeleted, false)).limit(1);
  assert.ok(customer, "expected at least one non-deleted customer in the dev DB");
  customerId = customer.id;

  const [repairCaseCounts] = await db.select({ count: sql<number>`count(*)::int` }).from(repairCases).where(sql`intake_number not like ${"D" + TEST_YEAR_MONTH + "%"}`);
  const [templateCounts] = await db.select({ count: sql<number>`count(*)::int` }).from(procedureTemplates).where(sql`code not like ${TEST_CODE_PREFIX + "%"}`);
  const [nodeCounts] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(procedureTemplateNodes)
    .innerJoin(procedureTemplates, eq(procedureTemplateNodes.procedureTemplateId, procedureTemplates.id))
    .where(sql`${procedureTemplates.code} not like ${TEST_CODE_PREFIX + "%"}`);
  const [edgeCounts] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(procedureTemplateEdges)
    .innerJoin(procedureTemplates, eq(procedureTemplateEdges.procedureTemplateId, procedureTemplates.id))
    .where(sql`${procedureTemplates.code} not like ${TEST_CODE_PREFIX + "%"}`);
  const [errorIssueCounts] = await db.select({ count: sql<number>`count(*)::int` }).from(procedureTemplateValidationIssues).where(eq(procedureTemplateValidationIssues.severity, "ERROR"));

  realDataBaseline = {
    repairCaseCount: repairCaseCounts?.count ?? 0,
    templateCount: templateCounts?.count ?? 0,
    nodeCount: nodeCounts?.count ?? 0,
    edgeCount: edgeCounts?.count ?? 0,
    errorIssueCount: errorIssueCounts?.count ?? 0,
  };
});

after(async () => {
  const allTestTemplates = await db.select({ id: procedureTemplates.id }).from(procedureTemplates).where(like(procedureTemplates.code, `${TEST_CODE_PREFIX}%`));
  const allTemplateIds = [...new Set([...createdTemplateIds, ...allTestTemplates.map((t) => t.id)])];

  const testCases = await db.select({ id: repairCases.id }).from(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  const testCaseIds = testCases.map((c) => c.id);

  if (testCaseIds.length > 0) {
    await db.delete(repairCaseWorkRecords).where(inArray(repairCaseWorkRecords.repairCaseId, testCaseIds));
    await db.delete(statusChangeHistories).where(inArray(statusChangeHistories.repairCaseId, testCaseIds));

    const executions = await db.select({ id: procedureCaseExecutions.id }).from(procedureCaseExecutions).where(inArray(procedureCaseExecutions.repairCaseId, testCaseIds));
    const executionIds = executions.map((e) => e.id);
    if (executionIds.length > 0) {
      await db.delete(procedureCaseExecutionHistory).where(inArray(procedureCaseExecutionHistory.executionId, executionIds));
      await db.delete(procedureCaseExecutionNodes).where(inArray(procedureCaseExecutionNodes.executionId, executionIds));
      await db.delete(procedureCaseExecutions).where(inArray(procedureCaseExecutions.id, executionIds));
    }
  }

  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));

  if (allTemplateIds.length > 0) {
    await db.delete(procedureTemplateEditHistory).where(inArray(procedureTemplateEditHistory.procedureTemplateId, allTemplateIds));
    await db.delete(procedureTemplateEdges).where(inArray(procedureTemplateEdges.procedureTemplateId, allTemplateIds));
    await db.delete(procedureTemplateNodes).where(inArray(procedureTemplateNodes.procedureTemplateId, allTemplateIds));
    await db.delete(procedureTemplates).where(inArray(procedureTemplates.id, allTemplateIds));
  }

  await pgClient.end({ timeout: 5 });
});

describe("createWorkRecord: authorization", () => {
  test("1. AS_ENGINEER can create on their own assigned unlocked case", async () => {
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const result = await createWorkRecord({
      repairCaseId: created.id,
      actorUserId: engineerId,
      memo: "점검 완료, 이상 없음",
      relatedProcedureExecutionNodeId: null,
      clientRequestId: randomUUID(),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  test("2. AS_ENGINEER cannot create on another engineer's assigned case", async () => {
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const result = await createWorkRecord({
      repairCaseId: created.id,
      actorUserId: engineer2Id,
      memo: "다른 엔지니어가 작성 시도",
      relatedProcedureExecutionNodeId: null,
      clientRequestId: randomUUID(),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("3. AS_ENGINEER cannot create on a locked case, even their own assigned case", async () => {
    const created = await createTestCase({ assignedEngineerId: engineerId });
    await lockCase(created.id);
    const result = await createWorkRecord({
      repairCaseId: created.id,
      actorUserId: engineerId,
      memo: "잠금된 건 작성 시도",
      relatedProcedureExecutionNodeId: null,
      clientRequestId: randomUUID(),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CASE_LOCKED");
  });

  test("4. ADMIN/SUPER_ADMIN may create on any unlocked case, but never on a locked one — no hidden bypass", async () => {
    for (const actorId of [adminId, superAdminId]) {
      const created = await createTestCase({ assignedEngineerId: engineerId });
      const ok = await createWorkRecord({
        repairCaseId: created.id,
        actorUserId: actorId,
        memo: "관리자 작성",
        relatedProcedureExecutionNodeId: null,
        clientRequestId: randomUUID(),
      });
      assert.equal(ok.ok, true, JSON.stringify(ok));

      await lockCase(created.id);
      const blocked = await createWorkRecord({
        repairCaseId: created.id,
        actorUserId: actorId,
        memo: "잠금 후 관리자 작성 시도",
        relatedProcedureExecutionNodeId: null,
        clientRequestId: randomUUID(),
      });
      assert.equal(blocked.ok, false);
      if (!blocked.ok) assert.equal(blocked.code, "CASE_LOCKED");
    }
  });

  test("5. SALES cannot create", async () => {
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const result = await createWorkRecord({
      repairCaseId: created.id,
      actorUserId: salesId,
      memo: "영업 담당자 작성 시도",
      relatedProcedureExecutionNodeId: null,
      clientRequestId: randomUUID(),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("6. INVENTORY_MANAGER cannot create", async () => {
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const result = await createWorkRecord({
      repairCaseId: created.id,
      actorUserId: inventoryManagerId,
      memo: "재고 담당자 작성 시도",
      relatedProcedureExecutionNodeId: null,
      clientRequestId: randomUUID(),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });
});

describe("createWorkRecord: workflow-step and procedure-node context", () => {
  test("7. captures the case's actual current workflow_steps.id at creation time", async () => {
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const stepIdAtCreation = await getCurrentWorkflowStepId(created.id);

    const result = await createWorkRecord({
      repairCaseId: created.id,
      actorUserId: engineerId,
      memo: "1단계에서 작성",
      relatedProcedureExecutionNodeId: null,
      clientRequestId: randomUUID(),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const [row] = await db.select({ relatedWorkflowStepId: repairCaseWorkRecords.relatedWorkflowStepId }).from(repairCaseWorkRecords).where(eq(repairCaseWorkRecords.id, result.id));
    assert.equal(row.relatedWorkflowStepId, stepIdAtCreation);
  });

  test("8. a later workflow advance never changes an existing record's captured step", async () => {
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const stepIdAtCreation = await getCurrentWorkflowStepId(created.id);

    const result = await createWorkRecord({
      repairCaseId: created.id,
      actorUserId: engineerId,
      memo: "진행 전 작성",
      relatedProcedureExecutionNodeId: null,
      clientRequestId: randomUUID(),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const transitionResult = await transitionWorkflow(created.id, 1, "STEP_ADVANCED", superAdminId, null);
    assert.equal(transitionResult.ok, true, JSON.stringify(transitionResult));

    const [row] = await db.select({ relatedWorkflowStepId: repairCaseWorkRecords.relatedWorkflowStepId }).from(repairCaseWorkRecords).where(eq(repairCaseWorkRecords.id, result.id));
    assert.equal(row.relatedWorkflowStepId, stepIdAtCreation, "existing record must keep the step it was created at, not follow the case forward");
  });

  test("9. plain memo works with no procedure-execution-node link", async () => {
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const result = await createWorkRecord({
      repairCaseId: created.id,
      actorUserId: engineerId,
      memo: "노드 연결 없는 일반 메모",
      relatedProcedureExecutionNodeId: null,
      clientRequestId: randomUUID(),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  test("10. a supplied procedure-execution node belonging to the SAME repair case is accepted", async () => {
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const { nodeId } = await createPublishedTemplateAndExecution(created.id, engineerId);

    const result = await createWorkRecord({
      repairCaseId: created.id,
      actorUserId: engineerId,
      memo: "특정 절차 항목 작업 중 작성",
      relatedProcedureExecutionNodeId: nodeId,
      clientRequestId: randomUUID(),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  test("11. a procedure-execution node belonging to a DIFFERENT repair case is rejected", async () => {
    const caseA = await createTestCase({ assignedEngineerId: engineerId });
    const { nodeId: nodeFromCaseA } = await createPublishedTemplateAndExecution(caseA.id, engineerId);
    const caseB = await createTestCase({ assignedEngineerId: engineerId });

    const result = await createWorkRecord({
      repairCaseId: caseB.id,
      actorUserId: engineerId,
      memo: "다른 접수 건의 절차 항목을 연결 시도",
      relatedProcedureExecutionNodeId: nodeFromCaseA,
      clientRequestId: randomUUID(),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });
});

describe("createWorkRecord: idempotency", () => {
  test("12. same client_request_id + identical normalized payload replays the original row (no second insert)", async () => {
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const clientRequestId = randomUUID();
    const memo = "동일 요청 재시도 테스트";

    const first = await createWorkRecord({ repairCaseId: created.id, actorUserId: engineerId, memo, relatedProcedureExecutionNodeId: null, clientRequestId });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.replayed, false);

    const second = await createWorkRecord({ repairCaseId: created.id, actorUserId: engineerId, memo, relatedProcedureExecutionNodeId: null, clientRequestId });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.replayed, true);
    assert.equal(second.id, first.id, "replay must return the same row, not a new one");

    const rows = await db.select().from(repairCaseWorkRecords).where(eq(repairCaseWorkRecords.repairCaseId, created.id));
    assert.equal(rows.length, 1, "exactly one row must exist for this case");
  });

  test("13. same client_request_id + different memo is rejected as an idempotency conflict, never silently replayed", async () => {
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const clientRequestId = randomUUID();

    const first = await createWorkRecord({ repairCaseId: created.id, actorUserId: engineerId, memo: "원래 메모", relatedProcedureExecutionNodeId: null, clientRequestId });
    assert.equal(first.ok, true);

    const second = await createWorkRecord({ repairCaseId: created.id, actorUserId: engineerId, memo: "다른 메모", relatedProcedureExecutionNodeId: null, clientRequestId });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "IDEMPOTENCY_CONFLICT");

    const rows = await db.select().from(repairCaseWorkRecords).where(eq(repairCaseWorkRecords.repairCaseId, created.id));
    assert.equal(rows.length, 1, "the mismatched retry must never create or overwrite a row");
  });

  test("14. same client_request_id + different procedure-node context is rejected as an idempotency conflict", async () => {
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const { nodeId } = await createPublishedTemplateAndExecution(created.id, engineerId);
    const clientRequestId = randomUUID();
    const memo = "노드 연결 변경 재시도 테스트";

    const first = await createWorkRecord({ repairCaseId: created.id, actorUserId: engineerId, memo, relatedProcedureExecutionNodeId: null, clientRequestId });
    assert.equal(first.ok, true);

    const second = await createWorkRecord({ repairCaseId: created.id, actorUserId: engineerId, memo, relatedProcedureExecutionNodeId: nodeId, clientRequestId });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "IDEMPOTENCY_CONFLICT");
  });

  test("15. concurrent create with the same client_request_id creates exactly one row", async () => {
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const clientRequestId = randomUUID();
    const memo = "동시 제출 테스트";

    const [a, b] = await Promise.all([
      createWorkRecord({ repairCaseId: created.id, actorUserId: engineerId, memo, relatedProcedureExecutionNodeId: null, clientRequestId }),
      createWorkRecord({ repairCaseId: created.id, actorUserId: engineerId, memo, relatedProcedureExecutionNodeId: null, clientRequestId }),
    ]);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    if (!a.ok || !b.ok) return;
    assert.equal(a.id, b.id, "both concurrent calls must resolve to the same row");

    const rows = await db.select().from(repairCaseWorkRecords).where(eq(repairCaseWorkRecords.repairCaseId, created.id));
    assert.equal(rows.length, 1, "exactly one row must exist despite the concurrent submit");
  });

  test("16. retry after the case's workflow stage has advanced still replays the original record instead of creating a second row", async () => {
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const clientRequestId = randomUUID();
    const memo = "단계 진행 후 재시도 테스트";

    const first = await createWorkRecord({ repairCaseId: created.id, actorUserId: engineerId, memo, relatedProcedureExecutionNodeId: null, clientRequestId });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const transitionResult = await transitionWorkflow(created.id, 1, "STEP_ADVANCED", superAdminId, null);
    assert.equal(transitionResult.ok, true, JSON.stringify(transitionResult));

    // Retried by the SAME engineer (still assigned, case still unlocked) —
    // the case's current_workflow_step_id has now genuinely changed, but
    // that server-derived fact must never be compared as part of the
    // client payload.
    const retry = await createWorkRecord({ repairCaseId: created.id, actorUserId: engineerId, memo, relatedProcedureExecutionNodeId: null, clientRequestId });
    assert.equal(retry.ok, true);
    if (!retry.ok) return;
    assert.equal(retry.replayed, true);
    assert.equal(retry.id, first.id, "the retry must replay the original record, not create a second one");

    const rows = await db.select().from(repairCaseWorkRecords).where(eq(repairCaseWorkRecords.repairCaseId, created.id));
    assert.equal(rows.length, 1);
  });
});

describe("work-record immutability", () => {
  test("17. the mutation module exposes exactly createWorkRecord and invalidateWorkRecord — no edit/update mutation exists", () => {
    const exportedFunctionNames = Object.keys(workRecordMutations).sort();
    assert.deepEqual(exportedFunctionNames, ["createWorkRecord", "invalidateWorkRecord"]);
  });
});

describe("invalidateWorkRecord", () => {
  test("18. ADMIN/SUPER_ADMIN may invalidate an unlocked record with a mandatory reason; AS_ENGINEER/SALES may not, even the author", async () => {
    for (const actorId of [adminId, superAdminId]) {
      const created = await createTestCase({ assignedEngineerId: engineerId });
      const record = await createWorkRecord({ repairCaseId: created.id, actorUserId: engineerId, memo: "무효 처리 대상", relatedProcedureExecutionNodeId: null, clientRequestId: randomUUID() });
      assert.equal(record.ok, true);
      if (!record.ok) continue;

      const result = await invalidateWorkRecord({ workRecordId: record.id, actorUserId: actorId, reason: "잘못된 접수 건에 기록됨" });
      assert.equal(result.ok, true, JSON.stringify(result));
    }

    for (const actorId of [engineerId, salesId]) {
      const created = await createTestCase({ assignedEngineerId: engineerId });
      const record = await createWorkRecord({ repairCaseId: created.id, actorUserId: engineerId, memo: "무효 처리 시도 대상", relatedProcedureExecutionNodeId: null, clientRequestId: randomUUID() });
      assert.equal(record.ok, true);
      if (!record.ok) continue;

      const result = await invalidateWorkRecord({ workRecordId: record.id, actorUserId: actorId, reason: "권한 없는 시도" });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    }
  });

  test("19. an already-invalidated record cannot be invalidated again — rejected, not a silent no-op", async () => {
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const record = await createWorkRecord({ repairCaseId: created.id, actorUserId: engineerId, memo: "이중 무효 처리 테스트", relatedProcedureExecutionNodeId: null, clientRequestId: randomUUID() });
    assert.equal(record.ok, true);
    if (!record.ok) return;

    const firstInvalidate = await invalidateWorkRecord({ workRecordId: record.id, actorUserId: adminId, reason: "최초 무효 처리" });
    assert.equal(firstInvalidate.ok, true);

    const secondInvalidate = await invalidateWorkRecord({ workRecordId: record.id, actorUserId: adminId, reason: "다른 사유로 재시도" });
    assert.equal(secondInvalidate.ok, false);
    if (!secondInvalidate.ok) assert.equal(secondInvalidate.code, "ALREADY_INVALIDATED");

    const [row] = await db.select().from(repairCaseWorkRecords).where(eq(repairCaseWorkRecords.id, record.id));
    assert.equal(row.invalidationReason, "최초 무효 처리", "the second attempt must never overwrite the original invalidation reason");
  });

  test("20. invalidation never changes the original memo/author/created_at", async () => {
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const record = await createWorkRecord({ repairCaseId: created.id, actorUserId: engineerId, memo: "원본 메모는 보존되어야 함", relatedProcedureExecutionNodeId: null, clientRequestId: randomUUID() });
    assert.equal(record.ok, true);
    if (!record.ok) return;

    const [before] = await db.select().from(repairCaseWorkRecords).where(eq(repairCaseWorkRecords.id, record.id));

    const invalidateResult = await invalidateWorkRecord({ workRecordId: record.id, actorUserId: adminId, reason: "테스트 무효 처리" });
    assert.equal(invalidateResult.ok, true);

    const [after1] = await db.select().from(repairCaseWorkRecords).where(eq(repairCaseWorkRecords.id, record.id));
    assert.equal(after1.memo, before.memo);
    assert.equal(after1.authorUserId, before.authorUserId);
    assert.deepEqual(after1.createdAt, before.createdAt);
  });

  test("21. invalidation on a locked case is rejected, for ADMIN and SUPER_ADMIN alike — no hidden bypass", async () => {
    for (const actorId of [adminId, superAdminId]) {
      const created = await createTestCase({ assignedEngineerId: engineerId });
      const record = await createWorkRecord({ repairCaseId: created.id, actorUserId: engineerId, memo: "잠금 전 작성", relatedProcedureExecutionNodeId: null, clientRequestId: randomUUID() });
      assert.equal(record.ok, true);
      if (!record.ok) continue;

      await lockCase(created.id);
      const result = await invalidateWorkRecord({ workRecordId: record.id, actorUserId: actorId, reason: "잠금 후 무효 처리 시도" });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "CASE_LOCKED");
    }
  });

  test("22. an invalidated record remains readable via both the recent and full-history queries", async () => {
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const record = await createWorkRecord({ repairCaseId: created.id, actorUserId: engineerId, memo: "무효 처리되어도 조회는 되어야 함", relatedProcedureExecutionNodeId: null, clientRequestId: randomUUID() });
    assert.equal(record.ok, true);
    if (!record.ok) return;

    const invalidateResult = await invalidateWorkRecord({ workRecordId: record.id, actorUserId: adminId, reason: "테스트" });
    assert.equal(invalidateResult.ok, true);

    const recent = await getRecentWorkRecordsForCase(created.id, 5);
    const recentRow = recent.find((r) => r.id === record.id);
    assert.ok(recentRow, "invalidated record must still appear in the recent list");
    assert.equal(recentRow!.isInvalidated, true);
    assert.equal(recentRow!.invalidationReason, "테스트");

    const { rows: historyRows } = await getWorkRecordHistoryForCase(created.id, { limit: 20, offset: 0 });
    const historyRow = historyRows.find((r) => r.id === record.id);
    assert.ok(historyRow, "invalidated record must still appear in the full history");
    assert.equal(historyRow!.isInvalidated, true);
  });
});

describe("query ordering and pagination", () => {
  test("23. recent records are ordered newest-first, deterministically (created_at DESC, id DESC)", async () => {
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const result = await createWorkRecord({ repairCaseId: created.id, actorUserId: engineerId, memo: `기록 ${i}`, relatedProcedureExecutionNodeId: null, clientRequestId: randomUUID() });
      assert.equal(result.ok, true);
      if (result.ok) ids.push(result.id);
    }

    const recent = await getRecentWorkRecordsForCase(created.id, 10);
    const recentIds = recent.map((r) => r.id);
    // Newest-first: the last-inserted id must come first among rows created
    // in the same test (created_at may tie at millisecond resolution — the
    // id DESC tie-break must still produce a stable, repeatable order).
    assert.deepEqual(recentIds, [...ids].reverse());
  });

  test("24. full history is paginated correctly", async () => {
    const created = await createTestCase({ assignedEngineerId: engineerId });
    for (let i = 0; i < 7; i++) {
      const result = await createWorkRecord({ repairCaseId: created.id, actorUserId: engineerId, memo: `이력 ${i}`, relatedProcedureExecutionNodeId: null, clientRequestId: randomUUID() });
      assert.equal(result.ok, true);
    }

    const page1 = await getWorkRecordHistoryForCase(created.id, { limit: 5, offset: 0 });
    assert.equal(page1.total, 7);
    assert.equal(page1.rows.length, 5);

    const page2 = await getWorkRecordHistoryForCase(created.id, { limit: 5, offset: 5 });
    assert.equal(page2.total, 7);
    assert.equal(page2.rows.length, 2);

    const page1Ids = new Set(page1.rows.map((r) => r.id));
    const page2Ids = new Set(page2.rows.map((r) => r.id));
    assert.equal([...page1Ids].some((id) => page2Ids.has(id)), false, "pages must not overlap");
  });
});

describe("real-data safety", () => {
  test("25. this suite never touches the real repair cases, templates, nodes, edges, or ERROR issues", async () => {
    const [repairCaseCounts] = await db.select({ count: sql<number>`count(*)::int` }).from(repairCases).where(sql`intake_number not like ${"D" + TEST_YEAR_MONTH + "%"}`);
    const [templateCounts] = await db.select({ count: sql<number>`count(*)::int` }).from(procedureTemplates).where(sql`code not like ${TEST_CODE_PREFIX + "%"}`);
    const [nodeCounts] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(procedureTemplateNodes)
      .innerJoin(procedureTemplates, eq(procedureTemplateNodes.procedureTemplateId, procedureTemplates.id))
      .where(sql`${procedureTemplates.code} not like ${TEST_CODE_PREFIX + "%"}`);
    const [edgeCounts] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(procedureTemplateEdges)
      .innerJoin(procedureTemplates, eq(procedureTemplateEdges.procedureTemplateId, procedureTemplates.id))
      .where(sql`${procedureTemplates.code} not like ${TEST_CODE_PREFIX + "%"}`);
    const [errorIssueCounts] = await db.select({ count: sql<number>`count(*)::int` }).from(procedureTemplateValidationIssues).where(eq(procedureTemplateValidationIssues.severity, "ERROR"));

    assert.equal(repairCaseCounts?.count ?? 0, realDataBaseline.repairCaseCount, "real repair case count must be unchanged");
    assert.equal(templateCounts?.count ?? 0, realDataBaseline.templateCount, "real template count must be unchanged");
    assert.equal(nodeCounts?.count ?? 0, realDataBaseline.nodeCount, "real node count must be unchanged");
    assert.equal(edgeCounts?.count ?? 0, realDataBaseline.edgeCount, "real edge count must be unchanged");
    assert.equal(errorIssueCounts?.count ?? 0, realDataBaseline.errorIssueCount, "the 13 tracked ERROR issues must remain unchanged");
  });
});
