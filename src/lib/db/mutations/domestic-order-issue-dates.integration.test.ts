import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asc, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  auditLogs,
  customers,
  domesticOrderDueDates,
  domesticOrders,
  products,
  quotes,
  repairCaseIntakeSequences,
  repairCases,
  users,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import { createDomesticOrder } from "./domestic-orders";
import { createQuote } from "./quotes";
import { saveRepairCaseDomesticOrderIssueDates } from "./domestic-order-issue-dates";
import { hasPermission } from "@/lib/auth/permission-resolver";
import type { DomesticOrderFields } from "@/lib/validation/domestic-order-input";
import type { QuoteFields } from "@/lib/validation/quote-input";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 수리 건 상세 「내자 정리 발행일」 저장 — 실제 DB (시험 DB)
 * ============================================================================
 * 이 경로는 `domestic_orders` 의 **두 칸만** 고치고, 줄이 없으면 그 자리에서
 * 하나 만든다. 마이그레이션은 없다 — 칸이 이미 있다.
 *
 * 🔴 여기서 못 박는 것 여섯:
 *
 *  1. 줄이 없을 때 저장하면 **줄이 하나 생기고** 두 날짜가 들어간다. 나머지
 *     칸은 비어 있다(비워 두어야 연결된 수리 건의 값을 따라간다).
 *  2. 🔴 **줄이 있을 때 저장해도 다른 칸이 그대로다** — 이 조각의 안전선이다.
 *     기존 updateDomesticOrder 는 줄 전체를 SET 하므로, 그 길로 저장했다면
 *     금액 · 입금 · 납품일 · 세금계산서 · 견적서 연결 · 납기요청일이 전부
 *     지워진다. 그래서 값을 실제로 넣어 두고 저장한 뒤 **모든 칼럼을 하나씩
 *     대조한다**(바뀌어야 하는 다섯만 빼고).
 *  3. 줄이 둘 이상이면 **서버가 거절한다** — 화면이 단추를 감추는 것은 경계가
 *     아니다.
 *  4. 견적서가 연결된 줄은 **견적발행일을 거절하고**, 발주발행일은 받는다.
 *  5. `version` 이 어긋나면 **거절한다**(덮어쓰지 않는다). 🔴 그 version 은
 *     내자 줄의 것이다 — PO 시스템(dss-po)이 같은 표를 같은 DB 에서 고친다.
 *  6. 쓰기 권한이 없으면 **거절한다** — 트랜잭션 안에서 살아 있는 계정을 다시
 *     읽는다(mutations/domestic-order-sheet-settings.ts 와 같은 방식).
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 스위트만 쓰는 접수 월 "9502", 고객사 접두사 "AS-TEST-DO-ISSUE-DATE-",
 * 제품 모델 접두사 "DO-ISSUE-DATE-TEST-", 계정 이메일 접두사
 * "doissuedate-test-", 견적서 번호 접두사는 실행마다 다른 토큰이다. 인수번호의
 * 연월은 receivedAt 에서 나오므로 TEST_YEAR_MONTH 와 TEST_RECEIVED_AT 은 같은
 * 달을 가리킨다.
 *
 * 🔴 **시험마다 새 수리 건을 만든다.** 이 판정은 "그 건에 줄이 몇 개인가"로
 * 갈리므로, 건을 돌려 쓰면 앞 시험이 만든 줄이 뒤 시험의 판정을 바꾼다.
 *
 * after() 는 FK 순서대로 지운다 — 내자 줄 → 견적서 → 수리 건 → 제품 → 채번 →
 * 고객사 → 감사 기록(행위자로) → 계정. 순서를 바꾸면 RESTRICT 에 걸려 정리가
 * 통째로 실패한다.
 * ============================================================================
 */

const TEST_EMAIL_PREFIX = "doissuedate-test-";
const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-DO-ISSUE-DATE-";
const TEST_MODEL_PREFIX = "DO-ISSUE-DATE-TEST-";
const TEST_YEAR_MONTH = "9502";
const TEST_RECEIVED_AT = "2095-02-05";
const TEST_QUOTE_NUMBER_PREFIX = `DO-ISSUE-DATE-TEST-QUOTE-${randomUUID()}-`;

