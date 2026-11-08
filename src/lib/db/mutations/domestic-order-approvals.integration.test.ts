import "../../../../scripts/load-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asc, eq, inArray, like, sql } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  auditLogs,
  domesticOrders,
  repairCaseApprovals,
  shipmentApprovalRouteSteps,
  shipmentApprovalRoutes,
  users,
} from "../schema";
import { createDomesticOrder, updateDomesticOrder } from "./domestic-orders";
import { softDeleteDomesticOrder } from "./domestic-orders-trash";
import { decideDomesticOrderApproval, requestDomesticOrderApproval } from "./domestic-order-approvals";
import { saveShipmentApprovalRoute } from "./shipment-approval-routes";
import {
  getDomesticOrderApprovalHistory,
  getDomesticOrderApprovalProgress,
} from "../queries/domestic-order-approvals";
import {
  countRepairCasesPendingMyApproval,
  listRepairCasesPendingMyApproval,
} from "../queries/repair-case-approvals-pending";
import { getCurrentShipmentApprovalRoute } from "../queries/shipment-approval-routes";
import {
  DOMESTIC_ORDER_APPROVAL_ROUTE_MISSING_NOTICE,
  DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE,
  DOMESTIC_ORDER_APPROVAL_TYPE,
} from "@/lib/domain/domestic-order-approval-rules";
import type { DomesticOrderFields } from "@/lib/validation/domestic-order-input";

/**
 * ============================================================================
 * 기타건 최종 출하 승인 — 실제 DB (시험 DB)
 * ============================================================================
 * mutations/quote-approvals.integration.test.ts 를 그대로 본떴다. 여기서 못 박는
 * 것 여덟:
 *  1. 🔴 **결재선 판이 없거나 단계가 0개면 요청 자체를 거절한다** — 기타건에는
 *     「출하 대표」 같은 대신할 결재자가 없다. 그때 돌려주는 말이 **화면이 누르기
 *     전에 하는 말과 같은 한 줄**인지까지 본다.
 *  2. 🔴 요청하면 그 시점의 `domestic_orders.version` 이 실린다 — 이 칸 하나에
 *     「승인 뒤 줄이 바뀌면 그 승인은 무효」가 걸려 있다.
 *  3. 결재선의 단계를 **순서대로** 밟고 마지막 단계에서 끝난다. 단계마다 행이
 *     하나씩이고 이어진 행은 요청자·사유·판 번호를 물려받는다.
 *  4. 반려에는 **사유가 필수**이고, 반려 뒤에는 **새 요청**을 올릴 수 있다.
 *  5. 🔴 **한 기타건에 살아 있는 요청은 하나다**(부분 유니크 색인).
 *  6. 지정된 사람이 아니면 결재할 수 없다 — 단, **최고관리자 비상구**는 열려 있다.
 *  7. 🔴 **올리는 것은 `domesticOrders` WRITE 다.** 결재는 그 열쇠를 묻지 않는다.
 *  8. 🔴 **접수 건 승인이 한 톨도 바뀌지 않는다** — 같은 표를 쓰지만 기타건 행은
 *     `repair_case_id` 가 언제나 NULL 이고 승인 종류가 달라, 접수 건 결재 대기
 *     조회에 들어가지 않는다. 표의 CHECK 넷이 그 갈림을 DB 에서 못 박는다.
 *
 * ── 격리·청소 규약 ──────────────────────────────────────────────────────
 * 이 파일이 만든 "domesticapproval-test-" 계정과 그 계정이 만든 내자 줄만 쓴다.
 * ⚠️ **판·단계는 afterEach 로 반드시 걷는다** — 시험 DB 에 판이 남으면 다른 시험
 * 파일이 갑자기 결재선을 타면서 깨진다. 사람 참조가 RESTRICT 라 삭제에는 순서가
 * 있다: 결재 행 → 내자 줄 → 단계 → 판 → 감사 기록 → 사람.
 *
 * 🔵 **접수 건을 하나도 만들지 않는다.** 인수번호가 한 달에 99개뿐이라
 * (intake_sequences) 시험이 접수 건을 늘리면 한참 뒤 남의 시험이 까닭 없이 깨진다.
 * 8번을 재는 데에도 접수 건이 필요 없다 — 재는 것은 「기타건 행이 접수 건 조회에
 * 들어가는가」이고, 그 표본은 기타건 행 자신이다.
 * ============================================================================
 */

