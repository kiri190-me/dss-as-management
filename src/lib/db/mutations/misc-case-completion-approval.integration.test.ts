import "../../../../scripts/load-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asc, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  auditLogs,
  domesticOrders,
  repairCaseApprovals,
  repairCases,
  shipmentApprovalRouteSteps,
  shipmentApprovalRoutes,
  users,
} from "../schema";
import {
  createDomesticOrder,
  setDomesticOrderCompletion,
  updateDomesticOrder,
} from "./domestic-orders";
import {
  decideDomesticOrderApproval,
  requestDomesticOrderApproval,
} from "./domestic-order-approvals";
import { saveShipmentApprovalRoute } from "./shipment-approval-routes";
import { getCurrentShipmentApprovalRoute } from "../queries/shipment-approval-routes";
import {
  DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE,
  MISC_CASE_COMPLETION_BLOCKED_MESSAGES,
} from "@/lib/domain/domestic-order-approval-rules";
import { completeDomesticOrderWithShipment } from "@/lib/server/services/complete-domestic-order";
import type { DomesticOrderFields } from "@/lib/validation/domestic-order-input";

/**
 * ============================================================================
 * 🔴 기타건은 **승인이 끝나야 [완료]** 가 된다 — 진짜 DB 로 (2026-11-07)
 * ============================================================================
 * 사용자 결정: 「기타건의 경우도 [기타건 최종 출하 승인]이 되야 [내자정리]에서
 * [완료]처리를 할 수 있도록」.
 *
 * ── 여기서 재는 것 ──────────────────────────────────────────────────────
 *  ㉠ 승인이 없으면 **서버가** 막는다 — 그리고 그때 줄은 **한 글자도 안 바뀐다**
 *     (completed_at 도 version 도). 「막혔다」만 보고 지나가면 반쪽만 저장되는
 *     사고를 못 잡는다.
 *  ㉡ 승인을 받으면 완료된다 — 🔴 **되는 경우를 같은 자리에서** 잰다. 없으면
 *     「전부 막는 함수」도 이 시험을 통과한다.
 *  ㉢ **수리 건이 붙은 줄은 안 막힌다** — 그쪽 관문은 전이 쪽에 따로 있고
 *     (services/complete-domestic-order.ts), 기타건 갈래의 결재선을 거기에
 *     요구하면 안 된다.
 *  ㉣ **결재선 판이 0개일 때 말을 한다** — 그때는 승인을 올릴 수조차 없으므로
 *     「절차를 만들라」가 아니면 사람이 길을 못 찾는다.
 *  ㉤ **이미 완료된 줄은 깨지지 않는다** — 운영에 승인 없이 완료된 기타건이 있다
 *     (2026-11-07 개발 DB 실측 1건).
 *  ㉥ **완료 해제는 막지 않는다** — 막으면 그 옛 줄들을 되돌릴 길이 사라진다.
 *  ㉦ **완료를 누르는 모든 자리가 막힌다** — 화면과 PO 통로가 거쳐 가는 서비스로도
 *     한 번 더 눌러 본다. 울타리가 mutation 한 곳이라는 것이 그 둘의 전제다.
 *
 * ── 왜 결재 행을 직접 박지 않는가 ───────────────────────────────────────
 * 승인은 **진짜 경로**로 받는다(요청 → 결재). 상태 넷(PENDING·APPROVED·REJECTED·
 * STALE)이 전부 그 경로가 남기는 행 모양에서 나오므로, 손으로 박은 행으로 재면
 * 「저장 경로가 만들지 않는 모양」을 시험하게 된다. 🔵 이웃 시험들이 결재 행을 직접
 * 넣는 것은 그쪽이 재는 것이 승인 절차가 아니기 때문이다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 스위트만 쓰는 계정 접두사 "misccompletion-test-", 발주서번호 접두사
 * "MCC-TEST-{RUN}-". 🔵 **접수 건을 하나도 만들지 않는다** — 인수번호가 한 달에
 * 99개뿐이라(intake_sequences) 시험이 접수를 늘리면 한참 뒤 남의 시험이 까닭 없이
 * 깨진다. ㉢ 의 표본은 시험 DB 에 있는 수리 건을 **빌려** 만든다.
 *
 * ⚠️ **판·단계는 afterEach 로 반드시 걷는다** — 시험 DB 에 판이 남으면 다른 시험
 * 파일이 갑자기 결재선을 타면서 깨진다. 사람 참조가 RESTRICT 라 삭제에 순서가 있다:
 * 결재 행 → 내자 줄 → 단계 → 판 → 감사 기록 → 사람.
 * ============================================================================
 */

