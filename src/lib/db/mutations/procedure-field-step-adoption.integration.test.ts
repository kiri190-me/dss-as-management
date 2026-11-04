import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
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
  procedureCaseExecutions,
  procedureCaseExecutionNodes,
  procedureCaseExecutionEdges,
  procedureCaseExecutionHistory,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import { createDraftProcedureTemplateFromImport, publishProcedureTemplate, createNewDraftVersion } from "./procedure-templates";
import { startProcedureExecution, addExecutionExtraTask, addExecutionEdge, removeExecutionExtraTask } from "./procedure-case-execution";
import { adoptFieldAddedStep } from "./procedure-template-editor";
import { getFieldAddedStepsForDraft } from "../queries/procedure-template-editor";
import { fieldStepNodeCode, pendingFieldSteps } from "@/lib/domain/procedure-field-added-steps";
import type { ExtractedTemplate } from "../../../../scripts/lib/xlsx/types";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 줄기 B-⑧ — 현장에서 더한 단계를 **절차에 넣기** (2026-11-03)
 * ============================================================================
 * 사용자 결정(2026-11-02): 「원본 절차를 편집할 때, 이번에 만들었던 단계를
 * 희미하게 표시해주고, 적용할 것인지 묻도록 하자」.
 *
 * ── 🔴 접수 건을 **딱 하나만** 만든다 ───────────────────────────────────
 * 인수번호가 **달마다 99개 한도**다. 시험이 접수 건을 많이 만들면 한참 뒤에
 * 전혀 다른 시험이 까닭 없이 깨진다. 그래서 이 묶음은 before() 에서 한 건만
 * 만들고, 시나리오마다 **그 한 건 위에 실행을 새로 세운다** — 쓰는 절차가
 * TECHNICAL_TASK 라 한 건에 여러 실행이 동시에 설 수 있다(FULL_SERVICE 만
 * 「한 건에 살아 있는 실행 하나」로 막혀 있다).
 *
 * ── 뒷정리 ──────────────────────────────────────────────────────────────
 * 이웃(procedure-case-execution.integration.test.ts)의 규약 그대로다. 달은
 * "9111"(2091-11) — 다른 시험 묶음이 쓰는 60개 달과 안 겹친다(실측 2026-11-03).
 * 🔴 간선이 노드를 `ON DELETE restrict` 로 가리키므로 **간선 → 노드** 차례로
 * 치운다. 거꾸로 하면 뒷정리가 통째로 실패해 다음 실행이 찌꺼기 위에서 돈다.
 * ============================================================================
 */

const TEST_CODE_PREFIX = "test-fieldstep-";
const TEST_MODEL_PREFIX = "FIELDSTEP-TEST-";
const TEST_YEAR_MONTH = "9111";
const TEST_INTAKE_LIKE = "D9111%";
const TEST_RECEIVED_AT = "2091-11-10";
const TEST_SHIPMENT_DATE = "2091-11-20";

let superAdminId: string;
let engineerId: string;
let customerId: string;
/** 🔴 이 묶음이 만드는 **단 하나**의 접수 건. 시나리오마다 새로 만들지 않는다(머리말). */
let repairCaseId: string;

const createdTemplateIds: string[] = [];

function uniqueCode(suffix: string): string {
  return `${TEST_CODE_PREFIX}${suffix}-${randomUUID().slice(0, 8)}`;
}

/**
 * START → TASK → DECISION → (YES: TASK → END) / (NG: CORRECTIVE_ACTION → DECISION).
 * 참고 문서를 안 넣었다 — 이 묶음은 실행 행이 생기는 노드만 필요하고, 참고 문서는
 * 실행 행이 아예 안 생겨 이을 수도 없다.
 */
