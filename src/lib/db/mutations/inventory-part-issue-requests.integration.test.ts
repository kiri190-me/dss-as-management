import "../../../../scripts/load-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  auditLogs,
  customers,
  inventoryPartIssueApprovals,
  inventoryPartIssueRequestItems,
  inventoryPartIssueRequests,
  inventoryPartRequestHistory,
  inventoryPartRequestIdempotencyKeys,
  inventoryPartRequestIssues,
  inventoryPartRequestItems,
  inventoryPartRequests,
  partStockBalances,
  parts,
  products,
  repairCaseIntakeSequences,
  repairCases,
  shipmentApprovalRouteSteps,
  shipmentApprovalRoutes,
  stockTransactions,
  users,
} from "../schema";
import { consumeStock, createPart, receiveStock } from "./inventory";
import { createPartRequest, issuePartRequest } from "./inventory-part-requests";
import {
  cancelPartIssueRequest,
  createPartIssueRequest,
  decidePartIssueRequestApproval,
  executePartIssueRequest,
} from "./inventory-part-issue-requests";
import { createRepairCase } from "./repair-cases";
import { saveShipmentApprovalRoute } from "./shipment-approval-routes";
import { getCurrentShipmentApprovalRoute } from "../queries/shipment-approval-routes";
import { listPartIssueRequestsPendingMyApproval } from "../queries/inventory-part-issue-requests";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 부품 불출 승인 — 신청 · 결재 · 취소 (실제 DB)
 * ============================================================================
 * 이 파일이 못 박는 것:
 *  1. 🔴 **「부품 불출」 결재선 판이 없거나 단계가 0개면 신청이 만들어지지 않고**
 *     전용 코드로 그렇게 말한다 — 그리고 **행이 하나도 남지 않는다.** 그때는
 *     지금까지처럼 바로 불출하는 것이 맞고, 그 갈래를 정하는 것은 다음 조각이다.
 *  2. 판이 있으면 신청 + **1단계 결재 행 하나**가 생긴다(두 갈래 모두).
 *  3. 🔴 **신청자 본인 단계는 건너뛴다** — 행에 적히는 번호는 건너뛴 뒤의 실제
 *     번호이고, 전부 신청자면 신청 자체가 거절된다.
 *  4. 사슬이 도는 내내 대기 중인 결재 행은 **언제나 하나**이고, 마지막 승인 뒤에
 *     신청이 APPROVED 가 된다.
 *  5. 🔴 **어떤 길로도 EXECUTED 가 되지 않는다** — 실행은 다음 조각이다.
 *  6. 🔴 **재고가 한 톨도 움직이지 않는다** — 잔량도 재고 장부도 그대로다.
 *  7. 🔴 **막힌 신청은 트랜잭션째 되돌아간다** — 행을 하나도 남기지 않는다.
 *
 * 격리·청소 규약은 queries/inventory-part-issue-requests.integration.test.ts 와
 * mutations/repair-case-approvals-route.integration.test.ts 를 본떴다.
 * ⚠️ **만든 행은 afterEach 로 반드시 걷는다.** 사람 참조가 RESTRICT 라 삭제에는
 * 순서가 있다: 결재 행 → 신청 항목 → 신청 → 부품 요청(멱등·이력·항목) → 부품
 * 요청 → 결재선 단계 → 결재선 판.
 *
 * 🔴 **결재선 판을 매 시험마다 걷는다.** 시험 DB 에 판이 남으면 다른 시험 파일이
 * 갑자기 결재선을 타면서 깨진다(그쪽 before 가 「판이 없는 상태」를 전제한다).
 *
 * 🔴 계정·부품 접두사를 "test-inventory-" 로 하지 **않는다.** 그 접두사는
 * mutations/inventory.integration.test.ts 가 자기 after() 에서 통째로 지우는
 * 것이라 남의 청소와 부딪힌다. "partissue-test-" 도 쓰지 않는다 — 그것은
 * queries/inventory-part-issue-requests.integration.test.ts 의 것이다.
 * ============================================================================
 */

const TEST_EMAIL_PREFIX = "partissuemut-test-";
const TEST_PART_PREFIX = "partissuemut-test-";
const TEST_LOCATION = "PARTISSUEMUT-TEST-SHELF";
const TEST_MODEL_PREFIX = "PARTISSUEMUT-TEST-";
// ⚠️ 접수월은 다른 시험 파일과 겹치면 안 된다 — 청소가 인수번호 접두사로
// 이뤄지므로 겹치면 서로의 행을 지운다. 9709 는 아직 아무도 쓰지 않는다.
const TEST_YEAR_MONTH = "9709";
const TEST_INTAKE_PREFIX = `D${TEST_YEAR_MONTH}%`;
const TEST_RECEIVED_AT = "2097-09-10";
const TEST_SHIPMENT_DATE = "2097-09-20";

let managerId: string; // INVENTORY_MANAGER — 불출을 신청하는 재고 담당자
let superAdminId: string; // 판을 저장하는 사람 + 「언제나 처리할 수 있는」 비상구
let engineerId: string; // 부품 요청을 올리는 사람 겸 「불출 권한이 없는 사람」
let approverAId: string;
let approverBId: string;
let approverCId: string;
let customerId: string;
let partId: string;
let balanceAId: string;
let balanceBId: string;

const createdUserIds: string[] = [];
const createdPartIds: string[] = [];

async function createTestUser(
  name: string,
  overrides: Partial<typeof users.$inferInsert> = {}
): Promise<string> {
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
  createdUserIds.push(row.id);
  return row.id;
}

function baseCreateInput(): ValidatedCreateRepairCaseInput {
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
  };
}

/** 「부품 불출」 용도의 판 하나. 돌려주는 것은 그 판의 id 다. */
async function saveRoute(approverUserIds: string[]): Promise<string> {
  const result = await saveShipmentApprovalRoute(approverUserIds, superAdminId, "PART_ISSUE");
  assert.equal(result.ok, true, `setup route save failed: ${JSON.stringify(result)}`);
  const current = await getCurrentShipmentApprovalRoute("PART_ISSUE");
  assert.ok(current, "저장했는데 현재 판이 없다");
  return current.id;
}

/** 직접 사용 신청 하나 — 접수 건 없이 사용처만 적는 가장 단순한 길. */
async function requestDirectUse(
  actorUserId: string,
  quantity = 2,
  requestReason: string | null = "긴급 교체"
) {
  return createPartIssueRequest({
    kind: "DIRECT_USE",
    partStockBalanceId: balanceAId,
    quantity,
    repairCaseId: null,
    destinationNote: "상해수리소",
    procedureExecutionNodeId: null,
    requestReason,
    actorUserId,
  });
}

