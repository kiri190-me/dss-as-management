import "../../../../scripts/load-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, like, or } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  approvalRouteDelegations,
  auditLogs,
  customers,
  products,
  quoteApprovals,
  quotes,
  repairCaseApprovals,
  repairCaseIntakeSequences,
  repairCases,
  shipmentApprovalRouteSteps,
  shipmentApprovalRoutes,
  users,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import { decideRepairCaseApproval, requestRepairCaseApproval } from "./repair-case-approvals";
import { createQuote } from "./quotes";
import { decideQuoteApproval, requestQuoteApproval } from "./quote-approvals";
import {
  createApprovalRouteDelegation,
  revokeApprovalRouteDelegation,
} from "./approval-route-delegations";
import { saveShipmentApprovalRoute } from "./shipment-approval-routes";
import { getCurrentShipmentApprovalRoute } from "../queries/shipment-approval-routes";
import { resolveApprovalValidity } from "../queries/repair-case-approvals";
import { listRepairCasesPendingMyApproval } from "../queries/repair-case-approvals-pending";
import { listQuoteApprovalsPendingMyApproval } from "../queries/quote-approvals-pending";
import { QUOTE_APPROVAL_ROUTE_SCOPE } from "@/lib/domain/quote-approval-rules";
import type { ShipmentApprovalRouteScope } from "@/lib/domain/shipment-approval-route";
import type { QuoteFields } from "@/lib/validation/quote-input";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 결재선 단계 위임이 **실제 결재에 걸린다** — 실제 DB (시험 DB)
 * ============================================================================
 * 0119 로 만든 `approval_route_delegations` 는 2026-10-26 까지 **적어 두기만** 하고
 * 결재를 누를 때 쓰이지 않았다. 이 시험은 그 연결을 못 박는다.
 *
 * ── 🔴 걸리는 결재는 **둘뿐**이다 (2026-10-26 사용자 결정) ──────────────
 *  · 최종 출하 승인 · 견적서 승인 → 걸린다(여기서 잰다).
 *  · A/S 안의 **부품 불출** → **안 걸린다.** 빈 목록(NO_ROUTE_DELEGATIONS)을
 *    넘긴다 — 까닭은 mutations/inventory-part-issue-requests.ts 의 지정 관문
 *    주석에 있고, 그 사실은 그쪽 통합 시험이 같은 자리에서 잰다.
 *  · 수리 검수 승인 → 해당 없음. 결재선을 탈 수 없어(표의 CHECK) 대신할 단계가
 *    애초에 없다.
 *
 * ── 여기서 지키는 것 일곱 ───────────────────────────────────────────────
 *  1. 🔴 대리인이 **최종 출하**를 대신 누를 수 있다.
 *  2. 🔴 대리인이 **견적서**를 대신 누를 수 있다.
 *  3. 🔴 기록에 **누가 눌렀는가**(decided_by_user_id)와 **누구 자리였는가**
 *     (delegated_from_user_id)가 **둘 다** 남는다 — 양쪽 결재 모두.
 *  4. **기간이 지난** 위임으로는 못 누른다.
 *  5. **되돌린** 위임으로는 못 누른다.
 *  6. 🔴 **위임이 없는 남**은 여전히 못 누른다 — 넓히기만 했지 구멍이 안 생겼다.
 *  7. 🔴 **대기 목록에 위임받은 건이 보인다**(종 · 통합 승인함의 원본). 단추는
 *     보이는데 누르면 거절되거나 그 반대가 되면 안 된다.
 *
 * ── 격리·청소 규약 ──────────────────────────────────────────────────────
 * repair-case-approvals-route.integration.test.ts · quote-approvals.integration
 * .test.ts 를 그대로 본떴다. 이 파일이 만든 "routedelegdecide-test-" 계정과
 * "D9510" 접수 건, "RDD-TEST-{토큰}-" 견적서만 쓴다.
 * ⚠️ **판·단계는 afterEach 로 반드시 걷는다** — 시험 DB 에 판이 남으면 다른 시험
 * 파일이 갑자기 결재선을 타면서 깨진다(그쪽은 판이 하나도 없는 것을 전제로 한다).
 * 사람 참조가 RESTRICT 라 삭제에는 순서가 있다: 결재 행 → 견적서 → 위임 → 단계 →
 * 판 → 감사 기록 → 사람.
 * ============================================================================
 */

