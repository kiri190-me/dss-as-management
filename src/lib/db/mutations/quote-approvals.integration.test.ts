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
import { recordQuoteExport } from "./quote-exports";
import { decideQuoteApproval, requestQuoteApproval } from "./quote-approvals";
import { saveShipmentApprovalRoute } from "./shipment-approval-routes";
import { getQuoteApprovalHistory, getQuoteApprovalProgress } from "../queries/quote-approvals";
import { getQuoteForEdit } from "../queries/quotes";
import { getCurrentShipmentApprovalRoute } from "../queries/shipment-approval-routes";
import { QUOTE_APPROVAL_ROUTE_SCOPE } from "@/lib/domain/quote-approval-rules";
import type { QuoteFields } from "@/lib/validation/quote-input";

/**
 * ============================================================================
 * 견적서 결재 — 실제 DB (시험 DB)
 * ============================================================================
 * 여기서 못 박는 것 여덟:
 *  1. 🔴 **요청하면 그 시점의 `quotes.version` 이 실린다** — 이 칸 하나에
 *     「승인 뒤 내용이 바뀌면 그 승인은 무효」가 걸려 있다.
 *  2. 🔴 **승인 뒤 견적서를 고치면 그 승인이 「지금 내용에 대한 것」이 아니게
 *     된다**(APPROVED → APPROVED_OUTDATED).
 *  3. 결재선의 단계를 **순서대로** 밟고 마지막 단계에서 끝난다. 단계마다 행이
 *     하나씩이고 이어진 행은 요청자·사유·판 번호를 물려받는다.
 *  4. 반려에는 **사유가 필수**이고, 반려 뒤에는 **새 요청**을 올릴 수 있다.
 *  5. 🔴 **한 견적서에 살아 있는 요청은 하나다**(부분 유니크 색인).
 *  6. 지정된 사람이 아니면 결재할 수 없다 — 단, **최고관리자 비상구**는 열려
 *     있다(auth/approval-assignment.ts 의 규칙 그대로).
 *  7. 🔴 **결재선이 없거나 단계가 0개면 요청 자체를 거절한다**(그때는 결재 없이
 *     발행하고 승인 기록도 남지 않는다 — 용도의 빈 상태 문장이 그렇게 말한다).
 *  8. 🔴 **발행을 막지 않는다** — 결재가 없거나 반려됐어도 발행 통로가 읽고
 *     기록하는 두 지점이 그대로 열려 있다.
 *
 * ── 격리·청소 규약 ──────────────────────────────────────────────────────
 * repair-case-approvals-route.integration.test.ts 를 그대로 본떴다. 이 파일이
 * 만든 "quoteapproval-test-" 계정과 "QA-TEST-{토큰}-" 견적서만 쓰고,
 * ⚠️ **판·단계는 afterEach 로 반드시 걷는다** — 시험 DB 에 판이 남으면 다른 시험
 * 파일이 갑자기 결재선을 타면서 깨진다(그쪽 파일은 판이 하나도 없는 것을 전제로
 * 한다). 사람 참조가 RESTRICT 라 삭제에는 순서가 있다: 결재 행 → 견적서 →
 * 단계 → 판 → 감사 기록 → 사람.
 * ============================================================================
 */

const RUN = randomUUID().slice(0, 8);
const TEST_EMAIL_PREFIX = "quoteapproval-test-";
const TEST_QUOTE_NUMBER_PREFIX = `QA-TEST-${RUN}-`;
const TEST_QUOTE_DATE = "2096-03-10";

