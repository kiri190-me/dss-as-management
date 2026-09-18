import "../../../../scripts/load-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asc, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  auditLogs,
  notificationAcknowledgements,
  quoteApprovals,
  quotes,
  shipmentApprovalRouteSteps,
  shipmentApprovalRoutes,
  users,
} from "../schema";
import { createQuote, updateQuote } from "../mutations/quotes";
import { decideQuoteApproval, requestQuoteApproval } from "../mutations/quote-approvals";
import { softDeleteQuote } from "../mutations/quote-trash";
import { saveShipmentApprovalRoute } from "../mutations/shipment-approval-routes";
import { getCurrentShipmentApprovalRoute } from "./shipment-approval-routes";
import { listQuoteApprovalsPendingMyApproval } from "./quote-approvals-pending";
import {
  listMyGrantedApprovalOutcomes,
  listMyRejectedApprovalOutcomes,
  type ApprovalOutcome,
} from "./approval-outcome-notifications";
import { listMyNotifications } from "./notifications";
import { QUOTE_APPROVAL_ROUTE_SCOPE } from "@/lib/domain/quote-approval-rules";
import type { NotificationItem, NotificationKind } from "@/lib/domain/notifications";
import type { Role } from "@/lib/domain/types";
import type { QuoteFields } from "@/lib/validation/quote-input";

/**
 * ============================================================================
 * 견적서 결재 알림 — 실제 DB (시험 DB)
 * ============================================================================
 * 종 알림 세 줄을 본다:
 *  · 「견적서 결재 대기」(queries/quote-approvals-pending.ts)
 *  · 「승인 완료」·「반려됨」의 견적서 갈래(queries/approval-outcome-notifications.ts)
 * 그리고 셋 다 레지스트리(listMyNotifications)에 실려 실제로 종에 나오는지까지.
 *
 * 결재 사슬은 **진짜 mutation 으로** 만든다(requestQuoteApproval · decideQuoteApproval)
 * — 「중간 단계 승인이면 다음 단계 행이 더 늦게 생긴다」는 사슬의 모양이 「최종 승인」
 * 판정의 전제라서, 손으로 흉내 낸 행이 아니라 사슬 잇는 코드가 만든 행으로 봐야 뜻이
 * 있다(approval-outcome-notifications.integration.test.ts 와 같은 규약).
 *
 * 이 파일이 못 박는 것:
 *  1. 🔴 **지정된 결재자에게만** 뜬다 — 다음 단계 승인자에게도, 제삼자에게도 없다.
 *  2. 🔴 최고관리자에게는 **비상구로** 뜬다 — 기존 결재 알림 둘과 같은 함수, 같은 답.
 *  3. 🔴 **처리된 건은 안 뜬다** — 승인하면 다음 단계로 넘어가고, 반려하면 사라진다.
 *  4. 🔴 **한 요청에 알림 하나** — 단계가 나아가도 한 장에 한 줄이다.
 *  5. 휴지통에 간 견적서의 결재는 뜨지 않는다(누르면 갈 화면이 없다).
 *  6. 🔴 결과 알림은 **요청자에게만**, **마지막 단계 승인**에만. 반려는 어느 단계에서든.
 *  7. 🔴 결정자가 요청자 본인이면(최고관리자 비상구) 알리지 않는다.
 *  8. 🔴 승인 뒤 견적서를 고쳐도(APPROVED_OUTDATED) 이미 난 승인 **사건**은 그대로다 —
 *     고칠 때마다 종에 줄이 서지 않는다.
 *
 * ── 격리·청소 규약 ──────────────────────────────────────────────────────
 * mutations/quote-approvals.integration.test.ts 를 그대로 본떴다. 이 파일이 만든
 * "quotenotify-test-" 계정과 "QN-TEST-{토큰}-" 견적서만 쓰고,
 * ⚠️ **판·단계는 afterEach 로 반드시 걷는다** — 시험 DB 에 판이 남으면 다른 시험
 * 파일이 갑자기 결재선을 타면서 깨진다. 사람 참조가 RESTRICT 라 삭제에는 순서가
 * 있다: 결재 행 → 견적서 → 단계 → 판 → 확인 기록 → 감사 기록 → 사람.
 * ============================================================================
 */

const RUN = randomUUID().slice(0, 8);
const TEST_EMAIL_PREFIX = "quotenotify-test-";
const TEST_QUOTE_NUMBER_PREFIX = `QN-TEST-${RUN}-`;
const TEST_QUOTE_DATE = "2096-04-10";