/** 엔지니어가 올린 부품 요청 하나와 그 줄. */
async function arrangePartRequest(
  requestedQuantity = 5
): Promise<{ requestId: string; itemId: string }> {
  const created = await createRepairCase(baseCreateInput());
  assert.equal(created.ok, true, `setup case failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");

  const request = await createPartRequest({
    repairCaseId: created.id,
    items: [{ partId, quantity: requestedQuantity, owner: "DSS" }],
    actorUserId: engineerId,
    idempotencyKey: randomUUID(),
  });
  assert.equal(request.ok, true, `setup part request failed: ${JSON.stringify(request)}`);
  if (!request.ok) throw new Error("unreachable");

  const [item] = await db
    .select({ id: inventoryPartRequestItems.id })
    .from(inventoryPartRequestItems)
    .where(eq(inventoryPartRequestItems.requestId, request.requestId));
  return { requestId: request.requestId, itemId: item.id };
}

/** 그 신청의 결재 행들 — 오래된 것부터. */
async function approvalRows(issueRequestId: string) {
  return db
    .select()
    .from(inventoryPartIssueApprovals)
    .where(eq(inventoryPartIssueApprovals.issueRequestId, issueRequestId))
    .orderBy(asc(inventoryPartIssueApprovals.requestedAt));
}

/** 지금 대기 중인 결재 행의 수 — 언제나 0 또는 1이어야 한다. */
async function pendingApprovalCount(issueRequestId: string): Promise<number> {
  const rows = await approvalRows(issueRequestId);
  return rows.filter((row) => row.status === "REQUESTED").length;
}

async function issueRequestRow(issueRequestId: string) {
  const [row] = await db
    .select()
    .from(inventoryPartIssueRequests)
    .where(eq(inventoryPartIssueRequests.id, issueRequestId));
  return row;
}

/** 이 시험 파일의 사람들이 올린 신청·항목·결재 행의 수. 「행이 하나도 안 생겼다」를 본다. */
async function countIssueRows(): Promise<{ requests: number; items: number; approvals: number }> {
  const requests = await db
    .select({ id: inventoryPartIssueRequests.id })
    .from(inventoryPartIssueRequests)
    .where(inArray(inventoryPartIssueRequests.requestedByUserId, createdUserIds));
  const requestIds = requests.map((row) => row.id);
  if (requestIds.length === 0) return { requests: 0, items: 0, approvals: 0 };

  const items = await db
    .select({ id: inventoryPartIssueRequestItems.id })
    .from(inventoryPartIssueRequestItems)
    .where(inArray(inventoryPartIssueRequestItems.issueRequestId, requestIds));
  const approvals = await db
    .select({ id: inventoryPartIssueApprovals.id })
    .from(inventoryPartIssueApprovals)
    .where(inArray(inventoryPartIssueApprovals.issueRequestId, requestIds));
  return { requests: requests.length, items: items.length, approvals: approvals.length };
}

/** 재고가 지금 어떤 상태인가 — 잔량·판번호·장부 줄 수. */
async function stockSnapshot(): Promise<{ quantities: number[]; versions: number[]; ledger: number }> {
  const balances = await db
    .select({
      id: partStockBalances.id,
      currentQuantity: partStockBalances.currentQuantity,
      version: partStockBalances.version,
    })
    .from(partStockBalances)
    .where(inArray(partStockBalances.id, [balanceAId, balanceBId]))
    .orderBy(asc(partStockBalances.id));
  const ledger = await db
    .select({ id: stockTransactions.id })
    .from(stockTransactions)
    .where(inArray(stockTransactions.partStockBalanceId, [balanceAId, balanceBId]));
  return {
    quantities: balances.map((row) => row.currentQuantity),
    versions: balances.map((row) => row.version),
    ledger: ledger.length,
  };
}

/** 이 파일이 만든 신청·부품 요청·결재선을 걷는다. 사람·부품·접수 건은 after() 가 지운다. */
async function removeIssueFixtures(): Promise<void> {
  const issueRequests = await db
    .select({ id: inventoryPartIssueRequests.id })
    .from(inventoryPartIssueRequests)
    .where(inArray(inventoryPartIssueRequests.requestedByUserId, createdUserIds));
  const issueRequestIds = issueRequests.map((row) => row.id);
  if (issueRequestIds.length > 0) {
    // 결재 행이 신청을 RESTRICT 로 참조한다 — 결재 행이 먼저다.
    await db
      .delete(inventoryPartIssueApprovals)
      .where(inArray(inventoryPartIssueApprovals.issueRequestId, issueRequestIds));
    await db
      .delete(inventoryPartIssueRequestItems)
      .where(inArray(inventoryPartIssueRequestItems.issueRequestId, issueRequestIds));
    await db
      .delete(inventoryPartIssueRequests)
      .where(inArray(inventoryPartIssueRequests.id, issueRequestIds));
  }

  const partRequests = await db
    .select({ id: inventoryPartRequests.id })
    .from(inventoryPartRequests)
    .where(inArray(inventoryPartRequests.requestedByUserId, createdUserIds));
  const partRequestIds = partRequests.map((row) => row.id);
  if (partRequestIds.length > 0) {
    // ⚠️ 실행 시험이 생기면서 **재고 장부 줄**이 요청 줄·불출 사건을 붙잡는다
    // (stock_transactions.request_item_id · request_issue_id 둘 다 RESTRICT).
    // 순서는 FK 가 강제한다: 장부 줄 → 이력 → 불출 사건 → 요청 줄 → 요청.
    const requestItemRows = await db
      .select({ id: inventoryPartRequestItems.id })
      .from(inventoryPartRequestItems)
      .where(inArray(inventoryPartRequestItems.requestId, partRequestIds));
    const requestItemIds = requestItemRows.map((row) => row.id);
    if (requestItemIds.length > 0) {
      await db
        .delete(stockTransactions)
        .where(inArray(stockTransactions.requestItemId, requestItemIds));
    }
    await db
      .delete(inventoryPartRequestIdempotencyKeys)
      .where(inArray(inventoryPartRequestIdempotencyKeys.requestId, partRequestIds));
    await db
      .delete(inventoryPartRequestHistory)
      .where(inArray(inventoryPartRequestHistory.requestId, partRequestIds));
    await db
      .delete(inventoryPartRequestIssues)
      .where(inArray(inventoryPartRequestIssues.requestId, partRequestIds));
    await db
      .delete(inventoryPartRequestItems)
      .where(inArray(inventoryPartRequestItems.requestId, partRequestIds));
    await db.delete(inventoryPartRequests).where(inArray(inventoryPartRequests.id, partRequestIds));
  }

  // 판을 지우면 단계는 함께 사라진다. 매 시험이 스스로 판을 정하려면 판 번호가
  // 1부터 다시 시작해야 한다.
  await db
    .delete(shipmentApprovalRouteSteps)
    .where(inArray(shipmentApprovalRouteSteps.approverUserId, createdUserIds));
  await db
    .delete(shipmentApprovalRoutes)
    .where(inArray(shipmentApprovalRoutes.createdByUserId, createdUserIds));
}

/** 이전 실행이 중간에 끊겨 남은 이 파일의 흔적까지 걷는다. */
async function removeTestFixturesByPrefix(): Promise<void> {
  const leftoverUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  const userIds = leftoverUsers.map((row) => row.id);
  createdUserIds.push(...userIds.filter((id) => !createdUserIds.includes(id)));
  if (createdUserIds.length > 0) {
    await removeIssueFixtures();
    await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, createdUserIds));
  }

  await db.delete(repairCases).where(like(repairCases.intakeNumber, TEST_INTAKE_PREFIX));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db
    .delete(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));

  const leftoverParts = await db
    .select({ id: parts.id })
    .from(parts)
    .where(like(parts.partName, `${TEST_PART_PREFIX}%`));
  const partIds = [...new Set([...createdPartIds, ...leftoverParts.map((row) => row.id)])];
  if (partIds.length > 0) {
    const balances = await db
      .select({ id: partStockBalances.id })
      .from(partStockBalances)
      .where(inArray(partStockBalances.partId, partIds));
    const balanceIds = balances.map((row) => row.id);
    if (balanceIds.length > 0) {
      await db.delete(stockTransactions).where(inArray(stockTransactions.partStockBalanceId, balanceIds));
      await db.delete(partStockBalances).where(inArray(partStockBalances.id, balanceIds));
    }
    await db.delete(parts).where(inArray(parts.id, partIds));
    createdPartIds.length = 0;
  }

  if (userIds.length > 0) {
    await db.delete(users).where(inArray(users.id, userIds));
  }
  createdUserIds.length = 0;
}

before(async () => {
  await removeTestFixturesByPrefix();

  const [leftoverRoute] = await db
    .select({ id: shipmentApprovalRoutes.id })
    .from(shipmentApprovalRoutes)
    .limit(1);
  assert.equal(
    leftoverRoute,
    undefined,
    "이 시험은 shipment_approval_routes 가 비어 있는 상태를 전제로 합니다"
  );

  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.isDeleted, false))
    .limit(1);
  assert.ok(customer, "expected at least one non-deleted customer in the test DB");
  customerId = customer.id;

  managerId = await createTestUser("불출시험 재고담당", { role: "INVENTORY_MANAGER" });
  superAdminId = await createTestUser("불출시험 최고관리자", { role: "SUPER_ADMIN" });
  engineerId = await createTestUser("불출시험 엔지니어");
  approverAId = await createTestUser("불출시험 1단계");
  approverBId = await createTestUser("불출시험 2단계");
  approverCId = await createTestUser("불출시험 3단계");

  const part = await createPart({
    partName: `${TEST_PART_PREFIX}${randomUUID().slice(0, 8)}`,
    partSpec: "불출 승인 시험용",
    actorUserId: superAdminId,
  });
  assert.equal(part.ok, true, `setup part failed: ${JSON.stringify(part)}`);
  if (!part.ok) throw new Error("unreachable");
  partId = part.partId;
  createdPartIds.push(partId);

  const receivedA = await receiveStock({
    partId,
    owner: "DSS",
    location: `${TEST_LOCATION}-A`,
    quantity: 10,
    actorUserId: superAdminId,
  });
  assert.equal(receivedA.ok, true, `setup stock failed: ${JSON.stringify(receivedA)}`);
  if (!receivedA.ok) throw new Error("unreachable");
  balanceAId = receivedA.partStockBalanceId;

  const receivedB = await receiveStock({
    partId,
    owner: "KYOSAN",
    location: `${TEST_LOCATION}-B`,
    quantity: 4,
    actorUserId: superAdminId,
  });
  assert.equal(receivedB.ok, true, `setup stock failed: ${JSON.stringify(receivedB)}`);
  if (!receivedB.ok) throw new Error("unreachable");
  balanceBId = receivedB.partStockBalanceId;
});

afterEach(async () => {
  await removeIssueFixtures();
});

after(async () => {
  await removeTestFixturesByPrefix();
  await pgClient.end({ timeout: 5 });
});

describe("신청 — 결재선이 없으면 신청 자체가 만들어지지 않는다", () => {
  test("🔴 1. 판이 하나도 없으면 전용 코드로 거절하고 행을 하나도 남기지 않는다", async () => {
    assert.equal(
      await getCurrentShipmentApprovalRoute("PART_ISSUE"),
      null,
      "이 시험은 「부품 불출」 판이 없는 상태를 전제로 한다"
    );

    const result = await requestDirectUse(managerId);
    assert.equal(result.ok, false, "판이 없는데 신청이 만들어졌다");
    if (!result.ok) {
      assert.equal(
        result.code,
        "ROUTE_NOT_CONFIGURED",
        "FORBIDDEN 으로 뭉뚱그리면 다음 조각이 「절차가 없다」를 가려낼 수 없다"
      );
      assert.match(result.message, /승인 절차/);
    }

    assert.deepEqual(await countIssueRows(), { requests: 0, items: 0, approvals: 0 });
  });

  test("🔴 2. 단계 0개인 판도 같다 — 「절차를 쓰지 않겠다」는 뜻이다", async () => {
    await saveRoute([]);

    const result = await requestDirectUse(managerId);
    assert.equal(result.ok, false, "빈 판인데 신청이 만들어졌다");
    if (!result.ok) assert.equal(result.code, "ROUTE_NOT_CONFIGURED");

    assert.deepEqual(await countIssueRows(), { requests: 0, items: 0, approvals: 0 });
  });

  test("3. 출하 절차만 있고 불출 절차가 없으면 여전히 거절한다 — 용도가 다르다", async () => {
    const saved = await saveShipmentApprovalRoute([approverAId], superAdminId, "FINAL_SHIPMENT");
    assert.equal(saved.ok, true, `setup route save failed: ${JSON.stringify(saved)}`);

    const result = await requestDirectUse(managerId);
    assert.equal(result.ok, false, "출하 절차가 부품 불출에 쓰였다");
    if (!result.ok) assert.equal(result.code, "ROUTE_NOT_CONFIGURED");
  });
});

describe("신청 — 판이 있으면 1단계 결재 행이 하나 생긴다", () => {
  test("🔴 4. 직접 사용 — 신청 + 항목 + 1단계 결재 행", async () => {
    const routeId = await saveRoute([approverAId, approverBId]);

    const result = await requestDirectUse(managerId, 3, "라인 정지");
    assert.equal(result.ok, true, `신청이 막혔다: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const request = await issueRequestRow(result.issueRequestId);
    assert.equal(request.status, "PENDING_APPROVAL");
    assert.equal(request.partRequestId, null, "직접 사용인데 부품 요청이 적혔다");
    assert.equal(request.destinationNote, "상해수리소");
    assert.equal(request.requestedByUserId, managerId);
    assert.equal(request.requestReason, "라인 정지");
    assert.equal(request.executedByUserId, null);
    assert.equal(request.executedAt, null);

    const items = await db
      .select()
      .from(inventoryPartIssueRequestItems)
      .where(eq(inventoryPartIssueRequestItems.issueRequestId, result.issueRequestId));
    assert.equal(items.length, 1);
    assert.equal(items[0].partStockBalanceId, balanceAId);
    assert.equal(items[0].quantity, 3);
    assert.equal(items[0].requestItemId, null, "직접 사용은 요청 줄이 없다");

    const rows = await approvalRows(result.issueRequestId);
    assert.equal(rows.length, 1, "신청 한 번에 결재 행이 하나보다 많이 생겼다");
    assert.equal(rows[0].status, "REQUESTED");
    assert.equal(rows[0].routeId, routeId, "요청 시점의 판을 가리켜야 한다");
    assert.equal(rows[0].routeStepOrder, 1);
    assert.equal(rows[0].assignedApproverUserId, approverAId);
    assert.equal(rows[0].requestedByUserId, managerId);
    assert.equal(rows[0].requestReason, "라인 정지");
    assert.equal(rows[0].decidedByUserId, null);

    // 그리고 그 사람의 「내가 결재할 목록」에 실제로 잡힌다.
    const pending = await listPartIssueRequestsPendingMyApproval(approverAId);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].issueRequestId, result.issueRequestId);
  });

  test("5. 요청 기반 — 요청 줄을 그대로 가리키고 사용처는 여기 적지 않는다", async () => {
    await saveRoute([approverAId]);
    const { requestId, itemId } = await arrangePartRequest(5);

    const result = await createPartIssueRequest({
      kind: "PART_REQUEST",
      partRequestId: requestId,
      allocations: [{ requestItemId: itemId, partStockBalanceId: balanceAId, quantity: 4 }],
      requestReason: null,
      actorUserId: managerId,
    });
    assert.equal(result.ok, true, `신청이 막혔다: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const request = await issueRequestRow(result.issueRequestId);
    assert.equal(request.partRequestId, requestId);
    // 🔴 접수 건·사용처는 부품 요청이 이미 들고 있다 — 여기 다시 적으면 표의
    // CHECK 에 걸린다(같은 사실이 두 곳에 적히면 갈라진다).
    assert.equal(request.repairCaseId, null);
    assert.equal(request.destinationNote, null);
    assert.equal(request.procedureExecutionNodeId, null);

    const items = await db
      .select()
      .from(inventoryPartIssueRequestItems)
      .where(eq(inventoryPartIssueRequestItems.issueRequestId, result.issueRequestId));
    assert.equal(items.length, 1);
    assert.equal(items[0].requestItemId, itemId);
    assert.equal(items[0].quantity, 4);
  });

  test("🔴 6. 같은 잔량 행을 두 줄로 적으면 하나로 합쳐진다", async () => {
    await saveRoute([approverAId]);
    const { requestId, itemId } = await arrangePartRequest(5);

    const result = await createPartIssueRequest({
      kind: "PART_REQUEST",
      partRequestId: requestId,
      allocations: [
        { requestItemId: itemId, partStockBalanceId: balanceAId, quantity: 2 },
        { requestItemId: itemId, partStockBalanceId: balanceAId, quantity: 3 },
      ],
      requestReason: null,
      actorUserId: managerId,
    });
    assert.equal(result.ok, true, `신청이 막혔다: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const items = await db
      .select()
      .from(inventoryPartIssueRequestItems)
      .where(eq(inventoryPartIssueRequestItems.issueRequestId, result.issueRequestId));
    assert.equal(items.length, 1, "합쳐지지 않으면 표의 유니크에 걸린다");
    assert.equal(items[0].quantity, 5);
  });

  test("🔴 7. 항목이 0개면 거절하고 행을 남기지 않는다", async () => {
    await saveRoute([approverAId]);
    const { requestId } = await arrangePartRequest(5);

    const result = await createPartIssueRequest({
      kind: "PART_REQUEST",
      partRequestId: requestId,
      allocations: [],
      requestReason: null,
      actorUserId: managerId,
    });
    assert.equal(result.ok, false, "빈 신청이 통과했다");
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");

    assert.deepEqual(await countIssueRows(), { requests: 0, items: 0, approvals: 0 });
  });

  test("8. 요청 줄이 그 요청의 것이 아니면 거절한다", async () => {
    await saveRoute([approverAId]);
    const first = await arrangePartRequest(5);
    const second = await arrangePartRequest(5);

    const result = await createPartIssueRequest({
      kind: "PART_REQUEST",
      partRequestId: first.requestId,
      allocations: [{ requestItemId: second.itemId, partStockBalanceId: balanceAId, quantity: 1 }],
      requestReason: null,
      actorUserId: managerId,
    });
    assert.equal(result.ok, false, "남의 요청 줄로 불출 신청이 만들어졌다");
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
    assert.deepEqual(await countIssueRows(), { requests: 0, items: 0, approvals: 0 });
  });

  test("9. 요청 줄의 남은 수량을 넘으면 거절한다", async () => {
    await saveRoute([approverAId]);
    const { requestId, itemId } = await arrangePartRequest(2);

    const result = await createPartIssueRequest({
      kind: "PART_REQUEST",
      partRequestId: requestId,
      allocations: [{ requestItemId: itemId, partStockBalanceId: balanceAId, quantity: 3 }],
      requestReason: null,
      actorUserId: managerId,
    });
    assert.equal(result.ok, false, "요청한 것보다 많이 빼는 신청이 통과했다");
    if (!result.ok) assert.equal(result.code, "EXCEEDS_REMAINING_REQUESTED");
    assert.deepEqual(await countIssueRows(), { requests: 0, items: 0, approvals: 0 });
  });

  test("10. 소유구분이 다른 자리에서 빼려 하면 거절한다", async () => {
    await saveRoute([approverAId]);
    const { requestId, itemId } = await arrangePartRequest(2);

    // 요청은 DSS 로 올라갔는데 재고 담당자가 KYOSAN 자리를 골랐다.
    const result = await createPartIssueRequest({
      kind: "PART_REQUEST",
      partRequestId: requestId,
      allocations: [{ requestItemId: itemId, partStockBalanceId: balanceBId, quantity: 1 }],
      requestReason: null,
      actorUserId: managerId,
    });
    assert.equal(result.ok, false, "요청한 소유구분과 다른 자리가 통과했다");
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });

  test("🔴 11. 지금 잔량으로도 모자라면 거절한다 — 다만 신청은 재고를 예약하지 않는다", async () => {
    await saveRoute([approverAId]);

    const tooMany = await requestDirectUse(managerId, 11);
    assert.equal(tooMany.ok, false, "잔량(10)보다 많은 신청이 통과했다");
    if (!tooMany.ok) assert.equal(tooMany.code, "INSUFFICIENT_STOCK");
    assert.deepEqual(await countIssueRows(), { requests: 0, items: 0, approvals: 0 });

    // 🔴 예약이 아니다 — 10개를 신청해 두어도 잔량은 그대로 10이고, 같은 재고를
    // 다시 신청할 수 있다. 그 사이 남이 가져가면 실행 시점에 막힌다.
    const first = await requestDirectUse(managerId, 10);
    assert.equal(first.ok, true, `신청이 막혔다: ${JSON.stringify(first)}`);
    const [balance] = await db
      .select({ currentQuantity: partStockBalances.currentQuantity })
      .from(partStockBalances)
      .where(eq(partStockBalances.id, balanceAId));
    assert.equal(balance.currentQuantity, 10, "🔴 신청이 재고를 깎았다");

    const second = await requestDirectUse(superAdminId, 10);
    assert.equal(second.ok, true, "예약이 아니므로 같은 재고를 또 신청할 수 있어야 한다");
  });

  test("🔴 12. 불출 권한이 없는 사람은 두 갈래 모두 거절된다", async () => {
    await saveRoute([approverAId]);
    const { requestId, itemId } = await arrangePartRequest(5);

    const direct = await requestDirectUse(engineerId);
    assert.equal(direct.ok, false, "엔지니어가 재고를 직접 뺄 신청을 올렸다");
    if (!direct.ok) assert.equal(direct.code, "FORBIDDEN");

    const byRequest = await createPartIssueRequest({
      kind: "PART_REQUEST",
      partRequestId: requestId,
      allocations: [{ requestItemId: itemId, partStockBalanceId: balanceAId, quantity: 1 }],
      requestReason: null,
      actorUserId: engineerId,
    });
    assert.equal(byRequest.ok, false, "요청을 올린 사람이 스스로 불출까지 신청했다");
    if (!byRequest.ok) assert.equal(byRequest.code, "FORBIDDEN");

    assert.deepEqual(await countIssueRows(), { requests: 0, items: 0, approvals: 0 });
  });

  test("13. 없는 부품 요청·없는 재고는 NOT_FOUND 다", async () => {
    await saveRoute([approverAId]);

    const noRequest = await createPartIssueRequest({
      kind: "PART_REQUEST",
      partRequestId: randomUUID(),
      allocations: [
        { requestItemId: randomUUID(), partStockBalanceId: balanceAId, quantity: 1 },
      ],
      requestReason: null,
      actorUserId: managerId,
    });
    assert.equal(noRequest.ok, false);
    if (!noRequest.ok) assert.equal(noRequest.code, "NOT_FOUND");

    const noBalance = await createPartIssueRequest({
      kind: "DIRECT_USE",
      partStockBalanceId: randomUUID(),
      quantity: 1,
      repairCaseId: null,
      destinationNote: "상해수리소",
      procedureExecutionNodeId: null,
      requestReason: null,
      actorUserId: managerId,
    });
    assert.equal(noBalance.ok, false);
    if (!noBalance.ok) assert.equal(noBalance.code, "NOT_FOUND");
  });
});