const RUN = randomUUID().slice(0, 8);
const TEST_EMAIL_PREFIX = "routedelegdecide-test-";
const TEST_MODEL_PREFIX = "ROUTEDELEGDECIDE-TEST-";
const TEST_YEAR_MONTH = "9510";
const TEST_INTAKE_PREFIX = `D${TEST_YEAR_MONTH}%`;
const TEST_RECEIVED_AT = "2095-10-10";
const TEST_SHIPMENT_DATE = "2095-10-20";
const TEST_QUOTE_NUMBER_PREFIX = `RDD-TEST-${RUN}-`;
const TEST_QUOTE_DATE = "2095-10-10";

const DAY = 24 * 60 * 60 * 1000;

let customerId: string;
/** 요청자 — 접수 건 결재도 견적서 결재도 이 사람이 올린다(둘 다 쓰기 권한이 있다). */
let requesterId: string;
/** 판을 저장하는 사람. */
let superAdminId: string;
/** 🔴 **결재권자** — 두 결재선의 1단계에 올라간다. 위임을 맡기는 쪽이다. */
let approverId: string;
/** 그 결재권을 맡는 사람. 대표도 아니고 결재선에도 없다. */
let delegateId: string;
/** 아무 위임도 못 받은 남 — 대조군이다. */
let strangerId: string;

const createdTestUserIds: string[] = [];
const createdCaseIds: string[] = [];
const createdQuoteIds: string[] = [];

async function createTestUser(
  name: string,
  overrides: Partial<typeof users.$inferInsert> = {}
): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      email: `${TEST_EMAIL_PREFIX}${randomUUID().slice(0, 8)}@example.test`,
      name,
      // 접수 건 결재를 요청할 수 있고 견적서도 고칠 수 있는 역할.
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

function baseCreateInput(): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
    customerId,
    endUserId: null,
    assignedEngineerId: requesterId,
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
}

/**
 * 최종 출하 승인이 **1단계(approver)에 열려 있는** 접수 건 하나. 검수 승인까지
 * 진짜 경로로 받아 둔다(출하 요청 mutation 이 그것을 사전 조건으로 본다).
 */
