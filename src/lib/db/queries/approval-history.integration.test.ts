import "../../../../scripts/load-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  auditLogs,
  customers,
  domesticOrders,
  products,
  quoteApprovals,
  quotes,
  repairCaseApprovals,
  repairCaseIntakeSequences,
  repairCases,
  users,
} from "../schema";
import { createRepairCase } from "../mutations/repair-cases";
import { createDomesticOrder } from "../mutations/domestic-orders";
import { softDeleteDomesticOrder } from "../mutations/domestic-orders-trash";
import { createQuote } from "../mutations/quotes";
import { listApprovalHistoryForUser, type ApprovalHistoryPeriod } from "./approval-history";
import type { ApprovalHistoryEntry } from "@/lib/domain/approval-history";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";
import type { DomesticOrderFields } from "@/lib/validation/domestic-order-input";
import type { QuoteFields } from "@/lib/validation/quote-input";

/**
 * ============================================================================
 * 결재 내역 — 「이 사람이 이 기간에 한/대신한 결재」 (실제 DB)
 * ============================================================================
 * queries/approval-history.ts 의 listApprovalHistoryForUser 하나를 잰다.
 *
 * 이 파일이 못 박는 것:
 *  1. 🔴 **셋이 갈려서 나온다** — 내가 직접 · 내가 대신 · 내 자리를 남이.
 *  2. 🔴 **남의 결재는 안 나온다.** 이게 없으면 「인자를 받자마자 전부 여는」 구현도
 *     통과한다 — 제삼자에게 0건, 그리고 남이 남을 대신한 줄이 내 목록에 없다.
 *  3. 🔴 **기간은 반열린 `[시작, 끝)`** 이다. 시작 **그 순간**은 들고, 끝 **그 순간**은
 *     안 든다. 경계를 밀리초 하나로 재지 않고 **그 값 자체**로 잰다.
 *  4. 🔴 **아직 안 누른 줄은 안 나온다.** 🔵 그 조건이 실제로 무는지는
 *     `delegated_from = 나` 인 **REQUESTED** 줄로만 잴 수 있다 — 사람 조건에는 걸리고
 *     결정 조건에만 걸리는 줄이라서다(아래 insertPendingCaseApproval 주석).
 *  5. 🔴 **표 둘 · 갈래 셋이 한 목록으로 합쳐진다** — 접수 건 · 기타건 · 견적서.
 *     제목과 주소가 갈래마다 제 것이고(기타건은 `/domestic-orders/`), 차례는 결정이
 *     늦은 것부터다.
 *  6. 휴지통에 간 건의 결재는 안 나온다(누르면 갈 화면이 없다 — 조회 머리말).
 *
 * ── 🔴 결재 줄을 **손으로 넣는다** ──────────────────────────────────────
 * 옆 파일(approval-outcome-notifications.integration.test.ts)은 진짜 mutation 으로
 * 사슬을 잇는다. 거기서는 「중간 단계 승인은 빼고 마지막 단계만」이라는 판정이
 * **사슬의 모양에 기대고** 있어서 손으로 흉내 낸 행으로는 뜻이 서지 않기 때문이다.
 * 🔵 이 조회에는 그런 판정이 없다 — 결정된 줄은 전부 내역이다. 대신 **결정 시각을
 * 그 순간으로 정해야** 경계를 잴 수 있고(mutation 은 언제나 지금 시각을 적는다),
 * 「대신 눌렀다」를 만들려면 위임 표·결재선 판까지 세워야 한다. 그래서 두 칸
 * (`decided_by_user_id` · `delegated_from_user_id`)을 직접 적는다 — 이 조회가 보는
 * 것이 바로 그 두 칸이다.
 * 🔴 그래서 **표의 CHECK 을 그대로 지켜 넣는다**(결정 칸 묶음 · 위임은 출하 승인만 ·
 * 기타건은 회차 필수). 하나라도 어기면 INSERT 가 거기서 멈춘다 — 그것도 울타리다.
 *
 * ── 격리·청소 규약 ──────────────────────────────────────────────────────
 * 이 파일이 만든 "aphistory-test-" 계정과 그 계정이 만든 것만 쓴다.
 * 🔵 접수 건은 **한 건만** 만든다 — 인수번호가 한 달에 99개뿐이라(접수월 9504 는 이
 * 파일만 쓴다) 시험이 접수 건을 늘리면 한참 뒤 남의 시험이 까닭 없이 깨진다. 한 건에
 * 결재 줄을 여럿 세워 푼다.
 * 사람 참조가 RESTRICT 라 삭제에는 순서가 있다: 결재 행 → 견적서·내자 줄 →
 * (after) 접수 건 · 제품 · 접수 번호표 → 감사 기록 → 사람.
 *
 * 🔴 실제 고객사 · 사람 이름 · L/N · S/N 을 적지 않는다 — 전부 가짜 값이다.
 * ============================================================================
 */