describe("🔴 신청 — 신청자 본인 단계는 건너뛴다", () => {
  test("🔴 14. 1단계가 신청자면 2단계 사람에게 간다 — 행의 번호도 2다", async () => {
    await saveRoute([managerId, approverBId, approverCId]);

    const result = await requestDirectUse(managerId);
    assert.equal(result.ok, true, `신청이 막혔다: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const rows = await approvalRows(result.issueRequestId);
    assert.equal(rows.length, 1);
    assert.equal(
      rows[0].routeStepOrder,
      2,
      "🔴 번호를 1로 고쳐 적으면 이 번호로 다음 단계를 찾을 때 건너뛴 칸으로 되돌아간다"
    );
    assert.equal(rows[0].assignedApproverUserId, approverBId);
  });

  test("15. 대조 — 같은 판이라도 신청자가 결재선에 없으면 1단계부터다", async () => {
    await saveRoute([managerId, approverBId]);

    const result = await requestDirectUse(superAdminId);
    assert.equal(result.ok, true, `신청이 막혔다: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const rows = await approvalRows(result.issueRequestId);
    assert.equal(rows[0].routeStepOrder, 1);
    assert.equal(rows[0].assignedApproverUserId, managerId);
  });

  test("🔴 16. 모든 단계가 신청자면 거절되고 행이 하나도 안 생긴다", async () => {
    await saveRoute([managerId]);

    const result = await requestDirectUse(managerId);
    assert.equal(result.ok, false, "혼자 짜인 결재선이 그대로 통과했다");
    if (!result.ok) {
      assert.equal(
        result.code,
        "ROUTE_HAS_NO_OTHER_APPROVER",
        "FORBIDDEN 으로 뭉뚱그리면 사람이 무엇을 고쳐야 할지 모른다"
      );
      // 🔴 고쳐야 할 것은 이 화면의 값이 아니라 승인 절차 그 자체다.
      assert.match(result.message, /승인 절차/);
    }
    assert.deepEqual(await countIssueRows(), { requests: 0, items: 0, approvals: 0 });

    // 대조 — 막히는 것은 「그 결재선 + 그 신청자」 조합이지 결재선 자체가 아니다.
    const byOther = await requestDirectUse(superAdminId);
    assert.equal(byOther.ok, true, `다른 사람의 신청까지 막혔다: ${JSON.stringify(byOther)}`);
  });
});

describe("결재 — 사슬이 한 단계씩 나아간다", () => {
  async function arrangePending(approvers: string[]): Promise<string> {
    await saveRoute(approvers);
    const result = await requestDirectUse(managerId);
    assert.equal(result.ok, true, `setup request failed: ${JSON.stringify(result)}`);
    if (!result.ok) throw new Error("unreachable");
    return result.issueRequestId;
  }

  test("🔴 17. 중간 단계에서는 아직 APPROVED 가 아니고, 마지막 승인 뒤에 APPROVED 가 된다", async () => {
    const issueRequestId = await arrangePending([approverAId, approverBId, approverCId]);

    const first = await decidePartIssueRequestApproval({
      issueRequestId,
      decision: "APPROVED",
      actorUserId: approverAId,
      decisionReason: null,
    });
    assert.equal(first.ok, true, `1단계가 막혔다: ${JSON.stringify(first)}`);
    if (first.ok) assert.equal(first.status, "PENDING_APPROVAL", "1단계만 끝났는데 승인이 났다");
    assert.equal((await issueRequestRow(issueRequestId)).status, "PENDING_APPROVAL");
    assert.equal(await pendingApprovalCount(issueRequestId), 1, "대기는 언제나 하나다");

    let rows = await approvalRows(issueRequestId);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].routeStepOrder, 2);
    assert.equal(rows[1].assignedApproverUserId, approverBId);

    const second = await decidePartIssueRequestApproval({
      issueRequestId,
      decision: "APPROVED",
      actorUserId: approverBId,
      decisionReason: null,
    });
    assert.equal(second.ok, true, `2단계가 막혔다: ${JSON.stringify(second)}`);
    assert.equal((await issueRequestRow(issueRequestId)).status, "PENDING_APPROVAL");

    const third = await decidePartIssueRequestApproval({
      issueRequestId,
      decision: "APPROVED",
      actorUserId: approverCId,
      decisionReason: null,
    });
    assert.equal(third.ok, true, `3단계가 막혔다: ${JSON.stringify(third)}`);
    if (third.ok) {
      assert.equal(third.status, "APPROVED");
      assert.equal(third.nextApprovalId, null, "마지막 단계 뒤에 행이 또 생겼다");
    }

    rows = await approvalRows(issueRequestId);
    assert.equal(rows.length, 3);
    assert.equal(await pendingApprovalCount(issueRequestId), 0);

    const request = await issueRequestRow(issueRequestId);
    assert.equal(request.status, "APPROVED");
    // 🔴 결재가 다 끝나도 재고는 그대로다 — 실행은 다음 조각이다.
    assert.equal(request.executedByUserId, null);
    assert.equal(request.executedAt, null);
  });

  test("🔴 18. 이어진 행이 신청자·사유를 물려받고 requested_at 만 새로 찍힌다", async () => {
    await saveRoute([approverAId, approverBId]);
    const created = await requestDirectUse(managerId, 2, "8월 정기 교체");
    assert.equal(created.ok, true);
    if (!created.ok) return;

    assert.equal(
      (
        await decidePartIssueRequestApproval({
          issueRequestId: created.issueRequestId,
          decision: "APPROVED",
          actorUserId: approverAId,
          decisionReason: null,
        })
      ).ok,
      true
    );

    const [first, second] = await approvalRows(created.issueRequestId);
    assert.equal(second.requestedByUserId, managerId, "신청한 사람은 그대로다");
    assert.equal(second.requestReason, "8월 정기 교체", "사유도 그대로 이어진다");
    assert.equal(second.routeId, first.routeId, "같은 판을 이어 써야 한다");
    // 🔴 requested_at 은 물려받지 않는다 — 같은 시각이면 「가장 최근 행」이 정해지지
    // 않는다.
    assert.ok(
      second.requestedAt.getTime() > first.requestedAt.getTime(),
      `이어진 행의 requested_at 이 앞 행보다 늦지 않다: ${first.requestedAt.toISOString()} / ${second.requestedAt.toISOString()}`
    );
    assert.equal(second.status, "REQUESTED");
    assert.equal(second.decidedByUserId, null);
  });

  test("🔴 19. 지정된 사람이 아니면 거절된다 — 다음 단계 승인자도, 신청자도", async () => {
    const issueRequestId = await arrangePending([approverAId, approverBId]);

    for (const [label, actorUserId] of [
      ["다음 단계 승인자", approverBId],
      ["신청자", managerId],
      ["바깥 사람", engineerId],
    ] as const) {
      const decided = await decidePartIssueRequestApproval({
        issueRequestId,
        decision: "APPROVED",
        actorUserId,
        decisionReason: null,
      });
      assert.equal(decided.ok, false, `${label} 이(가) 남의 단계를 결재했다`);
      if (!decided.ok) assert.equal(decided.code, "FORBIDDEN", label);
    }

    const rows = await approvalRows(issueRequestId);
    assert.equal(rows.length, 1, "거절이 행을 만들었다");
    assert.equal(rows[0].status, "REQUESTED", "거절됐는데 행이 바뀌었다");
    assert.equal((await issueRequestRow(issueRequestId)).status, "PENDING_APPROVAL");
  });

  test("20. 최고관리자는 언제나 처리할 수 있다 — 사슬은 그대로 이어진다", async () => {
    const issueRequestId = await arrangePending([approverAId, approverBId]);

    const decided = await decidePartIssueRequestApproval({
      issueRequestId,
      decision: "APPROVED",
      actorUserId: superAdminId,
      decisionReason: null,
    });
    assert.equal(decided.ok, true, `최고관리자가 막혔다: ${JSON.stringify(decided)}`);

    const rows = await approvalRows(issueRequestId);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].decidedByUserId, superAdminId);
    assert.equal(rows[1].assignedApproverUserId, approverBId, "대신 처리해도 다음 단계는 그대로다");
  });

  test("🔴 21. 비활성·잠긴 계정은 지정돼 있어도 거절된다", async () => {
    const issueRequestId = await arrangePending([approverAId, approverBId]);

    for (const [label, patch] of [
      ["비활성", { isActive: false }],
      ["잠김", { lockedAt: new Date() }],
    ] as const) {
      await db.update(users).set(patch).where(eq(users.id, approverAId));
      try {
        const decided = await decidePartIssueRequestApproval({
          issueRequestId,
          decision: "APPROVED",
          actorUserId: approverAId,
          decisionReason: null,
        });
        assert.equal(decided.ok, false, `${label} 계정이 통과했다`);
        if (!decided.ok) assert.equal(decided.code, "FORBIDDEN", label);
        assert.equal(await pendingApprovalCount(issueRequestId), 1, `${label}: 사슬이 움직였다`);
        assert.equal((await approvalRows(issueRequestId)).length, 1, `${label}: 행이 늘었다`);
      } finally {
        await db.update(users).set({ isActive: true, lockedAt: null }).where(eq(users.id, approverAId));
      }
    }

    // 대조 — 되돌리면 같은 사람이 그대로 승인한다.
    const decided = await decidePartIssueRequestApproval({
      issueRequestId,
      decision: "APPROVED",
      actorUserId: approverAId,
      decisionReason: null,
    });
    assert.equal(decided.ok, true, `대조가 성립하지 않는다: ${JSON.stringify(decided)}`);
  });

  test("🔴 22. 반려하면 사슬이 끊기고 신청이 REJECTED 가 된다", async () => {
    const issueRequestId = await arrangePending([approverAId, approverBId]);

    const noReason = await decidePartIssueRequestApproval({
      issueRequestId,
      decision: "REJECTED",
      actorUserId: approverAId,
      decisionReason: null,
    });
    assert.equal(noReason.ok, false, "사유 없는 반려가 통과했다");
    if (!noReason.ok) assert.equal(noReason.code, "INVALID_INPUT");

    const rejected = await decidePartIssueRequestApproval({
      issueRequestId,
      decision: "REJECTED",
      actorUserId: approverAId,
      decisionReason: "이 재고는 다른 건에 배정돼 있습니다",
    });
    assert.equal(rejected.ok, true, `반려가 막혔다: ${JSON.stringify(rejected)}`);

    const rows = await approvalRows(issueRequestId);
    assert.equal(rows.length, 1, "반려했는데 다음 단계 행이 생겼다");
    assert.equal(rows[0].status, "REJECTED");
    assert.equal(rows[0].decidedByUserId, approverAId);
    assert.equal(rows[0].decisionReason, "이 재고는 다른 건에 배정돼 있습니다");
    assert.equal(await pendingApprovalCount(issueRequestId), 0);
    assert.equal((await issueRequestRow(issueRequestId)).status, "REJECTED");

    // 반려된 신청은 더 결재되지 않는다.
    const again = await decidePartIssueRequestApproval({
      issueRequestId,
      decision: "APPROVED",
      actorUserId: approverBId,
      decisionReason: null,
    });
    assert.equal(again.ok, false, "반려된 신청이 다시 결재됐다");
    if (!again.ok) assert.equal(again.code, "CONFLICT");
  });

  test("🔴 23. 한 시점에 대기 중인 결재 행은 언제나 하나뿐이다", async () => {
    const issueRequestId = await arrangePending([approverAId, approverBId, approverCId]);
    assert.equal(await pendingApprovalCount(issueRequestId), 1, "신청 직후");

    for (const approverId of [approverAId, approverBId]) {
      assert.equal(
        (
          await decidePartIssueRequestApproval({
            issueRequestId,
            decision: "APPROVED",
            actorUserId: approverId,
            decisionReason: null,
          })
        ).ok,
        true
      );
      assert.equal(await pendingApprovalCount(issueRequestId), 1, "승인 직후에도 대기는 하나다");
    }

    assert.equal(
      (
        await decidePartIssueRequestApproval({
          issueRequestId,
          decision: "APPROVED",
          actorUserId: approverCId,
          decisionReason: null,
        })
      ).ok,
      true
    );
    assert.equal(await pendingApprovalCount(issueRequestId), 0, "마지막 단계 뒤에는 대기가 없다");
  });

  test("24. 이미 처리한 사람이 다시 누르면 거절된다", async () => {
    const issueRequestId = await arrangePending([approverAId, approverBId]);
    assert.equal(
      (
        await decidePartIssueRequestApproval({
          issueRequestId,
          decision: "APPROVED",
          actorUserId: approverAId,
          decisionReason: null,
        })
      ).ok,
      true
    );

    // 최신 행은 2단계(approverB 지정)다 — approverA 는 지정 관문에 막힌다.
    const again = await decidePartIssueRequestApproval({
      issueRequestId,
      decision: "APPROVED",
      actorUserId: approverAId,
      decisionReason: null,
    });
    assert.equal(again.ok, false, "이미 끝낸 사람이 다음 단계까지 결재했다");
    if (!again.ok) assert.equal(again.code, "FORBIDDEN");
    assert.equal((await approvalRows(issueRequestId)).length, 2, "거절이 행을 만들었다");
  });

  test("🔴 25. 중간 단계가 신청자면 사슬이 그 단계를 건너뛴다 — 1단계 다음이 3단계다", async () => {
    const issueRequestId = await arrangePending([approverAId, managerId, approverCId]);

    let rows = await approvalRows(issueRequestId);
    assert.equal(rows[0].routeStepOrder, 1, "1단계는 신청자가 아니므로 그대로다");

    // 🔴 사슬이 나아갈 때 보는 요청자는 **방금 결재한 사람이 아니라** 그 사슬을
    // 올린 사람(managerId)이다. 그래서 2단계를 건너뛴다.
    assert.equal(
      (
        await decidePartIssueRequestApproval({
          issueRequestId,
          decision: "APPROVED",
          actorUserId: approverAId,
          decisionReason: null,
        })
      ).ok,
      true
    );

    rows = await approvalRows(issueRequestId);
    assert.equal(rows.length, 2, "건너뛰면서 행이 둘 생겼다");
    assert.equal(rows[1].routeStepOrder, 3, "🔴 2단계가 신청자인데 그 사람에게 차례가 갔다");
    assert.equal(rows[1].assignedApproverUserId, approverCId);
    assert.equal(rows[1].requestedByUserId, managerId, "신청자는 사슬이 나아가도 그대로다");
    assert.equal((await issueRequestRow(issueRequestId)).status, "PENDING_APPROVAL");
  });

  test("🔴 26. 마지막 단계가 신청자라 건너뛰어 끝나면 APPROVED 다 — 거절이 아니다", async () => {
    const issueRequestId = await arrangePending([approverAId, managerId]);

    const decided = await decidePartIssueRequestApproval({
      issueRequestId,
      decision: "APPROVED",
      actorUserId: approverAId,
      decisionReason: null,
    });
    assert.equal(decided.ok, true, `1단계가 막혔다: ${JSON.stringify(decided)}`);

    assert.equal((await approvalRows(issueRequestId)).length, 1, "건너뛴 단계의 행이 생겼다");
    assert.equal(await pendingApprovalCount(issueRequestId), 0);
    assert.equal((await issueRequestRow(issueRequestId)).status, "APPROVED");
  });

  test("🔴 27. 판을 바꿔도 진행 중인 신청은 옛 판을 따른다", async () => {
    const oldRouteId = await saveRoute([approverAId, approverBId]);
    const created = await requestDirectUse(managerId);
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const newRouteId = await saveRoute([approverCId, approverAId]);
    assert.notEqual(newRouteId, oldRouteId, "새 판이 얹히지 않았다");

    assert.equal(
      (
        await decidePartIssueRequestApproval({
          issueRequestId: created.issueRequestId,
          decision: "APPROVED",
          actorUserId: approverAId,
          decisionReason: null,
        })
      ).ok,
      true
    );

    const rows = await approvalRows(created.issueRequestId);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].routeId, oldRouteId, "🔴 진행 중인 신청이 새 판으로 갈아탔다");
    assert.equal(
      rows[1].assignedApproverUserId,
      approverBId,
      "🔴 2단계는 옛 판의 2단계여야 한다 — 새 판의 2단계가 아니다"
    );
  });

  test("28. 없는 신청·결재 행이 없는 신청은 NOT_FOUND 다", async () => {
    const decided = await decidePartIssueRequestApproval({
      issueRequestId: randomUUID(),
      decision: "APPROVED",
      actorUserId: approverAId,
      decisionReason: null,
    });
    assert.equal(decided.ok, false);
    if (!decided.ok) assert.equal(decided.code, "NOT_FOUND");
  });
});

