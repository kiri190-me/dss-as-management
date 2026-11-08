import "../../../../scripts/load-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  auditLogs,
  domesticOrders,
  repairCaseApprovals,
  shipmentApprovalRouteSteps,
  shipmentApprovalRoutes,
  users,
} from "../schema";
import { createDomesticOrder } from "../mutations/domestic-orders";
import { softDeleteDomesticOrder } from "../mutations/domestic-orders-trash";
import {
  decideDomesticOrderApproval,
  requestDomesticOrderApproval,
} from "../mutations/domestic-order-approvals";
import { saveShipmentApprovalRoute } from "../mutations/shipment-approval-routes";
import { listDomesticOrderApprovalsPendingMyApproval } from "./domestic-order-approvals-pending";
import {
  listMyGrantedApprovalOutcomes,
  listMyRejectedApprovalOutcomes,
} from "./approval-outcome-notifications";
import { listMyNotifications } from "./notifications";
import { listRepairCasesPendingMyApproval } from "./repair-case-approvals-pending";
import { listQuoteApprovalsPendingMyApproval } from "./quote-approvals-pending";
import { getCurrentShipmentApprovalRoute } from "./shipment-approval-routes";
import { getUserBySsoSubject } from "./users";
import { buildPortalApprovalInbox } from "@/lib/server/integration/portal-approvals";
import { DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE } from "@/lib/domain/domestic-order-approval-rules";
import { DOMESTIC_ORDER_NO_MODEL_LINK_LABEL } from "@/lib/domain/domestic-order-detail-link";
import type { DomesticOrderFields } from "@/lib/validation/domestic-order-input";

/**
 * ============================================================================
 * 기타건 결재가 **종 · 통합 승인함 · 결과 알림에 실제로 뜨는가** — 실제 DB
 * ============================================================================
 * 2026-11-06. 미는 쪽(포털 찌르기)만 달면 포털은 202 를 주고 로그도 깨끗한데
 * 알림은 영영 안 간다 — 포털이 **A/S 에 되물어** 내용을 가져가기 때문이다. 그래서
 * 이 파일이 재는 것은 **되묻는 통로가 기타건을 내주는가**이고, 그 통로가 쓰는
 * 조회를 진짜 DB 위에서 돌린다.
 *
 * 여기서 못 박는 것 여덟:
 *  1. 요청을 올리면 **그 단계의 지정 승인자**에게 뜬다 — 종 · 승인함 둘 다.
 *  2. 🔴 **남의 결재는 안 보인다** — 자격은 있지만 결재선에 없는 사람에게 0건.
 *  3. 승인하면 그 사람 목록에서 빠지고 **다음 단계 사람에게** 뜬다.
 *  4. 🔴 **접수 건 결재 대기 조회가 한 줄도 안 바뀐다** — 같은 표인데 섞이지 않는다.
 *  5. 휴지통에 간 줄의 결재는 안 뜬다(누르면 갈 화면이 없다).
 *  6. 🔴 **품명이 비어도 줄이 서고 제목이 비지 않는다** — 빈 제목은 승인함이 줄을
 *     통째로 뺀다(포털 lib/approvals/screen-inbox.ts 의 계약).
 *  7. 🔴 **승인·반려 결과가 요청자 종에 뜬다** — 대기 쪽을 고쳐도 여기는 안 열린다.
 *  8. 🔴 주소가 `/domestic-orders/` 로 간다 — 통로가 실제로 내주는 글자로 잰다.
 *
 * ── 격리·청소 규약 ──────────────────────────────────────────────────────
 * 이 파일이 만든 "domesticpending-test-" 계정과 그 계정이 만든 내자 줄만 쓴다.
 * ⚠️ **판·단계는 afterEach 로 반드시 걷는다** — 시험 DB 에 판이 남으면 다른 시험
 * 파일이 갑자기 결재선을 타면서 깨진다. 사람 참조가 RESTRICT 라 삭제에는 순서가
 * 있다: 결재 행 → 내자 줄 → 단계 → 판 → 감사 기록 → 사람.
 *
 * 🔵 **접수 건을 하나도 만들지 않는다.** 인수번호가 한 달에 99개뿐이라
 * (intake_sequences) 시험이 접수 건을 늘리면 한참 뒤 남의 시험이 까닭 없이 깨진다.
 * 4번을 재는 데에도 접수 건이 필요 없다 — 재는 것은 「기타건 행이 접수 건 조회에
 * 들어가는가」이고, 그 표본은 기타건 행 자신이다.
 *
 * 🔴 실제 고객사 · 사람 이름 · L/N · S/N 을 적지 않는다 — 전부 가짜 값이다.
 * ============================================================================
 */