const RUN = randomUUID().slice(0, 8);
const TEST_EMAIL_PREFIX = "aphistory-test-";
const TEST_MODEL_PREFIX = "APHISTORY-TEST-";
const TEST_YEAR_MONTH = "9504";
const TEST_INTAKE_PREFIX = `D${TEST_YEAR_MONTH}%`;
const TEST_RECEIVED_AT = "2095-04-10";
const TEST_SHIPMENT_DATE = "2095-04-20";
const TEST_PO_PREFIX = `APH-TEST-${RUN}-`;
const TEST_QUOTE_NUMBER_PREFIX = `APH-TEST-${RUN}-`;

/** 내역을 보는 사람 — 이 파일의 주인공. */
let viewerId: string;
/** 본인 자리를 대신 눌러 주기도 하고, 제 자리를 맡기기도 하는 동료. */
let mateId: string;
/**
 * 🔴 우리 줄의 **어느 칸에도 없는** 사람 — 여기에 한 줄이라도 서면 조회가 통째로
 * 틀렸다. 🔵 맡긴 사람·대리인으로 쓰지 마라(그러면 그 줄은 이 사람 내역이 맞다).
 */
let outsiderId: string;
/** 결재를 올린 사람. 내역 줄의 `requestedByName` 이 이 사람이다. */
let requesterId: string;
/** 내자 줄을 휴지통에 넣는 사람. */
let superAdminId: string;

let customerId: string;
let repairCaseId: string;
let intakeNumber: string;
let quoteId: string;
let quoteNumber: string;
let domesticOrderId: string;
let trashedDomesticOrderId: string;

const createdTestUserIds: string[] = [];
const createdOrderIds: string[] = [];
const createdQuoteIds: string[] = [];

// ─────────────────────────────────────────────────────────────── 시각 눈금
//
// 🔵 결정 시각을 **값으로** 정해 둔다. 경계 시험이 이 값 그대로를 기간의 시작·끝에
//    넣으므로, 여기서 한 눈금이라도 흔들리면 그 시험이 재는 것이 달라진다.
const T_EARLY = new Date("2095-04-10T00:00:00.000Z");
const T_MIDDLE = new Date("2095-04-10T01:00:00.000Z");
const T_LATE = new Date("2095-04-10T02:00:00.000Z");
/** 넉넉한 기간 — 위 셋을 전부 문다. */
const WIDE: ApprovalHistoryPeriod = {
  from: new Date("2095-04-01T00:00:00.000Z"),
  to: new Date("2095-05-01T00:00:00.000Z"),
};

async function createTestUser(
  name: string,
  overrides: Partial<typeof users.$inferInsert> = {}
): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      email: `${TEST_EMAIL_PREFIX}${randomUUID().slice(0, 8)}@example.test`,
      name,
      // 견적서·내자 줄을 만들 수 있는 역할(quotes · domesticOrders WRITE 기본값).
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