describe("취소 — 신청자가 되돌린다", () => {
  test("🔴 29. 대기 중인 신청을 무르면 열린 결재 행이 닫힌다 — 지우지 않는다", async () => {
    await saveRoute([approverAId, approverBId]);
    const created = await requestDirectUse(managerId);
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const cancelled = await cancelPartIssueRequest({
      issueRequestId: created.issueRequestId,
      actorUserId: managerId,
      reason: "요청이 취소되었습니다",
    });
    assert.equal(cancelled.ok, true, `취소가 막혔다: ${JSON.stringify(cancelled)}`);

    assert.equal((await issueRequestRow(created.issueRequestId)).status, "CANCELLED");

    const rows = await approvalRows(created.issueRequestId);
    assert.equal(rows.length, 1, "🔴 결재 이력이 지워졌다");
    assert.equal(rows[0].status, "REJECTED", "열린 행이 그대로 남으면 유령 대기 건이 된다");
    assert.equal(rows[0].decidedByUserId, managerId, "닫은 사람은 무른 신청자다");
    assert.match(rows[0].decisionReason ?? "", /취소/);
    assert.match(rows[0].decisionReason ?? "", /요청이 취소되었습니다/);
    assert.equal(await pendingApprovalCount(created.issueRequestId), 0);

    // 결재자의 목록에서도 빠진다.
    assert.deepEqual(await listPartIssueRequestsPendingMyApproval(approverAId), []);
  });

  test("🔴 30. 결재가 끝난(APPROVED) 신청도 무를 수 있다 — 아직 안 나갔기 때문이다", async () => {
    await saveRoute([approverAId]);
    const created = await requestDirectUse(managerId);
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(
      (
        await decidePartIssueRequestApproval({
          issueRequestId: created.issueRequestId,
          decision: "APPROVED",
          actorUserId: approverAId,
          decisionReason: null,
        })
      ).ok,
      true
    );

    const cancelled = await cancelPartIssueRequest({
      issueRequestId: created.issueRequestId,
      actorUserId: managerId,
      reason: null,
    });
    assert.equal(cancelled.ok, true, `취소가 막혔다: ${JSON.stringify(cancelled)}`);
    if (cancelled.ok) assert.equal(cancelled.closedApprovalId, null, "닫을 열린 행이 없다");

    assert.equal((await issueRequestRow(created.issueRequestId)).status, "CANCELLED");
    // 이미 끝난 결재 이력은 그대로다.
    const rows = await approvalRows(created.issueRequestId);
    assert.equal(rows[0].status, "APPROVED");
    assert.equal(rows[0].decidedByUserId, approverAId);
  });

  test("🔴 31. 신청한 사람만 무를 수 있다 — 최고관리자도 대신 무르지 않는다", async () => {
    await saveRoute([approverAId]);
    const created = await requestDirectUse(managerId);
    assert.equal(created.ok, true);
    if (!created.ok) return;

    for (const actorUserId of [superAdminId, approverAId, engineerId]) {
      const cancelled = await cancelPartIssueRequest({
        issueRequestId: created.issueRequestId,
        actorUserId,
        reason: null,
      });
      assert.equal(cancelled.ok, false, "남이 올린 신청을 물렸다");
      if (!cancelled.ok) assert.equal(cancelled.code, "FORBIDDEN");
    }

    assert.equal((await issueRequestRow(created.issueRequestId)).status, "PENDING_APPROVAL");
    assert.equal(await pendingApprovalCount(created.issueRequestId), 1);
  });

  test("🔴 32. 이미 끝난 신청은 무를 수 없다 — 취소·반려·실행", async () => {
    await saveRoute([approverAId]);

    // 반려된 신청.
    const rejectedCase = await requestDirectUse(managerId);
    assert.equal(rejectedCase.ok, true);
    if (!rejectedCase.ok) return;
    assert.equal(
      (
        await decidePartIssueRequestApproval({
          issueRequestId: rejectedCase.issueRequestId,
          decision: "REJECTED",
          actorUserId: approverAId,
          decisionReason: "재고 확인 필요",
        })
      ).ok,
      true
    );
    const afterReject = await cancelPartIssueRequest({
      issueRequestId: rejectedCase.issueRequestId,
      actorUserId: managerId,
      reason: null,
    });
    assert.equal(afterReject.ok, false, "반려된 신청이 취소됐다");
    if (!afterReject.ok) assert.equal(afterReject.code, "NOT_CANCELLABLE");

    // 두 번 무를 수 없다.
    const cancelledCase = await requestDirectUse(managerId);
    assert.equal(cancelledCase.ok, true);
    if (!cancelledCase.ok) return;
    assert.equal(
      (
        await cancelPartIssueRequest({
          issueRequestId: cancelledCase.issueRequestId,
          actorUserId: managerId,
          reason: null,
        })
      ).ok,
      true
    );
    const twice = await cancelPartIssueRequest({
      issueRequestId: cancelledCase.issueRequestId,
      actorUserId: managerId,
      reason: null,
    });
    assert.equal(twice.ok, false, "취소된 신청이 또 취소됐다");
    if (!twice.ok) assert.equal(twice.code, "NOT_CANCELLABLE");

    // 🔴 이미 나간 신청. 이 조각에는 EXECUTED 로 가는 길이 없으므로 상태를 손으로
    // 만들어 둔다(arrange 전용 — 표의 CHECK 이 실행 두 칸을 함께 요구한다).
    const executedCase = await requestDirectUse(managerId);
    assert.equal(executedCase.ok, true);
    if (!executedCase.ok) return;
    await db
      .update(inventoryPartIssueRequests)
      .set({ status: "EXECUTED", executedByUserId: managerId, executedAt: new Date() })
      .where(eq(inventoryPartIssueRequests.id, executedCase.issueRequestId));
    const afterExecute = await cancelPartIssueRequest({
      issueRequestId: executedCase.issueRequestId,
      actorUserId: managerId,
      reason: null,
    });
    assert.equal(afterExecute.ok, false, "🔴 이미 나간 부품이 취소로 되돌려졌다");
    if (!afterExecute.ok) {
      assert.equal(afterExecute.code, "NOT_CANCELLABLE");
      assert.match(afterExecute.message, /반품/);
    }
  });

  test("33. 없는 신청은 NOT_FOUND 다", async () => {
    const cancelled = await cancelPartIssueRequest({
      issueRequestId: randomUUID(),
      actorUserId: managerId,
      reason: null,
    });
    assert.equal(cancelled.ok, false);
    if (!cancelled.ok) assert.equal(cancelled.code, "NOT_FOUND");
  });
});

