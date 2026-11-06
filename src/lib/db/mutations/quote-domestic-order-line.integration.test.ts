import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  customers,
  domesticOrders,
  products,
  quotes,
  repairCaseIntakeSequences,
  repairCases,
  users,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import { createQuote, updateQuote } from "./quotes";
import { createDomesticOrder } from "./domestic-orders";
import { saveRepairCaseDomesticOrderIssueDates } from "./domestic-order-issue-dates";
import { createDomesticOrderLineForQuote } from "./quote-domestic-order-line";
import { hasPermission } from "@/lib/auth/permission-resolver";
import type { DomesticOrderFields } from "@/lib/validation/domestic-order-input";
import type { QuoteFields } from "@/lib/validation/quote-input";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 🔴 기타 견적서를 **만들면** 내자 정리에 줄이 하나 선다 — 실제 DB (시험 DB)
 * ============================================================================
 * 2026-11-06 사용자 요구: 「[기타 견적서]로 견적서를 만들면 [내자정리]에 해당
 * 내용으로 줄이 생기도록 … 기타 견적서의 [품명]이 내자정리의 [형식]에 적히면 돼」.
 * 마이그레이션은 없다 — 칸이 전부 이미 있다.
 *
 * 규칙 자체는 DB 없이 잰다(domain/quote-domestic-order-line.test.ts), 끼운 자리는
 * 소스로 지킨다(quote-domestic-order-line-source.test.ts). 🔴 여기서만 잴 수 있는
 * 것 일곱:
 *
 *  1. 기타 견적서를 만들면 **줄이 실제로 선다** — 칸 값을 하나씩 대조한다.
 *     🔴 비어 있어야 하는 칸(순번 · 수리 건 연결 · 발주발행일 …)도 함께 본다.
 *  2. 🔴 **고쳐 저장해도 줄이 안 생기고, 있는 줄은 한 칸도 안 바뀐다.** 내자 정리는
 *     사람이 손으로 고치는 표라(화면에 인라인 편집이 있다), 따라가게 만들면 사람이
 *     고쳐 둔 값을 견적서 저장이 말없이 덮는다 — 사용자가 정한 「만들 때 한 번만」이다.
 *  3. 🔴 **내자 · OH 견적서에서는 안 생긴다** — 그 둘은 보통 수리 건에서 출발해 줄이
 *     이미 있고, 거기에 한 줄을 더 세우면 그 건의 발행일 저장이 통째로 막힌다
 *     (BLOCKED_MULTIPLE).
 *  4. 🔴 **두 번 불러도 줄이 하나다** — `quote_id` 에는 유일 제약이 없다. 막는 것은
 *     견적서 행 잠금과 「살아 있는 줄이 있는가」 둘뿐이라, 실제로 두 번 불러 본다.
 *  5. 🔵 **휴지통에 든 줄은 세지 않는다** — 지운 줄이 「이미 있다」가 되면 사람은 줄
 *     없는 내자 정리를 보면서 만들 길도 없는 상태에 놓인다.
 *  6. 🔴 **기존 두 길이 그대로다** — 내자 정리의 [행 추가](createDomesticOrder)와
 *     수리 건 상세의 발행일 저장(saveRepairCaseDomesticOrderIssueDates).
 *  7. 🔴 **공급처(customer_id)가 null 이어도 선다** — 견적서는 고객사를 안 이어도
 *     저장되는 칸이다(2026-11-06 의 승인된 결정).
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 스위트만 쓰는 접수 월 "9105", 고객사 접두사 "AS-TEST-QDOL-", 제품 모델 접두사
 * "QDOL-TEST-", 발행번호 접두사는 **실행마다 다른 토큰**이다. 인수번호의 연월은
 * receivedAt 에서 나오므로 TEST_YEAR_MONTH 와 TEST_RECEIVED_AT 은 같은 달을 가리킨다.
 *
 * 🔴 **계정을 새로 만들지 않는다.** 시험 DB 에 이미 있는 승인된 A/S 엔지니어를 쓴다
 * (quotes.integration.test.ts 와 같은 방식) — created_by 는 users 를 RESTRICT 로
 * 가리키므로 실재하는 계정이면 되고, 그러면 audit_logs 까지 걷는 계정 정리가 필요
 * 없다. 다만 ⑥ 의 발행일 저장은 **트랜잭션 안에서 인가를 다시 본다**(내자 정리
 * WRITE). 그 전제가 시험 DB 에서 참인지 before() 가 먼저 단언한다 — 깨지면 그
 * 시험이 엉뚱한 이유로 실패하는 대신 거기서 멈춘다.
 *
 * after() 는 FK 순서대로 지운다 — 내자 줄 → 견적서 → 수리 건 → 제품 → 채번 →
 * 고객사. 내자 줄이 먼저인 까닭은 customer_id 가 customers 를 RESTRICT 로
 * 가리키기 때문이고, 순서를 바꾸면 정리가 통째로 실패한다.
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-QDOL-";
const TEST_MODEL_PREFIX = "QDOL-TEST-";
const TEST_QUOTE_NUMBER_PREFIX = `QDOL-TEST-${randomUUID().slice(0, 8)}-`;
const TEST_YEAR_MONTH = "9105";
const TEST_RECEIVED_AT = "2091-05-05";
const TEST_QUOTE_DATE = "2091-05-10";

