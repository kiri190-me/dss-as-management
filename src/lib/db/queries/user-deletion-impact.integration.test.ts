import "../../../../scripts/load-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, like, notInArray, or } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  auditLogs,
  customers,
  intakeMailRecipients,
  inventoryPartIssueApprovals,
  inventoryPartIssueRequests,
  inventoryPartRequests,
  procedureCaseExecutionHistory,
  procedureCaseExecutionNodes,
  procedureCaseExecutions,
  procedureTemplateEdges,
  procedureTemplateEditHistory,
  procedureTemplateNodes,
  procedureTemplates,
  products,
  quoteApprovals,
  quotes,
  repairCaseApprovals,
  repairCaseIntakeSequences,
  repairCases,
  shipmentApprovalDelegations,
  shipmentApprovalRouteSteps,
  shipmentApprovalRoutes,
  statusChangeHistories,
  users,
} from "../schema";
import { createRepairCase } from "../mutations/repair-cases";
import { saveShipmentApprovalRoute } from "../mutations/shipment-approval-routes";
import { createDraftProcedureTemplateFromImport, publishProcedureTemplate } from "../mutations/procedure-templates";
import { startProcedureExecution } from "../mutations/procedure-case-execution";
import { collectUserDeletionImpact, getUserDeletionPreview, type UserDeletionPreview } from "./user-deletion-impact";
import type { ShipmentApprovalRouteScope } from "@/lib/domain/shipment-approval-route";
import type { ExtractedTemplate } from "../../../../scripts/lib/xlsx/types";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 사용자 계정 삭제 — 영향 미리보기(getUserDeletionPreview) · 실제 DB (시험 DB)
 * ============================================================================
 * 삭제 확인 창이 보일 건수 · 필요한 이어받을 사람 · 멈춤 사유 · 후보가 자료와 맞는지
 * 못 박는다. 삭제 mutation 은 같은 수집 함수(collectUserDeletionImpact)를 잠그며 부를
 * 것이므로, 여기서 틀린 건수는 삭제에서도 틀린다.
 *
 * 격리 · 청소 규약은 repair-case-approvals-route.integration.test.ts 를 본떴다: 이
 * 파일이 만든 "userdelprev-test-" 계정과 "D9712" 접수 건만 쓴다. ⚠️ **판 · 단계는
 * afterEach 로 반드시 걷는다** — 시험 DB 에 판이 남으면 다른 시험 파일이 갑자기
 * 결재선을 타면서 깨진다. 결재 행 · 위임 · 부품 행은 이 파일이 **직접 넣는다**
 * (Arrange-only) — 여기서 보는 것은 세는 쪽이지 그 행들을 만드는 흐름이 아니다.
 *
 * 「마지막 대표」 시험 하나만 시험 DB 의 다른 대표를 잠시 내렸다가 finally 에서
 * 되돌린다(shipment-representatives.integration.test.ts 의 LAST_REPRESENTATIVE 시험과
 * 같은 방식).
 * ============================================================================
 */

const TEST_EMAIL_PREFIX = "userdelprev-test-";
const TEST_MODEL_PREFIX = "USERDELPREV-TEST-";
const TEST_TEMPLATE_PREFIX = "test-userdelprev-exec-";
const TEST_YEAR_MONTH = "9712";
const TEST_INTAKE_PREFIX = "D9712%";
// 🔴 quotes_quote_number_not_deleted_unique 때문에 번호가 겹치면 두 번째 실행이 깨진다 —
// 접두어로 이 파일의 장만 골라 걷고, 뒤에는 행마다 다른 값을 붙인다.
const TEST_QUOTE_NUMBER_PREFIX = "UDPREV-TEST-";
const TEST_QUOTE_DATE = "2097-12-10";
const TEST_RECEIVED_AT = "2097-12-10";
const TEST_SHIPMENT_DATE = "2097-12-20";

let customerId: string;
let superAdminId: string; // 미리보기를 여는 사람 · 판을 저장하는 사람
let engineerId: string; // 접수 건의 기본 담당 · 결재 사슬의 요청자

const createdTestUserIds: string[] = [];
const createdTemplateIds: string[] = [];

type OkPreview = Extract<UserDeletionPreview, { ok: true }>;

async function createTestUser(name: string, overrides: Partial<typeof users.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      email: `${TEST_EMAIL_PREFIX}${randomUUID().slice(0, 8)}@example.test`,
      name,
      role: "AS_ENGINEER",
      approvalStatus: "APPROVED",
      isActive: true,
      isDeveloper: false,
      ...overrides,
    })
    .returning({ id: users.id });
  createdTestUserIds.push(row.id);
  return row.id;
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