/** 견적서를 고칠 수 있는 역할(quotes WRITE 기본값)이다 — 요청을 올린다. */
let requesterId: string;
let stepAId: string;
let stepBId: string;
/** 자격은 있는데 결재선에는 없는 사람 — 지정 관문에 막혀야 한다. */
let outsiderId: string;
/** 판을 저장하는 사람 + 「언제나 처리할 수 있는」 비상구. */
let superAdminId: string;

const createdTestUserIds: string[] = [];
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

/** 필수 칸만 채운 한 장. 견적서는 수리 건·고객사가 없어도 만들 수 있다. */
function quoteFields(overrides: Partial<QuoteFields> = {}): QuoteFields {
  return {
    quoteNumber: `${TEST_QUOTE_NUMBER_PREFIX}${randomUUID().slice(0, 8)}`,
    kind: "DOMESTIC",
    quoteDate: TEST_QUOTE_DATE,
    repairCaseId: null,
    intakeNumberText: null,
    customerId: null,
    customerNameText: "알림시험 공급처",
    modelNameText: null,
    lotNumberText: null,
    serialNumberText: null,
    faultDescriptionText: null,
    subject: "알림 시험 견적",
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
    ...overrides,
  };
}

type TestQuote = { id: string; quoteNumber: string; version: number; fields: QuoteFields };

