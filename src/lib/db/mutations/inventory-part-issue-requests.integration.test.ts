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
import { createPart, receiveStock } from "./inventory";
import { createPartRequest } from "./inventory-part-requests";
import {
  cancelPartIssueRequest,
  createPartIssueRequest,
  decidePartIssueRequestApproval,
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
    await db
      .delete(inventoryPartRequestIdempotencyKeys)
      .where(inArray(inventoryPartRequestIdempotencyKeys.requestId, partRequestIds));
    await db
      .delete(inventoryPartRequestHistory)
      .where(inArray(inventoryPartRequestHistory.requestId, partRequestIds));
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