async function arrangePendingShipment(): Promise<string> {
  const created = await createRepairCase(baseCreateInput());
  assert.equal(created.ok, true, `setup create failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  createdCaseIds.push(created.id);

  const inspection = await requestRepairCaseApproval(created.id, "REPAIR_INSPECTION", requesterId, null);
  assert.equal(inspection.ok, true, `setup inspection request failed: ${JSON.stringify(inspection)}`);
  const inspected = await decideRepairCaseApproval(created.id, "REPAIR_INSPECTION", "APPROVED", requesterId, null);
  assert.equal(inspected.ok, true, `setup inspection approval failed: ${JSON.stringify(inspected)}`);

  const requested = await requestRepairCaseApproval(created.id, "FINAL_SHIPMENT", requesterId, "출하 승인 요청");
  assert.equal(requested.ok, true, `setup shipment request failed: ${JSON.stringify(requested)}`);

  const [row] = await shipmentRows(created.id);
  assert.equal(row.assignedApproverUserId, approverId, "1단계가 결재권자에게 가지 않았다");
  assert.equal(row.status, "REQUESTED");
  return created.id;
}

/** 그 건의 최종 출하 승인 행들 — 오래된 것부터. */
async function shipmentRows(repairCaseId: string) {
  return db
    .select()
    .from(repairCaseApprovals)
    .where(
      and(
        eq(repairCaseApprovals.repairCaseId, repairCaseId),
        eq(repairCaseApprovals.approvalType, "FINAL_SHIPMENT")
      )
    )
    .orderBy(asc(repairCaseApprovals.requestedAt));
}

function quoteFields(): QuoteFields {
  return {
    quoteNumber: `${TEST_QUOTE_NUMBER_PREFIX}${randomUUID().slice(0, 8)}`,
    kind: "DOMESTIC",
    quoteDate: TEST_QUOTE_DATE,
    repairCaseId: null,
    intakeNumberText: null,
    customerId: null,
    customerNameText: "위임시험 공급처",
    modelNameText: null,
    lotNumberText: null,
    serialNumberText: null,
    faultDescriptionText: null,
    subject: "위임 시험 견적",
    validity: null,
    delivery: null,
    payment: null,
    remarks: null,
    workCost: "0",
    laborEquipmentKind: null,
    laborBaseCost: null,
    investigationExcluded: false,
    powerTestExcluded: false,
    laborPowerTestDeduction: null,
    documentExcluded: false,
    isExcelOnly: false,
    manualSupplyAmount: null,
    repairTasks: [],
    workScopeLines: [],
    items: [],
  };
}

/** 결재가 **1단계(approver)에 열려 있는** 견적서 한 장. */
async function arrangePendingQuote(): Promise<string> {
  const created = await createQuote({ fields: quoteFields(), actorUserId: requesterId });
  assert.equal(created.ok, true, `setup quote create failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  createdQuoteIds.push(created.id);

  const requested = await requestQuoteApproval({
    quoteId: created.id,
    actorUserId: requesterId,
    requestReason: "결재 올림",
  });
  assert.equal(requested.ok, true, `setup quote request failed: ${JSON.stringify(requested)}`);

  const [row] = await quoteRows(created.id);
  assert.equal(row.assignedApproverUserId, approverId, "1단계가 결재권자에게 가지 않았다");
  assert.equal(row.status, "REQUESTED");
  return created.id;
}

/** 그 장의 결재 행들 — 오래된 것부터. */
async function quoteRows(quoteId: string) {
  return db
    .select()
    .from(quoteApprovals)
    .where(eq(quoteApprovals.quoteId, quoteId))
    .orderBy(asc(quoteApprovals.requestedAt));
}

/**
 * 🔵 용도를 글자로 적지 않는다 — 「QUOTE」는 도메인 상수 하나가 쥐고 있다
 * (domain/quote-approval-rules.ts). 오타 하나면 「판이 없다」로 조용히 보이고,
 * 그때 이 시험은 요청 단계에서 엉뚱한 이유로 깨진다.
 */
async function saveRoute(
  scope: ShipmentApprovalRouteScope,
  approverUserIds: string[]
): Promise<void> {
  const result = await saveShipmentApprovalRoute(approverUserIds, superAdminId, scope);
  assert.equal(result.ok, true, `setup route save failed: ${JSON.stringify(result)}`);
  assert.ok(await getCurrentShipmentApprovalRoute(scope), "저장했는데 현재 판이 없다");
}

/**
 * approver → delegate 위임 한 줄. 기본은 **지금 살아 있는** 기간이다.
 * 되돌리기에 쓸 수 있게 id 를 돌려준다.
 */
async function grantDelegation(
  options: { startsAt?: Date; endsAt?: Date; delegatorUserId?: string; delegateUserId?: string } = {}
): Promise<string> {
  const now = Date.now();
  const created = await createApprovalRouteDelegation({
    delegatorUserId: options.delegatorUserId ?? approverId,
    delegateUserId: options.delegateUserId ?? delegateId,
    startsAt: options.startsAt ?? new Date(now - DAY),
    endsAt: options.endsAt ?? new Date(now + DAY),
    reason: "",
    // 🔴 결재권자 **본인**이 맡긴다 — 권한을 보지 않는 길이다(남을 대신 세울 때만 본다).
    actorUserId: options.delegatorUserId ?? approverId,
  });
  assert.equal(created.ok, true, `setup delegation failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  return created.id;
}

/** 이 파일이 남긴 결재 행 · 견적서 · 위임 · 판 · 단계 · 감사 기록을 걷는다. */
async function removeFixtures(): Promise<void> {
  if (createdCaseIds.length > 0) {
    await db.delete(repairCaseApprovals).where(inArray(repairCaseApprovals.repairCaseId, createdCaseIds));
  }
  if (createdTestUserIds.length === 0) return;

  await db.delete(repairCaseApprovals).where(inArray(repairCaseApprovals.requestedByUserId, createdTestUserIds));
  if (createdQuoteIds.length > 0) {
    await db.delete(quoteApprovals).where(inArray(quoteApprovals.quoteId, createdQuoteIds));
  }
  await db.delete(quoteApprovals).where(inArray(quoteApprovals.requestedByUserId, createdTestUserIds));
  if (createdQuoteIds.length > 0) {
    await db.delete(quotes).where(inArray(quotes.id, createdQuoteIds));
    createdQuoteIds.length = 0;
  }
  // 🔴 위임 줄은 사람을 RESTRICT 로 넷이나 가리킨다 — 남으면 사람 삭제가 막힌다.
  await db
    .delete(approvalRouteDelegations)
    .where(
      or(
        inArray(approvalRouteDelegations.delegatorUserId, createdTestUserIds),
        inArray(approvalRouteDelegations.delegateUserId, createdTestUserIds),
        inArray(approvalRouteDelegations.createdByUserId, createdTestUserIds),
        inArray(approvalRouteDelegations.revokedByUserId, createdTestUserIds)
      )
    );
  await db
    .delete(shipmentApprovalRouteSteps)
    .where(inArray(shipmentApprovalRouteSteps.approverUserId, createdTestUserIds));
  await db
    .delete(shipmentApprovalRoutes)
    .where(inArray(shipmentApprovalRoutes.createdByUserId, createdTestUserIds));
  // audit_logs.actor_user_id → users (restrict): 행위자로만 고른다 —
  // target_record_id 로 고르는 모양은 test-cleanup-static-safety.test.ts 가 금지한다.
  await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, createdTestUserIds));
}

/** 이전 실행이 중간에 끊겨 남은 이 파일의 계정과 그 흔적까지 걷는다. */
async function removeLeftovers(): Promise<void> {
  const leftovers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  const ids = leftovers.map((row) => row.id);
  if (ids.length === 0) return;

  const leftoverCases = await db
    .select({ id: repairCases.id })
    .from(repairCases)
    .where(like(repairCases.intakeNumber, TEST_INTAKE_PREFIX));
  if (leftoverCases.length > 0) {
    await db
      .delete(repairCaseApprovals)
      .where(inArray(repairCaseApprovals.repairCaseId, leftoverCases.map((row) => row.id)));
  }
  await db.delete(repairCaseApprovals).where(inArray(repairCaseApprovals.requestedByUserId, ids));
  await db.delete(quoteApprovals).where(inArray(quoteApprovals.requestedByUserId, ids));
  await db.delete(quotes).where(inArray(quotes.createdBy, ids));
  await db
    .delete(approvalRouteDelegations)
    .where(
      or(
        inArray(approvalRouteDelegations.delegatorUserId, ids),
        inArray(approvalRouteDelegations.delegateUserId, ids),
        inArray(approvalRouteDelegations.createdByUserId, ids),
        inArray(approvalRouteDelegations.revokedByUserId, ids)
      )
    );
  await db.delete(shipmentApprovalRouteSteps).where(inArray(shipmentApprovalRouteSteps.approverUserId, ids));
  await db.delete(shipmentApprovalRoutes).where(inArray(shipmentApprovalRoutes.createdByUserId, ids));
  await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, ids));

  await db.delete(repairCases).where(like(repairCases.intakeNumber, TEST_INTAKE_PREFIX));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(users).where(inArray(users.id, ids));
}

before(async () => {
  await removeLeftovers();

  const [route] = await db.select({ id: shipmentApprovalRoutes.id }).from(shipmentApprovalRoutes).limit(1);
  assert.equal(route, undefined, "이 시험은 shipment_approval_routes 가 비어 있는 상태를 전제로 합니다");

  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.isDeleted, false))
    .limit(1);
  assert.ok(customer, "expected at least one non-deleted customer in the test DB");
  customerId = customer.id;

  superAdminId = await createTestUser("위임결재시험 최고관리자", { role: "SUPER_ADMIN" });
  requesterId = await createTestUser("위임결재시험 요청자");
  approverId = await createTestUser("위임결재시험 결재권자");
  delegateId = await createTestUser("위임결재시험 대리인");
  strangerId = await createTestUser("위임결재시험 남");
});

afterEach(async () => {
  await removeFixtures();
});

after(async () => {
  await removeFixtures();
  await db.delete(repairCases).where(like(repairCases.intakeNumber, TEST_INTAKE_PREFIX));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

describe("🔴 최종 출하 승인 — 대리인이 대신 누른다", () => {
  test("위임을 받은 사람이 그 단계를 승인한다 — 기록에 **둘 다** 남는다", async () => {
    await saveRoute("FINAL_SHIPMENT", [approverId]);
    const caseId = await arrangePendingShipment();
    await grantDelegation();

    const decided = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", delegateId, null);
    assert.equal(decided.ok, true, `대리인이 막혔다: ${JSON.stringify(decided)}`);

    const [row] = await shipmentRows(caseId);
    assert.equal(row.status, "APPROVED");
    // 🔴 누가 눌렀는가 · 누구 자리였는가 — **둘 다**(2026-10-20 사용자 결정).
    assert.equal(row.decidedByUserId, delegateId, "누른 사람이 안 남았다");
    assert.equal(row.delegatedFromUserId, approverId, "누구 자리였는지가 안 남았다");
    // 지정 칸은 그대로다 — 「원래 누구 차례였나」는 그 칸이 답한다.
    assert.equal(row.assignedApproverUserId, approverId, "지정이 대리인으로 덮였다");

    // 단계가 하나뿐이라 사슬은 여기서 끝나고 출하 문이 열린다.
    assert.equal((await shipmentRows(caseId)).length, 1, "다음 단계 행이 생겼다");
    assert.equal((await resolveApprovalValidity(caseId, "FINAL_SHIPMENT", 1)).state, "VALID");
  });

  test("반려도 같다 — 사유와 함께 두 칸이 남는다", async () => {
    await saveRoute("FINAL_SHIPMENT", [approverId]);
    const caseId = await arrangePendingShipment();
    await grantDelegation();

    const decided = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "REJECTED", delegateId, "부품 재확인");
    assert.equal(decided.ok, true, `대리인이 막혔다: ${JSON.stringify(decided)}`);

    const [row] = await shipmentRows(caseId);
    assert.equal(row.status, "REJECTED");
    assert.equal(row.decisionReason, "부품 재확인");
    assert.equal(row.decidedByUserId, delegateId);
    assert.equal(row.delegatedFromUserId, approverId);
  });

  test("🔴 결재권자 본인이 눌러도 막히지 않고, 그때는 「누구 자리였나」가 비어 있다", async () => {
    // 위임은 **넘기는 것이 아니라 늘리는 것**이다(domain/approval-route-delegation.ts).
    // 맡겨 둔 사람이 중간에 들어와 직접 눌러도 막히면 안 되고, 그 줄은 「직접
    // 눌렀다」로 남아야 한다 — NULL 이 그 뜻이다.
    await saveRoute("FINAL_SHIPMENT", [approverId]);
    const caseId = await arrangePendingShipment();
    await grantDelegation();

    const decided = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", approverId, null);
    assert.equal(decided.ok, true, `결재권자 본인이 막혔다: ${JSON.stringify(decided)}`);

    const [row] = await shipmentRows(caseId);
    assert.equal(row.decidedByUserId, approverId);
    assert.equal(row.delegatedFromUserId, null, "직접 눌렀는데 「대신 눌렀다」로 남았다");
  });
});

describe("🔴 견적서 결재 — 대리인이 대신 누른다", () => {
  test("위임을 받은 사람이 그 단계를 승인한다 — 기록에 **둘 다** 남는다", async () => {
    await saveRoute(QUOTE_APPROVAL_ROUTE_SCOPE, [approverId]);
    const quoteId = await arrangePendingQuote();
    await grantDelegation();

    const decided = await decideQuoteApproval({
      quoteId,
      decision: "APPROVED",
      actorUserId: delegateId,
      decisionReason: null,
    });
    assert.equal(decided.ok, true, `대리인이 막혔다: ${JSON.stringify(decided)}`);

    const [row] = await quoteRows(quoteId);
    assert.equal(row.status, "APPROVED");
    assert.equal(row.decidedByUserId, delegateId, "누른 사람이 안 남았다");
    assert.equal(row.delegatedFromUserId, approverId, "누구 자리였는지가 안 남았다");
    assert.equal(row.assignedApproverUserId, approverId, "지정이 대리인으로 덮였다");
  });

  test("🔴 결재권자 본인이 눌렀으면 「누구 자리였나」가 비어 있다 — 대조", async () => {
    // 위 시험이 「언제나 approver 를 적는다」로도 통과하지 않게 하는 대조다.
    await saveRoute(QUOTE_APPROVAL_ROUTE_SCOPE, [approverId]);
    const quoteId = await arrangePendingQuote();
    await grantDelegation();

    const decided = await decideQuoteApproval({
      quoteId,
      decision: "APPROVED",
      actorUserId: approverId,
      decisionReason: null,
    });
    assert.equal(decided.ok, true, `결재권자 본인이 막혔다: ${JSON.stringify(decided)}`);

    const [row] = await quoteRows(quoteId);
    assert.equal(row.decidedByUserId, approverId);
    assert.equal(row.delegatedFromUserId, null, "직접 눌렀는데 「대신 눌렀다」로 남았다");
  });
});

describe("🔴 살아 있지 않은 위임으로는 못 누른다", () => {
  test("기간이 지난 위임 — 출하도 견적서도 막힌다", async () => {
    await saveRoute("FINAL_SHIPMENT", [approverId]);
    await saveRoute(QUOTE_APPROVAL_ROUTE_SCOPE, [approverId]);
    const caseId = await arrangePendingShipment();
    const quoteId = await arrangePendingQuote();
    const now = Date.now();
    await grantDelegation({ startsAt: new Date(now - 5 * DAY), endsAt: new Date(now - 4 * DAY) });

    const shipment = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", delegateId, null);
    assert.equal(shipment.ok, false);
    if (!shipment.ok) assert.equal(shipment.code, "FORBIDDEN");

    const quote = await decideQuoteApproval({
      quoteId,
      decision: "APPROVED",
      actorUserId: delegateId,
      decisionReason: null,
    });
    assert.equal(quote.ok, false);
    if (!quote.ok) assert.equal(quote.code, "FORBIDDEN");

    // 거절됐으면 행은 그대로 열려 있어야 한다.
    assert.equal((await shipmentRows(caseId))[0].status, "REQUESTED");
    assert.equal((await quoteRows(quoteId))[0].status, "REQUESTED");
  });

  test("아직 시작하지 않은(예정) 위임 — 아직은 못 누른다", async () => {
    await saveRoute("FINAL_SHIPMENT", [approverId]);
    const caseId = await arrangePendingShipment();
    const now = Date.now();
    await grantDelegation({ startsAt: new Date(now + DAY), endsAt: new Date(now + 2 * DAY) });

    const decided = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", delegateId, null);
    assert.equal(decided.ok, false);
    if (!decided.ok) assert.equal(decided.code, "FORBIDDEN");
    assert.equal((await shipmentRows(caseId))[0].status, "REQUESTED");
  });

  test("되돌린 위임 — 되돌리기 전에는 되고, 되돌린 뒤에는 막힌다", async () => {
    await saveRoute("FINAL_SHIPMENT", [approverId]);
    await saveRoute(QUOTE_APPROVAL_ROUTE_SCOPE, [approverId]);
    const caseId = await arrangePendingShipment();
    const quoteId = await arrangePendingQuote();
    const delegationId = await grantDelegation();

    // 🔵 먼저 **되는지**를 확인한다 — 안 그러면 되돌림이 아니라 다른 이유로 막혔을
    //    때도 이 시험이 통과한다(견적서 쪽으로 그것을 잰다).
    const beforeRevoke = await decideQuoteApproval({
      quoteId,
      decision: "APPROVED",
      actorUserId: delegateId,
      decisionReason: null,
    });
    assert.equal(beforeRevoke.ok, true, `되돌리기 전인데 막혔다: ${JSON.stringify(beforeRevoke)}`);

    const revoked = await revokeApprovalRouteDelegation({ delegationId, actorUserId: approverId });
    assert.equal(revoked.ok, true, `되돌리기가 실패했다: ${JSON.stringify(revoked)}`);

    const afterRevoke = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", delegateId, null);
    assert.equal(afterRevoke.ok, false, "되돌린 위임으로 결재가 통과했다");
    if (!afterRevoke.ok) assert.equal(afterRevoke.code, "FORBIDDEN");
    assert.equal((await shipmentRows(caseId))[0].status, "REQUESTED");
  });
});

describe("🔴 넓히기만 했지 구멍이 안 생겼다", () => {
  test("위임이 없는 남은 출하도 견적서도 못 누른다", async () => {
    await saveRoute("FINAL_SHIPMENT", [approverId]);
    await saveRoute(QUOTE_APPROVAL_ROUTE_SCOPE, [approverId]);
    const caseId = await arrangePendingShipment();
    const quoteId = await arrangePendingQuote();
    // 🔴 위임은 **있다**. 다만 남이 아니라 대리인에게 간 것이다 — 「위임이 하나도
    //    없어서 막혔다」로 통과하지 않게 한다.
    await grantDelegation();

    const shipment = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", strangerId, null);
    assert.equal(shipment.ok, false, "위임도 없는 사람이 출하 승인을 눌렀다");
    if (!shipment.ok) assert.equal(shipment.code, "FORBIDDEN");

    const quote = await decideQuoteApproval({
      quoteId,
      decision: "APPROVED",
      actorUserId: strangerId,
      decisionReason: null,
    });
    assert.equal(quote.ok, false, "위임도 없는 사람이 견적서를 승인했다");
    if (!quote.ok) assert.equal(quote.code, "FORBIDDEN");

    assert.equal((await shipmentRows(caseId))[0].status, "REQUESTED");
    assert.equal((await quoteRows(quoteId))[0].status, "REQUESTED");
  });

  test("🔴 위임은 **한 겹**이다 — A→B·B→C 가 이어지지 않는다", async () => {
    // 순수 함수가 지키는 규칙이지만(domain/approval-route-delegation.ts), 실제
    // 결재 경로에서도 그런지 여기서 한 번 더 잰다 — 이어 붙게 되면 결재권자가
    // 동의한 적 없는 사람에게 결재권이 넘어간다.
    await saveRoute("FINAL_SHIPMENT", [approverId]);
    const caseId = await arrangePendingShipment();
    await grantDelegation(); // approver → delegate
    await grantDelegation({ delegatorUserId: delegateId, delegateUserId: strangerId }); // delegate → stranger

    const decided = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", strangerId, null);
    assert.equal(decided.ok, false, "두 겹 위임이 이어졌다");
    if (!decided.ok) assert.equal(decided.code, "FORBIDDEN");
    assert.equal((await shipmentRows(caseId))[0].status, "REQUESTED");
  });
});

describe("🔴 대기 목록 — 보이는 것과 눌리는 것이 같다", () => {
  test("위임받은 건이 접수 건·견적서 대기 목록에 뜬다(남에게는 안 뜬다)", async () => {
    await saveRoute("FINAL_SHIPMENT", [approverId]);
    await saveRoute(QUOTE_APPROVAL_ROUTE_SCOPE, [approverId]);
    const caseId = await arrangePendingShipment();
    const quoteId = await arrangePendingQuote();

    // 위임 **전** — 대리인에게는 아무것도 안 뜬다(대조). 이 줄이 없으면 아래
    // 단언이 「원래부터 떠 있었다」로도 통과한다.
    assert.equal(
      (await listRepairCasesPendingMyApproval(delegateId)).some((item) => item.repairCaseId === caseId),
      false,
      "위임도 없는데 출하 결재가 떠 있다"
    );
    assert.equal(
      (await listQuoteApprovalsPendingMyApproval(delegateId)).some((item) => item.quoteId === quoteId),
      false,
      "위임도 없는데 견적서 결재가 떠 있다"
    );

    await grantDelegation();

    const shipmentItems = await listRepairCasesPendingMyApproval(delegateId);
    const shipmentItem = shipmentItems.find((item) => item.repairCaseId === caseId);
    assert.ok(shipmentItem, "🔴 위임받은 출하 결재가 대기 목록에 없다");
    assert.equal(shipmentItem.approvalType, "FINAL_SHIPMENT");

    const quoteItems = await listQuoteApprovalsPendingMyApproval(delegateId);
    assert.ok(
      quoteItems.some((item) => item.quoteId === quoteId),
      "🔴 위임받은 견적서 결재가 대기 목록에 없다"
    );

    // 결재권자 본인에게도 그대로 뜬다 — 위임은 넘기는 것이 아니라 늘리는 것이다.
    assert.ok(
      (await listRepairCasesPendingMyApproval(approverId)).some((item) => item.repairCaseId === caseId),
      "맡겼더니 결재권자 본인에게서 사라졌다"
    );

    // 🔴 남에게는 여전히 안 뜬다 — 「누구에게나 보인다」로 통과하지 않게 한다.
    assert.equal(
      (await listRepairCasesPendingMyApproval(strangerId)).some((item) => item.repairCaseId === caseId),
      false,
      "위임도 없는 남에게 출하 결재가 떠 있다"
    );
    assert.equal(
      (await listQuoteApprovalsPendingMyApproval(strangerId)).some((item) => item.quoteId === quoteId),
      false,
      "위임도 없는 남에게 견적서 결재가 떠 있다"
    );
  });

  test("되돌린 뒤에는 목록에서도 사라진다 — 단추만 죽고 줄이 남지 않는다", async () => {
    await saveRoute("FINAL_SHIPMENT", [approverId]);
    const caseId = await arrangePendingShipment();
    const delegationId = await grantDelegation();

    assert.ok(
      (await listRepairCasesPendingMyApproval(delegateId)).some((item) => item.repairCaseId === caseId),
      "되돌리기 전인데 목록에 없다"
    );

    const revoked = await revokeApprovalRouteDelegation({ delegationId, actorUserId: approverId });
    assert.equal(revoked.ok, true, `되돌리기가 실패했다: ${JSON.stringify(revoked)}`);

    assert.equal(
      (await listRepairCasesPendingMyApproval(delegateId)).some((item) => item.repairCaseId === caseId),
      false,
      "되돌렸는데 목록에 그대로 있다 — 눌러도 거절되는 줄이 남았다"
    );
  });
});