async function createTestQuote(actorUserId: string = requesterId): Promise<TestQuote> {
  const fields = quoteFields();
  const created = await createQuote({ fields, actorUserId });
  assert.equal(created.ok, true, `setup quote create failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  createdQuoteIds.push(created.id);
  return { id: created.id, quoteNumber: fields.quoteNumber, version: created.version, fields };
}

/** 그 장을 한 번 고쳐 판 번호를 올린다 — 「내용이 바뀌었다」를 만드는 유일한 길. */
async function bumpQuoteVersion(quote: TestQuote): Promise<number> {
  const fields = { ...quote.fields, subject: `고침 ${randomUUID().slice(0, 4)}` };
  const updated = await updateQuote({
    id: quote.id,
    expectedVersion: quote.version,
    fields,
    actorUserId: requesterId,
  });
  assert.equal(updated.ok, true, `setup quote update failed: ${JSON.stringify(updated)}`);
  if (!updated.ok) throw new Error("unreachable");
  quote.fields = fields;
  quote.version = updated.version;
  return updated.version;
}

async function saveQuoteRoute(approverUserIds: string[]): Promise<void> {
  const result = await saveShipmentApprovalRoute(
    approverUserIds,
    superAdminId,
    QUOTE_APPROVAL_ROUTE_SCOPE
  );
  assert.equal(result.ok, true, `setup route save failed: ${JSON.stringify(result)}`);
}

async function request(quote: TestQuote, actorUserId: string = requesterId): Promise<void> {
  const requested = await requestQuoteApproval({
    quoteId: quote.id,
    actorUserId,
    requestReason: "검토 부탁드립니다",
  });
  assert.equal(requested.ok, true, `요청이 막혔다: ${JSON.stringify(requested)}`);
}

async function decide(
  quote: TestQuote,
  actorUserId: string,
  decision: "APPROVED" | "REJECTED",
  decisionReason: string | null = null
): Promise<void> {
  const decided = await decideQuoteApproval({
    quoteId: quote.id,
    decision,
    actorUserId,
    decisionReason,
  });
  assert.equal(decided.ok, true, `결재가 막혔다: ${JSON.stringify(decided)}`);
}

/** 이 사람의 종 알림 중 그 종류만 — 시험 DB 에 남의 알림이 섞여 있어도 흔들리지 않게. */
async function bellItems(
  actorUserId: string,
  role: Role,
  kind: NotificationKind
): Promise<NotificationItem[]> {
  const items = await listMyNotifications(actorUserId, role);
  return items.filter((item) => item.kind === kind);
}

type QuoteOutcome = Extract<ApprovalOutcome, { source: "QUOTE" }>;

/**
 * 결과 목록에서 **이 파일이 만든 견적서의 것만** 골라 낸다. 시험 DB 는 파일마다
 * 공유되므로, 접수 건·불출의 결과가 섞여 있어도 흔들리지 않게 갈래와 발행번호로
 * 두 번 가린다.
 */
function ofThisRun(rows: readonly ApprovalOutcome[]): QuoteOutcome[] {
  return rows.flatMap((row) =>
    row.source === "QUOTE" && row.quoteNumber.startsWith(TEST_QUOTE_NUMBER_PREFIX) ? [row] : []
  );
}

async function removeFixtures(): Promise<void> {
  if (createdTestUserIds.length > 0) {
    // 결재 행이 먼저다 — 판을 RESTRICT 로 참조한다. 견적서가 완전 삭제되면
    // quote_id 가 NULL 로 풀리므로 **요청자**로도 한 번 더 고른다.
    await db
      .delete(quoteApprovals)
      .where(inArray(quoteApprovals.requestedByUserId, createdTestUserIds));
  }
  if (createdQuoteIds.length > 0) {
    await db.delete(quoteApprovals).where(inArray(quoteApprovals.quoteId, createdQuoteIds));
    await db.delete(quotes).where(inArray(quotes.id, createdQuoteIds));
    createdQuoteIds.length = 0;
  }
  if (createdTestUserIds.length > 0) {
    await db
      .delete(shipmentApprovalRouteSteps)
      .where(inArray(shipmentApprovalRouteSteps.approverUserId, createdTestUserIds));
    await db
      .delete(shipmentApprovalRoutes)
      .where(inArray(shipmentApprovalRoutes.createdByUserId, createdTestUserIds));
    await db
      .delete(notificationAcknowledgements)
      .where(inArray(notificationAcknowledgements.userId, createdTestUserIds));
    // audit_logs.actor_user_id → users (restrict): 행위자로만 고른다 —
    // target_record_id 로 고르는 모양은 test-cleanup-static-safety.test.ts 가 금지한다.
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

  await db.delete(quoteApprovals).where(inArray(quoteApprovals.requestedByUserId, ids));
  await db.delete(quotes).where(inArray(quotes.createdBy, ids));
  await db
    .delete(shipmentApprovalRouteSteps)
    .where(inArray(shipmentApprovalRouteSteps.approverUserId, ids));
  await db.delete(shipmentApprovalRoutes).where(inArray(shipmentApprovalRoutes.createdByUserId, ids));
  await db.delete(notificationAcknowledgements).where(inArray(notificationAcknowledgements.userId, ids));
  await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, ids));
  await db.delete(users).where(inArray(users.id, ids));
}

before(async () => {
  await removeLeftovers();

  assert.equal(
    await getCurrentShipmentApprovalRoute(QUOTE_APPROVAL_ROUTE_SCOPE),
    null,
    "이 시험은 견적서 승인 절차가 하나도 없는 상태를 전제로 합니다"
  );

  requesterId = await createTestUser("견적알림시험 요청자");
  stepAId = await createTestUser("견적알림시험 1단계");
  stepBId = await createTestUser("견적알림시험 2단계");
  outsiderId = await createTestUser("견적알림시험 제삼자");
  superAdminId = await createTestUser("견적알림시험 최고관리자", { role: "SUPER_ADMIN" });
});

afterEach(async () => {
  await removeFixtures();
});

after(async () => {
  await removeFixtures();
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

describe("견적서 결재 대기 — 지금 내 차례인 것만", () => {
  test("🔴 지정된 1단계 승인자에게만 뜬다 — 다음 단계도, 제삼자도, 요청자도 못 본다", async () => {
    await saveQuoteRoute([stepAId, stepBId]);
    const quote = await createTestQuote();
    await request(quote);

    const mine = await listQuoteApprovalsPendingMyApproval(stepAId);
    assert.equal(mine.length, 1, "지정된 사람에게 안 뜬다 — 이 실패는 화면에 아무 표시도 남기지 않는다");
    assert.equal(mine[0].quoteId, quote.id);
    assert.equal(mine[0].quoteNumber, quote.quoteNumber);
    assert.equal(mine[0].routeStepOrder, 1);
    assert.equal(mine[0].requestedByUserId, requesterId);
    assert.equal(mine[0].requestedByName, "견적알림시험 요청자");

    assert.deepEqual(await listQuoteApprovalsPendingMyApproval(stepBId), [], "아직 2단계 차례가 아니다");
    assert.deepEqual(await listQuoteApprovalsPendingMyApproval(outsiderId), [], "제삼자에게 샜다");
    assert.deepEqual(await listQuoteApprovalsPendingMyApproval(requesterId), [], "요청자에게 샜다");
  });

  test("🔴 최고관리자에게는 비상구로 뜬다 — 기존 결재 알림 둘과 같은 판정이다", async () => {
    // 지정된 사람이 자리를 비워 영영 막히는 것을 막는 유일한 길이다
    // (auth/approval-assignment.ts). 여기서만 닫으면 견적서 결재만 풀 사람이 없어진다.
    await saveQuoteRoute([stepAId]);
    const quote = await createTestQuote();
    await request(quote);

    const asSuperAdmin = await listQuoteApprovalsPendingMyApproval(superAdminId);
    assert.equal(asSuperAdmin.length, 1);
    assert.equal(asSuperAdmin[0].quoteId, quote.id);
  });

  test("🔴 처리하면 사라진다 — 승인은 다음 단계로 넘어가고, 그때도 한 장에 한 줄이다", async () => {
    await saveQuoteRoute([stepAId, stepBId]);
    const quote = await createTestQuote();
    await request(quote);
    await decide(quote, stepAId, "APPROVED");

    assert.deepEqual(await listQuoteApprovalsPendingMyApproval(stepAId), [], "처리한 사람에게 남아 있다");

    const next = await listQuoteApprovalsPendingMyApproval(stepBId);
    assert.equal(next.length, 1, "다음 단계 승인자에게 넘어가지 않았다");
    assert.equal(next[0].routeStepOrder, 2);

    // 🔴 알림이 불어나지 않는다 — 결재 행은 둘이지만 열린 행은 하나뿐이다.
    const rows = await db
      .select({ status: quoteApprovals.status })
      .from(quoteApprovals)
      .where(eq(quoteApprovals.quoteId, quote.id))
      .orderBy(asc(quoteApprovals.requestedAt));
    assert.equal(rows.length, 2);
    assert.equal(rows.filter((row) => row.status === "REQUESTED").length, 1);
    assert.equal((await listQuoteApprovalsPendingMyApproval(superAdminId)).length, 1, "비상구에도 한 줄이다");
  });

  test("🔴 반려하면 아무에게도 남지 않는다 — 다시 받으려면 새 요청이다", async () => {
    await saveQuoteRoute([stepAId, stepBId]);
    const quote = await createTestQuote();
    await request(quote);
    await decide(quote, stepAId, "REJECTED", "단가 근거가 없습니다");

    for (const userId of [stepAId, stepBId, outsiderId, superAdminId, requesterId]) {
      assert.deepEqual(await listQuoteApprovalsPendingMyApproval(userId), [], `${userId} 에게 남았다`);
    }
  });

  test("휴지통에 간 견적서의 결재는 뜨지 않는다 — 눌러도 갈 화면이 없다", async () => {
    await saveQuoteRoute([stepAId]);
    const quote = await createTestQuote();
    await request(quote);
    assert.equal((await listQuoteApprovalsPendingMyApproval(stepAId)).length, 1);

    const deleted = await softDeleteQuote({
      quoteId: quote.id,
      expectedVersion: quote.version,
      actorUserId: requesterId,
      reason: null,
    });
    assert.equal(deleted.ok, true, `setup soft delete failed: ${JSON.stringify(deleted)}`);

    assert.deepEqual(await listQuoteApprovalsPendingMyApproval(stepAId), []);
    assert.deepEqual(await listQuoteApprovalsPendingMyApproval(superAdminId), []);
  });

  test("계정이 잠기거나 비활성이면 결재 알림을 받지 않는다 — 눌러도 막히는 건을 세우지 않는다", async () => {
    await saveQuoteRoute([stepAId]);
    const quote = await createTestQuote();
    await request(quote);

    await db.update(users).set({ isActive: false }).where(eq(users.id, stepAId));
    try {
      assert.deepEqual(await listQuoteApprovalsPendingMyApproval(stepAId), []);
    } finally {
      await db.update(users).set({ isActive: true }).where(eq(users.id, stepAId));
    }
    assert.equal((await listQuoteApprovalsPendingMyApproval(stepAId)).length, 1, "되돌리면 다시 보여야 한다");
  });

  test("🔴 종에 실린다 — 레지스트리를 거쳐 한 줄로, 그 견적서 화면 주소로", async () => {
    await saveQuoteRoute([stepAId]);
    const quote = await createTestQuote();
    await request(quote);

    const items = await bellItems(stepAId, "SALES", "QUOTE_APPROVAL_PENDING");
    assert.equal(items.length, 1);
    assert.equal(items[0].id, `QUOTE_APPROVAL_PENDING:${quote.id}`);
    assert.equal(items[0].subject, quote.quoteNumber);
    assert.equal(items[0].detail, "결재선 1단계 · 요청자 견적알림시험 요청자");
    assert.equal(items[0].href, `/quotes/${quote.id}`);

    assert.deepEqual(await bellItems(outsiderId, "SALES", "QUOTE_APPROVAL_PENDING"), []);
  });
});

describe("결과 알림 — 올린 사람에게", () => {
  test("🔴 마지막 단계 승인만 「승인 완료」다 — 중간 단계는 아직 결과가 아니다", async () => {
    await saveQuoteRoute([stepAId, stepBId]);
    const quote = await createTestQuote();
    await request(quote);

    await decide(quote, stepAId, "APPROVED");
    assert.deepEqual(
      ofThisRun(await listMyGrantedApprovalOutcomes(requesterId)),
      [],
      "중간 단계 승인이 결과로 샜다"
    );

    await decide(quote, stepBId, "APPROVED");
    const granted = ofThisRun(await listMyGrantedApprovalOutcomes(requesterId));
    assert.equal(granted.length, 1, "마지막 단계 승인이 요청자에게 가지 않았다");
    assert.equal(granted[0].quoteId, quote.id);
    assert.equal(granted[0].quoteNumber, quote.quoteNumber);
    assert.equal(granted[0].decidedByName, "견적알림시험 2단계");

    // 🔴 남에게는 가지 않는다 — 결재한 사람에게도, 제삼자에게도.
    for (const userId of [stepAId, stepBId, outsiderId, superAdminId]) {
      assert.deepEqual(ofThisRun(await listMyGrantedApprovalOutcomes(userId)), [], `${userId} 에게 샜다`);
    }
  });

  test("반려는 어느 단계에서든 요청자에게 간다 — 사유와 함께", async () => {
    await saveQuoteRoute([stepAId, stepBId]);
    const quote = await createTestQuote();
    await request(quote);
    await decide(quote, stepAId, "REJECTED", "단가 근거가 없습니다");

    const rejected = ofThisRun(await listMyRejectedApprovalOutcomes(requesterId));
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].quoteId, quote.id);
    assert.equal(rejected[0].decisionReason, "단가 근거가 없습니다");
    assert.deepEqual(ofThisRun(await listMyGrantedApprovalOutcomes(requesterId)), [], "반려가 승인으로 샜다");
    assert.deepEqual(ofThisRun(await listMyRejectedApprovalOutcomes(stepAId)), [], "결재한 사람에게 샜다");
  });

  test("🔴 결정자가 요청자 본인이면 알리지 않는다 — 최고관리자가 비상구로 자기 요청을 결정한 경우", async () => {
    await saveQuoteRoute([stepAId]);
    const quote = await createTestQuote(superAdminId);
    await request(quote, superAdminId);
    await decide(quote, superAdminId, "APPROVED");

    assert.deepEqual(ofThisRun(await listMyGrantedApprovalOutcomes(superAdminId)), []);
  });

  test("🔴 승인 뒤 견적서를 고쳐도 승인 사건은 그대로다 — 고칠 때마다 줄이 서지 않는다", async () => {
    // APPROVED_OUTDATED 는 **지금 상태**이고 그 장의 [견적서 결재] 탭이 말한다.
    // 결과 알림은 **일어난 사건**이라 뒤에 내용이 바뀌었다고 하나 더 생기지도,
    // 있던 것이 사라지지도 않는다.
    await saveQuoteRoute([stepAId]);
    const quote = await createTestQuote();
    await request(quote);
    await decide(quote, stepAId, "APPROVED");
    assert.equal(ofThisRun(await listMyGrantedApprovalOutcomes(requesterId)).length, 1);

    await bumpQuoteVersion(quote);

    assert.equal(
      ofThisRun(await listMyGrantedApprovalOutcomes(requesterId)).length,
      1,
      "견적서를 고쳤다고 결과 알림이 늘거나 사라졌다"
    );
    assert.deepEqual(ofThisRun(await listMyRejectedApprovalOutcomes(requesterId)), []);
    // 🔴 「다시 올려야 한다」가 결재 대기로 둔갑하지도 않는다 — 열린 요청이 없다.
    assert.deepEqual(await listQuoteApprovalsPendingMyApproval(stepAId), []);
  });

  test("🔴 종에 실린다 — 「승인 완료」 줄이 요청자에게, 그 견적서 화면 주소로", async () => {
    await saveQuoteRoute([stepAId]);
    const quote = await createTestQuote();
    await request(quote);
    await decide(quote, stepAId, "APPROVED");

    const items = (await bellItems(requesterId, "SALES", "APPROVAL_GRANTED")).filter(
      (item) => item.subject === quote.quoteNumber
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].detail, "견적서 승인 · 견적알림시험 1단계");
    assert.equal(items[0].href, `/quotes/${quote.id}`);
  });
});