const RUN = randomUUID().slice(0, 8);
const TEST_EMAIL_PREFIX = "misccompletion-test-";
const TEST_PO_PREFIX = `MCC-TEST-${RUN}-`;

/** 내자 줄을 고칠 수 있는 역할(domesticOrders WRITE 기본값)이다 — 요청을 올린다. */
let requesterId: string;
/** 결재선 1단계에 서는 사람. 🔴 요청자와 **달라야** 한다(제 단계는 건너뛴다). */
let approverId: string;
/** 판을 저장하는 사람. */
let superAdminId: string;
/** ㉢ 의 표본 — 빌려 온 수리 건. */
let borrowedRepairCaseId: string;

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

function orderFields(overrides: Partial<DomesticOrderFields> = {}): DomesticOrderFields {
  return {
    repairCaseId: null,
    intakeNumberText: null,
    customerId: null,
    modelNameText: "완료관문시험 형식",
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

async function createTestOrder(overrides: Partial<DomesticOrderFields> = {}): Promise<TestOrder> {
  const fields = orderFields(overrides);
  const created = await createDomesticOrder({ fields, actorUserId: requesterId });
  assert.equal(created.ok, true, `setup order create failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  createdOrderIds.push(created.id);
  return { id: created.id, version: created.version, fields };
}

/** 그 줄을 한 번 고쳐 판 번호를 올린다 — 「승인 뒤에 내용이 바뀌었다」를 만드는 길. */
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

async function saveDomesticRoute(approverUserIds: string[]): Promise<void> {
  const result = await saveShipmentApprovalRoute(
    approverUserIds,
    superAdminId,
    DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE
  );
  assert.equal(result.ok, true, `setup route save failed: ${JSON.stringify(result)}`);
}

/** 요청을 올린다 — 1단계 결재 행 하나가 생긴다(상태 PENDING). */
async function request(order: TestOrder): Promise<void> {
  const requested = await requestDomesticOrderApproval({
    domesticOrderId: order.id,
    actorUserId: requesterId,
    requestReason: null,
    dueDateRowOrder: 1,
  });
  assert.equal(requested.ok, true, `setup approval request failed: ${JSON.stringify(requested)}`);
}

/** 1단계를 결재한다 — 단계가 하나뿐이라 여기서 사슬이 끝난다. */
async function decide(order: TestOrder, decision: "APPROVED" | "REJECTED"): Promise<void> {
  const decided = await decideDomesticOrderApproval({
    domesticOrderId: order.id,
    decision,
    actorUserId: approverId,
    decisionReason: decision === "REJECTED" ? "시험용 반려" : null,
    dueDateRowOrder: 1,
  });
  assert.equal(decided.ok, true, `setup approval decision failed: ${JSON.stringify(decided)}`);
}

/** 판을 세우고 요청을 올려 **승인까지** 받는다 — ㉡ 의 출발점. */
async function arrangeApprovedOrder(): Promise<TestOrder> {
  await saveDomesticRoute([approverId]);
  const order = await createTestOrder();
  await request(order);
  await decide(order, "APPROVED");
  return order;
}

async function readOrder(id: string) {
  const [row] = await db.select().from(domesticOrders).where(eq(domesticOrders.id, id));
  assert.ok(row, `expected domestic_orders row ${id} to exist`);
  return row;
}

/** 그 줄의 결재 행들 — 오래된 것부터. 🔵 「표본이 비어 있지 않은가」를 재는 자리다. */
async function approvalRows(domesticOrderId: string) {
  return db
    .select({ status: repairCaseApprovals.status })
    .from(repairCaseApprovals)
    .where(eq(repairCaseApprovals.domesticOrderId, domesticOrderId))
    .orderBy(asc(repairCaseApprovals.requestedAt));
}

async function removeFixtures(): Promise<void> {
  if (createdTestUserIds.length > 0) {
    // 결재 행이 먼저다 — 판을 RESTRICT 로 참조한다. 내자 줄이 지워지면
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

  requesterId = await createTestUser("완료관문시험 요청자");
  approverId = await createTestUser("완료관문시험 결재자");
  superAdminId = await createTestUser("완료관문시험 최고관리자", { role: "SUPER_ADMIN" });

  // 🔴 접수 건을 **만들지 않고 빌린다**(파일 머리말). 없으면 ㉢ 을 잴 표본이 없다.
  const [borrowed] = await db
    .select({ id: repairCases.id })
    .from(repairCases)
    .where(eq(repairCases.isDeleted, false))
    .limit(1);
  assert.ok(borrowed, "시험 DB 에 수리 건이 하나도 없다 — 「안 막힌다」를 잴 표본이 없다");
  borrowedRepairCaseId = borrowed.id;
});

afterEach(async () => {
  await removeFixtures();
});

after(async () => {
  await removeFixtures();
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

describe("㉠ 승인이 없으면 완료되지 않는다 — 그리고 줄은 한 글자도 안 바뀐다", () => {
  test("🔴 결재 행이 하나도 없는 기타건은 APPROVAL_REQUIRED 다", async () => {
    await saveDomesticRoute([approverId]);
    const order = await createTestOrder();
    // 🔵 못 — 재려는 표본이 정말 「승인이 없는 기타건」인가.
    assert.equal((await approvalRows(order.id)).length, 0, "표본에 결재 행이 이미 있다");
    assert.equal((await readOrder(order.id)).repairCaseId, null, "표본이 기타건이 아니다");

    const result = await setDomesticOrderCompletion({
      id: order.id,
      expectedVersion: order.version,
      completed: true,
      actorUserId: requesterId,
    });

    assert.equal(result.ok, false, "승인 없이 완료되었다");
    if (result.ok) return;
    assert.equal(result.code, "APPROVAL_REQUIRED");
    // 판은 있고 요청만 안 올렸다 — 「승인을 올려라」라고 말해야 한다.
    assert.equal(result.message, MISC_CASE_COMPLETION_BLOCKED_MESSAGES.NOT_REQUESTED);

    // 🔴 거절된 저장은 **아무것도 바꾸지 않는다.**
    const row = await readOrder(order.id);
    assert.equal(row.completedAt, null, "막혔는데 완료 시각이 찍혔다");
    assert.equal(row.completedBy, null);
    assert.equal(row.version, order.version, "막힌 저장이 version 을 올렸다");
  });

  test("🔴 올리기만 하고 결재되지 않은 건(PENDING)도 막힌다", async () => {
    await saveDomesticRoute([approverId]);
    const order = await createTestOrder();
    await request(order);
    const rows = await approvalRows(order.id);
    assert.deepEqual(
      rows.map((row) => row.status),
      ["REQUESTED"],
      "표본이 「처리 대기 중」이 아니다"
    );

    const result = await setDomesticOrderCompletion({
      id: order.id,
      expectedVersion: order.version,
      completed: true,
      actorUserId: requesterId,
    });

    assert.equal(result.ok, false, "결재되지 않았는데 완료되었다 — 요청만 하면 되는 절차가 된다");
    if (result.ok) return;
    assert.equal(result.message, MISC_CASE_COMPLETION_BLOCKED_MESSAGES.PENDING);
    assert.equal((await readOrder(order.id)).completedAt, null);
  });

  test("🔴 반려된 건(REJECTED)도 막힌다", async () => {
    await saveDomesticRoute([approverId]);
    const order = await createTestOrder();
    await request(order);
    await decide(order, "REJECTED");

    const result = await setDomesticOrderCompletion({
      id: order.id,
      expectedVersion: order.version,
      completed: true,
      actorUserId: requesterId,
    });

    assert.equal(result.ok, false, "반려된 건이 완료되었다");
    if (result.ok) return;
    assert.equal(result.message, MISC_CASE_COMPLETION_BLOCKED_MESSAGES.REJECTED);
  });

  test("🔴 승인 뒤에 줄이 바뀌면(STALE) 다시 막힌다 — 옛 승인으로 완료할 수 없다", async () => {
    const order = await arrangeApprovedOrder();
    // 금액·입금 같은 값을 고치는 자리다. 승인한 사람이 본 내용과 달라졌다.
    const bumped = await bumpOrderVersion(order);

    const result = await setDomesticOrderCompletion({
      id: order.id,
      expectedVersion: bumped,
      completed: true,
      actorUserId: requesterId,
    });

    assert.equal(result.ok, false, "내용이 바뀌었는데 옛 승인으로 완료되었다");
    if (result.ok) return;
    assert.equal(result.message, MISC_CASE_COMPLETION_BLOCKED_MESSAGES.STALE);
    assert.equal((await readOrder(order.id)).completedAt, null);
  });
});

describe("㉡ 승인을 받으면 완료된다 — 「되는 경우」가 같은 자리에 있어야 한다", () => {
  test("🔴 승인 완료된 기타건은 완료 처리된다", async () => {
    const order = await arrangeApprovedOrder();
    assert.deepEqual(
      (await approvalRows(order.id)).map((row) => row.status),
      ["APPROVED"],
      "표본이 승인 완료가 아니다"
    );

    const result = await setDomesticOrderCompletion({
      id: order.id,
      expectedVersion: order.version,
      completed: true,
      actorUserId: requesterId,
    });

    assert.equal(result.ok, true, `승인받은 줄이 막혔다: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.version, order.version + 1);

    const row = await readOrder(order.id);
    assert.ok(row.completedAt instanceof Date, "완료 시각이 남아야 한다");
    assert.equal(row.completedBy, requesterId);
  });

  test("🔴 승인은 **그 줄의 것**이어야 한다 — 옆 줄의 승인으로는 완료되지 않는다", async () => {
    const approved = await arrangeApprovedOrder();
    const other = await createTestOrder();
    assert.equal((await approvalRows(other.id)).length, 0);
    // 같은 판·같은 결재자인데 **다른 줄**이다. 관문이 줄을 안 보고 「승인이 어딘가
    // 있으면 통과」라면 여기서 뚫린다.
    assert.notEqual(approved.id, other.id);

    const result = await setDomesticOrderCompletion({
      id: other.id,
      expectedVersion: other.version,
      completed: true,
      actorUserId: requesterId,
    });

    assert.equal(result.ok, false, "옆 줄의 승인으로 완료되었다");
  });
});