const RUN = randomUUID().slice(0, 8);
const TEST_EMAIL_PREFIX = "domesticpending-test-";
const TEST_PO_PREFIX = `DOP-TEST-${RUN}-`;

/** 내자 줄을 고칠 수 있는 역할(domesticOrders WRITE 기본값)이다 — 요청을 올린다. */
let requesterId: string;
let stepAId: string;
let stepBId: string;
/** 자격은 있는데 결재선에는 없는 사람 — 지정 관문에 막혀야 한다. */
let outsiderId: string;
/** 판을 저장하는 사람. 🔵 최고관리자 비상구는 이 파일에서 재지 않는다. */
let superAdminId: string;

/** 통합 승인함 통로가 사람을 가리키는 값. 🔴 A/S 의 사용자 id 와 **다른 값**이다. */
const STEP_A_SUBJECT = `portal-${RUN}-step-a`;

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
    modelNameText: "알림시험 품명",
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

async function createTestOrder(overrides: Partial<DomesticOrderFields> = {}): Promise<string> {
  const created = await createDomesticOrder({
    fields: orderFields(overrides),
    actorUserId: requesterId,
  });
  assert.equal(created.ok, true, `setup order create failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  createdOrderIds.push(created.id);
  return created.id;
}

/**
 * 그 줄을 휴지통에 넣는다. 판 번호를 **지금 읽어** 넘긴다 — 결재를 올려도 내자 줄의
 * version 은 오르지 않지만(그 mutation 은 줄을 고치지 않는다), 여기서 상수를 적어
 * 두면 그 전제가 바뀌는 날 시험이 NOT_FOUND 가 아니라 CONFLICT 로 조용히 어긋난다.
 */
async function trashTestOrder(orderId: string): Promise<void> {
  const [row] = await db
    .select({ version: domesticOrders.version })
    .from(domesticOrders)
    .where(eq(domesticOrders.id, orderId));
  assert.ok(row, "지울 줄을 못 찾았다");
  const deleted = await softDeleteDomesticOrder({
    id: orderId,
    expectedVersion: row.version,
    actorUserId: superAdminId,
    reason: "알림 시험",
  });
  assert.equal(deleted.ok, true, JSON.stringify(deleted));
}

async function saveDomesticRoute(approverUserIds: string[]): Promise<void> {
  const result = await saveShipmentApprovalRoute(
    approverUserIds,
    superAdminId,
    DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE
  );
  assert.equal(result.ok, true, `setup route save failed: ${JSON.stringify(result)}`);
  assert.ok(
    await getCurrentShipmentApprovalRoute(DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE),
    "저장했는데 현재 판이 없다"
  );
}

async function request(domesticOrderId: string): Promise<void> {
  const requested = await requestDomesticOrderApproval({
    domesticOrderId,
    actorUserId: requesterId,
    requestReason: null,
    dueDateRowOrder: 1,
  });
  assert.equal(requested.ok, true, `setup request failed: ${JSON.stringify(requested)}`);
}

/** 되묻는 통로가 **실제로 내주는 목록** — 라우트가 꽂는 조회 셋을 그대로 꽂는다. */
async function portalInbox(subject: string) {
  return buildPortalApprovalInbox({
    subject,
    baseUrl: "http://as.test:3000",
    findActor: getUserBySsoSubject,
    listRepairCaseApprovals: listRepairCasesPendingMyApproval,
    listQuoteApprovals: listQuoteApprovalsPendingMyApproval,
    listDomesticOrderApprovals: listDomesticOrderApprovalsPendingMyApproval,
  });
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

  requesterId = await createTestUser("기타건알림시험 요청자");
  stepAId = await createTestUser("기타건알림시험 1단계", { ssoSubject: STEP_A_SUBJECT });
  stepBId = await createTestUser("기타건알림시험 2단계");
  outsiderId = await createTestUser("기타건알림시험 제삼자");
  superAdminId = await createTestUser("기타건알림시험 최고관리자", { role: "SUPER_ADMIN" });
});

afterEach(async () => {
  await removeFixtures();
});

after(async () => {
  await removeFixtures();
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

describe("대기 목록 — 지금 누구 차례인가", () => {
  test("🔴 요청을 올리면 **1단계 지정자에게만** 뜬다 — 요청자에게도 제삼자에게도 안 뜬다", async () => {
    await saveDomesticRoute([stepAId, stepBId]);
    const orderId = await createTestOrder();
    // 🔵 올리기 **전에는 0건**인지 먼저 — 표본이 비어 공짜로 통과하지 않게.
    assert.deepEqual(await listDomesticOrderApprovalsPendingMyApproval(stepAId), []);

    await request(orderId);

    const forStepA = await listDomesticOrderApprovalsPendingMyApproval(stepAId);
    assert.equal(forStepA.length, 1, "1단계 지정자에게 안 떴다");
    assert.equal(forStepA[0].domesticOrderId, orderId);
    assert.equal(forStepA[0].modelName, "알림시험 품명");
    assert.equal(forStepA[0].routeStepOrder, 1);
    assert.equal(forStepA[0].requestedByUserId, requesterId);
    assert.equal(forStepA[0].requestedByName, "기타건알림시험 요청자");
    // ISO 8601 — 서버 컴포넌트 경계와 승인함이 그 글자를 그대로 쓴다.
    assert.match(forStepA[0].requestedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    // 🔴 남의 결재는 안 보인다.
    assert.deepEqual(
      await listDomesticOrderApprovalsPendingMyApproval(stepBId),
      [],
      "아직 차례가 아닌 2단계에게 떴다"
    );
    assert.deepEqual(
      await listDomesticOrderApprovalsPendingMyApproval(outsiderId),
      [],
      "결재선에 없는 사람에게 떴다"
    );
    assert.deepEqual(
      await listDomesticOrderApprovalsPendingMyApproval(requesterId),
      [],
      "요청자에게 제 요청이 결재 대기로 떴다"
    );
  });

  test("🔴 1단계를 승인하면 그 사람에게서 빠지고 **2단계 사람에게** 뜬다", async () => {
    await saveDomesticRoute([stepAId, stepBId]);
    const orderId = await createTestOrder();
    await request(orderId);
    assert.equal((await listDomesticOrderApprovalsPendingMyApproval(stepAId)).length, 1);

    const decided = await decideDomesticOrderApproval({
      domesticOrderId: orderId,
      decision: "APPROVED",
      actorUserId: stepAId,
      decisionReason: null,
      dueDateRowOrder: 1,
    });
    assert.equal(decided.ok, true, JSON.stringify(decided));

    assert.deepEqual(
      await listDomesticOrderApprovalsPendingMyApproval(stepAId),
      [],
      "처리했는데 제 목록에 남아 있다"
    );
    const forStepB = await listDomesticOrderApprovalsPendingMyApproval(stepBId);
    assert.equal(forStepB.length, 1, "다음 단계 사람에게 새 차례가 안 떴다");
    assert.equal(forStepB[0].routeStepOrder, 2);
    // 요청자는 사슬 내내 처음 올린 사람 그대로다.
    assert.equal(forStepB[0].requestedByUserId, requesterId);
  });

  test("반려하면 아무에게도 안 뜬다 — 다음 차례는 결재자가 아니라 요청자다", async () => {
    await saveDomesticRoute([stepAId, stepBId]);
    const orderId = await createTestOrder();
    await request(orderId);

    const decided = await decideDomesticOrderApproval({
      domesticOrderId: orderId,
      decision: "REJECTED",
      actorUserId: stepAId,
      decisionReason: "금액 확인 필요",
      dueDateRowOrder: 1,
    });
    assert.equal(decided.ok, true, JSON.stringify(decided));

    for (const userId of [stepAId, stepBId, outsiderId, requesterId]) {
      assert.deepEqual(await listDomesticOrderApprovalsPendingMyApproval(userId), [], userId);
    }
  });

  test("🔴 휴지통에 간 줄의 결재는 뜨지 않는다 — 누르면 갈 화면이 없다", async () => {
    await saveDomesticRoute([stepAId]);
    const orderId = await createTestOrder();
    await request(orderId);
    // 🔵 지우기 전에는 떠 있다는 것을 먼저 본다.
    assert.equal((await listDomesticOrderApprovalsPendingMyApproval(stepAId)).length, 1);

    await trashTestOrder(orderId);

    assert.deepEqual(await listDomesticOrderApprovalsPendingMyApproval(stepAId), []);
  });

  test("🔴 품명이 비어 있어도 줄은 선다 — 빈 칸이 줄을 날리지 않는다", async () => {
    await saveDomesticRoute([stepAId]);
    const orderId = await createTestOrder({ modelNameText: null });
    await request(orderId);

    const pending = await listDomesticOrderApprovalsPendingMyApproval(stepAId);
    assert.equal(pending.length, 1, "품명이 비었다고 줄이 사라졌다");
    assert.equal(pending[0].modelName, null, "조회가 메우면 안 된다 — 메우는 자리는 빌더 하나다");
  });
});

describe("🔴 접수 건 결재는 한 줄도 바뀌지 않는다", () => {
  test("같은 표에 기타건 행이 있어도 접수 건 대기 조회는 0건이다", async () => {
    await saveDomesticRoute([stepAId]);
    const orderId = await createTestOrder();
    await request(orderId);

    // 🔵 **섞일 뻔한 줄이 실제로 있는지** 먼저 — 없으면 아래 단언이 공짜로 통과한다.
    const [row] = await db
      .select({ approvalType: repairCaseApprovals.approvalType, repairCaseId: repairCaseApprovals.repairCaseId })
      .from(repairCaseApprovals)
      .where(eq(repairCaseApprovals.domesticOrderId, orderId));
    assert.ok(row, "기타건 결재 행이 없다 — 이 시험이 아무것도 안 본다");
    assert.equal(row.approvalType, "DOMESTIC_ORDER_FINAL_SHIPMENT");
    assert.equal(row.repairCaseId, null);
    assert.equal((await listDomesticOrderApprovalsPendingMyApproval(stepAId)).length, 1);

    // 본론 — 그 행이 접수 건 쪽 조회에 들어가지 않는다.
    for (const userId of [stepAId, stepBId, outsiderId, requesterId, superAdminId]) {
      const cases = await listRepairCasesPendingMyApproval(userId);
      assert.deepEqual(
        cases.filter((item) => item.repairCaseId === orderId),
        [],
        `${userId}: 기타건 행이 접수 건 결재 대기에 섞였다`
      );
    }
  });
});

describe("🔴 되묻는 통로가 기타건을 내준다 — 포털이 쓰는 그 길로 잰다", () => {
  test("통합 승인함 통로가 기타건 줄을 내주고, 주소가 `/domestic-orders/` 로 간다", async () => {
    await saveDomesticRoute([stepAId]);
    const orderId = await createTestOrder();

    // 🔵 올리기 전에는 0건 — 아래 1건이 정말 이 요청 때문인지 가른다.
    const before = await portalInbox(STEP_A_SUBJECT);
    assert.deepEqual(before.items, [], "올리기 전에 이미 줄이 있다");

    await request(orderId);

    const inbox = await portalInbox(STEP_A_SUBJECT);
    assert.equal(inbox.items.length, 1, "🔴 되묻는 통로가 기타건을 안 내줬다");
    assert.equal(inbox.count, 1);
    const item = inbox.items[0];
    assert.equal(item.kind, "DOMESTIC_ORDER_FINAL_SHIPMENT");
    assert.equal(item.kindLabel, "기타건 최종 출하 결재");
    assert.equal(item.subject, "알림시험 품명");
    assert.equal(item.detail, "결재선 1단계 · 요청자 기타건알림시험 요청자");
    // 🔴 이 한 줄이 포털 화면에서 [승인하기]가 가는 곳이다. 접수 건 헬퍼를 베꼈다면
    //    `/repair-cases/{내자줄 uuid}/approval` 로 나가 404 였다.
    assert.equal(item.href, `http://as.test:3000/domestic-orders/${orderId}/approval`);
    assert.ok(!item.href.includes("/repair-cases/"));
  });

  test("🔴 품명이 비어도 제목이 비지 않는다 — 승인함이 줄을 통째로 빼는 조건이다", async () => {
    await saveDomesticRoute([stepAId]);
    const orderId = await createTestOrder({ modelNameText: null });
    await request(orderId);

    const inbox = await portalInbox(STEP_A_SUBJECT);
    assert.equal(inbox.items.length, 1);
    assert.equal(inbox.items[0].subject, DOMESTIC_ORDER_NO_MODEL_LINK_LABEL);
    // 승인함은 열 칸 가운데 detail 말고 하나라도 비면 그 줄을 뺀다.
    for (const [name, value] of Object.entries(inbox.items[0])) {
      if (name === "detail") continue;
      assert.ok(String(value).trim().length > 0, `${name} 이 비었다 — 승인함이 줄을 뺀다`);
    }
  });

  test("승인함 통로도 남의 결재를 내주지 않는다 — 결재선에 없는 사람은 0건", async () => {
    await saveDomesticRoute([stepAId]);
    const orderId = await createTestOrder();
    await request(orderId);
    // 🔵 표본 확인 — 지정자에게는 떠 있다.
    assert.equal((await portalInbox(STEP_A_SUBJECT)).items.length, 1);

    // 제삼자에게 포털 번호를 잠시 달아 같은 통로로 물어본다.
    const outsiderSubject = `portal-${RUN}-outsider`;
    await db.update(users).set({ ssoSubject: outsiderSubject }).where(eq(users.id, outsiderId));
    try {
      const inbox = await portalInbox(outsiderSubject);
      assert.deepEqual(inbox.items, [], "결재선에 없는 사람에게 기타건 결재를 내줬다");
      assert.equal(inbox.count, 0);
    } finally {
      await db.update(users).set({ ssoSubject: null }).where(eq(users.id, outsiderId));
    }
    void orderId;
  });
});