const RUN = randomUUID().slice(0, 8);
const TEST_EMAIL_PREFIX = "domesticapproval-test-";
const TEST_PO_PREFIX = `DOA-TEST-${RUN}-`;

/** 내자 줄을 고칠 수 있는 역할(domesticOrders WRITE 기본값)이다 — 요청을 올린다. */
let requesterId: string;
let stepAId: string;
let stepBId: string;
/** 자격은 있는데 결재선에는 없는 사람 — 지정 관문에 막혀야 한다. */
let outsiderId: string;
/** 판을 저장하는 사람 + 「언제나 처리할 수 있는」 비상구. */
let superAdminId: string;
/** 🔴 내자 권한이 없는 역할(INVENTORY_MANAGER 하나다) — 요청이 막혀야 한다. */
let noDomesticPermissionId: string;

const createdTestUserIds: string[] = [];
const createdOrderIds: string[] = [];

async function createTestUser(
  name: string,
  overrides: Partial<typeof users.$inferInsert> = {}
): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      email: `${TEST_EMAIL_PREFIX}${randomUUID().slice(0, 8)}@example.test`,
      name,
      // 내자 정리를 보고 고칠 수 있는 기본 역할(domestic-order-authorization.ts).
      // 결재선 단계에 올라갈 사람들도 같은 역할로 둔다.
      role: "SALES",
      approvalStatus: "APPROVED",
      isActive: true,
      isDeveloper: false,
      ...overrides,
    })
    .returning({ id: users.id });
  createdTestUserIds.push(row.id);
  return row.id;
}

/** 필수 칸이 따로 없는 표라 거의 다 null 로 둔다 — 알아볼 번호만 넣는다. */
function orderFields(overrides: Partial<DomesticOrderFields> = {}): DomesticOrderFields {
  return {
    repairCaseId: null,
    intakeNumberText: null,
    customerId: null,
    modelNameText: "승인시험 형식",
    lotNumberText: null,
    serialNumberText: null,
    faultDescriptionText: null,
    displayOrder: null,
    purchaseOrderNumber: `${TEST_PO_PREFIX}${randomUUID().slice(0, 8)}`,
    projectName: null,
    orderIssuedDate: null,
    dueDates: [],
    quoteIssuedDate: null,
    quoteNumber: null,
    quoteId: null,
    progressNote: null,
    deliveredDate: null,
    deliveredBy: null,
    taxInvoiceDate: null,
    amountExcludingVat: null,
    paymentCompleted: false,
    japanRemittanceNote: null,
    historyNote: null,
    etcNote: null,
    ...overrides,
  };
}

type TestOrder = { id: string; version: number; fields: DomesticOrderFields };

