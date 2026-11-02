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
  finishProcedureExecution,
  abandonProcedureExecution,
  startExecutionNode,
  completeExecutionNode,
  skipExecutionNode,
  blockExecutionNode,
  reopenExecutionNode,
  addExecutionExtraTask,
  updateExecutionNodeMemo,
} from "./procedure-case-execution";
import {
  getActiveExecutionForCase,
  getExecutableTemplateOptions,
  getExecutionDetail,
  getExecutionHistory,
  getOtherExecutionsForCase,
  getRelatedRepairHistory,
} from "../queries/procedure-case-execution";
import { buildPastExecutionPanel } from "@/lib/domain/procedure-execution-past-runs";
import { placeExecutionSummary } from "@/lib/domain/procedure-execution-summary-placement";
import { computeExecutionPosition } from "@/lib/domain/procedure-execution-order";
import { pickCurrentTaskNode } from "@/lib/domain/procedure-execution-focus";
import { buildProcedureExecutionMinimap } from "@/lib/domain/procedure-execution-minimap";
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
function makeExecutionTestTemplate(code: string, category: ExtractedTemplate["category"] = "FULL_SERVICE"): ExtractedTemplate {
  const sheet = "(TEST) 실행 테스트 시트";
  return {
    code,
    name: `실행 테스트 ${code}`,
    equipmentType: "RFG",
    description: "Phase 5A execution mutation integration test fixture",
    sourceWorksheets: [sheet],
    category,
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

/**
 * 노드·간선은 위 판과 **글자 하나 다르지 않고**, 적힌 차례만 뒤섞은 것.
 *
 * 들여오기는 이 배열 차례대로 insert 하므로, 이 판으로 만들면 「DB 에 들어간
 * 차례」와 「절차의 차례(sort_order)」가 서로 어긋난다. getExecutionDetail 이
 * 정말로 정렬하는지 재려면 둘이 어긋나 있어야 한다 — 똑같으면 정렬을 통째로
 * 빼도 시험이 통과해 버린다.
 */
const SCRAMBLED_NODE_ORDER = ["n7", "n5", "n3", "n1", "n6", "n4", "n2"] as const;

function makeScrambledExecutionTestTemplate(code: string): ExtractedTemplate {
  const base = makeExecutionTestTemplate(code);
  const byCode = new Map(base.nodes.map((n) => [n.nodeCode, n]));
  return { ...base, nodes: SCRAMBLED_NODE_ORDER.map((nodeCode) => byCode.get(nodeCode)!) };
}

/**
 * 위 판과 같은데 **TASK 노드 n2 에서 나가는 간선이 둘**인 것(n3, n5).
 *
 * 자동 전진은 「판단이 아니면 나가는 간선이 하나뿐일 때만」 세운다. 기본 판은
 * 판단이 아닌 노드가 전부 간선 하나라서, 이 판이 없으면 「여럿이면 안 세운다」를
 * 잴 표본 자체가 없다.
 *
 * 구조 검사에 걸리지 않는다 — 비판단 노드의 간선 개수를 제한하는 규칙은 없고
 * (procedure-graph-structural-validation.ts), 시작/대상/분기 유형이 모두 같은
 * 중복 간선(DUPLICATE_EDGE)도 아니다. 🔴 분기 유형은 CUSTOM 이어야 한다 —
 * YES/NO/NG/NORMAL 은 **판단 노드에서만** 쓸 수 있어서(DECISION_ONLY_BRANCH_
 * TYPES) TASK 에 붙이면 게시가 ERROR 로 거절된다. 실제로 NORMAL 로 적었다가
 * HAS_STRUCTURAL_ERRORS 를 받았다.
 */
function makeFanOutExecutionTestTemplate(code: string): ExtractedTemplate {
  const base = makeExecutionTestTemplate(code);
  return {
    ...base,
    edges: [
      ...base.edges,
      { fromNodeCode: "n2", toNodeCode: "n5", branchType: "CUSTOM", branchLabel: "바로 조치", sortOrder: 7, sourceConnectorId: "c8" },
    ],
  };
}

/**
 * 참고 문서를 **연달아 둘** 놓은 판 — n4 → n6(참고) → n8(참고) → n7(END).
 *
 * 꾸며낸 모양이 아니다. 실측(2026-11-02) rfg-full-lifecycle 에 참고 문서가 바로
 * 이렇게 이어져 있다(s31-50 → s31-56). 하나만으로는 「한 번 건너뛴다」까지만
 * 재고, 사슬을 끝까지 따라가는지는 못 잰다.
 */
function makeReferenceChainExecutionTestTemplate(code: string): ExtractedTemplate {
  const base = makeExecutionTestTemplate(code);
  const sheet = base.sourceWorksheets[0];
  return {
    ...base,
    nodes: [
      ...base.nodes,
      { nodeCode: "n8", nodeType: "DOCUMENT_REFERENCE", title: "두 번째 참조 문서", positionX: 450, positionY: 0, sortOrder: 7, sourceWorksheet: sheet, sourceShapeId: "8" },
    ],
    edges: [
      // c7(n6 → n7)을 걷어내고 그 자리에 참고 문서 하나를 더 끼운다.
      ...base.edges.filter((e) => e.sourceConnectorId !== "c7"),
      { fromNodeCode: "n6", toNodeCode: "n8", branchType: "DEFAULT", branchLabel: null, sortOrder: 6, sourceConnectorId: "c7" },
      { fromNodeCode: "n8", toNodeCode: "n7", branchType: "DEFAULT", branchLabel: null, sortOrder: 7, sourceConnectorId: "c8" },
    ],
  };
}

/**
 * 참고 문서에서 **나가는 선이 둘**인 판 — 실측 s31-50 이 이 모양이다(END 로도
 * 가고 다음 참고 문서로도 간다). 건너뛴 끝에서 갈래가 벌어지면 세우면 안 된다.
 *
 * 🔴 분기 유형은 CUSTOM 이어야 한다 — YES/NO/NG/NORMAL 은 판단 노드에서만 쓸 수
 * 있어 게시가 ERROR 로 거절된다(makeFanOutExecutionTestTemplate 과 같은 사정).
 */
function makeReferenceFanOutExecutionTestTemplate(code: string): ExtractedTemplate {
  const base = makeExecutionTestTemplate(code);
  return {
    ...base,
    edges: [
      ...base.edges,
      { fromNodeCode: "n6", toNodeCode: "n5", branchType: "CUSTOM", branchLabel: "실물 서류 확인", sortOrder: 7, sourceConnectorId: "c8" },
    ],
  };
}

/**
 * 참고 문서 둘이 **서로를 가리키는** 판 — n6 ↔ n8. 본 것을 기억하지 않으면
 * 건너뛰기가 영영 안 끝난다(실패가 아니라 **시험이 안 끝나는 것**으로 나타난다).
 *
 * END(n7)에는 n5 에서 따로 선을 이어 준다 — 들어오는 선이 하나도 없는 END 는
 * 구조 검사에서 ERROR 라 게시가 안 된다.
 */
function makeReferenceLoopExecutionTestTemplate(code: string): ExtractedTemplate {
  const base = makeExecutionTestTemplate(code);
  const sheet = base.sourceWorksheets[0];
  return {
    ...base,
    nodes: [
      ...base.nodes,
      { nodeCode: "n8", nodeType: "DOCUMENT_REFERENCE", title: "되돌아가는 참조 문서", positionX: 450, positionY: 100, sortOrder: 7, sourceWorksheet: sheet, sourceShapeId: "8" },
    ],
    edges: [
      ...base.edges.filter((e) => e.sourceConnectorId !== "c7"),
      { fromNodeCode: "n6", toNodeCode: "n8", branchType: "DEFAULT", branchLabel: null, sortOrder: 6, sourceConnectorId: "c7" },
      { fromNodeCode: "n8", toNodeCode: "n6", branchType: "DEFAULT", branchLabel: null, sortOrder: 7, sourceConnectorId: "c8" },
      { fromNodeCode: "n5", toNodeCode: "n7", branchType: "CUSTOM", branchLabel: "조치 후 종료", sortOrder: 8, sourceConnectorId: "c9" },
    ],
  };
}

/** Phase 5C-5A — minimal REFERENCE-category fixture (no nodes/edges, isReferenceOnly=true), matching the shape the real importer's buildReferenceOnlyTemplate produces for main-page-index/qc-common-operations. */
function makeReferenceTestTemplate(code: string): ExtractedTemplate {
  return {
    code,
    name: `참조 자료 테스트 ${code}`,
    equipmentType: "COMMON",
    description: "Phase 5C-5A REFERENCE-category execution-rejection fixture",
    sourceWorksheets: ["(TEST) 참조 시트"],
    category: "REFERENCE",
    isReferenceOnly: true,
    referenceItems: [],
    nodes: [],
    edges: [],
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

async function createPublishedTemplate(
  code: string,
  category: ExtractedTemplate["category"] = "FULL_SERVICE",
  /** 기본 판 대신 쓸 판. 차례를 뒤섞은 판을 넣을 때만 쓴다. */
  template?: ExtractedTemplate
) {
  const draftResult = await createDraftProcedureTemplateFromImport(template ?? makeExecutionTestTemplate(code, category), superAdminId, {
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

async function createTestCase(overrides: Partial<ValidatedCreateRepairCaseInput> = {}) {
  const result = await createRepairCase(baseCreateInput(overrides));
  assert.equal(result.ok, true, `setup create failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

async function lockCase(repairCaseId: string) {
  await db.update(repairCases).set({ isLocked: true }).where(eq(repairCases.id, repairCaseId));
}

/** 실행 노드 전체를 id 차례로 늘어놓은 스냅샷 — 「아무것도 안 바뀌었다」를 재는 데 쓴다. */
async function snapshotExecutionNodes(executionId: string) {
  const rows = await db
    .select({
      id: procedureCaseExecutionNodes.id,
      status: procedureCaseExecutionNodes.status,
      version: procedureCaseExecutionNodes.version,
      startedBy: procedureCaseExecutionNodes.startedBy,
      assignedEngineerId: procedureCaseExecutionNodes.assignedEngineerId,
    })
    .from(procedureCaseExecutionNodes)
    .where(eq(procedureCaseExecutionNodes.executionId, executionId));
  return rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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

describe("procedure-case-execution: shipment-lock removal policy (locked case no longer blocks)", () => {
  test("19a. start/complete/skip/block on a locked (shipped) case all succeed for SUPER_ADMIN", async () => {
    // Each mutation gets its own fresh execution + node so a prior
    // mutation's status change never invalidates the next check's version
    // or produces an unrelated invalid-transition error.
    async function freshLockedNode(labelSuffix: string) {
      const { templateId } = await createPublishedTemplate(uniqueCode(`locked-case-${labelSuffix}`));
      const created = await createTestCase({ assignedEngineerId: engineerId });
      const started = await startProcedureExecution(created.id, templateId, engineerId);
      assert.equal(started.ok, true);
      if (!started.ok) throw new Error("unreachable");
      const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
      await lockCase(created.id);
      return { executionId: started.executionId, n2: byCode.get("n2")! };
    }

    const start = await freshLockedNode("start");
    const startResult = await startExecutionNode(start.n2.id, superAdminId, start.n2.version);
    assert.equal(startResult.ok, true, JSON.stringify(startResult));

    const complete = await freshLockedNode("complete");
    const completeResult = await completeExecutionNode({ executionNodeId: complete.n2.id, actorUserId: superAdminId, expectedVersion: complete.n2.version });
    assert.equal(completeResult.ok, true, JSON.stringify(completeResult));

    const skip = await freshLockedNode("skip");
    const skipResult = await skipExecutionNode(skip.n2.id, superAdminId, skip.n2.version, "사유");
    assert.equal(skipResult.ok, true, JSON.stringify(skipResult));

    const block = await freshLockedNode("block");
    const blockResult = await blockExecutionNode(block.n2.id, superAdminId, block.n2.version, "사유");
    assert.equal(blockResult.ok, true, JSON.stringify(blockResult));
  });

  test("19b. adding an extra task, updating a memo, and starting a new execution all succeed on a locked (shipped) case", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("locked-case-misc"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n2 = byCode.get("n2")!;

    await lockCase(created.id);

    const extraTaskResult = await addExecutionExtraTask(started.executionId, superAdminId, "추가 작업", null);
    assert.equal(extraTaskResult.ok, true, JSON.stringify(extraTaskResult));

    const memoResult = await updateExecutionNodeMemo(n2.id, superAdminId, n2.version, "메모");
    assert.equal(memoResult.ok, true, JSON.stringify(memoResult));
  });

  test("20. reopen also succeeds on a locked (shipped) case", async () => {
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
    assert.equal(reopenResult.ok, true, JSON.stringify(reopenResult));
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
    const n3 = byCode.get("n3")!;
    await completeExecutionNode({ executionNodeId: n2.id, actorUserId: engineerId, expectedVersion: n2.version });

    const history = await getExecutionHistory(started.executionId);
    assert.ok(history.length >= 3);
    // n2 를 완료하면 간선이 하나뿐인 다음 노드(n3)가 저절로 선다. 그래서 가장
    // 최근 줄은 **자동으로 선 NODE_STARTED** 이고 그 바로 아래가 원인인
    // NODE_COMPLETED 다.
    //
    // 🔴 이 두 줄은 **같은 트랜잭션**에서 쓰였다. Postgres 의 now() 는
    // 트랜잭션 시작 시각이라 그냥 두면 created_at 이 똑같아져 차례가 정해지지
    // 않는다(새로고침마다 원인과 결과가 자리를 바꾼다). 뒤따르는 줄에 1밀리초를
    // 더해 못 박은 것을 여기서 잰다 — insertHistory 의 createdAt 주석.
    assert.deepEqual(
      history.slice(0, 2).map((h) => h.actionType),
      ["NODE_STARTED", "NODE_COMPLETED"],
      "원인(완료) 위에 결과(자동 시작)가 와야 한다 — 차례가 흔들리면 안 된다"
    );
    assert.equal(history[0].executionNodeId, n3.id, "자동으로 선 줄은 다음 노드의 것이다");
    assert.equal(history[1].executionNodeId, n2.id);
    assert.ok(new Date(history[0].createdAt).getTime() > new Date(history[1].createdAt).getTime());
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

  test("26. getExecutionDetail 은 절차의 차례(sort_order)로 늘어놓고 1부터 번호를 매긴다 — DB 가 주는 차례가 아니다", async () => {
    const code = uniqueCode("query-order");
    // 표본 확인 — 판이 실제로 뒤섞여 있어야 이 시험이 무언가를 잰다.
    assert.notDeepEqual(
      [...SCRAMBLED_NODE_ORDER],
      ["n1", "n2", "n3", "n4", "n5", "n6", "n7"],
      "뒤섞은 판이 실은 차례대로라면 정렬을 통째로 빼도 통과한다"
    );

    const { templateId } = await createPublishedTemplate(code, "FULL_SERVICE", makeScrambledExecutionTestTemplate(code));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const detail = await getExecutionDetail(started.executionId);
    assert.ok(detail);

    // START(n1)와 DOCUMENT_REFERENCE(n6)는 사람이 할 일이 아니라 이미 빠져 있다.
    assert.deepEqual(
      detail!.nodes.map((n) => n.nodeCode),
      ["n2", "n3", "n4", "n5", "n7"],
      "절차를 적은 차례(sort_order 1·2·3·4·6)대로 나와야 한다"
    );
    assert.deepEqual(
      detail!.nodes.map((n) => n.orderIndex),
      [1, 2, 3, 4, 5],
      "번호는 사람이 할 일만 세어 1부터 빈틈없이"
    );
    assert.equal(
      detail!.nodes.length,
      new Set(detail!.nodes.map((n) => n.orderIndex)).size,
      "같은 번호가 두 장에 찍히면 안 된다"
    );

    // 참고 문서 목록도 같은 차례를 쓴다(전에는 DB 가 주는 대로였다).
    assert.deepEqual(detail!.referenceNodes.map((r) => r.nodeCode), ["n6"]);

    // 「몇 번째 / 전체」가 쓰는 셈과 같은 자인지 — 아직 아무것도 안 끝났으니 1번째.
    const position = computeExecutionPosition(detail!.nodes);
    assert.deepEqual(position, { total: 5, finished: 0, current: 1 });

    // 하나 끝내면 번호는 그대로고 자리만 둘째로 간다.
    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n2 = byCode.get("n2")!;
    const completed = await completeExecutionNode({ executionNodeId: n2.id, actorUserId: engineerId, expectedVersion: n2.version });
    assert.equal(completed.ok, true, JSON.stringify(completed));

    const afterOne = await getExecutionDetail(started.executionId);
    assert.deepEqual(
      afterOne!.nodes.map((n) => n.nodeCode),
      ["n2", "n3", "n4", "n5", "n7"],
      "완료했다고 카드 차례가 바뀌면 안 된다 — 차례는 절차가 정한다"
    );
    assert.deepEqual(computeExecutionPosition(afterOne!.nodes), { total: 5, finished: 1, current: 2 });
  });

  test("27. getExecutionDetail 은 템플릿 간선을 그대로 싣고, 그것으로 지금 자리 둘레의 작은 흐름 그림이 선다", async () => {
    const code = uniqueCode("query-edges");
    const { templateId } = await createPublishedTemplate(code);
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const detail = await getExecutionDetail(started.executionId);
    assert.ok(detail);

    // 🔵 표본 확인 — 간선이 실제로 실려 와야 아래 판정이 무언가를 잰다. 판은
    // n1(START)→n2 →n3 →{n4(YES) | n5(NG)} 이고 n5 →n3 으로 **되돌아간다**.
    assert.equal(detail!.flowEdges.length, 7, "템플릿 간선 일곱 줄이 그대로 와야 한다");
    assert.deepEqual(
      detail!.flowEdges.map((e) => `${e.branchType}${e.branchLabel ? `/${e.branchLabel}` : ""}`),
      ["DEFAULT", "DEFAULT", "YES/YES", "NG/NG", "RETRY/재측정", "DEFAULT", "DEFAULT"],
      "갈래 차례는 sort_order 그대로 — 바로 아래 갈래 단추와 같은 차례여야 한다"
    );

    const current = pickCurrentTaskNode(detail!.nodes, { isExecutionFinished: false });
    assert.equal(current?.nodeCode, "n2", "아직 아무것도 안 했으니 절차 차례상 첫 일이 지금 할 일이다");

    const minimap = buildProcedureExecutionMinimap({ nodes: detail!.nodes, edges: detail!.flowEdges, current });
    assert.equal(minimap.kind, "GRAPH");
    if (minimap.kind !== "GRAPH") return;
    // 🔴 START 에서 들어오는 선은 칸이 되지 않는다 — START 는 사람이 할 일
    // 목록에서 이미 빠졌다(위 26번). 지난 쪽이 비는 것이 맞다.
    assert.deepEqual(minimap.backward, []);
    assert.deepEqual(
      minimap.forward.map((level) => level.steps.map((s) => s.node.nodeCode)),
      [["n3"], ["n4", "n5"]],
      "한 걸음 뒤가 판단이고, 그 다음에 갈래 둘이 나란히 선다"
    );

    // 🔴 END(n7)로 들어오는 선은 참고 문서(n6)를 거친다 — 양끝이 다 칸이 되는
    // 선이 아니므로 그릴 것이 없고, 빈 그림 대신 한 줄로 떨어져야 한다.
    const endNode = detail!.nodes.find((n) => n.nodeCode === "n7");
    assert.ok(endNode);
    assert.deepEqual(buildProcedureExecutionMinimap({ nodes: detail!.nodes, edges: detail!.flowEdges, current: endNode! }), {
      kind: "NOTE",
      reason: "CURRENT_HAS_NO_LINKED_STEP",
    });
  });
});

describe("procedure-case-execution: 완료하면 다음 하나가 저절로 선다 (자동 전진)", () => {
  /** 완료 → 그 자리에서 쓰인 이력 줄들(완료한 노드 것 + 자동으로 선 노드 것). */
  async function historyFor(executionNodeId: string, actionType: "NODE_STARTED" | "NODE_COMPLETED") {
    return db
      .select()
      .from(procedureCaseExecutionHistory)
      .where(
        and(
          eq(procedureCaseExecutionHistory.executionNodeId, executionNodeId),
          eq(procedureCaseExecutionHistory.actionType, actionType)
        )
      );
  }

  test("30. 나가는 간선이 하나면 그 노드가 진행 중이 되고, 자동으로 섰다는 것이 이력에 남는다", async () => {
    const { templateId, edges } = await createPublishedTemplate(uniqueCode("advance-single"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n2 = byCode.get("n2")!;
    const n3 = byCode.get("n3")!;
    // 🔵 표본 확인 — 바뀌기 전에 정말 대기였어야 이 시험이 무언가를 잰다.
    assert.equal(n3.status, "PENDING");

    const result = await completeExecutionNode({ executionNodeId: n2.id, actorUserId: engineerId, expectedVersion: n2.version });
    assert.equal(result.ok, true, JSON.stringify(result));

    const [after] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, n3.id));
    assert.equal(after.status, "IN_PROGRESS", "완료했는데 다음 것이 그대로 대기면 사람이 또 찾아야 한다");
    assert.equal(after.version, n3.version + 1);
    assert.ok(after.startedAt, "시작 시각이 비어 있으면 화면이 「시작: -」을 그린다");

    // 🔴 담당을 가로채지 않는다 — 사람이 직접 [시작]을 눌렀을 때만 self-claim 한다.
    assert.equal(after.assignedEngineerId, null, "자동으로 선 노드의 담당은 비워 둔다(접수 건의 담당이 쓰인다)");

    // 🔴 새 action 값을 만들지 않았다. 이 행에 일어난 일은 「대기 → 진행 중」이고
    // 그것이 NODE_STARTED 의 뜻 그대로다.
    const autoRows = await historyFor(n3.id, "NODE_STARTED");
    assert.equal(autoRows.length, 1);
    const n2ToN3 = edges.find((e) => e.sourceConnectorId === "c2")!;
    assert.deepEqual(autoRows[0].afterState, {
      autoAdvanced: true,
      fromExecutionNodeId: n2.id,
      viaEdgeId: n2ToN3.id,
    });
  });

  test("31. 🔴 판단은 **고른 갈래**가 가리키는 노드만 세운다 — 고르지 않은 갈래는 대기 그대로", async () => {
    for (const branchType of ["YES", "NG"] as const) {
      const { templateId, edges } = await createPublishedTemplate(uniqueCode(`advance-decision-${branchType}`));
      const created = await createTestCase({ assignedEngineerId: engineerId });
      const started = await startProcedureExecution(created.id, templateId, engineerId);
      assert.equal(started.ok, true);
      if (!started.ok) return;

      const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
      const n3 = byCode.get("n3")!;
      const n4 = byCode.get("n4")!;
      const n5 = byCode.get("n5")!;
      const chosen = edges.find((e) => e.branchType === branchType)!;
      // YES 는 n4, NG 는 n5 로 간다 — 고른 쪽에 따라 답이 **갈려야** 한다.
      const expectedStarted = branchType === "YES" ? n4 : n5;
      const expectedUntouched = branchType === "YES" ? n5 : n4;

      const result = await completeExecutionNode({
        executionNodeId: n3.id,
        actorUserId: engineerId,
        expectedVersion: n3.version,
        selectedOutgoingEdgeId: chosen.id,
      });
      assert.equal(result.ok, true, JSON.stringify(result));

      const [startedNode] = await db
        .select()
        .from(procedureCaseExecutionNodes)
        .where(eq(procedureCaseExecutionNodes.id, expectedStarted.id));
      assert.equal(startedNode.status, "IN_PROGRESS", `${branchType} 를 골랐으면 그쪽이 서야 한다`);

      const [untouched] = await db
        .select()
        .from(procedureCaseExecutionNodes)
        .where(eq(procedureCaseExecutionNodes.id, expectedUntouched.id));
      assert.equal(untouched.status, "PENDING", `${branchType} 를 골랐는데 다른 갈래까지 서면 안 된다`);
      assert.equal(untouched.version, expectedUntouched.version);
    }
  });

  test("32. 🔴 판단이 아닌데 나가는 간선이 여럿이면 아무것도 안 세운다 — 어느 쪽인지는 사람만 안다", async () => {
    const code = uniqueCode("advance-fanout");
    const { templateId, edges } = await createPublishedTemplate(code, "FULL_SERVICE", makeFanOutExecutionTestTemplate(code));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n2 = byCode.get("n2")!;
    // 🔵 표본 확인 — n2 에서 나가는 간선이 정말 둘이어야 이 시험이 무언가를 잰다.
    const n2TemplateNodeId = n2.procedureTemplateNodeId!;
    assert.equal(edges.filter((e) => e.fromNodeId === n2TemplateNodeId).length, 2);

    const before = await snapshotExecutionNodes(started.executionId);
    const result = await completeExecutionNode({ executionNodeId: n2.id, actorUserId: engineerId, expectedVersion: n2.version });
    assert.equal(result.ok, true, JSON.stringify(result));

    const after = await snapshotExecutionNodes(started.executionId);
    assert.deepEqual(
      after.filter((r) => r.id !== n2.id),
      before.filter((r) => r.id !== n2.id),
      "완료한 노드 말고는 한 행도 바뀌면 안 된다"
    );
  });

  test("33. 🔴 고리가 있는 절차 — 「재측정」으로 돌아가도 이미 완료된 판단을 되살리지 않는다", async () => {
    const { templateId, edges } = await createPublishedTemplate(uniqueCode("advance-loop"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n3 = byCode.get("n3")!;
    const n5 = byCode.get("n5")!;
    // 🔵 표본 확인 — n5 에서 판단 n3 로 돌아가는 간선이 정말 있다.
    const retryEdge = edges.find((e) => e.branchType === "RETRY")!;
    assert.equal(retryEdge.toNodeId, n3.procedureTemplateNodeId, "RETRY 가 판단으로 돌아가지 않으면 고리가 아니다");

    // NG 를 골라 판단을 끝내면 n5(NG 조치)가 선다.
    const ngEdge = edges.find((e) => e.branchType === "NG")!;
    const decided = await completeExecutionNode({
      executionNodeId: n3.id,
      actorUserId: engineerId,
      expectedVersion: n3.version,
      selectedOutgoingEdgeId: ngEdge.id,
    });
    assert.equal(decided.ok, true, JSON.stringify(decided));

    const [n3AfterDecision] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, n3.id));
    assert.equal(n3AfterDecision.status, "COMPLETED");
    const [n5AfterDecision] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, n5.id));
    assert.equal(n5AfterDecision.status, "IN_PROGRESS");

    // 그 n5 를 완료하면 간선 RETRY 가 **이미 완료된** n3 를 가리킨다.
    const loopBack = await completeExecutionNode({
      executionNodeId: n5.id,
      actorUserId: engineerId,
      expectedVersion: n5AfterDecision.version,
    });
    assert.equal(loopBack.ok, true, JSON.stringify(loopBack));

    const [n3AfterLoop] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, n3.id));
    assert.equal(n3AfterLoop.status, "COMPLETED", "끝난 판단이 되살아나면 「지금 할 일」이 뒤로 돌아간다");
    assert.equal(n3AfterLoop.version, n3AfterDecision.version, "버전도 그대로여야 한다 — 건드리지 않았다는 뜻");
    // 되살아났다면 자동 시작 줄이 생겼을 것이다.
    assert.equal((await historyFor(n3.id, "NODE_STARTED")).length, 0);
  });

  test("34. 🔴 남이 진행 중인 것을 끄지 않는다 — 진행 중이 둘이 되는 것은 괜찮다", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("advance-keeps-others"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n2 = byCode.get("n2")!;
    const n3 = byCode.get("n3")!;
    const n4 = byCode.get("n4")!;

    // 다른 사람이 절차 뒤쪽 작업(n4)을 먼저 붙잡고 있다.
    const claimed = await startExecutionNode(n4.id, adminId, n4.version);
    assert.equal(claimed.ok, true, JSON.stringify(claimed));
    const [n4Claimed] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, n4.id));
    assert.equal(n4Claimed.status, "IN_PROGRESS");

    const completed = await completeExecutionNode({ executionNodeId: n2.id, actorUserId: engineerId, expectedVersion: n2.version });
    assert.equal(completed.ok, true, JSON.stringify(completed));

    const [n4After] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, n4.id));
    assert.equal(n4After.status, "IN_PROGRESS", "남이 붙잡은 작업을 꺼 버리면 그 사람 작업이 사라진다");
    assert.equal(n4After.version, n4Claimed.version, "건드리지 않았다 — 버전도 그대로");
    assert.equal(n4After.assignedEngineerId, adminId, "담당도 그대로");

    const [n3After] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, n3.id));
    assert.equal(n3After.status, "IN_PROGRESS", "그래도 다음 것은 선다 — 진행 중이 둘이어도 된다");
  });

  test("35. 🔴 다음 것이 이미 진행 중이면 그 행을 건드리지 않는다(버전도 안 올린다)", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("advance-target-busy"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n2 = byCode.get("n2")!;
    const n3 = byCode.get("n3")!;

    const claimed = await startExecutionNode(n3.id, adminId, n3.version);
    assert.equal(claimed.ok, true, JSON.stringify(claimed));
    const [n3Claimed] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, n3.id));

    const completed = await completeExecutionNode({ executionNodeId: n2.id, actorUserId: engineerId, expectedVersion: n2.version });
    assert.equal(completed.ok, true, JSON.stringify(completed));

    const [n3After] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, n3.id));
    assert.equal(n3After.status, "IN_PROGRESS");
    assert.equal(n3After.version, n3Claimed.version, "이미 서 있는 것을 또 세우면 남의 화면이 CONFLICT 로 막힌다");
    assert.equal(n3After.assignedEngineerId, adminId);
    // 이력도 한 줄뿐 — 사람이 누른 그 한 줄이다(자동 줄이 덧붙지 않는다).
    assert.equal((await historyFor(n3.id, "NODE_STARTED")).length, 1);
  });

  test("36. 다음 것이 차단됨이면 자동으로 풀지 않는다", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("advance-target-blocked"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n2 = byCode.get("n2")!;
    const n3 = byCode.get("n3")!;

    const blocked = await blockExecutionNode(n3.id, engineerId, n3.version, "부품 입고 대기");
    assert.equal(blocked.ok, true, JSON.stringify(blocked));
    const [n3Blocked] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, n3.id));

    const completed = await completeExecutionNode({ executionNodeId: n2.id, actorUserId: engineerId, expectedVersion: n2.version });
    assert.equal(completed.ok, true, JSON.stringify(completed));

    const [n3After] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, n3.id));
    assert.equal(n3After.status, "BLOCKED", "사람이 사유를 적어 막아 둔 것을 자동으로 풀면 막은 뜻이 사라진다");
    assert.equal(n3After.version, n3Blocked.version);
    assert.equal(n3After.lastActionReason, "부품 입고 대기");
  });

  /**
   * 🔴 2026-11-02(조각 5)에 **표본에서 n4 를 뺐다.** 전에는 「다음이 참고 문서면
   * 아무것도 안 선다」가 이 시험의 일부였는데(n4 → n6 참고 문서), 그 멈춤이 바로
   * 이번에 고친 결함이다. 지금 n4 는 참고 문서를 건너뛰어 n7 을 세운다 — 아래
   * 39번이 그것을 잰다.
   *
   * 🔴 n4 를 그냥 두면 이 시험은 **틀린 설계인 채로도 통과한다**: 고리 차례상
   * n7 이 먼저 완료돼 버려서, 건너뛴 끝이 이미 끝난 노드가 되고 결국
   * 「아무 행도 안 바뀐다」가 그대로 성립한다. 단언을 약하게 한 것이 아니라
   * **뜻이 달라진 표본을 덜어낸** 것이다.
   */
  test("37. 갈 곳이 없거나(END) 추가 작업이면 아무 행도 안 바뀐다", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("advance-nowhere"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const extra = await addExecutionExtraTask(started.executionId, engineerId, "이번 건만의 추가 작업", null);
    assert.equal(extra.ok, true, JSON.stringify(extra));
    if (!extra.ok) return;

    // n7 = END(나가는 간선 없음), 추가 작업 = 그래프에 자리가 없다.
    for (const target of [byCode.get("n7")!.id, extra.executionNodeId]) {
      const before = await snapshotExecutionNodes(started.executionId);
      const current = before.find((r) => r.id === target)!;
      const result = await completeExecutionNode({ executionNodeId: target, actorUserId: engineerId, expectedVersion: current.version });
      assert.equal(result.ok, true, JSON.stringify(result));

      const after = await snapshotExecutionNodes(started.executionId);
      assert.deepEqual(
        after.filter((r) => r.id !== target),
        before.filter((r) => r.id !== target),
        "완료한 노드 말고는 한 행도 바뀌면 안 된다"
      );
    }
  });

  test("38. 건너뛰기·차단은 전진시키지 않는다 — 이번 조각이 다루는 것은 **완료**뿐이다", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("advance-skip-only"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n2 = byCode.get("n2")!;
    const n3 = byCode.get("n3")!;

    const skipped = await skipExecutionNode(n2.id, engineerId, n2.version, "이번 제품에는 해당 없음");
    assert.equal(skipped.ok, true, JSON.stringify(skipped));

    const [n3After] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, n3.id));
    assert.equal(n3After.status, "PENDING");
    assert.equal(n3After.version, n3.version);
  });

  test("39. 🔴 다음이 참고 문서면 **건너뛰어 그다음**이 선다 — 거기서 멈추지 않는다", async () => {
    const { templateId, nodes, edges } = await createPublishedTemplate(uniqueCode("advance-skip-reference"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n4 = byCode.get("n4")!;
    const n7 = byCode.get("n7")!;

    // 🔵 표본 확인 — 참고 문서 n6 에는 실행 행이 정말 없고, n4 가 바로 그것을
    // 가리킨다. 둘 중 하나라도 아니면 이 시험은 건너뛰기를 재는 것이 아니다.
    assert.equal(byCode.has("n6"), false, "참고 문서에 실행 행이 생기면 건너뛸 일 자체가 없다");
    const n4ToN6 = edges.find((e) => e.sourceConnectorId === "c6")!;
    assert.equal(n4ToN6.toNodeId, nodes.get("n6")!.id);
    assert.equal(n7.status, "PENDING");

    const result = await completeExecutionNode({ executionNodeId: n4.id, actorUserId: engineerId, expectedVersion: n4.version });
    assert.equal(result.ok, true, JSON.stringify(result));

    const [after] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, n7.id));
    assert.equal(after.status, "IN_PROGRESS", "참고 문서에서 멈추면 게시하는 날 절차가 그 자리에서 끊긴다");
    assert.equal(after.version, n7.version + 1);

    // 🔴 이력의 viaEdgeId 는 **세운 노드로 들어가는** 간선(n6 → n7)이다.
    // 사람이 밟은 첫 간선(n4 → n6)을 적으면 줄이 세운 노드를 안 가리킨다.
    const autoRows = await historyFor(n7.id, "NODE_STARTED");
    assert.equal(autoRows.length, 1);
    const n6ToN7 = edges.find((e) => e.sourceConnectorId === "c7")!;
    assert.deepEqual(autoRows[0].afterState, {
      autoAdvanced: true,
      fromExecutionNodeId: n4.id,
      viaEdgeId: n6ToN7.id,
    });
  });

  test("40. 🔴 참고 문서가 **연달아** 있어도 끝까지 건너뛴다", async () => {
    const code = uniqueCode("advance-reference-chain");
    const { templateId, edges } = await createPublishedTemplate(code, "FULL_SERVICE", makeReferenceChainExecutionTestTemplate(code));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n4 = byCode.get("n4")!;
    const n7 = byCode.get("n7")!;
    // 🔵 표본 확인 — 참고 문서가 정말 둘이고 둘 다 실행 행이 없다.
    assert.equal(byCode.has("n6"), false);
    assert.equal(byCode.has("n8"), false);

    const result = await completeExecutionNode({ executionNodeId: n4.id, actorUserId: engineerId, expectedVersion: n4.version });
    assert.equal(result.ok, true, JSON.stringify(result));

    const [after] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, n7.id));
    assert.equal(after.status, "IN_PROGRESS");
    const autoRows = await historyFor(n7.id, "NODE_STARTED");
    const n8ToN7 = edges.find((e) => e.sourceConnectorId === "c8")!;
    assert.deepEqual(autoRows[0].afterState, { autoAdvanced: true, fromExecutionNodeId: n4.id, viaEdgeId: n8ToN7.id });
  });

  test("41. 🔴 건너뛴 끝에서 갈래가 여럿이면 아무것도 안 세운다", async () => {
    const code = uniqueCode("advance-reference-fanout");
    const { templateId, nodes, edges } = await createPublishedTemplate(code, "FULL_SERVICE", makeReferenceFanOutExecutionTestTemplate(code));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n4 = byCode.get("n4")!;
    // 🔵 표본 확인 — 참고 문서 n6 에서 나가는 간선이 정말 둘이다(실측 s31-50).
    assert.equal(edges.filter((e) => e.fromNodeId === nodes.get("n6")!.id).length, 2);

    const before = await snapshotExecutionNodes(started.executionId);
    const result = await completeExecutionNode({ executionNodeId: n4.id, actorUserId: engineerId, expectedVersion: n4.version });
    assert.equal(result.ok, true, JSON.stringify(result));

    const after = await snapshotExecutionNodes(started.executionId);
    assert.deepEqual(
      after.filter((r) => r.id !== n4.id),
      before.filter((r) => r.id !== n4.id),
      "갈래가 벌어졌는데 한쪽을 고르면 틀린 쪽이 1순위가 된다"
    );
  });

  test("42. 🔴 참고 문서가 고리를 이뤄도 **끝난다** — 돌지 않고 아무것도 안 세운다", async () => {
    // 이 시험이 깨지는 모습은 「실패」가 아니라 **시험이 안 끝나는 것**이다.
    const code = uniqueCode("advance-reference-loop");
    const { templateId } = await createPublishedTemplate(code, "FULL_SERVICE", makeReferenceLoopExecutionTestTemplate(code));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, started.executionId);
    const n4 = byCode.get("n4")!;

    const before = await snapshotExecutionNodes(started.executionId);
    const result = await completeExecutionNode({ executionNodeId: n4.id, actorUserId: engineerId, expectedVersion: n4.version });
    assert.equal(result.ok, true, JSON.stringify(result));

    const after = await snapshotExecutionNodes(started.executionId);
    assert.deepEqual(
      after.filter((r) => r.id !== n4.id),
      before.filter((r) => r.id !== n4.id),
      "고리를 도는 동안 아무 행도 건드리면 안 된다"
    );
  });
});

/**
 * 실행을 **끝내고 그만두는** 길(2026-11-02, 조각 5).
 *
 * 전에는 노드 단추 넷(시작·완료·건너뛰기·차단)뿐이라, 잘못 불러온 절차를 치울
 * 수도 없고 다 해도 끝낼 수도 없었다. 여기서 재는 것은 **DB 에 무엇이 남는가**와
 * **화면이 다시 무엇을 보는가** 둘이다 — 화면 쪽 모양은 components 목록의
 * execution-lifecycle-actions.test.ts 가, 묻는 규칙 자체는 unit 목록의
 * procedure-execution-lifecycle.test.ts 가 따로 본다.
 */
describe("procedure-case-execution: 실행 끝내기 · 그만두기", () => {
  /** 실행 한 건을 세우고, 조회가 보는 모습까지 함께 돌려준다. */
  async function startedExecution() {
    const { templateId } = await createPublishedTemplate(uniqueCode("lifecycle"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const started = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(started.ok, true, JSON.stringify(started));
    if (!started.ok) throw new Error("unreachable");
    return { templateId, repairCaseId: created.id, executionId: started.executionId };
  }

  async function loadExecutionRow(executionId: string) {
    const [row] = await db.select().from(procedureCaseExecutions).where(eq(procedureCaseExecutions.id, executionId));
    return row;
  }

  /** 노드를 남김없이 끝낸다 — 「다 한 실행」 표본을 만드는 가장 짧은 길. */
  async function completeEveryNode(executionId: string) {
    const rows = await db
      .select()
      .from(procedureCaseExecutionNodes)
      .where(eq(procedureCaseExecutionNodes.executionId, executionId));
    for (const row of rows) {
      if (row.status === "COMPLETED" || row.status === "SKIPPED") continue;
      // 판단 노드는 갈래를 골라야 완료된다 — 아무 갈래나 하나 집는다.
      const [fresh] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, row.id));
      const outgoing = row.procedureTemplateNodeId
        ? await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.fromNodeId, row.procedureTemplateNodeId))
        : [];
      const [templateNode] = row.procedureTemplateNodeId
        ? await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, row.procedureTemplateNodeId))
        : [];
      if (templateNode && templateNode.nodeType === "START") continue;
      const result = await completeExecutionNode({
        executionNodeId: row.id,
        actorUserId: engineerId,
        expectedVersion: fresh.version,
        selectedOutgoingEdgeId: templateNode?.nodeType === "DECISION" ? (outgoing[0]?.id ?? null) : null,
      });
      assert.equal(result.ok, true, JSON.stringify(result));
    }
  }

  test("43. 🔴 그만두면 조회가 그 실행을 **못 본다** — 그래서 불러오기 카드가 다시 선다", async () => {
    const { repairCaseId, executionId } = await startedExecution();
    // 🔵 표본 확인 — 그만두기 전에는 조회가 분명히 보고 있다.
    assert.equal((await getActiveExecutionForCase(repairCaseId))?.id, executionId);

    const before = await loadExecutionRow(executionId);
    const result = await abandonProcedureExecution(executionId, engineerId, before.version, "절차를 잘못 골랐습니다");
    assert.equal(result.ok, true, JSON.stringify(result));

    assert.equal(await getActiveExecutionForCase(repairCaseId), null, "그만뒀는데 조회가 보면 화면이 그대로 막혀 있다");

    const after = await loadExecutionRow(executionId);
    assert.equal(after.isDeleted, true);
    assert.ok(after.deletedAt, "언제 치웠는지가 비면 소프트 삭제 네 칸 규약이 반만 채워진다");
    assert.equal(after.deletedBy, engineerId);
    assert.equal(after.deleteReason, "절차를 잘못 골랐습니다", "사유가 없으면 「잘못 불러옴」과 「수리 취소」를 영영 못 가른다");
    assert.equal(after.version, before.version + 1);
  });

  test("44. 🔴 그만둬도 노드와 이력은 **한 줄도 안 지워진다**", async () => {
    const { templateId, executionId } = await startedExecution();
    const byCode = await loadExecutionNodesByCode(templateId, executionId);
    const n2 = byCode.get("n2")!;
    const worked = await completeExecutionNode({ executionNodeId: n2.id, actorUserId: engineerId, expectedVersion: n2.version });
    assert.equal(worked.ok, true, JSON.stringify(worked));

    const nodesBefore = await snapshotExecutionNodes(executionId);
    const historyBefore = await db
      .select()
      .from(procedureCaseExecutionHistory)
      .where(eq(procedureCaseExecutionHistory.executionId, executionId));
    assert.ok(nodesBefore.length > 0 && historyBefore.length > 0, "표본이 비면 「안 지워진다」가 공짜로 통과한다");

    const row = await loadExecutionRow(executionId);
    const result = await abandonProcedureExecution(executionId, engineerId, row.version, "고객이 수리를 취소했습니다");
    assert.equal(result.ok, true, JSON.stringify(result));

    assert.deepEqual(await snapshotExecutionNodes(executionId), nodesBefore, "실제로 한 일이 사라지면 안 된다");
    const historyAfter = await db
      .select()
      .from(procedureCaseExecutionHistory)
      .where(eq(procedureCaseExecutionHistory.executionId, executionId));
    assert.equal(historyAfter.length, historyBefore.length, "이력표는 append-only 다");
  });

  test("45. 그만두기는 사유를 요구하고, 버전이 어긋나면 거절하며, 두 번째는 못 찾는다", async () => {
    const { executionId } = await startedExecution();
    const row = await loadExecutionRow(executionId);

    const blank = await abandonProcedureExecution(executionId, engineerId, row.version, "   ");
    assert.equal(blank.ok, false);
    if (!blank.ok) assert.equal(blank.code, "REASON_REQUIRED");

    const stale = await abandonProcedureExecution(executionId, engineerId, row.version + 5, "버전이 틀린 요청");
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.code, "CONFLICT");

    const first = await abandonProcedureExecution(executionId, engineerId, row.version, "잘못 불러왔습니다");
    assert.equal(first.ok, true, JSON.stringify(first));

    // 🔴 두 번 누르기 — 이미 치운 것은 아예 안 보인다.
    const second = await abandonProcedureExecution(executionId, engineerId, row.version + 1, "또 눌렀습니다");
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "NOT_FOUND");
  });

  test("46. 🔴 그만둔 실행의 노드는 더 못 건드린다 — 화면에서 사라진 것이 저장되면 안 된다", async () => {
    const { templateId, executionId } = await startedExecution();
    const byCode = await loadExecutionNodesByCode(templateId, executionId);
    const n2 = byCode.get("n2")!;

    const row = await loadExecutionRow(executionId);
    const abandoned = await abandonProcedureExecution(executionId, engineerId, row.version, "잘못 불러왔습니다");
    assert.equal(abandoned.ok, true, JSON.stringify(abandoned));

    const late = await startExecutionNode(n2.id, engineerId, n2.version);
    assert.equal(late.ok, false);
    if (!late.ok) assert.equal(late.code, "NOT_FOUND");

    const [unchanged] = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.id, n2.id));
    assert.equal(unchanged.status, "PENDING");
    assert.equal(unchanged.version, n2.version);
  });

  test("47. 🔴 다 끝낸 실행을 끝내면 completed_at 이 찬다 — 조회는 그대로 보여 준다", async () => {
    const { repairCaseId, executionId } = await startedExecution();
    await completeEveryNode(executionId);

    const before = await loadExecutionRow(executionId);
    // 🔵 표본 확인 — 채우기 전에는 정말 비어 있다(5A 내내 한 번도 안 찼다).
    assert.equal(before.completedAt, null);

    const result = await finishProcedureExecution(executionId, engineerId, before.version, false);
    assert.equal(result.ok, true, JSON.stringify(result));

    const after = await loadExecutionRow(executionId);
    assert.ok(after.completedAt, "completed_at 이 안 차면 「마쳤습니다」를 그릴 재료가 없다");
    assert.equal(after.isDeleted, false, "끝내기는 치우는 것이 아니다 — 기록은 그대로 보인다");
    assert.equal(after.version, before.version + 1);

    // 🔴 조회가 계속 보여 줘야 화면이 「절차를 마쳤습니다」와 불러오기 카드를
    // 함께 그릴 수 있다. 여기서 걸러 버리면 다 끝낸 화면이 한 번도 실행한 적
    // 없는 화면과 똑같아진다.
    const active = await getActiveExecutionForCase(repairCaseId);
    assert.equal(active?.id, executionId);
    assert.ok(active?.completedAt, "끝낸 시각이 조회에 안 실리면 화면이 끝난 줄을 모른다");

    const detail = await getExecutionDetail(executionId);
    assert.ok(detail?.completedAt);
    assert.equal(detail?.version, after.version);
  });

  test("48. 🔴 남은 것이 있으면 **확인 없이는 안 끝난다** — 확인을 실으면 끝난다", async () => {
    const { templateId, executionId } = await startedExecution();
    const byCode = await loadExecutionNodesByCode(templateId, executionId);
    const n5 = byCode.get("n5")!;
    const blocked = await blockExecutionNode(n5.id, engineerId, n5.version, "부품 입고 대기");
    assert.equal(blocked.ok, true, JSON.stringify(blocked));

    const before = await loadExecutionRow(executionId);
    const remaining = await db
      .select()
      .from(procedureCaseExecutionNodes)
      .where(eq(procedureCaseExecutionNodes.executionId, executionId));
    const remainingCount = remaining.filter((n) => n.status === "PENDING" || n.status === "IN_PROGRESS" || n.status === "BLOCKED").length;
    // 🔵 표본 확인 — 남은 것이 정말 있어야 「묻는다」를 잰다.
    assert.ok(remainingCount > 0, "남은 것이 없으면 이 시험은 아무것도 안 잰다");

    const asked = await finishProcedureExecution(executionId, engineerId, before.version, false);
    assert.equal(asked.ok, false, "확인 없이 끝나면 물어보는 뜻이 사라진다");
    if (!asked.ok) {
      assert.equal(asked.code, "UNFINISHED_NODES_REMAIN");
      assert.match(asked.message, new RegExp(`${remainingCount}개`), "몇 개 남았는지가 글자에 있어야 사람이 판단한다");
      assert.match(asked.message, /차단됨 1개/);
    }
    assert.equal((await loadExecutionRow(executionId)).completedAt, null, "거절했는데 칸이 차면 안 된다");
    assert.equal((await loadExecutionRow(executionId)).version, before.version, "거절은 버전도 안 올린다");

    const confirmed = await finishProcedureExecution(executionId, engineerId, before.version, true);
    assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
    assert.ok((await loadExecutionRow(executionId)).completedAt);

    // 🔴 남은 노드를 **건드리지 않는다** — 안 한 일을 「했다」로 적으면 지나온
    // 길이 거짓이 된다.
    const afterNodes = await db
      .select()
      .from(procedureCaseExecutionNodes)
      .where(eq(procedureCaseExecutionNodes.executionId, executionId));
    assert.equal(
      afterNodes.filter((n) => n.status === "PENDING" || n.status === "IN_PROGRESS" || n.status === "BLOCKED").length,
      remainingCount
    );
    const [blockedAfter] = afterNodes.filter((n) => n.id === n5.id);
    assert.equal(blockedAfter.status, "BLOCKED");
    assert.equal(blockedAfter.lastActionReason, "부품 입고 대기");
  });

  test("49. 이미 끝낸 것을 또 끝내려 하면 거절하고, 끝낸 뒤에도 그만둘 수는 있다", async () => {
    const { repairCaseId, executionId } = await startedExecution();
    const first = await loadExecutionRow(executionId);
    const finished = await finishProcedureExecution(executionId, engineerId, first.version, true);
    assert.equal(finished.ok, true, JSON.stringify(finished));

    const again = await finishProcedureExecution(executionId, engineerId, first.version + 1, true);
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.code, "ALREADY_FINISHED");

    // 잘못 끝냈을 때 되돌릴 길은 그만두기뿐이다(「다시 열기」는 없다) — 막으면
    // 끝낸 사람이 또 갇힌다.
    const row = await loadExecutionRow(executionId);
    const abandoned = await abandonProcedureExecution(executionId, engineerId, row.version, "끝내기를 잘못 눌렀습니다");
    assert.equal(abandoned.ok, true, JSON.stringify(abandoned));
    assert.equal(await getActiveExecutionForCase(repairCaseId), null);
  });

  test("50. 🔴 끝낸 뒤 **다른 절차를 불러오면** 화면이 새로 불러온 쪽을 본다", async () => {
    // TECHNICAL_TASK 는 한 건에 여럿이 나란히 있어도 된다(유니크 색인은
    // FULL_SERVICE 에만 걸린다). 끝낸 실행에서도 불러오기 카드가 다시 서므로
    // 「끝낸 것 + 새로 불러온 것」 둘이 함께 남는 자리가 이번에 처음 생겼다 —
    // 차례를 안 정하면 아까 끝낸 절차가 다시 뜨는 화면이 된다.
    const { repairCaseId, executionId } = await startedExecution();
    const first = await loadExecutionRow(executionId);
    const finished = await finishProcedureExecution(executionId, engineerId, first.version, true);
    assert.equal(finished.ok, true, JSON.stringify(finished));

    const { templateId: secondTemplateId } = await createPublishedTemplate(uniqueCode("lifecycle-second"), "TECHNICAL_TASK");
    const restarted = await startProcedureExecution(repairCaseId, secondTemplateId, engineerId);
    assert.equal(restarted.ok, true, JSON.stringify(restarted));
    if (!restarted.ok) return;

    // 🔵 표본 확인 — 안 치운 실행이 정말 둘이다(하나면 차례가 뜻이 없다).
    const live = await db
      .select({ id: procedureCaseExecutions.id })
      .from(procedureCaseExecutions)
      .where(and(eq(procedureCaseExecutions.repairCaseId, repairCaseId), eq(procedureCaseExecutions.isDeleted, false)));
    assert.equal(live.length, 2);

    const active = await getActiveExecutionForCase(repairCaseId);
    assert.equal(active?.id, restarted.executionId, "새로 불러왔는데 끝낸 절차가 뜨면 「왜 안 바뀌지」가 된다");
    assert.equal(active?.completedAt, null);
  });

  test("51. 담당이 아닌 엔지니어는 끝내지도 그만두지도 못한다", async () => {
    const { executionId } = await startedExecution();
    const row = await loadExecutionRow(executionId);

    const finish = await finishProcedureExecution(executionId, engineer2Id, row.version, true);
    assert.equal(finish.ok, false);
    if (!finish.ok) assert.equal(finish.code, "FORBIDDEN");

    const abandon = await abandonProcedureExecution(executionId, engineer2Id, row.version, "남의 건을 치우려 했다");
    assert.equal(abandon.ok, false);
    if (!abandon.ok) assert.equal(abandon.code, "FORBIDDEN");

    // 🔵 표본 확인 — 같은 요청이 담당 엔지니어에게는 통한다(막히는 쪽만 재면
    // 「누구에게나 막힌다」도 통과한다).
    const allowed = await finishProcedureExecution(executionId, engineerId, row.version, true);
    assert.equal(allowed.ok, true, JSON.stringify(allowed));
  });
});

/**
 * 「이 건의 다른 절차」 목록(2026-11-02, 조각 6) — 큰 카드에 못 선 실행들을
 * 배지와 진행도로 적는 재료가 제대로 나오는가.
 *
 * 🔴 여기서만 잴 수 있는 것이 셋이다. ① **그만둔 실행이 다시 보이는데 「도는
 * 것」으로는 안 돌아온다**(두 조회가 같은 표를 서로 다른 눈으로 본다) ②
 * **진행도의 분모에 START 가 안 끼는가** — START 는 실행 행이 실제로 생기므로
 * 순수 함수 시험으로는 영영 안 걸린다 ③ **안 끝난 실행이 둘일 때 한 쪽이
 * 「진행 중」 줄로 뜨는가** — 기술 작업 절차를 둘 불러와야 생기는 자리라
 * 여기서만 만들 수 있다.
 *
 * 배지를 무엇으로 가르는지는 unit 목록의 procedure-execution-past-runs.test.ts 가
 * 잰다.
 */
describe("procedure-case-execution: 이 건의 다른 절차 목록", () => {
  async function startedExecution(category: ExtractedTemplate["category"] = "FULL_SERVICE", repairCaseId?: string) {
    const { templateId } = await createPublishedTemplate(uniqueCode("past-runs"), category);
    const caseId = repairCaseId ?? (await createTestCase({ assignedEngineerId: engineerId })).id;
    const started = await startProcedureExecution(caseId, templateId, engineerId);
    assert.equal(started.ok, true, JSON.stringify(started));
    if (!started.ok) throw new Error("unreachable");
    return { templateId, repairCaseId: caseId, executionId: started.executionId };
  }

  async function executionVersion(executionId: string) {
    const [row] = await db
      .select({ version: procedureCaseExecutions.version })
      .from(procedureCaseExecutions)
      .where(eq(procedureCaseExecutions.id, executionId));
    return row.version;
  }

  /**
   * 노드를 남김없이 건너뛴다 — 「남은 것이 0 인 실행」을 만드는 가장 짧은 길.
   * 건너뜀도 **끝난 것**으로 세므로(assessExecutionFinish) 완주 조건을 채운다.
   * START 는 서버가 거절하므로 건드리지 않는다.
   */
  async function skipEveryNode(executionId: string) {
    const detail = await getExecutionDetail(executionId);
    assert.ok(detail, "상세를 못 읽으면 아래가 전부 뜻을 잃는다");
    for (const node of detail.nodes) {
      const result = await skipExecutionNode(node.id, engineerId, node.version, "이 건에는 해당 없음");
      assert.equal(result.ok, true, JSON.stringify(result));
    }
  }

  /** 화면이 그리는 그대로 — 조회가 실어 온 재료를 도메인에 그대로 넘긴다. */
  async function panelFor(repairCaseId: string, excludeExecutionId: string | null) {
    return buildPastExecutionPanel(await getOtherExecutionsForCase(repairCaseId, excludeExecutionId));
  }

  test("52. 🔴 그만둔 실행이 아래 줄에 뜬다 — 그래도 **도는 것으로는 안 돌아온다**", async () => {
    const { repairCaseId, executionId } = await startedExecution();
    // 🔵 표본 확인 — 그 실행 하나뿐이고 그것이 큰 카드에 서 있으니, 아래 묶음은
    // 아직 한 줄도 없다(묶음 자체가 안 선다).
    assert.equal(await panelFor(repairCaseId, executionId), null);

    const abandoned = await abandonProcedureExecution(
      executionId,
      engineerId,
      await executionVersion(executionId),
      "절차를 잘못 골랐습니다"
    );
    assert.equal(abandoned.ok, true, JSON.stringify(abandoned));

    // 🔴 기존 조회의 거르기는 그대로다. 여기가 풀리면 그만둔 실행이 큰 카드로
    // 되살아나고 「+ 기술 절차 불러오기」가 다시 안 선다 — 그만두기가 통째로
    // 무력해진다.
    assert.equal(await getActiveExecutionForCase(repairCaseId), null);

    const panel = await panelFor(repairCaseId, null);
    assert.ok(panel, "그만둔 실행이 아래 줄에도 안 뜨면 화면 어디에서도 못 본다");
    assert.equal(panel.rows.length, 1);
    assert.equal(panel.rows[0].executionId, executionId);
    assert.equal(panel.rows[0].badge.label, "그만둠");
    assert.equal(panel.rows[0].abandonReason, "절차를 잘못 골랐습니다");
    assert.match(panel.rows[0].whenNote, /님이 그만둠$/, "누가 치웠는지가 조회에 실려야 한다");
    assert.match(panel.rows[0].startedNote ?? "", /님이 시작$/);
  });

  test("53. 🔴 진행도의 분모는 **사람이 할 일 수**다 — START 가 안 낀다", async () => {
    const { repairCaseId, executionId } = await startedExecution();
    await skipEveryNode(executionId);

    const finished = await finishProcedureExecution(executionId, engineerId, await executionVersion(executionId), false);
    assert.equal(finished.ok, true, JSON.stringify(finished));

    // 🔵 표본 확인 — 실행 행은 6개인데(START 포함) 사람이 할 일은 5개다. 둘이
    // 같으면 이 시험이 아무것도 안 잰다.
    const rows = await db
      .select({ id: procedureCaseExecutionNodes.id })
      .from(procedureCaseExecutionNodes)
      .where(eq(procedureCaseExecutionNodes.executionId, executionId));
    const detail = await getExecutionDetail(executionId);
    assert.equal(rows.length, 6);
    assert.equal(detail?.nodes.length, 5);

    const panel = await panelFor(repairCaseId, null);
    assert.ok(panel);
    assert.equal(panel.rows[0].totalCount, 5, "분모가 6 이면 아래 줄만 큰 카드와 다른 수를 적는다");
    assert.equal(panel.rows[0].progressLabel, "진행 5 / 5");
    assert.equal(panel.rows[0].badge.label, "완주", "남은 것이 0 인데 완주가 아니면 잣대가 어긋난 것이다");
  });

  /**
   * 화면이 **실제로 하는 그대로** — 자리와 빼기를 도메인 함수 하나가 정하고
   * (placeExecutionSummary), 페이지는 그 답으로 조회한다(2026-11-02, 조각 8).
   */
  async function panelForScreen(repairCaseId: string) {
    const active = await getActiveExecutionForCase(repairCaseId);
    const placement = placeExecutionSummary(
      active ? { executionId: active.id, isExecutionFinished: active.completedAt !== null } : null
    );
    return { active, placement, panel: await panelFor(repairCaseId, placement.excludedFromOtherRuns) };
  }

  test("54. 🔴 마친 실행은 **위에 안 서고** 아래 줄에 딱 한 번 뜬다", async () => {
    const { repairCaseId, executionId } = await startedExecution();

    // 🔵 먼저 — 아직 도는 동안에는 상자가 위에 서고, 그때는 아래 줄에서 **뺀다.**
    const whileRunning = await panelForScreen(repairCaseId);
    assert.equal(whileRunning.active?.id, executionId);
    assert.equal(whileRunning.placement.slot, "TOP");
    assert.equal(whileRunning.panel, null, "위에 선 실행이 아래 줄에도 뜨면 같은 것이 두 번이다");

    const finished = await finishProcedureExecution(executionId, engineerId, await executionVersion(executionId), true);
    assert.equal(finished.ok, true, JSON.stringify(finished));

    // 끝낸 실행도 조회는 여전히 돌려준다(걸러내지 않는다) — 화면이 그 상세로
    // 「실행 이력」과 지나온 카드를 그려야 하기 때문이다. 바뀐 것은 **자리**다.
    const afterFinish = await panelForScreen(repairCaseId);
    assert.equal(afterFinish.active?.id, executionId);
    assert.equal(afterFinish.placement.slot, "OTHER_RUNS", "마쳤는데도 위에 서면 사용자 결정과 어긋난다");
    assert.equal(afterFinish.placement.excludedFromOtherRuns, null);
    assert.equal(afterFinish.panel?.rows.length, 1, "마친 실행이 아래 줄에도 없으면 화면 어디에도 안 뜬다");
    assert.equal(afterFinish.panel?.rows[0].executionId, executionId);
    assert.equal(afterFinish.panel?.rows[0].badge.label, "중단 마침");

    // 🔵 반대쪽도 세어 본다 — 옛 규칙(「언제나 뺀다」)이었다면 여기가 null 이다.
    // 「두 번 뜬다」만 막고 「아예 안 뜬다」를 안 재면 고장 하나가 그대로 남는다.
    assert.equal(await panelFor(repairCaseId, executionId), null);
  });

  test("55. 🔴 안 끝난 실행이 **둘**이면 하나는 큰 카드, 하나는 **「진행 중」 줄**이다", async () => {
    // TECHNICAL_TASK 는 한 건에 여럿이 나란히 있어도 된다(유니크 색인은
    // FULL_SERVICE 에만 걸린다) — 안 끝난 실행이 둘인 자리가 실제로 만들어진다.
    // 🔴 사람 눈에는 「불러왔는데 사라졌다」로 보이던 자리다. 큰 카드는 하나뿐인데,
    // 처음 판은 끝난 것만 담아서 둘째가 **화면 어디에도** 안 떴다.
    const first = await startedExecution("TECHNICAL_TASK");
    const second = await startedExecution("TECHNICAL_TASK", first.repairCaseId);
    const active = await getActiveExecutionForCase(first.repairCaseId);
    assert.equal(active?.id, second.executionId, "나중에 시작한 것이 큰 카드에 선다");

    const panel = await panelFor(first.repairCaseId, active?.id ?? null);
    assert.ok(panel, "큰 카드에 못 선 실행이 아래 줄에도 없으면 화면에서 통째로 사라진다");
    // 🔴 같은 것이 두 번 뜨지 않는다 — 큰 카드에 선 둘째는 빠져 있다.
    assert.deepEqual(
      panel.rows.map((r) => [r.executionId, r.badge.label]),
      [[first.executionId, "진행 중"]]
    );
    assert.equal(panel.rows[0].progressLabel, "진행 0 / 5");
    // 🔵 2026-11-02(조각 8 보완)에 딱지가 **갈래별 수 전부**로 바뀌었다 — 사용자
    //    결정 「완주 몇 중단 마침 몇, 그만둠 몇을 적어줘」. 「진행 중」은 여전히
    //    맨 앞이라 눈에 먼저 들어온다.
    assert.deepEqual(panel.fold.note, { text: "진행 중 1", tone: "MUTED" }, "접어 둔 채로도 알려야 한다");
    assert.match(panel.rows[0].whenNote, /님이 시작$/, "끝난 때가 없으니 시작한 때를 적는다");

    // 그 실행을 마치면 같은 줄이 배지만 바꿔 단다.
    const finished = await finishProcedureExecution(first.executionId, engineerId, await executionVersion(first.executionId), true);
    assert.equal(finished.ok, true, JSON.stringify(finished));
    const after = await panelFor(first.repairCaseId, active?.id ?? null);
    assert.equal(after?.rows.length, 1);
    assert.equal(after?.rows[0].executionId, first.executionId);
    assert.equal(after?.rows[0].badge.label, "중단 마침");
    // 🔵 전에는 여기서 딱지가 통째로 없어졌다(「진행 중」만 적던 때). 지금은 갈래별
    //    수를 다 적으므로 **남은 갈래가 그대로 적힌다** — 「진행 중」만 빠진다.
    assert.deepEqual(after?.fold.note, { text: "중단 마침 1", tone: "MUTED" });
    assert.ok(!after?.fold.note?.text.includes("진행 중"), "도는 것이 없어지면 그 갈래는 빠진다");
  });

  test("56. 🔴 완주와 중단 마침이 **실제 자료로** 갈리고, 최근에 끝난 것이 위에 선다", async () => {
    const first = await startedExecution("TECHNICAL_TASK");
    await skipEveryNode(first.executionId);
    const finishedAll = await finishProcedureExecution(first.executionId, engineerId, await executionVersion(first.executionId), false);
    assert.equal(finishedAll.ok, true, JSON.stringify(finishedAll));

    // 둘째는 **아무것도 안 하고** 끝낸다 — 남은 것이 그대로 남는다.
    const second = await startedExecution("TECHNICAL_TASK", first.repairCaseId);
    const finishedPartly = await finishProcedureExecution(second.executionId, engineerId, await executionVersion(second.executionId), true);
    assert.equal(finishedPartly.ok, true, JSON.stringify(finishedPartly));

    const panel = await panelFor(first.repairCaseId, null);
    assert.ok(panel);
    assert.equal(panel.fold.summary, "이 건의 다른 절차 (2)");
    // 나중에 끝낸 둘째가 위다.
    assert.deepEqual(
      panel.rows.map((r) => [r.executionId, r.badge.label, r.progressLabel]),
      [
        [second.executionId, "중단 마침", "진행 0 / 5"],
        [first.executionId, "완주", "진행 5 / 5"],
      ]
    );
    assert.equal(panel.rows[0].remainingCount, 5, "남은 수가 0 이면 「중단 마침」이 될 수 없다");
  });

  test("57. 🔴 다른 접수 건의 실행은 안 섞인다", async () => {
    const mine = await startedExecution();
    const other = await startedExecution();
    const abandoned = await abandonProcedureExecution(
      other.executionId,
      engineerId,
      await executionVersion(other.executionId),
      "남의 건에서 치운 것"
    );
    assert.equal(abandoned.ok, true, JSON.stringify(abandoned));

    // 🔵 표본 확인 — 저쪽 건에서는 분명히 한 줄 뜬다.
    assert.equal((await panelFor(other.repairCaseId, null))?.rows.length, 1);
    // 🔴 내 건에는 큰 카드에 선 내 실행뿐이라 아래 줄이 없다. 남의 건에서 치운
    // 실행이 여기로 새어 들어오면 바로 걸린다.
    assert.equal(await panelFor(mine.repairCaseId, mine.executionId), null);
  });

  test("58. 🔴 줄마다 **제 version** 이 실린다 — 단추가 그것으로 그만둔다", async () => {
    // 2026-11-02(조각 8 보완): [실행 그만두기]가 줄마다 붙으면서 조회가 실행 행의
    // version 까지 실어 오게 됐다. 한 값을 돌려 쓰면 남의 version 으로 남의 실행을
    // 그만두려 드는 호출이 된다.
    const first = await startedExecution("TECHNICAL_TASK");
    const second = await startedExecution("TECHNICAL_TASK", first.repairCaseId);

    // 첫째만 손대서 **버전을 벌린다** — 둘이 같은 값이면 이 시험이 아무것도 안 잰다.
    const finished = await finishProcedureExecution(first.executionId, engineerId, await executionVersion(first.executionId), true);
    assert.equal(finished.ok, true, JSON.stringify(finished));

    const candidates = await getOtherExecutionsForCase(first.repairCaseId, null);
    const byId = new Map(candidates.map((c) => [c.executionId, c.version]));
    assert.equal(byId.size, 2);
    assert.notEqual(byId.get(first.executionId), byId.get(second.executionId), "버전이 같으면 돌려 써도 안 걸린다");
    // 🔴 실제 행의 값과 한 글자도 다르지 않아야 한다 — 틀리면 그만두기가 CONFLICT 로
    // 거절되고, 사람 눈에는 「눌러도 아무 일이 없다」로 보인다.
    assert.equal(byId.get(first.executionId), await executionVersion(first.executionId));
    assert.equal(byId.get(second.executionId), await executionVersion(second.executionId));
  });

  test("59. 🔴 **그만둘 수 있는 줄**이 실자료에서 갈린다 — 완주와 그만둠에는 안 붙는다", async () => {
    // 2026-11-02 사용자 결정: 「[실행 그만두기]는 [중단 마침], [진행중]에만
    // 붙이면 돼.」 완주는 끝까지 다 한 기록이라 치울 이유가 없다.
    const completed = await startedExecution("TECHNICAL_TASK");
    await skipEveryNode(completed.executionId);
    const doneAll = await finishProcedureExecution(
      completed.executionId,
      engineerId,
      await executionVersion(completed.executionId),
      false
    );
    assert.equal(doneAll.ok, true, JSON.stringify(doneAll));

    // 둘째는 아무것도 안 하고 끝낸다 → 중단 마침.
    const partly = await startedExecution("TECHNICAL_TASK", completed.repairCaseId);
    const stopped = await finishProcedureExecution(partly.executionId, engineerId, await executionVersion(partly.executionId), true);
    assert.equal(stopped.ok, true, JSON.stringify(stopped));

    // 셋째는 그만둔다, 넷째는 그대로 둔다 → 그만둠 · 진행 중.
    const removed = await startedExecution("TECHNICAL_TASK", completed.repairCaseId);
    const gone = await abandonProcedureExecution(
      removed.executionId,
      engineerId,
      await executionVersion(removed.executionId),
      "잘못 불러왔습니다"
    );
    assert.equal(gone.ok, true, JSON.stringify(gone));
    const running = await startedExecution("TECHNICAL_TASK", completed.repairCaseId);

    const panel = await panelFor(completed.repairCaseId, null);
    assert.ok(panel);
    const reasonById = new Map(panel.rows.map((row) => [row.executionId, row.abandonBlockedReason]));
    assert.equal(reasonById.size, 4, "네 갈래가 다 있어야 「둘만 붙는다」를 잴 수 있다");
    assert.equal(reasonById.get(completed.executionId), "COMPLETED_ALL", "완주 줄에 단추가 붙으면 안 된다");
    assert.equal(reasonById.get(removed.executionId), "ALREADY_ABANDONED");
    assert.equal(reasonById.get(partly.executionId), null, "중단 마침에는 붙어야 한다");
    assert.equal(reasonById.get(running.executionId), null, "진행 중에도 붙어야 한다");

    // 🔵 접힌 줄의 딱지에 **갈래별 수**가 다 적힌다(같은 날 사용자 결정).
    assert.equal(panel.fold.summary, "이 건의 다른 절차 (4)");
    assert.equal(panel.fold.note?.text, "진행 중 1 · 완주 1 · 중단 마침 1 · 그만둠 1");
  });
});

describe("procedure-case-execution: 절차 중간부터 시작", () => {
  /** 고른 노드 하나로 실행을 시작하고, 코드별 실행 노드 지도를 돌려준다. */
  async function startAt(templateId: string, repairCaseId: string, startAtTemplateNodeId: string | null) {
    const result = await startProcedureExecution(repairCaseId, templateId, engineerId, startAtTemplateNodeId);
    return result;
  }

  test("58. 🔴 고른 노드만 진행 중이고 나머지는 전부 대기다 — 앞의 것이 **건너뜀이 안 된다**", async () => {
    const { templateId, nodes } = await createPublishedTemplate(uniqueCode("start-at-middle"));
    const created = await createTestCase({ assignedEngineerId: engineerId });

    // n4(정상 작업)는 그래프상 n1 → n2 → n3 뒤에 오는 노드다 — 앞에 n2·n3 가 있다.
    const result = await startAt(templateId, created.id, nodes.get("n4")!.id);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, result.executionId);
    assert.equal(byCode.get("n4")!.status, "IN_PROGRESS", "고른 노드가 진행 중이어야 한다");
    assert.equal(byCode.get("n4")!.startedBy, engineerId);
    assert.notEqual(byCode.get("n4")!.startedAt, null);

    // 🔴 앞의 것들 — 건너뜀이 아니라 **대기**다. 안 한 것을 했다고 적으면 안 된다.
    for (const code of ["n2", "n3"]) {
      assert.equal(byCode.get(code)!.status, "PENDING", `${code} 는 대기여야 한다`);
      assert.equal(byCode.get(code)!.startedAt, null);
    }
    // 뒤의 것도 대기 그대로.
    assert.equal(byCode.get("n5")!.status, "PENDING");
    assert.equal(byCode.get("n7")!.status, "PENDING");
    // START 는 전과 같이 시스템이 완료로 적는다.
    assert.equal(byCode.get("n1")!.status, "COMPLETED");

    // 🔵 표본 확인 — 어느 상태도 SKIPPED 가 아니다(하나라도 생기면 바로 걸린다).
    assert.equal(
      [...byCode.values()].filter((n) => n.status === "SKIPPED").length,
      0,
      "중간부터 시작했다고 해서 앞의 작업을 건너뛴 것으로 적으면 안 된다"
    );
  });

  test("59. 🔴 「지금 할 일」이 **고른 그 노드**가 된다 — 새로 만든 규칙 없이 pickCurrentTask 가 고른다", async () => {
    const { templateId, nodes } = await createPublishedTemplate(uniqueCode("start-at-focus"));
    const created = await createTestCase({ assignedEngineerId: engineerId });

    const result = await startAt(templateId, created.id, nodes.get("n5")!.id);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;

    const detail = await getExecutionDetail(result.executionId);
    assert.ok(detail);
    const current = pickCurrentTaskNode(detail.nodes, { isExecutionFinished: detail.completedAt !== null });
    assert.ok(current, "지금 할 일이 없다");
    assert.equal(current.nodeCode, "n5");
    assert.equal(current.status, "IN_PROGRESS");

    // 🔵 표본 확인 — 처음부터 시작했다면 절차 차례상 맨 앞(n2)이 섰을 것이다.
    const created2 = await createTestCase({ assignedEngineerId: engineerId });
    const plain = await startAt(templateId, created2.id, null);
    assert.equal(plain.ok, true, JSON.stringify(plain));
    if (!plain.ok) return;
    const plainDetail = await getExecutionDetail(plain.executionId);
    assert.equal(pickCurrentTaskNode(plainDetail!.nodes, { isExecutionFinished: false })!.nodeCode, "n2");
  });

  test("60. 🔴 **남의 절차 노드**를 보내면 거절한다 — 실행이 한 줄도 안 생긴다", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("start-at-foreign-a"));
    const other = await createPublishedTemplate(uniqueCode("start-at-foreign-b"));
    const created = await createTestCase({ assignedEngineerId: engineerId });

    const result = await startAt(templateId, created.id, other.nodes.get("n4")!.id);
    assert.equal(result.ok, false, "남의 절차 노드가 통과했다");
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");

    const executions = await db
      .select({ id: procedureCaseExecutions.id })
      .from(procedureCaseExecutions)
      .where(eq(procedureCaseExecutions.repairCaseId, created.id));
    assert.equal(executions.length, 0, "거절했는데 실행 행이 남았다 — 트랜잭션이 안 되감겼다");

    // 🔵 표본 확인 — 같은 절차의 노드를 보내면 통과한다. 그래야 위 거절이
    // 「어차피 다 거절한다」가 아님이 드러난다.
    const ownNodes = await loadNodesByCode(templateId);
    const okResult = await startAt(templateId, created.id, ownNodes.get("n4")!.id);
    assert.equal(okResult.ok, true, JSON.stringify(okResult));
  });

  test("61. 🔴 실행 행이 없는 노드는 못 고른다 — START 와 참고 문서가 각각 다른 코드로 거절된다", async () => {
    const { templateId, nodes } = await createPublishedTemplate(uniqueCode("start-at-unpickable"));
    const created = await createTestCase({ assignedEngineerId: engineerId });

    const startNode = await startAt(templateId, created.id, nodes.get("n1")!.id);
    assert.equal(startNode.ok, false, "START 를 출발점으로 받으면 안 된다");
    if (!startNode.ok) assert.equal(startNode.code, "SYSTEM_MANAGED_NODE");

    const referenceNode = await startAt(templateId, created.id, nodes.get("n6")!.id);
    assert.equal(referenceNode.ok, false, "참고 문서를 출발점으로 받으면 안 된다");
    if (!referenceNode.ok) assert.equal(referenceNode.code, "INVALID_INPUT");

    const executions = await db
      .select({ id: procedureCaseExecutions.id })
      .from(procedureCaseExecutions)
      .where(eq(procedureCaseExecutions.repairCaseId, created.id));
    assert.equal(executions.length, 0, "거절했는데 실행 행이 남았다");
  });

  test("62. 아무것도 안 고르면 지금까지와 **똑같다** — 전부 대기이고 이력에 시작 지점 칸이 아예 없다", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("start-at-none"));
    const created = await createTestCase({ assignedEngineerId: engineerId });

    const result = await startAt(templateId, created.id, null);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;

    const byCode = await loadExecutionNodesByCode(templateId, result.executionId);
    assert.equal(byCode.get("n1")!.status, "COMPLETED");
    for (const code of ["n2", "n3", "n4", "n5", "n7"]) {
      assert.equal(byCode.get(code)!.status, "PENDING", `${code} 는 대기여야 한다`);
    }

    const history = await db
      .select()
      .from(procedureCaseExecutionHistory)
      .where(eq(procedureCaseExecutionHistory.executionId, result.executionId));
    const startedRow = history.find((h) => h.actionType === "EXECUTION_STARTED")!;
    // 🔴 null 을 적지 않는다 — 지금까지 쌓인 줄과 모양이 같아야 한다.
    assert.deepEqual(startedRow.afterState, {
      procedureTemplateId: templateId,
      executableNodeCount: 6,
      autoCompletedSystemNodeCount: 1,
    });
    assert.equal(history.filter((h) => h.actionType === "NODE_STARTED").length, 0, "아무도 안 눌렀는데 시작 이력이 생겼다");
  });

  test("63. 🔴 감사 이력 — 시작 지점이 적히고, **NODE_STARTED 한 줄**이 실행 시작 줄 뒤에 선다(새 action 값 없음)", async () => {
    const { templateId, nodes } = await createPublishedTemplate(uniqueCode("start-at-audit"));
    const created = await createTestCase({ assignedEngineerId: engineerId });
    const targetTemplateNodeId = nodes.get("n4")!.id;

    const result = await startAt(templateId, created.id, targetTemplateNodeId);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;

    const history = await db
      .select()
      .from(procedureCaseExecutionHistory)
      .where(eq(procedureCaseExecutionHistory.executionId, result.executionId));
    assert.equal(history.length, 2, "실행 시작 한 줄 + 중간부터 세운 한 줄");

    const startedRow = history.find((h) => h.actionType === "EXECUTION_STARTED")!;
    assert.deepEqual(startedRow.afterState, {
      procedureTemplateId: templateId,
      executableNodeCount: 6,
      autoCompletedSystemNodeCount: 1,
      startAtTemplateNodeId: targetTemplateNodeId,
    });

    const nodeStartedRow = history.find((h) => h.actionType === "NODE_STARTED")!;
    assert.ok(nodeStartedRow, "중간부터 세운 줄이 없다 — 왜 이것이 진행 중인지 나중에 못 되짚는다");
    assert.deepEqual(nodeStartedRow.afterState, {
      startedMidProcedure: true,
      procedureTemplateNodeId: targetTemplateNodeId,
    });
    const byCode = await loadExecutionNodesByCode(templateId, result.executionId);
    assert.equal(nodeStartedRow.executionNodeId, byCode.get("n4")!.id, "이력이 엉뚱한 행에 붙었다");

    // 🔴 차례 — 실행 시작이 먼저다. 같은 트랜잭션이라 now() 가 같아서 1밀리초를
    // 더해 두었다(FOLLOWING_HISTORY_AT). 안 더하면 화면에서 둘의 차례가 흔들린다.
    assert.ok(
      nodeStartedRow.createdAt.getTime() > startedRow.createdAt.getTime(),
      `뒤따르는 줄이 더 늦어야 한다 (시작=${startedRow.createdAt.toISOString()}, 세움=${nodeStartedRow.createdAt.toISOString()})`
    );
    // 화면의 이력 목록(최신 먼저)에서도 같은 차례가 나와야 한다.
    const timeline = await getExecutionHistory(result.executionId);
    assert.deepEqual(
      timeline.map((r) => r.actionType),
      ["NODE_STARTED", "EXECUTION_STARTED"]
    );
  });

  test("64. 🔵 불러오기 목록이 **노드·간선까지** 싣는다 — 그리다 만 절차도 걸러 내지 않는다", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("start-at-options"), "TECHNICAL_TASK");
    const options = await getExecutableTemplateOptions();
    const mine = options.find((o) => o.id === templateId);
    assert.ok(mine, "방금 게시한 절차가 불러오기 목록에 없다");
    assert.equal(mine.nodes.length, 7, "참고 문서를 포함한 템플릿 노드 전부가 와야 그림이 그려진다");
    assert.equal(mine.edges.length, 7);
    assert.equal(mine.category, "TECHNICAL_TASK");

    // 🔵 표본 확인 — 그림에 필요한 칸이 실제로 실려 있다(빈 값으로 채워져 있으면
    // 노드가 전부 한 점에 겹친다).
    const first = mine.nodes[0];
    assert.equal(typeof first.positionX, "number");
    assert.equal(typeof first.sortOrder, "number");
    assert.ok(first.title.length > 0);

    // 🔴 선이 하나도 안 닿은 노드도 그대로 온다 — 실측 「원복 검사 및 개선 작업」이
    // 바로 그 모양이라(노드 23에 간선 8) 걸러 내면 그 절차에서 시작할 길이 없어진다.
    const connected = new Set(mine.edges.flatMap((e) => [e.fromNodeId, e.toNodeId]));
    const isolated = mine.nodes.filter((n) => !connected.has(n.id));
    assert.ok(mine.nodes.length >= connected.size, "간선이 가리키는 노드가 목록에 없다");
    void isolated;
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

describe("procedure-case-execution: Phase 5C-5A category foundation", () => {
  test("22. template_category is always derived from the DB template row, never a client-suppliable value — startProcedureExecution's own signature has no category parameter", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("category-derived"), "FULL_SERVICE");
    const created = await createTestCase();

    const result = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(result.ok, true, `start failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const [execution] = await db.select().from(procedureCaseExecutions).where(eq(procedureCaseExecutions.id, result.executionId));
    assert.equal(execution.templateCategory, "FULL_SERVICE", "templateCategory must exactly match the referenced template's own category");
  });

  test("23. FULL_SERVICE keeps the pre-5C-5A 'at most one active execution per case' restriction (same guarantee as test 2, confirmed again explicitly under the new category-scoped index)", async () => {
    const { templateId: templateA } = await createPublishedTemplate(uniqueCode("full-service-a"), "FULL_SERVICE");
    const { templateId: templateB } = await createPublishedTemplate(uniqueCode("full-service-b"), "FULL_SERVICE");
    const created = await createTestCase();

    const first = await startProcedureExecution(created.id, templateA, engineerId);
    assert.equal(first.ok, true);
    const second = await startProcedureExecution(created.id, templateB, engineerId);
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "ALREADY_STARTED", "a second FULL_SERVICE execution (even from a different template) must still be rejected");
  });

  test("24. multiple TECHNICAL_TASK executions are allowed concurrently on the same repair case", async () => {
    const { templateId: templateA } = await createPublishedTemplate(uniqueCode("technical-a"), "TECHNICAL_TASK");
    const { templateId: templateB } = await createPublishedTemplate(uniqueCode("technical-b"), "TECHNICAL_TASK");
    const created = await createTestCase();

    const first = await startProcedureExecution(created.id, templateA, engineerId);
    const second = await startProcedureExecution(created.id, templateB, engineerId);
    assert.equal(first.ok, true, `first TECHNICAL_TASK start failed: ${JSON.stringify(first)}`);
    assert.equal(second.ok, true, `second concurrent TECHNICAL_TASK start failed: ${JSON.stringify(second)}`);

    if (first.ok && second.ok) {
      const rows = await db
        .select({ id: procedureCaseExecutions.id, isDeleted: procedureCaseExecutions.isDeleted, templateCategory: procedureCaseExecutions.templateCategory })
        .from(procedureCaseExecutions)
        .where(eq(procedureCaseExecutions.repairCaseId, created.id));
      const active = rows.filter((r) => !r.isDeleted);
      assert.equal(active.length, 2, "both TECHNICAL_TASK executions must coexist as active (non-deleted) rows");
      assert.ok(active.every((r) => r.templateCategory === "TECHNICAL_TASK"));
    }
  });

  test("25. a FULL_SERVICE and a TECHNICAL_TASK execution can coexist on the same case (only FULL_SERVICE-vs-FULL_SERVICE is restricted)", async () => {
    const { templateId: fullServiceTemplate } = await createPublishedTemplate(uniqueCode("mixed-full-service"), "FULL_SERVICE");
    const { templateId: technicalTemplate } = await createPublishedTemplate(uniqueCode("mixed-technical"), "TECHNICAL_TASK");
    const created = await createTestCase();

    const fullServiceResult = await startProcedureExecution(created.id, fullServiceTemplate, engineerId);
    const technicalResult = await startProcedureExecution(created.id, technicalTemplate, engineerId);
    assert.equal(fullServiceResult.ok, true);
    assert.equal(technicalResult.ok, true, `TECHNICAL_TASK start alongside an active FULL_SERVICE execution must succeed: ${JSON.stringify(technicalResult)}`);
  });

  test("26. a REFERENCE-category template can never start an execution (rejected the same way as any other is_reference_only template)", async () => {
    const draftResult = await createDraftProcedureTemplateFromImport(makeReferenceTestTemplate(uniqueCode("reference-guard")), superAdminId, {
      sourceFileName: "execution-fixture.xlsx",
      sourceFileHash: `hash-reference-${randomUUID()}`,
    });
    assert.equal(draftResult.ok, true, `reference fixture import failed: ${JSON.stringify(draftResult)}`);
    if (!draftResult.ok) return;
    createdTemplateIds.push(draftResult.id);

    const publishResult = await publishProcedureTemplate(draftResult.id, superAdminId);
    assert.equal(publishResult.ok, true, `reference fixture publish failed: ${JSON.stringify(publishResult)}`);

    const created = await createTestCase();
    const result = await startProcedureExecution(created.id, draftResult.id, engineerId);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "TEMPLATE_NOT_EXECUTABLE");
  });

  test("27. shipment-lock removal policy and assignment rules are unchanged for TECHNICAL_TASK (same authorization path as FULL_SERVICE)", async () => {
    const { templateId } = await createPublishedTemplate(uniqueCode("technical-locked"), "TECHNICAL_TASK");
    const created = await createTestCase({ assignedEngineerId: engineerId });
    await lockCase(created.id);

    const lockedResult = await startProcedureExecution(created.id, templateId, engineerId);
    assert.equal(lockedResult.ok, true, JSON.stringify(lockedResult));

    const { templateId: templateB } = await createPublishedTemplate(uniqueCode("technical-unassigned"), "TECHNICAL_TASK");
    const created2 = await createTestCase({ assignedEngineerId: engineerId });
    const unassignedResult = await startProcedureExecution(created2.id, templateB, engineer2Id);
    assert.equal(unassignedResult.ok, false);
    if (!unassignedResult.ok) assert.equal(unassignedResult.code, "FORBIDDEN");
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