async function createTestCase(
  overrides: Partial<ValidatedCreateRepairCaseInput> = {}
): Promise<{ id: string; intakeNumber: string }> {
  const created = await createRepairCase(baseCreateInput(overrides));
  assert.equal(created.ok, true, `setup create failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  const [row] = await db
    .select({ intakeNumber: repairCases.intakeNumber })
    .from(repairCases)
    .where(eq(repairCases.id, created.id));
  return { id: created.id, intakeNumber: row.intakeNumber };
}

/** 판을 진짜 저장 경로로 얹고 그 용도의 지금 판 id 를 돌려준다. */
async function saveRoute(scope: ShipmentApprovalRouteScope, approverUserIds: string[]): Promise<string> {
  const result = await saveShipmentApprovalRoute(approverUserIds, superAdminId, scope);
  assert.equal(result.ok, true, `setup route save failed: ${JSON.stringify(result)}`);
  const [route] = await db
    .select({ id: shipmentApprovalRoutes.id })
    .from(shipmentApprovalRoutes)
    .where(eq(shipmentApprovalRoutes.scope, scope))
    .orderBy(desc(shipmentApprovalRoutes.version))
    .limit(1);
  assert.ok(route, "저장했는데 현재 판이 없다");
  return route.id;
}

/** Arrange-only: 접수 건 결재 행 하나를 직접 넣는다. */
async function insertCaseApproval(params: {
  repairCaseId: string;
  approvalType?: "FINAL_SHIPMENT" | "REPAIR_INSPECTION";
  assignedApproverUserId: string | null;
  routeId: string | null;
  routeStepOrder: number | null;
  requestedByUserId?: string;
  decidedByUserId?: string;
}): Promise<string> {
  const decided = params.decidedByUserId !== undefined;
  const [row] = await db
    .insert(repairCaseApprovals)
    .values({
      repairCaseId: params.repairCaseId,
      approvalType: params.approvalType ?? "FINAL_SHIPMENT",
      status: decided ? "APPROVED" : "REQUESTED",
      requestedByUserId: params.requestedByUserId ?? engineerId,
      assignedApproverUserId: params.assignedApproverUserId,
      routeId: params.routeId,
      routeStepOrder: params.routeStepOrder,
      decidedByUserId: params.decidedByUserId ?? null,
      decidedAt: decided ? new Date() : null,
      repairCaseVersionAtRequest: 1,
    })
    .returning({ id: repairCaseApprovals.id });
  return row.id;
}

/** Arrange-only: 직접 사용 불출 신청 하나(사용처만 적는다). */
async function insertPartIssueRequest(params: {
  requestedByUserId?: string;
  status?: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "CANCELLED";
}): Promise<string> {
  const [row] = await db
    .insert(inventoryPartIssueRequests)
    .values({
      status: params.status ?? "PENDING_APPROVAL",
      requestedByUserId: params.requestedByUserId ?? engineerId,
      destinationNote: "계정 삭제 미리보기 시험",
    })
    .returning({ id: inventoryPartIssueRequests.id });
  return row.id;
}

/** Arrange-only: 불출 신청의 단계 결재 행 하나. */
async function insertPartIssueApproval(params: {
  issueRequestId: string;
  routeId: string;
  routeStepOrder: number;
  assignedApproverUserId: string;
  requestedByUserId?: string;
}): Promise<void> {
  await db.insert(inventoryPartIssueApprovals).values({
    issueRequestId: params.issueRequestId,
    status: "REQUESTED",
    routeId: params.routeId,
    routeStepOrder: params.routeStepOrder,
    assignedApproverUserId: params.assignedApproverUserId,
    requestedByUserId: params.requestedByUserId ?? engineerId,
  });
}

/** Arrange-only: 견적서 한 장. 필수 칸 넷만 채운다(수리 건 · 고객사 없이도 만든다). */
async function insertQuote(): Promise<{ id: string; quoteNumber: string }> {
  const quoteNumber = `${TEST_QUOTE_NUMBER_PREFIX}${randomUUID().slice(0, 8)}`;
  const [row] = await db
    .insert(quotes)
    .values({
      quoteNumber,
      quoteDate: TEST_QUOTE_DATE,
      customerNameText: "미리보기 시험 공급처",
      subject: "계정 삭제 미리보기 시험 견적",
    })
    .returning({ id: quotes.id });
  return { id: row.id, quoteNumber };
}

/** Arrange-only: 견적서 결재 행 하나. */
async function insertQuoteApproval(params: {
  quoteId: string;
  assignedApproverUserId: string | null;
  routeId: string | null;
  routeStepOrder: number | null;
  requestedByUserId?: string;
}): Promise<string> {
  const [row] = await db
    .insert(quoteApprovals)
    .values({
      quoteId: params.quoteId,
      status: "REQUESTED",
      requestedByUserId: params.requestedByUserId ?? engineerId,
      assignedApproverUserId: params.assignedApproverUserId,
      routeId: params.routeId,
      routeStepOrder: params.routeStepOrder,
      quoteVersionAtRequest: 1,
    })
    .returning({ id: quoteApprovals.id });
  return row.id;
}

async function preview(targetUserId: string, actorUserId: string = superAdminId): Promise<OkPreview> {
  const result = await getUserDeletionPreview(targetUserId, actorUserId);
  assert.equal(result.ok, true, `preview failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

/** 최소 단일 작업 절차를 발행해 그 접수 건에서 실행을 시작하고, 실행 노드 id 를 돌려준다. */
async function startExecutionFixture(repairCaseId: string): Promise<{ taskNodeId: string; endNodeId: string }> {
  const code = `${TEST_TEMPLATE_PREFIX}${randomUUID().slice(0, 8)}`;
  const sheet = "(TEST) 계정 삭제 미리보기 시트";
  const template: ExtractedTemplate = {
    code,
    name: `계정 삭제 미리보기용 ${code}`,
    equipmentType: "RFG",
    description: "user deletion preview integration test fixture",
    sourceWorksheets: [sheet],
    category: "FULL_SERVICE",
    isReferenceOnly: false,
    referenceItems: [],
    nodes: [
      { nodeCode: "n1", nodeType: "START", title: "시작", positionX: 0, positionY: 0, sortOrder: 0, sourceWorksheet: sheet, sourceShapeId: "1" },
      { nodeCode: "n2", nodeType: "TASK", title: "작업", positionX: 100, positionY: 0, sortOrder: 1, sourceWorksheet: sheet, sourceShapeId: "2" },
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

  const draft = await createDraftProcedureTemplateFromImport(template, superAdminId, {
    sourceFileName: "user-deletion-preview-fixture.xlsx",
    sourceFileHash: `hash-${code}`,
  });
  assert.equal(draft.ok, true, `fixture template import failed: ${JSON.stringify(draft)}`);
  if (!draft.ok) throw new Error("unreachable");
  createdTemplateIds.push(draft.id);

  const published = await publishProcedureTemplate(draft.id, superAdminId);
  assert.equal(published.ok, true, `fixture publish failed: ${JSON.stringify(published)}`);

  const started = await startProcedureExecution(repairCaseId, draft.id, superAdminId);
  assert.equal(started.ok, true, `fixture execution start failed: ${JSON.stringify(started)}`);
  if (!started.ok) throw new Error("unreachable");

  const templateNodes = await db
    .select({ id: procedureTemplateNodes.id, nodeCode: procedureTemplateNodes.nodeCode })
    .from(procedureTemplateNodes)
    .where(eq(procedureTemplateNodes.procedureTemplateId, draft.id));
  const nodeIdFor = async (nodeCode: string): Promise<string> => {
    const templateNode = templateNodes.find((node) => node.nodeCode === nodeCode);
    assert.ok(templateNode, `template node ${nodeCode} missing`);
    const [executionNode] = await db
      .select({ id: procedureCaseExecutionNodes.id })
      .from(procedureCaseExecutionNodes)
      .where(
        and(
          eq(procedureCaseExecutionNodes.executionId, started.executionId),
          eq(procedureCaseExecutionNodes.procedureTemplateNodeId, templateNode.id)
        )
      );
    assert.ok(executionNode, `execution node ${nodeCode} missing`);
    return executionNode.id;
  };
  return { taskNodeId: await nodeIdFor("n2"), endNodeId: await nodeIdFor("n3") };
}

/**
 * 한 시험이 남긴 결재 행 · 판 · 부품 행 · 위임 · 수신자 · 대표 표시를 걷는다. 접수 건 ·
 * 절차 · 사람은 after() 가 마지막에 지운다. 사람 참조가 RESTRICT 라 순서가 있다
 * (불출 결재 → 불출 신청, 접수 건 결재 → 단계 → 판).
 */
async function removePerTestFixtures(userIds: readonly string[]): Promise<void> {
  if (userIds.length === 0) return;
  const ids = [...userIds];

  const issueRequestIds = (
    await db
      .select({ id: inventoryPartIssueRequests.id })
      .from(inventoryPartIssueRequests)
      .where(inArray(inventoryPartIssueRequests.requestedByUserId, ids))
  ).map((row) => row.id);
  if (issueRequestIds.length > 0) {
    await db.delete(inventoryPartIssueApprovals).where(inArray(inventoryPartIssueApprovals.issueRequestId, issueRequestIds));
    await db.delete(inventoryPartIssueRequests).where(inArray(inventoryPartIssueRequests.id, issueRequestIds));
  }
  await db.delete(inventoryPartRequests).where(inArray(inventoryPartRequests.requestedByUserId, ids));

  const caseIds = (
    await db.select({ id: repairCases.id }).from(repairCases).where(like(repairCases.intakeNumber, TEST_INTAKE_PREFIX))
  ).map((row) => row.id);
  if (caseIds.length > 0) {
    await db.delete(repairCaseApprovals).where(inArray(repairCaseApprovals.repairCaseId, caseIds));
  }
  await db.delete(repairCaseApprovals).where(inArray(repairCaseApprovals.requestedByUserId, ids));

  // 견적서 결재 → 견적서 순서다(quote_approvals.quote_id 는 SET NULL 이지만, 사람 ·
  // 판 참조가 RESTRICT 라 이 행이 남으면 아래 판 · 사람 삭제가 막힌다).
  const quoteIds = (
    await db.select({ id: quotes.id }).from(quotes).where(like(quotes.quoteNumber, `${TEST_QUOTE_NUMBER_PREFIX}%`))
  ).map((row) => row.id);
  if (quoteIds.length > 0) {
    await db.delete(quoteApprovals).where(inArray(quoteApprovals.quoteId, quoteIds));
  }
  await db.delete(quoteApprovals).where(inArray(quoteApprovals.requestedByUserId, ids));
  if (quoteIds.length > 0) {
    await db.delete(quotes).where(inArray(quotes.id, quoteIds));
  }

  const routeIds = (
    await db
      .select({ id: shipmentApprovalRoutes.id })
      .from(shipmentApprovalRoutes)
      .where(inArray(shipmentApprovalRoutes.createdByUserId, ids))
  ).map((row) => row.id);
  if (routeIds.length > 0) {
    await db.delete(shipmentApprovalRouteSteps).where(inArray(shipmentApprovalRouteSteps.routeId, routeIds));
    await db.delete(shipmentApprovalRoutes).where(inArray(shipmentApprovalRoutes.id, routeIds));
  }

  await db
    .delete(shipmentApprovalDelegations)
    .where(
      or(
        inArray(shipmentApprovalDelegations.representativeUserId, ids),
        inArray(shipmentApprovalDelegations.delegateUserId, ids)
      )
    );
  await db.delete(intakeMailRecipients).where(inArray(intakeMailRecipients.userId, ids));
  await db.update(users).set({ isShipmentRepresentative: false }).where(inArray(users.id, ids));
}

/** 이 파일의 접수 건 · 절차 · 제품 · 번호 · 감사 기록 · 사람을 모두 걷는다(이전 실행의 흔적 포함). */
async function removeEverything(userIds: readonly string[]): Promise<void> {
  await removePerTestFixtures(userIds);

  const caseIds = (
    await db.select({ id: repairCases.id }).from(repairCases).where(like(repairCases.intakeNumber, TEST_INTAKE_PREFIX))
  ).map((row) => row.id);
  if (caseIds.length > 0) {
    const executionIds = (
      await db
        .select({ id: procedureCaseExecutions.id })
        .from(procedureCaseExecutions)
        .where(inArray(procedureCaseExecutions.repairCaseId, caseIds))
    ).map((row) => row.id);
    if (executionIds.length > 0) {
      await db.delete(procedureCaseExecutionHistory).where(inArray(procedureCaseExecutionHistory.executionId, executionIds));
      await db.delete(procedureCaseExecutionNodes).where(inArray(procedureCaseExecutionNodes.executionId, executionIds));
      await db.delete(procedureCaseExecutions).where(inArray(procedureCaseExecutions.id, executionIds));
    }
    await db.delete(statusChangeHistories).where(inArray(statusChangeHistories.repairCaseId, caseIds));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, TEST_INTAKE_PREFIX));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));

  const templateIds = [
    ...new Set([
      ...createdTemplateIds,
      ...(
        await db
          .select({ id: procedureTemplates.id })
          .from(procedureTemplates)
          .where(like(procedureTemplates.code, `${TEST_TEMPLATE_PREFIX}%`))
      ).map((row) => row.id),
    ]),
  ];
  if (templateIds.length > 0) {
    await db.delete(procedureTemplateEditHistory).where(inArray(procedureTemplateEditHistory.procedureTemplateId, templateIds));
    await db.delete(procedureTemplateEdges).where(inArray(procedureTemplateEdges.procedureTemplateId, templateIds));
    await db.delete(procedureTemplateNodes).where(inArray(procedureTemplateNodes.procedureTemplateId, templateIds));
    await db.delete(procedureTemplates).where(inArray(procedureTemplates.id, templateIds));
  }

  if (userIds.length > 0) {
    // audit_logs.actor_user_id → users (restrict): 행위자로만 고른다 —
    // target_record_id 로 고르는 모양은 test-cleanup-static-safety.test.ts 가 금지한다.
    await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, [...userIds]));
    await db.delete(users).where(inArray(users.id, [...userIds]));
  }
}