describe("🔴 종에 뜬다 — 등록이 실제로 돌았는가", () => {
  test("listMyNotifications 가 기타건 결재 대기 한 줄을 내놓는다", async () => {
    await saveDomesticRoute([stepAId]);
    const orderId = await createTestOrder();

    const before = await listMyNotifications(stepAId, "SALES");
    assert.deepEqual(
      before.filter((item) => item.kind === "DOMESTIC_ORDER_APPROVAL_PENDING"),
      [],
      "올리기 전에 이미 종에 줄이 있다"
    );

    await request(orderId);

    const mine = (await listMyNotifications(stepAId, "SALES")).filter(
      (item) => item.kind === "DOMESTIC_ORDER_APPROVAL_PENDING"
    );
    assert.equal(mine.length, 1, "🔴 레지스트리에 등록은 됐는데 종에 한 줄도 안 떴다");
    // 🔴 **2026-11-08 에 열쇠에 회차가 붙었다.** 전에는 `…:{줄 id}` 였다 — 그때는 한
    //    기타건에 열린 요청이 언제나 하나였기 때문이다. 사용자 결정 12 로 회차마다
    //    요청이 서게 되면서, 열쇠가 그대로였다면 **같은 줄의 두 알림이 종에서 하나로
    //    뭉개진다**(React 의 key 가 겹친다).
    assert.equal(mine[0].id, `DOMESTIC_ORDER_APPROVAL_PENDING:${orderId}:1`);
    // 🔵 **targetKey 는 그대로 줄 id 다** — 그 값을 세는 자리는 「처리할 건이 몇인가」를
    //    말한다(domain/notifications.ts 의 countNotificationTargets 머리말).
    assert.equal(mine[0].targetKey, orderId);
    assert.equal(mine[0].subject, "알림시험 품명");
    assert.equal(mine[0].href, `/domestic-orders/${orderId}/approval`);
  });
});

