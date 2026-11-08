import "../../../../scripts/load-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asc, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  auditLogs,
  domesticOrderDueDates,
  domesticOrders,
  repairCaseApprovals,
  repairCases,
  shipmentApprovalRouteSteps,
  shipmentApprovalRoutes,
  users,
} from "../schema";
import { toKstDateOnly } from "@/lib/domain/date-only";
import {
  createDomesticOrder,
  setDomesticOrderCompletion,
  setDomesticOrderDueDateRowCompletion,
  updateDomesticOrder,
} from "./domestic-orders";
import {
  decideDomesticOrderApproval,
  requestDomesticOrderApproval,
} from "./domestic-order-approvals";
import { saveShipmentApprovalRoute } from "./shipment-approval-routes";
import { getCurrentShipmentApprovalRoute } from "../queries/shipment-approval-routes";
import { getDomesticOrderApprovalUnits } from "../queries/domestic-order-approvals";
import {
  DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE,
  MISC_CASE_COMPLETION_BLOCKED_MESSAGES,
} from "@/lib/domain/domestic-order-approval-rules";
import { domesticOrderDueDateRowLabel } from "@/lib/domain/domestic-order-due-date-label";
import {
  COMPLETED_DUE_DATE_ROW_MESSAGE,
  DUE_DATE_ROW_HAS_DELIVERY_MESSAGE,
} from "@/lib/domain/domestic-order-due-date-rows";
import type { DomesticOrderFields } from "@/lib/validation/domestic-order-input";

/**
 * ============================================================================
 * 🔴 승인도 완료도 **납기요청일 회차마다** — 진짜 DB 로 (2026-11-08)
 * ============================================================================
 * 사용자 결정 12: 「납기 요청일이 … 복수로 있다면 출하승인요청을 할 때, 드롭다운으로
 * **어느 납기 요청일에 관한 출하승인 요청인지 선택**하도록」.
 * 사용자 결정 13: 「납기 요청일에 대한 최종출하승인이 완료되지 않으면 납기 요청일에
 * 대한 [완료 처리]가 안 되도록」.
 * 사용자 결정 7·8: 「납품일이 여러개라면 **각각에 [완료처리]버튼**」 · 「**마지막
 * 분할분이 찍히면 자동으로**」 줄이 완료된다.
 *
 * ── 여기서 재는 것 ──────────────────────────────────────────────────────
 *  ㉠ 🔴 **1차가 열려 있어도 2차 요청이 된다** — 2026-11-08 이전에는 DB 의 부분
 *     유니크가 그것을 거절했다(ALREADY_REQUESTED). 그 색인에 칸을 하나 더한 것이
 *     마이그레이션 0126 이고, 이 시험이 그 변화의 **뒤집힌 쪽**이다.
 *     🔵 같은 회차를 두 번 올리는 것은 **여전히 거절된다** — 보증이 약해지지 않았다.
 *  ㉡ 🔴 **그 줄에 없는 회차 번호는 거절된다** — 막지 않으면 아무도 열 수 없는
 *     승인이 생긴다(관문이 보지 않는 회차에 붙는다).
 *  ㉢ 🔴 **그 회차의 승인이 끝나야 그 회차가 완료된다** — 그리고 막혔을 때
 *     **어느 회차인지 이름이 글에 들어간다.**
 *  ㉣ 🔴 **마지막 회차가 찍히면 줄이 자동 완료된다**(결정 8). 그 거울로, 회차 하나를
 *     풀면 줄의 완료도 함께 풀린다.
 *  ㉤ 🔴 **회차 완료는 `version` 을 올리지 않는다** — 올리면 남은 회차의 승인이 전부
 *     STALE 이 되어 이 기능이 스스로를 먹는다. 이 시험이 그 자리를 지킨다.
 *  ㉥ 🔴 **수리 건이 붙은 줄은 회차별 완료를 쓰지 않는다** — 그쪽에 열면 수리 건을
 *     건드리지 않고 내자 줄만 완료되는 뒷문이 생긴다.
 *  ㉦ 🔴 **줄 전체를 끝내는 길은 회차 전부의 승인을 본다** — 하나라도 아직이면 거절.
 *  ㉧ 🔴 **완료 표시는 줄을 저장해도 살아남는다**(replaceDueDates 의 되얹기). 그리고
 *     완료된 회차가 있으면 **줄 수를 줄이는 저장이 거절된다**(셋째 울타리).
 *  ㉨ 🔴 **[완료 처리]가 그 회차의 납품일에 오늘을 찍는다**(2026-11-08 사용자 요구 —
 *     「1차완료 2차 완료를 누를 때 그 날짜로 납품일이 찍히도록」). 그 회차에만 찍고 ·
 *     이미 적힌 날짜는 안 덮고 · [완료 해제]로 지우지 않고 · `version` 은 그대로다.
 *
 * ── 왜 결재 행을 직접 박지 않는가 ───────────────────────────────────────
 * 승인은 **진짜 경로**로 받는다(요청 → 결재). 회차가 어느 행에 붙는지가 바로 이
 * 조각이 만든 것이라, 손으로 박으면 저장 경로가 실제로 그 칸을 채우는지 재지 못한다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 스위트만 쓰는 계정 접두사 "miscrow-test-", 발주서번호 접두사 "MCR-TEST-{RUN}-".
 * 🔵 **접수 건을 하나도 만들지 않는다** — 인수번호가 한 달에 99개뿐이라, 시험이
 * 접수를 늘리면 한참 뒤 남의 시험이 까닭 없이 깨진다. ㉥ 의 표본은 시험 DB 에 있는
 * 수리 건을 **빌려** 만든다.
 *
 * ⚠️ **판·단계는 afterEach 로 반드시 걷는다** — 시험 DB 에 판이 남으면 다른 시험
 * 파일이 갑자기 결재선을 타면서 깨진다. 사람 참조가 RESTRICT 라 삭제에 순서가 있다:
 * 결재 행 → 내자 줄 → 단계 → 판 → 감사 기록 → 사람.
 * ============================================================================
 */