before(async () => {
  const leftovers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  await removeEverything(leftovers.map((row) => row.id));

  const [route] = await db.select({ id: shipmentApprovalRoutes.id }).from(shipmentApprovalRoutes).limit(1);
  assert.equal(route, undefined, "이 시험은 shipment_approval_routes 가 비어 있는 상태를 전제로 합니다");

  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.isDeleted, false))
    .limit(1);
  assert.ok(customer, "expected at least one non-deleted customer in the test DB");
  customerId = customer.id;

  superAdminId = await createTestUser("미리보기 최고관리자", { role: "SUPER_ADMIN" });
  engineerId = await createTestUser("미리보기 요청 엔지니어");
});

afterEach(async () => {
  // ⚠️ 판이 남으면 다른 시험 파일이 결재선을 타면서 깨지고, 이 파일의 다음 시험도 판
  // 번호가 1부터 시작한다는 전제를 잃는다.
  await removePerTestFixtures(createdTestUserIds);
});

after(async () => {
  await removeEverything(createdTestUserIds);
  await pgClient.end({ timeout: 5 });
});

describe("권한 · 대상", () => {
  test("진짜 최고관리자가 아니면 FORBIDDEN — 관리자 · 개발자 승격 · 승인 대기 · 삭제된 최고관리자", async () => {
    const target = await createTestUser("권한 대상");
    const admin = await createTestUser("권한 관리자", { role: "ADMIN" });
    const developerEngineer = await createTestUser("권한 개발자 엔지니어", { isDeveloper: true });
    const pendingSuperAdmin = await createTestUser("권한 승인 대기 최고관리자", {
      role: "SUPER_ADMIN",
      approvalStatus: "PENDING",
    });
    const deletedSuperAdmin = await createTestUser("권한 삭제된 최고관리자", {
      role: "SUPER_ADMIN",
      isDeleted: true,
      deletedAt: new Date(),
    });

    for (const actorId of [admin, developerEngineer, pendingSuperAdmin, deletedSuperAdmin, "u-001"]) {
      const result = await getUserDeletionPreview(target, actorId);
      assert.equal(result.ok, false, actorId);
      if (result.ok) continue;
      assert.equal(result.code, "FORBIDDEN", actorId);
      // 권한이 없는 사람에게는 건수를 한 줄도 싣지 않는다.
      assert.deepEqual(Object.keys(result).sort(), ["code", "message", "ok"]);
    }

    // 개발자 표시가 켜진 **진짜** 최고관리자는 연다 — 판정은 역할만 본다.
    const developerSuperAdmin = await createTestUser("권한 개발자 최고관리자", {
      role: "SUPER_ADMIN",
      isDeveloper: true,
    });
    await preview(target, developerSuperAdmin);
  });

  test("권한이 없으면 대상이 없어도 NOT_FOUND 가 아니라 FORBIDDEN 이다", async () => {
    const admin = await createTestUser("권한 순서 관리자", { role: "ADMIN" });
    const result = await getUserDeletionPreview(randomUUID(), admin);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("자기 자신은 SELF_DELETE_FORBIDDEN — 대문자로 보내도 같다", async () => {
    for (const targetId of [superAdminId, superAdminId.toUpperCase()]) {
      const result = await getUserDeletionPreview(targetId, superAdminId);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "SELF_DELETE_FORBIDDEN");
    }
  });

  test("없는 대상 · 삭제된 대상 · 형식이 아닌 id 는 NOT_FOUND", async () => {
    const deletedTarget = await createTestUser("삭제된 대상", { isDeleted: true, deletedAt: new Date() });
    for (const targetId of [randomUUID(), deletedTarget, "u-001"]) {
      const result = await getUserDeletionPreview(targetId, superAdminId);
      assert.equal(result.ok, false, targetId);
      if (!result.ok) assert.equal(result.code, "NOT_FOUND", targetId);
    }
  });
});

describe("건수 · 필요한 이어받을 사람", () => {
  test("걸린 것이 없으면 전부 0 이고 이어받을 사람이 필요 없다 — 이메일은 싣지 않는다", async () => {
    const target = await createTestUser("빈 대상", { ssoSubject: `userdelprev-sso-${randomUUID()}` });
    const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, target));

    const result = await preview(target);
    assert.deepEqual(result.target, {
      id: target,
      name: "빈 대상",
      role: "AS_ENGINEER",
      version: 1,
      isShipmentRepresentative: false,
      isDeveloper: false,
      isSsoManaged: true,
    });
    assert.deepEqual(result.impact, {
      routeSlots: [],
      pendingApprovals: { finalShipment: 0, repairInspection: 0, partIssue: 0, quote: 0 },
      chainsToRepin: 0,
      isRepresentative: false,
      isLastRepresentative: false,
      activeDelegations: { asRepresentative: 0, asDelegate: 0 },
      openAssignedCases: 0,
      untouchedAssignedCases: 0,
      openClaimedNodes: 0,
      ownOpenPartRequests: 0,
      ownOpenPartIssueRequests: 0,
      isDeveloper: false,
      isIntakeMailRecipient: false,
    });
    assert.deepEqual(result.requires, {
      approvalSuccessor: false,
      engineerSuccessor: false,
      approvalSuccessorMustInspect: false,
    });
    assert.deepEqual(result.blockers, []);
    assert.ok(!JSON.stringify(result).includes(row.email), "미리보기에 이메일이 실렸다");
    assert.ok(!JSON.stringify(result).includes("userdelprev-sso-"), "미리보기에 sso_subject 가 실렸다");
  });

  test("결재선 자리 — 두 용도의 현재 판, 후보에서 판 사람 · 자격 미달 · 자기 자신을 뺀다", async () => {
    const target = await createTestUser("결재선 대상");
    const stepA = await createTestUser("결재선 1단계");
    const stepB = await createTestUser("결재선 3단계");
    const eligible = await createTestUser("결재선 후보 관리자", { role: "ADMIN" });
    const locked = await createTestUser("결재선 잠긴 사람", { lockedAt: new Date() });
    const inactive = await createTestUser("결재선 비활성", { isActive: false });
    const pending = await createTestUser("결재선 승인 대기", { approvalStatus: "PENDING" });
    const deleted = await createTestUser("결재선 삭제됨", { isDeleted: true, deletedAt: new Date() });

    await saveRoute("FINAL_SHIPMENT", [stepA, target, stepB]);
    await saveRoute("PART_ISSUE", [target]);

    const result = await preview(target);
    assert.deepEqual(result.impact.routeSlots, [
      { scope: "FINAL_SHIPMENT", routeVersion: 1, stepOrder: 2 },
      { scope: "PART_ISSUE", routeVersion: 1, stepOrder: 1 },
    ]);
    assert.deepEqual(result.requires, {
      approvalSuccessor: true,
      engineerSuccessor: false,
      approvalSuccessorMustInspect: false,
    });
    assert.deepEqual(result.blockers, []);

    const candidateIds = new Set(result.candidates.approvalSuccessors.map((candidate) => candidate.id));
    assert.ok(candidateIds.has(eligible), "자격을 갖춘 사람이 후보에 없다");
    for (const [label, id] of [
      ["자기 자신", target],
      ["판의 1단계", stepA],
      ["판의 3단계", stepB],
      ["잠긴 사람", locked],
      ["비활성", inactive],
      ["승인 대기", pending],
      ["삭제됨", deleted],
    ] as const) {
      assert.ok(!candidateIds.has(id), `${label}이(가) 결재 후보에 있다`);
    }
  });

  test("옛 판에만 있고 진행 중 결재가 없으면 자리가 아니다", async () => {
    const target = await createTestUser("옛 판 대상");
    const stepA = await createTestUser("옛 판 새 1단계");
    await saveRoute("FINAL_SHIPMENT", [target]);
    await saveRoute("FINAL_SHIPMENT", [stepA]);

    const result = await preview(target);
    assert.deepEqual(result.impact.routeSlots, []);
    assert.equal(result.requires.approvalSuccessor, false);
    assert.deepEqual(result.blockers, []);
  });

  test("대기 결재 넷 · 옮길 사슬 — 결정된 행과 끝난 신청은 세지 않는다, 사슬 요청자 · 검수 자격 미달은 후보가 아니다", async () => {
    const target = await createTestUser("대기 결재 대상");
    const stepA = await createTestUser("대기 결재 1단계");
    const inventoryManager = await createTestUser("대기 결재 재고 담당", { role: "INVENTORY_MANAGER" });
    const admin = await createTestUser("대기 결재 관리자", { role: "ADMIN" });

    const shipmentRoute = await saveRoute("FINAL_SHIPMENT", [stepA, target]);
    const partIssueRoute = await saveRoute("PART_ISSUE", [target, stepA]);
    const quoteRoute = await saveRoute("QUOTE", [target, stepA]);

    // 출하: 현재 판 2단계가 대상에게 열려 있다 → 넘김.
    const assignedCase = await createTestCase();
    await insertCaseApproval({
      repairCaseId: assignedCase.id,
      assignedApproverUserId: target,
      routeId: shipmentRoute,
      routeStepOrder: 2,
    });
    // 출하: 1단계가 열려 있고 대상은 뒤 단계 → 새 판으로 옮김.
    const aheadCase = await createTestCase();
    await insertCaseApproval({
      repairCaseId: aheadCase.id,
      assignedApproverUserId: stepA,
      routeId: shipmentRoute,
      routeStepOrder: 1,
    });
    // 수리 검수 수동 지정.
    const inspectionCase = await createTestCase();
    await insertCaseApproval({
      repairCaseId: inspectionCase.id,
      approvalType: "REPAIR_INSPECTION",
      assignedApproverUserId: target,
      routeId: null,
      routeStepOrder: null,
    });
    // 이미 결정된 행은 세지 않는다.
    const decidedCase = await createTestCase();
    await insertCaseApproval({
      repairCaseId: decidedCase.id,
      assignedApproverUserId: target,
      routeId: shipmentRoute,
      routeStepOrder: 2,
      decidedByUserId: target,
    });
    // 불출: 1단계가 대상에게 열려 있다 → 넘김.
    const openIssue = await insertPartIssueRequest({});
    await insertPartIssueApproval({
      issueRequestId: openIssue,
      routeId: partIssueRoute,
      routeStepOrder: 1,
      assignedApproverUserId: target,
    });
    // 불출: 신청이 이미 끝났으면 결재 행이 열려 있어도 넘길 것이 없다.
    const cancelledIssue = await insertPartIssueRequest({ status: "CANCELLED" });
    await insertPartIssueApproval({
      issueRequestId: cancelledIssue,
      routeId: partIssueRoute,
      routeStepOrder: 1,
      assignedApproverUserId: target,
    });
    // 🔴 견적서: 1단계가 대상에게 열려 있다 → 넘김. 예전에는 이 행이 수집 단계부터
    // 빠져 있어 건수도 0, 이어받을 사람도 요구되지 않았다.
    const openQuote = await insertQuote();
    await insertQuoteApproval({
      quoteId: openQuote.id,
      routeId: quoteRoute,
      routeStepOrder: 1,
      assignedApproverUserId: target,
    });
    // 이미 결정된 견적서 결재는 세지 않는다.
    const decidedQuote = await insertQuote();
    await db.insert(quoteApprovals).values({
      quoteId: decidedQuote.id,
      status: "APPROVED",
      requestedByUserId: engineerId,
      assignedApproverUserId: target,
      routeId: quoteRoute,
      routeStepOrder: 1,
      decidedByUserId: target,
      decidedAt: new Date(),
      quoteVersionAtRequest: 1,
    });

    const result = await preview(target);
    assert.deepEqual(result.impact.pendingApprovals, {
      finalShipment: 1,
      repairInspection: 1,
      partIssue: 1,
      quote: 1,
    });
    assert.equal(result.impact.chainsToRepin, 1);
    assert.deepEqual(result.requires, {
      approvalSuccessor: true,
      engineerSuccessor: false,
      approvalSuccessorMustInspect: true,
    });
    assert.deepEqual(result.blockers, []);

    const candidateIds = new Set(result.candidates.approvalSuccessors.map((candidate) => candidate.id));
    assert.ok(candidateIds.has(admin), "검수 자격이 있는 관리자가 후보에 없다");
    assert.ok(!candidateIds.has(engineerId), "사슬 요청자가 결재 후보에 있다");
    assert.ok(!candidateIds.has(stepA), "판에 있는 사람이 결재 후보에 있다");
    assert.ok(!candidateIds.has(inventoryManager), "검수 역할이 없는 사람이 결재 후보에 있다(검수 지정을 넘겨받는다)");
  });

  test("옛 판을 따라가는 진행 중 결재에 대상이 뒤 단계로 남으면 blockers — 접수번호 · 불출 신청 식별자를 싣는다", async () => {
    const target = await createTestUser("옛 판 사슬 대상");
    const stepA = await createTestUser("옛 판 사슬 1단계");
    const stepB = await createTestUser("옛 판 사슬 새 2단계");

    const oldShipmentRoute = await saveRoute("FINAL_SHIPMENT", [stepA, target]);
    const oldPartIssueRoute = await saveRoute("PART_ISSUE", [stepA, target]);

    const oldCase = await createTestCase();
    await insertCaseApproval({
      repairCaseId: oldCase.id,
      assignedApproverUserId: stepA,
      routeId: oldShipmentRoute,
      routeStepOrder: 1,
    });
    const oldIssue = await insertPartIssueRequest({});
    await insertPartIssueApproval({
      issueRequestId: oldIssue,
      routeId: oldPartIssueRoute,
      routeStepOrder: 1,
      assignedApproverUserId: stepA,
    });
    // 대상이 **요청한** 옛 판 사슬은 대상의 단계를 건너뛰므로 막지 않는다.
    const ownCase = await createTestCase();
    await insertCaseApproval({
      repairCaseId: ownCase.id,
      assignedApproverUserId: stepA,
      routeId: oldShipmentRoute,
      routeStepOrder: 1,
      requestedByUserId: target,
    });

    // 관리자가 두 절차를 바꿨다 — 대상은 현재 판에 없다.
    await saveRoute("FINAL_SHIPMENT", [stepA, stepB]);
    await saveRoute("PART_ISSUE", [stepA]);

    const result = await preview(target);
    assert.deepEqual(result.impact.routeSlots, []);
    assert.equal(result.impact.chainsToRepin, 0);
    assert.equal(result.blockers.length, 2, JSON.stringify(result.blockers));

    const shipmentBlock = result.blockers.find(
      (blocker) => blocker.code === "IN_FLIGHT_ON_OLD_ROUTE" && blocker.kind === "FINAL_SHIPMENT"
    );
    assert.ok(shipmentBlock && shipmentBlock.code === "IN_FLIGHT_ON_OLD_ROUTE");
    assert.equal(shipmentBlock.intakeNumber, oldCase.intakeNumber);
    assert.ok(shipmentBlock.label.includes(oldCase.intakeNumber));
    assert.ok(shipmentBlock.message.includes(oldCase.intakeNumber), "사람이 알아볼 접수번호가 사유에 없다");

    const partIssueBlock = result.blockers.find(
      (blocker) => blocker.code === "IN_FLIGHT_ON_OLD_ROUTE" && blocker.kind === "PART_ISSUE"
    );
    assert.ok(partIssueBlock && partIssueBlock.code === "IN_FLIGHT_ON_OLD_ROUTE");
    assert.equal(partIssueBlock.issueRequestId, oldIssue);
    assert.ok(partIssueBlock.label.includes(oldIssue.slice(0, 8)), "불출 신청 식별자가 이름에 없다");
    assert.ok(partIssueBlock.message.includes(oldIssue.slice(0, 8)));
  });

  test("🔴 견적서 결재만 걸린 사람도 이어받을 사람이 필요하다 — 결재선 없이 지정만 된 행", async () => {
    // 이 사람에게는 결재선 자리도 · 대표도 · 담당 건도 없다. 걸린 것은 견적서 결재 한
    // 건뿐이다. 예전에는 그 한 건이 수집에서 빠지고 합계에서도 빠져 **이어받을 사람
    // 없이 삭제**됐고, 그 결재는 죽은 사람에게 남았다.
    const target = await createTestUser("견적서 전용 대상");
    const quote = await insertQuote();
    await insertQuoteApproval({
      quoteId: quote.id,
      assignedApproverUserId: target,
      routeId: null,
      routeStepOrder: null,
    });

    const result = await preview(target);
    assert.deepEqual(result.impact.routeSlots, []);
    assert.deepEqual(result.impact.pendingApprovals, {
      finalShipment: 0,
      repairInspection: 0,
      partIssue: 0,
      quote: 1,
    });
    assert.deepEqual(result.requires, {
      approvalSuccessor: true,
      engineerSuccessor: false,
      approvalSuccessorMustInspect: false,
    });
    assert.deepEqual(result.blockers, []);
  });

  test("🔴 견적서 사슬 — 대상이 현재 판의 뒤 단계면 옮길 사슬로 센다", async () => {
    const target = await createTestUser("견적서 REPIN 대상");
    const stepA = await createTestUser("견적서 REPIN 1단계");
    const quoteRoute = await saveRoute("QUOTE", [stepA, target]);

    const quote = await insertQuote();
    await insertQuoteApproval({
      quoteId: quote.id,
      assignedApproverUserId: stepA,
      routeId: quoteRoute,
      routeStepOrder: 1,
    });

    const result = await preview(target);
    assert.deepEqual(result.impact.routeSlots, [{ scope: "QUOTE", routeVersion: 1, stepOrder: 2 }]);
    // 지정은 A 에게 있으므로 대기 결재는 0 이고, 옮길 사슬이 1 이다.
    assert.equal(result.impact.pendingApprovals.quote, 0);
    assert.equal(result.impact.chainsToRepin, 1);
    assert.equal(result.requires.approvalSuccessor, true);
    assert.deepEqual(result.blockers, []);
    // 사슬 요청자는 결재 이어받을 후보가 아니다 — 그 판정이 견적서에도 닿는다.
    const candidateIds = new Set(result.candidates.approvalSuccessors.map((candidate) => candidate.id));
    assert.ok(!candidateIds.has(engineerId), "견적서 사슬의 요청자가 결재 후보에 있다");
    assert.ok(!candidateIds.has(stepA), "같은 판의 사람이 결재 후보에 있다");
  });

  test("🔴 견적서 사슬이 옛 판을 따라가면 blockers — 이름에 견적서번호를 싣는다", async () => {
    const target = await createTestUser("견적서 STOP 대상");
    const stepA = await createTestUser("견적서 STOP 1단계");
    const stepB = await createTestUser("견적서 STOP 새 2단계");

    const oldQuoteRoute = await saveRoute("QUOTE", [stepA, target]);
    const quote = await insertQuote();
    await insertQuoteApproval({
      quoteId: quote.id,
      assignedApproverUserId: stepA,
      routeId: oldQuoteRoute,
      routeStepOrder: 1,
    });
    // 관리자가 견적서 절차를 바꿨다 — 대상은 현재 판에 없다.
    await saveRoute("QUOTE", [stepA, stepB]);

    const result = await preview(target);
    assert.deepEqual(result.impact.routeSlots, []);
    assert.equal(result.impact.chainsToRepin, 0);
    assert.equal(result.blockers.length, 1, JSON.stringify(result.blockers));

    const blocker = result.blockers[0];
    assert.ok(blocker.code === "IN_FLIGHT_ON_OLD_ROUTE");
    assert.equal(blocker.kind, "QUOTE");
    assert.equal(blocker.label, `${quote.quoteNumber} 견적서 승인`);
    assert.ok(blocker.message.includes(quote.quoteNumber), "사람이 알아볼 견적서번호가 사유에 없다");
  });

  test("새 판이 거절할 사람이 같은 판의 다른 단계에 있으면 ROUTE_UPDATE_REJECTED", async () => {
    const target = await createTestUser("거절 판 대상");
    const stepA = await createTestUser("거절 판 1단계");
    await saveRoute("FINAL_SHIPMENT", [stepA, target]);
    // 저장 뒤에 잠긴다(저장은 잠긴 사람을 받지 않는다).
    await db.update(users).set({ lockedAt: new Date() }).where(eq(users.id, stepA));

    const result = await preview(target);
    assert.deepEqual(
      result.blockers.map((blocker) => blocker.code === "ROUTE_UPDATE_REJECTED" && [blocker.scope, blocker.stepOrder, blocker.approverName]),
      [["FINAL_SHIPMENT", 1, "거절 판 1단계"]]
    );
    assert.ok(result.blockers[0].message.includes("잠긴 계정입니다"));
  });

  test("대표 — 다른 활성 대표가 있으면 마지막이 아니고 이어받을 사람도 필요 없다", async () => {
    const target = await createTestUser("대표 대상", { isShipmentRepresentative: true });
    await createTestUser("다른 대표", { isShipmentRepresentative: true });

    const result = await preview(target);
    assert.equal(result.impact.isRepresentative, true);
    assert.equal(result.impact.isLastRepresentative, false);
    assert.equal(result.requires.approvalSuccessor, false);
  });

  test("대표 — 마지막 활성 대표면 결재 이어받을 사람이 필요하다(비활성 대표는 세지 않는다)", async () => {
    const target = await createTestUser("마지막 대표 대상", { isShipmentRepresentative: true });
    await createTestUser("비활성 대표", { isShipmentRepresentative: true, isActive: false });

    // Arrange-only: 시험 DB 의 다른 활성 대표를 잠시 내린다 — finally 에서 되돌린다.
    const otherRepresentatives = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.isShipmentRepresentative, true),
          eq(users.isDeleted, false),
          eq(users.isActive, true),
          notInArray(users.id, createdTestUserIds)
        )
      );
    const otherIds = otherRepresentatives.map((row) => row.id);
    if (otherIds.length > 0) {
      await db.update(users).set({ isShipmentRepresentative: false }).where(inArray(users.id, otherIds));
    }
    try {
      const result = await preview(target);
      assert.equal(result.impact.isRepresentative, true);
      assert.equal(result.impact.isLastRepresentative, true);
      assert.deepEqual(result.requires, {
        approvalSuccessor: true,
        engineerSuccessor: false,
        approvalSuccessorMustInspect: false,
      });
    } finally {
      if (otherIds.length > 0) {
        await db.update(users).set({ isShipmentRepresentative: true }).where(inArray(users.id, otherIds));
      }
    }
  });

  test("위임 — 대표로서 · 위임받은 사람으로서 ACTIVE 인 것만 센다(미래 기간 포함, 철회된 것 제외)", async () => {
    const target = await createTestUser("위임 대상", { isShipmentRepresentative: true });
    await createTestUser("위임 다른 대표", { isShipmentRepresentative: true });
    const delegate = await createTestUser("위임 대리인");
    const otherRepresentative = await createTestUser("위임을 준 대표", { isShipmentRepresentative: true });

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    await db.insert(shipmentApprovalDelegations).values([
      {
        representativeUserId: target,
        delegateUserId: delegate,
        startsAt: new Date(now - day),
        endsAt: new Date(now + day),
        status: "ACTIVE",
        assignedByUserId: superAdminId,
      },
      {
        representativeUserId: target,
        delegateUserId: delegate,
        startsAt: new Date(now + 10 * day),
        endsAt: new Date(now + 20 * day),
        status: "ACTIVE",
        assignedByUserId: superAdminId,
      },
      {
        representativeUserId: target,
        delegateUserId: delegate,
        startsAt: new Date(now - 5 * day),
        endsAt: new Date(now - 4 * day),
        status: "REVOKED",
        assignedByUserId: superAdminId,
        revokedByUserId: superAdminId,
        revokedAt: new Date(now - 4 * day),
      },
      {
        representativeUserId: otherRepresentative,
        delegateUserId: target,
        startsAt: new Date(now - day),
        endsAt: new Date(now + day),
        status: "ACTIVE",
        assignedByUserId: superAdminId,
      },
    ]);

    const result = await preview(target);
    assert.deepEqual(result.impact.activeDelegations, { asRepresentative: 2, asDelegate: 1 });
  });

  test("담당 건 · 절차 노드 — 열린 건만 넘기고, 잠긴 · 휴지통 건은 그대로, 끝난 노드는 세지 않는다", async () => {
    const target = await createTestUser("담당 대상");
    const lockedEngineer = await createTestUser("담당 잠긴 엔지니어", { lockedAt: new Date() });
    const admin = await createTestUser("담당 관리자", { role: "ADMIN" });

    await createTestCase({ assignedEngineerId: target });
    const lockedCase = await createTestCase({ assignedEngineerId: target });
    await db.update(repairCases).set({ isLocked: true }).where(eq(repairCases.id, lockedCase.id));
    const trashedCase = await createTestCase({ assignedEngineerId: target });
    await db
      .update(repairCases)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: superAdminId })
      .where(eq(repairCases.id, trashedCase.id));

    // 다른 엔지니어의 건에서 대상이 노드 하나를 잡았다(작업 중), 하나는 끝냈다.
    const otherCase = await createTestCase();
    const { taskNodeId, endNodeId } = await startExecutionFixture(otherCase.id);
    await db
      .update(procedureCaseExecutionNodes)
      .set({ assignedEngineerId: target, status: "IN_PROGRESS", startedBy: target, startedAt: new Date() })
      .where(eq(procedureCaseExecutionNodes.id, taskNodeId));
    await db
      .update(procedureCaseExecutionNodes)
      .set({ assignedEngineerId: target, status: "COMPLETED", completedBy: target, completedAt: new Date() })
      .where(eq(procedureCaseExecutionNodes.id, endNodeId));

    const result = await preview(target);
    assert.equal(result.impact.openAssignedCases, 1);
    assert.equal(result.impact.untouchedAssignedCases, 2);
    assert.equal(result.impact.openClaimedNodes, 1);
    assert.deepEqual(result.requires, {
      approvalSuccessor: false,
      engineerSuccessor: true,
      approvalSuccessorMustInspect: false,
    });

    const engineerIds = new Set(result.candidates.engineerSuccessors.map((candidate) => candidate.id));
    assert.ok(engineerIds.has(engineerId), "자격을 갖춘 엔지니어가 후보에 없다");
    assert.ok(!engineerIds.has(target), "자기 자신이 담당 후보에 있다");
    assert.ok(!engineerIds.has(admin), "엔지니어가 아닌 사람이 담당 후보에 있다");
    assert.ok(!engineerIds.has(lockedEngineer), "잠긴 엔지니어가 담당 후보에 있다");
  });

  test("부품 요청 · 불출 신청 · 개발자 · 메일 수신자 — 참고로 세고, 이어받을 사람은 요구하지 않는다", async () => {
    const target = await createTestUser("잡다한 대상", { isDeveloper: true });

    await db.insert(inventoryPartRequests).values([
      { requestedByUserId: target, status: "PENDING" },
      { requestedByUserId: target, status: "ON_HOLD" },
      { requestedByUserId: target, status: "CANCELLED" },
    ]);
    await insertPartIssueRequest({ requestedByUserId: target, status: "PENDING_APPROVAL" });
    await insertPartIssueRequest({ requestedByUserId: target, status: "APPROVED" });
    await insertPartIssueRequest({ requestedByUserId: target, status: "REJECTED" });
    await db.insert(intakeMailRecipients).values({ userId: target, addedBy: superAdminId });

    const result = await preview(target);
    assert.equal(result.impact.ownOpenPartRequests, 2);
    assert.equal(result.impact.ownOpenPartIssueRequests, 2);
    assert.equal(result.impact.isDeveloper, true);
    assert.equal(result.target.isDeveloper, true);
    assert.equal(result.impact.isIntakeMailRecipient, true);
    assert.deepEqual(result.requires, {
      approvalSuccessor: false,
      engineerSuccessor: false,
      approvalSuccessorMustInspect: false,
    });
  });
});