function baseCreateInput(): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
    customerId,
    endUserId: null,
    // 담당 엔지니어를 비워 둔다 — 접수 건이 이 파일의 사람을 붙잡지 않아야 청소
    // 순서가 사람 쪽으로 번지지 않는다.
    assignedEngineerId: null,
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

function orderFields(overrides: Partial<DomesticOrderFields> = {}): DomesticOrderFields {
  return {
    repairCaseId: null,
    intakeNumberText: null,
    customerId: null,
    modelNameText: "내역시험 품명",
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

function quoteFields(): QuoteFields {
  return {
    quoteNumber: `${TEST_QUOTE_NUMBER_PREFIX}${randomUUID().slice(0, 8)}`,
    kind: "DOMESTIC",
    quoteDate: TEST_RECEIVED_AT,
    repairCaseId: null,
    intakeNumberText: null,
    customerId: null,
    customerNameText: "내역시험 공급처",
    newCustomerName: null,
    modelNameText: null,
    lotNumberText: null,
    serialNumberText: null,
    faultDescriptionText: null,
    subject: "내역 시험 견적",
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

async function createTestOrder(): Promise<string> {
  const created = await createDomesticOrder({ fields: orderFields(), actorUserId: requesterId });
  assert.equal(created.ok, true, `setup order create failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  createdOrderIds.push(created.id);
  return created.id;
}

/** 결재 한 줄을 넣을 때 정하는 것 — 「누가 눌렀나」와 「누구 자리였나」와 「언제」. */
type DecidedInput = {
  decidedBy: string;
  /** 🔴 **누구 자리를 대신 눌렀나.** 직접 누른 줄이면 `null`. */
  delegatedFrom?: string | null;
  decidedAt: Date;
  status?: "APPROVED" | "REJECTED";
  requestReason?: string | null;
  decisionReason?: string | null;
};

/** 접수 건 결재 한 줄 — 🔵 위임이 붙을 수 있는 종류는 출하 승인뿐이다(표의 CHECK). */
async function insertCaseApproval(input: DecidedInput): Promise<string> {
  const status = input.status ?? "APPROVED";
  const [row] = await db
    .insert(repairCaseApprovals)
    .values({
      repairCaseId,
      approvalType: "FINAL_SHIPMENT",
      status,
      requestedByUserId: requesterId,
      requestReason: input.requestReason ?? null,
      decidedByUserId: input.decidedBy,
      decidedAt: input.decidedAt,
      // 반려 줄에 사유가 없으면 표의 CHECK 이 막는다.
      decisionReason: input.decisionReason ?? (status === "REJECTED" ? "내역시험 반려 사유" : null),
      delegatedFromUserId: input.delegatedFrom ?? null,
      repairCaseVersionAtRequest: 1,
    })
    .returning({ id: repairCaseApprovals.id });
  return row.id;
}

/**
 * 🔴 **아직 안 누른 줄인데 사람 조건에는 걸리는 줄** — 「결재 안 된 것은 빼라」가
 * 실제로 무는지를 재는 유일한 표본이다.
 *
 * 평범한 REQUESTED 줄은 `decided_by` 도 `delegated_from` 도 비어 있어 사람 조건에
 * 애초에 안 걸린다 — 그 줄로 「안 나온다」를 재면 **조건이 통째로 빠져 있어도** 시험이
 * 통과한다. 그래서 `delegated_from` 만 채운다.
 * 🔵 정상 경로로는 생기지 않는 모양이다(그 칸은 결정 칸들과 **한 번에** 실린다 —
 * mutations/quote-approvals.ts). 표의 CHECK 도 그 조합을 막지 않는다: 결정 칸 묶음은
 * decided_* 셋만 보고, 위임 칸은 승인 종류만 본다.
 */
async function insertPendingCaseApproval(delegatedFrom: string): Promise<string> {
  const [row] = await db
    .insert(repairCaseApprovals)
    .values({
      repairCaseId,
      approvalType: "FINAL_SHIPMENT",
      status: "REQUESTED",
      requestedByUserId: requesterId,
      delegatedFromUserId: delegatedFrom,
      repairCaseVersionAtRequest: 1,
    })
    .returning({ id: repairCaseApprovals.id });
  return row.id;
}

/** 기타건 결재 한 줄. 🔴 회차(`due_date_row_order`)가 없으면 표의 CHECK 이 막는다. */
async function insertDomesticApproval(
  orderId: string,
  input: DecidedInput
): Promise<string> {
  const status = input.status ?? "APPROVED";
  const [row] = await db
    .insert(repairCaseApprovals)
    .values({
      domesticOrderId: orderId,
      dueDateRowOrder: 1,
      approvalType: "DOMESTIC_ORDER_FINAL_SHIPMENT",
      status,
      requestedByUserId: requesterId,
      requestReason: input.requestReason ?? null,
      decidedByUserId: input.decidedBy,
      decidedAt: input.decidedAt,
      decisionReason: input.decisionReason ?? (status === "REJECTED" ? "내역시험 반려 사유" : null),
      delegatedFromUserId: input.delegatedFrom ?? null,
      repairCaseVersionAtRequest: 1,
    })
    .returning({ id: repairCaseApprovals.id });
  return row.id;
}

/** 견적서 결재 한 줄. */
async function insertQuoteApproval(input: DecidedInput): Promise<string> {
  const status = input.status ?? "APPROVED";
  const [row] = await db
    .insert(quoteApprovals)
    .values({
      quoteId,
      status,
      requestedByUserId: requesterId,
      requestReason: input.requestReason ?? null,
      decidedByUserId: input.decidedBy,
      decidedAt: input.decidedAt,
      decisionReason: input.decisionReason ?? (status === "REJECTED" ? "내역시험 반려 사유" : null),
      delegatedFromUserId: input.delegatedFrom ?? null,
      quoteVersionAtRequest: 1,
    })
    .returning({ id: quoteApprovals.id });
  return row.id;
}

/** 그 사람의 내역에서 결재 행 id 만. */
async function historyIds(userId: string, period: ApprovalHistoryPeriod = WIDE): Promise<string[]> {
  const entries = await listApprovalHistoryForUser(userId, period);
  return entries.map((entry) => entry.approvalId);
}

/** 그 행 하나를 내역에서 집어 온다. 없으면 거기서 멈춘다 — 조용히 넘어가지 않게. */
async function entryOf(
  userId: string,
  approvalId: string,
  period: ApprovalHistoryPeriod = WIDE
): Promise<ApprovalHistoryEntry> {
  const entries = await listApprovalHistoryForUser(userId, period);
  const found = entries.find((entry) => entry.approvalId === approvalId);
  assert.ok(found, `내역에 없다: ${approvalId}`);
  return found;
}

async function removeApprovalRows(): Promise<void> {
  if (createdTestUserIds.length === 0) return;
  // 요청자로 고르면 이 파일이 넣은 줄이 전부 걸린다(전부 requesterId 로 넣는다).
  await db
    .delete(repairCaseApprovals)
    .where(inArray(repairCaseApprovals.requestedByUserId, createdTestUserIds));
  await db
    .delete(quoteApprovals)
    .where(inArray(quoteApprovals.requestedByUserId, createdTestUserIds));
}

async function removeFixtures(): Promise<void> {
  await removeApprovalRows();
  if (createdQuoteIds.length > 0) {
    await db.delete(quotes).where(inArray(quotes.id, createdQuoteIds));
    createdQuoteIds.length = 0;
  }
  if (createdOrderIds.length > 0) {
    await db.delete(domesticOrders).where(inArray(domesticOrders.id, createdOrderIds));
    createdOrderIds.length = 0;
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, TEST_INTAKE_PREFIX));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db
    .delete(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  if (createdTestUserIds.length > 0) {
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

  if (ids.length > 0) {
    await db.delete(repairCaseApprovals).where(inArray(repairCaseApprovals.requestedByUserId, ids));
    await db.delete(quoteApprovals).where(inArray(quoteApprovals.requestedByUserId, ids));
    await db.delete(quotes).where(inArray(quotes.createdBy, ids));
    await db.delete(domesticOrders).where(inArray(domesticOrders.createdBy, ids));
  }

  await db.delete(repairCases).where(like(repairCases.intakeNumber, TEST_INTAKE_PREFIX));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db
    .delete(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));

  if (ids.length > 0) {
    await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
}

before(async () => {
  await removeLeftovers();

  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.isDeleted, false))
    .limit(1);
  assert.ok(customer, "expected at least one non-deleted customer in the test DB");
  customerId = customer.id;

  viewerId = await createTestUser("내역시험 본인");
  mateId = await createTestUser("내역시험 동료");
  outsiderId = await createTestUser("내역시험 제삼자");
  requesterId = await createTestUser("내역시험 요청자");
  superAdminId = await createTestUser("내역시험 최고관리자", { role: "SUPER_ADMIN" });

  const created = await createRepairCase(baseCreateInput());
  assert.equal(created.ok, true, `setup case failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  repairCaseId = created.id;
  const [caseRow] = await db
    .select({ intakeNumber: repairCases.intakeNumber })
    .from(repairCases)
    .where(eq(repairCases.id, repairCaseId));
  assert.ok(
    caseRow.intakeNumber.startsWith(`D${TEST_YEAR_MONTH}`),
    `접수월이 어긋났다: ${caseRow.intakeNumber}`
  );
  intakeNumber = caseRow.intakeNumber;

  const fields = quoteFields();
  const createdQuote = await createQuote({ fields, actorUserId: requesterId });
  assert.equal(createdQuote.ok, true, `setup quote failed: ${JSON.stringify(createdQuote)}`);
  if (!createdQuote.ok) throw new Error("unreachable");
  quoteId = createdQuote.id;
  quoteNumber = fields.quoteNumber;
  createdQuoteIds.push(quoteId);

  domesticOrderId = await createTestOrder();

  trashedDomesticOrderId = await createTestOrder();
  const [trashRow] = await db
    .select({ version: domesticOrders.version })
    .from(domesticOrders)
    .where(eq(domesticOrders.id, trashedDomesticOrderId));
  const trashed = await softDeleteDomesticOrder({
    id: trashedDomesticOrderId,
    expectedVersion: trashRow.version,
    actorUserId: superAdminId,
    reason: "내역 시험",
  });
  assert.equal(trashed.ok, true, JSON.stringify(trashed));
});

afterEach(async () => {
  await removeApprovalRows();
});

after(async () => {
  await removeFixtures();
  await removeLeftovers();
  await pgClient.end({ timeout: 5 });
});

// ══════════════════════════════════════════════════════════ 셋을 가른다

describe("결재 내역 — 직접 · 대신 · 내 자리를 남이", () => {
  test("🔴 1. 셋이 다 나오고, 셋이 갈린다", async () => {
    const self = await insertCaseApproval({ decidedBy: viewerId, decidedAt: T_EARLY });
    const onBehalf = await insertCaseApproval({
      decidedBy: viewerId,
      delegatedFrom: mateId,
      decidedAt: T_MIDDLE,
    });
    const byDelegate = await insertCaseApproval({
      decidedBy: mateId,
      delegatedFrom: viewerId,
      decidedAt: T_LATE,
      status: "REJECTED",
      requestReason: "올리며 적은 말",
      decisionReason: "내역시험 반려 사유",
    });

    const entries = await listApprovalHistoryForUser(viewerId, WIDE);
    assert.deepEqual(
      entries.map((entry) => entry.approvalId),
      [byDelegate, onBehalf, self],
      "셋이 다 나오고 결정이 늦은 것부터여야 한다"
    );
    assert.deepEqual(
      entries.map((entry) => entry.relation),
      ["BY_DELEGATE", "ON_BEHALF", "SELF"],
      "🔴 셋이 갈리지 않았다"
    );
    // 이름표도 셋이 서로 다르다 — 화면이 그대로 그린다.
    assert.equal(new Set(entries.map((entry) => entry.relationLabel)).size, 3);

    const mine = entries[2];
    assert.equal(mine.delegatedFromUserId, null, "직접 누른 줄에 맡긴 사람이 적혔다");
    assert.equal(mine.decidedByName, "내역시험 본인");

    const forOther = entries[1];
    assert.equal(forOther.delegatedFromUserId, mateId);
    assert.equal(forOther.delegatedFromName, "내역시험 동료", "누구 자리였는지가 이름으로 나와야 한다");
    assert.equal(forOther.decidedByUserId, viewerId);

    const byOther = entries[0];
    assert.equal(byOther.decidedByUserId, mateId);
    assert.equal(byOther.decidedByName, "내역시험 동료");
    assert.equal(byOther.delegatedFromUserId, viewerId);
    assert.equal(byOther.status, "REJECTED");
    assert.equal(byOther.decisionReason, "내역시험 반려 사유");
    assert.equal(byOther.requestReason, "올리며 적은 말");
    assert.equal(byOther.requestedByName, "내역시험 요청자");
    assert.equal(byOther.decidedAt, T_LATE.toISOString());
  });

  test("🔴 2. 같은 줄 하나가 **대리인에게는 ON_BEHALF**, 맡긴 사람에게는 BY_DELEGATE 로 보인다", async () => {
    const approvalId = await insertCaseApproval({
      decidedBy: mateId,
      delegatedFrom: viewerId,
      decidedAt: T_MIDDLE,
    });

    assert.equal((await entryOf(viewerId, approvalId)).relation, "BY_DELEGATE");
    assert.equal((await entryOf(mateId, approvalId)).relation, "ON_BEHALF");
  });
});

// ══════════════════════════════════════════════════ 남의 결재는 안 나온다

describe("결재 내역 — 울타리", () => {
  test("🔴 3. 남의 결재는 안 나온다 — 제삼자에게 0건, 남이 남을 대신한 줄도 내 목록에 없다", async () => {
    const mine = await insertCaseApproval({ decidedBy: viewerId, decidedAt: T_EARLY });
    const othersOwn = await insertCaseApproval({ decidedBy: mateId, decidedAt: T_MIDDLE });
    // 🔴 **맡긴 사람을 제삼자로 두면 안 된다.** 「내 자리를 남이 눌렀다」는 그 사람의
    //    내역이 맞으므로(이 기능의 절반이 그것이다) 아래 「제삼자에게 0건」이 참이
    //    아니게 된다 — 처음에 그렇게 적었다가 시험이 잡았다. 제삼자는 **어느 칸에도
    //    없는 사람**이어야 한다.
    const othersDelegated = await insertQuoteApproval({
      decidedBy: mateId,
      delegatedFrom: superAdminId,
      decidedAt: T_LATE,
    });

    // 🔵 무엇을 재는지 먼저 — 내 줄은 서 있다. 여기가 비면 아래 「안 나온다」가
    //    빈 목록끼리 견주며 조용히 통과한다.
    assert.deepEqual(await historyIds(viewerId), [mine], "내 줄이 한 줄 서 있어야 한다");

    const viewerIds = await historyIds(viewerId);
    assert.ok(!viewerIds.includes(othersOwn), "남이 혼자 누른 결재가 내 내역에 샜다");
    assert.ok(!viewerIds.includes(othersDelegated), "남이 남을 대신한 결재가 내 내역에 샜다");

    // 🔴 아무 관계도 없는 사람에게는 **한 줄도** 없다. 이것이 없으면 「인자를 받자마자
    //    전부 여는」 구현도 위 단언들을 통과한다.
    assert.deepEqual(await historyIds(outsiderId), [], "제삼자에게 줄이 섰다");
    // 🔵 다만 그 줄들이 **있기는 하다** — 대신 누른 사람에게는 보인다.
    assert.deepEqual(
      (await historyIds(mateId)).sort(),
      [othersOwn, othersDelegated].sort(),
      "표본이 아예 안 들어간 것이라면 위 단언들은 아무것도 재지 않는다"
    );
  });

  test("🔴 4. 아직 안 누른 줄은 안 나온다 — `delegated_from` 이 나인 REQUESTED 줄로 잰다", async () => {
    const decided = await insertCaseApproval({ decidedBy: viewerId, decidedAt: T_MIDDLE });
    const pending = await insertPendingCaseApproval(viewerId);

    // 🔵 그 줄이 실제로 들어갔다 — 사람 조건에는 걸리는 줄이다.
    const [pendingRow] = await db
      .select({ delegatedFromUserId: repairCaseApprovals.delegatedFromUserId })
      .from(repairCaseApprovals)
      .where(eq(repairCaseApprovals.id, pending));
    assert.equal(pendingRow.delegatedFromUserId, viewerId, "표본이 사람 조건에 안 걸린다");

    assert.deepEqual(await historyIds(viewerId), [decided], "결재 안 된 줄이 내역에 섰다");
  });

  test("🔴 5. 휴지통에 간 건의 결재는 안 나온다", async () => {
    const live = await insertDomesticApproval(domesticOrderId, {
      decidedBy: viewerId,
      decidedAt: T_MIDDLE,
    });
    const trashed = await insertDomesticApproval(trashedDomesticOrderId, {
      decidedBy: viewerId,
      decidedAt: T_LATE,
    });

    const ids = await historyIds(viewerId);
    assert.ok(ids.includes(live), "살아 있는 줄의 결재가 안 나왔다 — 표본이 틀렸다");
    assert.ok(!ids.includes(trashed), "휴지통에 간 줄의 결재가 나왔다");
  });
});

// ════════════════════════════════════════════════════════════ 기간 경계

describe("결재 내역 — 기간", () => {
  test("🔴 6. 반열린 `[시작, 끝)` — 시작 그 순간은 들고, 끝 그 순간은 안 든다", async () => {
    const before = await insertCaseApproval({ decidedBy: viewerId, decidedAt: T_EARLY });
    const atStart = await insertCaseApproval({ decidedBy: viewerId, decidedAt: T_MIDDLE });
    const atEnd = await insertCaseApproval({ decidedBy: viewerId, decidedAt: T_LATE });

    // 🔵 셋 다 들어가 있다 — 넉넉한 기간으로 먼저 확인한다.
    assert.deepEqual((await historyIds(viewerId)).sort(), [before, atStart, atEnd].sort());

    assert.deepEqual(
      await historyIds(viewerId, { from: T_MIDDLE, to: T_LATE }),
      [atStart],
      "시작 그 순간은 들고 끝 그 순간은 빠져야 한다"
    );
    // 끝을 1밀리초 늘리면 끝의 줄이 들어온다 — 빠진 까닭이 「경계」임을 못 박는다.
    assert.deepEqual(
      (
        await historyIds(viewerId, {
          from: T_MIDDLE,
          to: new Date(T_LATE.getTime() + 1),
        })
      ).sort(),
      [atStart, atEnd].sort()
    );
    // 시작을 1밀리초 늦추면 시작의 줄이 빠진다.
    assert.deepEqual(
      await historyIds(viewerId, {
        from: new Date(T_MIDDLE.getTime() + 1),
        to: T_LATE,
      }),
      []
    );
  });

  test("🔴 8. 거꾸로 된 기간(`끝` ≤ `시작`)은 **빈 목록**이다 — 통로가 400 을 내지 않는 근거", async () => {
    // 🔴 통합 승인함 통로(api/integration/approval-history)는 거꾸로 된 기간을
    //    **거절하지 않는다**(2026-11-17, 세 집이 함께 정한 것 — 계약이 400 으로 적어
    //    둔 것은 「없거나 못 읽는 값」 둘뿐이다). 그 결정이 서 있는 자리가 여기다:
    //    거꾸로 된 구간에는 드는 줄이 없어 답이 조용히 빈 목록이다. 조건이 `>= from`
    //    AND `< to` 라 둘이 함께 참일 수 없다.
    const decided = await insertCaseApproval({ decidedBy: viewerId, decidedAt: T_MIDDLE });

    // 🔵 표본 확인 — 바른 기간으로는 그 줄이 보인다. 아니면 아래 둘이 공짜로 통과한다.
    assert.deepEqual(await historyIds(viewerId, { from: T_EARLY, to: T_LATE }), [decided]);

    assert.deepEqual(
      await historyIds(viewerId, { from: T_LATE, to: T_EARLY }),
      [],
      "거꾸로 된 기간에 줄이 나왔다"
    );
    // 시작과 끝이 같은 구간도 반열린 구간이라 비어 있다(폭이 0 이다).
    assert.deepEqual(await historyIds(viewerId, { from: T_MIDDLE, to: T_MIDDLE }), []);
  });
});

// ═══════════════════════════════════════════ 표 둘 · 갈래 셋이 한 목록으로

describe("결재 내역 — 세 갈래가 한 목록으로", () => {
  test("🔴 7. 접수 건 · 기타건 · 견적서가 한 목록에 섞여 서고, 제목과 주소가 갈래마다 제 것이다", async () => {
    const caseApproval = await insertCaseApproval({ decidedBy: viewerId, decidedAt: T_EARLY });
    const quoteApproval = await insertQuoteApproval({
      decidedBy: viewerId,
      delegatedFrom: mateId,
      decidedAt: T_MIDDLE,
    });
    const domesticApproval = await insertDomesticApproval(domesticOrderId, {
      decidedBy: mateId,
      delegatedFrom: viewerId,
      decidedAt: T_LATE,
    });

    const entries = await listApprovalHistoryForUser(viewerId, WIDE);
    assert.deepEqual(
      entries.map((entry) => entry.approvalId),
      [domesticApproval, quoteApproval, caseApproval],
      "세 갈래가 한 목록으로, 결정이 늦은 것부터"
    );
    assert.deepEqual(
      entries.map((entry) => entry.source),
      ["DOMESTIC_ORDER", "QUOTE", "REPAIR_CASE"]
    );

    const [domestic, quote, repairCase] = entries;

    assert.equal(repairCase.subject, intakeNumber, "접수 건 제목은 인수번호다");
    assert.equal(repairCase.targetId, repairCaseId);
    assert.ok(
      repairCase.href.startsWith(`/repair-cases/${repairCaseId}`),
      `접수 건 주소가 아니다: ${repairCase.href}`
    );

    assert.equal(quote.subject, quoteNumber, "견적서 제목은 발행번호다");
    assert.equal(quote.targetId, quoteId);
    assert.ok(quote.href.includes(quoteId), `견적서 주소가 아니다: ${quote.href}`);

    assert.equal(domestic.subject, "내역시험 품명", "기타건 제목은 품명이다");
    assert.equal(domestic.targetId, domesticOrderId);
    // 🔴 같은 표의 행이라고 접수 건 주소로 나가면 포털 화면에서만 404 가 난다.
    assert.ok(
      domestic.href.startsWith(`/domestic-orders/${domesticOrderId}`),
      `기타건 주소가 아니다: ${domestic.href}`
    );

    // 결재 이름이 갈래마다 다르다 — 승인함이 한 목록에 섞어 그리므로 이것이 구분이다.
    assert.equal(new Set(entries.map((entry) => entry.approvalName)).size, 3);
    for (const entry of entries) {
      assert.ok(entry.subject.trim().length > 0, "제목이 비었다 — 승인함이 줄을 통째로 버린다");
      assert.ok(entry.approvalName.trim().length > 0);
    }
  });
});
