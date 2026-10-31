import "../../../../scripts/load-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asc, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  auditLogs,
  quoteApprovals,
  quotes,
  shipmentApprovalRouteSteps,
  shipmentApprovalRoutes,
  users,
} from "../schema";
import { createQuote, updateQuote } from "./quotes";
import { decideQuoteApproval, requestQuoteApproval } from "./quote-approvals";
import { saveShipmentApprovalRoute } from "./shipment-approval-routes";
import { getQuoteApprovalProgress } from "../queries/quote-approvals";
import { getCurrentShipmentApprovalRoute } from "../queries/shipment-approval-routes";
import {
  QUOTE_APPROVAL_AUTO_REJECT_REASON,
  QUOTE_APPROVAL_ROUTE_SCOPE,
} from "@/lib/domain/quote-approval-rules";
import type { QuoteFields } from "@/lib/validation/quote-input";

/**
 * ============================================================================
 * 견적서를 고쳐 저장하면 결재가 **자동으로 반려**된다 — 실제 DB (2026-10-31)
 * ============================================================================
 * 사용자 요구 둘을 값으로 잰다:
 *  · 「견적서 결재를 올린 이후에 견적서를 수정하고 저장을 누르면 … 결재건이
 *    자동으로 반려되도록 해줘.」 **이미 승인된 건도 반려한다.**
 *  · 「안 바뀐 저장은 반려하지 않는다」 — 그때는 **판 번호도 올리지 않는다.**
 *
 * 여기서 못 박는 것 여덟:
 *  1. 🔴 **안 바뀐 저장은 판 번호를 올리지 않는다.** 올리면 승인 건이 그 순간
 *     APPROVED_OUTDATED 로 뒤집혀 **반려한 것과 같은 효과**가 난다 — 그러면
 *     「반려하지 않는다」는 결정이 아무 뜻도 없어진다.
 *  2. 안 바뀐 저장은 **결재를 한 글자도 건드리지 않는다**(대기 중 그대로).
 *  3. 🔴 대기 중(REQUESTED) 결재는 **그 줄이** 반려로 닫힌다 — 반려자는
 *     **고친 사람**, 사유는 자동 반려 글자.
 *  4. 🔴 **이미 승인된 건도 반려된다.** 그리고 🔴 **그 승인 줄은 고쳐지지
 *     않는다** — 누가 승인했는지가 그 줄에만 적혀 있다(표는 append 계열).
 *  5. 이미 반려된 장을 고치면 아무 일도 없다(반려를 또 반려할 것은 없다).
 *  6. 결재를 올린 적 없는 장을 고치면 아무 일도 없다.
 *  7. 🔴 **품목만 바꿔도 「바뀜」이다** — 칸만 견주면 금액이 바뀌어도 「안 바뀜」이
 *     되고, 그때 승인이 조용히 살아남는다.
 *  8. 🔴 **금액의 소수 자리 차이는 「바뀜」이 아니다** — DB 는 `"1000.00"`,
 *     화면은 `"1000"` 을 보낸다. 글자로 견주면 손대지 않은 저장이 늘 결재를
 *     무른다.
 *
 * ── 격리·청소 규약 ──────────────────────────────────────────────────────
 * quote-approvals.integration.test.ts 를 그대로 본떴다. 이 파일이 만든
 * "quoteautoreject-test-" 계정과 "QAR-TEST-{토큰}-" 견적서만 쓴다.
 * ⚠️ **판·단계는 afterEach 로 반드시 걷는다** — 시험 DB 에 판이 남으면 다른 시험
 * 파일이 갑자기 결재선을 타면서 깨진다. 삭제에는 순서가 있다(사람 참조가
 * RESTRICT 다): 결재 행 → 견적서 → 단계 → 판 → 감사 기록 → 사람.
 * ============================================================================
 */