async function createTestOrder(): Promise<TestOrder> {
  const fields = orderFields();
  const created = await createDomesticOrder({ fields, actorUserId: requesterId });
  assert.equal(created.ok, true, `setup order create failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  createdOrderIds.push(created.id);
  return { id: created.id, version: created.version, fields };
}

/** 그 줄을 한 번 고쳐 판 번호를 올린다 — 「내용이 바뀌었다」를 만드는 길. */
async function bumpOrderVersion(order: TestOrder): Promise<number> {
  const fields = { ...order.fields, etcNote: `고침 ${randomUUID().slice(0, 4)}` };
  const updated = await updateDomesticOrder({
    id: order.id,
    expectedVersion: order.version,
    fields,
    actorUserId: requesterId,
  });
  assert.equal(updated.ok, true, `setup order update failed: ${JSON.stringify(updated)}`);
  if (!updated.ok) throw new Error("unreachable");
  order.fields = fields;
  order.version = updated.version;
  return updated.version;
}

/** 그 줄의 결재 행들 — 오래된 것부터. */
async function approvalRows(domesticOrderId: string) {
  return db
    .select()
    .from(repairCaseApprovals)
    .where(eq(repairCaseApprovals.domesticOrderId, domesticOrderId))
    .orderBy(asc(repairCaseApprovals.requestedAt));
}

/** 「지금 대기 중인 단계」가 몇 개인가 — 언제나 0 또는 1이어야 한다. */
async function pendingCount(domesticOrderId: string): Promise<number> {
  const rows = await approvalRows(domesticOrderId);
  return rows.filter((row) => row.status === "REQUESTED").length;
}

async function saveDomesticRoute(approverUserIds: string[]): Promise<string> {
  const result = await saveShipmentApprovalRoute(
    approverUserIds,
    superAdminId,
    DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE
  );
  assert.equal(result.ok, true, `setup route save failed: ${JSON.stringify(result)}`);
  const current = await getCurrentShipmentApprovalRoute(DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE);
  assert.ok(current, "저장했는데 현재 판이 없다");
  return current.id;
}

async function removeFixtures(): Promise<void> {
  if (createdTestUserIds.length > 0) {
    // 결재 행이 먼저다 — 판을 RESTRICT 로 참조한다. 내자 줄이 완전 삭제되면
    // domestic_order_id 가 NULL 로 풀리므로 **요청자**로도 한 번 더 고른다.
    await db
      .delete(repairCaseApprovals)
      .where(inArray(repairCaseApprovals.requestedByUserId, createdTestUserIds));
  }
  if (createdOrderIds.length > 0) {
    await db
      .delete(repairCaseApprovals)
      .where(inArray(repairCaseApprovals.domesticOrderId, createdOrderIds));
    await db.delete(domesticOrders).where(inArray(domesticOrders.id, createdOrderIds));
    createdOrderIds.length = 0;
  }
  if (createdTestUserIds.length > 0) {
    await db
      .delete(shipmentApprovalRouteSteps)
      .where(inArray(shipmentApprovalRouteSteps.approverUserId, createdTestUserIds));
    await db
      .delete(shipmentApprovalRoutes)
      .where(inArray(shipmentApprovalRoutes.createdByUserId, createdTestUserIds));
    // audit_logs.actor_user_id → users (restrict): 행위자로만 고른다.
    await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, createdTestUserIds));
  }
}

/** 이전 실행이 중간에 끊겨 남은 이 파일의 계정과 그 흔적까지 걷는다. */
async function removeLeftovers(): Promise<void> {
  const leftovers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  const ids = leftovers.map((row) => row.id);
  if (ids.length === 0) return;

  await db.delete(repairCaseApprovals).where(inArray(repairCaseApprovals.requestedByUserId, ids));
  await db.delete(domesticOrders).where(inArray(domesticOrders.createdBy, ids));
  await db
    .delete(shipmentApprovalRouteSteps)
    .where(inArray(shipmentApprovalRouteSteps.approverUserId, ids));
  await db.delete(shipmentApprovalRoutes).where(inArray(shipmentApprovalRoutes.createdByUserId, ids));
  await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, ids));
  await db.delete(users).where(inArray(users.id, ids));
}

before(async () => {
  await removeLeftovers();

  assert.equal(
    await getCurrentShipmentApprovalRoute(DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE),
    null,
    "이 시험은 기타건 승인 절차가 하나도 없는 상태를 전제로 합니다"
  );

  requesterId = await createTestUser("기타건결재시험 요청자");
  stepAId = await createTestUser("기타건결재시험 1단계");
  stepBId = await createTestUser("기타건결재시험 2단계");
  outsiderId = await createTestUser("기타건결재시험 제삼자");
  superAdminId = await createTestUser("기타건결재시험 최고관리자", { role: "SUPER_ADMIN" });
  noDomesticPermissionId = await createTestUser("기타건결재시험 재고담당", {
    role: "INVENTORY_MANAGER",
  });
});

afterEach(async () => {
  await removeFixtures();
});

after(async () => {
  await removeFixtures();
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

describe("결재선 판이 0개면 — 조용히 넘어가지 않는다", () => {
  test("🔴 판이 하나도 없으면 ROUTE_NOT_CONFIGURED 이고 행이 하나도 생기지 않는다", async () => {
    const order = await createTestOrder();

    const requested = await requestDomesticOrderApproval({
      domesticOrderId: order.id,
      actorUserId: requesterId,
      requestReason: null,
      dueDateRowOrder: 1,
    });
    assert.equal(requested.ok, false);
    if (requested.ok) return;
    assert.equal(requested.code, "ROUTE_NOT_CONFIGURED");
    // 🔴 **화면이 누르기 전에 하는 말과 같은 한 줄**이다. 두 곳이 갈라지면 둘 다
    //    본 사람은 어느 쪽이 참인지 모른다.
    assert.equal(requested.message, DOMESTIC_ORDER_APPROVAL_ROUTE_MISSING_NOTICE);
    assert.match(requested.message, /승인 절차/);

    // 「요청할 수 없습니다」 — 용도의 빈 상태 문장 그대로다. 행도 남지 않는다.
    assert.equal((await approvalRows(order.id)).length, 0, "거절된 요청이 행을 남겼다");
    const progress = await getDomesticOrderApprovalProgress(order.id);
    assert.equal(progress?.state, "NOT_REQUESTED");
  });

  test("🔴 단계 0개인 판도 같다 — 「절차를 쓰지 않겠다」는 판 없음과 같은 뜻이다", async () => {
    const order = await createTestOrder();
    await saveDomesticRoute([]);
    // 재는 것이 비어 있지 않은지 — 판은 **실제로 있다**.
    assert.ok(await getCurrentShipmentApprovalRoute(DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE));

    const requested = await requestDomesticOrderApproval({
      domesticOrderId: order.id,
      actorUserId: requesterId,
      requestReason: null,
      dueDateRowOrder: 1,
    });
    assert.equal(requested.ok, false);
    if (requested.ok) return;
    assert.equal(requested.code, "ROUTE_NOT_CONFIGURED");
    assert.equal((await approvalRows(order.id)).length, 0);
  });
});

describe("요청 — 첫 단계 행 하나만 생기고 판 번호가 실린다", () => {
  test("🔴 요청 시점의 domestic_orders.version 이 실리고, 접수 건 칸은 비어 있다", async () => {
    const order = await createTestOrder();
    // 판 번호가 1 이 아닌 상태에서 재야 「기본값 1 이 조용히 실린다」를 가른다.
    const version = await bumpOrderVersion(order);
    assert.ok(version > 1, "판 번호를 올리지 못했다 — 이 시험이 아무것도 재지 못한다");
    await saveDomesticRoute([stepAId, stepBId]);

    const requested = await requestDomesticOrderApproval({
      domesticOrderId: order.id,
      actorUserId: requesterId,
      requestReason: "출하 승인 부탁드립니다",
      dueDateRowOrder: 1,
    });
    assert.equal(requested.ok, true, JSON.stringify(requested));

    const rows = await approvalRows(order.id);
    assert.equal(rows.length, 1, "첫 요청에 행이 하나보다 많다");
    const [row] = rows;
    assert.equal(row.approvalType, DOMESTIC_ORDER_APPROVAL_TYPE);
    assert.equal(row.status, "REQUESTED");
    assert.equal(row.requestedByUserId, requesterId);
    assert.equal(row.requestReason, "출하 승인 부탁드립니다");
    assert.equal(row.assignedApproverUserId, stepAId, "1단계 승인자가 지정되지 않았다");
    assert.equal(row.routeStepOrder, 1);
    assert.ok(row.routeId, "붙잡은 판이 비어 있다");
    assert.equal(row.repairCaseVersionAtRequest, version, "요청 시점의 판 번호가 실리지 않았다");
    // 🔴 접수 건 칸은 **언제나 비어 있다** — 이것이 접수 건 조회와 갈리는 유일한 축이다.
    assert.equal(row.repairCaseId, null);

    const progress = await getDomesticOrderApprovalProgress(order.id);
    assert.equal(progress?.state, "PENDING");
    assert.equal(progress?.currentVersion, version);
  });

  test("🔴 승인 뒤 줄을 고치면 그 승인은 무효가 된다(APPROVED → STALE)", async () => {
    const order = await createTestOrder();
    await saveDomesticRoute([stepAId]);
    const requested = await requestDomesticOrderApproval({
      domesticOrderId: order.id,
      actorUserId: requesterId,
      requestReason: null,
      dueDateRowOrder: 1,
    });
    assert.equal(requested.ok, true);
    const decided = await decideDomesticOrderApproval({
      domesticOrderId: order.id,
      decision: "APPROVED",
      actorUserId: stepAId,
      decisionReason: null,
      dueDateRowOrder: 1,
    });
    assert.equal(decided.ok, true, JSON.stringify(decided));
    assert.equal((await getDomesticOrderApprovalProgress(order.id))?.state, "APPROVED");

    await bumpOrderVersion(order);
    assert.equal(
      (await getDomesticOrderApprovalProgress(order.id))?.state,
      "STALE",
      "줄을 고쳤는데도 승인이 살아 있다고 답한다"
    );
  });

  test("🔴 살아 있는 요청은 하나뿐이다 — 두 번째 요청은 ALREADY_REQUESTED", async () => {
    const order = await createTestOrder();
    await saveDomesticRoute([stepAId, stepBId]);
    assert.equal(
      (
        await requestDomesticOrderApproval({
          domesticOrderId: order.id,
          actorUserId: requesterId,
          requestReason: null,
          dueDateRowOrder: 1,
        })
      ).ok,
      true
    );

    const second = await requestDomesticOrderApproval({
      domesticOrderId: order.id,
      actorUserId: requesterId,
      requestReason: null,
      dueDateRowOrder: 1,
    });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "ALREADY_REQUESTED");
    assert.equal(await pendingCount(order.id), 1);
  });

  test("휴지통에 든 줄에는 올릴 수 없다", async () => {
    const order = await createTestOrder();
    await saveDomesticRoute([stepAId]);
    const trashed = await softDeleteDomesticOrder({
      id: order.id,
      expectedVersion: order.version,
      actorUserId: superAdminId,
      reason: "시험",
    });
    assert.equal(trashed.ok, true, JSON.stringify(trashed));

    const requested = await requestDomesticOrderApproval({
      domesticOrderId: order.id,
      actorUserId: requesterId,
      requestReason: null,
      dueDateRowOrder: 1,
    });
    assert.equal(requested.ok, false);
    if (requested.ok) return;
    assert.equal(requested.code, "NOT_FOUND");
  });
});

describe("사슬 — 단계를 순서대로 밟는다", () => {
  test("🔴 1단계를 승인하면 2단계 행이 이어지고, 요청자·사유·판 번호를 물려받는다", async () => {
    const order = await createTestOrder();
    await saveDomesticRoute([stepAId, stepBId]);
    const requested = await requestDomesticOrderApproval({
      domesticOrderId: order.id,
      actorUserId: requesterId,
      requestReason: "첫 요청 사유",
      dueDateRowOrder: 1,
    });
    assert.equal(requested.ok, true);

    const first = await decideDomesticOrderApproval({
      domesticOrderId: order.id,
      decision: "APPROVED",
      actorUserId: stepAId,
      decisionReason: null,
      dueDateRowOrder: 1,
    });
    assert.equal(first.ok, true, JSON.stringify(first));
    if (!first.ok) return;
    assert.ok(first.nextApprovalId, "다음 단계 행이 열리지 않았다");

    const rows = await approvalRows(order.id);
    assert.equal(rows.length, 2);
    const [done, next] = rows;
    assert.equal(done.status, "APPROVED");
    assert.equal(done.decidedByUserId, stepAId);
    assert.equal(next.status, "REQUESTED");
    assert.equal(next.assignedApproverUserId, stepBId);
    assert.equal(next.routeStepOrder, 2);
    assert.equal(next.requestedByUserId, requesterId, "요청자가 바뀌었다");
    assert.equal(next.requestReason, "첫 요청 사유", "사유를 물려받지 않았다");
    assert.equal(next.repairCaseVersionAtRequest, done.repairCaseVersionAtRequest);
    assert.equal(next.routeId, done.routeId, "다음 행이 다른 판을 탔다");
    assert.equal(next.delegatedFromUserId, null, "아무도 누르지 않은 행에 위임이 적혔다");
    assert.equal(await pendingCount(order.id), 1, "한 번에 한 단계가 아니다");

    // 마지막 단계를 승인하면 사슬이 끝난다.
    const second = await decideDomesticOrderApproval({
      domesticOrderId: order.id,
      decision: "APPROVED",
      actorUserId: stepBId,
      decisionReason: null,
      dueDateRowOrder: 1,
    });
    assert.equal(second.ok, true, JSON.stringify(second));
    if (!second.ok) return;
    assert.equal(second.nextApprovalId, null, "마지막 단계인데 행이 더 열렸다");
    assert.equal((await getDomesticOrderApprovalProgress(order.id))?.state, "APPROVED");
    assert.equal((await approvalRows(order.id)).length, 2);
  });

  test("🔴 요청자 본인 단계는 건너뛴다 — 전부 본인이면 요청 자체가 거절된다", async () => {
    const order = await createTestOrder();
    await saveDomesticRoute([requesterId, stepAId]);
    const requested = await requestDomesticOrderApproval({
      domesticOrderId: order.id,
      actorUserId: requesterId,
      requestReason: null,
      dueDateRowOrder: 1,
    });
    assert.equal(requested.ok, true, JSON.stringify(requested));
    const [row] = await approvalRows(order.id);
    assert.equal(row.assignedApproverUserId, stepAId, "요청자 본인 단계를 건너뛰지 않았다");
    assert.equal(row.routeStepOrder, 2, "건너뛴 뒤의 실제 번호가 아니다");

    // 단계가 전부 요청자 본인이면 보낼 곳이 없다.
    const onlySelf = await createTestOrder();
    await saveDomesticRoute([requesterId]);
    const blocked = await requestDomesticOrderApproval({
      domesticOrderId: onlySelf.id,
      actorUserId: requesterId,
      requestReason: null,
      dueDateRowOrder: 1,
    });
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.equal(blocked.code, "ROUTE_HAS_NO_OTHER_APPROVER");
    assert.equal((await approvalRows(onlySelf.id)).length, 0);
  });

  test("반려는 사유가 필수이고, 사슬을 끊고, 다시 올릴 수 있다", async () => {
    const order = await createTestOrder();
    await saveDomesticRoute([stepAId, stepBId]);
    assert.equal(
      (
        await requestDomesticOrderApproval({
          domesticOrderId: order.id,
          actorUserId: requesterId,
          requestReason: null,
          dueDateRowOrder: 1,
        })
      ).ok,
      true
    );

    const noReason = await decideDomesticOrderApproval({
      domesticOrderId: order.id,
      decision: "REJECTED",
      actorUserId: stepAId,
      decisionReason: null,
      dueDateRowOrder: 1,
    });
    assert.equal(noReason.ok, false);
    if (!noReason.ok) assert.equal(noReason.code, "VALIDATION_ERROR");
    assert.equal(await pendingCount(order.id), 1, "거절된 반려가 행을 닫았다");

    const rejected = await decideDomesticOrderApproval({
      domesticOrderId: order.id,
      decision: "REJECTED",
      actorUserId: stepAId,
      decisionReason: "금액이 맞지 않습니다",
      dueDateRowOrder: 1,
    });
    assert.equal(rejected.ok, true, JSON.stringify(rejected));
    if (!rejected.ok) return;
    assert.equal(rejected.nextApprovalId, null, "반려인데 다음 단계가 열렸다");
    assert.equal((await getDomesticOrderApprovalProgress(order.id))?.state, "REJECTED");

    // 반려 뒤에는 새 요청을 올릴 수 있다 — 그때 1단계부터 다시 시작한다.
    const again = await requestDomesticOrderApproval({
      domesticOrderId: order.id,
      actorUserId: requesterId,
      requestReason: null,
      dueDateRowOrder: 1,
    });
    assert.equal(again.ok, true, JSON.stringify(again));
    const rows = await approvalRows(order.id);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].routeStepOrder, 1, "다시 올렸는데 1단계부터가 아니다");

    const history = await getDomesticOrderApprovalHistory(order.id);
    assert.equal(history.length, 2, "이력이 줄을 잃었다");
    assert.equal(history[0].status, "REQUESTED", "이력이 최신부터가 아니다");
  });
});

describe("인가 — 올리기와 결재는 서로 다른 열쇠를 본다", () => {
  test("🔴 내자를 고칠 수 없는 역할은 올리지 못한다", async () => {
    const order = await createTestOrder();
    await saveDomesticRoute([stepAId]);

    const blocked = await requestDomesticOrderApproval({
      domesticOrderId: order.id,
      actorUserId: noDomesticPermissionId,
      requestReason: null,
      dueDateRowOrder: 1,
    });
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.equal(blocked.code, "FORBIDDEN");
    assert.equal((await approvalRows(order.id)).length, 0);

    // 🔵 재는 것이 비어 있지 않은지 — 같은 줄에 **권한 있는 사람**은 올릴 수 있다.
    assert.equal(
      (
        await requestDomesticOrderApproval({
          domesticOrderId: order.id,
          actorUserId: requesterId,
          requestReason: null,
          dueDateRowOrder: 1,
        })
      ).ok,
      true
    );
  });

  test("🔴 지정된 사람이 아니면 결재할 수 없다 — 최고관리자 비상구는 열려 있다", async () => {
    const order = await createTestOrder();
    await saveDomesticRoute([stepAId, stepBId]);
    assert.equal(
      (
        await requestDomesticOrderApproval({
          domesticOrderId: order.id,
          actorUserId: requesterId,
          requestReason: null,
          dueDateRowOrder: 1,
        })
      ).ok,
      true
    );

    const byOutsider = await decideDomesticOrderApproval({
      domesticOrderId: order.id,
      decision: "APPROVED",
      actorUserId: outsiderId,
      decisionReason: null,
      dueDateRowOrder: 1,
    });
    assert.equal(byOutsider.ok, false);
    if (!byOutsider.ok) {
      assert.equal(byOutsider.code, "FORBIDDEN");
      // 「권한이 없습니다」로 끝내지 않는다 — 누구 차례인지 이름을 적는다.
      assert.match(byOutsider.message, /기타건결재시험 1단계/);
    }

    // 2단계 사람도 아직 자기 차례가 아니다.
    const tooEarly = await decideDomesticOrderApproval({
      domesticOrderId: order.id,
      decision: "APPROVED",
      actorUserId: stepBId,
      decisionReason: null,
      dueDateRowOrder: 1,
    });
    assert.equal(tooEarly.ok, false);

    // 최고관리자는 결재선에 없어도 누를 수 있다(auth/approval-assignment.ts 의 비상구).
    const byAdmin = await decideDomesticOrderApproval({
      domesticOrderId: order.id,
      decision: "APPROVED",
      actorUserId: superAdminId,
      decisionReason: null,
      dueDateRowOrder: 1,
    });
    assert.equal(byAdmin.ok, true, JSON.stringify(byAdmin));
    const [first] = await approvalRows(order.id);
    assert.equal(first.decidedByUserId, superAdminId);
    // 🔴 비상구는 **위임이 아니다** — 섞어 적으면 기록에서 둘을 구별할 수 없다.
    assert.equal(first.delegatedFromUserId, null);
  });

  test("이미 처리된 결재는 다시 처리되지 않는다", async () => {
    const order = await createTestOrder();
    await saveDomesticRoute([stepAId]);
    assert.equal(
      (
        await requestDomesticOrderApproval({
          domesticOrderId: order.id,
          actorUserId: requesterId,
          requestReason: null,
          dueDateRowOrder: 1,
        })
      ).ok,
      true
    );
    assert.equal(
      (
        await decideDomesticOrderApproval({
          domesticOrderId: order.id,
          decision: "APPROVED",
          actorUserId: stepAId,
          decisionReason: null,
          dueDateRowOrder: 1,
        })
      ).ok,
      true
    );

    const again = await decideDomesticOrderApproval({
      domesticOrderId: order.id,
      decision: "REJECTED",
      actorUserId: stepAId,
      decisionReason: "되돌리기",
      dueDateRowOrder: 1,
    });
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.code, "CONFLICT");
  });
});

describe("🔴 접수 건 승인이 한 톨도 바뀌지 않는다", () => {
  test("열려 있는 기타건 결재가 접수 건 결재 대기 목록에 들어가지 않는다", async () => {
    const order = await createTestOrder();
    await saveDomesticRoute([stepAId]);
    assert.equal(
      (
        await requestDomesticOrderApproval({
          domesticOrderId: order.id,
          actorUserId: requesterId,
          requestReason: null,
          dueDateRowOrder: 1,
        })
      ).ok,
      true
    );

    // 🔴 **표본이 비어 공짜로 통과하지 않게** — 먼저 「무엇을 재는지」를 단언한다.
    //    stepA 에게 **실제로 열려 있는 결재가 있다**는 것을 확인한 뒤에,
    //    그것이 접수 건 쪽 목록에는 들어가지 않는다고 말한다.
    const [row] = await approvalRows(order.id);
    assert.equal(row.status, "REQUESTED");
    assert.equal(row.assignedApproverUserId, stepAId);
    assert.equal((await getDomesticOrderApprovalProgress(order.id))?.state, "PENDING");

    const pendingForStepA = await listRepairCasesPendingMyApproval(stepAId);
    assert.deepEqual(pendingForStepA, [], "기타건 결재가 접수 건 결재 대기 목록에 섞였다");
    assert.equal(await countRepairCasesPendingMyApproval(stepAId), 0);
  });

  test("🔴 표의 CHECK 가 두 주체 칸을 갈라 둔다", async () => {
    const order = await createTestOrder();

    // ① 기타건 칸은 기타건 승인에만 — 접수 건 승인 종류에 붙이면 거절된다.
    //
    // 🔴 **어느 CHECK 에 걸렸는지는 `.cause` 에만 적혀 있다** — postgres-js 는 진짜
    //    오류를 거기 싸서 올리고 겉 오류의 message 에는 질의문만 들어 있다. 겉만 보면
    //    「무엇 때문이든 실패하기만 하면」 통과하는 시험이 된다.
    await assert.rejects(
      db.insert(repairCaseApprovals).values({
        domesticOrderId: order.id,
        approvalType: "FINAL_SHIPMENT",
        status: "REQUESTED",
        requestedByUserId: requesterId,
        repairCaseVersionAtRequest: 1,
      }),
      (err: unknown) => {
        const cause = err instanceof Error ? err.cause : undefined;
        const message = cause instanceof Error ? cause.message : String(cause ?? err);
        assert.match(
          message,
          /repair_case_approvals_domestic_order_only_for_domestic_type/,
          `다른 까닭으로 실패했다 — ${message}`
        );
        return true;
      }
    );

    // ② 🔴 **둘 다 NULL 은 정상이다**(XOR 가 아니다) — 접수 건을 영구 삭제하면 실제로
    //    그 모양이 된다. 여기서 막으면 그 삭제 경로가 그날부터 막힌다.
    const [orphan] = await db
      .insert(repairCaseApprovals)
      .values({
        approvalType: DOMESTIC_ORDER_APPROVAL_TYPE,
        // 🔴 2026-11-08 — 기타건 행에는 회차가 반드시 있다(표의 CHECK). 이 행은 줄이
        //    없는 고아라 회차도 뜻이 없지만, 값 없이는 들어가지 않는다.
        dueDateRowOrder: 1,
        status: "REQUESTED",
        requestedByUserId: requesterId,
        repairCaseVersionAtRequest: 1,
      })
      .returning({ id: repairCaseApprovals.id });
    assert.ok(orphan.id, "둘 다 비어 있는 행이 거절됐다 — XOR 로 적혔다");
    await db.delete(repairCaseApprovals).where(eq(repairCaseApprovals.id, orphan.id));
  });

  test("🔴 제약·색인이 실제로 DB 에 서 있다 — 그리고 CHECK 은 ::text 로 쓰였다", async () => {
    const checks = await db.execute<{ conname: string; def: string }>(sql`
      select conname, pg_get_constraintdef(oid) as def
      from pg_constraint
      where conrelid = 'repair_case_approvals'::regclass and contype = 'c'
      order by conname
    `);
    const byName = new Map(checks.map((row) => [row.conname, row.def]));
    for (const name of [
      "repair_case_approvals_decision_metadata",
      "repair_case_approvals_delegation_only_for_final_shipment",
      "repair_case_approvals_domestic_order_only_for_domestic_type",
      "repair_case_approvals_domestic_type_has_no_repair_case",
      "repair_case_approvals_route_columns_together",
      "repair_case_approvals_route_only_for_final_shipment",
    ]) {
      assert.ok(byName.has(name), `CHECK 이 없다: ${name}`);
    }

    /**
     * 🔴 **갓 더한 enum 값을 리터럴로 쓰면 마이그레이션이 적용되지 않는다.**
     * drizzle 의 migrate 는 밀린 마이그레이션 전부를 **트랜잭션 하나**에 넣는데,
     * 그 안에서 `ALTER TYPE … ADD VALUE` 로 더한 값을 enum 리터럴로 쓰면 Postgres 가
     * 거절한다(`unsafe use of new value`). 2026-11-06 에 실제로 그 오류로 멈췄고,
     * **운영에서도 똑같이 멈췄을 자리**다(배포는 같은 명령을 쓴다).
     * 그래서 네 CHECK 이 전부 `(approval_type)::text` 로 견준다 — 하나라도 리터럴로
     * 되돌아가면 그 사고가 되돌아온다.
     */
    for (const name of [
      "repair_case_approvals_delegation_only_for_final_shipment",
      "repair_case_approvals_domestic_order_only_for_domestic_type",
      "repair_case_approvals_domestic_type_has_no_repair_case",
      "repair_case_approvals_route_only_for_final_shipment",
    ]) {
      const def = byName.get(name) ?? "";
      assert.match(def, /\(approval_type\)::text/, `${name}: enum 리터럴로 되돌아갔다 — ${def}`);
      assert.ok(
        !/approval_type = '[A-Z_]+'::repair_case_approval_type/.test(def),
        `${name}: enum 리터럴이 남아 있다 — ${def}`
      );
    }

    const indexes = await db.execute<{ indexname: string }>(sql`
      select indexname from pg_indexes where tablename = 'repair_case_approvals'
    `);
    const names = indexes.map((row) => row.indexname);
    // 🔴 접수 건 쪽 색인은 **그대로 있다** — 기타건 색인이 그것을 대신한 것이 아니다.
    assert.ok(names.includes("repair_case_approvals_one_active_request"));
    assert.ok(names.includes("repair_case_approvals_one_active_domestic_request"));
    assert.ok(names.includes("repair_case_approvals_domestic_order_id_idx"));
  });
});