function makeFieldStepTestTemplate(code: string): ExtractedTemplate {
  const sheet = "(TEST) 현장 단계 시트";
  return {
    code,
    name: `현장 단계 시험 ${code}`,
    equipmentType: "RFG",
    description: "줄기 B-⑧ 현장 단계 채택 시험 밑자락",
    sourceWorksheets: [sheet],
    category: "TECHNICAL_TASK",
    isReferenceOnly: false,
    referenceItems: [],
    nodes: [
      { nodeCode: "n1", nodeType: "START", title: "시작", positionX: 0, positionY: 0, sortOrder: 0, sourceWorksheet: sheet, sourceShapeId: "1" },
      { nodeCode: "n2", nodeType: "TASK", title: "준비 작업", positionX: 100, positionY: 0, sortOrder: 1, sourceWorksheet: sheet, sourceShapeId: "2" },
      { nodeCode: "n3", nodeType: "DECISION", title: "판단", positionX: 200, positionY: 0, sortOrder: 2, sourceWorksheet: sheet, sourceShapeId: "3" },
      { nodeCode: "n4", nodeType: "TASK", title: "정상 작업", positionX: 300, positionY: 0, sortOrder: 3, sourceWorksheet: sheet, sourceShapeId: "4" },
      { nodeCode: "n5", nodeType: "CORRECTIVE_ACTION", title: "NG 조치", positionX: 200, positionY: 100, sortOrder: 4, sourceWorksheet: sheet, sourceShapeId: "5" },
      { nodeCode: "n7", nodeType: "END", title: "종료", positionX: 500, positionY: 0, sortOrder: 6, sourceWorksheet: sheet, sourceShapeId: "7" },
    ],
    edges: [
      { fromNodeCode: "n1", toNodeCode: "n2", branchType: "DEFAULT", branchLabel: null, sortOrder: 0, sourceConnectorId: "c1" },
      { fromNodeCode: "n2", toNodeCode: "n3", branchType: "DEFAULT", branchLabel: null, sortOrder: 1, sourceConnectorId: "c2" },
      { fromNodeCode: "n3", toNodeCode: "n4", branchType: "YES", branchLabel: "YES", sortOrder: 2, sourceConnectorId: "c3" },
      { fromNodeCode: "n3", toNodeCode: "n5", branchType: "NG", branchLabel: "NG", sortOrder: 3, sourceConnectorId: "c4" },
      { fromNodeCode: "n5", toNodeCode: "n3", branchType: "RETRY", branchLabel: "재측정", sortOrder: 4, sourceConnectorId: "c5" },
      { fromNodeCode: "n4", toNodeCode: "n7", branchType: "DEFAULT", branchLabel: null, sortOrder: 5, sourceConnectorId: "c6" },
    ],
    checklistSections: [],
    troubleshootingEntries: [],
    issues: [],
  };
}

async function createPublishedTemplate(code: string) {
  const draftResult = await createDraftProcedureTemplateFromImport(makeFieldStepTestTemplate(code), superAdminId, {
    sourceFileName: "field-step-fixture.xlsx",
    sourceFileHash: `hash-${code}`,
  });
  assert.equal(draftResult.ok, true, `fixture import failed: ${JSON.stringify(draftResult)}`);
  if (!draftResult.ok) throw new Error("unreachable");
  createdTemplateIds.push(draftResult.id);
  const publishResult = await publishProcedureTemplate(draftResult.id, superAdminId);
  assert.equal(publishResult.ok, true, `fixture publish failed: ${JSON.stringify(publishResult)}`);
  return draftResult.id;
}

async function loadNodesByCode(templateId: string) {
  const rows = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.procedureTemplateId, templateId));
  return new Map(rows.map((n) => [n.nodeCode, n]));
}

/** 실행 노드를 **절차 노드 코드**로 찾는다 — 실행 행의 id 는 매번 다르다. */
async function loadExecutionNodesByCode(templateId: string, executionId: string) {
  const templateNodes = await loadNodesByCode(templateId);
  const execNodes = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.executionId, executionId));
  const byTemplateNodeId = new Map(execNodes.map((n) => [n.procedureTemplateNodeId, n]));
  const byCode = new Map<string, (typeof execNodes)[number]>();
  for (const [code, templateNode] of templateNodes) {
    const execNode = byTemplateNodeId.get(templateNode.id);
    if (execNode) byCode.set(code, execNode);
  }
  return byCode;
}