const RUN = randomUUID().slice(0, 8);
const TEST_EMAIL_PREFIX = "quoteautoreject-test-";
const TEST_QUOTE_NUMBER_PREFIX = `QAR-TEST-${RUN}-`;
const TEST_QUOTE_DATE = "2097-04-11";

/** 견적서를 고치고 결재를 올리는 사람. 자동 반려의 「반려자」가 될 사람이다. */
let requesterId: string;
/** 결재선 1단계 — 승인·반려를 누르는 사람. */
let approverId: string;
/** 판을 저장하는 사람. */
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

function quoteFields(quoteNumber: string, overrides: Partial<QuoteFields> = {}): QuoteFields {
  return {
    quoteNumber,
    kind: "DOMESTIC",
    quoteDate: TEST_QUOTE_DATE,
    repairCaseId: null,
    intakeNumberText: null,
    customerId: null,
    customerNameText: "자동반려시험 공급처",
    modelNameText: null,
    lotNumberText: null,
    serialNumberText: null,
    faultDescriptionText: null,
    subject: "자동 반려 시험 견적",
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
    items: [{ partId: null, isOverhaulPart: false, partNameText: "냉각 팬", quantity: 2, unitPrice: "1000" }],
    ...overrides,
  };
}

type TestQuote = { id: string; version: number; fields: QuoteFields };