/** 내자 정리를 고칠 수 있는 사람(기본 정책의 영업). */
let salesId: string;
/**
 * 고칠 수 **없는** 사람. 🔴 재고 담당자다 — A/S 엔지니어가 아니다. 2026-09-29에
 * 보기·고치기가 엔지니어까지 넓어져(domestic-order-authorization.ts) 엔지니어는
 * 더 이상 "막히는 쪽"이 아니다. 아래 before() 의 전제 단언이 그 사실을 먼저
 * 확인하므로, 정책이 또 넓어지면 인가 시험이 조용히 통과하지 않고 거기서 멈춘다.
 */
let inventoryManagerId: string;
/** 접수 건의 담당 엔지니어. 인가와는 상관없다. */
let engineerId: string;
let pendingSalesId: string;
let deletedSalesId: string;
let customerId: string;

const createdTestUserIds: string[] = [];
const createdCaseIds: string[] = [];

async function createTestUser(overrides: Partial<typeof users.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      email: `${TEST_EMAIL_PREFIX}${randomUUID().slice(0, 8)}@example.test`,
      name: "IssueDate Test User",
      role: "SALES",
      approvalStatus: "APPROVED",
      isActive: true,
      ...overrides,
    })
    .returning({ id: users.id });
  createdTestUserIds.push(row.id);
  return row.id;
}

function baseCreateRepairCaseInput(): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
    customerId,
    endUserId: null,
    assignedEngineerId: engineerId,
    receivedAt: TEST_RECEIVED_AT,
    customerRequestedDueDate: null,
    internalTargetShipmentDate: null,
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

