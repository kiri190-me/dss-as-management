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
  procedureTemplates,
  procedureTemplateNodes,
  procedureTemplateEdges,
  procedureTemplateEditHistory,
  procedureTemplateValidationIssues,
  procedureCaseExecutions,
  procedureCaseExecutionNodes,
  procedureCaseExecutionHistory,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import { createDraftProcedureTemplateFromImport, publishProcedureTemplate } from "./procedure-templates";
import {
  startProcedureExecution,
  startExecutionNode,
  completeExecutionNode,
  skipExecutionNode,
  blockExecutionNode,
  reopenExecutionNode,
  addExecutionExtraTask,
  updateExecutionNodeMemo,
} from "./procedure-case-execution";
import { getExecutionDetail, getExecutionHistory, getRelatedRepairHistory } from "../queries/procedure-case-execution";
import type { ExtractedTemplate } from "../../../../scripts/lib/xlsx/types";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Phase 5A integration tests for the repair-case procedure execution
 * mutation layer, against the real dev DB. Self-cleaning convention (same
 * as procedure-template-editor.integration.test.ts /
 * workflow-transitions.integration.test.ts): every template uses a code
 * prefixed with TEST_CODE_PREFIX, every repair case uses intake month
 * TEST_YEAR_MONTH ("9905", distinct from every other isolated month already
 * in use), every product uses TEST_MODEL_PREFIX. after() deletes every row
 * this suite created (execution history first, since it's onDelete:
 * "restrict" against both executions and execution-nodes) and never
 * touches the four real imported templates, their 13 tracked ERROR
 * validation issues, or any other suite's fixtures.
 */

const TEST_CODE_PREFIX = "test-execution-";
const TEST_MODEL_PREFIX = "EXECUTION-TEST-";
const TEST_YEAR_MONTH = "9905";
const TEST_RECEIVED_AT = "2099-05-10";
const TEST_SHIPMENT_DATE = "2099-05-20";

let superAdminId: string;
let adminId: string;
let engineerId: string;
let engineer2Id: string;
let salesId: string;
let customerId: string;

const createdTemplateIds: string[] = [];

let realTemplateBaseline: { templateCount: number; nodeCount: number; edgeCount: number; errorIssueCount: number };

function uniqueCode(suffix: string): string {
  return `${TEST_CODE_PREFIX}${suffix}-${randomUUID().slice(0, 8)}`;
}

/**
 * START -> TASK -> DECISION -> (YES: TASK -> DOCUMENT_REFERENCE -> END) /
 * (NG: CORRECTIVE_ACTION back to DECISION via RETRY) — 7 template nodes, 1
 * of which (n6, DOCUMENT_REFERENCE) is inline with an outgoing edge, same
 * pattern as the two real RFG DOCUMENT_REFERENCE nodes (Phase 5A plan §1).
 * Exactly 6 of the 7 node types are classification-A (executable);
 * structurally clean under procedure-graph-structural-validation.ts (the
 * inline reference only triggers a WARNING, never an ERROR — confirmed by
 * reading the validator directly), so publish always succeeds.
 */
function makeExecutionTestTemplate(code: string): ExtractedTemplate {
  const sheet = "(TEST) 실행 테스트 시트";
  return {
    code,
    name: `실행 테스트 ${code}`,
    equipmentType: "RFG",
    description: "Phase 5A execution mutation integration test fixture",
    sourceWorksheets: [sheet],
    isReferenceOnly: false,
    referenceItems: [],
    nodes: [
      { nodeCode: "n1", nodeType: "START", title: "시작", positionX: 0, positionY: 0, sortOrder: 0, sourceWorksheet: sheet, sourceShapeId: "1" },
      { nodeCode: "n2", nodeType: "TASK", title: "준비 작업", positionX: 100, positionY: 0, sortOrder: 1, sourceWorksheet: sheet, sourceShapeId: "2" },
      { nodeCode: "n3", nodeType: "DECISION", title: "판단", positionX: 200, positionY: 0, sortOrder: 2, sourceWorksheet: sheet, sourceShapeId: "3" },
      { nodeCode: "n4", nodeType: "TASK", title: "정상 작업", positionX: 300, positionY: 0, sortOrder: 3, sourceWorksheet: sheet, sourceShapeId: "4" },
      { nodeCode: "n5", nodeType: "CORRECTIVE_ACTION", title: "NG 조치", positionX: 200, positionY: 100, sortOrder: 4, sourceWorksheet: sheet, sourceShapeId: "5" },
      { nodeCode: "n6", nodeType: "DOCUMENT_REFERENCE", title: "참조 문서", positionX: 400, positionY: 0, sortOrder: 5, sourceWorksheet: sheet, sourceShapeId: "6" },
      { nodeCode: "n7", nodeType: "END", title: "종료", positionX: 500, positionY: 0, sortOrder: 6, sourceWorksheet: sheet, sourceShapeId: "7" },
    ],
    edges: [
      { fromNodeCode: "n1", toNodeCode: "n2", branchType: "DEFAULT", branchLabel: null, sortOrder: 0, sourceConnectorId: "c1" },
      { fromNodeCode: "n2", toNodeCode: "n3", branchType: "DEFAULT", branchLabel: null, sortOrder: 1, sourceConnectorId: "c2" },
      { fromNodeCode: "n3", toNodeCode: "n4", branchType: "YES", branchLabel: "YES", sortOrder: 2, sourceConnectorId: "c3" },
      { fromNodeCode: "n3", toNodeCode: "n5", branchType: "NG", branchLabel: "NG", sortOrder: 3, sourceConnectorId: "c4" },
      { fromNodeCode: "n5", toNodeCode: "n3", branchType: "RETRY", branchLabel: "재측정", sortOrder: 4, sourceConnectorId: "c5" },
      { fromNodeCode: "n4", toNodeCode: "n6", branchType: "DEFAULT", branchLabel: null, sortOrder: 5, sourceConnectorId: "c6" },
      { fromNodeCode: "n6", toNodeCode: "n7", branchType: "DEFAULT", branchLabel: null, sortOrder: 6, sourceConnectorId: "c7" },
    ],
    checklistSections: [],
    troubleshootingEntries: [],
    issues: [],
  };
}