async function createTestQuote(overrides: Partial<QuoteFields> = {}): Promise<TestQuote> {
  const fields = quoteFields(`${TEST_QUOTE_NUMBER_PREFIX}${randomUUID().slice(0, 8)}`, overrides);
  const created = await createQuote({ fields, actorUserId: requesterId });
  assert.equal(created.ok, true, `setup quote create failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  assert.equal(created.outcome, "SAVED", "새 장은 언제나 SAVED 다");
  createdQuoteIds.push(created.id);
  return { id: created.id, version: created.version, fields };
}

/** 그 장의 결재 행들 — 오래된 것부터. */
async function approvalRows(quoteId: string) {
  return db
    .select()
    .from(quoteApprovals)
    .where(eq(quoteApprovals.quoteId, quoteId))
    .orderBy(asc(quoteApprovals.requestedAt));
}

/** 지금 DB 에 들어 있는 판 번호 — 값으로 재야 「안 올랐다」가 증명된다. */
async function storedVersion(quoteId: string): Promise<number> {
  const [row] = await db.select({ version: quotes.version }).from(quotes).where(eq(quotes.id, quoteId));
  return row.version;
}

async function saveQuoteRoute(approverUserIds: string[]): Promise<void> {
  const result = await saveShipmentApprovalRoute(
    approverUserIds,
    superAdminId,
    QUOTE_APPROVAL_ROUTE_SCOPE
  );
  assert.equal(result.ok, true, `setup route save failed: ${JSON.stringify(result)}`);
}

/** 그 장에 결재를 올린다 — 1단계 요청 한 줄이 생긴다. */
async function requestApproval(quoteId: string): Promise<void> {
  const requested = await requestQuoteApproval({
    quoteId,
    actorUserId: requesterId,
    requestReason: "금액 확인 부탁드립니다",
  });
  assert.equal(requested.ok, true, `setup approval request failed: ${JSON.stringify(requested)}`);
}

/** 1단계를 승인한다 — 단계가 하나뿐이라 그것으로 사슬이 끝난다. */
async function approve(quoteId: string): Promise<void> {
  const decided = await decideQuoteApproval({
    quoteId,
    decision: "APPROVED",
    actorUserId: approverId,
    decisionReason: null,
  });
  assert.equal(decided.ok, true, `setup approve failed: ${JSON.stringify(decided)}`);
}

/** 내용을 **정말로** 바꾸는 저장. */
async function saveChanged(quote: TestQuote, overrides: Partial<QuoteFields>) {
  const fields = { ...quote.fields, ...overrides };
  const updated = await updateQuote({
    id: quote.id,
    expectedVersion: quote.version,
    fields,
    actorUserId: requesterId,
  });
  if (updated.ok) {
    quote.fields = fields;
    quote.version = updated.version;
  }
  return updated;
}

/** **똑같은 값**을 다시 보내는 저장. */
async function saveUnchanged(quote: TestQuote, fields: QuoteFields = quote.fields) {
  return updateQuote({
    id: quote.id,
    expectedVersion: quote.version,
    fields,
    actorUserId: requesterId,
  });
}

async function removeFixtures(): Promise<void> {
  if (createdTestUserIds.length > 0) {
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
  await db.delete(shipmentApprovalRouteSteps).where(inArray(shipmentApprovalRouteSteps.approverUserId, ids));
  await db.delete(shipmentApprovalRoutes).where(inArray(shipmentApprovalRoutes.createdByUserId, ids));
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

  requesterId = await createTestUser("자동반려시험 요청자");
  approverId = await createTestUser("자동반려시험 결재자");
  superAdminId = await createTestUser("자동반려시험 최고관리자", { role: "SUPER_ADMIN" });
});

afterEach(async () => {
  // ⚠️ 판이 남으면 다른 시험 파일이 갑자기 결재선을 타면서 깨진다.
  await removeFixtures();
});

after(async () => {
  await removeFixtures();
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

// ══════════════════════════════════════════ 안 바뀐 저장

describe("🔴 안 바뀐 저장", () => {
  test("🔴 판 번호가 **그대로**다 — 올리면 승인이 「승인 후 변경됨」으로 뒤집힌다", async () => {
    const quote = await createTestQuote();
    const before = await storedVersion(quote.id);
    assert.equal(before, 1, "🔵 무엇을 재는지 — 새 장은 1판이다");

    const saved = await saveUnchanged(quote);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    if (!saved.ok) return;
    assert.equal(saved.outcome, "UNCHANGED");
    assert.equal(saved.version, before, "돌려준 판 번호가 올랐다");
    assert.equal(await storedVersion(quote.id), before, "🔴 DB 의 판 번호가 올랐다");
  });

  test("🔴 승인된 건이 「승인 완료」 그대로 남는다 — 반려와 같은 효과가 나면 안 된다", async () => {
    await saveQuoteRoute([approverId]);
    const quote = await createTestQuote();
    await requestApproval(quote.id);
    await approve(quote.id);
    assert.equal((await getQuoteApprovalProgress(quote.id))?.state, "APPROVED", "🔵 승인 상태를 못 만들었다");

    const saved = await saveUnchanged(quote);
    assert.equal(saved.ok === true && saved.outcome, "UNCHANGED");
    assert.equal(
      (await getQuoteApprovalProgress(quote.id))?.state,
      "APPROVED",
      "🔴 안 바뀐 저장이 승인을 무효로 만들었다"
    );
  });

  test("대기 중 결재를 한 글자도 건드리지 않는다", async () => {
    await saveQuoteRoute([approverId]);
    const quote = await createTestQuote();
    await requestApproval(quote.id);

    const saved = await saveUnchanged(quote);
    assert.equal(saved.ok === true && saved.outcome, "UNCHANGED");

    const rows = await approvalRows(quote.id);
    assert.equal(rows.length, 1, "줄이 늘었다");
    assert.equal(rows[0].status, "REQUESTED");
    assert.equal(rows[0].decidedByUserId, null);
    assert.equal(rows[0].decidedAt, null);
    assert.equal(rows[0].decisionReason, null);
  });

  test("🔴 금액의 소수 자리만 다른 저장도 「안 바뀜」이다 — DB 는 `1000.00`, 화면은 `1000`", async () => {
    const quote = await createTestQuote({ workCost: "350000" });
    // 🔵 무엇을 재는지 — DB 에는 소수 두 자리로 들어가 있다.
    const [stored] = await db.select({ workCost: quotes.workCost }).from(quotes).where(eq(quotes.id, quote.id));
    assert.equal(stored.workCost, "350000.00");

    const saved = await saveUnchanged(quote, { ...quote.fields, workCost: "350000" });
    assert.equal(saved.ok === true && saved.outcome, "UNCHANGED", "글자로 견주고 있다");
    assert.equal(await storedVersion(quote.id), 1);
  });
});

// ══════════════════════════════════════════ 바뀐 저장 — 자동 반려

describe("🔴 바뀐 저장 — 대기 중 결재", () => {
  test("그 줄이 반려로 닫히고, 반려자는 **고친 사람**이다", async () => {
    await saveQuoteRoute([approverId]);
    const quote = await createTestQuote();
    await requestApproval(quote.id);
    const [requested] = await approvalRows(quote.id);
    assert.equal(requested.status, "REQUESTED", "🔵 대기 상태를 못 만들었다");

    const saved = await saveChanged(quote, { subject: "고친 품명" });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    if (!saved.ok) return;
    assert.equal(saved.outcome, "APPROVAL_AUTO_REJECTED");
    assert.equal(saved.version, 2, "바뀐 저장은 판 번호를 올린다");

    const rows = await approvalRows(quote.id);
    assert.equal(rows.length, 1, "🔴 대기 중이던 줄은 **고쳐 쓴다** — 줄이 늘면 안 된다");
    assert.equal(rows[0].id, requested.id);
    assert.equal(rows[0].status, "REJECTED");
    assert.equal(rows[0].decidedByUserId, requesterId, "🔴 반려자는 고친 사람이다");
    assert.ok(rows[0].decidedAt !== null, "결정 시각이 비어 있다");
    assert.equal(rows[0].decisionReason, QUOTE_APPROVAL_AUTO_REJECT_REASON);
    assert.equal(rows[0].delegatedFromUserId, null, "자동 반려는 위임이 아니다");
    assert.equal((await getQuoteApprovalProgress(quote.id))?.state, "REJECTED");
  });

  test("🔴 품목만 바꿔도 반려된다 — 칸만 견주면 금액이 바뀌어도 「안 바뀜」이 된다", async () => {
    await saveQuoteRoute([approverId]);
    const quote = await createTestQuote();
    await requestApproval(quote.id);

    const saved = await saveChanged(quote, {
      items: [{ partId: null, isOverhaulPart: false, partNameText: "냉각 팬", quantity: 9, unitPrice: "1000" }],
    });
    assert.equal(saved.ok === true && saved.outcome, "APPROVAL_AUTO_REJECTED", "🔴 품목 변경을 못 잡았다");
    assert.equal((await getQuoteApprovalProgress(quote.id))?.state, "REJECTED");
  });

  test("🔴 저장 자체는 **그대로 된다** — 결재가 걸려 있어도 막지 않는다(2026-09-18)", async () => {
    await saveQuoteRoute([approverId]);
    const quote = await createTestQuote();
    await requestApproval(quote.id);

    await saveChanged(quote, { subject: "막히지 않는다" });
    const [row] = await db.select({ subject: quotes.subject }).from(quotes).where(eq(quotes.id, quote.id));
    assert.equal(row.subject, "막히지 않는다");
  });
});

describe("🔴 바뀐 저장 — 이미 승인된 건", () => {
  test("🔴 승인된 건도 반려된다 — 그리고 **승인 줄은 고쳐지지 않는다**", async () => {
    await saveQuoteRoute([approverId]);
    const quote = await createTestQuote();
    await requestApproval(quote.id);
    await approve(quote.id);

    const [approved] = await approvalRows(quote.id);
    assert.equal(approved.status, "APPROVED", "🔵 승인 상태를 못 만들었다");
    assert.equal(approved.decidedByUserId, approverId);
    const approvedAt = approved.decidedAt;

    const saved = await saveChanged(quote, { subject: "승인 뒤 고침" });
    assert.equal(saved.ok === true && saved.outcome, "APPROVAL_AUTO_REJECTED");

    const rows = await approvalRows(quote.id);
    assert.equal(rows.length, 2, "🔴 승인 줄 곁에 반려 줄이 한 줄 더 서야 한다");

    // 🔴 승인 줄은 글자 하나 바뀌지 않는다 — 마지막 단계의 승인자가 그 줄에만 적혀 있다.
    assert.equal(rows[0].id, approved.id);
    assert.equal(rows[0].status, "APPROVED", "🔴 승인 줄을 덮어썼다 — 누가 승인했는지가 사라진다");
    assert.equal(rows[0].decidedByUserId, approverId, "🔴 승인자가 사라졌다");
    assert.deepEqual(rows[0].decidedAt, approvedAt, "🔴 승인 시각이 바뀌었다");

    // 이어 쓴 줄 — 같은 요청을 물려받고 상태만 반려다.
    assert.equal(rows[1].status, "REJECTED");
    assert.equal(rows[1].decidedByUserId, requesterId, "🔴 반려자는 고친 사람이다");
    assert.equal(rows[1].decisionReason, QUOTE_APPROVAL_AUTO_REJECT_REASON);
    assert.equal(
      rows[1].requestedByUserId,
      approved.requestedByUserId,
      "🔴 요청자를 물려받아야 「내가 올린 결재가 반려됐다」가 올린 사람에게 간다"
    );
    assert.equal(rows[1].quoteVersionAtRequest, approved.quoteVersionAtRequest, "요청 시점의 판을 물려받는다");
    assert.equal(rows[1].routeId, approved.routeId);
    assert.equal(rows[1].routeStepOrder, approved.routeStepOrder);

    assert.equal((await getQuoteApprovalProgress(quote.id))?.state, "REJECTED");
  });

  test("이어 쓴 줄은 **살아 있는 요청이 아니다** — 대기 중인 줄이 하나도 없다", async () => {
    await saveQuoteRoute([approverId]);
    const quote = await createTestQuote();
    await requestApproval(quote.id);
    await approve(quote.id);
    await saveChanged(quote, { subject: "승인 뒤 고침" });

    const rows = await approvalRows(quote.id);
    assert.equal(rows.filter((row) => row.status === "REQUESTED").length, 0);
    // 그래서 **다시 올릴 수 있다** — 살아 있는 요청이 하나라는 부분 유니크에 걸리지 않는다.
    const again = await requestQuoteApproval({
      quoteId: quote.id,
      actorUserId: requesterId,
      requestReason: null,
    });
    assert.equal(again.ok, true, `다시 올리지 못했다: ${JSON.stringify(again)}`);
  });
});

describe("건드릴 결재가 없는 장", () => {
  test("결재를 올린 적 없는 장은 그냥 저장된다", async () => {
    const quote = await createTestQuote();
    const saved = await saveChanged(quote, { subject: "그냥 고침" });
    assert.equal(saved.ok === true && saved.outcome, "SAVED");
    assert.equal((await approvalRows(quote.id)).length, 0);
  });

  test("이미 반려된 장을 고쳐도 줄이 늘지 않는다 — 반려를 또 반려할 것은 없다", async () => {
    await saveQuoteRoute([approverId]);
    const quote = await createTestQuote();
    await requestApproval(quote.id);
    const rejected = await decideQuoteApproval({
      quoteId: quote.id,
      decision: "REJECTED",
      actorUserId: approverId,
      decisionReason: "사람이 적은 사유",
    });
    assert.equal(rejected.ok, true, `setup reject failed: ${JSON.stringify(rejected)}`);

    const saved = await saveChanged(quote, { subject: "반려 뒤 고침" });
    assert.equal(saved.ok === true && saved.outcome, "SAVED");

    const rows = await approvalRows(quote.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "REJECTED");
    assert.equal(
      rows[0].decisionReason,
      "사람이 적은 사유",
      "🔴 사람이 적은 사유를 자동 반려 글자가 덮어썼다"
    );
  });
});
