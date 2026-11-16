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
import { getApprovalHistoryForCase, resolveApprovalValidity } from "../queries/repair-case-approvals";
import { getQuoteApprovalHistory } from "../queries/quote-approvals";
import { listRepairCasesPendingMyApproval } from "../queries/repair-case-approvals-pending";
import { listQuoteApprovalsPendingMyApproval } from "../queries/quote-approvals-pending";
import type { PortalRouteDelegations } from "@/lib/domain/portal-approval-delegation";
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
 * ── 여기서 지키는 것 열 ─────────────────────────────────────────────────
 * 🔵 머리말이 「일곱」이라 적고 여덟을 세고 있었다. 2026-11-16 에 아래 9·10 을
 *    더하면서 숫자를 실제 개수로 고쳤다 — 주석이 실측과 어긋나면 다음 사람이 그
 *    글을 믿고 잘못 고친다.
 *  1. 🔴 대리인이 **최종 출하**를 대신 누를 수 있다.
 *  2. 🔴 대리인이 **견적서**를 대신 누를 수 있다.
 *  3. 🔴 기록에 **누가 눌렀는가**(decided_by_user_id)와 **누구 자리였는가**
 *     (delegated_from_user_id)가 **둘 다** 남는다 — 양쪽 결재 모두.
 *  4. **기간이 지난** 위임으로는 못 누른다.
 *  5. **되돌린** 위임으로는 못 누른다.
 *  6. 🔴 **위임이 없는 남**은 여전히 못 누른다 — 넓히기만 했지 구멍이 안 생겼다.
 *  7. 🔴 **대기 목록에 위임받은 건이 보인다**(종 · 통합 승인함의 원본). 단추는
 *     보이는데 누르면 거절되거나 그 반대가 되면 안 된다.
 *  8. 🔴 **이력 조회가 그 사실을 이름으로 내보낸다** — 양쪽 결재 모두. 칸에 적기만
 *     하고 조회가 읽지 않으면 화면에서 「위임으로 대신 눌렀다」와 「최고관리자가
 *     비상구로 눌렀다」가 똑같이 보인다(2026-10-26 견적서 쪽이 실제로 그랬다).
 *  9. 🔴 **포털(dss-auth)에 맡긴 위임도 걸린다**(2026-11-16, 설계 B-1·B-4). 고지가
 *     둘이 되었고 **둘 다 산다** — 합집합이고, **갈아타며 이어 붙지는 않는다.**
 *     여기까지 안 이어져 있으면 승인함에서 맡긴 위임이 A/S 에서 아무 일도 안
 *     일으킨다(오류 한 줄 없이).
 * 10. 🔴 **포털에 못 물었을 때** 결재는 그대로 돌고(설계 B-6) 그 사실이 **결과에
 *     실려 나간다**(설계 B-7). 안 실리면 대리인은 「권한이 없습니다」만 받고 까닭을
 *     영영 모른다 — 이 저장소들에서 가장 비싼 결함 모양이다.
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
    // 「새 고객사로 등록」을 누르지 않은 장(2026-11-06) — 고객사를 만들지 않는다.
    newCustomerName: null,
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