async function loadNodesByCode(templateId: string) {
  const rows = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.procedureTemplateId, templateId));
  return new Map(rows.map((n) => [n.nodeCode, n]));
}

async function loadEdges(templateId: string) {
  return db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.procedureTemplateId, templateId));
}

async function createPublishedTemplate(code: string) {
  const draftResult = await createDraftProcedureTemplateFromImport(makeExecutionTestTemplate(code), superAdminId, {
    sourceFileName: "execution-fixture.xlsx",
    sourceFileHash: `hash-${code}`,
  });
  assert.equal(draftResult.ok, true, `fixture import failed: ${JSON.stringify(draftResult)}`);
  if (!draftResult.ok) throw new Error("unreachable");
  createdTemplateIds.push(draftResult.id);

  const publishResult = await publishProcedureTemplate(draftResult.id, superAdminId);
  assert.equal(publishResult.ok, true, `fixture publish failed: ${JSON.stringify(publishResult)}`);

  const nodes = await loadNodesByCode(draftResult.id);
  const edges = await loadEdges(draftResult.id);
  return { templateId: draftResult.id, nodes, edges };
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

async function loadExecutionNodesByCode(templateId: string, executionId: string) {
  const templateNodes = await loadNodesByCode(templateId);
  const execNodes = await db
    .select()
    .from(procedureCaseExecutionNodes)
    .where(eq(procedureCaseExecutionNodes.executionId, executionId));
  const byTemplateNodeId = new Map(execNodes.map((n) => [n.procedureTemplateNodeId, n]));
  const byCode = new Map<string, (typeof execNodes)[number]>();
  for (const [code, templateNode] of templateNodes) {
    const execNode = byTemplateNodeId.get(templateNode.id);
    if (execNode) byCode.set(code, execNode);
  }
  return byCode;
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

  const [customer] = await db.select({ id: customers.id }).from(customers).where(eq(customers.isDeleted, false)).limit(1);
  assert.ok(customer, "expected at least one non-deleted customer in the dev DB");
  customerId = customer.id;

  const [realCounts] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(procedureTemplates)
    .where(sql`code not like ${TEST_CODE_PREFIX + "%"}`);
  const [realNodeCounts] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(procedureTemplateNodes)
    .innerJoin(procedureTemplates, eq(procedureTemplateNodes.procedureTemplateId, procedureTemplates.id))
    .where(sql`${procedureTemplates.code} not like ${TEST_CODE_PREFIX + "%"}`);
  const [realEdgeCounts] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(procedureTemplateEdges)
    .innerJoin(procedureTemplates, eq(procedureTemplateEdges.procedureTemplateId, procedureTemplates.id))
    .where(sql`${procedureTemplates.code} not like ${TEST_CODE_PREFIX + "%"}`);
  const [realErrorIssueCounts] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(procedureTemplateValidationIssues)
    .where(eq(procedureTemplateValidationIssues.severity, "ERROR"));

  realTemplateBaseline = {
    templateCount: realCounts?.count ?? 0,
    nodeCount: realNodeCounts?.count ?? 0,
    edgeCount: realEdgeCounts?.count ?? 0,
    errorIssueCount: realErrorIssueCounts?.count ?? 0,
  };
});