let actorUserId: string;
let engineerId: string;
let customerId: string;

const createdQuoteIds: string[] = [];
const createdCaseIds: string[] = [];
const createdOrderIds: string[] = [];

/** 기타 견적서(CABLE) 한 장. 바꿔 보고 싶은 칸만 덮어쓴다. */
function quoteFields(overrides: Partial<QuoteFields> = {}): QuoteFields {
  return {
    quoteNumber: `${TEST_QUOTE_NUMBER_PREFIX}${randomUUID().slice(0, 8)}`,
    kind: "CABLE",
    quoteDate: TEST_QUOTE_DATE,
    repairCaseId: null,
    intakeNumberText: null,
    customerId,
    customerNameText: "기타 견적 공급처",
    // 「새 고객사로 등록」을 누르지 않은 장 — 저장은 고객사를 찾지도 만들지도 않는다.
    newCustomerName: null,
    modelNameText: null,
    lotNumberText: null,
    serialNumberText: null,
    faultDescriptionText: null,
    subject: "RF 케이블 ASSY 2.5m",
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

/**
 * 견적서 한 장을 만들고 **보낸 값까지 함께** 돌려준다 — 뒤에서 「그 번호 그대로」
 * 다시 저장하려면 보낸 값이 필요하다(고치기는 번호가 바뀌면 다른 시험이 된다).
 */
async function create(overrides: Partial<QuoteFields> = {}) {
  const fields = quoteFields(overrides);
  const result = await createQuote({ fields, actorUserId });
  if (result.ok) {
    createdQuoteIds.push(result.id);
    if (result.domesticOrderLine?.created) {
      createdOrderIds.push(result.domesticOrderLine.domesticOrderId);
    }
  }
  return { result, fields };
}

/** 그 견적서에 걸린 **살아 있는** 내자 줄 전부. 조회가 보는 것과 같은 조건이다. */
async function linesOf(quoteId: string) {
  return db
    .select()
    .from(domesticOrders)
    .where(and(eq(domesticOrders.quoteId, quoteId), eq(domesticOrders.isDeleted, false)));
}

/** 휴지통까지 포함한 전부 — 「지운 줄이 남아 있는가」를 볼 때만 쓴다. */
async function allLinesOf(quoteId: string) {
  return db.select().from(domesticOrders).where(eq(domesticOrders.quoteId, quoteId));
}

/** 전부 비어 있는 내자 줄 한 벌. 이 표에는 필수 칸이 하나도 없다. */
function emptyDomesticOrderFields(): DomesticOrderFields {
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

async function newRepairCase(): Promise<string> {
  const created = await createRepairCase(baseCreateRepairCaseInput());
  assert.equal(created.ok, true, `수리 건 만들기 실패: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  createdCaseIds.push(created.id);
  return created.id;
}

before(async () => {
  const [engineer] = await db
    .select({ id: users.id, role: users.role, isDeveloper: users.isDeveloper })
    .from(users)
    .where(
      and(
        eq(users.role, "AS_ENGINEER"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false)
      )
    )
    .limit(1);
  assert.ok(engineer, "expected at least one approved AS_ENGINEER in the test DB");
  engineerId = engineer.id;
  actorUserId = engineer.id;

  // 🔴 전제: 이 계정이 내자 정리를 고칠 수 있다. ⑥ 의 발행일 저장이 트랜잭션 안에서
  // 다시 보는 관문이라, 어긋나면 그 시험이 엉뚱한 이유로 FORBIDDEN 이 된다.
  assert.equal(
    await hasPermission({ role: "AS_ENGINEER", isDeveloper: false }, "domesticOrders", "WRITE"),
    true,
    "전제가 깨졌다: 시험 DB 에서 A/S 엔지니어가 내자 정리를 고칠 수 없다"
  );

  const [customer] = await db
    .insert(customers)
    .values({ name: `${TEST_CUSTOMER_NAME_PREFIX}${randomUUID().slice(0, 8)}` })
    .returning({ id: customers.id });
  customerId = customer.id;
});

after(async () => {
  // 내자 줄이 먼저다 — customers 를 RESTRICT 로 가리킨다. 세 갈래로 걷는 까닭:
  // 시험이 중간에 실패해도 남는 줄이 없어야 한다.
  if (createdOrderIds.length > 0) {
    await db.delete(domesticOrders).where(inArray(domesticOrders.id, createdOrderIds));
  }
  if (createdQuoteIds.length > 0) {
    await db.delete(domesticOrders).where(inArray(domesticOrders.quoteId, createdQuoteIds));
  }
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
  await pgClient.end({ timeout: 5 });
});

// ── ① 만들면 줄이 선다 ───────────────────────────────────────────────────

describe("1. 기타 견적서를 만들면 내자 정리에 줄이 하나 선다", () => {
  test("🔴 품명이 형식에, 번호와 발행일이 그대로 — 그리고 나머지 칸은 비어 있다", async () => {
    const { result, fields } = await create({
      subject: "RF 케이블 ASSY 2.5m",
      quoteDate: "2091-05-11",
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;

    const lines = await linesOf(result.id);
    assert.equal(lines.length, 1, "🔴 줄이 하나가 아니다");
    const line = lines[0];

    // 🔵 「만들었다」가 값으로도 올라오고, 그것이 **방금 찾은 그 줄**인지 본다 —
    //    줄 수만 세면 남이 만들어 둔 줄과 구분되지 않는다.
    assert.deepEqual(
      result.domesticOrderLine,
      { created: true, domesticOrderId: line.id },
      "만들었다는 사실이 올라오지 않거나 다른 줄을 가리킨다"
    );

    // 🔴 이 조각의 요구 그 자체 — 품명 → 형식.
    assert.equal(line.modelNameText, "RF 케이블 ASSY 2.5m");
    assert.equal(line.quoteId, result.id, "되찾는 열쇠가 안 적혔다");
    assert.equal(line.quoteNumber, fields.quoteNumber, "견적서 번호가 안 따라왔다");
    assert.equal(line.quoteIssuedDate, "2091-05-11", "견적발행일이 발행일자와 다르다");
    assert.equal(line.customerId, customerId, "공급처가 안 따라왔다");

    // 🔴 기타 건이다 — 수리 건 연결은 없다.
    assert.equal(line.repairCaseId, null);
    // 🔴 순번은 지어내지 않는다 — 사람이 매긴 표시 순서 사이에 끼어들면 안 된다.
    assert.equal(line.displayOrder, null);
    // 🔴 나머지 칸은 한 칸도 건드리지 않는다.
    assert.equal(line.intakeNumberText, null);
    assert.equal(line.lotNumberText, null);
    assert.equal(line.serialNumberText, null);
    assert.equal(line.faultDescriptionText, null);
    assert.equal(line.purchaseOrderNumber, null);
    assert.equal(line.projectName, null);
    assert.equal(line.orderIssuedDate, null);
    assert.equal(line.progressNote, null);
    assert.equal(line.deliveredDate, null);
    assert.equal(line.taxInvoiceDate, null);
    assert.equal(line.amountExcludingVat, null);
    assert.equal(line.paymentCompleted, false);
    assert.equal(line.completedAt, null);

    // 기록용 — 만든 사람이 곧 마지막으로 고친 사람이다(기존 두 길과 같다).
    assert.equal(line.createdBy, actorUserId);
    assert.equal(line.updatedBy, actorUserId);
    assert.equal(line.version, 1);
    assert.equal(line.isDeleted, false);
  });

  test("🔴 공급처를 안 이은 장에서도 선다 — customer_id 는 null 이 정상이다", async () => {
    const { result } = await create({ customerId: null, subject: "공급처 없는 케이블" });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;

    const lines = await linesOf(result.id);
    assert.equal(lines.length, 1, "🔴 공급처가 비면 줄이 안 선다");
    assert.equal(lines[0].customerId, null);
    // null 하나가 다른 칸까지 비우지 않는다.
    assert.equal(lines[0].modelNameText, "공급처 없는 케이블");
    assert.equal(lines[0].quoteIssuedDate, TEST_QUOTE_DATE);
  });
});

// ── ② 고칠 때는 안 생기고, 있는 줄도 안 바뀐다 ───────────────────────────

describe("2. 고쳐 저장해도 내자 줄은 따라가지 않는다", () => {
  test("🔴 사람이 고쳐 둔 형식을 견적서 저장이 덮지 않는다", async () => {
    const { result: created, fields } = await create({ subject: "처음 품명" });
    assert.equal(created.ok, true, JSON.stringify(created));
    if (!created.ok) return;

    const before = await linesOf(created.id);
    assert.equal(before.length, 1, "🔵 표본이 비었다 — 만들 때 줄이 안 섰다");

    // 사람이 내자 정리 화면에서 손으로 고쳐 둔 상태를 흉내 낸다.
    await db
      .update(domesticOrders)
      .set({ modelNameText: "사람이 고친 형식", progressNote: "납품 대기" })
      .where(eq(domesticOrders.id, before[0].id));

    const updated = await updateQuote({
      id: created.id,
      expectedVersion: created.version,
      fields: { ...fields, subject: "고친 품명", quoteDate: "2091-05-20" },
      actorUserId,
    });
    assert.equal(updated.ok, true, JSON.stringify(updated));
    if (!updated.ok) return;
    // 🔴 고치기는 이 칸을 **언제나** 들고 다니지 않는다.
    assert.equal(updated.domesticOrderLine, undefined, "🔴 고치기가 내자 줄을 건드렸다");

    const after = await linesOf(created.id);
    assert.equal(after.length, 1, "🔴 고치면서 줄을 하나 더 세웠다");
    assert.equal(after[0].id, before[0].id, "다른 줄로 바뀌었다");
    assert.equal(after[0].modelNameText, "사람이 고친 형식", "🔴 사람이 고친 값이 덮였다");
    assert.equal(after[0].progressNote, "납품 대기", "🔴 사람이 적은 현황이 덮였다");
    assert.equal(after[0].quoteIssuedDate, TEST_QUOTE_DATE, "🔴 견적발행일이 따라 움직였다");
    assert.equal(after[0].version, before[0].version, "줄의 판 번호가 올라갔다");
  });

  test("🔴 줄이 하나도 없는 기타 견적서를 고쳐도 **안 생긴다**", async () => {
    const { result: created, fields } = await create({ subject: "줄 없는 장" });
    assert.equal(created.ok, true, JSON.stringify(created));
    if (!created.ok) return;

    // 만들 때 선 줄을 아예 치운다 — 「이미 있어서 안 생긴 것」과 구분하기 위해서다.
    const lines = await linesOf(created.id);
    assert.equal(lines.length, 1, "🔵 표본이 비었다 — 만들 때 줄이 안 섰다");
    await db.delete(domesticOrders).where(eq(domesticOrders.id, lines[0].id));
    assert.equal((await allLinesOf(created.id)).length, 0, "치우지 못했다");

    const updated = await updateQuote({
      id: created.id,
      expectedVersion: created.version,
      fields: { ...fields, subject: "고친 뒤 품명" },
      actorUserId,
    });
    assert.equal(updated.ok, true, JSON.stringify(updated));

    assert.equal(
      (await allLinesOf(created.id)).length,
      0,
      "🔴 고치기가 줄을 만들었다 — 만들 때 한 번뿐이라는 결정이 깨졌다"
    );
  });
});

// ── ③ 다른 갈래에서는 안 생긴다 ──────────────────────────────────────────

describe("3. 내자 · OH 견적서에서는 줄이 안 생긴다", () => {
  test("🔴 두 갈래 모두 줄이 0 이고, 까닭이 「CABLE 이 아니다」로 올라온다", async () => {
    for (const kind of ["DOMESTIC", "OVERHAUL"] as const) {
      const { result } = await create({ kind, subject: `${kind} 장` });
      assert.equal(result.ok, true, JSON.stringify(result));
      if (!result.ok) return;

      assert.deepEqual(
        result.domesticOrderLine,
        { created: false, reason: "KIND_NOT_CABLE" },
        `🔴 ${kind} 에서 줄이 섰거나 까닭이 다르다`
      );
      assert.equal((await allLinesOf(result.id)).length, 0, `🔴 ${kind} 에서 줄이 생겼다`);
    }

    // 🔵 표본이 비어 공짜로 통과하지 않게 — 같은 틀로 만든 CABLE 장에서는 선다.
    const { result: cable } = await create({ subject: "대조용 케이블" });
    assert.equal(cable.ok, true);
    if (!cable.ok) return;
    assert.equal((await linesOf(cable.id)).length, 1, "🔵 대조 표본에서 줄이 안 섰다");
  });
});

// ── ④⑤ 두 번 불러도 하나 · 휴지통은 세지 않는다 ─────────────────────────

describe("4. 한 견적서에 줄 하나 — 두 번 불러도 늘지 않는다", () => {
  test("🔴 만들 때 선 줄이 있으면 다시 불러도 안 만든다", async () => {
    const { result: created } = await create({ subject: "두 번 부르기" });
    assert.equal(created.ok, true, JSON.stringify(created));
    if (!created.ok) return;
    assert.equal((await linesOf(created.id)).length, 1, "🔵 표본이 비었다");

    const again = await db.transaction((tx) =>
      createDomesticOrderLineForQuote(tx, { quoteId: created.id, actorUserId })
    );
    assert.deepEqual(again, { created: false, reason: "ALREADY_LINKED" });
    assert.equal((await linesOf(created.id)).length, 1, "🔴 줄이 둘이 됐다");
  });

  test("🔴 한 트랜잭션 안에서 잇달아 두 번 불러도 하나다", async () => {
    const { result: created } = await create({ subject: "잇달아 두 번" });
    assert.equal(created.ok, true, JSON.stringify(created));
    if (!created.ok) return;

    // 만들 때 선 줄을 치워 **처음부터 두 번**을 재현한다.
    const made = await linesOf(created.id);
    assert.equal(made.length, 1, "🔵 표본이 비었다");
    await db.delete(domesticOrders).where(eq(domesticOrders.id, made[0].id));

    const pair = await db.transaction(async (tx) => {
      const first = await createDomesticOrderLineForQuote(tx, { quoteId: created.id, actorUserId });
      const second = await createDomesticOrderLineForQuote(tx, { quoteId: created.id, actorUserId });
      return { first, second };
    });

    assert.equal(pair.first.created, true, "첫 번째가 안 만들었다");
    assert.deepEqual(pair.second, { created: false, reason: "ALREADY_LINKED" }, "🔴 둘째가 또 만들었다");
    const lines = await linesOf(created.id);
    assert.equal(lines.length, 1, "🔴 줄이 둘이 됐다");
    if (pair.first.created) {
      createdOrderIds.push(pair.first.domesticOrderId);
      assert.equal(lines[0].id, pair.first.domesticOrderId);
    }
  });

  test("🔵 휴지통에 든 줄은 세지 않는다 — 지운 뒤에는 다시 설 수 있다", async () => {
    const { result: created } = await create({ subject: "휴지통 뒤 다시" });
    assert.equal(created.ok, true, JSON.stringify(created));
    if (!created.ok) return;

    const made = await linesOf(created.id);
    assert.equal(made.length, 1, "🔵 표본이 비었다");
    // 내자 정리 휴지통으로 보낸 상태를 흉내 낸다.
    await db
      .update(domesticOrders)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: actorUserId })
      .where(eq(domesticOrders.id, made[0].id));
    assert.equal((await linesOf(created.id)).length, 0, "휴지통으로 못 보냈다");

    const again = await db.transaction((tx) =>
      createDomesticOrderLineForQuote(tx, { quoteId: created.id, actorUserId })
    );
    assert.equal(again.created, true, "🔵 어디에도 안 보이는 줄이 새 줄을 막았다");
    if (again.created) createdOrderIds.push(again.domesticOrderId);

    assert.equal((await linesOf(created.id)).length, 1, "살아 있는 줄이 하나가 아니다");
    // 지운 줄은 지운 채로 남는다 — 되살리지도 지우지도 않는다.
    assert.equal((await allLinesOf(created.id)).length, 2, "🔴 휴지통의 줄이 사라졌다");
  });
});

// ── ⑥ 기존 두 길이 그대로다 ──────────────────────────────────────────────

describe("5. 기존 두 길은 한 글자도 안 바뀌었다", () => {
  test("🔴 내자 정리의 [행 추가]가 그대로 줄을 만든다", async () => {
    const result = await createDomesticOrder({
      fields: {
        ...emptyDomesticOrderFields(),
        customerId,
        modelNameText: "손으로 적은 형식",
        displayOrder: 7,
        progressNote: "행 추가로 만든 줄",
      },
      actorUserId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    createdOrderIds.push(result.id);

    const [row] = await db.select().from(domesticOrders).where(eq(domesticOrders.id, result.id));
    assert.equal(row.modelNameText, "손으로 적은 형식");
    // 🔴 사람이 적은 순번이 그대로다 — 새 길이 이 칸의 뜻을 바꾸지 않았다.
    assert.equal(row.displayOrder, 7);
    assert.equal(row.progressNote, "행 추가로 만든 줄");
    // 견적서와는 아무 상관이 없는 줄이다.
    assert.equal(row.quoteId, null);
    assert.equal(row.quoteNumber, null);
    assert.equal(row.version, 1);
  });

  test("🔴 수리 건 상세의 발행일 저장이 그대로 — 없으면 만들고, 있으면 고친다", async () => {
    const repairCaseId = await newRepairCase();

    const made = await saveRepairCaseDomesticOrderIssueDates({
      repairCaseId,
      quoteIssuedDate: "2091-06-01",
      orderIssuedDate: "2091-06-10",
      expectedVersion: null,
      actorUserId,
    });
    assert.equal(made.ok, true, JSON.stringify(made));
    if (!made.ok) return;
    createdOrderIds.push(made.id);
    assert.equal(made.created, true, "줄이 없었는데 만들지 않았다");

    const rows = await db
      .select()
      .from(domesticOrders)
      .where(eq(domesticOrders.repairCaseId, repairCaseId));
    assert.equal(rows.length, 1, "🔴 줄이 하나가 아니다");
    assert.equal(rows[0].quoteIssuedDate, "2091-06-01");
    assert.equal(rows[0].orderIssuedDate, "2091-06-10");
    // 🔴 그 길은 세 칸만 채운다 — 새 길이 끼어들어 형식을 적지 않았다.
    assert.equal(rows[0].modelNameText, null);
    assert.equal(rows[0].quoteNumber, null);
    assert.equal(rows[0].quoteId, null);

    // 있는 줄은 고친다(만들지 않는다).
    const edited = await saveRepairCaseDomesticOrderIssueDates({
      repairCaseId,
      quoteIssuedDate: "2091-06-02",
      orderIssuedDate: "2091-06-10",
      expectedVersion: made.version,
      actorUserId,
    });
    assert.equal(edited.ok, true, JSON.stringify(edited));
    if (!edited.ok) return;
    assert.equal(edited.created, false, "있는 줄을 두고 또 만들었다");
    assert.equal(
      (await db.select().from(domesticOrders).where(eq(domesticOrders.repairCaseId, repairCaseId))).length,
      1,
      "🔴 줄이 둘이 됐다"
    );
  });
});