describe("🔴 이력이 「누구 자리였나」를 **이름으로** 내보낸다", () => {
  /** 그 사람의 지금 이름 — 글자로 적어 두면 계정 이름이 바뀐 날 시험만 틀린다. */
  async function userName(userId: string): Promise<string> {
    const [row] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
    assert.ok(row, "시험 계정을 찾지 못했다 — 시험의 전제가 사라졌다");
    return row.name;
  }

  test("🔴 견적서 — 위임으로 누른 줄에 **원래 자리 사람의 이름**이 실린다", async () => {
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

    const history = await getQuoteApprovalHistory(quoteId);
    assert.equal(history.length, 1, "이력 줄이 하나가 아니다 — 시험의 전제가 사라졌다");
    const [row] = history;
    assert.equal(row.delegatedFromUserId, approverId);
    assert.equal(row.delegatedFromName, await userName(approverId), "이름이 안 실렸다");
    // 🔵 누른 사람도 함께 — 두 칸을 함께 읽어야 「B 가 A 를 대신해 승인했다」가
    // 복원된다(2026-10-20 사용자 결정). 하나만 실으면 기록이 반쪽이다.
    assert.equal(row.decidedByUserId, delegateId);
    assert.equal(row.decidedByName, await userName(delegateId));
  });

  test("🔴 견적서 — 직접 누른 줄에는 그 이름이 **없다**", async () => {
    // 위 시험이 「언제나 결재권자 이름을 싣는다」로도 통과하지 않게 하는 대조다.
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

    const [row] = await getQuoteApprovalHistory(quoteId);
    assert.equal(row.delegatedFromUserId, null);
    assert.equal(row.delegatedFromName, null, "직접 누른 줄이 위임으로 읽힌다");
    // 🔴 지정 칸은 그대로 실린다 — 「원래 누구 차례였나」는 그쪽이 답한다. 이
    // 줄에서 위임 이름만 비는 것이 「본인이 자기 차례에 눌렀다」의 모양이다.
    assert.equal(row.assignedApproverUserId, approverId);
    assert.equal(row.assignedApproverName, await userName(approverId));
  });

  test("🔴 접수 건 이력과 **같은 모양**이다 — 두 조회가 같은 사실을 다르게 싣지 않는다", async () => {
    await saveRoute("FINAL_SHIPMENT", [approverId]);
    await saveRoute(QUOTE_APPROVAL_ROUTE_SCOPE, [approverId]);
    const caseId = await arrangePendingShipment();
    const quoteId = await arrangePendingQuote();
    await grantDelegation();

    const shipment = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", delegateId, null);
    assert.equal(shipment.ok, true, `대리인이 막혔다: ${JSON.stringify(shipment)}`);
    const quote = await decideQuoteApproval({
      quoteId,
      decision: "APPROVED",
      actorUserId: delegateId,
      decisionReason: null,
    });
    assert.equal(quote.ok, true, `대리인이 막혔다: ${JSON.stringify(quote)}`);

    const [caseRow] = await getApprovalHistoryForCase(caseId);
    const [quoteRow] = await getQuoteApprovalHistory(quoteId);

    // 🔵 **표본이 비어서 공짜로 통과하지 않게** 먼저 둘 다 값이 있는지 본다 —
    // 두 조회가 나란히 null 을 싣는 것으로도 아래 비교는 통과한다.
    assert.equal(caseRow.delegatedFromUserId, approverId, "접수 건 쪽이 안 실었다");
    assert.equal(quoteRow.delegatedFromUserId, approverId, "견적서 쪽이 안 실었다");

    // 같은 사람의 같은 위임이므로 **두 조회가 글자 하나까지 같은 답**을 내야 한다.
    // 값을 베껴 적지 않고 둘을 맞대어 본다 — 한쪽만 바뀌면 여기서 걸린다.
    assert.deepEqual(
      { id: quoteRow.delegatedFromUserId, name: quoteRow.delegatedFromName },
      { id: caseRow.delegatedFromUserId, name: caseRow.delegatedFromName },
      "두 결재의 「누구 자리였나」가 서로 다르게 실린다"
    );
    assert.deepEqual(
      { id: quoteRow.decidedByUserId, name: quoteRow.decidedByName },
      { id: caseRow.decidedByUserId, name: caseRow.decidedByName },
      "두 결재의 「누가 눌렀나」가 서로 다르게 실린다"
    );
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

/* ========================================================================== */
/* 🔴 포털에 맡긴 위임도 **실제 결재에 걸린다** (2026-11-16)                   */
/*                                                                            */
/* 2026-11-13 결정으로 결재권 위임을 포털(dss-auth) 한 곳에 모았고(설계 B-1),  */
/* **둘 다 살려 두기로** 했다(설계 B-4). 이 묶음이 재는 것은 그 둘째 고지다.   */
/* 🔴 여기까지 안 이어져 있으면 승인함에서 맡긴 위임이 **A/S 에서 아무 일도    */
/*    일으키지 않는다** — 오류 한 줄 없이. 그 상태를 끝내는 것이 이 조각이다.  */
/*                                                                            */
/* 🔵 **포털을 부르지 않는다.** 결재 저장은 망을 타지 않고, 물어 온 결과를     */
/*    **인자로** 받는다(설계 C-3 — 망 호출은 트랜잭션 밖 서버 액션의 일이다).  */
/*    묻는 왕복 자체는 server/integration/portal-delegations.test.ts 가 값으로 */
/*    재고, 액션이 실제로 묻는지는 server/actions/portal-delegation-wiring     */
/*    .test.ts 가 글자로 센다. 여기는 **판정에 걸리는가**만 잰다.              */
/*                                                                            */
/* 🔵 **접수 건은 한 건만 만든다.** 인수번호가 한 달에 99개뿐이라(설계와 무관한 */
/*    공유 자원이다) 나머지는 견적서로 잰다 — 같은 순수 함수가 둘을 다 가른다. */
/* ========================================================================== */

/** 포털이 「이 사람이 대신할 수 있다」고 답한 것 — 이미 A/S id 로 바뀐 값이다. */
function 포털위임(delegatorUserIds: string[]): PortalRouteDelegations {
  return { delegatorUserIds, unavailable: false };
}

/** 🔴 포털이 죽었다. 빈 목록이지만 **「없다」가 아니라 「모른다」**다(설계 B-6). */
const 포털에못물었다: PortalRouteDelegations = { delegatorUserIds: [], unavailable: true };

describe("🔴 포털에 맡긴 위임 — A/S 표에 줄이 없어도 대신 누른다", () => {
  test("최종 출하 — 포털 위임만으로 승인되고, 기록에 **둘 다** 남는다", async () => {
    await saveRoute("FINAL_SHIPMENT", [approverId]);
    const caseId = await arrangePendingShipment();
    // 🔴 **A/S 표에는 위임을 만들지 않는다.** 만들면 「원래 되던 길로 통과했다」와
    //    구별되지 않아 이 시험이 아무것도 지키지 못한다.
    assert.equal(
      (await listRepairCasesPendingMyApproval(strangerId)).length,
      0,
      "A/S 쪽 위임이 없는데 대기 목록에 떴다 — 표본이 깨끗하지 않다"
    );
    // 🔵 포털을 빼고 눌러 보면 **막힌다**를 먼저 못 박는다.
    const 포털없이 = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", strangerId, null);
    assert.equal(포털없이.ok, false, "포털 위임도 없는데 통과했다");

    const decided = await decideRepairCaseApproval(
      caseId,
      "FINAL_SHIPMENT",
      "APPROVED",
      strangerId,
      null,
      포털위임([strangerId, approverId])
    );
    assert.equal(decided.ok, true, `포털 위임이 안 걸렸다: ${JSON.stringify(decided)}`);

    const [row] = await shipmentRows(caseId);
    assert.equal(row.status, "APPROVED");
    assert.equal(row.decidedByUserId, strangerId, "누른 사람이 안 남았다");
    assert.equal(row.delegatedFromUserId, approverId, "누구 자리였는지가 안 남았다");
    assert.equal(row.assignedApproverUserId, approverId, "지정이 대리인으로 덮였다");
  });

  test("견적서 — 포털 위임만으로 승인되고, 기록에 **둘 다** 남는다", async () => {
    await saveRoute(QUOTE_APPROVAL_ROUTE_SCOPE, [approverId]);
    const quoteId = await arrangePendingQuote();

    const 포털없이 = await decideQuoteApproval({
      quoteId,
      decision: "APPROVED",
      actorUserId: strangerId,
      decisionReason: null,
    });
    assert.equal(포털없이.ok, false, "포털 위임도 없는데 통과했다");

    const decided = await decideQuoteApproval({
      quoteId,
      decision: "APPROVED",
      actorUserId: strangerId,
      decisionReason: null,
      portalDelegations: 포털위임([strangerId, approverId]),
    });
    assert.equal(decided.ok, true, `포털 위임이 안 걸렸다: ${JSON.stringify(decided)}`);
    // 🔴 포털이 멀쩡했으므로 안내 깃발은 **실리지 않는다.** 매번 실리면 아무
    //    상관없는 화면마다 경고가 깔린다.
    assert.ok(!("portalDelegationUnavailable" in decided), "멀쩡한데 안내 깃발이 실렸다");

    const [row] = await quoteRows(quoteId);
    assert.equal(row.status, "APPROVED");
    assert.equal(row.decidedByUserId, strangerId);
    assert.equal(row.delegatedFromUserId, approverId);
  });

  test("🔴 **합집합**이다 — A/S 위임과 포털 위임이 서로를 지우지 않는다", async () => {
    await saveRoute(QUOTE_APPROVAL_ROUTE_SCOPE, [approverId]);
    await grantDelegation(); // A/S 표: approver → delegate

    // A/S 쪽 대리인은 포털 목록이 함께 와도 그대로 누른다.
    const 첫장 = await arrangePendingQuote();
    const 가 = await decideQuoteApproval({
      quoteId: 첫장,
      decision: "APPROVED",
      actorUserId: delegateId,
      decisionReason: null,
      portalDelegations: 포털위임([delegateId, strangerId]),
    });
    assert.equal(가.ok, true, `A/S 위임이 포털 목록에 밀려 죽었다: ${JSON.stringify(가)}`);
    assert.equal((await quoteRows(첫장))[0].delegatedFromUserId, approverId);

    // 포털 쪽 대리인도 같은 판에서 그대로 누른다.
    const 둘째장 = await arrangePendingQuote();
    const 나 = await decideQuoteApproval({
      quoteId: 둘째장,
      decision: "APPROVED",
      actorUserId: strangerId,
      decisionReason: null,
      portalDelegations: 포털위임([strangerId, approverId]),
    });
    assert.equal(나.ok, true, `포털 위임이 A/S 표에 밀려 죽었다: ${JSON.stringify(나)}`);
    assert.equal((await quoteRows(둘째장))[0].delegatedFromUserId, approverId);
  });

  test("🔴 고지를 갈아타도 이어 붙지 않는다 — A/S 로 A→B, 포털로 B→C", async () => {
    await saveRoute(QUOTE_APPROVAL_ROUTE_SCOPE, [approverId]);
    const quoteId = await arrangePendingQuote();
    await grantDelegation(); // A/S 표: approver → delegate

    // 🔵 두 겹이 **둘 다 살아 있는** 표본인지 먼저 못 박는다 — 하나라도 죽어 있으면
    //    「안 이어진다」가 공짜로 통과한다. delegate 는 지금 이 건을 누를 수 있고,
    //    stranger 는 포털로 delegate 를 대신할 수 있다.
    assert.ok(
      (await listQuoteApprovalsPendingMyApproval(delegateId)).some((item) => item.quoteId === quoteId),
      "A/S 쪽 한 겹이 살아 있지 않다 — 표본이 깨졌다"
    );

    // 여기가 본론 — stranger 가 가진 것은 delegate 뿐이고, approver 가 아니다.
    const decided = await decideQuoteApproval({
      quoteId,
      decision: "APPROVED",
      actorUserId: strangerId,
      decisionReason: null,
      portalDelegations: 포털위임([strangerId, delegateId]),
    });
    assert.equal(decided.ok, false, "두 고지를 갈아타며 위임이 이어졌다");
    if (!decided.ok) assert.equal(decided.code, "FORBIDDEN");
    assert.equal((await quoteRows(quoteId))[0].status, "REQUESTED");
  });

  test("🔴 포털 목록이 **이 단계의 결재권자를 담고 있지 않으면** 못 누른다 — 통행증이 아니다", async () => {
    await saveRoute(QUOTE_APPROVAL_ROUTE_SCOPE, [approverId]);
    const quoteId = await arrangePendingQuote();

    // 🔴 **여기 들어오는 목록은 이미 「부른 사람」 몫으로 좁혀진 값**이다(포털에 제
    //    번호로 물어 받는다 — server/integration/portal-delegations.ts). 그래서 이
    //    층에서 「남의 위임」을 표현할 길은 없고, 대신 재야 할 것은 **목록이 비지
    //    않았는데도 이 단계는 안 열리는가**다. 목록 하나만 있으면 아무 결재나 통과하는
    //    통행증이 되어 버리면 안 된다.
    const 목록 = 포털위임([strangerId, requesterId]);
    assert.ok(목록.delegatorUserIds.length > 1, "표본이 비었다 — 이 시험이 아무것도 안 본다");
    assert.ok(
      !목록.delegatorUserIds.includes(approverId),
      "표본에 이 단계의 결재권자가 들어 있다 — 재려는 것과 반대다"
    );

    const decided = await decideQuoteApproval({
      quoteId,
      decision: "APPROVED",
      actorUserId: strangerId,
      decisionReason: null,
      portalDelegations: 목록,
    });
    assert.equal(decided.ok, false, "상관없는 포털 위임으로 눌렸다");
    if (!decided.ok) assert.equal(decided.code, "FORBIDDEN");
    assert.equal((await quoteRows(quoteId))[0].status, "REQUESTED");
  });
});

describe("🔴 포털에 못 물었을 때 — 결재는 그대로 돌고, 그 사실이 결과에 실린다", () => {
  test("본인은 멀쩡히 누르고, 그래도 안내 깃발이 실린다", async () => {
    await saveRoute(QUOTE_APPROVAL_ROUTE_SCOPE, [approverId]);
    const quoteId = await arrangePendingQuote();

    // 🔴 설계 B-6 — 포털이 멈췄다고 결재를 막지 않는다. 본인 id 는 언제나 맨 앞이다.
    const decided = await decideQuoteApproval({
      quoteId,
      decision: "APPROVED",
      actorUserId: approverId,
      decisionReason: null,
      portalDelegations: 포털에못물었다,
    });
    assert.equal(decided.ok, true, `포털이 죽었다고 본인 결재가 막혔다: ${JSON.stringify(decided)}`);
    assert.equal((await quoteRows(quoteId))[0].status, "APPROVED");
    // 🔴 설계 B-7 — 「조용히」가 아니어야 한다. 화면이 안내를 띄울 수 있게 실려 나간다.
    assert.equal(decided.portalDelegationUnavailable, true, "못 물었는데 결과에 아무 표시가 없다");
  });

  test("🔴 막힌 쪽에도 실린다 — 대리인이 까닭을 알 수 있는 유일한 자리다", async () => {
    await saveRoute(QUOTE_APPROVAL_ROUTE_SCOPE, [approverId]);
    const quoteId = await arrangePendingQuote();

    const decided = await decideQuoteApproval({
      quoteId,
      decision: "APPROVED",
      actorUserId: strangerId,
      decisionReason: null,
      portalDelegations: 포털에못물었다,
    });
    assert.equal(decided.ok, false, "포털도 못 물었는데 통과했다");
    if (!decided.ok) {
      assert.equal(decided.code, "FORBIDDEN");
      // 🔴 거절 **본문을 잃지 않는다.** 깃발 하나 때문에 「알 수 없는 오류」가 되면
      //    안내를 띄우려다 더 나빠진다.
      assert.ok(decided.message.length > 0, "거절 문구가 사라졌다");
    }
    assert.equal(decided.portalDelegationUnavailable, true, "막혔는데 결과에 아무 표시가 없다");
  });

  test("최종 출하도 같다 — 접수 건 쪽 결과에도 실린다", async () => {
    // 🔵 접수 건을 하나 더 만들지 않으려고 **검수 승인 행**으로 잰다 — 결재선을
    //    타지 않는 행이라 위임은 걸리지 않지만, 깃발은 저장 경로 **바깥**에서
    //    얹히므로 그대로 실려야 한다. 두 길이 어긋나면 여기서 드러난다.
    const created = await createRepairCase(baseCreateInput());
    assert.equal(created.ok, true, `setup create failed: ${JSON.stringify(created)}`);
    if (!created.ok) throw new Error("unreachable");
    createdCaseIds.push(created.id);

    const requested = await requestRepairCaseApproval(created.id, "REPAIR_INSPECTION", requesterId, null);
    assert.equal(requested.ok, true, `setup inspection request failed: ${JSON.stringify(requested)}`);

    const decided = await decideRepairCaseApproval(
      created.id,
      "REPAIR_INSPECTION",
      "APPROVED",
      requesterId,
      null,
      포털에못물었다
    );
    assert.equal(decided.ok, true, `검수 승인이 막혔다: ${JSON.stringify(decided)}`);
    assert.equal(decided.portalDelegationUnavailable, true, "접수 건 결과에는 표시가 안 실린다");
  });
});