describe("㉢ 수리 건이 붙은 줄은 이 관문을 지나지 않는다", () => {
  test("🔴 승인이 하나도 없어도 완료된다 — 그쪽 관문은 전이 쪽에 따로 있다", async () => {
    await saveDomesticRoute([approverId]);
    const order = await createTestOrder({ repairCaseId: borrowedRepairCaseId });
    // 🔵 못 — 표본이 정말 「수리 건이 붙었고 승인은 없는」 줄인가. 둘 다 아니면
    //    이 시험은 ㉠ 을 다시 재는 것이 되거나 공짜로 통과한다.
    assert.equal((await readOrder(order.id)).repairCaseId, borrowedRepairCaseId);
    assert.equal((await approvalRows(order.id)).length, 0);

    const result = await setDomesticOrderCompletion({
      id: order.id,
      expectedVersion: order.version,
      completed: true,
      actorUserId: requesterId,
    });

    assert.equal(result.ok, true, `수리 건이 붙은 줄이 기타건 관문에 막혔다: ${JSON.stringify(result)}`);
    assert.ok((await readOrder(order.id)).completedAt, "완료 시각이 남아야 한다");
  });
});

describe("㉣ 결재선 판이 0개면 — 아무도 완료할 수 없다, 그래서 길을 알려 준다", () => {
  test("🔴 판이 하나도 없으면 「절차를 먼저 만들라」고 말한다", async () => {
    // 🔵 못 — 판이 정말 없는가. 있으면 아래 단언은 다른 갈래를 재게 된다.
    assert.equal(await getCurrentShipmentApprovalRoute(DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE), null);
    const order = await createTestOrder();

    const result = await setDomesticOrderCompletion({
      id: order.id,
      expectedVersion: order.version,
      completed: true,
      actorUserId: requesterId,
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.message, MISC_CASE_COMPLETION_BLOCKED_MESSAGES.ROUTE_MISSING);
    assert.match(result.message, /사용자 관리/, "어디서 만드는지가 없으면 길을 못 찾는다");
  });

  test("🔴 단계 0개인 판도 같다 — 「절차를 쓰지 않겠다」는 판 없음과 같은 뜻이다", async () => {
    await saveDomesticRoute([]);
    // 재는 것이 비어 있지 않은지 — 판은 **실제로 있다**.
    assert.ok(await getCurrentShipmentApprovalRoute(DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE));
    const order = await createTestOrder();

    const result = await setDomesticOrderCompletion({
      id: order.id,
      expectedVersion: order.version,
      completed: true,
      actorUserId: requesterId,
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.message, MISC_CASE_COMPLETION_BLOCKED_MESSAGES.ROUTE_MISSING);
  });
});

describe("㉤㉥ 이미 완료된 줄은 깨지지 않고, 해제는 막지 않는다", () => {
  /**
   * 🔴 **승인 없이 완료된 줄**을 만든다 — 관문이 서기 전에 완료된 운영의 줄이 그
   * 모양이다(2026-11-07 개발 DB 실측 1건). 저장 경로를 거치지 않고 칸만 찍는다:
   * 거쳐서는 이제 만들 수 없는 상태이고, 그 상태를 **만들 수 없다는 것** 자체가
   * 이 시험이 지키려는 것(옛 줄이 깨지지 않는다)을 잴 수 없게 만든다.
   */
  async function arrangeLegacyCompletedOrder(): Promise<TestOrder> {
    const order = await createTestOrder();
    await db
      .update(domesticOrders)
      .set({ completedAt: new Date(), completedBy: requesterId })
      .where(eq(domesticOrders.id, order.id));
    const row = await readOrder(order.id);
    assert.ok(row.completedAt, "표본이 완료 상태가 아니다");
    assert.equal(row.version, order.version, "칸만 찍었으므로 version 은 그대로여야 한다");
    assert.equal((await approvalRows(order.id)).length, 0, "표본에 승인이 있으면 못이 헐겁다");
    return order;
  }

  test("🔴 승인 없이 완료된 줄에 같은 요청이 또 와도 오류가 아니다", async () => {
    await saveDomesticRoute([approverId]);
    const order = await arrangeLegacyCompletedOrder();

    const result = await setDomesticOrderCompletion({
      id: order.id,
      expectedVersion: order.version,
      completed: true,
      actorUserId: requesterId,
    });

    assert.equal(result.ok, true, `이미 완료된 옛 줄이 오류가 되었다: ${JSON.stringify(result)}`);
    assert.ok((await readOrder(order.id)).completedAt, "완료 표시가 사라졌다");
  });

  test("🔴 승인 없이 완료된 줄도 [완료 해제]는 된다 — 막으면 되돌릴 길이 없다", async () => {
    await saveDomesticRoute([approverId]);
    const order = await arrangeLegacyCompletedOrder();

    const result = await setDomesticOrderCompletion({
      id: order.id,
      expectedVersion: order.version,
      completed: false,
      actorUserId: requesterId,
    });

    assert.equal(result.ok, true, `완료 해제가 막혔다: ${JSON.stringify(result)}`);
    const row = await readOrder(order.id);
    assert.equal(row.completedAt, null, "완료 표시가 풀려야 한다");
    assert.equal(row.completedBy, null);
  });

  test("🔴 승인받아 완료한 줄의 해제도 된다 — 해제에는 관문이 서지 않는다", async () => {
    const order = await arrangeApprovedOrder();
    const completed = await setDomesticOrderCompletion({
      id: order.id,
      expectedVersion: order.version,
      completed: true,
      actorUserId: requesterId,
    });
    assert.equal(completed.ok, true);
    if (!completed.ok) return;

    const released = await setDomesticOrderCompletion({
      id: order.id,
      expectedVersion: completed.version,
      completed: false,
      actorUserId: requesterId,
    });

    assert.equal(released.ok, true, `완료 해제가 막혔다: ${JSON.stringify(released)}`);
    assert.equal((await readOrder(order.id)).completedAt, null);
  });
});

describe("㉦ 화면과 PO 통로가 거쳐 가는 서비스로도 같은 답이 온다", () => {
  /**
   * 🔴 서버 액션(화면)과 `/api/v1/.../completion`(PO)은 둘 다 이 서비스를 부르고,
   * 서비스는 마지막 한 걸음으로 위 mutation 을 부른다. 그래서 **여기서 막히면 그 둘이
   * 함께 막힌 것**이다 — 울타리가 한 곳이라는 설계가 이 시험의 근거다.
   */
  test("🔴 승인이 없으면 서비스도 거절하고 줄은 그대로다", async () => {
    await saveDomesticRoute([approverId]);
    const order = await createTestOrder();

    const result = await completeDomesticOrderWithShipment({
      id: order.id,
      expectedVersion: order.version,
      actorUserId: requesterId,
    });

    assert.equal(result.ok, false, "서비스를 거쳐서는 승인 없이 완료되었다");
    if (result.ok) return;
    assert.equal(result.code, "APPROVAL_REQUIRED");
    assert.equal(result.message, MISC_CASE_COMPLETION_BLOCKED_MESSAGES.NOT_REQUESTED);

    const row = await readOrder(order.id);
    assert.equal(row.completedAt, null);
    assert.equal(row.version, order.version);
  });

  test("🔴 승인을 받으면 서비스로도 완료된다", async () => {
    const order = await arrangeApprovedOrder();

    const result = await completeDomesticOrderWithShipment({
      id: order.id,
      expectedVersion: order.version,
      actorUserId: requesterId,
    });

    assert.equal(result.ok, true, `승인받은 줄이 서비스에서 막혔다: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    // 붙은 수리 건이 없으므로 수리 건 쪽은 움직이지 않는다.
    assert.equal(result.repairCaseShipmentCompleted, false);
    assert.ok((await readOrder(order.id)).completedAt);
  });
});