after(async () => {
  const allTestTemplates = await db.select({ id: procedureTemplates.id }).from(procedureTemplates).where(like(procedureTemplates.code, `${TEST_CODE_PREFIX}%`));
  const allTemplateIds = [...new Set([...createdTemplateIds, ...allTestTemplates.map((t) => t.id)])];

  const testCases = await db.select({ id: repairCases.id }).from(repairCases).where(like(repairCases.intakeNumber, "D9905%"));
  const testCaseIds = testCases.map((c) => c.id);

  if (testCaseIds.length > 0) {
    const executions = await db.select({ id: procedureCaseExecutions.id }).from(procedureCaseExecutions).where(inArray(procedureCaseExecutions.repairCaseId, testCaseIds));
    const executionIds = executions.map((e) => e.id);
    if (executionIds.length > 0) {
      await db.delete(procedureCaseExecutionHistory).where(inArray(procedureCaseExecutionHistory.executionId, executionIds));
      await db.delete(procedureCaseExecutionNodes).where(inArray(procedureCaseExecutionNodes.executionId, executionIds));
      await db.delete(procedureCaseExecutions).where(inArray(procedureCaseExecutions.id, executionIds));
    }
  }

  await db.delete(repairCases).where(like(repairCases.intakeNumber, "D9905%"));
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

describe("procedure-case-execution: eager creation and classification (plan §1)", () => {
  test("1. starting execution creates exactly 6 execution-node rows (7 template nodes minus 1 DOCUMENT_REFERENCE), START auto-completed", async () => {
    const { templateId, nodes } = await createPublishedTemplate(uniqueCode("classification"));
    const created = await createTestCase();

    const result = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(result.ok, true, `start failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const execNodes = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.executionId, result.executionId));
    assert.equal(execNodes.length, 6, "expected exactly 6 executable node rows (7 - 1 DOCUMENT_REFERENCE)");

    const byCode = await loadExecutionNodesByCode(templateId, result.executionId);
    assert.equal(byCode.has("n6"), false, "DOCUMENT_REFERENCE (n6) must never get an execution-node row");
    assert.equal(byCode.get("n1")!.status, "COMPLETED", "START must be auto-completed");
    assert.equal(byCode.get("n1")!.completedBy, engineerId);
    for (const code of ["n2", "n3", "n4", "n5", "n7"]) {
      assert.equal(byCode.get(code)!.status, "PENDING", `${code} must start PENDING`);
    }

    const history = await db.select().from(procedureCaseExecutionHistory).where(eq(procedureCaseExecutionHistory.executionId, result.executionId));
    const startedHistoryRows = history.filter((h) => h.actionType === "EXECUTION_STARTED");
    assert.equal(startedHistoryRows.length, 1);
    assert.deepEqual(startedHistoryRows[0].afterState, {
      procedureTemplateId: templateId,
      executableNodeCount: 6,
      autoCompletedSystemNodeCount: 1,
    });
    assert.equal(
      history.some((h) => h.actionType === "NODE_COMPLETED"),
      false,
      "the auto-completed START node must never produce a NODE_COMPLETED (user-action) history row — EXECUTION_STARTED alone documents system initialization"
    );

    assert.equal(nodes.size, 7);
  });

  test("2. starting execution twice for the same case is rejected (double-start race guarded by the unique index)", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("double-start"));
    const created = await createTestCase();

    const [a, b] = await Promise.all([
      startProcedureExecution(created.id, templateId, engineerId),
      startProcedureExecution(created.id, templateId, engineerId),
    ]);
    const results = [a, b];
    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    assert.equal(succeeded.length, 1, `expected exactly one success, got ${JSON.stringify(results)}`);
    assert.equal(failed.length, 1);
    if (!failed[0].ok) assert.equal(failed[0].code, "ALREADY_STARTED");
  });

  test("3. starting execution against a DRAFT (unpublished) template is rejected", async () => {
    const draftResult = await createDraftProcedureTemplateFromImport(makeExecutionTestTemplate(uniqueCode("draft-guard")), superAdminId, {
      sourceFileName: "execution-fixture.xlsx",
      sourceFileHash: `hash-draft-${randomUUID()}`,
    });
    assert.equal(draftResult.ok, true);
    if (!draftResult.ok) return;
    createdTemplateIds.push(draftResult.id);

    const created = await createTestCase();
    const result = await startProcedureExecution(created.id, draftResult.id, engineerId);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "TEMPLATE_NOT_EXECUTABLE");
  });

  test("4. an AS_ENGINEER who is not assigned to the case cannot start execution", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("unassigned-start"));
    const created = await createTestCase({ assignedEngineerId: engineerId });

    const result = await startProcedureExecution(created.id, templateId, engineer2Id);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });
});

describe("procedure-case-execution: node actions and DECISION branch selection (plan §6)", () => {
  test("5. self-claim on start assigns the actor when the node had no prior assignment", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("self-claim"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n2 = byCode.get("n2")!;
    assert.equal(n2.assignedEngineerId, null);

    const result = await startExecutionNode(n2.id, engineerId, n2.version);
    assert.equal(result.ok, true, JSON.stringify(result));

    const [updated] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, n2.id));
    assert.equal(updated.status, "IN_PROGRESS");
    assert.equal(updated.assignedEngineerId, engineerId);
  });

  test("6. completing a DECISION node without a selection is rejected with DECISION_SELECTION_REQUIRED", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("decision-required"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n3 = byCode.get("n3")!;
    const result = await completeExecutionNode({ executionNodeId: n3.id, actorUserId: engineerId, expectedVersion: n3.version });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "DECISION_SELECTION_REQUIRED");
  });

  test("7. completing a DECISION node with an edge that doesn't originate from it is rejected with INVALID_DECISION_SELECTION", async () => {
    const { templateId, edges } = await createPublishedTemplate(uniqueCode("decision-wrong-edge"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n3 = byCode.get("n3")!;
    // n4 -> n6 edge does not originate from the DECISION node (n3).
    const wrongEdge = edges.find((e) => e.branchType === "DEFAULT" && e.sourceConnectorId === "c6")!;
    assert.ok(wrongEdge);

    const result = await completeExecutionNode({
      executionNodeId: n3.id,
      actorUserId: engineerId,
      expectedVersion: n3.version,
      selectedOutgoingEdgeId: wrongEdge.id,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_DECISION_SELECTION");
  });

  test("8. completing a DECISION node with a valid outgoing edge succeeds and records the selection", async () => {
    const { templateId, edges } = await createPublishedTemplate(uniqueCode("decision-valid"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n3 = byCode.get("n3")!;
    const yesEdge = edges.find((e) => e.branchType === "YES")!;

    const result = await completeExecutionNode({
      executionNodeId: n3.id,
      actorUserId: engineerId,
      expectedVersion: n3.version,
      selectedOutgoingEdgeId: yesEdge.id,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const [updated] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, n3.id));
    assert.equal(updated.status, "COMPLETED");
    assert.equal(updated.selectedOutgoingEdgeId, yesEdge.id);

    const history = await db
      .select()
      .from(procedureCaseExecutionHistory)
      .where(and(eq(procedureCaseExecutionHistory.executionNodeId, n3.id), eq(procedureCaseExecutionHistory.actionType, "NODE_COMPLETED")));
    assert.equal(history.length, 1);
    assert.deepEqual(history[0].afterState, { selectedOutgoingEdgeId: yesEdge.id });
  });

  test("9. a selectedOutgoingEdgeId provided for a non-DECISION node is rejected with INVALID_INPUT", async () => {
    const { templateId, edges } = await createPublishedTemplate(uniqueCode("non-decision-selection"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n2 = byCode.get("n2")!;
    const someEdge = edges[0];

    const result = await completeExecutionNode({
      executionNodeId: n2.id,
      actorUserId: engineerId,
      expectedVersion: n2.version,
      selectedOutgoingEdgeId: someEdge.id,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });
});

describe("procedure-case-execution: skip/block/reopen permission table (plan §8)", () => {
  test("10. skip and block both require a reason", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("reason-required"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n2 = byCode.get("n2")!;

    const skipResult = await skipExecutionNode(n2.id, engineerId, n2.version, "");
    assert.equal(skipResult.ok, false);
    if (!skipResult.ok) assert.equal(skipResult.code, "REASON_REQUIRED");

    const blockResult = await blockExecutionNode(n2.id, engineerId, n2.version, "   ");
    assert.equal(blockResult.ok, false);
    if (!blockResult.ok) assert.equal(blockResult.code, "REASON_REQUIRED");
  });

  test("11. reopening a COMPLETED node requires ADMIN+ — the assigned AS_ENGINEER is FORBIDDEN, ADMIN succeeds", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("reopen-completed"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n2 = byCode.get("n2")!;
    const completed = await completeExecutionNode({ executionNodeId: n2.id, actorUserId: engineerId, expectedVersion: n2.version });
    assert.equal(completed.ok, true);
    if (!completed.ok) return;

    const engineerReopen = await reopenExecutionNode(n2.id, engineerId, completed.version, "재작업 필요");
    assert.equal(engineerReopen.ok, false);
    if (!engineerReopen.ok) assert.equal(engineerReopen.code, "FORBIDDEN");

    const adminReopen = await reopenExecutionNode(n2.id, adminId, completed.version, "재작업 필요");
    assert.equal(adminReopen.ok, true, JSON.stringify(adminReopen));

    const [updated] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, n2.id));
    assert.equal(updated.status, "IN_PROGRESS");
    assert.equal(updated.completedAt, null);
    assert.equal(updated.completedBy, null);
  });

  test("12. reopening a BLOCKED node is allowed for the assigned AS_ENGINEER, but not for an unassigned one", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("reopen-blocked"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n2 = byCode.get("n2")!;
    const blocked = await blockExecutionNode(n2.id, engineerId, n2.version, "부품 대기");
    assert.equal(blocked.ok, true);
    if (!blocked.ok) return;

    const strangerReopen = await reopenExecutionNode(n2.id, engineer2Id, blocked.version, "재개");
    assert.equal(strangerReopen.ok, false);
    if (!strangerReopen.ok) assert.equal(strangerReopen.code, "FORBIDDEN");

    const assignedReopen = await reopenExecutionNode(n2.id, engineerId, blocked.version, "부품 도착, 재개");
    assert.equal(assignedReopen.ok, true, JSON.stringify(assignedReopen));
  });

  test("13. SALES (read-only role) cannot skip/block/complete a node", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("sales-forbidden"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n2 = byCode.get("n2")!;
    const result = await completeExecutionNode({ executionNodeId: n2.id, actorUserId: salesId, expectedVersion: n2.version });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });
});

describe("procedure-case-execution: extra tasks and work-memo audit (plan §9)", () => {
  test("14. adding an extra task leaves procedure_template_nodes row counts unchanged and creates a node with no template counterpart", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("extra-task"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const [beforeCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(procedureTemplateNodes)
      .where(eq(procedureTemplateNodes.procedureTemplateId, templateId));

    const result = await addExecutionExtraTask(started.executionId, engineerId, "추가 점검 작업", "케이블 재확인");
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;

    const [afterCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(procedureTemplateNodes)
      .where(eq(procedureTemplateNodes.procedureTemplateId, templateId));
    assert.equal(afterCount.count, beforeCount.count, "extra-task creation must never touch procedure_template_nodes");

    const [node] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, result.executionNodeId));
    assert.equal(node.procedureTemplateNodeId, null);
    assert.equal(node.extraTaskTitle, "추가 점검 작업");
    assert.equal(node.status, "PENDING");
  });

  test("15. an extra task requires a non-blank title", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("extra-task-blank"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const result = await addExecutionExtraTask(started.executionId, engineerId, "   ", null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });

  test("16. updateExecutionNodeMemo produces a reconstructable history chain, never silently overwriting", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("memo-history"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n2 = byCode.get("n2")!;

    const first = await updateExecutionNodeMemo(n2.id, engineerId, n2.version, "1차 점검 메모");
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const second = await updateExecutionNodeMemo(n2.id, engineerId, first.version, "2차 점검 메모 (수정)");
    assert.equal(second.ok, true);
    if (!second.ok) return;

    const [node] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, n2.id));
    assert.equal(node.workMemo, "2차 점검 메모 (수정)");

    const history = await db
      .select()
      .from(procedureCaseExecutionHistory)
      .where(and(eq(procedureCaseExecutionHistory.executionNodeId, n2.id), eq(procedureCaseExecutionHistory.actionType, "NODE_MEMO_UPDATED")))
      .orderBy(procedureCaseExecutionHistory.createdAt);
    assert.equal(history.length, 2);
    assert.deepEqual(history[0].beforeState, { memo: null });
    assert.deepEqual(history[0].afterState, { memo: "1차 점검 메모" });
    assert.deepEqual(history[1].beforeState, { memo: "1차 점검 메모" });
    assert.deepEqual(history[1].afterState, { memo: "2차 점검 메모 (수정)" });
  });

  test("26. a real memo change increments version by exactly 1 and creates exactly one NODE_MEMO_UPDATED history row", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("memo-real-change"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n2 = byCode.get("n2")!;

    const result = await updateExecutionNodeMemo(n2.id, engineerId, n2.version, "실제 변경된 메모");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.version, n2.version + 1);

    const [node] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, n2.id));
    assert.equal(node.version, n2.version + 1);
    assert.equal(node.workMemo, "실제 변경된 메모");

    const history = await db
      .select()
      .from(procedureCaseExecutionHistory)
      .where(and(eq(procedureCaseExecutionHistory.executionNodeId, n2.id), eq(procedureCaseExecutionHistory.actionType, "NODE_MEMO_UPDATED")));
    assert.equal(history.length, 1);
  });

  test("27. an identical memo resave is a no-op: zero new history rows, version and updated_at unchanged", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("memo-noop-identical"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n2 = byCode.get("n2")!;

    const first = await updateExecutionNodeMemo(n2.id, engineerId, n2.version, "동일한 메모 내용");
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const [afterFirst] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, n2.id));

    // Resave the exact same content at the now-current version.
    const resave = await updateExecutionNodeMemo(n2.id, engineerId, afterFirst.version, "동일한 메모 내용");
    assert.equal(resave.ok, true, JSON.stringify(resave));
    if (!resave.ok) return;
    assert.equal(resave.version, afterFirst.version, "a no-op resave must not report a bumped version");

    const [afterResave] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, n2.id));
    assert.equal(afterResave.version, afterFirst.version, "version must not increment on a no-op resave");
    assert.deepEqual(afterResave.updatedAt, afterFirst.updatedAt, "updated_at must not change on a no-op resave");
    assert.equal(afterResave.workMemo, "동일한 메모 내용");

    const history = await db
      .select()
      .from(procedureCaseExecutionHistory)
      .where(and(eq(procedureCaseExecutionHistory.executionNodeId, n2.id), eq(procedureCaseExecutionHistory.actionType, "NODE_MEMO_UPDATED")));
    assert.equal(history.length, 1, "the no-op resave must not create a second history row (only the first real write counts)");
  });

  test("28. normalization-equivalent resaves (surrounding whitespace, empty string vs null) are also treated as no-ops", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("memo-noop-normalized"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n2 = byCode.get("n2")!;
    const n4 = byCode.get("n4")!;

    // Case A: whitespace-padded resubmission of the same trimmed content.
    const first = await updateExecutionNodeMemo(n2.id, engineerId, n2.version, "공백 테스트");
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const paddedResave = await updateExecutionNodeMemo(n2.id, engineerId, first.version, "  공백 테스트  ");
    assert.equal(paddedResave.ok, true);
    if (!paddedResave.ok) return;
    assert.equal(paddedResave.version, first.version, "leading/trailing whitespace alone must not count as a real change");
    const [nodeA] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, n2.id));
    assert.equal(nodeA.workMemo, "공백 테스트", "the persisted value itself stays trimmed");

    // Case B: an empty-string resubmission against an already-null memo (n4 was never touched — starts null).
    const emptyResave = await updateExecutionNodeMemo(n4.id, engineerId, n4.version, "   ");
    assert.equal(emptyResave.ok, true);
    if (!emptyResave.ok) return;
    assert.equal(emptyResave.version, n4.version, "an empty/whitespace-only memo against a null memo must normalize to no change");
    const [nodeB] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, n4.id));
    assert.equal(nodeB.workMemo, null);

    const historyA = await db
      .select()
      .from(procedureCaseExecutionHistory)
      .where(and(eq(procedureCaseExecutionHistory.executionNodeId, n2.id), eq(procedureCaseExecutionHistory.actionType, "NODE_MEMO_UPDATED")));
    assert.equal(historyA.length, 1);
    const historyB = await db
      .select()
      .from(procedureCaseExecutionHistory)
      .where(and(eq(procedureCaseExecutionHistory.executionNodeId, n4.id), eq(procedureCaseExecutionHistory.actionType, "NODE_MEMO_UPDATED")));
    assert.equal(historyB.length, 0, "a no-op-from-the-start memo update must never create a history row");
  });

  test("29. a stale expectedVersion on an identical-content resave still returns CONFLICT, not a silent no-op", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("memo-stale-version-identical"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n2 = byCode.get("n2")!;

    const first = await updateExecutionNodeMemo(n2.id, engineerId, n2.version, "고정된 메모 내용");
    assert.equal(first.ok, true);
    if (!first.ok) return;

    // Same exact content, but expectedVersion is now stale (still n2.version, pre-write).
    const staleResave = await updateExecutionNodeMemo(n2.id, engineerId, n2.version, "고정된 메모 내용");
    assert.equal(staleResave.ok, false);
    if (!staleResave.ok) assert.equal(staleResave.code, "CONFLICT", "stale-version detection must win over the no-op check even when content is identical");
  });
});

describe("procedure-case-execution: concurrency (plan's revised test list)", () => {
  test("17. two different engineers acting on two different nodes never conflict", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("concurrency-different-nodes"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n2 = byCode.get("n2")!;
    const n4 = byCode.get("n4")!;

    const [resultA, resultB] = await Promise.all([
      completeExecutionNode({ executionNodeId: n2.id, actorUserId: engineerId, expectedVersion: n2.version }),
      startExecutionNode(n4.id, adminId, n4.version),
    ]);
    assert.equal(resultA.ok, true, JSON.stringify(resultA));
    assert.equal(resultB.ok, true, JSON.stringify(resultB));
  });

  test("18. two concurrent completions of the same node with the same expected version: exactly one succeeds, the other gets CONFLICT", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("concurrency-same-node"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n2 = byCode.get("n2")!;

    const [a, b] = await Promise.all([
      completeExecutionNode({ executionNodeId: n2.id, actorUserId: engineerId, expectedVersion: n2.version }),
      completeExecutionNode({ executionNodeId: n2.id, actorUserId: adminId, expectedVersion: n2.version }),
    ]);
    const results = [a, b];
    const succeeded = results.filter((r) => r.ok);
    const conflicted = results.filter((r) => !r.ok);
    assert.equal(succeeded.length, 1, `expected exactly one success, got ${JSON.stringify(results)}`);
    assert.equal(conflicted.length, 1);
    if (!conflicted[0].ok) assert.equal(conflicted[0].code, "CONFLICT");
  });
});

describe("procedure-case-execution: locked-case behavior, no role exception (plan §11)", () => {
  test("19. every mutation is rejected with CASE_LOCKED once the case is locked, even for SUPER_ADMIN", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("locked-case"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n2 = byCode.get("n2")!;

    await lockCase(created.id);

    const startResult = await startExecutionNode(n2.id, superAdminId, n2.version);
    assert.equal(startResult.ok, false);
    if (!startResult.ok) assert.equal(startResult.code, "CASE_LOCKED");

    const completeResult = await completeExecutionNode({ executionNodeId: n2.id, actorUserId: superAdminId, expectedVersion: n2.version });
    assert.equal(completeResult.ok, false);
    if (!completeResult.ok) assert.equal(completeResult.code, "CASE_LOCKED");

    const skipResult = await skipExecutionNode(n2.id, superAdminId, n2.version, "사유");
    assert.equal(skipResult.ok, false);
    if (!skipResult.ok) assert.equal(skipResult.code, "CASE_LOCKED");

    const blockResult = await blockExecutionNode(n2.id, superAdminId, n2.version, "사유");
    assert.equal(blockResult.ok, false);
    if (!blockResult.ok) assert.equal(blockResult.code, "CASE_LOCKED");

    const extraTaskResult = await addExecutionExtraTask(started.executionId, superAdminId, "추가 작업", null);
    assert.equal(extraTaskResult.ok, false);
    if (!extraTaskResult.ok) assert.equal(extraTaskResult.code, "CASE_LOCKED");

    const memoResult = await updateExecutionNodeMemo(n2.id, superAdminId, n2.version, "메모");
    assert.equal(memoResult.ok, false);
    if (!memoResult.ok) assert.equal(memoResult.code, "CASE_LOCKED");

    const newExecutionResult = await startProcedureExecution(created.id, templateId, superAdminId);
    assert.equal(newExecutionResult.ok, false);
    if (!newExecutionResult.ok) assert.equal(newExecutionResult.code, "CASE_LOCKED");
  });

  test("20. reopen is also rejected with CASE_LOCKED, even for SUPER_ADMIN", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("locked-case-reopen"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n2 = byCode.get("n2")!;
    const completed = await completeExecutionNode({ executionNodeId: n2.id, actorUserId: engineerId, expectedVersion: n2.version });
    assert.equal(completed.ok, true);
    if (!completed.ok) return;

    await lockCase(created.id);

    const reopenResult = await reopenExecutionNode(n2.id, superAdminId, completed.version, "사유");
    assert.equal(reopenResult.ok, false);
    if (!reopenResult.ok) assert.equal(reopenResult.code, "CASE_LOCKED");
  });
});

describe("procedure-case-execution: read queries", () => {
  test("22. getExecutionDetail resolves live template content, marks suggested-next nodes, and excludes DOCUMENT_REFERENCE and START from the user-facing node list", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("query-detail"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n1 = byCode.get("n1")!;
    const n2 = byCode.get("n2")!;
    const n3 = byCode.get("n3")!;

    const detail = await getExecutionDetail(started.executionId);
    assert.ok(detail);
    assert.equal(
      detail!.nodes.length,
      5,
      "5 user-facing nodes (7 template nodes minus 1 DOCUMENT_REFERENCE minus 1 START system entry marker)"
    );
    assert.equal(detail!.referenceNodes.length, 1);
    assert.equal(detail!.referenceNodes[0].nodeCode, "n6");
    assert.equal(detail!.nodes.some((n) => n.nodeCode === "n6"), false, "DOCUMENT_REFERENCE must never appear in the user-facing node list");
    assert.equal(detail!.nodes.some((n) => n.id === n1.id), false, "the auto-completed START node must never appear in the user-facing node list");
    assert.equal(
      detail!.nodes.filter((n) => n.status === "COMPLETED").length,
      0,
      "START's auto-completion must not count toward user-facing progress (0 completed, not 1, right after execution start)"
    );

    const n2Detail = detail!.nodes.find((n) => n.id === n2.id)!;
    assert.equal(n2Detail.isSuggestedNext, true, "n2's only predecessor (n1, START) is auto-completed, so n2 should be suggested");
    assert.equal(n2Detail.title, "준비 작업");

    const n3Detail = detail!.nodes.find((n) => n.id === n3.id)!;
    assert.equal(n3Detail.outgoingEdgeOptions.length, 2, "the DECISION node must expose both of its outgoing branch options");
  });

  test("23. getExecutionHistory returns newest-first rows with the actor's resolved name", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("query-history"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n2 = byCode.get("n2")!;
    await completeExecutionNode({ executionNodeId: n2.id, actorUserId: engineerId, expectedVersion: n2.version });

    const history = await getExecutionHistory(started.executionId);
    assert.ok(history.length >= 2);
    assert.equal(history[0].actionType, "NODE_COMPLETED", "most recent action must come first");
    assert.ok(history.some((h) => h.actionType === "EXECUTION_STARTED"));
    assert.ok(history.every((h) => h.actorName && h.actorName.length > 0));
  });

  test("24. getRelatedRepairHistory buckets SAME_PRODUCT vs SAME_MODEL_REFERENCE and never conflates them (plan §12)", async () => {
    const suffix = randomUUID().slice(0, 8);
    const model = `${TEST_MODEL_PREFIX}REL-${suffix}`;
    const serial = `SN-REL-${suffix}`;

    const original = await createTestCase({ modelName: model, serialNumber: serial, lotNumber: `LOT-A-${suffix}`, receivedAt: "2099-05-15" });
    const sameProductCase = await createTestCase({ modelName: model, serialNumber: serial, lotNumber: `LOT-A-${suffix}`, receivedAt: "2099-05-01" });
    const sameModelOnlyCase = await createTestCase({ modelName: model, serialNumber: `SN-DIFFERENT-${suffix}`, lotNumber: `LOT-B-${suffix}`, receivedAt: "2099-05-05" });

    const [originalRow] = await db.select({ productId: repairCases.productId }).from(repairCases).where(eq(repairCases.id, original.id));

    const result = await getRelatedRepairHistory(original.id, originalRow.productId);
    assert.equal(result.sameProduct.length, 1);
    assert.equal(result.sameProduct[0].id, sameProductCase.id);
    assert.ok(result.sameModelReference.some((r) => r.id === sameModelOnlyCase.id));
    assert.equal(result.sameProduct.some((r) => r.id === sameModelOnlyCase.id), false, "a serial mismatch must never be promoted to SAME_PRODUCT");
  });
});

describe("procedure-case-execution: START is a non-interactive system entry marker (browser-verification fix)", () => {
  test("25. start/complete/skip/block/reopen/memo-update on the auto-completed START node are all rejected server-side with SYSTEM_MANAGED_NODE", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("start-node-guard"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n1 = byCode.get("n1")!;
    assert.equal(n1.status, "COMPLETED", "sanity check: START is auto-completed");

    const startResult = await startExecutionNode(n1.id, engineerId, n1.version);
    assert.equal(startResult.ok, false);
    if (!startResult.ok) assert.equal(startResult.code, "SYSTEM_MANAGED_NODE");

    const completeResult = await completeExecutionNode({ executionNodeId: n1.id, actorUserId: engineerId, expectedVersion: n1.version });
    assert.equal(completeResult.ok, false);
    if (!completeResult.ok) assert.equal(completeResult.code, "SYSTEM_MANAGED_NODE");

    const skipResult = await skipExecutionNode(n1.id, engineerId, n1.version, "사유");
    assert.equal(skipResult.ok, false);
    if (!skipResult.ok) assert.equal(skipResult.code, "SYSTEM_MANAGED_NODE");

    const blockResult = await blockExecutionNode(n1.id, engineerId, n1.version, "사유");
    assert.equal(blockResult.ok, false);
    if (!blockResult.ok) assert.equal(blockResult.code, "SYSTEM_MANAGED_NODE");

    // SUPER_ADMIN too — SYSTEM_MANAGED_NODE is a structural rule about the
    // node itself, not a role-gated permission, so no role gets an exception.
    const reopenResult = await reopenExecutionNode(n1.id, superAdminId, n1.version, "사유");
    assert.equal(reopenResult.ok, false);
    if (!reopenResult.ok) assert.equal(reopenResult.code, "SYSTEM_MANAGED_NODE");

    const memoResult = await updateExecutionNodeMemo(n1.id, superAdminId, n1.version, "메모");
    assert.equal(memoResult.ok, false);
    if (!memoResult.ok) assert.equal(memoResult.code, "SYSTEM_MANAGED_NODE");

    // None of the rejected attempts changed the row.
    const [unchangedRow] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, n1.id));
    assert.equal(unchangedRow.version, n1.version);
    assert.equal(unchangedRow.status, "COMPLETED");
    assert.equal(unchangedRow.workMemo, null);
  });
});

describe("procedure-case-execution: real-data safety", () => {
  test("21. real templates' node/edge counts and the 13 tracked ERROR validation issues are unchanged after the full suite", async () => {
    const [realCounts] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(procedureTemplates)
      .where(sql`code not like ${TEST_CODE_PREFIX + "%"}`);
    const [realNodeCounts] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(procedureTemplateNodes)
      .innerJoin(procedureTemplates, eq(procedureTemplateNodes.procedureTemplateId, procedureTemplates.id))
      .where(sql`${procedureTemplates.code} not like ${TEST_CODE_PREFIX + "%"}`);
    const [realEdgeCounts] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(procedureTemplateEdges)
      .innerJoin(procedureTemplates, eq(procedureTemplateEdges.procedureTemplateId, procedureTemplates.id))
      .where(sql`${procedureTemplates.code} not like ${TEST_CODE_PREFIX + "%"}`);
    const [realErrorIssueCounts] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(procedureTemplateValidationIssues)
      .where(eq(procedureTemplateValidationIssues.severity, "ERROR"));

    assert.equal(realCounts?.count ?? 0, realTemplateBaseline.templateCount);
    assert.equal(realNodeCounts?.count ?? 0, realTemplateBaseline.nodeCount);
    assert.equal(realEdgeCounts?.count ?? 0, realTemplateBaseline.edgeCount);
    assert.equal(realErrorIssueCounts?.count ?? 0, realTemplateBaseline.errorIssueCount);
  });
});