describe("🔴 이 조각이 하지 않는 일", () => {
  test("🔴 34. 어떤 길로도 EXECUTED 가 되지 않는다", async () => {
    await saveRoute([approverAId]);
    const created = await requestDirectUse(managerId);
    assert.equal(created.ok, true);
    if (!created.ok) return;

    assert.equal(
      (
        await decidePartIssueRequestApproval({
          issueRequestId: created.issueRequestId,
          decision: "APPROVED",
          actorUserId: approverAId,
          decisionReason: null,
        })
      ).ok,
      true
    );

    const executed = await db
      .select({ id: inventoryPartIssueRequests.id })
      .from(inventoryPartIssueRequests)
      .where(
        and(
          inArray(inventoryPartIssueRequests.requestedByUserId, createdUserIds),
          eq(inventoryPartIssueRequests.status, "EXECUTED")
        )
      );
    assert.equal(executed.length, 0, "🔴 실행은 다음 조각인데 EXECUTED 로 간 신청이 있다");

    const request = await issueRequestRow(created.issueRequestId);
    assert.equal(request.status, "APPROVED");
    assert.equal(request.executedByUserId, null);
    assert.equal(request.executedAt, null);
  });

  test("🔴 35. 재고가 한 톨도 움직이지 않는다 — 잔량도 재고 장부도 그대로다", async () => {
    const before = await stockSnapshot();

    await saveRoute([approverAId, approverBId]);
    const { requestId, itemId } = await arrangePartRequest(5);

    const byRequest = await createPartIssueRequest({
      kind: "PART_REQUEST",
      partRequestId: requestId,
      allocations: [{ requestItemId: itemId, partStockBalanceId: balanceAId, quantity: 4 }],
      requestReason: null,
      actorUserId: managerId,
    });
    assert.equal(byRequest.ok, true, JSON.stringify(byRequest));
    if (!byRequest.ok) return;

    for (const approverId of [approverAId, approverBId]) {
      assert.equal(
        (
          await decidePartIssueRequestApproval({
            issueRequestId: byRequest.issueRequestId,
            decision: "APPROVED",
            actorUserId: approverId,
            decisionReason: null,
          })
        ).ok,
        true
      );
    }
    assert.equal((await issueRequestRow(byRequest.issueRequestId)).status, "APPROVED");

    const direct = await requestDirectUse(managerId);
    assert.equal(direct.ok, true);
    if (direct.ok) {
      assert.equal(
        (
          await cancelPartIssueRequest({
            issueRequestId: direct.issueRequestId,
            actorUserId: managerId,
            reason: null,
          })
        ).ok,
        true
      );
    }

    // 🔴 신청도 결재도 취소도 재고를 건드리지 않는다 — 잔량·판번호·장부 줄 수가
    // 전부 그대로여야 한다.
    assert.deepEqual(await stockSnapshot(), before, "🔴 결재 경로가 재고를 움직였다");

    // 부품 요청의 나간 수량도 그대로다 — 승인은 「빼도 된다」까지다.
    const [item] = await db
      .select({ issuedQuantity: inventoryPartRequestItems.issuedQuantity })
      .from(inventoryPartRequestItems)
      .where(eq(inventoryPartRequestItems.id, itemId));
    assert.equal(item.issuedQuantity, 0, "🔴 승인만 했는데 요청이 불출된 것으로 적혔다");
  });
});