async function templateUpdatedAt(templateId: string): Promise<string> {
  const [row] = await db.select({ updatedAt: procedureTemplates.updatedAt }).from(procedureTemplates).where(eq(procedureTemplates.id, templateId));
  return row.updatedAt.toISOString();
}

/**
 * 이 초안의 노드 전부를 **모든 칸 그대로** 늘어놓는다 — 「기존 노드가 한 글자도
 * 안 바뀌었다」를 재는 자다. 칸을 골라 담으면 안 담은 칸이 바뀌어도 통과한다.
 */
async function snapshotTemplateNodes(templateId: string) {
  const rows = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.procedureTemplateId, templateId));
  return rows
    .sort((a, b) => (a.nodeCode < b.nodeCode ? -1 : a.nodeCode > b.nodeCode ? 1 : 0))
    .map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() }));
}

async function snapshotTemplateEdges(templateId: string) {
  const rows = await db.select().from(procedureTemplateEdges).where(eq(procedureTemplateEdges.procedureTemplateId, templateId));
  // 🔵 간선 표에는 시각 칸이 없다 — 노드 쪽과 달리 그대로 늘어놓으면 된다.
  return rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * 한 시나리오분의 밑자락: 게시된 절차 하나 + 그 위의 실행 하나 + 현장에서 더한
 * 작업 하나(+ n2 → 그 작업 선 하나) + 그 절차의 새 초안.
 */
async function setupFieldStepScenario(suffix: string, options: { withEdge?: boolean; position?: { x: number; y: number } | null } = {}) {
  const publishedId = await createPublishedTemplate(uniqueCode(suffix));
  const started = await startProcedureExecution(repairCaseId, publishedId, engineerId);
  assert.equal(started.ok, true, `start failed: ${JSON.stringify(started)}`);
  if (!started.ok) throw new Error("unreachable");

  const added = await addExecutionExtraTask(
    started.executionId,
    engineerId,
    "현장에서 더한 점검",
    "여기서만 하던 점검입니다",
    "INSPECTION",
    options.position ?? null
  );
  assert.equal(added.ok, true, `extra task failed: ${JSON.stringify(added)}`);
  if (!added.ok) throw new Error("unreachable");

  const execByCode = await loadExecutionNodesByCode(publishedId, started.executionId);
  if (options.withEdge !== false) {
    const edgeResult = await addExecutionEdge({
      executionId: started.executionId,
      actorUserId: engineerId,
      fromExecutionNodeId: execByCode.get("n2")!.id,
      toExecutionNodeId: added.executionNodeId,
      branchType: "DEFAULT",
      branchLabel: null,
    });
    assert.equal(edgeResult.ok, true, `execution edge failed: ${JSON.stringify(edgeResult)}`);
  }

  const draftResult = await createNewDraftVersion(publishedId, superAdminId);
  assert.equal(draftResult.ok, true, `draft version failed: ${JSON.stringify(draftResult)}`);
  if (!draftResult.ok) throw new Error("unreachable");
  createdTemplateIds.push(draftResult.id);

  return { publishedId, draftId: draftResult.id, executionId: started.executionId, fieldStepId: added.executionNodeId, execByCode };
}

before(async () => {
  const [superAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(superAdmin, "expected an approved SUPER_ADMIN in the dev DB");
  superAdminId = superAdmin.id;

  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(engineer, "expected an approved AS_ENGINEER in the dev DB");
  engineerId = engineer.id;

  const [customer] = await db.select({ id: customers.id }).from(customers).where(eq(customers.isDeleted, false)).limit(1);
  assert.ok(customer, "expected at least one non-deleted customer in the dev DB");
  customerId = customer.id;

  const suffix = randomUUID().slice(0, 8);
  const input: ValidatedCreateRepairCaseInput = {
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
  };
  const created = await createRepairCase(input);
  assert.equal(created.ok, true, `setup create failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  repairCaseId = created.id;
});

after(async () => {
  const allTestTemplates = await db.select({ id: procedureTemplates.id }).from(procedureTemplates).where(like(procedureTemplates.code, `${TEST_CODE_PREFIX}%`));
  const allTemplateIds = [...new Set([...createdTemplateIds, ...allTestTemplates.map((t) => t.id)])];

  const testCases = await db.select({ id: repairCases.id }).from(repairCases).where(like(repairCases.intakeNumber, TEST_INTAKE_LIKE));
  const testCaseIds = testCases.map((c) => c.id);
  if (testCaseIds.length > 0) {
    const executions = await db.select({ id: procedureCaseExecutions.id }).from(procedureCaseExecutions).where(inArray(procedureCaseExecutions.repairCaseId, testCaseIds));
    const executionIds = executions.map((e) => e.id);
    if (executionIds.length > 0) {
      await db.delete(procedureCaseExecutionHistory).where(inArray(procedureCaseExecutionHistory.executionId, executionIds));
      // 🔴 간선이 노드를 restrict 로 가리킨다 — 간선 먼저(머리말).
      await db.delete(procedureCaseExecutionEdges).where(inArray(procedureCaseExecutionEdges.executionId, executionIds));
      await db.delete(procedureCaseExecutionNodes).where(inArray(procedureCaseExecutionNodes.executionId, executionIds));
      await db.delete(procedureCaseExecutions).where(inArray(procedureCaseExecutions.id, executionIds));
    }
  }

  await db.delete(repairCases).where(like(repairCases.intakeNumber, TEST_INTAKE_LIKE));
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

describe("줄기 B-⑧ — 조회: 현장에서 더한 것만 골라 낸다", () => {
  test("1. 🔴 실행 노드가 여럿인데 **현장에서 더한 하나만** 올라온다 — 템플릿에서 온 줄은 안 섞인다", async () => {
    const scenario = await setupFieldStepScenario("select-only-field");

    // 표본 확인 — 이 실행에는 템플릿에서 온 줄이 여럿 있다. 하나뿐이면 아래
    // 단언이 「거르기가 일한다」가 아니라 「애초에 하나였다」가 된다.
    const allExecNodes = await db.select().from(procedureCaseExecutionNodes).where(eq(procedureCaseExecutionNodes.executionId, scenario.executionId));
    assert.ok(allExecNodes.length >= 4, `표본이 모자라다: 실행 노드 ${allExecNodes.length}줄`);
    assert.equal(allExecNodes.filter((n) => n.procedureTemplateNodeId === null).length, 1, "현장에서 더한 것은 하나뿐이어야 한다");

    const steps = await getFieldAddedStepsForDraft(scenario.draftId);
    assert.equal(steps.length, 1, "템플릿에서 온 줄이 섞이면 수가 늘어난다");
    assert.equal(steps[0].executionNodeId, scenario.fieldStepId);
    assert.equal(steps[0].title, "현장에서 더한 점검");
    assert.equal(steps[0].instructions, "여기서만 하던 점검입니다");
    assert.equal(steps[0].nodeType, "INSPECTION", "현장에서 고른 갈래가 그대로 와야 한다");
    assert.equal(steps[0].nodeCode, fieldStepNodeCode(scenario.fieldStepId));
    assert.equal(steps[0].adoptedNodeId, null, "아직 안 넣었다");
    assert.equal(steps[0].sourceTemplateVersion, 1, "v1 을 돌리다 더한 것이다");
    assert.ok(steps[0].intakeNumber?.startsWith("D9111"), `접수 번호가 안 실렸다: ${steps[0].intakeNumber}`);
    assert.ok(steps[0].addedByName, "더한 사람 이름은 NODE_ADDED 이력에서 온다 — started_by 가 아니다");
  });

  test("2. 🔴 이웃이 **이 초안의 노드**로 건너온다 — 판본이 달라 id 가 다른데도", async () => {
    const scenario = await setupFieldStepScenario("neighbor-bridge");
    const steps = await getFieldAddedStepsForDraft(scenario.draftId);
    assert.equal(steps.length, 1);

    const draftNodes = await loadNodesByCode(scenario.draftId);
    const publishedNodes = await loadNodesByCode(scenario.publishedId);
    // 표본 확인 — 두 판본의 n2 는 **서로 다른 행**이다. 같으면 「건너왔다」가 뜻이 없다.
    assert.notEqual(draftNodes.get("n2")!.id, publishedNodes.get("n2")!.id, "초안은 복제된 다른 행이어야 한다");

    assert.equal(steps[0].incoming.length, 1);
    assert.equal(steps[0].incoming[0].draftNodeId, draftNodes.get("n2")!.id, "원본 판본의 id 가 아니라 **이 초안**의 id 여야 한다");
    assert.equal(steps[0].incoming[0].fieldStepExecutionNodeId, null);
    assert.equal(steps[0].incoming[0].branchType, "DEFAULT");
    assert.deepEqual(steps[0].outgoing, []);
  });

  test("3. 🔴 **치운 추가 작업**은 안 올라온다 — 현장에서 「그 작업은 아니었다」고 한 것이다", async () => {
    const scenario = await setupFieldStepScenario("removed-step", { withEdge: false });
    const before = await getFieldAddedStepsForDraft(scenario.draftId);
    assert.equal(before.length, 1, "치우기 전에는 보여야 한다 — 아니면 아래가 공짜로 통과한다");

    const [row] = await db
      .select({ version: procedureCaseExecutionNodes.version })
      .from(procedureCaseExecutionNodes)
      .where(eq(procedureCaseExecutionNodes.id, scenario.fieldStepId));
    const removed = await removeExecutionExtraTask(scenario.fieldStepId, engineerId, row.version, "시험에서 치움");
    assert.equal(removed.ok, true, `remove failed: ${JSON.stringify(removed)}`);

    const after = await getFieldAddedStepsForDraft(scenario.draftId);
    assert.deepEqual(after, [], "치운 것이 제안으로 되살아나면 안 된다");
  });

  test("4. 🔵 초안이 아닌 절차로 물으면 **빈 목록**이다 — 게시된 절차에는 넣을 자리가 없다", async () => {
    const scenario = await setupFieldStepScenario("published-asks-nothing", { withEdge: false });
    assert.equal((await getFieldAddedStepsForDraft(scenario.draftId)).length, 1, "표본 확인 — 초안으로는 하나가 나온다");
    assert.deepEqual(await getFieldAddedStepsForDraft(scenario.publishedId), [], "게시된 판본으로 물으면 비어야 한다");
  });
});

describe("줄기 B-⑧ — 넣기: 정식 노드가 되고, 기존 노드는 한 글자도 안 바뀐다", () => {
  test("5. 🔴 노드 하나와 연결 하나가 생기고, **기존 노드·간선은 그대로**다", async () => {
    const scenario = await setupFieldStepScenario("adopt-basic", { position: { x: 777, y: 333 } });

    const nodesBefore = await snapshotTemplateNodes(scenario.draftId);
    const edgesBefore = await snapshotTemplateEdges(scenario.draftId);
    assert.equal(nodesBefore.length, 6, "표본 확인 — 초안에 노드 6개가 있어야 아래 비교에 뜻이 있다");

    const result = await adoptFieldAddedStep(scenario.draftId, superAdminId, scenario.fieldStepId, await templateUpdatedAt(scenario.draftId));
    assert.equal(result.ok, true, `adopt failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.createdEdgeCount, 1);
    assert.equal(result.skippedEdgeCount, 0);

    const nodesAfter = await snapshotTemplateNodes(scenario.draftId);
    const edgesAfter = await snapshotTemplateEdges(scenario.draftId);
    assert.equal(nodesAfter.length, 7, "노드가 정확히 하나 늘어야 한다");
    assert.equal(edgesAfter.length, edgesBefore.length + 1, "연결도 정확히 하나 늘어야 한다");

    // 🔴 **더하기만 했는가** — 전에 있던 줄은 모든 칸이 글자 그대로여야 한다.
    const newNodeCode = fieldStepNodeCode(scenario.fieldStepId);
    assert.deepEqual(nodesAfter.filter((n) => n.nodeCode !== newNodeCode), nodesBefore, "기존 노드의 칸이 하나라도 바뀌면 여기서 걸린다");
    // 🔵 Set.difference 를 안 쓴다 — 타입 검사 기준이 Node 20 이라 그 메서드가 없다.
    const beforeEdgeIds = new Set(edgesBefore.map((e) => e.id));
    const newEdgeIds = new Set(edgesAfter.map((e) => e.id).filter((id) => !beforeEdgeIds.has(id)));
    assert.equal(newEdgeIds.size, 1);
    assert.deepEqual(edgesAfter.filter((e) => !newEdgeIds.has(e.id)), edgesBefore, "기존 간선이 재연결되면 여기서 걸린다");

    // 새 노드의 내용은 **현장이 적은 그대로**다.
    const newNode = nodesAfter.find((n) => n.nodeCode === newNodeCode)!;
    assert.equal(newNode.id, result.nodeId);
    assert.equal(newNode.title, "현장에서 더한 점검");
    assert.equal(newNode.instructions, "여기서만 하던 점검입니다");
    assert.equal(newNode.nodeType, "INSPECTION");
    assert.equal(newNode.isActive, true);
    // 현장에서 끌어 놓은 자리가 그대로 온다.
    assert.equal(newNode.userPositionX, 777);
    assert.equal(newNode.userPositionY, 333);
    assert.equal(newNode.positionX, 777);
    assert.equal(newNode.positionY, 333);

    // 새 간선은 **초안의 n2 → 새 노드** 다.
    const draftNodes = await loadNodesByCode(scenario.draftId);
    const newEdge = edgesAfter.find((e) => newEdgeIds.has(e.id))!;
    assert.equal(newEdge.fromNodeId, draftNodes.get("n2")!.id);
    assert.equal(newEdge.toNodeId, result.nodeId);
    assert.equal(newEdge.branchType, "DEFAULT");

    // 이력은 **한 걸음**이다 — [이전]이 노드만 남기고 선을 지우면 섬이 생긴다.
    const history = await db.select().from(procedureTemplateEditHistory).where(eq(procedureTemplateEditHistory.procedureTemplateId, scenario.draftId));
    const adoptionRows = history.filter((h) => h.actionType === "CREATE_NODE" || h.actionType === "CREATE_EDGE");
    assert.equal(adoptionRows.length, 2, "CREATE_NODE 하나 + CREATE_EDGE 하나");
    assert.equal(new Set(adoptionRows.map((h) => h.changeGroupId)).size, 1, "두 줄이 같은 걸음이어야 한다");
  });

  test("6. 🔴 넣고 나면 **다시 안 묻는다** — 조회가 그 단계를 adopted 로 돌려준다", async () => {
    const scenario = await setupFieldStepScenario("ask-once");
    const result = await adoptFieldAddedStep(scenario.draftId, superAdminId, scenario.fieldStepId, await templateUpdatedAt(scenario.draftId));
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const steps = await getFieldAddedStepsForDraft(scenario.draftId);
    assert.equal(steps.length, 1, "목록에서 사라지는 것이 아니라 「이미 넣음」으로 바뀐다");
    assert.equal(steps[0].adoptedNodeId, result.nodeId, "어느 노드가 됐는지까지 안다");
    assert.deepEqual(pendingFieldSteps(steps), [], "할 일 목록은 비어야 한다 — 탭의 숫자가 이것을 센다");
  });

  test("7. 🔴 **두 번 넣으려 하면 거절**한다 — 같은 작업이 절차에 두 번 서면 안 된다", async () => {
    const scenario = await setupFieldStepScenario("adopt-twice");
    const first = await adoptFieldAddedStep(scenario.draftId, superAdminId, scenario.fieldStepId, await templateUpdatedAt(scenario.draftId));
    assert.equal(first.ok, true);

    const second = await adoptFieldAddedStep(scenario.draftId, superAdminId, scenario.fieldStepId, await templateUpdatedAt(scenario.draftId));
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "FIELD_STEP_ALREADY_ADOPTED", "보통 오류와 갈려야 화면이 새로고침 안내를 낼 수 있다");

    const nodes = await snapshotTemplateNodes(scenario.draftId);
    assert.equal(nodes.filter((n) => n.nodeCode === fieldStepNodeCode(scenario.fieldStepId)).length, 1, "거절했는데 하나가 더 생기면 안 된다");
  });

  test("8. 🔴 **다른 줄기의 단계**는 못 넣는다 — 화면에서 온 id 하나로 아무 절차나 꽂을 수 없다", async () => {
    const mine = await setupFieldStepScenario("cross-mine", { withEdge: false });
    const theirs = await setupFieldStepScenario("cross-theirs", { withEdge: false });
    // 표본 확인 — 둘은 정말 다른 줄기다.
    const [mineRow] = await db.select({ code: procedureTemplates.code }).from(procedureTemplates).where(eq(procedureTemplates.id, mine.draftId));
    const [theirsRow] = await db.select({ code: procedureTemplates.code }).from(procedureTemplates).where(eq(procedureTemplates.id, theirs.draftId));
    assert.notEqual(mineRow.code, theirsRow.code);

    const result = await adoptFieldAddedStep(mine.draftId, superAdminId, theirs.fieldStepId, await templateUpdatedAt(mine.draftId));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "CROSS_TEMPLATE");
  });

  test("9. 🔴 이 초안에 **상대가 없는** 연결은 건너뛰고, 몇 개를 못 그었는지 알려 준다", async () => {
    const scenario = await setupFieldStepScenario("dangling-edge");
    // 초안에서 n2 를 지운다 — 현장 단계가 매달려 있던 그 상대다.
    // 🔵 간선이 노드를 가리키므로 간선부터 치운다(뮤테이션을 거치지 않고 직접 —
    //    여기서 재려는 것은 삭제가 아니라 「상대가 없을 때」의 채택이다).
    const draftNodes = await loadNodesByCode(scenario.draftId);
    const n2Id = draftNodes.get("n2")!.id;
    await db.delete(procedureTemplateEdges).where(eq(procedureTemplateEdges.procedureTemplateId, scenario.draftId));
    await db.delete(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, n2Id));

    const steps = await getFieldAddedStepsForDraft(scenario.draftId);
    assert.equal(steps[0].incoming[0].draftNodeId, null, "상대가 사라졌으니 이을 곳이 없다");

    const result = await adoptFieldAddedStep(scenario.draftId, superAdminId, scenario.fieldStepId, await templateUpdatedAt(scenario.draftId));
    assert.equal(result.ok, true, `adopt failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.createdEdgeCount, 0, "이을 곳이 없으면 선은 안 생긴다");
    assert.equal(result.skippedEdgeCount, 1, "말 안 하면 「연결도 올 줄 알았는데」가 된다");
    // 작업 자체는 들어온다 — 넣기를 막지는 않는다.
    const nodes = await snapshotTemplateNodes(scenario.draftId);
    assert.equal(nodes.filter((n) => n.nodeCode === fieldStepNodeCode(scenario.fieldStepId)).length, 1);
  });

  test("10. 🔴 **판본을 넘어도 다시 안 묻는다** — node_code 가 복제를 따라간다", async () => {
    const scenario = await setupFieldStepScenario("across-versions");
    const adopted = await adoptFieldAddedStep(scenario.draftId, superAdminId, scenario.fieldStepId, await templateUpdatedAt(scenario.draftId));
    assert.equal(adopted.ok, true, `adopt failed: ${JSON.stringify(adopted)}`);
    if (!adopted.ok) return;

    // v2 를 게시하고 거기서 v3 초안을 뜬다.
    const published = await publishProcedureTemplate(scenario.draftId, superAdminId);
    assert.equal(published.ok, true, `publish v2 failed: ${JSON.stringify(published)}`);
    const v3 = await createNewDraftVersion(scenario.draftId, superAdminId);
    assert.equal(v3.ok, true, `draft v3 failed: ${JSON.stringify(v3)}`);
    if (!v3.ok) return;
    createdTemplateIds.push(v3.id);

    const v3Nodes = await loadNodesByCode(v3.id);
    assert.ok(v3Nodes.has(fieldStepNodeCode(scenario.fieldStepId)), "복제가 node_code 를 그대로 가져와야 한다");

    const steps = await getFieldAddedStepsForDraft(v3.id);
    assert.equal(steps.length, 1);
    assert.ok(steps[0].adoptedNodeId, "v2 에서 넣은 것이 v3 에서 「이미 넣음」이어야 한다");
    assert.deepEqual(pendingFieldSteps(steps), [], "v3 에서 다시 물으면 두 번 묻는 것이다");
  });

  test("11. 🔵 자리를 안 고른 현장 단계는 **사람이 정한 자리 없이** 들어온다 — 그림이 알아서 센다", async () => {
    const scenario = await setupFieldStepScenario("no-position", { withEdge: false, position: null });
    // 🔴 넣기 **전**의 초안을 먼저 잰다 — 아래 sort_order·position_y 는 「최댓값에
    //    대한」 값이라, 기준을 안 재면 숫자를 박아 놓고 맞다고 하는 셈이 된다.
    const before = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.procedureTemplateId, scenario.draftId));
    assert.ok(before.length > 0, "표본 확인 — 초안이 비면 아래 최댓값이 뜻을 잃는다");
    const maxSortOrder = Math.max(...before.map((n) => n.sortOrder));
    const maxPositionY = Math.max(...before.map((n) => n.positionY));

    const result = await adoptFieldAddedStep(scenario.draftId, superAdminId, scenario.fieldStepId, await templateUpdatedAt(scenario.draftId));
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const [node] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, result.nodeId));
    assert.equal(node.userPositionX, null, "안 고른 자리를 채워 주면 「사람이 정한 자리」와 안 갈린다");
    assert.equal(node.userPositionY, null);

    /**
     * 🔴 **유령이 미리 보여 주는 자리가 이 값들에 걸려 있다**(A 안, 2026-11-04).
     * 그림은 자리 값이 없는 칸을 자동 배치로 그리는데, 거기서 **뿌리의 가로
     * 차례**를 sort_order 가 정한다. 그래서 유령도 「채택이 줄 번호」를 들고 서야
     * 켠 그림과 넣은 뒤 그림이 같아진다(buildFieldStepGhostGraph 의 nextSortOrder ·
     * procedure-auto-layout.test.ts 가 그 같음을 값으로 잰다). 여기가 그 **기준이
     * 진짜 이 값인지**를 DB 에서 재는 유일한 자리다.
     */
    assert.equal(node.sortOrder, maxSortOrder + 1, "채택은 맨 뒤 번호를 받는다 — 유령의 nextSortOrder 가 이 값을 미리 쓴다");
    assert.equal(node.positionX, 0, "자리 값을 안 적는다 — 그림이 자동 배치로 세운다");
    assert.equal(node.positionY, maxPositionY + 150, "맨 아래에서 150 띄워 쌓는다(createProcedureTemplateNode 와 같은 기본)");
  });

  test("12. 🔴 낡은 토큰으로는 못 넣는다 — 다른 사람이 그 사이에 초안을 고쳤다는 뜻이다", async () => {
    const scenario = await setupFieldStepScenario("stale-token", { withEdge: false });
    const result = await adoptFieldAddedStep(scenario.draftId, superAdminId, scenario.fieldStepId, new Date(0).toISOString());
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "STALE_REVISION");
  });
});
