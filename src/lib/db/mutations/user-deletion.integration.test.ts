import "../../../../scripts/load-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, like, notInArray, or } from "drizzle-orm";
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
  representativeChangeHistory,
  shipmentApprovalDelegations,
  shipmentApprovalRouteSteps,
  shipmentApprovalRoutes,
  statusChangeHistories,
  users,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import { decideRepairCaseApproval, requestRepairCaseApproval } from "./repair-case-approvals";
import { saveShipmentApprovalRoute } from "./shipment-approval-routes";
import { createDraftProcedureTemplateFromImport, publishProcedureTemplate } from "./procedure-templates";
import { startProcedureExecution } from "./procedure-case-execution";
import { deleteUserAccount, type DeleteUserAccountResult, type UserDeletionResultCode } from "./user-deletion";
import { getUserDeletionPreview } from "../queries/user-deletion-impact";
import { restoreDeletedSsoUser } from "../queries/users";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import type { SessionPayload } from "@/lib/auth/session";
import type { ShipmentApprovalRouteScope } from "@/lib/domain/shipment-approval-route";
import type { ExtractedTemplate } from "../../../../scripts/lib/xlsx/types";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 사용자 계정 삭제(deleteUserAccount) — 실제 DB (시험 DB)
 * ============================================================================
 * 설계 메모 7절의 시나리오를 못 박는다: 권한 거절(아무것도 바뀌지 않음) · 삭제가 하는
 * 일(결재선 새 판 · 사슬 옮기기 · 넘김 · 대표 · 위임 · 담당 · 노드 · 개발자 · 메일
 * 수신자) · 멈춤 · 동시성 · 되살리기 · 감사 기록의 개인정보.
 *
 * 🔴 담당 이관은 repair_cases.version 을 올리지 않는다 — 올리면 받아 둔 승인이
 * APPROVAL_STALE 로 죽는다. 그 약속을 「검수 승인을 받아 둔 건이 삭제 뒤에도 출하
 * 요청을 할 수 있다」로 증명한다.
 *
 * 격리 · 청소 규약은 repair-case-approvals-route.integration.test.ts 를 본떴다: 이
 * 파일이 만든 "userdel-test-" 계정과 "D9501" 접수 건만 쓴다. ⚠️ 판 · 단계는 afterEach
 * 로 반드시 걷는다 — 시험 DB 에 판이 남으면 다른 시험 파일이 결재선을 타면서 깨진다.
 * 사람 참조가 RESTRICT 라 삭제에는 순서가 있다. users.deleted_by 가 같은 표의 다른
 * 사람을 가리키므로 사람을 지우기 전에 그 칸을 먼저 비운다.
 *
 * 「마지막 대표」 시험 하나만 시험 DB 의 다른 활성 대표를 잠시 내렸다가 finally 에서
 * 되돌린다(shipment-representatives.integration.test.ts 와 같은 방식).
 * ============================================================================
 */

const TEST_EMAIL_PREFIX = "userdel-test-";
const TEST_MODEL_PREFIX = "USERDEL-TEST-";
const TEST_TEMPLATE_PREFIX = "test-userdel-exec-";
const TEST_YEAR_MONTH = "9501";
const TEST_INTAKE_PREFIX = "D9501%";
// 🔴 quotes_quote_number_not_deleted_unique 때문에 번호가 겹치면 두 번째 실행이 깨진다 —
// 접두어로 이 파일의 장만 골라 걷고, 뒤에는 행마다 다른 값을 붙인다.
const TEST_QUOTE_NUMBER_PREFIX = "UDEL-TEST-";
const TEST_QUOTE_DATE = "2095-01-10";
const TEST_RECEIVED_AT = "2095-01-10";
const TEST_SHIPMENT_DATE = "2095-01-20";

let originalAuthSource: string | undefined;
let customerId: string;
let superAdminId: string; // 삭제를 하는 사람 · 판을 저장하는 사람
let engineerId: string; // 접수 건의 기본 담당 · 결재 사슬의 요청자 · 검수 결재자

const createdTestUserIds: string[] = [];
const createdTemplateIds: string[] = [];

type Ok = Extract<DeleteUserAccountResult, { ok: true }>;

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

/** 최종 출하 승인을 요청할 수 있는 상태로 — 검수 승인을 진짜 경로로 받아 둔다. */
async function approveInspection(repairCaseId: string): Promise<void> {
  const requested = await requestRepairCaseApproval(repairCaseId, "REPAIR_INSPECTION", engineerId, null);
  assert.equal(requested.ok, true, `setup inspection request failed: ${JSON.stringify(requested)}`);
  const decided = await decideRepairCaseApproval(repairCaseId, "REPAIR_INSPECTION", "APPROVED", engineerId, null);
  assert.equal(decided.ok, true, `setup inspection approval failed: ${JSON.stringify(decided)}`);
}

async function saveRoute(scope: ShipmentApprovalRouteScope, approverUserIds: string[]): Promise<string> {
  const result = await saveShipmentApprovalRoute(approverUserIds, superAdminId, scope);
  assert.equal(result.ok, true, `setup route save failed: ${JSON.stringify(result)}`);
  return (await currentRoute(scope)).id;
}

async function currentRoute(
  scope: ShipmentApprovalRouteScope
): Promise<{ id: string; version: number; approverIds: string[] }> {
  const [route] = await db
    .select({ id: shipmentApprovalRoutes.id, version: shipmentApprovalRoutes.version })
    .from(shipmentApprovalRoutes)
    .where(eq(shipmentApprovalRoutes.scope, scope))
    .orderBy(desc(shipmentApprovalRoutes.version))
    .limit(1);
  assert.ok(route, `${scope} 판이 없다`);
  const steps = await db
    .select({ approverUserId: shipmentApprovalRouteSteps.approverUserId })
    .from(shipmentApprovalRouteSteps)
    .where(eq(shipmentApprovalRouteSteps.routeId, route.id))
    .orderBy(asc(shipmentApprovalRouteSteps.stepOrder));
  return { id: route.id, version: route.version, approverIds: steps.map((step) => step.approverUserId) };
}

async function routeCount(scope: ShipmentApprovalRouteScope): Promise<number> {
  const rows = await db
    .select({ id: shipmentApprovalRoutes.id })
    .from(shipmentApprovalRoutes)
    .where(eq(shipmentApprovalRoutes.scope, scope));
  return rows.length;
}

async function userRow(id: string) {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      ssoSubject: users.ssoSubject,
      isDeleted: users.isDeleted,
      deletedAt: users.deletedAt,
      deletedBy: users.deletedBy,
      deleteReason: users.deleteReason,
      sessionsValidFrom: users.sessionsValidFrom,
      version: users.version,
      isShipmentRepresentative: users.isShipmentRepresentative,
      isDeveloper: users.isDeveloper,
    })
    .from(users)
    .where(eq(users.id, id));
  assert.ok(row, `사용자 ${id} 가 없다`);
  return row;
}