/**
 * ============================================================================
 * 문 달기 + 실행 (조각 ③-3)
 * ============================================================================
 * 여기부터가 못 박는 것:
 *  1. 🔴 **판이 없으면 [불출]·[사용]이 지금까지와 똑같이 동작한다.** 이것이
 *     안전장치다 — 관리자가 절차를 만들기 전까지 재고가 잠기면 안 된다.
 *  2. 🔴 판이 있으면 겉 함수가 **전용 코드로 거절**하고 그때 재고가 한 톨도
 *     움직이지 않는다.
 *  3. 🔴 **실행 경로는 문에 걸리지 않는다** — 판이 있어도 승인된 신청은 실행된다.
 *  4. 🔴 실행은 **신청 항목에 적힌 잔량 행·수량으로만** 한다.
 *  5. 🔴 **재고 이동과 상태 변경이 한 트랜잭션이다** — 중간에 막히면 먼저 나간
 *     것까지 되돌아가고 신청은 APPROVED 로 남는다.
 *  6. 🔴 **두 번 실행해도 한 번만 나간다**(이어서 눌러도, 동시에 눌러도).
 *
 * ⚠️ 이 절의 시험들은 **자기 잔량 자리를 새로 만들어** 쓴다. 위쪽 시험들이 쓰는
 * balanceA/balanceB 의 수량에 기대면, 재고를 실제로 움직이는 이 시험들이 그 값을
 * 바꿔 앞 시험을 깨뜨린다.
 * ============================================================================
 */

/** 이 시험만 쓰는 새 잔량 자리 하나. after() 가 부품과 함께 걷는다. */
async function arrangeFreshBalance(quantity: number): Promise<string> {
  const received = await receiveStock({
    partId,
    owner: "DSS",
    location: `${TEST_LOCATION}-${randomUUID().slice(0, 8)}`,
    quantity,
    actorUserId: superAdminId,
  });
  assert.equal(received.ok, true, `setup stock failed: ${JSON.stringify(received)}`);
  if (!received.ok) throw new Error("unreachable");
  return received.partStockBalanceId;
}

async function balanceRow(balanceId: string) {
  const [row] = await db
    .select({
      currentQuantity: partStockBalances.currentQuantity,
      version: partStockBalances.version,
      location: partStockBalances.location,
    })
    .from(partStockBalances)
    .where(eq(partStockBalances.id, balanceId));
  return row;
}

/** 그 자리의 **사용(USE)** 장부 줄들. 입고 줄은 세지 않는다. */
async function useRowsFor(balanceId: string) {
  const rows = await db
    .select({
      transactionType: stockTransactions.transactionType,
      quantityDelta: stockTransactions.quantityDelta,
      resultingQuantity: stockTransactions.resultingQuantity,
      repairCaseId: stockTransactions.repairCaseId,
      destinationNote: stockTransactions.destinationNote,
      requestItemId: stockTransactions.requestItemId,
      requestIssueId: stockTransactions.requestIssueId,
      actorUserId: stockTransactions.actorUserId,
    })
    .from(stockTransactions)
    .where(eq(stockTransactions.partStockBalanceId, balanceId));
  return rows.filter((row) => row.transactionType === "USE");
}

async function approveAll(issueRequestId: string, approverIds: string[]): Promise<void> {
  for (const approverId of approverIds) {
    const decided = await decidePartIssueRequestApproval({
      issueRequestId,
      decision: "APPROVED",
      actorUserId: approverId,
      decisionReason: null,
    });
    assert.equal(decided.ok, true, `approve failed: ${JSON.stringify(decided)}`);
  }
}