describe("collectUserDeletionImpact — 잠그며 읽기", () => {
  test("트랜잭션 안에서 잠그며 읽어도 잠그지 않고 읽은 것과 같다", async () => {
    const target = await createTestUser("잠금 대상", { isShipmentRepresentative: true });
    const stepA = await createTestUser("잠금 1단계");
    const shipmentRoute = await saveRoute("FINAL_SHIPMENT", [stepA, target]);
    const partIssueRoute = await saveRoute("PART_ISSUE", [target]);

    const assignedCase = await createTestCase({ assignedEngineerId: target });
    await insertCaseApproval({
      repairCaseId: assignedCase.id,
      assignedApproverUserId: target,
      routeId: shipmentRoute,
      routeStepOrder: 2,
    });
    const issue = await insertPartIssueRequest({});
    await insertPartIssueApproval({
      issueRequestId: issue,
      routeId: partIssueRoute,
      routeStepOrder: 1,
      assignedApproverUserId: target,
    });
    const now = Date.now();
    await db.insert(shipmentApprovalDelegations).values({
      representativeUserId: target,
      delegateUserId: stepA,
      startsAt: new Date(now - 1000),
      endsAt: new Date(now + 60_000),
      status: "ACTIVE",
      assignedByUserId: superAdminId,
    });

    const unlocked = await collectUserDeletionImpact(db, target, { lock: false });
    const locked = await db.transaction((tx) => collectUserDeletionImpact(tx, target, { lock: true }));
    assert.ok(unlocked && locked);
    assert.deepEqual(locked, unlocked);
    assert.equal(locked.openApprovals.length, 2);
    assert.equal(locked.activeDelegations.length, 1);
    assert.deepEqual(locked.openAssignedCaseIds, [assignedCase.id]);
  });

  test("없는 대상은 잠그며 읽어도 null", async () => {
    const snapshot = await db.transaction((tx) => collectUserDeletionImpact(tx, randomUUID(), { lock: true }));
    assert.equal(snapshot, null);
  });
});