async function versionOf(id: string): Promise<number> {
  const [row] = await db.select({ version: users.version }).from(users).where(eq(users.id, id));
  return row?.version ?? 1;
}

async function del(
  targetUserId: string,
  options: {
    actorUserId?: string;
    expectedVersion?: number;
    reason?: string;
    approvalSuccessorUserId?: string | null;
    engineerSuccessorUserId?: string | null;
  } = {}
): Promise<DeleteUserAccountResult> {
  return deleteUserAccount({
    targetUserId,
    expectedVersion: options.expectedVersion ?? (await versionOf(targetUserId)),
    actorUserId: options.actorUserId ?? superAdminId,
    reason: options.reason ?? "퇴사",
    approvalSuccessorUserId: options.approvalSuccessorUserId ?? null,
    engineerSuccessorUserId: options.engineerSuccessorUserId ?? null,
  });
}

function expectOk(result: DeleteUserAccountResult): Ok["summary"] {
  assert.equal(result.ok, true, `삭제가 거절됐다: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result.summary;
}

function expectFail(result: DeleteUserAccountResult, code: UserDeletionResultCode): string {
  assert.equal(result.ok, false, `거절돼야 한다(${code}): ${JSON.stringify(result)}`);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.code, code, result.message);
  return result.message;
}

/** 그 건의 최종 출하 승인 행들 — 오래된 것부터. */
async function shipmentRows(repairCaseId: string) {
  return db
    .select()
    .from(repairCaseApprovals)
    .where(and(eq(repairCaseApprovals.repairCaseId, repairCaseId), eq(repairCaseApprovals.approvalType, "FINAL_SHIPMENT")))
    .orderBy(asc(repairCaseApprovals.requestedAt));
}

async function openShipmentRow(repairCaseId: string) {
  const open = (await shipmentRows(repairCaseId)).filter((row) => row.status === "REQUESTED");
  assert.equal(open.length, 1, `열린 출하 결재 행이 하나가 아니다: ${open.length}`);
  return open[0];
}

/** 이 파일의 행위자가 그 대상에 남긴 감사 기록 — 조회다(지우는 쪽은 행위자로만 고른다). */
async function auditRowsFor(targetEntity: string, targetRecordId: string) {
  return db
    .select({
      actionType: auditLogs.actionType,
      previousValue: auditLogs.previousValue,
      newValue: auditLogs.newValue,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.targetEntity, targetEntity),
        eq(auditLogs.targetRecordId, targetRecordId),
        inArray(auditLogs.actorUserId, createdTestUserIds)
      )
    );
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
      destinationNote: "계정 삭제 시험",
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
}): Promise<string> {
  const [row] = await db
    .insert(inventoryPartIssueApprovals)
    .values({
      issueRequestId: params.issueRequestId,
      status: "REQUESTED",
      routeId: params.routeId,
      routeStepOrder: params.routeStepOrder,
      assignedApproverUserId: params.assignedApproverUserId,
      requestedByUserId: engineerId,
    })
    .returning({ id: inventoryPartIssueApprovals.id });
  return row.id;
}

/** Arrange-only: 견적서 한 장. 필수 칸 넷만 채운다(수리 건 · 고객사 없이도 만든다). */
async function insertQuote(): Promise<{ id: string; quoteNumber: string }> {
  const quoteNumber = `${TEST_QUOTE_NUMBER_PREFIX}${randomUUID().slice(0, 8)}`;
  const [row] = await db
    .insert(quotes)
    .values({
      quoteNumber,
      quoteDate: TEST_QUOTE_DATE,
      customerNameText: "계정 삭제 시험 공급처",
      subject: "계정 삭제 시험 견적",
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

/** 그 견적서 결재 행 하나 — 지정 · 판 · 단계 · 상태. */
async function quoteApprovalRow(approvalId: string) {
  const [row] = await db
    .select({
      assignedApproverUserId: quoteApprovals.assignedApproverUserId,
      routeId: quoteApprovals.routeId,
      routeStepOrder: quoteApprovals.routeStepOrder,
      status: quoteApprovals.status,
    })
    .from(quoteApprovals)
    .where(eq(quoteApprovals.id, approvalId));
  assert.ok(row, `견적서 결재 ${approvalId} 가 없다`);
  return row;
}

/** 최소 단일 작업 절차를 발행해 그 접수 건에서 실행을 시작하고, 작업 · 종료 노드 id 를 돌려준다. */
async function startExecutionFixture(repairCaseId: string): Promise<{ taskNodeId: string; endNodeId: string }> {
  const code = `${TEST_TEMPLATE_PREFIX}${randomUUID().slice(0, 8)}`;
  const sheet = "(TEST) 계정 삭제 시트";
  const template: ExtractedTemplate = {
    code,
    name: `계정 삭제 시험용 ${code}`,
    equipmentType: "RFG",
    description: "user deletion integration test fixture",
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
    sourceFileName: "user-deletion-fixture.xlsx",
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
 * 한 시험이 남긴 결재 행 · 판 · 부품 행 · 위임 · 수신자 · 대표 이력 · 대표 표시를 걷는다.
 * 접수 건 · 절차 · 감사 · 사람은 after() 가 마지막에 지운다.
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
        inArray(shipmentApprovalDelegations.delegateUserId, ids),
        inArray(shipmentApprovalDelegations.assignedByUserId, ids),
        inArray(shipmentApprovalDelegations.revokedByUserId, ids)
      )
    );
  await db
    .delete(representativeChangeHistory)
    .where(
      or(
        inArray(representativeChangeHistory.targetUserId, ids),
        inArray(representativeChangeHistory.changedByUserId, ids)
      )
    );
  await db.delete(intakeMailRecipients).where(inArray(intakeMailRecipients.userId, ids));
  await db.update(users).set({ isShipmentRepresentative: false }).where(inArray(users.id, ids));
}

/** 이 파일의 흔적을 모두 걷는다(이전 실행이 중간에 끊겨 남은 것 포함). */
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
    const ids = [...userIds];
    // audit_logs.actor_user_id → users (restrict): 행위자로만 고른다 —
    // target_record_id 로 고르는 모양은 test-cleanup-static-safety.test.ts 가 금지한다.
    await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, ids));
    // users.deleted_by 는 같은 표의 다른 사람을 RESTRICT 로 가리킨다 — 먼저 비운다.
    await db.update(users).set({ deletedBy: null }).where(inArray(users.id, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
}

before(async () => {
  originalAuthSource = process.env.AUTH_SOURCE;
  process.env.AUTH_SOURCE = "database";

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

  superAdminId = await createTestUser("삭제 시험 최고관리자", { role: "SUPER_ADMIN" });
  engineerId = await createTestUser("삭제 시험 엔지니어");
});

afterEach(async () => {
  // ⚠️ 판이 남으면 다른 시험 파일이 결재선을 타면서 깨지고, 이 파일의 다음 시험도 판
  // 번호가 1부터 시작한다는 전제를 잃는다.
  await removePerTestFixtures(createdTestUserIds);
});

after(async () => {
  await removeEverything(createdTestUserIds);
  if (originalAuthSource === undefined) delete process.env.AUTH_SOURCE;
  else process.env.AUTH_SOURCE = originalAuthSource;
  await pgClient.end({ timeout: 5 });
});

describe("권한 · 대상 — 거절되면 아무것도 바뀌지 않는다", () => {
  test("진짜 최고관리자가 아니면 FORBIDDEN — 관리자 · 개발자 승격 · 승인 대기 · 먼저 삭제된 최고관리자", async () => {
    const target = await createTestUser("권한 대상", { isShipmentRepresentative: true });
    const stepA = await createTestUser("권한 1단계");
    const successor = await createTestUser("권한 이어받을 사람");
    await saveRoute("FINAL_SHIPMENT", [stepA, target]);

    const actors = [
      await createTestUser("권한 관리자", { role: "ADMIN" }),
      await createTestUser("권한 개발자 엔지니어", { isDeveloper: true }),
      await createTestUser("권한 승인 대기 최고관리자", { role: "SUPER_ADMIN", approvalStatus: "PENDING" }),
      await createTestUser("권한 삭제된 최고관리자", {
        role: "SUPER_ADMIN",
        isDeleted: true,
        deletedAt: new Date(),
      }),
    ];
    const before = await userRow(target);
    for (const actorUserId of actors) {
      expectFail(await del(target, { actorUserId, approvalSuccessorUserId: successor }), "FORBIDDEN");
    }
    assert.deepEqual(await userRow(target), before);
    assert.equal(await routeCount("FINAL_SHIPMENT"), 1, "거절됐는데 새 판이 얹혔다");
  });

  test("자기 자신은 SELF_DELETE_FORBIDDEN — 대문자로 보내도 같다", async () => {
    for (const targetUserId of [superAdminId, superAdminId.toUpperCase()]) {
      expectFail(
        await del(targetUserId, { expectedVersion: await versionOf(superAdminId) }),
        "SELF_DELETE_FORBIDDEN"
      );
    }
    assert.equal((await userRow(superAdminId)).isDeleted, false);
  });

  test("없는 · 이미 삭제된 대상은 NOT_FOUND, 버전이 다르면 CONFLICT, 사유가 비면 VALIDATION_ERROR", async () => {
    expectFail(await del(randomUUID(), { expectedVersion: 1 }), "NOT_FOUND");
    const deletedTarget = await createTestUser("이미 삭제된 대상", { isDeleted: true, deletedAt: new Date() });
    expectFail(await del(deletedTarget, { expectedVersion: 1 }), "NOT_FOUND");

    const target = await createTestUser("버전 대상");
    expectFail(await del(target, { expectedVersion: 99 }), "CONFLICT");
    expectFail(await del(target, { reason: "   " }), "VALIDATION_ERROR");
    const row = await userRow(target);
    assert.equal(row.isDeleted, false);
    assert.equal(row.version, 1);
  });
});

describe("삭제가 하는 일", () => {
  test("기본 — 삭제 네 칸 · sessions_valid_from · version+1, 이메일 · sso_subject 그대로, 옛 세션은 끊긴다", async () => {
    const subject = `userdel-sso-${randomUUID()}`;
    const target = await createTestUser("기본 대상", { ssoSubject: subject });
    const before = await userRow(target);
    const issuedAt = Math.floor(Date.now() / 1000) - 60;
    const oldSession: SessionPayload = {
      userId: target,
      role: "AS_ENGINEER",
      approvalStatus: "APPROVED",
      issuedAt,
      expiresAt: issuedAt + 3600,
    };
    assert.ok(await resolveActingUserForSession(oldSession), "삭제 전에는 세션이 살아 있어야 한다");

    const summary = expectOk(await del(target));
    assert.deepEqual(summary, {
      routeVersions: [],
      reassignedApprovals: 0,
      repinnedApprovals: 0,
      representativeHandedTo: null,
      revokedDelegations: 0,
      reassignedRepairCases: 0,
      releasedExecutionNodes: 0,
      developerFlagCleared: false,
      intakeMailRecipientRemoved: false,
    });

    const after = await userRow(target);
    assert.equal(after.isDeleted, true);
    assert.ok(after.deletedAt);
    assert.equal(after.deletedBy, superAdminId);
    assert.equal(after.deleteReason, "퇴사");
    assert.ok(after.sessionsValidFrom);
    assert.equal(after.version, before.version + 1);
    assert.equal(after.email, before.email, "이메일을 건드렸다");
    assert.equal(after.ssoSubject, subject, "sso_subject 를 건드렸다");
    assert.equal(await resolveActingUserForSession(oldSession), null, "옛 세션이 살아 있다");

    const audit = (await auditRowsFor("users", target)).filter((row) => row.actionType === "SOFT_DELETE");
    assert.equal(audit.length, 1);
    assert.equal((audit[0].newValue as { deleteReason: string }).deleteReason, "퇴사");
  });

  test("🔴 담당 이관 — 열린 건만 넘기고 repair_cases.version 은 그대로라 받아 둔 검수 승인으로 출하를 요청할 수 있다, 열린 노드는 NULL", async () => {
    const target = await createTestUser("담당 대상");
    const nextEngineer = await createTestUser("담당 이어받을 엔지니어");

    const openCase = await createTestCase({ assignedEngineerId: target });
    await approveInspection(openCase.id);
    const [openBefore] = await db
      .select({ version: repairCases.version })
      .from(repairCases)
      .where(eq(repairCases.id, openCase.id));

    const lockedCase = await createTestCase({ assignedEngineerId: target });
    await db.update(repairCases).set({ isLocked: true }).where(eq(repairCases.id, lockedCase.id));
    const trashedCase = await createTestCase({ assignedEngineerId: target });
    await db
      .update(repairCases)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: superAdminId })
      .where(eq(repairCases.id, trashedCase.id));

    // 다른 엔지니어의 건에서 대상이 노드 하나를 잡았고(작업 중), 하나는 끝냈다.
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
    const [taskBefore] = await db
      .select({ version: procedureCaseExecutionNodes.version })
      .from(procedureCaseExecutionNodes)
      .where(eq(procedureCaseExecutionNodes.id, taskNodeId));

    const summary = expectOk(await del(target, { engineerSuccessorUserId: nextEngineer }));
    assert.equal(summary.reassignedRepairCases, 1);
    assert.equal(summary.releasedExecutionNodes, 1);

    const caseRows = await db
      .select({ id: repairCases.id, assignedEngineerId: repairCases.assignedEngineerId, version: repairCases.version })
      .from(repairCases)
      .where(inArray(repairCases.id, [openCase.id, lockedCase.id, trashedCase.id]));
    const byId = new Map(caseRows.map((row) => [row.id, row]));
    assert.equal(byId.get(openCase.id)?.assignedEngineerId, nextEngineer);
    assert.equal(byId.get(openCase.id)?.version, openBefore.version, "🔴 담당 이관이 접수 건 버전을 올렸다");
    assert.equal(byId.get(lockedCase.id)?.assignedEngineerId, target, "출하 완료 건은 그대로여야 한다");
    assert.equal(byId.get(trashedCase.id)?.assignedEngineerId, target, "휴지통 건은 그대로여야 한다");

    // 🔴 받아 둔 검수 승인이 살아 있다 — 새 담당자가 최종 출하 승인을 요청할 수 있다.
    const shipmentRequest = await requestRepairCaseApproval(openCase.id, "FINAL_SHIPMENT", nextEngineer, null);
    assert.equal(shipmentRequest.ok, true, `검수 승인이 죽었다: ${JSON.stringify(shipmentRequest)}`);

    const nodes = await db
      .select({
        id: procedureCaseExecutionNodes.id,
        assignedEngineerId: procedureCaseExecutionNodes.assignedEngineerId,
        version: procedureCaseExecutionNodes.version,
      })
      .from(procedureCaseExecutionNodes)
      .where(inArray(procedureCaseExecutionNodes.id, [taskNodeId, endNodeId]));
    const nodeById = new Map(nodes.map((row) => [row.id, row]));
    assert.equal(nodeById.get(taskNodeId)?.assignedEngineerId, null);
    assert.equal(nodeById.get(taskNodeId)?.version, taskBefore.version + 1);
    assert.equal(nodeById.get(endNodeId)?.assignedEngineerId, target, "끝난 노드의 담당은 기록이라 그대로다");

    const caseAudit = await auditRowsFor("repair_cases", openCase.id);
    assert.deepEqual(
      caseAudit.map((row) => [row.actionType, row.previousValue, row.newValue]),
      [
        [
          "UPDATE",
          { intakeNumber: openCase.intakeNumber, assignedEngineerId: target },
          {
            intakeNumber: openCase.intakeNumber,
            assignedEngineerId: nextEngineer,
            cause: { kind: "USER_DELETION", deletedUserId: target },
          },
        ],
      ]
    );
    const nodeAudit = await auditRowsFor("procedure_case_execution_nodes", taskNodeId);
    assert.equal(nodeAudit.length, 1);
    assert.deepEqual(nodeAudit[0].newValue, {
      assignedEngineerId: null,
      cause: { kind: "USER_DELETION", deletedUserId: target },
    });
  });

  test("🔴 판 옮기기 · 넘김 — 현재 판 뒤 단계의 사슬은 새 판으로 옮겨져 앞 단계 승인 뒤 다음 행이 이어받을 사람에게 간다", async () => {
    const target = await createTestUser("판 옮기기 대상");
    const stepA = await createTestUser("판 옮기기 1단계");
    const successor = await createTestUser("판 옮기기 이어받을 사람");

    await saveRoute("FINAL_SHIPMENT", [stepA, target]);
    const partIssueRoute = await saveRoute("PART_ISSUE", [target]);

    // 사슬 — 1단계가 A 에게 열려 있고 대상은 2단계.
    const chainCase = await createTestCase();
    await approveInspection(chainCase.id);
    const requested = await requestRepairCaseApproval(chainCase.id, "FINAL_SHIPMENT", engineerId, null);
    assert.equal(requested.ok, true, JSON.stringify(requested));

    // 대상에게 지정된 검수 — 이어받을 사람이 올린 것이다. 검수는 사슬이 아니라 막지 않는다.
    const inspectionCase = await createTestCase();
    const inspection = await requestRepairCaseApproval(inspectionCase.id, "REPAIR_INSPECTION", successor, null, target);
    assert.equal(inspection.ok, true, JSON.stringify(inspection));

    // 대상에게 열린 불출 결재.
    const issue = await insertPartIssueRequest({});
    const issueApproval = await insertPartIssueApproval({
      issueRequestId: issue,
      routeId: partIssueRoute,
      routeStepOrder: 1,
      assignedApproverUserId: target,
    });

    const summary = expectOk(await del(target, { approvalSuccessorUserId: successor }));
    assert.deepEqual(summary.routeVersions, [
      { scope: "FINAL_SHIPMENT", version: 2 },
      { scope: "PART_ISSUE", version: 2 },
    ]);
    assert.equal(summary.reassignedApprovals, 2, "검수 · 불출이 넘어가야 한다");
    assert.equal(summary.repinnedApprovals, 1);

    const shipmentRoute = await currentRoute("FINAL_SHIPMENT");
    assert.deepEqual(shipmentRoute.approverIds, [stepA, successor], "자리만 바뀐 새 판이어야 한다");
    assert.deepEqual((await currentRoute("PART_ISSUE")).approverIds, [successor]);

    // 사슬이 새 판으로 옮겨졌다 — 열린 단계는 그대로 A.
    const repinned = await openShipmentRow(chainCase.id);
    assert.equal(repinned.routeId, shipmentRoute.id);
    assert.equal(repinned.assignedApproverUserId, stepA);
    assert.equal(repinned.routeStepOrder, 1);

    // A 가 승인하면 다음 행은 이어받을 사람에게 간다.
    const decidedByA = await decideRepairCaseApproval(chainCase.id, "FINAL_SHIPMENT", "APPROVED", stepA, null);
    assert.equal(decidedByA.ok, true, JSON.stringify(decidedByA));
    const next = await openShipmentRow(chainCase.id);
    assert.equal(next.assignedApproverUserId, successor, "🔴 다음 단계가 지운 사람에게 갔다");
    assert.equal(next.routeStepOrder, 2);
    assert.equal(next.routeId, shipmentRoute.id);
    const decidedBySuccessor = await decideRepairCaseApproval(chainCase.id, "FINAL_SHIPMENT", "APPROVED", successor, null);
    assert.equal(decidedBySuccessor.ok, true, JSON.stringify(decidedBySuccessor));

    const [inspectionRow] = await db
      .select({ assignedApproverUserId: repairCaseApprovals.assignedApproverUserId })
      .from(repairCaseApprovals)
      .where(
        and(
          eq(repairCaseApprovals.repairCaseId, inspectionCase.id),
          eq(repairCaseApprovals.status, "REQUESTED")
        )
      );
    assert.equal(inspectionRow.assignedApproverUserId, successor);

    const [issueRow] = await db
      .select({
        assignedApproverUserId: inventoryPartIssueApprovals.assignedApproverUserId,
        routeId: inventoryPartIssueApprovals.routeId,
      })
      .from(inventoryPartIssueApprovals)
      .where(eq(inventoryPartIssueApprovals.id, issueApproval));
    assert.deepEqual(issueRow, { assignedApproverUserId: successor, routeId: partIssueRoute });

    const approvalAudit = await auditRowsFor("repair_case_approvals", repinned.id);
    assert.equal(approvalAudit.length, 1);
    assert.deepEqual(approvalAudit[0].newValue, {
      assignedApproverUserId: stepA,
      routeId: shipmentRoute.id,
      routeStepOrder: 1,
      cause: { kind: "USER_DELETION", deletedUserId: target },
    });
    const routeAudit = await auditRowsFor("shipment_approval_routes", shipmentRoute.id);
    assert.deepEqual((routeAudit[0].newValue as { cause: unknown }).cause, {
      kind: "USER_DELETION",
      deletedUserId: target,
    });
  });

  test("🔴 견적서 결재 넘김 — 지정된 행이 이어받을 사람에게 가고, 감사는 quote_approvals 에 남는다", async () => {
    // 🔴 이 사람에게는 견적서 결재 한 건 말고는 아무것도 걸려 있지 않다. 예전에는 그
    // 행이 수집 단계부터 빠져 **이어받을 사람을 요구하지도 않고** 삭제가 성공했고,
    // 결재는 지워진 사람에게 남아 최고관리자만 풀 수 있었다.
    const target = await createTestUser("견적서 넘김 대상");
    const successor = await createTestUser("견적서 넘김 이어받을 사람");

    const quote = await insertQuote();
    const approvalId = await insertQuoteApproval({
      quoteId: quote.id,
      assignedApproverUserId: target,
      routeId: null,
      routeStepOrder: null,
    });

    // 견적서 결재만으로도 결재 이어받을 사람이 필요하다.
    expectFail(await del(target), "APPROVAL_SUCCESSOR_REQUIRED");

    const summary = expectOk(await del(target, { approvalSuccessorUserId: successor }));
    assert.deepEqual(summary.routeVersions, [], "결재선 자리가 없으니 새 판을 얹을 일이 없다");
    assert.equal(summary.reassignedApprovals, 1);
    assert.equal(summary.repinnedApprovals, 0);

    assert.deepEqual(await quoteApprovalRow(approvalId), {
      assignedApproverUserId: successor,
      routeId: null,
      routeStepOrder: null,
      status: "REQUESTED",
    });

    // 🔴 감사의 표 이름 — 삼항식 시절이라면 repair_case_approvals 로 적혔거나 0행 쓰기로
    // CONFLICT 가 났다.
    const approvalAudit = await auditRowsFor("quote_approvals", approvalId);
    assert.equal(approvalAudit.length, 1);
    assert.deepEqual(approvalAudit[0].previousValue, {
      assignedApproverUserId: target,
      routeId: null,
      routeStepOrder: null,
    });
    assert.deepEqual(approvalAudit[0].newValue, {
      assignedApproverUserId: successor,
      routeId: null,
      routeStepOrder: null,
      cause: { kind: "USER_DELETION", deletedUserId: target },
    });
    // 삭제 한 줄 요약에도 그 id 가 견적서 칸으로 담긴다.
    const deletionAudit = (await auditRowsFor("users", target)).filter((row) => row.actionType === "SOFT_DELETE");
    assert.equal(deletionAudit.length, 1);
    assert.deepEqual((deletionAudit[0].newValue as { reassignedApprovalIds: unknown }).reassignedApprovalIds, {
      repairCase: [],
      partIssue: [],
      quote: [approvalId],
    });
  });

  test("🔴 견적서 사슬 옮기기 — 현재 판 뒤 단계의 견적서 결재는 새 판으로 옮겨지고 단계 번호는 그대로다", async () => {
    const target = await createTestUser("견적서 옮기기 대상");
    const stepA = await createTestUser("견적서 옮기기 1단계");
    const successor = await createTestUser("견적서 옮기기 이어받을 사람");

    const oldQuoteRoute = await saveRoute("QUOTE", [stepA, target]);
    const quote = await insertQuote();
    const approvalId = await insertQuoteApproval({
      quoteId: quote.id,
      assignedApproverUserId: stepA,
      routeId: oldQuoteRoute,
      routeStepOrder: 1,
    });

    const summary = expectOk(await del(target, { approvalSuccessorUserId: successor }));
    assert.deepEqual(summary.routeVersions, [{ scope: "QUOTE", version: 2 }]);
    assert.equal(summary.reassignedApprovals, 0, "열린 단계는 A 의 것이라 지정은 그대로다");
    assert.equal(summary.repinnedApprovals, 1);

    const newQuoteRoute = await currentRoute("QUOTE");
    assert.deepEqual(newQuoteRoute.approverIds, [stepA, successor], "자리만 바뀐 새 판이어야 한다");
    assert.deepEqual(await quoteApprovalRow(approvalId), {
      assignedApproverUserId: stepA,
      routeId: newQuoteRoute.id,
      // 🔴 번호를 그대로 두는 것이 route_columns_together CHECK 와 사슬 잇기의 전제다.
      routeStepOrder: 1,
      status: "REQUESTED",
    });

    const approvalAudit = await auditRowsFor("quote_approvals", approvalId);
    assert.equal(approvalAudit.length, 1);
    assert.deepEqual(approvalAudit[0].newValue, {
      assignedApproverUserId: stepA,
      routeId: newQuoteRoute.id,
      routeStepOrder: 1,
      cause: { kind: "USER_DELETION", deletedUserId: target },
    });
  });

  test("🔴 견적서 사슬이 옛 판을 따라가면 IN_FLIGHT_ON_OLD_ROUTE — 조용히 삭제되지 않는다", async () => {
    // 🔴 넷 중 가장 조용한 사고였다: 멈춰야 하는데 삭제가 그냥 성공했다.
    const target = await createTestUser("견적서 옛 판 대상");
    const stepA = await createTestUser("견적서 옛 판 1단계");
    const stepB = await createTestUser("견적서 옛 판 새 2단계");
    const successor = await createTestUser("견적서 옛 판 이어받을 사람");

    const oldQuoteRoute = await saveRoute("QUOTE", [stepA, target]);
    const quote = await insertQuote();
    const approvalId = await insertQuoteApproval({
      quoteId: quote.id,
      assignedApproverUserId: stepA,
      routeId: oldQuoteRoute,
      routeStepOrder: 1,
    });
    await saveRoute("QUOTE", [stepA, stepB]);

    const before = await userRow(target);
    const rowBefore = await quoteApprovalRow(approvalId);
    const message = expectFail(await del(target, { approvalSuccessorUserId: successor }), "IN_FLIGHT_ON_OLD_ROUTE");
    assert.ok(message.includes(quote.quoteNumber), `사유에 견적서번호가 없다: ${message}`);
    assert.deepEqual(await userRow(target), before);
    assert.equal(await routeCount("QUOTE"), 2, "거절됐는데 새 판이 얹혔다");
    assert.deepEqual(await quoteApprovalRow(approvalId), rowBefore);
  });

  test("옛 판을 따라가는 사슬에 대상이 뒤 단계로 남으면 IN_FLIGHT_ON_OLD_ROUTE — 아무것도 바뀌지 않는다", async () => {
    const target = await createTestUser("옛 판 대상");
    const stepA = await createTestUser("옛 판 1단계");
    const stepB = await createTestUser("옛 판 새 2단계");
    const successor = await createTestUser("옛 판 이어받을 사람");

    await saveRoute("FINAL_SHIPMENT", [stepA, target]);
    const oldCase = await createTestCase();
    await approveInspection(oldCase.id);
    const requested = await requestRepairCaseApproval(oldCase.id, "FINAL_SHIPMENT", engineerId, null);
    assert.equal(requested.ok, true, JSON.stringify(requested));
    await saveRoute("FINAL_SHIPMENT", [stepA, stepB]);

    const before = await userRow(target);
    const rowBefore = await openShipmentRow(oldCase.id);
    const message = expectFail(
      await del(target, { approvalSuccessorUserId: successor }),
      "IN_FLIGHT_ON_OLD_ROUTE"
    );
    assert.ok(message.includes(oldCase.intakeNumber), `사유에 접수번호가 없다: ${message}`);
    assert.deepEqual(await userRow(target), before);
    assert.equal(await routeCount("FINAL_SHIPMENT"), 2, "거절됐는데 새 판이 얹혔다");
    assert.deepEqual(await openShipmentRow(oldCase.id), rowBefore);
  });

  test("마지막 대표 · 위임 · 메일 수신자 · 개발자 — 대표는 이어받을 사람에게, 위임은 모두 닫고, 부품 요청 · 불출 신청은 그대로", async () => {
    const target = await createTestUser("마지막 대표 대상", { isShipmentRepresentative: true, isDeveloper: true });
    const successor = await createTestUser("대표 이어받을 사람");
    const delegate = await createTestUser("위임 대리인");
    const giver = await createTestUser("위임을 준 사람");

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const earlierRevokedAt = new Date(now - 4 * day);
    const delegationRows = await db
      .insert(shipmentApprovalDelegations)
      .values([
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
          representativeUserId: giver,
          delegateUserId: target,
          startsAt: new Date(now - day),
          endsAt: new Date(now + day),
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
          revokedByUserId: giver,
          revokedAt: earlierRevokedAt,
        },
      ])
      .returning({ id: shipmentApprovalDelegations.id, status: shipmentApprovalDelegations.status });
    const alreadyRevokedId = delegationRows[3].id;

    await db.insert(intakeMailRecipients).values({ userId: target, addedBy: superAdminId });
    const [partRequest] = await db
      .insert(inventoryPartRequests)
      .values({ requestedByUserId: target, status: "PENDING" })
      .returning({ id: inventoryPartRequests.id });
    const partIssueRequest = await insertPartIssueRequest({ requestedByUserId: target });

    // Arrange-only: 시험 DB 의 다른 활성 대표를 잠시 내린다 — finally 에서 되돌린다.
    const others = (
      await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.isShipmentRepresentative, true),
            eq(users.isDeleted, false),
            eq(users.isActive, true),
            notInArray(users.id, createdTestUserIds)
          )
        )
    ).map((row) => row.id);
    if (others.length > 0) {
      await db.update(users).set({ isShipmentRepresentative: false }).where(inArray(users.id, others));
    }
    try {
      // 마지막 대표라 결재 이어받을 사람이 필요하다.
      expectFail(await del(target), "APPROVAL_SUCCESSOR_REQUIRED");

      const summary = expectOk(await del(target, { approvalSuccessorUserId: successor }));
      assert.equal(summary.representativeHandedTo, successor);
      assert.equal(summary.revokedDelegations, 3);
      assert.equal(summary.developerFlagCleared, true);
      assert.equal(summary.intakeMailRecipientRemoved, true);

      const targetAfter = await userRow(target);
      assert.equal(targetAfter.isShipmentRepresentative, false);
      assert.equal(targetAfter.isDeveloper, false);
      assert.equal((await userRow(successor)).isShipmentRepresentative, true, "이어받을 사람이 대표가 아니다");

      const history = await db
        .select({
          targetUserId: representativeChangeHistory.targetUserId,
          previousValue: representativeChangeHistory.previousValue,
          newValue: representativeChangeHistory.newValue,
          changedByUserId: representativeChangeHistory.changedByUserId,
          reason: representativeChangeHistory.reason,
        })
        .from(representativeChangeHistory)
        .where(inArray(representativeChangeHistory.targetUserId, [target, successor]))
        .orderBy(asc(representativeChangeHistory.createdAt));
      assert.equal(history.length, 2);
      const targetHistory = history.find((row) => row.targetUserId === target);
      const successorHistory = history.find((row) => row.targetUserId === successor);
      assert.deepEqual(targetHistory, {
        targetUserId: target,
        previousValue: true,
        newValue: false,
        changedByUserId: superAdminId,
        reason: "[계정 삭제] 퇴사",
      });
      assert.ok(successorHistory);
      assert.equal(successorHistory.previousValue, false);
      assert.equal(successorHistory.newValue, true);
      assert.ok(successorHistory.reason?.startsWith("[계정 삭제]"), String(successorHistory.reason));

      const delegations = await db
        .select({
          id: shipmentApprovalDelegations.id,
          status: shipmentApprovalDelegations.status,
          revokedByUserId: shipmentApprovalDelegations.revokedByUserId,
          revokedAt: shipmentApprovalDelegations.revokedAt,
        })
        .from(shipmentApprovalDelegations)
        .where(inArray(shipmentApprovalDelegations.id, delegationRows.map((row) => row.id)));
      for (const row of delegations) {
        assert.equal(row.status, "REVOKED", row.id);
        if (row.id === alreadyRevokedId) {
          assert.equal(row.revokedByUserId, giver, "이미 닫힌 위임을 다시 닫았다");
          assert.equal(row.revokedAt?.getTime(), earlierRevokedAt.getTime());
        } else {
          assert.equal(row.revokedByUserId, superAdminId);
        }
      }

      const recipients = await db
        .select({ id: intakeMailRecipients.id })
        .from(intakeMailRecipients)
        .where(eq(intakeMailRecipients.userId, target));
      assert.deepEqual(recipients, [], "접수 메일 수신자 행이 남았다");

      const developerAudit = (await auditRowsFor("users", target)).filter(
        (row) => row.actionType === "UPDATE"
      );
      assert.deepEqual(
        developerAudit.map((row) => [row.previousValue, row.newValue]),
        [[{ isDeveloper: true }, { isDeveloper: false, cause: { kind: "USER_DELETION", deletedUserId: target } }]]
      );

      const [partRequestAfter] = await db
        .select({ status: inventoryPartRequests.status })
        .from(inventoryPartRequests)
        .where(eq(inventoryPartRequests.id, partRequest.id));
      assert.equal(partRequestAfter.status, "PENDING", "부품 요청은 그대로여야 한다");
      const [partIssueAfter] = await db
        .select({ status: inventoryPartIssueRequests.status })
        .from(inventoryPartIssueRequests)
        .where(eq(inventoryPartIssueRequests.id, partIssueRequest));
      assert.equal(partIssueAfter.status, "PENDING_APPROVAL", "불출 신청은 그대로여야 한다");
    } finally {
      if (others.length > 0) {
        await db.update(users).set({ isShipmentRepresentative: true }).where(inArray(users.id, others));
      }
    }
  });
});

describe("이어받을 사람 — 요구 · 자격 · 멈춤", () => {
  test("미리보기의 requires 와 같은 코드로 요구하고, 자격이 없으면 거절한다 — 거절되면 아무것도 바뀌지 않는다", async () => {
    const target = await createTestUser("요구 대상");
    const stepA = await createTestUser("요구 1단계");
    const locked = await createTestUser("요구 잠긴 사람", { lockedAt: new Date() });
    const admin = await createTestUser("요구 관리자", { role: "ADMIN" });
    const nextEngineer = await createTestUser("요구 엔지니어");
    await saveRoute("FINAL_SHIPMENT", [stepA, target]);
    await createTestCase({ assignedEngineerId: target });

    const preview = await getUserDeletionPreview(target, superAdminId);
    assert.equal(preview.ok, true, JSON.stringify(preview));
    if (!preview.ok) return;
    assert.deepEqual(preview.requires, {
      approvalSuccessor: true,
      engineerSuccessor: true,
      approvalSuccessorMustInspect: false,
    });

    const before = await userRow(target);
    expectFail(await del(target), "APPROVAL_SUCCESSOR_REQUIRED");
    expectFail(await del(target, { approvalSuccessorUserId: nextEngineer }), "ENGINEER_SUCCESSOR_REQUIRED");
    expectFail(
      await del(target, { approvalSuccessorUserId: locked, engineerSuccessorUserId: nextEngineer }),
      "INVALID_SUCCESSOR"
    );
    expectFail(
      await del(target, { approvalSuccessorUserId: stepA, engineerSuccessorUserId: nextEngineer }),
      "SUCCESSOR_ALREADY_IN_ROUTE"
    );
    expectFail(
      await del(target, { approvalSuccessorUserId: admin, engineerSuccessorUserId: admin }),
      "INVALID_SUCCESSOR"
    );
    expectFail(await del(target, { approvalSuccessorUserId: target.toUpperCase() }), "VALIDATION_ERROR");
    assert.deepEqual(await userRow(target), before);
    assert.equal(await routeCount("FINAL_SHIPMENT"), 1, "거절됐는데 새 판이 얹혔다");

    // 제대로 고르면 된다 — 결재 쪽 · 담당 쪽이 다른 사람이어도.
    expectOk(await del(target, { approvalSuccessorUserId: admin, engineerSuccessorUserId: nextEngineer }));
  });

  test("이어받을 사람이 진행 중 결재 사슬의 요청자면 SUCCESSOR_IS_REQUESTER", async () => {
    const target = await createTestUser("요청자 대상");
    const stepA = await createTestUser("요청자 1단계");
    const successor = await createTestUser("요청자 겸 이어받을 사람");
    await saveRoute("FINAL_SHIPMENT", [stepA, target]);

    const chainCase = await createTestCase();
    await approveInspection(chainCase.id);
    const requested = await requestRepairCaseApproval(chainCase.id, "FINAL_SHIPMENT", successor, null);
    assert.equal(requested.ok, true, JSON.stringify(requested));

    expectFail(await del(target, { approvalSuccessorUserId: successor }), "SUCCESSOR_IS_REQUESTER");
    assert.equal((await userRow(target)).isDeleted, false);
  });

  test("새 판이 거절할 사람이 같은 판에 있으면 ROUTE_UPDATE_REJECTED", async () => {
    const target = await createTestUser("거절 판 대상");
    const stepA = await createTestUser("거절 판 1단계");
    const successor = await createTestUser("거절 판 이어받을 사람");
    await saveRoute("FINAL_SHIPMENT", [stepA, target]);
    await db.update(users).set({ lockedAt: new Date() }).where(eq(users.id, stepA));

    const message = expectFail(await del(target, { approvalSuccessorUserId: successor }), "ROUTE_UPDATE_REJECTED");
    assert.ok(message.includes("거절 판 1단계") && message.includes("잠긴 계정입니다"), message);
    assert.equal(await routeCount("FINAL_SHIPMENT"), 1);
    assert.equal((await userRow(target)).isDeleted, false);
  });

  test("검수 수동 지정을 넘겨받을 사람은 검수 역할이어야 한다", async () => {
    const target = await createTestUser("검수 대상");
    const inventoryManager = await createTestUser("검수 재고 담당", { role: "INVENTORY_MANAGER" });
    const admin = await createTestUser("검수 관리자", { role: "ADMIN" });

    const inspectionCase = await createTestCase();
    const inspection = await requestRepairCaseApproval(inspectionCase.id, "REPAIR_INSPECTION", engineerId, null, target);
    assert.equal(inspection.ok, true, JSON.stringify(inspection));

    expectFail(await del(target, { approvalSuccessorUserId: inventoryManager }), "INVALID_SUCCESSOR");
    expectOk(await del(target, { approvalSuccessorUserId: admin }));

    const [row] = await db
      .select({ assignedApproverUserId: repairCaseApprovals.assignedApproverUserId })
      .from(repairCaseApprovals)
      .where(and(eq(repairCaseApprovals.repairCaseId, inspectionCase.id), eq(repairCaseApprovals.status, "REQUESTED")));
    assert.equal(row.assignedApproverUserId, admin);
  });
});

describe("동시성", () => {
  test("같은 대상을 동시에 두 번 지우면 하나만 성공하고 판도 하나만 얹힌다", async () => {
    const target = await createTestUser("동시 대상");
    const successor = await createTestUser("동시 이어받을 사람");
    await saveRoute("FINAL_SHIPMENT", [target]);
    const expectedVersion = await versionOf(target);

    const results = await Promise.all([
      del(target, { expectedVersion, approvalSuccessorUserId: successor }),
      del(target, { expectedVersion, approvalSuccessorUserId: successor }),
    ]);
    assert.equal(results.filter((result) => result.ok).length, 1, JSON.stringify(results));
    const failed = results.find((result) => !result.ok);
    assert.ok(failed && !failed.ok && ["NOT_FOUND", "CONFLICT"].includes(failed.code), JSON.stringify(failed));
    assert.equal(await routeCount("FINAL_SHIPMENT"), 2, "판이 한 번만 얹혀야 한다");
  });

  test("두 최고관리자가 서로를 동시에 지우면 하나만 성공한다", async () => {
    const first = await createTestUser("서로 최고관리자 1", { role: "SUPER_ADMIN" });
    const second = await createTestUser("서로 최고관리자 2", { role: "SUPER_ADMIN" });
    const [firstVersion, secondVersion] = [await versionOf(first), await versionOf(second)];

    const results = await Promise.all([
      del(second, { actorUserId: first, expectedVersion: secondVersion }),
      del(first, { actorUserId: second, expectedVersion: firstVersion }),
    ]);
    assert.equal(results.filter((result) => result.ok).length, 1, JSON.stringify(results));
    const failed = results.find((result) => !result.ok);
    assert.ok(failed && !failed.ok && failed.code === "FORBIDDEN", JSON.stringify(failed));
    const deletedCount = [await userRow(first), await userRow(second)].filter((row) => row.isDeleted).length;
    assert.equal(deletedCount, 1);
  });

  test("삭제와 결재선 저장이 겹쳐도 지운 사람이 현재 판에 남지 않는다", async () => {
    const target = await createTestUser("저장 겹침 대상");
    const stepA = await createTestUser("저장 겹침 1단계");
    const successor = await createTestUser("저장 겹침 이어받을 사람");
    await saveRoute("FINAL_SHIPMENT", [stepA]);

    const [deletion, saved] = await Promise.all([
      del(target, { approvalSuccessorUserId: successor }),
      saveShipmentApprovalRoute([stepA, target], superAdminId, "FINAL_SHIPMENT"),
    ]);
    expectOk(deletion);
    const current = await currentRoute("FINAL_SHIPMENT");
    assert.ok(!current.approverIds.includes(target), `지운 사람이 현재 판에 남았다: ${JSON.stringify(current)}`);
    if (saved.ok) {
      // 저장이 먼저였다 — 삭제가 그 판에서 자리를 이어받을 사람으로 바꿨다.
      assert.deepEqual(current.approverIds, [stepA, successor]);
    } else {
      // 삭제가 먼저였다 — 저장이 지워진 계정을 거절했다.
      assert.equal(saved.code, "INVALID_INPUT");
    }
  });

  test("삭제와 승인 요청이 겹쳐도 새 결재 행이 지운 사람에게 지정되지 않는다", async () => {
    const target = await createTestUser("요청 겹침 대상");
    const successor = await createTestUser("요청 겹침 이어받을 사람");
    await saveRoute("FINAL_SHIPMENT", [target]);
    const chainCase = await createTestCase();
    await approveInspection(chainCase.id);

    const [deletion, requested] = await Promise.all([
      del(target, { approvalSuccessorUserId: successor }),
      requestRepairCaseApproval(chainCase.id, "FINAL_SHIPMENT", engineerId, null),
    ]);
    expectOk(deletion);
    assert.equal(requested.ok, true, JSON.stringify(requested));
    const open = await openShipmentRow(chainCase.id);
    assert.equal(open.assignedApproverUserId, successor, "🔴 새 결재 행이 지운 사람에게 지정됐다");
  });

  test("삭제와 결재 결정이 겹쳐도 교착 없이 끝나고 다음 행은 이어받을 사람에게 간다", async () => {
    const target = await createTestUser("결정 겹침 대상");
    const stepA = await createTestUser("결정 겹침 1단계");
    const successor = await createTestUser("결정 겹침 이어받을 사람");
    await saveRoute("FINAL_SHIPMENT", [stepA, target]);
    const chainCase = await createTestCase();
    await approveInspection(chainCase.id);
    const requested = await requestRepairCaseApproval(chainCase.id, "FINAL_SHIPMENT", engineerId, null);
    assert.equal(requested.ok, true, JSON.stringify(requested));

    const [deletion, decided] = await Promise.all([
      del(target, { approvalSuccessorUserId: successor }),
      decideRepairCaseApproval(chainCase.id, "FINAL_SHIPMENT", "APPROVED", stepA, null),
    ]);
    expectOk(deletion);
    assert.equal(decided.ok, true, JSON.stringify(decided));
    const open = await openShipmentRow(chainCase.id);
    assert.equal(open.assignedApproverUserId, successor, "🔴 다음 단계가 지운 사람에게 갔다");
    assert.equal(open.routeStepOrder, 2);
  });
});

describe("되살리기", () => {
  test("삭제 뒤 포털 로그인으로 되살아나도 대표 · 개발자 · 위임 · 메일 수신자 · 결재선 자리는 돌아오지 않고, 새 version 으로 다시 지울 수 있다", async () => {
    const subject = `userdel-sso-${randomUUID()}`;
    const target = await createTestUser("되살릴 대상", {
      ssoSubject: subject,
      isShipmentRepresentative: true,
      isDeveloper: true,
    });
    await createTestUser("되살리기 다른 대표", { isShipmentRepresentative: true });
    const stepA = await createTestUser("되살리기 1단계");
    const successor = await createTestUser("되살리기 이어받을 사람");
    const delegate = await createTestUser("되살리기 대리인");
    await saveRoute("FINAL_SHIPMENT", [stepA, target]);
    const now = Date.now();
    const [delegation] = await db
      .insert(shipmentApprovalDelegations)
      .values({
        representativeUserId: target,
        delegateUserId: delegate,
        startsAt: new Date(now - 1000),
        endsAt: new Date(now + 60 * 60 * 1000),
        status: "ACTIVE",
        assignedByUserId: superAdminId,
      })
      .returning({ id: shipmentApprovalDelegations.id });
    await db.insert(intakeMailRecipients).values({ userId: target, addedBy: superAdminId });
    const versionBefore = await versionOf(target);

    expectOk(await del(target, { approvalSuccessorUserId: successor }));

    const restored = await restoreDeletedSsoUser(subject);
    assert.ok(restored, "포털 로그인으로 되살아나야 한다");
    assert.equal(restored.id, target);

    const row = await userRow(target);
    assert.equal(row.isDeleted, false);
    assert.equal(row.isShipmentRepresentative, false, "대표가 되살아났다");
    assert.equal(row.isDeveloper, false, "개발자 표시가 되살아났다");
    assert.equal(row.version, versionBefore + 2, "삭제 · 되살리기가 각각 version 을 올려야 한다");

    const [delegationAfter] = await db
      .select({ status: shipmentApprovalDelegations.status })
      .from(shipmentApprovalDelegations)
      .where(eq(shipmentApprovalDelegations.id, delegation.id));
    assert.equal(delegationAfter.status, "REVOKED");
    const recipients = await db
      .select({ id: intakeMailRecipients.id })
      .from(intakeMailRecipients)
      .where(eq(intakeMailRecipients.userId, target));
    assert.deepEqual(recipients, []);
    assert.deepEqual((await currentRoute("FINAL_SHIPMENT")).approverIds, [stepA, successor]);

    // 다시 지울 수 있다 — 되살아난 계정에는 걸린 것이 없으므로 이어받을 사람도 필요 없다.
    expectOk(await del(target, { expectedVersion: row.version }));
    assert.equal((await userRow(target)).isDeleted, true);
  });
});

describe("감사 기록", () => {
  test("이 파일이 남긴 감사 기록 어디에도 이메일 · sso_subject 가 없다", async () => {
    const people = await db
      .select({ email: users.email, ssoSubject: users.ssoSubject })
      .from(users)
      .where(inArray(users.id, createdTestUserIds));
    const rows = await db
      .select({ previousValue: auditLogs.previousValue, newValue: auditLogs.newValue })
      .from(auditLogs)
      .where(inArray(auditLogs.actorUserId, createdTestUserIds));
    assert.ok(rows.length > 0, "살펴볼 감사 기록이 없다");
    const text = JSON.stringify(rows);
    for (const person of people) {
      assert.ok(!text.includes(person.email), `감사 기록에 이메일이 실렸다: ${person.email}`);
      if (person.ssoSubject) {
        assert.ok(!text.includes(person.ssoSubject), `감사 기록에 sso_subject 가 실렸다: ${person.ssoSubject}`);
      }
    }
  });
});