/** 결재까지 끝난 직접 사용 신청 하나. 부르기 전에 판이 저장돼 있어야 한다. */
async function arrangeApprovedDirectUse(balanceId: string, quantity: number): Promise<string> {
  const created = await createPartIssueRequest({
    kind: "DIRECT_USE",
    partStockBalanceId: balanceId,
    quantity,
    repairCaseId: null,
    destinationNote: "상해수리소",
    procedureExecutionNodeId: null,
    requestReason: "실행 시험",
    actorUserId: managerId,
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  if (!created.ok) throw new Error("unreachable");
  await approveAll(created.issueRequestId, [approverAId]);
  assert.equal((await issueRequestRow(created.issueRequestId)).status, "APPROVED");
  return created.issueRequestId;
}

/** 결재까지 끝난 요청 기반 신청 하나 — 한 요청 줄을 여러 잔량 자리로 나눠 담는다. */
async function arrangeApprovedRequestIssue(
  requestedQuantity: number,
  lines: { balanceId: string; quantity: number }[]
): Promise<{ issueRequestId: string; requestId: string; itemId: string }> {
  const { requestId, itemId } = await arrangePartRequest(requestedQuantity);
  const created = await createPartIssueRequest({
    kind: "PART_REQUEST",
    partRequestId: requestId,
    allocations: lines.map((line) => ({
      requestItemId: itemId,
      partStockBalanceId: line.balanceId,
      quantity: line.quantity,
    })),
    requestReason: "실행 시험",
    actorUserId: managerId,
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  if (!created.ok) throw new Error("unreachable");
  await approveAll(created.issueRequestId, [approverAId]);
  assert.equal((await issueRequestRow(created.issueRequestId)).status, "APPROVED");
  return { issueRequestId: created.issueRequestId, requestId, itemId };
}

describe("🔴 문 — 「부품 불출」 절차가 있을 때만 바로 못 뺀다", () => {
  test("🔴 36. 판이 없으면 [불출]·[사용]이 지금까지와 똑같이 동작한다", async () => {
    // 판을 저장하지 않는다 — afterEach 가 매번 걷으므로 여기는 「절차 없음」이다.
    const directBalance = await arrangeFreshBalance(5);
    const before = await balanceRow(directBalance);

    const used = await consumeStock({
      partStockBalanceId: directBalance,
      quantity: 2,
      destinationNote: "상해수리소",
      actorUserId: managerId,
      expectedVersion: before.version,
    });
    assert.equal(used.ok, true, `🔴 절차가 없는데 사용이 막혔다: ${JSON.stringify(used)}`);
    if (used.ok) assert.equal(used.resultingQuantity, 3);
    assert.equal((await balanceRow(directBalance)).currentQuantity, 3);

    const issueBalance = await arrangeFreshBalance(5);
    const { requestId, itemId } = await arrangePartRequest(3);
    const issued = await issuePartRequest({
      requestId,
      allocations: [{ requestItemId: itemId, partStockBalanceId: issueBalance, quantity: 3 }],
      actorUserId: managerId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(issued.ok, true, `🔴 절차가 없는데 불출이 막혔다: ${JSON.stringify(issued)}`);
    if (issued.ok) assert.equal(issued.status, "FULLY_ISSUED");
    assert.equal((await balanceRow(issueBalance)).currentQuantity, 2);
  });

  test("🔴 37. 판이 있으면 두 길 다 거절하고 재고가 한 톨도 안 움직인다", async () => {
    await saveRoute([approverAId]);

    const directBalance = await arrangeFreshBalance(5);
    const beforeDirect = await balanceRow(directBalance);
    const used = await consumeStock({
      partStockBalanceId: directBalance,
      quantity: 2,
      destinationNote: "상해수리소",
      actorUserId: managerId,
      expectedVersion: beforeDirect.version,
    });
    assert.equal(used.ok, false, "🔴 절차가 있는데 재고가 그냥 나갔다");
    if (!used.ok) {
      assert.equal(used.code, "PART_ISSUE_APPROVAL_REQUIRED");
      assert.match(used.message, /불출 승인 요청/);
    }
    assert.deepEqual(await balanceRow(directBalance), beforeDirect, "🔴 막혔는데 잔량이 바뀌었다");
    assert.equal((await useRowsFor(directBalance)).length, 0);

    const issueBalance = await arrangeFreshBalance(5);
    const beforeIssue = await balanceRow(issueBalance);
    const { requestId, itemId } = await arrangePartRequest(3);
    const idempotencyKey = randomUUID();
    const issued = await issuePartRequest({
      requestId,
      allocations: [{ requestItemId: itemId, partStockBalanceId: issueBalance, quantity: 3 }],
      actorUserId: managerId,
      idempotencyKey,
    });
    assert.equal(issued.ok, false, "🔴 절차가 있는데 불출이 그냥 나갔다");
    if (!issued.ok) {
      assert.equal(issued.code, "PART_ISSUE_APPROVAL_REQUIRED");
      assert.match(issued.message, /불출 승인 요청/);
    }
    assert.deepEqual(await balanceRow(issueBalance), beforeIssue, "🔴 막혔는데 잔량이 바뀌었다");
    assert.equal((await useRowsFor(issueBalance)).length, 0);

    // 🔴 문이 **중복 방지 청구보다 먼저** 있다 — 막힌 시도가 열쇠를 태우면 사람이
    // 절차를 만든 뒤 같은 열쇠로 다시 눌렀을 때 「이전 제출과 다르다」로 막힌다.
    const claimed = await db
      .select({ idempotencyKey: inventoryPartRequestIdempotencyKeys.idempotencyKey })
      .from(inventoryPartRequestIdempotencyKeys)
      .where(eq(inventoryPartRequestIdempotencyKeys.idempotencyKey, idempotencyKey));
    assert.equal(claimed.length, 0, "🔴 문에 막힌 시도가 중복 방지 열쇠를 남겼다");

    // 요청의 나간 수량도 그대로 0이다.
    const [item] = await db
      .select({ issuedQuantity: inventoryPartRequestItems.issuedQuantity })
      .from(inventoryPartRequestItems)
      .where(eq(inventoryPartRequestItems.id, itemId));
    assert.equal(item.issuedQuantity, 0);
  });
});

describe("🔴 실행 — 승인된 신청으로 재고가 나간다", () => {
  test("🔴 38. 요청 기반 — 신청 항목에 적힌 대로 정확히 나가고 EXECUTED 가 된다", async () => {
    await saveRoute([approverAId]);
    const balanceId = await arrangeFreshBalance(10);
    const { issueRequestId, itemId } = await arrangeApprovedRequestIssue(5, [
      { balanceId, quantity: 4 },
    ]);

    // 🔴 판이 그대로 서 있는 채로 실행한다 — 실행 경로는 문에 걸리지 않는다.
    const executed = await executePartIssueRequest({ issueRequestId, actorUserId: managerId });
    assert.equal(executed.ok, true, `🔴 승인된 신청이 실행되지 않았다: ${JSON.stringify(executed)}`);
    if (!executed.ok) return;
    assert.equal(executed.status, "EXECUTED");
    assert.ok(executed.requestIssueId, "요청 기반 실행인데 불출 사건이 없다");
    assert.deepEqual(executed.movedBalanceIds, [balanceId]);

    assert.equal(
      (await balanceRow(balanceId)).currentQuantity,
      6,
      "🔴 신청 항목에 적힌 수량과 다르게 나갔다"
    );

    const uses = await useRowsFor(balanceId);
    assert.equal(uses.length, 1);
    assert.equal(uses[0].quantityDelta, -4);
    assert.equal(uses[0].resultingQuantity, 6);
    assert.equal(uses[0].requestItemId, itemId);
    assert.equal(uses[0].requestIssueId, executed.requestIssueId);
    assert.equal(uses[0].actorUserId, managerId, "실행자가 장부에 남지 않았다");

    const [requestItem] = await db
      .select({
        issuedQuantity: inventoryPartRequestItems.issuedQuantity,
        requestId: inventoryPartRequestItems.requestId,
      })
      .from(inventoryPartRequestItems)
      .where(eq(inventoryPartRequestItems.id, itemId));
    assert.equal(requestItem.issuedQuantity, 4, "부품 요청의 나간 수량이 갱신되지 않았다");
    const [partRequest] = await db
      .select({ status: inventoryPartRequests.status })
      .from(inventoryPartRequests)
      .where(eq(inventoryPartRequests.id, requestItem.requestId));
    assert.equal(partRequest.status, "PARTIALLY_ISSUED");

    const header = await issueRequestRow(issueRequestId);
    assert.equal(header.status, "EXECUTED");
    assert.equal(header.executedByUserId, managerId);
    assert.ok(header.executedAt, "🔴 실행 시각이 비어 있다(표의 CHECK 이 셋을 함께 요구한다)");
  });

  test("🔴 39. 직접 사용 — 사용처·실행자가 그대로 장부에 남는다", async () => {
    await saveRoute([approverAId]);
    const balanceId = await arrangeFreshBalance(6);
    const issueRequestId = await arrangeApprovedDirectUse(balanceId, 2);

    const executed = await executePartIssueRequest({ issueRequestId, actorUserId: managerId });
    assert.equal(executed.ok, true, JSON.stringify(executed));
    if (!executed.ok) return;
    assert.equal(executed.requestIssueId, null, "직접 사용인데 불출 사건이 생겼다");

    assert.equal((await balanceRow(balanceId)).currentQuantity, 4);
    const uses = await useRowsFor(balanceId);
    assert.equal(uses.length, 1);
    assert.equal(uses[0].quantityDelta, -2);
    assert.equal(
      uses[0].destinationNote,
      "상해수리소",
      "🔴 신청 헤더의 사용처가 장부로 넘어가지 않았다"
    );
    assert.equal(uses[0].repairCaseId, null);
    assert.equal(uses[0].requestItemId, null);
    assert.equal(uses[0].actorUserId, managerId);

    const header = await issueRequestRow(issueRequestId);
    assert.equal(header.status, "EXECUTED");
    assert.equal(header.executedByUserId, managerId);
    assert.ok(header.executedAt);
  });

  test("🔴 40. 두 번 실행해도 한 번만 나간다 — 이어서 눌러도, 동시에 눌러도", async () => {
    await saveRoute([approverAId]);

    const sequentialBalance = await arrangeFreshBalance(6);
    const sequentialId = await arrangeApprovedDirectUse(sequentialBalance, 2);
    assert.equal(
      (await executePartIssueRequest({ issueRequestId: sequentialId, actorUserId: managerId })).ok,
      true
    );
    const again = await executePartIssueRequest({
      issueRequestId: sequentialId,
      actorUserId: managerId,
    });
    assert.equal(again.ok, false, "🔴 같은 신청이 두 번 실행됐다");
    if (!again.ok) {
      assert.equal(again.code, "NOT_EXECUTABLE");
      assert.match(again.message, /이미 실행/);
    }
    assert.equal((await balanceRow(sequentialBalance)).currentQuantity, 4, "🔴 두 번 빠졌다");
    assert.equal((await useRowsFor(sequentialBalance)).length, 1);

    const concurrentBalance = await arrangeFreshBalance(6);
    const concurrentId = await arrangeApprovedDirectUse(concurrentBalance, 2);
    const results = await Promise.all([
      executePartIssueRequest({ issueRequestId: concurrentId, actorUserId: managerId }),
      executePartIssueRequest({ issueRequestId: concurrentId, actorUserId: managerId }),
    ]);
    assert.equal(
      results.filter((row) => row.ok).length,
      1,
      "🔴 동시에 누른 두 실행이 둘 다 통과했다"
    );
    const blocked = results.find((row) => !row.ok);
    assert.ok(blocked, "둘 다 통과하지 않았다면 막힌 쪽이 있어야 한다");
    if (blocked && !blocked.ok) assert.equal(blocked.code, "NOT_EXECUTABLE");
    assert.equal(
      (await balanceRow(concurrentBalance)).currentQuantity,
      4,
      "🔴 동시에 눌러 두 번 빠졌다"
    );
    assert.equal((await useRowsFor(concurrentBalance)).length, 1);
  });

  test("🔴 41. 승인되지 않은 신청은 실행되지 않는다 — 대기·반려·취소", async () => {
    await saveRoute([approverAId]);

    // 아직 결재 중.
    const pendingBalance = await arrangeFreshBalance(5);
    const pending = await createPartIssueRequest({
      kind: "DIRECT_USE",
      partStockBalanceId: pendingBalance,
      quantity: 2,
      repairCaseId: null,
      destinationNote: "상해수리소",
      procedureExecutionNodeId: null,
      requestReason: null,
      actorUserId: managerId,
    });
    assert.equal(pending.ok, true);
    if (!pending.ok) return;
    const pendingResult = await executePartIssueRequest({
      issueRequestId: pending.issueRequestId,
      actorUserId: managerId,
    });
    assert.equal(pendingResult.ok, false, "🔴 결재가 끝나기 전에 재고가 나갔다");
    if (!pendingResult.ok) {
      assert.equal(pendingResult.code, "NOT_EXECUTABLE");
      assert.match(pendingResult.message, /결재/);
    }
    assert.equal((await balanceRow(pendingBalance)).currentQuantity, 5);
    assert.equal((await useRowsFor(pendingBalance)).length, 0);

    // 반려됐다.
    const rejectedBalance = await arrangeFreshBalance(5);
    const rejected = await createPartIssueRequest({
      kind: "DIRECT_USE",
      partStockBalanceId: rejectedBalance,
      quantity: 2,
      repairCaseId: null,
      destinationNote: "상해수리소",
      procedureExecutionNodeId: null,
      requestReason: null,
      actorUserId: managerId,
    });
    assert.equal(rejected.ok, true);
    if (!rejected.ok) return;
    assert.equal(
      (
        await decidePartIssueRequestApproval({
          issueRequestId: rejected.issueRequestId,
          decision: "REJECTED",
          actorUserId: approverAId,
          decisionReason: "재고 확인 필요",
        })
      ).ok,
      true
    );
    const rejectedResult = await executePartIssueRequest({
      issueRequestId: rejected.issueRequestId,
      actorUserId: managerId,
    });
    assert.equal(rejectedResult.ok, false, "🔴 반려된 신청이 실행됐다");
    if (!rejectedResult.ok) assert.equal(rejectedResult.code, "NOT_EXECUTABLE");
    assert.equal((await balanceRow(rejectedBalance)).currentQuantity, 5);
    assert.equal((await useRowsFor(rejectedBalance)).length, 0);

    // 승인 뒤에 무른 신청.
    const cancelledBalance = await arrangeFreshBalance(5);
    const cancelledId = await arrangeApprovedDirectUse(cancelledBalance, 2);
    assert.equal(
      (
        await cancelPartIssueRequest({
          issueRequestId: cancelledId,
          actorUserId: managerId,
          reason: null,
        })
      ).ok,
      true
    );
    const cancelledResult = await executePartIssueRequest({
      issueRequestId: cancelledId,
      actorUserId: managerId,
    });
    assert.equal(cancelledResult.ok, false, "🔴 무른 신청이 실행됐다");
    if (!cancelledResult.ok) assert.equal(cancelledResult.code, "NOT_EXECUTABLE");
    assert.equal((await balanceRow(cancelledBalance)).currentQuantity, 5);
    assert.equal((await useRowsFor(cancelledBalance)).length, 0);
  });

  test("🔴 42. 재고가 모자라면 기존 코드가 막고 신청은 APPROVED 로 남는다", async () => {
    await saveRoute([approverAId]);
    const balanceId = await arrangeFreshBalance(4);
    const issueRequestId = await arrangeApprovedDirectUse(balanceId, 4);

    // 결재 사이에 남이 가져간 상황을 만든다(arrange 전용 직접 갱신 — 이 판이 서
    // 있는 동안에는 [사용]으로 뺄 수 없다. 그것이 이 조각이 만든 문이다).
    const before = await balanceRow(balanceId);
    await db
      .update(partStockBalances)
      .set({ currentQuantity: 1, version: before.version + 1, updatedAt: new Date() })
      .where(eq(partStockBalances.id, balanceId));
    const drained = await balanceRow(balanceId);

    const executed = await executePartIssueRequest({ issueRequestId, actorUserId: managerId });
    assert.equal(executed.ok, false, "🔴 재고가 모자란데 실행이 통과했다");
    if (!executed.ok) {
      assert.equal(executed.code, "INSUFFICIENT_STOCK");
      assert.match(executed.message, /재고가 부족/);
    }

    assert.deepEqual(await balanceRow(balanceId), drained, "🔴 막혔는데 잔량이 바뀌었다");
    assert.equal((await useRowsFor(balanceId)).length, 0);

    const header = await issueRequestRow(issueRequestId);
    assert.equal(header.status, "APPROVED", "🔴 실행이 막혔는데 신청이 EXECUTED 가 됐다");
    assert.equal(header.executedByUserId, null);
    assert.equal(header.executedAt, null);

    // 🔴 APPROVED 로 남겨 두는 이유 — 입고 뒤에 다시 누르면 그대로 나간다.
    const refilled = await receiveStock({
      partId,
      owner: "DSS",
      location: drained.location,
      quantity: 10,
      actorUserId: superAdminId,
    });
    assert.equal(refilled.ok, true, JSON.stringify(refilled));
    const retried = await executePartIssueRequest({ issueRequestId, actorUserId: managerId });
    assert.equal(retried.ok, true, `🔴 입고 뒤에도 실행되지 않았다: ${JSON.stringify(retried)}`);
    assert.equal((await balanceRow(balanceId)).currentQuantity, 7);
    assert.equal((await issueRequestRow(issueRequestId)).status, "EXECUTED");
  });

  test("🔴 43. 재고 이동과 상태 변경이 한 트랜잭션이다 — 막히면 먼저 나간 것도 되돌아간다", async () => {
    await saveRoute([approverAId]);

    // ── (가) 상태가 이미 바뀌어 있으면 재고도 안 나간다 ──────────────────
    const cancelledBalance = await arrangeFreshBalance(5);
    const cancelledId = await arrangeApprovedDirectUse(cancelledBalance, 2);
    // 다른 트랜잭션이 먼저 물린 상황을 만든다(arrange 전용).
    await db
      .update(inventoryPartIssueRequests)
      .set({ status: "CANCELLED", updatedAt: new Date() })
      .where(eq(inventoryPartIssueRequests.id, cancelledId));
    const stateChanged = await executePartIssueRequest({
      issueRequestId: cancelledId,
      actorUserId: managerId,
    });
    assert.equal(stateChanged.ok, false);
    if (!stateChanged.ok) assert.equal(stateChanged.code, "NOT_EXECUTABLE");
    assert.equal(
      (await balanceRow(cancelledBalance)).currentQuantity,
      5,
      "🔴 상태가 막혔는데 재고가 나갔다"
    );
    assert.equal((await useRowsFor(cancelledBalance)).length, 0);

    // ── (나) 두 자리 중 뒤엣것이 모자라면 **앞엣것도 되돌아간다** ─────────
    // 불출은 잔량 행 id 순으로 나간다(mergeDuplicateAllocations 의 정렬). 뒤에 오는
    // 자리를 비워 두면 앞자리는 이미 빠진 뒤에 막히고, 그때 앞자리까지 되돌아가는지가
    // 이 시험의 전부다 — 되돌아가지 않으면 「재고는 나갔는데 신청은 승인됨」이다.
    const madeFirst = await arrangeFreshBalance(3);
    const madeSecond = await arrangeFreshBalance(3);
    const [earlier, later] = [madeFirst, madeSecond].sort();
    const { issueRequestId, itemId } = await arrangeApprovedRequestIssue(6, [
      { balanceId: earlier, quantity: 3 },
      { balanceId: later, quantity: 3 },
    ]);

    const laterBefore = await balanceRow(later);
    await db
      .update(partStockBalances)
      .set({ currentQuantity: 1, version: laterBefore.version + 1, updatedAt: new Date() })
      .where(eq(partStockBalances.id, later));

    const executed = await executePartIssueRequest({ issueRequestId, actorUserId: managerId });
    assert.equal(executed.ok, false, "🔴 뒤엣자리가 모자란데 실행이 통과했다");
    if (!executed.ok) assert.equal(executed.code, "INSUFFICIENT_STOCK");

    assert.equal(
      (await balanceRow(earlier)).currentQuantity,
      3,
      "🔴 뒤에서 막혔는데 먼저 나간 재고가 되돌아오지 않았다"
    );
    assert.equal((await balanceRow(later)).currentQuantity, 1);
    assert.equal((await useRowsFor(earlier)).length, 0, "🔴 되돌아갔어야 할 장부 줄이 남아 있다");
    assert.equal((await useRowsFor(later)).length, 0);

    const header = await issueRequestRow(issueRequestId);
    assert.equal(header.status, "APPROVED");
    assert.equal(header.executedByUserId, null);
    assert.equal(header.executedAt, null);

    const [requestItem] = await db
      .select({ issuedQuantity: inventoryPartRequestItems.issuedQuantity })
      .from(inventoryPartRequestItems)
      .where(eq(inventoryPartRequestItems.id, itemId));
    assert.equal(requestItem.issuedQuantity, 0, "🔴 되돌아갔는데 요청이 불출된 것으로 적혔다");
  });

  test("🔴 44. 자격 없는 사람은 실행할 수 없다 — 두 갈래 모두", async () => {
    await saveRoute([approverAId]);

    const directBalance = await arrangeFreshBalance(5);
    const directId = await arrangeApprovedDirectUse(directBalance, 2);
    const directResult = await executePartIssueRequest({
      issueRequestId: directId,
      actorUserId: engineerId,
    });
    assert.equal(directResult.ok, false, "🔴 자격 없는 사람이 재고를 뺐다");
    if (!directResult.ok) {
      assert.equal(directResult.code, "FORBIDDEN");
      assert.match(directResult.message, /재고를 사용할 권한/);
    }
    assert.equal((await balanceRow(directBalance)).currentQuantity, 5);
    assert.equal((await useRowsFor(directBalance)).length, 0);

    const issueBalance = await arrangeFreshBalance(5);
    const { issueRequestId } = await arrangeApprovedRequestIssue(4, [
      { balanceId: issueBalance, quantity: 3 },
    ]);
    const issueResult = await executePartIssueRequest({
      issueRequestId,
      actorUserId: engineerId,
    });
    assert.equal(issueResult.ok, false, "🔴 자격 없는 사람이 불출했다");
    if (!issueResult.ok) {
      assert.equal(issueResult.code, "FORBIDDEN");
      assert.match(issueResult.message, /불출 권한/);
    }
    assert.equal((await balanceRow(issueBalance)).currentQuantity, 5);
    assert.equal((await useRowsFor(issueBalance)).length, 0);

    // 🔴 결재선에 올라간 사람이라고 실행까지 할 수 있는 것은 아니다 — 결재는
    // 「해도 된다」이고 실행은 재고를 만지는 일이라 자격이 다르다.
    const approverResult = await executePartIssueRequest({
      issueRequestId,
      actorUserId: approverAId,
    });
    assert.equal(approverResult.ok, false, "🔴 결재자가 그대로 실행까지 했다");
    if (!approverResult.ok) assert.equal(approverResult.code, "FORBIDDEN");
    assert.equal((await balanceRow(issueBalance)).currentQuantity, 5);
  });

  test("45. 없는 신청은 NOT_FOUND 다", async () => {
    const executed = await executePartIssueRequest({
      issueRequestId: randomUUID(),
      actorUserId: managerId,
    });
    assert.equal(executed.ok, false);
    if (!executed.ok) assert.equal(executed.code, "NOT_FOUND");
  });
});