describe("🔴 결과가 요청자 종에 뜬다 — 대기 쪽을 고쳐도 여기는 안 열린다", () => {
  test("최종 승인되면 **요청자**에게 「승인 완료」가 간다", async () => {
    await saveDomesticRoute([stepAId]);
    const orderId = await createTestOrder();
    await request(orderId);

    // 🔵 결정 전에는 0건 — 아래 1건이 정말 이 결정 때문인지 가른다.
    const before = await listMyGrantedApprovalOutcomes(requesterId);
    assert.deepEqual(
      before.filter((one) => one.source === "DOMESTIC_ORDER"),
      []
    );

    const decided = await decideDomesticOrderApproval({
      domesticOrderId: orderId,
      decision: "APPROVED",
      actorUserId: stepAId,
      decisionReason: null,
      dueDateRowOrder: 1,
    });
    assert.equal(decided.ok, true, JSON.stringify(decided));

    const granted = (await listMyGrantedApprovalOutcomes(requesterId)).filter(
      (one) => one.source === "DOMESTIC_ORDER"
    );
    assert.equal(granted.length, 1, "🔴 기타건 승인 결과가 요청자 종에 안 떴다");
    assert.equal(granted[0].source === "DOMESTIC_ORDER" && granted[0].domesticOrderId, orderId);
    assert.equal(granted[0].decidedByName, "기타건알림시험 1단계");

    // 🔴 남에게는 안 간다 — 결정한 사람에게도, 결재선 밖 사람에게도.
    for (const userId of [stepAId, outsiderId]) {
      const theirs = (await listMyGrantedApprovalOutcomes(userId)).filter(
        (one) => one.source === "DOMESTIC_ORDER"
      );
      assert.deepEqual(theirs, [], `${userId}: 남의 결재 결과가 떴다`);
    }

    // 종까지 실제로 이어지는가 — 빌더가 붙여 내는 한 줄로 잰다.
    const bell = (await listMyNotifications(requesterId, "SALES")).filter(
      (item) => item.kind === "APPROVAL_GRANTED" && item.href.includes(orderId)
    );
    assert.equal(bell.length, 1);
    assert.equal(bell[0].href, `/domestic-orders/${orderId}/approval`);
    assert.match(bell[0].id, /^APPROVAL_GRANTED:doa:/);
  });

  test("중간 단계 승인은 「승인 완료」가 아니다 — 다음 단계 행이 더 늦다", async () => {
    await saveDomesticRoute([stepAId, stepBId]);
    const orderId = await createTestOrder();
    await request(orderId);

    const decided = await decideDomesticOrderApproval({
      domesticOrderId: orderId,
      decision: "APPROVED",
      actorUserId: stepAId,
      decisionReason: null,
      dueDateRowOrder: 1,
    });
    assert.equal(decided.ok, true, JSON.stringify(decided));
    assert.ok(decided.ok && decided.nextApprovalId, "다음 단계 행이 안 생겼다 — 표본이 틀렸다");

    const granted = (await listMyGrantedApprovalOutcomes(requesterId)).filter(
      (one) => one.source === "DOMESTIC_ORDER"
    );
    assert.deepEqual(granted, [], "중간 단계 승인이 「승인 완료」로 떴다");
  });

  test("반려되면 **요청자**에게 「반려됨」이 가고 사유가 실린다", async () => {
    await saveDomesticRoute([stepAId, stepBId]);
    const orderId = await createTestOrder();
    await request(orderId);

    const decided = await decideDomesticOrderApproval({
      domesticOrderId: orderId,
      decision: "REJECTED",
      actorUserId: stepAId,
      decisionReason: "금액 확인 필요",
      dueDateRowOrder: 1,
    });
    assert.equal(decided.ok, true, JSON.stringify(decided));

    const rejected = (await listMyRejectedApprovalOutcomes(requesterId)).filter(
      (one) => one.source === "DOMESTIC_ORDER"
    );
    assert.equal(rejected.length, 1, "🔴 기타건 반려 결과가 요청자 종에 안 떴다");
    assert.equal(rejected[0].decisionReason, "금액 확인 필요");

    const bell = (await listMyNotifications(requesterId, "SALES")).filter(
      (item) => item.kind === "APPROVAL_REJECTED" && item.href.includes(orderId)
    );
    assert.equal(bell.length, 1);
    assert.equal(bell[0].href, `/domestic-orders/${orderId}/approval`);
    assert.match(bell[0].detail, /사유: 금액 확인 필요/);
  });

  test("🔴 휴지통에 간 줄의 결과는 안 뜬다 — 누르면 갈 화면이 없다", async () => {
    await saveDomesticRoute([stepAId]);
    const orderId = await createTestOrder();
    await request(orderId);
    const decided = await decideDomesticOrderApproval({
      domesticOrderId: orderId,
      decision: "APPROVED",
      actorUserId: stepAId,
      decisionReason: null,
      dueDateRowOrder: 1,
    });
    assert.equal(decided.ok, true, JSON.stringify(decided));
    // 🔵 지우기 전에는 떠 있다.
    assert.equal(
      (await listMyGrantedApprovalOutcomes(requesterId)).filter(
        (one) => one.source === "DOMESTIC_ORDER"
      ).length,
      1
    );

    await trashTestOrder(orderId);

    assert.deepEqual(
      (await listMyGrantedApprovalOutcomes(requesterId)).filter(
        (one) => one.source === "DOMESTIC_ORDER"
      ),
      []
    );
  });
});