const RUN = randomUUID().slice(0, 8);
const TEST_EMAIL_PREFIX = "miscrow-test-";
const TEST_PO_PREFIX = `MCR-TEST-${RUN}-`;

/** 내자 줄을 고칠 수 있는 역할(domesticOrders WRITE 기본값)이다 — 요청을 올린다. */
let requesterId: string;
/** 결재선 1단계에 서는 사람. 🔴 요청자와 **달라야** 한다(제 단계는 건너뛴다). */
let approverId: string;
/** 판을 저장하는 사람. */
let superAdminId: string;
/** ㉥ 의 표본 — 빌려 온 수리 건. */
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

/** 납기요청일 한 줄 — 🔴 **납품 둘은 비워 둔다**(완료와 납품은 다른 사실이다). */
function dueDate(date: string, note: string | null) {
  return { dueDate: date, note, deliveredDate: null, deliveredBy: null };
}

function orderFields(overrides: Partial<DomesticOrderFields> = {}): DomesticOrderFields {
  return {
    repairCaseId: null,
    intakeNumberText: null,
    customerId: null,
    modelNameText: "회차승인시험 형식",
    lotNumberText: null,
    serialNumberText: null,
    faultDescriptionText: null,
    displayOrder: null,
    purchaseOrderNumber: `${TEST_PO_PREFIX}${randomUUID().slice(0, 8)}`,
    projectName: null,
    orderIssuedDate: null,
    // 🔴 **회차 둘짜리 기타건**이 이 파일의 기본 표본이다 — 분할 납품이 실제로
    //    들어오는 모양이고(1차분·2차분), 이 조각이 푸는 문제가 거기서만 보인다.
    dueDates: [dueDate("2096-01-20", "1차분"), dueDate("2096-02-15", "2차분")],
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

async function saveDomesticRoute(approverUserIds: string[]): Promise<void> {
  const result = await saveShipmentApprovalRoute(
    approverUserIds,
    superAdminId,
    DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE
  );
  assert.equal(result.ok, true, `setup route save failed: ${JSON.stringify(result)}`);
}

/** 그 회차의 요청을 올린다 — 1단계 결재 행 하나가 생긴다(상태 PENDING). */
async function request(order: TestOrder, rowOrder: number) {
  return requestDomesticOrderApproval({
    domesticOrderId: order.id,
    actorUserId: requesterId,
    requestReason: null,
    dueDateRowOrder: rowOrder,
  });
}

/** 그 회차의 1단계를 결재한다 — 단계가 하나뿐이라 여기서 사슬이 끝난다. */
async function decide(order: TestOrder, rowOrder: number, decision: "APPROVED" | "REJECTED") {
  return decideDomesticOrderApproval({
    domesticOrderId: order.id,
    decision,
    actorUserId: approverId,
    decisionReason: decision === "REJECTED" ? "시험용 반려" : null,
    dueDateRowOrder: rowOrder,
  });
}

/** 그 회차의 승인을 **진짜 경로로** 끝까지 받는다. */
async function approveRow(order: TestOrder, rowOrder: number): Promise<void> {
  const requested = await request(order, rowOrder);
  assert.equal(requested.ok, true, `setup request failed: ${JSON.stringify(requested)}`);
  const decided = await decide(order, rowOrder, "APPROVED");
  assert.equal(decided.ok, true, `setup decision failed: ${JSON.stringify(decided)}`);
}

async function readOrder(id: string) {
  const [row] = await db.select().from(domesticOrders).where(eq(domesticOrders.id, id));
  assert.ok(row, `expected domestic_orders row ${id} to exist`);
  return row;
}

/** 그 줄의 납기요청일 행들 — **차례대로**(화면이 읽는 그 차례). */
async function readRows(orderId: string) {
  return db
    .select({
      dueDate: domesticOrderDueDates.dueDate,
      note: domesticOrderDueDates.note,
      displayOrder: domesticOrderDueDates.displayOrder,
      completedAt: domesticOrderDueDates.completedAt,
      completedBy: domesticOrderDueDates.completedBy,
      // 🔴 2026-11-08 — 회차 [완료 처리]가 이 칸에 오늘을 찍는다(㉨).
      deliveredDate: domesticOrderDueDates.deliveredDate,
      deliveredBy: domesticOrderDueDates.deliveredBy,
    })
    .from(domesticOrderDueDates)
    .where(eq(domesticOrderDueDates.domesticOrderId, orderId))
    .orderBy(asc(domesticOrderDueDates.displayOrder));
}

/** 그 줄의 결재 행들 — 오래된 것부터. 🔵 「표본이 비어 있지 않은가」를 재는 자리다. */
async function approvalRows(domesticOrderId: string) {
  return db
    .select({
      status: repairCaseApprovals.status,
      dueDateRowOrder: repairCaseApprovals.dueDateRowOrder,
    })
    .from(repairCaseApprovals)
    .where(eq(repairCaseApprovals.domesticOrderId, domesticOrderId))
    .orderBy(asc(repairCaseApprovals.requestedAt));
}

async function removeFixtures(): Promise<void> {
  if (createdTestUserIds.length > 0) {
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

  requesterId = await createTestUser("회차승인시험 요청자");
  approverId = await createTestUser("회차승인시험 결재자");
  superAdminId = await createTestUser("회차승인시험 최고관리자", { role: "SUPER_ADMIN" });

  const [borrowed] = await db
    .select({ id: repairCases.id })
    .from(repairCases)
    .where(eq(repairCases.isDeleted, false))
    .limit(1);
  assert.ok(borrowed, "시험 DB 에 수리 건이 하나도 없다 — ㉥ 을 잴 표본이 없다");
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

describe("㉠ 회차마다 요청이 선다 — 2026-11-08 에 뒤집힌 자리", () => {
  test("🔴 1차가 열려 있어도 2차 요청이 된다", async () => {
    await saveDomesticRoute([approverId]);
    const order = await createTestOrder();
    // 🔵 못 — 표본이 정말 회차 둘짜리인가. 하나였다면 이 시험은 아무것도 재지 못한다.
    assert.equal((await readRows(order.id)).length, 2, "표본의 회차가 둘이 아니다");

    const first = await request(order, 1);
    assert.equal(first.ok, true, `1차 요청이 거절됐다: ${JSON.stringify(first)}`);

    // 🔴 **여기가 뒤집힌 곳이다.** 0124 의 부분 유니크(줄 단위)로는 23505 가 났다.
    const second = await request(order, 2);
    assert.equal(second.ok, true, `2차 요청이 거절됐다: ${JSON.stringify(second)}`);

    const rows = await approvalRows(order.id);
    assert.equal(rows.length, 2, "열린 요청이 둘이 아니다");
    assert.deepEqual(
      rows.map((row) => row.dueDateRowOrder).sort(),
      [1, 2],
      "회차 번호가 행에 적히지 않았다"
    );
    assert.ok(rows.every((row) => row.status === "REQUESTED"));
  });

  test("🔴 **같은 회차**를 두 번 올리는 것은 여전히 거절된다 — 보증이 약해지지 않았다", async () => {
    await saveDomesticRoute([approverId]);
    const order = await createTestOrder();
    assert.equal((await request(order, 1)).ok, true);

    const again = await request(order, 1);
    assert.equal(again.ok, false, "같은 회차에 열린 요청이 둘이 되었다");
    if (again.ok) return;
    assert.equal(again.code, "ALREADY_REQUESTED");
    assert.equal((await approvalRows(order.id)).length, 1, "거절된 요청이 행을 남겼다");
  });

  test("🔴 결재도 **그 회차의** 행을 집는다 — 1차를 승인해도 2차는 그대로 열려 있다", async () => {
    await saveDomesticRoute([approverId]);
    const order = await createTestOrder();
    assert.equal((await request(order, 1)).ok, true);
    assert.equal((await request(order, 2)).ok, true);

    const decided = await decide(order, 1, "APPROVED");
    assert.equal(decided.ok, true, `1차 승인이 거절됐다: ${JSON.stringify(decided)}`);

    const progress = await getDomesticOrderApprovalUnits(order.id);
    assert.ok(progress);
    assert.deepEqual(
      progress.units.map((unit) => unit.state),
      ["APPROVED", "PENDING"],
      "1차를 승인했는데 2차까지 움직였다(또는 그 반대다)"
    );
    // 🔴 줄 하나로 접으면 아직 승인 완료가 아니다 — 2차가 남아 있다.
    assert.equal(progress.state, "PENDING");
  });
});

describe("㉡ 그 줄에 없는 회차는 거절된다", () => {
  test("🔴 회차가 둘인데 3차를 올리면 VALIDATION_ERROR 다", async () => {
    await saveDomesticRoute([approverId]);
    const order = await createTestOrder();

    const result = await request(order, 3);
    assert.equal(result.ok, false, "없는 회차에 승인이 붙었다");
    if (result.ok) return;
    assert.equal(result.code, "VALIDATION_ERROR");
    assert.equal((await approvalRows(order.id)).length, 0, "거절된 요청이 행을 남겼다");
  });

  test("🔵 납기요청일이 **0행**인 기타건도 1차 하나는 올릴 수 있다", async () => {
    // 🔴 개발 DB 실측(2026-11-08)으로 살아 있는 기타건 15건 중 11건이 0행이다. 그
    //    줄들이 승인도 완료도 못 하게 되면 이 조각이 어제 되던 것을 깨뜨린 것이다.
    await saveDomesticRoute([approverId]);
    const order = await createTestOrder({ dueDates: [] });
    assert.equal((await readRows(order.id)).length, 0, "표본이 0행이 아니다");

    assert.equal((await request(order, 1)).ok, true, "0행 기타건이 승인을 못 올린다");
    const second = await request(order, 2);
    assert.equal(second.ok, false, "0행인데 2차가 열렸다");
  });
});

describe("㉢ 그 회차의 승인이 끝나야 그 회차가 완료된다", () => {
  test("🔴 승인 없는 회차의 [완료 처리]는 거절되고, **어느 회차인지** 글에 있다", async () => {
    await saveDomesticRoute([approverId]);
    const order = await createTestOrder();

    const result = await setDomesticOrderDueDateRowCompletion({
      id: order.id,
      expectedVersion: order.version,
      dueDateRowOrder: 2,
      completed: true,
      actorUserId: requesterId,
    });
    assert.equal(result.ok, false, "승인 없이 회차가 완료되었다");
    if (result.ok) return;
    assert.equal(result.code, "APPROVAL_REQUIRED");
    // 🔴 글자를 베껴 적지 않는다 — 도메인이 만드는 그 한 줄이다.
    const label = domesticOrderDueDateRowLabel(2, { dueDate: "2096-02-15", note: "2차분" });
    assert.ok(result.message.includes(label), `회차 이름이 없다: ${result.message}`);
    assert.ok(result.message.includes(MISC_CASE_COMPLETION_BLOCKED_MESSAGES.NOT_REQUESTED));

    // 🔴 거절된 저장은 아무것도 바꾸지 않는다.
    const rows = await readRows(order.id);
    assert.ok(rows.every((row) => row.completedAt === null), "막혔는데 완료가 찍혔다");
    assert.equal((await readOrder(order.id)).completedAt, null);
  });

  test("🔴 승인을 받은 회차는 완료된다 — **되는 경우를 같은 자리에서** 잰다", async () => {
    await saveDomesticRoute([approverId]);
    const order = await createTestOrder();
    await approveRow(order, 1);

    const result = await setDomesticOrderDueDateRowCompletion({
      id: order.id,
      expectedVersion: order.version,
      dueDateRowOrder: 1,
      completed: true,
      actorUserId: requesterId,
    });
    assert.equal(result.ok, true, `승인을 받았는데 막혔다: ${JSON.stringify(result)}`);

    const rows = await readRows(order.id);
    assert.ok(rows[0].completedAt !== null, "1차가 완료되지 않았다");
    assert.equal(rows[0].completedBy, requesterId, "누가 끝냈는지가 안 남았다");
    assert.equal(rows[1].completedAt, null, "2차까지 함께 완료되었다");
    // 🔴 회차가 남았으므로 줄은 아직 완료가 아니다.
    assert.equal((await readOrder(order.id)).completedAt, null);
  });
});

describe("㉣ 마지막 회차가 찍히면 줄이 자동 완료된다 (결정 8)", () => {
  test("🔴 둘 다 끝나면 내자 줄의 completed_at 이 찍힌다", async () => {
    await saveDomesticRoute([approverId]);
    const order = await createTestOrder();
    await approveRow(order, 1);
    await approveRow(order, 2);

    const first = await setDomesticOrderDueDateRowCompletion({
      id: order.id,
      expectedVersion: order.version,
      dueDateRowOrder: 1,
      completed: true,
      actorUserId: requesterId,
    });
    assert.equal(first.ok, true, `1차 완료가 막혔다: ${JSON.stringify(first)}`);
    // 🔵 못 — **아직은** 줄이 완료가 아니다. 이것이 없으면 「언제나 완료시키는 코드」도
    //    아래 단언을 통과한다.
    assert.equal((await readOrder(order.id)).completedAt, null, "1차만 끝났는데 줄이 완료됐다");

    const second = await setDomesticOrderDueDateRowCompletion({
      id: order.id,
      expectedVersion: order.version,
      dueDateRowOrder: 2,
      completed: true,
      actorUserId: requesterId,
    });
    assert.equal(second.ok, true, `2차 완료가 막혔다: ${JSON.stringify(second)}`);

    const row = await readOrder(order.id);
    assert.ok(row.completedAt !== null, "마지막 회차가 찍혔는데 줄이 완료되지 않았다");
    assert.equal(row.completedBy, requesterId);
  });

  test("🔴 회차 하나를 풀면 줄의 완료도 함께 풀린다 — 아니면 다시 완료할 길이 없다", async () => {
    await saveDomesticRoute([approverId]);
    const order = await createTestOrder();
    await approveRow(order, 1);
    await approveRow(order, 2);
    for (const rowOrder of [1, 2]) {
      const done = await setDomesticOrderDueDateRowCompletion({
        id: order.id,
        expectedVersion: order.version,
        dueDateRowOrder: rowOrder,
        completed: true,
        actorUserId: requesterId,
      });
      assert.equal(done.ok, true);
    }
    assert.ok((await readOrder(order.id)).completedAt !== null, "전제가 깨졌다 — 줄이 완료가 아니다");

    const released = await setDomesticOrderDueDateRowCompletion({
      id: order.id,
      expectedVersion: order.version,
      dueDateRowOrder: 2,
      completed: false,
      actorUserId: requesterId,
    });
    assert.equal(released.ok, true, `완료 해제가 막혔다: ${JSON.stringify(released)}`);

    const rows = await readRows(order.id);
    assert.ok(rows[0].completedAt !== null, "안 건드린 1차까지 풀렸다");
    assert.equal(rows[1].completedAt, null);
    assert.equal((await readOrder(order.id)).completedAt, null, "줄의 완료가 안 풀렸다");
  });
});

describe("㉤ 회차 완료는 version 을 올리지 않는다 — 안 그러면 기능이 스스로를 먹는다", () => {
  test("🔴 1차를 완료해도 2차의 승인이 STALE 이 되지 않는다", async () => {
    await saveDomesticRoute([approverId]);
    const order = await createTestOrder();
    await approveRow(order, 1);
    await approveRow(order, 2);

    const before = await getDomesticOrderApprovalUnits(order.id);
    assert.deepEqual(before?.units.map((unit) => unit.state), ["APPROVED", "APPROVED"]);

    const done = await setDomesticOrderDueDateRowCompletion({
      id: order.id,
      expectedVersion: order.version,
      dueDateRowOrder: 1,
      completed: true,
      actorUserId: requesterId,
    });
    assert.equal(done.ok, true);
    if (!done.ok) return;
    // 🔴 돌려주는 판 번호도 그대로다 — 화면이 들고 있던 version 이 아직 쓸 수 있다.
    assert.equal(done.version, order.version, "회차 완료가 판 번호를 올렸다");
    assert.equal((await readOrder(order.id)).version, order.version);

    // 🔴 그리고 2차는 **같은 version 으로 여전히 완료할 수 있다.**
    const second = await setDomesticOrderDueDateRowCompletion({
      id: order.id,
      expectedVersion: order.version,
      dueDateRowOrder: 2,
      completed: true,
      actorUserId: requesterId,
    });
    assert.equal(second.ok, true, `2차가 STALE 로 막혔다: ${JSON.stringify(second)}`);
  });

  test("🔵 그래도 낙관적 잠금은 산다 — 그 사이 줄이 바뀌면 CONFLICT 다", async () => {
    await saveDomesticRoute([approverId]);
    const order = await createTestOrder();
    await approveRow(order, 1);
    const stale = order.version;
    const updated = await updateDomesticOrder({
      id: order.id,
      expectedVersion: order.version,
      fields: { ...order.fields, etcNote: "그 사이 누가 고쳤다" },
      actorUserId: requesterId,
    });
    assert.equal(updated.ok, true);

    const result = await setDomesticOrderDueDateRowCompletion({
      id: order.id,
      expectedVersion: stale,
      dueDateRowOrder: 1,
      completed: true,
      actorUserId: requesterId,
    });
    assert.equal(result.ok, false, "낡은 판 번호로 완료가 통과했다");
    if (!result.ok) assert.equal(result.code, "CONFLICT");
  });
});

describe("㉥ 수리 건이 붙은 줄은 회차별 완료를 쓰지 않는다", () => {
  test("🔴 거절되고, 줄의 [완료 처리]로 가라고 말한다", async () => {
    await saveDomesticRoute([approverId]);
    // 🔴 수리 건이 붙은 줄은 납기요청일이 하나뿐이어야 한다(결정 9 울타리).
    const order = await createTestOrder({
      repairCaseId: borrowedRepairCaseId,
      dueDates: [dueDate("2096-03-10", null)],
    });
    assert.equal((await readOrder(order.id)).repairCaseId, borrowedRepairCaseId);

    const result = await setDomesticOrderDueDateRowCompletion({
      id: order.id,
      expectedVersion: order.version,
      dueDateRowOrder: 1,
      completed: true,
      actorUserId: requesterId,
    });
    assert.equal(result.ok, false, "수리 건 줄에서 회차별 완료가 열렸다");
    if (result.ok) return;
    assert.equal(result.code, "VALIDATION_ERROR");
    assert.ok(result.message.includes("[완료 처리]"), `갈 곳을 안 말한다: ${result.message}`);
    assert.ok((await readRows(order.id)).every((row) => row.completedAt === null));
  });
});

describe("㉦ 줄 전체를 끝내는 길은 회차 **전부**의 승인을 본다", () => {
  test("🔴 1차만 승인된 줄의 [완료 처리]는 2차 이름을 대고 거절된다", async () => {
    await saveDomesticRoute([approverId]);
    const order = await createTestOrder();
    await approveRow(order, 1);

    const result = await setDomesticOrderCompletion({
      id: order.id,
      expectedVersion: order.version,
      completed: true,
      actorUserId: requesterId,
    });
    assert.equal(result.ok, false, "회차 하나가 남았는데 줄이 완료되었다");
    if (result.ok) return;
    assert.equal(result.code, "APPROVAL_REQUIRED");
    const label = domesticOrderDueDateRowLabel(2, { dueDate: "2096-02-15", note: "2차분" });
    assert.ok(result.message.includes(label), `막힌 회차를 안 말한다: ${result.message}`);
  });

  test("🔴 둘 다 승인되면 줄이 완료되고 **회차 행에도 완료가 찍힌다**", async () => {
    await saveDomesticRoute([approverId]);
    const order = await createTestOrder();
    await approveRow(order, 1);
    await approveRow(order, 2);

    const result = await setDomesticOrderCompletion({
      id: order.id,
      expectedVersion: order.version,
      completed: true,
      actorUserId: requesterId,
    });
    assert.equal(result.ok, true, `둘 다 승인했는데 막혔다: ${JSON.stringify(result)}`);

    assert.ok((await readOrder(order.id)).completedAt !== null);
    const rows = await readRows(order.id);
    assert.ok(
      rows.every((row) => row.completedAt !== null),
      "줄은 완료인데 회차는 미완료로 남았다 — 회차 단추가 「아직」이라고 말하게 된다"
    );
  });

  test("🔴 줄의 [완료 해제]는 회차 완료까지 함께 거둔다", async () => {
    await saveDomesticRoute([approverId]);
    const order = await createTestOrder();
    await approveRow(order, 1);
    await approveRow(order, 2);
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
    assert.ok(
      (await readRows(order.id)).every((row) => row.completedAt === null),
      "줄은 풀렸는데 회차는 완료로 남았다"
    );
  });
});

describe("㉧ 완료 표시는 줄을 저장해도 살아남는다 — 그리고 줄을 지키는 울타리가 된다", () => {
  test("🔴 줄의 다른 칸을 고쳐도 회차 완료가 **그 자리에** 남는다", async () => {
    await saveDomesticRoute([approverId]);
    const order = await createTestOrder();
    await approveRow(order, 1);
    const done = await setDomesticOrderDueDateRowCompletion({
      id: order.id,
      expectedVersion: order.version,
      dueDateRowOrder: 1,
      completed: true,
      actorUserId: requesterId,
    });
    assert.equal(done.ok, true);

    // 🔴 이 저장은 납기요청일 행을 **통째로 지우고 다시 넣는다**(replaceDueDates).
    const updated = await updateDomesticOrder({
      id: order.id,
      expectedVersion: order.version,
      fields: { ...order.fields, etcNote: "메모만 고친다" },
      actorUserId: requesterId,
    });
    assert.equal(updated.ok, true, `저장이 막혔다: ${JSON.stringify(updated)}`);

    const rows = await readRows(order.id);
    assert.equal(rows.length, 2, "행 수가 달라졌다");
    assert.ok(rows[0].completedAt !== null, "저장 한 번에 1차의 완료 표시가 사라졌다");
    assert.equal(rows[0].completedBy, requesterId, "누가 끝냈는지가 사라졌다");
    assert.equal(rows[1].completedAt, null, "안 끝낸 2차에 완료가 생겼다");
  });

  test("🔴 완료된 회차가 있으면 줄을 **지우는** 저장이 거절된다 (셋째 울타리)", async () => {
    await saveDomesticRoute([approverId]);
    const order = await createTestOrder();
    await approveRow(order, 1);
    assert.equal(
      (
        await setDomesticOrderDueDateRowCompletion({
          id: order.id,
          expectedVersion: order.version,
          dueDateRowOrder: 1,
          completed: true,
          actorUserId: requesterId,
        })
      ).ok,
      true
    );

    const shrink = await updateDomesticOrder({
      id: order.id,
      expectedVersion: order.version,
      fields: { ...order.fields, dueDates: [dueDate("2096-01-20", "1차분")] },
      actorUserId: requesterId,
    });
    assert.equal(shrink.ok, false, "완료된 회차가 있는데 줄이 지워졌다");
    if (shrink.ok) return;
    assert.equal(shrink.code, "VALIDATION_ERROR");
    assert.equal(shrink.message, COMPLETED_DUE_DATE_ROW_MESSAGE);
    // 🔴 거절된 저장은 행을 한 줄도 건드리지 않는다.
    assert.equal((await readRows(order.id)).length, 2);
  });

  /**
   * 🔴 **2026-11-08 에 이 시험이 한 걸음 길어졌다 — 약해진 것이 아니다.**
   *
   * 그날 회차 [완료 처리]가 **그 회차의 납품일에 오늘을 찍기** 시작했고(㉨, 사용자
   * 요구), [완료 해제]는 그 날짜를 **지우지 않는다**(일부러 정한 모양). 그래서 완료를
   * 풀어도 그 회차에는 **납품 기록이 남고**, 그 줄은 **결정 5 의 울타리**에 걸려 여전히
   * 지워지지 않는다 — 셋째 울타리에서 첫째 울타리로 **막는 주체가 바뀐 것**이다.
   *
   * 🔵 **그것이 맞다**: 보냈다는 기록이 달린 줄을 한 번의 저장으로 지우면 그 기록이
   * 말없이 사라진다. 빠져나가는 길은 그대로 있고(기록을 먼저 지우는 저장은 줄 수가
   * 안 줄어 통과한다), 이 시험이 그 두 걸음을 **차례대로** 못 박는다.
   */
  test("🔵 완료를 풀고 납품 기록까지 지우면 그 저장이 통과한다 — 막다른 길이 아니다", async () => {
    await saveDomesticRoute([approverId]);
    const order = await createTestOrder();
    await approveRow(order, 1);
    assert.equal(
      (
        await setDomesticOrderDueDateRowCompletion({
          id: order.id,
          expectedVersion: order.version,
          dueDateRowOrder: 1,
          completed: true,
          actorUserId: requesterId,
        })
      ).ok,
      true
    );
    assert.equal(
      (
        await setDomesticOrderDueDateRowCompletion({
          id: order.id,
          expectedVersion: order.version,
          dueDateRowOrder: 1,
          completed: false,
          actorUserId: requesterId,
        })
      ).ok,
      true
    );
    // 🔵 못 — **납품일이 실제로 남아 있는가.** 안 남아 있으면 아래 거절이 공짜로
    //    통과하는 것이 아니라 아예 일어나지 않아, 이 시험이 뜻을 잃는다.
    const afterRelease = await readRows(order.id);
    assert.ok(
      afterRelease[0].deliveredDate !== null,
      "완료를 풀었더니 납품일까지 지워졌다 — 보낸 사실이 사라졌다"
    );

    // 🔴 ① 완료만 풀고 바로 줄을 지우면 **첫째 울타리**가 막는다(납품 기록이 함께 준다).
    const tooEarly = await updateDomesticOrder({
      id: order.id,
      expectedVersion: order.version,
      fields: { ...order.fields, dueDates: [dueDate("2096-01-20", "1차분")] },
      actorUserId: requesterId,
    });
    assert.equal(tooEarly.ok, false, "납품 기록이 달린 줄이 그대로 지워졌다");
    if (tooEarly.ok) return;
    assert.equal(tooEarly.code, "VALIDATION_ERROR");
    assert.equal(tooEarly.message, DUE_DATE_ROW_HAS_DELIVERY_MESSAGE);
    assert.equal((await readRows(order.id)).length, 2, "거절된 저장이 행을 건드렸다");

    // 🔴 ② 납품 기록을 **먼저 지우는** 저장 — 줄 수가 안 줄므로 통과한다.
    const clearDelivery = await updateDomesticOrder({
      id: order.id,
      expectedVersion: order.version,
      fields: { ...order.fields },
      actorUserId: requesterId,
    });
    assert.equal(clearDelivery.ok, true, `납품 기록 지우기가 막혔다: ${JSON.stringify(clearDelivery)}`);
    if (!clearDelivery.ok) return;
    assert.equal((await readRows(order.id))[0].deliveredDate, null);

    // 🔴 ③ 그제야 줄을 지울 수 있다. 거절 문장이 말한 그 차례 그대로다.
    const shrink = await updateDomesticOrder({
      id: order.id,
      expectedVersion: clearDelivery.version,
      fields: { ...order.fields, dueDates: [dueDate("2096-01-20", "1차분")] },
      actorUserId: requesterId,
    });
    assert.equal(shrink.ok, true, `두 걸음을 다 밟았는데도 막혔다: ${JSON.stringify(shrink)}`);
    assert.equal((await readRows(order.id)).length, 1);
  });
});

/**
 * ============================================================================
 * ㉨ 🔴 **[1차 완료]를 누르면 그 회차의 납품일에 오늘이 찍힌다** (2026-11-08)
 * ============================================================================
 * 사용자 요구 원문: 「**1차완료 2차 완료를 누를 때 그 날짜로 납품일이 찍히도록**
 * 해줘.」 출하 완료 전이가 연결된 내자 줄에 같은 일을 하는 것(결정 6)의 기타건 판이다.
 *
 * 재는 것 넷:
 *  · 🔴 **그 회차에만** 찍힌다 — 2차 줄은 1차를 완료해도 그대로다.
 *  · 🔴 **이미 적힌 납품일은 안 덮는다** — 사람이 고른 날짜가 이긴다.
 *  · 🔴 **[완료 해제]는 안 지운다** — 「완료는 풀렸는데 납품일은 남은」 회차가 **정한
 *    모양**이다.
 *  · 🔴 **`version` 이 안 올라간다** — 납품일을 함께 찍는다고 그 판단이 달라지지
 *    않는다(㉤ 이 재던 그 자리가 그대로 참이어야 한다).
 * ============================================================================
 */
describe("㉨ 회차 [완료 처리]가 납품일을 찍는다", () => {
  /**
   * 서버가 쓰는 것과 **같은 방식**의 오늘 — mutation 이 `toKstDateOnly` 로 만든다
   * (2026-11-09 고침). 전에는 `toISOString().slice(0, 10)` 을 베껴 적었는데 그것은
   * UTC 날짜라, 한국 시간 00:00~09:00 사이에 돌리면 **하루가 어긋나 깨졌다.**
   */
  const today = () => toKstDateOnly(new Date());

  test("🔴 1차를 완료하면 1차 줄에만 오늘이 찍힌다", async () => {
    await saveDomesticRoute([approverId]);
    const order = await createTestOrder();
    // 🔵 못 — 시작할 때 두 줄 다 비어 있는가. 안 비어 있으면 아래 단언이 공짜다.
    const before = await readRows(order.id);
    assert.equal(before.length, 2, "표본의 회차가 둘이 아니다");
    assert.ok(
      before.every((row) => row.deliveredDate === null),
      "표본에 이미 납품일이 적혀 있다 — 「찍혔다」를 잴 수 없다"
    );

    await approveRow(order, 1);
    const stamped = await setDomesticOrderDueDateRowCompletion({
      id: order.id,
      expectedVersion: order.version,
      dueDateRowOrder: 1,
      completed: true,
      actorUserId: requesterId,
    });
    assert.equal(stamped.ok, true, `1차 완료가 막혔다: ${JSON.stringify(stamped)}`);

    const rows = await readRows(order.id);
    assert.equal(rows[0].deliveredDate, today(), "1차 납품일에 오늘이 안 찍혔다");
    assert.equal(rows[1].deliveredDate, null, "완료하지 않은 2차에 납품일이 찍혔다");
    // 🔵 납품**자**는 건드리지 않는다 — 누가 보냈는지는 사람이 적는 값이다.
    assert.equal(rows[0].deliveredBy, null, "납품자까지 멋대로 적었다");
  });

  test("🔴 이미 적힌 납품일은 덮지 않는다 — 사람이 고른 날짜가 이긴다", async () => {
    await saveDomesticRoute([approverId]);
    const WRITTEN = "2096-01-25";
    const order = await createTestOrder({
      dueDates: [
        { dueDate: "2096-01-20", note: "1차분", deliveredDate: WRITTEN, deliveredBy: "보낸사람" },
        dueDate("2096-02-15", "2차분"),
      ],
    });
    // 🔵 못 — 그 날짜가 **오늘이 아니어야** 이 시험이 뜻을 갖는다.
    assert.notEqual(WRITTEN, today(), "표본의 납품일이 오늘과 같다 — 덮었는지 알 수 없다");

    await approveRow(order, 1);
    assert.equal(
      (
        await setDomesticOrderDueDateRowCompletion({
          id: order.id,
          expectedVersion: order.version,
          dueDateRowOrder: 1,
          completed: true,
          actorUserId: requesterId,
        })
      ).ok,
      true
    );

    const rows = await readRows(order.id);
    assert.equal(rows[0].deliveredDate, WRITTEN, "사람이 적은 납품일을 자동 처리가 덮었다");
    assert.equal(rows[0].deliveredBy, "보낸사람", "납품자가 사라졌다");
    assert.ok(rows[0].completedAt !== null, "완료 자체가 안 됐다");
  });

  test("🔴 [완료 해제]를 해도 납품일은 남는다 — 보낸 사실은 사라지지 않는다", async () => {
    await saveDomesticRoute([approverId]);
    const order = await createTestOrder();
    await approveRow(order, 1);
    assert.equal(
      (
        await setDomesticOrderDueDateRowCompletion({
          id: order.id,
          expectedVersion: order.version,
          dueDateRowOrder: 1,
          completed: true,
          actorUserId: requesterId,
        })
      ).ok,
      true
    );
    assert.equal((await readRows(order.id))[0].deliveredDate, today(), "찍히지 않았다");

    assert.equal(
      (
        await setDomesticOrderDueDateRowCompletion({
          id: order.id,
          expectedVersion: order.version,
          dueDateRowOrder: 1,
          completed: false,
          actorUserId: requesterId,
        })
      ).ok,
      true
    );

    const rows = await readRows(order.id);
    assert.equal(rows[0].completedAt, null, "완료가 안 풀렸다");
    assert.equal(rows[0].deliveredDate, today(), "완료를 풀었더니 납품일까지 지워졌다");
  });

  test("🔴 납품일을 함께 찍어도 `version` 은 그대로다 — 남은 회차의 승인이 안 죽는다", async () => {
    await saveDomesticRoute([approverId]);
    const order = await createTestOrder();
    await approveRow(order, 1);
    await approveRow(order, 2);

    const done = await setDomesticOrderDueDateRowCompletion({
      id: order.id,
      expectedVersion: order.version,
      dueDateRowOrder: 1,
      completed: true,
      actorUserId: requesterId,
    });
    assert.equal(done.ok, true);
    if (!done.ok) return;
    assert.equal(done.version, order.version, "회차 완료가 version 을 올렸다");
    assert.equal((await readOrder(order.id)).version, order.version, "DB 의 version 이 올랐다");

    // 🔴 그래서 2차의 승인이 아직 **유효하다** — version 이 올랐다면 STALE 이 된다.
    const units = await getDomesticOrderApprovalUnits(order.id);
    assert.equal(units?.units[1].state, "APPROVED", "1차를 완료했더니 2차 승인이 죽었다");
  });
});