/** 🔴 시험마다 제 수리 건을 쓴다 — 줄 수가 곧 판정이라 건을 돌려 쓸 수 없다. */
async function newRepairCase(): Promise<string> {
  const created = await createRepairCase(baseCreateRepairCaseInput());
  assert.equal(created.ok, true, `수리 건 만들기 실패: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  createdCaseIds.push(created.id);
  return created.id;
}

/** 전부 비어 있는 한 줄. 이 표에는 필수 칸이 하나도 없다. */
function emptyFields(): DomesticOrderFields {
  return {
    repairCaseId: null,
    quoteId: null,
    intakeNumberText: null,
    customerId: null,
    modelNameText: null,
    lotNumberText: null,
    serialNumberText: null,
    faultDescriptionText: null,
    displayOrder: null,
    purchaseOrderNumber: null,
    projectName: null,
    orderIssuedDate: null,
    dueDates: [],
    quoteIssuedDate: null,
    quoteNumber: null,
    progressNote: null,
    deliveredDate: null,
    deliveredBy: null,
    taxInvoiceDate: null,
    amountExcludingVat: null,
    paymentCompleted: false,
    japanRemittanceNote: null,
    historyNote: null,
    etcNote: null,
  };
}

async function createOrder(overrides: Partial<DomesticOrderFields>): Promise<string> {
  const result = await createDomesticOrder({
    fields: { ...emptyFields(), ...overrides },
    actorUserId: salesId,
  });
  assert.equal(result.ok, true, `줄 만들기 실패: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result.id;
}

/** 조회 매퍼를 거치지 않은 **DB 그대로의 줄**. 대조는 언제나 이 값으로 한다. */
async function readOrder(id: string) {
  const [row] = await db.select().from(domesticOrders).where(eq(domesticOrders.id, id));
  return row;
}

async function readOrdersForCase(repairCaseId: string) {
  return db
    .select()
    .from(domesticOrders)
    .where(eq(domesticOrders.repairCaseId, repairCaseId))
    .orderBy(asc(domesticOrders.createdAt));
}

async function readDueDates(orderId: string) {
  return db
    .select({
      dueDate: domesticOrderDueDates.dueDate,
      note: domesticOrderDueDates.note,
      displayOrder: domesticOrderDueDates.displayOrder,
    })
    .from(domesticOrderDueDates)
    .where(eq(domesticOrderDueDates.domesticOrderId, orderId))
    .orderBy(asc(domesticOrderDueDates.displayOrder));
}

/** 작업비만 있는 한 장 — 이 시험은 금액을 보지 않고 연결만 쓴다. */
function quoteFields(suffix: string): QuoteFields {
  return {
    quoteNumber: `${TEST_QUOTE_NUMBER_PREFIX}${suffix}`,
    kind: "DOMESTIC",
    quoteDate: "2095-02-10",
    repairCaseId: null,
    intakeNumberText: null,
    customerId: null,
    customerNameText: "시험 고객사",
    modelNameText: null,
    lotNumberText: null,
    serialNumberText: null,
    faultDescriptionText: null,
    subject: "시험 품명",
    validity: null,
    delivery: null,
    payment: null,
    remarks: null,
    workCost: "1200000.00",
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

async function createTestQuote(suffix: string): Promise<string> {
  const quote = await createQuote({ fields: quoteFields(suffix), actorUserId: salesId });
  assert.equal(quote.ok, true, `견적서 만들기 실패: ${JSON.stringify(quote)}`);
  if (!quote.ok) throw new Error("unreachable");
  return quote.id;
}

async function removeTestUsersByPrefix(): Promise<void> {
  const leftovers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  const ids = leftovers.map((row) => row.id);
  if (ids.length === 0) return;
  // audit_logs.actor_user_id → users (restrict): 행위자로만 고른다 —
  // target_record_id 로 고르는 모양은 test-cleanup-static-safety.test.ts 가 금지한다.
  await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, ids));
  await db.delete(users).where(inArray(users.id, ids));
}

before(async () => {
  await removeTestUsersByPrefix();

  salesId = await createTestUser({ role: "SALES", name: "IssueDate 영업" });
  engineerId = await createTestUser({ role: "AS_ENGINEER", name: "IssueDate 엔지니어" });
  inventoryManagerId = await createTestUser({
    role: "INVENTORY_MANAGER",
    name: "IssueDate 재고 담당",
  });
  pendingSalesId = await createTestUser({ approvalStatus: "PENDING", name: "IssueDate 승인 대기" });
  deletedSalesId = await createTestUser({
    isDeleted: true,
    deletedAt: new Date(),
    name: "IssueDate 삭제된 계정",
  });

  // 전제: 시험 DB 의 권한 설정이 기본 정책과 같다. 어긋나면 아래 인가 시험이
  // 엉뚱한 이유로 실패하므로 먼저 알린다(sheet-settings 시험과 같은 방식).
  assert.equal(
    await hasPermission({ role: "SALES", isDeveloper: false }, "domesticOrders", "WRITE"),
    true,
    "전제가 깨졌다: 시험 DB 에서 영업이 내자 정리를 고칠 수 없다"
  );
  assert.equal(
    await hasPermission(
      { role: "INVENTORY_MANAGER", isDeveloper: false },
      "domesticOrders",
      "WRITE"
    ),
    false,
    "전제가 깨졌다: 시험 DB 에서 재고 담당자가 내자 정리를 고칠 수 있다 — 막히는 역할을 다시 골라야 한다"
  );

  const [customer] = await db
    .insert(customers)
    .values({ name: `${TEST_CUSTOMER_NAME_PREFIX}${randomUUID().slice(0, 8)}` })
    .returning({ id: customers.id });
  customerId = customer.id;
});

after(async () => {
  if (createdCaseIds.length > 0) {
    await db.delete(domesticOrders).where(inArray(domesticOrders.repairCaseId, createdCaseIds));
  }
  await db.delete(quotes).where(like(quotes.quoteNumber, `${TEST_QUOTE_NUMBER_PREFIX}%`));
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db
    .delete(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  await removeTestUsersByPrefix();
  await pgClient.end({ timeout: 5 });
});

// ── ① 줄이 없을 때 — 그 자리에서 만든다 ─────────────────────────────────

describe("1. 줄이 없으면 저장이 하나 만든다", () => {
  test("줄이 하나 생기고 두 날짜가 그대로 들어간다", async () => {
    const repairCaseId = await newRepairCase();
    const result = await saveRepairCaseDomesticOrderIssueDates({
      repairCaseId,
      quoteIssuedDate: "2095-03-01",
      orderIssuedDate: "2095-03-10",
      expectedVersion: null,
      actorUserId: salesId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.equal(result.created, true, "있는 줄을 고친 것으로 나왔다");
    assert.equal(result.version, 1, "새 줄은 version 1 로 시작한다");

    const rows = await readOrdersForCase(repairCaseId);
    assert.equal(rows.length, 1, "줄이 하나가 아니다");
    assert.equal(rows[0].id, result.id);
    assert.equal(rows[0].quoteIssuedDate, "2095-03-01");
    assert.equal(rows[0].orderIssuedDate, "2095-03-10");
    assert.equal(rows[0].repairCaseId, repairCaseId);
    assert.equal(rows[0].isDeleted, false);
    assert.equal(rows[0].createdBy, salesId);
    assert.equal(rows[0].updatedBy, salesId, "만든 사람이 곧 마지막으로 고친 사람이다");
  });

  test("🔴 새 줄의 나머지 칸은 **비어 있다** — 비워야 수리 건의 값을 따라간다", async () => {
    const repairCaseId = await newRepairCase();
    const result = await saveRepairCaseDomesticOrderIssueDates({
      repairCaseId,
      quoteIssuedDate: "2095-03-01",
      orderIssuedDate: null,
      expectedVersion: null,
      actorUserId: salesId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;

    const row = await readOrder(result.id);
    // 고객사·인수번호·형식·L/N·S/N·고장내역을 옮겨 적으면 그 줄에 박제되어,
    // 나중에 수리 건 쪽을 고쳐도 이 줄만 옛 값으로 남는다.
    for (const [label, value] of [
      ["고객사", row.customerId],
      ["인수번호", row.intakeNumberText],
      ["형식", row.modelNameText],
      ["L/N", row.lotNumberText],
      ["S/N", row.serialNumberText],
      ["고장내역", row.faultDescriptionText],
      ["순번", row.displayOrder],
      ["발주서번호", row.purchaseOrderNumber],
      ["금액", row.amountExcludingVat],
      ["견적서 연결", row.quoteId],
    ] as const) {
      assert.equal(value, null, `${label} 칸을 채웠다 — 비워야 수리 건을 따라간다`);
    }
    assert.equal(row.paymentCompleted, false);
    assert.equal(await readDueDates(result.id).then((rows) => rows.length), 0);
  });

  test("🔴 두 날짜가 모두 비면 줄을 만들지 않는다 — 빈 줄만 남는다", async () => {
    const repairCaseId = await newRepairCase();
    const result = await saveRepairCaseDomesticOrderIssueDates({
      repairCaseId,
      quoteIssuedDate: null,
      orderIssuedDate: null,
      expectedVersion: null,
      actorUserId: salesId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "EMPTY");
    assert.equal((await readOrdersForCase(repairCaseId)).length, 0, "빈 줄이 생겼다");
  });

  test("지워진 줄은 세지 않는다 — 그 건에 새 줄을 만든다", async () => {
    // 화면에서 지운 줄이 이 화면을 잠그면, 어디에도 안 보이는 줄이 다른 화면의
    // 판정을 정하는 셈이 된다(조회와 같은 규칙).
    const repairCaseId = await newRepairCase();
    const deletedOrderId = await createOrder({ repairCaseId, purchaseOrderNumber: "PO-DELETED" });
    await db
      .update(domesticOrders)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: salesId })
      .where(eq(domesticOrders.id, deletedOrderId));

    const result = await saveRepairCaseDomesticOrderIssueDates({
      repairCaseId,
      quoteIssuedDate: "2095-04-01",
      orderIssuedDate: null,
      expectedVersion: null,
      actorUserId: salesId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.notEqual(result.id, deletedOrderId, "지워진 줄을 되살렸다");
    assert.equal(result.created, true);

    // 지워진 줄은 한 글자도 안 바뀌었다.
    const deletedRow = await readOrder(deletedOrderId);
    assert.equal(deletedRow.purchaseOrderNumber, "PO-DELETED");
    assert.equal(deletedRow.quoteIssuedDate, null);
  });

  test("없는 수리 건이면 NOT_FOUND — 줄도 안 생긴다", async () => {
    const result = await saveRepairCaseDomesticOrderIssueDates({
      repairCaseId: randomUUID(),
      quoteIssuedDate: "2095-03-01",
      orderIssuedDate: null,
      expectedVersion: null,
      actorUserId: salesId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });
});

// ── ② 🔴 이 조각의 안전선 — 다른 칸이 그대로인가 ────────────────────────

describe("2. 🔴 줄이 있을 때 저장해도 다른 칸이 그대로다", () => {
  /** 바뀌어야 하는 칸. 이 다섯 말고 하나라도 달라지면 실패다. */
  const MAY_CHANGE = new Set(["quoteIssuedDate", "orderIssuedDate", "version", "updatedAt", "updatedBy"]);

  test("🔴 스물넉 칸 가운데 두 날짜와 기록용 셋만 달라진다 — 나머지는 전부 그대로", async () => {
    const repairCaseId = await newRepairCase();
    // 기존 updateDomesticOrder 로 저장했다면 **여기 넣은 값이 전부 지워진다.**
    const orderId = await createOrder({
      repairCaseId,
      intakeNumberText: "손으로 적은 인수번호",
      customerId,
      modelNameText: "발주서에 적힌 형식",
      lotNumberText: "발주서에 적힌 L/N",
      serialNumberText: "발주서에 적힌 S/N",
      faultDescriptionText: "발주서에 적힌 고장내역",
      displayOrder: 7,
      purchaseOrderNumber: "PO-KEEP",
      projectName: "PJT-KEEP",
      orderIssuedDate: "2095-03-02",
      quoteIssuedDate: "2095-03-01",
      quoteNumber: "Q-KEEP",
      progressNote: "견적 발행 완료",
      deliveredDate: "2095-04-01",
      deliveredBy: "김유진",
      taxInvoiceDate: "2095-04-05",
      amountExcludingVat: "1234567.89",
      paymentCompleted: true,
      japanRemittanceNote: "2095-04-10 송금",
      historyNote: "재수리 이력 있음",
      etcNote: "기타 메모",
      dueDates: [
        { dueDate: "2095-05-01", note: "1차분" },
        { dueDate: "2095-06-01", note: null },
      ],
    });

    const beforeRow = await readOrder(orderId);
    const beforeDueDates = await readDueDates(orderId);

    const result = await saveRepairCaseDomesticOrderIssueDates({
      repairCaseId,
      quoteIssuedDate: "2095-07-01",
      orderIssuedDate: "2095-07-02",
      expectedVersion: beforeRow.version,
      actorUserId: salesId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.equal(result.created, false, "있는 줄을 고치지 않고 새로 만들었다");
    assert.equal(result.id, orderId);

    const afterRow = await readOrder(orderId);

    // 🔴 칸을 하나씩 대조한다 — 이름을 적어 둔 넷만 보면, 새 칸이 늘었을 때
    // 그 칸이 지워지는 것을 이 시험이 놓친다.
    for (const key of Object.keys(beforeRow) as (keyof typeof beforeRow)[]) {
      if (MAY_CHANGE.has(key)) continue;
      assert.deepEqual(afterRow[key], beforeRow[key], `${key} 칸이 저장에 휩쓸렸다`);
    }

    // 그리고 눈으로 읽히게 한 번 더 — 사고가 났던 자리 넷.
    assert.equal(afterRow.amountExcludingVat, "1234567.89", "금액이 지워졌다");
    assert.equal(afterRow.paymentCompleted, true, "입금 사실이 지워졌다");
    assert.equal(afterRow.deliveredDate, "2095-04-01", "납품일이 지워졌다");
    assert.equal(afterRow.taxInvoiceDate, "2095-04-05", "세금계산서발행일이 지워졌다");

    // 두 날짜는 실제로 바뀌었고 version 이 하나 올랐다.
    assert.equal(afterRow.quoteIssuedDate, "2095-07-01");
    assert.equal(afterRow.orderIssuedDate, "2095-07-02");
    assert.equal(afterRow.version, beforeRow.version + 1);
    assert.equal(afterRow.updatedBy, salesId);

    // 🔴 딸린 표도 그대로다 — 기존 경로는 저장할 때마다 이 목록을 지우고 다시
    // 넣는다(replaceDueDates). 여기서는 건드릴 일이 없다.
    assert.deepEqual(await readDueDates(orderId), beforeDueDates, "납기요청일이 휩쓸렸다");
  });

  test("비운 채로 저장하면 그 날짜가 **지워진다** — 「안 보냈다」가 아니라 「지웠다」", async () => {
    const repairCaseId = await newRepairCase();
    const orderId = await createOrder({
      repairCaseId,
      quoteIssuedDate: "2095-03-01",
      orderIssuedDate: "2095-03-02",
      purchaseOrderNumber: "PO-CLEAR",
    });
    const beforeRow = await readOrder(orderId);

    const result = await saveRepairCaseDomesticOrderIssueDates({
      repairCaseId,
      quoteIssuedDate: null,
      orderIssuedDate: null,
      expectedVersion: beforeRow.version,
      actorUserId: salesId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const afterRow = await readOrder(orderId);
    assert.equal(afterRow.quoteIssuedDate, null, "잘못 적은 날짜를 여기서 지울 수 없다");
    assert.equal(afterRow.orderIssuedDate, null);
    // 줄은 지워지지 않는다 — 비운 것은 두 날짜뿐이다.
    assert.equal(afterRow.isDeleted, false);
    assert.equal(afterRow.purchaseOrderNumber, "PO-CLEAR");
  });
});

// ── ③ 🔴 줄이 둘 이상이면 서버가 거절한다 ───────────────────────────────

describe("3. 🔴 줄이 둘 이상이면 거절한다", () => {
  test("화면이 단추를 감추는 것과 **따로** 막는다 — 두 줄 다 그대로다", async () => {
    const repairCaseId = await newRepairCase();
    const firstId = await createOrder({
      repairCaseId,
      purchaseOrderNumber: "PO-SPLIT-1",
      quoteIssuedDate: "2095-03-01",
      orderIssuedDate: "2095-03-02",
    });
    const secondId = await createOrder({
      repairCaseId,
      purchaseOrderNumber: "PO-SPLIT-2",
      quoteIssuedDate: "2095-05-01",
      orderIssuedDate: "2095-05-02",
    });
    const firstBefore = await readOrder(firstId);
    const secondBefore = await readOrder(secondId);

    for (const expectedVersion of [null, firstBefore.version]) {
      const result = await saveRepairCaseDomesticOrderIssueDates({
        repairCaseId,
        quoteIssuedDate: "2095-09-01",
        orderIssuedDate: "2095-09-02",
        expectedVersion,
        actorUserId: salesId,
      });
      assert.equal(result.ok, false, `expectedVersion=${expectedVersion} 이 통과했다`);
      if (!result.ok) assert.equal(result.code, "MULTIPLE_ROWS");
    }

    assert.deepEqual(await readOrder(firstId), firstBefore, "첫 줄이 바뀌었다");
    assert.deepEqual(await readOrder(secondId), secondBefore, "둘째 줄이 바뀌었다");
    assert.equal((await readOrdersForCase(repairCaseId)).length, 2, "세 번째 줄이 생겼다");
  });
});

// ── ④ 🔴 견적서가 연결된 줄 ─────────────────────────────────────────────

describe("4. 🔴 견적서가 연결된 줄의 견적발행일", () => {
  test("바꾸려 하면 거절한다 — 그 줄은 한 글자도 안 바뀐다", async () => {
    const repairCaseId = await newRepairCase();
    const quoteId = await createTestQuote("lock");
    const orderId = await createOrder({
      repairCaseId,
      quoteId,
      quoteIssuedDate: "2095-03-01",
      orderIssuedDate: "2095-03-02",
    });
    const beforeRow = await readOrder(orderId);

    const result = await saveRepairCaseDomesticOrderIssueDates({
      repairCaseId,
      quoteIssuedDate: "2095-08-01",
      orderIssuedDate: "2095-08-02",
      expectedVersion: beforeRow.version,
      actorUserId: salesId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "QUOTE_LOCKED");
    assert.deepEqual(await readOrder(orderId), beforeRow, "막혔는데 줄이 바뀌었다");
  });

  test("발주발행일만 고치는 저장은 받는다 — 그 칸에는 잠금이 없다", async () => {
    const repairCaseId = await newRepairCase();
    const quoteId = await createTestQuote("po-only");
    const orderId = await createOrder({
      repairCaseId,
      quoteId,
      quoteIssuedDate: "2095-03-01",
      orderIssuedDate: null,
    });
    const beforeRow = await readOrder(orderId);

    const result = await saveRepairCaseDomesticOrderIssueDates({
      repairCaseId,
      // 화면은 잠긴 칸의 지금 값을 그대로 되실어 보낸다.
      quoteIssuedDate: "2095-03-01",
      orderIssuedDate: "2095-08-02",
      expectedVersion: beforeRow.version,
      actorUserId: salesId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const afterRow = await readOrder(orderId);
    assert.equal(afterRow.orderIssuedDate, "2095-08-02");
    assert.equal(afterRow.quoteIssuedDate, "2095-03-01", "잠긴 칸이 바뀌었다");
    assert.equal(afterRow.quoteId, quoteId, "견적서 연결이 풀렸다");
  });

  test("잠긴 칸을 **비우려는** 것도 바꾸는 일이다 — 거절한다", async () => {
    const repairCaseId = await newRepairCase();
    const quoteId = await createTestQuote("clear");
    const orderId = await createOrder({ repairCaseId, quoteId, quoteIssuedDate: "2095-03-01" });
    const beforeRow = await readOrder(orderId);

    const result = await saveRepairCaseDomesticOrderIssueDates({
      repairCaseId,
      quoteIssuedDate: null,
      orderIssuedDate: "2095-08-02",
      expectedVersion: beforeRow.version,
      actorUserId: salesId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "QUOTE_LOCKED");
    assert.deepEqual(await readOrder(orderId), beforeRow);
  });

  test("연결이 없는 줄은 견적발행일도 그대로 받는다", async () => {
    const repairCaseId = await newRepairCase();
    const orderId = await createOrder({ repairCaseId, quoteIssuedDate: "2095-03-01" });
    const beforeRow = await readOrder(orderId);

    const result = await saveRepairCaseDomesticOrderIssueDates({
      repairCaseId,
      quoteIssuedDate: "2095-08-01",
      orderIssuedDate: null,
      expectedVersion: beforeRow.version,
      actorUserId: salesId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal((await readOrder(orderId)).quoteIssuedDate, "2095-08-01");
  });
});

// ── ⑤ 🔴 낙관적 잠금 — 내자 줄의 version ────────────────────────────────

describe("5. 🔴 version 이 어긋나면 덮어쓰지 않는다", () => {
  test("낡은 version 은 CONFLICT — 그 사이 남이 적은 값이 살아 있다", async () => {
    const repairCaseId = await newRepairCase();
    const orderId = await createOrder({
      repairCaseId,
      quoteIssuedDate: "2095-03-01",
      orderIssuedDate: "2095-03-02",
    });
    const stale = await readOrder(orderId);

    // 그 사이 내자 정리 화면(또는 PO 시스템)에서 누가 먼저 고쳤다.
    const firstSave = await saveRepairCaseDomesticOrderIssueDates({
      repairCaseId,
      quoteIssuedDate: "2095-06-01",
      orderIssuedDate: "2095-06-02",
      expectedVersion: stale.version,
      actorUserId: salesId,
    });
    assert.equal(firstSave.ok, true, JSON.stringify(firstSave));

    const result = await saveRepairCaseDomesticOrderIssueDates({
      repairCaseId,
      quoteIssuedDate: "2095-09-01",
      orderIssuedDate: "2095-09-02",
      expectedVersion: stale.version,
      actorUserId: salesId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CONFLICT");

    const afterRow = await readOrder(orderId);
    assert.equal(afterRow.quoteIssuedDate, "2095-06-01", "낡은 저장이 먼저 적힌 값을 덮었다");
    assert.equal(afterRow.orderIssuedDate, "2095-06-02");
  });

  test("🔴 줄이 있는데 「만들려고」 오면 CONFLICT — 줄이 둘이 되지 않는다", async () => {
    // 화면이 화면을 연 뒤 그 사이에 내자 정리에서 줄이 생긴 경우다.
    const repairCaseId = await newRepairCase();
    const orderId = await createOrder({ repairCaseId, purchaseOrderNumber: "PO-RACE" });

    const result = await saveRepairCaseDomesticOrderIssueDates({
      repairCaseId,
      quoteIssuedDate: "2095-09-01",
      orderIssuedDate: null,
      expectedVersion: null,
      actorUserId: salesId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CONFLICT");
    assert.equal((await readOrdersForCase(repairCaseId)).length, 1, "줄이 하나 더 생겼다");
    assert.equal((await readOrder(orderId)).quoteIssuedDate, null);
  });

  test("🔴 줄이 없는데 「고치려고」 오면 CONFLICT — 지워진 줄을 되살리지 않는다", async () => {
    const repairCaseId = await newRepairCase();

    const result = await saveRepairCaseDomesticOrderIssueDates({
      repairCaseId,
      quoteIssuedDate: "2095-09-01",
      orderIssuedDate: null,
      expectedVersion: 3,
      actorUserId: salesId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CONFLICT");
    assert.equal((await readOrdersForCase(repairCaseId)).length, 0, "줄이 생겼다");
  });
});

// ── ⑥ 🔴 인가 ──────────────────────────────────────────────────────────

describe("6. 🔴 쓰기 권한이 없으면 거절한다", () => {
  test("내자 정리를 고칠 수 없는 사람(재고 담당자)은 줄을 만들지 못한다", async () => {
    const repairCaseId = await newRepairCase();
    const result = await saveRepairCaseDomesticOrderIssueDates({
      repairCaseId,
      quoteIssuedDate: "2095-03-01",
      orderIssuedDate: "2095-03-02",
      expectedVersion: null,
      actorUserId: inventoryManagerId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    assert.equal((await readOrdersForCase(repairCaseId)).length, 0, "권한 없는 저장이 줄을 만들었다");
  });

  test("있는 줄도 고치지 못한다 — 한 글자도 안 바뀐다", async () => {
    const repairCaseId = await newRepairCase();
    const orderId = await createOrder({ repairCaseId, quoteIssuedDate: "2095-03-01" });
    const beforeRow = await readOrder(orderId);

    const result = await saveRepairCaseDomesticOrderIssueDates({
      repairCaseId,
      quoteIssuedDate: "2095-09-01",
      orderIssuedDate: "2095-09-02",
      expectedVersion: beforeRow.version,
      actorUserId: inventoryManagerId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
    assert.deepEqual(await readOrder(orderId), beforeRow);
  });

  test("승인 대기 · 지워진 계정 · 없는 계정도 거절된다 — 트랜잭션 안에서 다시 읽는다", async () => {
    const repairCaseId = await newRepairCase();
    for (const [label, actorUserId] of [
      ["승인 대기", pendingSalesId],
      ["지워진 계정", deletedSalesId],
      ["없는 계정", randomUUID()],
    ] as const) {
      const result = await saveRepairCaseDomesticOrderIssueDates({
        repairCaseId,
        quoteIssuedDate: "2095-03-01",
        orderIssuedDate: null,
        expectedVersion: null,
        actorUserId,
      });
      assert.equal(result.ok, false, `${label}: 통과했다`);
      if (!result.ok) assert.equal(result.code, "FORBIDDEN", label);
    }
    assert.equal((await readOrdersForCase(repairCaseId)).length, 0);
  });
});

// ── ⑦ 같은 표를 두 사람이 동시에 ────────────────────────────────────────

test("🔴 두 사람이 동시에 첫 저장을 눌러도 줄은 하나다 — 뒤엣것은 충돌로 막힌다", async () => {
  // repair_case_id 에는 유일 제약이 없다(분할 발주). 둘 다 "줄이 없다"를 보고
  // 각자 만들면 줄이 둘이 되고, 그 순간부터 이 구역은 통째로 잠긴다. 그래서
  // 저장은 수리 건 행을 잠그고 들어간다.
  const repairCaseId = await newRepairCase();
  const results = await Promise.all([
    saveRepairCaseDomesticOrderIssueDates({
      repairCaseId,
      quoteIssuedDate: "2095-03-01",
      orderIssuedDate: null,
      expectedVersion: null,
      actorUserId: salesId,
    }),
    saveRepairCaseDomesticOrderIssueDates({
      repairCaseId,
      quoteIssuedDate: "2095-04-01",
      orderIssuedDate: null,
      expectedVersion: null,
      actorUserId: salesId,
    }),
  ]);

  const succeeded = results.filter((result) => result.ok);
  assert.equal(succeeded.length, 1, `한쪽만 성공해야 한다: ${JSON.stringify(results)}`);
  const failed = results.find((result) => !result.ok);
  assert.equal(failed && !failed.ok ? failed.code : null, "CONFLICT");
  assert.equal((await readOrdersForCase(repairCaseId)).length, 1, "동시 저장으로 줄이 둘이 됐다");
});