/** 견적서를 고칠 수 있는 역할(quotes WRITE 기본값)이다 — 요청을 올린다. */
let requesterId: string;
let stepAId: string;
let stepBId: string;
/** 자격은 있는데 결재선에는 없는 사람 — 지정 관문에 막혀야 한다. */
let outsiderId: string;
/** 판을 저장하는 사람 + 「언제나 처리할 수 있는」 비상구. */
let superAdminId: string;
/** 🔴 견적서 권한이 없는 역할(AS_ENGINEER 기본값) — 요청이 막혀야 한다. */
let noQuotePermissionId: string;

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
      // 견적서를 보고 고칠 수 있는 기본 역할(quote-authorization.ts). 결재선
      // 단계에 올라갈 사람들도 같은 역할로 둔다.
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
    customerNameText: "결재시험 공급처",
    modelNameText: null,
    lotNumberText: null,
    serialNumberText: null,
    faultDescriptionText: null,
    subject: "결재 시험 견적",
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

type TestQuote = { id: string; version: number; fields: QuoteFields };

async function createTestQuote(): Promise<TestQuote> {
  const fields = quoteFields();
  const created = await createQuote({ fields, actorUserId: requesterId });
  assert.equal(created.ok, true, `setup quote create failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  createdQuoteIds.push(created.id);
  return { id: created.id, version: created.version, fields };
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

/** 그 장의 결재 행들 — 오래된 것부터. */
async function approvalRows(quoteId: string) {
  return db
    .select()
    .from(quoteApprovals)
    .where(eq(quoteApprovals.quoteId, quoteId))
    .orderBy(asc(quoteApprovals.requestedAt));
}

/** 「지금 대기 중인 단계」가 몇 개인가 — 언제나 0 또는 1이어야 한다. */
async function pendingCount(quoteId: string): Promise<number> {
  const rows = await approvalRows(quoteId);
  return rows.filter((row) => row.status === "REQUESTED").length;
}

async function saveQuoteRoute(approverUserIds: string[]): Promise<string> {
  const result = await saveShipmentApprovalRoute(
    approverUserIds,
    superAdminId,
    QUOTE_APPROVAL_ROUTE_SCOPE
  );
  assert.equal(result.ok, true, `setup route save failed: ${JSON.stringify(result)}`);
  const current = await getCurrentShipmentApprovalRoute(QUOTE_APPROVAL_ROUTE_SCOPE);
  assert.ok(current, "저장했는데 현재 판이 없다");
  return current.id;
}

/**
 * 이 파일이 남긴 결재 행·견적서·판·단계·감사 기록을 걷는다. 사람은 after()가
 * 마지막에 지운다(결재 행·견적서가 사람을 RESTRICT 로 참조하므로 순서가 있다).
 */
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

  requesterId = await createTestUser("견적결재시험 요청자");
  stepAId = await createTestUser("견적결재시험 1단계");
  stepBId = await createTestUser("견적결재시험 2단계");
  outsiderId = await createTestUser("견적결재시험 제삼자");
  superAdminId = await createTestUser("견적결재시험 최고관리자", { role: "SUPER_ADMIN" });
  noQuotePermissionId = await createTestUser("견적결재시험 엔지니어", { role: "AS_ENGINEER" });
});

afterEach(async () => {
  // ⚠️ 판이 남으면 다른 시험 파일이 갑자기 결재선을 타면서 깨진다. 매 시험마다
  // 판 번호가 1부터 다시 시작해야 각 시험이 스스로 상태를 정할 수 있다.
  await removeFixtures();
});

after(async () => {
  await removeFixtures();
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

describe("결재선이 없거나 단계가 0개면 요청 자체를 거절한다", () => {
  test("🔴 판이 하나도 없으면 ROUTE_NOT_CONFIGURED 이고 행이 하나도 생기지 않는다", async () => {
    const quote = await createTestQuote();

    const requested = await requestQuoteApproval({
      quoteId: quote.id,
      actorUserId: requesterId,
      requestReason: null,
    });
    assert.equal(requested.ok, false);
    if (requested.ok) return;
    assert.equal(requested.code, "ROUTE_NOT_CONFIGURED");

    // 「승인 기록도 남지 않습니다」 — 용도의 빈 상태 문장 그대로다.
    assert.equal((await approvalRows(quote.id)).length, 0, "거절된 요청이 행을 남겼다");
    const progress = await getQuoteApprovalProgress(quote.id);
    assert.equal(progress?.state, "NOT_REQUESTED");
  });

  test("🔴 단계 0개인 판도 같다 — 「절차를 쓰지 않겠다」는 뜻이다", async () => {
    await saveQuoteRoute([]);
    const quote = await createTestQuote();

    const requested = await requestQuoteApproval({
      quoteId: quote.id,
      actorUserId: requesterId,
      requestReason: null,
    });
    assert.equal(requested.ok, false);
    if (requested.ok) return;
    assert.equal(requested.code, "ROUTE_NOT_CONFIGURED");
    assert.equal((await approvalRows(quote.id)).length, 0);
  });

  test("견적서 결재선은 출하 결재선과 따로 논다 — 출하 판이 있어도 거절이다", async () => {
    // 사람이 다를 수 있어서 용도를 갈라 둔 것이다. 출하 절차를 만들어도 견적서
    // 결재가 거기 얹히면 안 된다.
    const saved = await saveShipmentApprovalRoute([stepAId], superAdminId, "FINAL_SHIPMENT");
    assert.equal(saved.ok, true, `setup shipment route failed: ${JSON.stringify(saved)}`);

    const quote = await createTestQuote();
    const requested = await requestQuoteApproval({
      quoteId: quote.id,
      actorUserId: requesterId,
      requestReason: null,
    });
    assert.equal(requested.ok, false);
    if (requested.ok) return;
    assert.equal(requested.code, "ROUTE_NOT_CONFIGURED");
  });
});

describe("요청 — 판 번호와 결재선을 붙잡아 둔다", () => {
  test("🔴 요청하면 그 시점의 version 이 실리고 1단계 행 하나만 생긴다", async () => {
    const routeId = await saveQuoteRoute([stepAId, stepBId]);
    const quote = await createTestQuote();
    // 만든 뒤 한 번 고쳐 둔다 — 「언제나 1」이 아니라 **그 시점의 값**이 실리는지
    // 봐야 하므로, 기본값 1과 우연히 같아지지 않게 한다.
    const versionAtRequest = await bumpQuoteVersion(quote);
    assert.equal(versionAtRequest, 2);

    const requested = await requestQuoteApproval({
      quoteId: quote.id,
      actorUserId: requesterId,
      requestReason: "검토 부탁드립니다",
    });
    assert.equal(requested.ok, true, `요청이 막혔다: ${JSON.stringify(requested)}`);

    const rows = await approvalRows(quote.id);
    assert.equal(rows.length, 1, "요청 한 번에 행이 하나보다 많이 생겼다");
    assert.equal(rows[0].status, "REQUESTED");
    assert.equal(rows[0].requestedByUserId, requesterId);
    assert.equal(rows[0].requestReason, "검토 부탁드립니다");
    assert.equal(rows[0].quoteVersionAtRequest, versionAtRequest, "🔴 요청 시점의 판 번호가 실려야 한다");
    assert.equal(rows[0].routeId, routeId, "요청 시점의 판을 가리켜야 한다");
    assert.equal(rows[0].routeStepOrder, 1);
    assert.equal(rows[0].assignedApproverUserId, stepAId, "1단계 승인자에게 지정돼야 한다");
    assert.equal(rows[0].decidedByUserId, null);
    assert.equal(rows[0].decidedAt, null);

    const progress = await getQuoteApprovalProgress(quote.id);
    assert.equal(progress?.state, "PENDING");
    assert.equal(progress?.currentQuoteVersion, versionAtRequest);
    assert.equal(progress?.latest?.routeStepOrder, 1);
    assert.equal(progress?.latest?.assignedApproverName, "견적결재시험 1단계");
  });

  test("🔴 한 견적서에 살아 있는 요청은 하나다", async () => {
    await saveQuoteRoute([stepAId, stepBId]);
    const quote = await createTestQuote();
    assert.equal(
      (await requestQuoteApproval({ quoteId: quote.id, actorUserId: requesterId, requestReason: null })).ok,
      true
    );

    const again = await requestQuoteApproval({
      quoteId: quote.id,
      actorUserId: requesterId,
      requestReason: null,
    });
    assert.equal(again.ok, false);
    if (again.ok) return;
    assert.equal(again.code, "ALREADY_REQUESTED");
    assert.equal((await approvalRows(quote.id)).length, 1, "거절된 두 번째 요청이 행을 남겼다");
  });

  test("🔴 요청자 본인 단계는 건너뛴다 — 건너뛰고 남는 단계가 없으면 거절이다", async () => {
    // 요청자만으로 짜인 판. 자기가 올린 것을 자기가 결재하는 칸은 없앤다.
    await saveQuoteRoute([requesterId]);
    const quote = await createTestQuote();

    const requested = await requestQuoteApproval({
      quoteId: quote.id,
      actorUserId: requesterId,
      requestReason: null,
    });
    assert.equal(requested.ok, false);
    if (requested.ok) return;
    assert.equal(requested.code, "ROUTE_HAS_NO_OTHER_APPROVER");
    assert.equal((await approvalRows(quote.id)).length, 0);
  });

  test("요청자가 1단계면 2단계부터 시작한다 — 번호를 1로 고쳐 적지 않는다", async () => {
    await saveQuoteRoute([requesterId, stepBId]);
    const quote = await createTestQuote();
    assert.equal(
      (await requestQuoteApproval({ quoteId: quote.id, actorUserId: requesterId, requestReason: null })).ok,
      true
    );

    const [row] = await approvalRows(quote.id);
    assert.equal(row.routeStepOrder, 2, "🔴 건너뛴 뒤의 실제 번호가 들어가야 한다");
    assert.equal(row.assignedApproverUserId, stepBId);
  });

  test("🔴 견적서를 고칠 수 없는 역할은 요청할 수 없다 — 견적서 화면과 같은 열쇠다", async () => {
    await saveQuoteRoute([stepAId]);
    const quote = await createTestQuote();

    const requested = await requestQuoteApproval({
      quoteId: quote.id,
      actorUserId: noQuotePermissionId,
      requestReason: null,
    });
    assert.equal(requested.ok, false);
    if (requested.ok) return;
    assert.equal(requested.code, "FORBIDDEN");
    assert.equal((await approvalRows(quote.id)).length, 0);
  });

  test("없는 견적서에는 요청할 수 없다", async () => {
    await saveQuoteRoute([stepAId]);
    const missing = await requestQuoteApproval({
      quoteId: randomUUID(),
      actorUserId: requesterId,
      requestReason: null,
    });
    assert.equal(missing.ok, false);
    if (missing.ok) return;
    assert.equal(missing.code, "NOT_FOUND");
  });
});

describe("승인 — 결재선을 순서대로 밟고 마지막 단계에서 끝난다", () => {
  test("🔴 1단계 승인이 2단계를 열고, 2단계 승인에서 사슬이 끝난다", async () => {
    const routeId = await saveQuoteRoute([stepAId, stepBId]);
    const quote = await createTestQuote();
    assert.equal(
      (await requestQuoteApproval({ quoteId: quote.id, actorUserId: requesterId, requestReason: "3월 건" })).ok,
      true
    );

    // 1단계 승인 → 2단계 대기. 아직 승인 완료가 아니다.
    const first = await decideQuoteApproval({
      quoteId: quote.id,
      decision: "APPROVED",
      actorUserId: stepAId,
      decisionReason: null,
    });
    assert.equal(first.ok, true, `1단계가 막혔다: ${JSON.stringify(first)}`);
    if (!first.ok) return;
    assert.ok(first.nextApprovalId, "1단계가 승인됐는데 2단계가 열리지 않았다");
    assert.equal(await pendingCount(quote.id), 1, "대기 중인 단계는 언제나 하나여야 한다");
    assert.equal((await getQuoteApprovalProgress(quote.id))?.state, "PENDING");

    let rows = await approvalRows(quote.id);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].routeId, routeId, "같은 판을 이어 써야 한다");
    assert.equal(rows[1].routeStepOrder, 2);
    assert.equal(rows[1].assignedApproverUserId, stepBId);
    // 이어진 행은 요청자·사유·판 번호를 물려받는다.
    assert.equal(rows[1].requestedByUserId, requesterId, "요청한 사람은 그대로다");
    assert.equal(rows[1].requestReason, "3월 건", "사유도 그대로 이어진다");
    assert.equal(
      rows[1].quoteVersionAtRequest,
      rows[0].quoteVersionAtRequest,
      "🔴 판 번호를 단계마다 새로 찍으면 1단계는 무효인데 2단계만 멀쩡해 보인다"
    );
    // 🔴 requested_at 만 물려받지 않는다 — 같은 시각이면 「가장 최근 행」을
    // 고르는 조회가 어느 행을 고를지 정해지지 않는다.
    assert.ok(
      rows[1].requestedAt.getTime() > rows[0].requestedAt.getTime(),
      `이어진 행의 requested_at 이 앞 행보다 늦지 않다: ${rows[0].requestedAt.toISOString()} / ${rows[1].requestedAt.toISOString()}`
    );

    // 2단계(마지막) 승인 → 다음 행은 생기지 않고 승인이 끝난다.
    const second = await decideQuoteApproval({
      quoteId: quote.id,
      decision: "APPROVED",
      actorUserId: stepBId,
      decisionReason: null,
    });
    assert.equal(second.ok, true, `2단계가 막혔다: ${JSON.stringify(second)}`);
    if (!second.ok) return;
    assert.equal(second.nextApprovalId, null, "마지막 단계 뒤에 행이 또 생겼다");

    rows = await approvalRows(quote.id);
    assert.equal(rows.length, 2);
    assert.equal(await pendingCount(quote.id), 0);
    assert.equal(rows[1].decidedByUserId, stepBId);
    assert.ok(rows[1].decidedAt);
    assert.equal((await getQuoteApprovalProgress(quote.id))?.state, "APPROVED");
  });

  test("🔴 승인 뒤 견적서를 고치면 그 승인은 「지금 내용에 대한 것」이 아니다", async () => {
    await saveQuoteRoute([stepAId]);
    const quote = await createTestQuote();
    assert.equal(
      (await requestQuoteApproval({ quoteId: quote.id, actorUserId: requesterId, requestReason: null })).ok,
      true
    );
    assert.equal(
      (await decideQuoteApproval({
        quoteId: quote.id,
        decision: "APPROVED",
        actorUserId: stepAId,
        decisionReason: null,
      })).ok,
      true
    );

    const approved = await getQuoteApprovalProgress(quote.id);
    assert.equal(approved?.state, "APPROVED");

    // 금액이든 제목이든 한 칸만 바뀌어도 판 번호가 올라간다.
    const newVersion = await bumpQuoteVersion(quote);

    const stale = await getQuoteApprovalProgress(quote.id);
    assert.equal(
      stale?.state,
      "APPROVED_OUTDATED",
      "🔴 고친 뒤에도 「승인 완료」로 보이면 금액을 바꾼 견적서가 승인받은 것처럼 남는다"
    );
    assert.equal(stale?.currentQuoteVersion, newVersion);
    // 행 자체는 고치지 않는다 — 「그때 그 판을 승인했다」는 사실은 그대로다.
    assert.equal(stale?.latest?.status, "APPROVED");
    assert.equal(stale?.latest?.quoteVersionAtRequest, newVersion - 1);
  });

  test("지정된 사람이 아니면 결재할 수 없다 — 최고관리자 비상구만 열려 있다", async () => {
    await saveQuoteRoute([stepAId, stepBId]);
    const quote = await createTestQuote();
    assert.equal(
      (await requestQuoteApproval({ quoteId: quote.id, actorUserId: requesterId, requestReason: null })).ok,
      true
    );

    // 자격은 있지만 이 단계의 사람이 아니다.
    const outsider = await decideQuoteApproval({
      quoteId: quote.id,
      decision: "APPROVED",
      actorUserId: outsiderId,
      decisionReason: null,
    });
    assert.equal(outsider.ok, false);
    if (outsider.ok) return;
    assert.equal(outsider.code, "FORBIDDEN");
    assert.match(outsider.message, /견적결재시험 1단계/, "누구에게 지정되어 있는지 이름이 나와야 한다");

    // 2단계 사람도 아직 자기 차례가 아니다.
    const tooEarly = await decideQuoteApproval({
      quoteId: quote.id,
      decision: "APPROVED",
      actorUserId: stepBId,
      decisionReason: null,
    });
    assert.equal(tooEarly.ok, false);

    assert.equal(await pendingCount(quote.id), 1, "막힌 결재가 행을 건드렸다");

    // 🔴 비상구 — 지정된 사람이 자리를 비워도 최고관리자는 처리할 수 있다.
    const rescue = await decideQuoteApproval({
      quoteId: quote.id,
      decision: "APPROVED",
      actorUserId: superAdminId,
      decisionReason: null,
    });
    assert.equal(rescue.ok, true, `최고관리자 비상구가 막혔다: ${JSON.stringify(rescue)}`);

    const rows = await approvalRows(quote.id);
    assert.equal(rows[0].decidedByUserId, superAdminId, "대신 처리한 사람이 그대로 남아야 한다");
    assert.equal(rows[0].assignedApproverUserId, stepAId, "지정은 고치지 않는다 — 대신 섰다는 사실이 남는다");
  });

  test("이미 처리된 결재는 다시 처리되지 않는다", async () => {
    await saveQuoteRoute([stepAId]);
    const quote = await createTestQuote();
    assert.equal(
      (await requestQuoteApproval({ quoteId: quote.id, actorUserId: requesterId, requestReason: null })).ok,
      true
    );
    assert.equal(
      (await decideQuoteApproval({
        quoteId: quote.id,
        decision: "APPROVED",
        actorUserId: stepAId,
        decisionReason: null,
      })).ok,
      true
    );

    const again = await decideQuoteApproval({
      quoteId: quote.id,
      decision: "REJECTED",
      actorUserId: stepAId,
      decisionReason: "역시 아니다",
    });
    assert.equal(again.ok, false);
    if (again.ok) return;
    assert.equal(again.code, "CONFLICT");
  });

  test("결재 요청이 없는 견적서에는 결재할 것이 없다", async () => {
    const quote = await createTestQuote();
    const nothing = await decideQuoteApproval({
      quoteId: quote.id,
      decision: "APPROVED",
      actorUserId: superAdminId,
      decisionReason: null,
    });
    assert.equal(nothing.ok, false);
    if (nothing.ok) return;
    assert.equal(nothing.code, "NOT_FOUND");
  });
});

describe("반려 — 사유가 필수이고, 다시 하려면 새 요청을 올린다", () => {
  test("🔴 사유 없는 반려는 거절되고 행은 그대로 대기 상태다", async () => {
    await saveQuoteRoute([stepAId]);
    const quote = await createTestQuote();
    assert.equal(
      (await requestQuoteApproval({ quoteId: quote.id, actorUserId: requesterId, requestReason: null })).ok,
      true
    );

    const noReason = await decideQuoteApproval({
      quoteId: quote.id,
      decision: "REJECTED",
      actorUserId: stepAId,
      decisionReason: null,
    });
    assert.equal(noReason.ok, false);
    if (noReason.ok) return;
    assert.equal(noReason.code, "VALIDATION_ERROR");

    const [row] = await approvalRows(quote.id);
    assert.equal(row.status, "REQUESTED", "거절된 반려가 행을 바꿔 놓았다");
    assert.equal(row.decidedByUserId, null);
  });

  test("🔴 반려는 거기서 끝나고, 새 요청은 1단계부터 다시 시작한다", async () => {
    await saveQuoteRoute([stepAId, stepBId]);
    const quote = await createTestQuote();
    assert.equal(
      (await requestQuoteApproval({ quoteId: quote.id, actorUserId: requesterId, requestReason: null })).ok,
      true
    );

    const rejected = await decideQuoteApproval({
      quoteId: quote.id,
      decision: "REJECTED",
      actorUserId: stepAId,
      decisionReason: "금액을 다시 봐 주세요",
    });
    assert.equal(rejected.ok, true, `반려가 막혔다: ${JSON.stringify(rejected)}`);
    if (!rejected.ok) return;
    assert.equal(rejected.nextApprovalId, null, "반려인데 다음 단계가 열렸다");
    assert.equal(await pendingCount(quote.id), 0);
    assert.equal((await getQuoteApprovalProgress(quote.id))?.state, "REJECTED");

    // 살아 있는 요청이 없으므로 새로 올릴 수 있다 — 그것이 CHANGES_REQUESTED 를
    // 두지 않은 이유다.
    const again = await requestQuoteApproval({
      quoteId: quote.id,
      actorUserId: requesterId,
      requestReason: "금액 고쳐 다시 올립니다",
    });
    assert.equal(again.ok, true, `반려 뒤 새 요청이 막혔다: ${JSON.stringify(again)}`);

    const rows = await approvalRows(quote.id);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].routeStepOrder, 1, "새 요청은 1단계부터다");
    assert.equal(rows[1].assignedApproverUserId, stepAId);
    assert.equal((await getQuoteApprovalProgress(quote.id))?.state, "PENDING");

    // 이력은 최신이 먼저 — 두 줄 다 남는다(줄을 고쳐 쓰지 않는다).
    const history = await getQuoteApprovalHistory(quote.id);
    assert.equal(history.length, 2);
    assert.equal(history[0].status, "REQUESTED");
    assert.equal(history[1].status, "REJECTED");
    assert.equal(history[1].decidedByName, "견적결재시험 1단계");
    assert.equal(history[1].decisionReason, "금액을 다시 봐 주세요");
  });
});

describe("🔴 발행을 막지 않는다", () => {
  test("결재를 올린 적이 없어도, 반려됐어도 발행 통로가 그대로 열려 있다", async () => {
    await saveQuoteRoute([stepAId]);
    const quote = await createTestQuote();

    // ① 결재가 아예 없는 상태 — 발행 통로가 맨 처음 하는 일(그 장을 읽는다)과
    //    맨 마지막에 하는 일(내보낸 사실을 감사에 남긴다)이 둘 다 지나간다.
    const beforeAnyApproval = await getQuoteForEdit(quote.id);
    assert.ok(beforeAnyApproval, "결재가 없다고 견적서를 읽지 못하면 발행이 막힌 것이다");
    await recordQuoteExport({
      quoteId: quote.id,
      quoteNumber: beforeAnyApproval.quoteNumber,
      actorUserId: requesterId,
    });

    // ② 반려된 상태 — 여기서도 똑같다.
    assert.equal(
      (await requestQuoteApproval({ quoteId: quote.id, actorUserId: requesterId, requestReason: null })).ok,
      true
    );
    assert.equal(
      (await decideQuoteApproval({
        quoteId: quote.id,
        decision: "REJECTED",
        actorUserId: stepAId,
        decisionReason: "보류",
      })).ok,
      true
    );
    assert.equal((await getQuoteApprovalProgress(quote.id))?.state, "REJECTED");

    const afterRejection = await getQuoteForEdit(quote.id);
    assert.ok(afterRejection, "반려됐다고 견적서를 읽지 못하면 발행이 막힌 것이다");
    await recordQuoteExport({
      quoteId: quote.id,
      quoteNumber: afterRejection.quoteNumber,
      actorUserId: requesterId,
    });

    // ③ 결재가 걸려 있어도 견적서는 계속 고칠 수 있다(고치면 승인이 낡을 뿐이다).
    const bumped = await bumpQuoteVersion(quote);
    assert.equal(bumped, 2);
  });
});
