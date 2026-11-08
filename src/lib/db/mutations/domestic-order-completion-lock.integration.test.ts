import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  customers,
  domesticOrderDueDates,
  domesticOrders,
  products,
  repairCaseIntakeSequences,
  repairCases,
  users,
} from "../schema";
import { createRepairCase, updateRepairCase } from "./repair-cases";
import {
  createDomesticOrder,
  setDomesticOrderCompletion,
  setDomesticOrderDueDateRowCompletion,
  updateDomesticOrder,
} from "./domestic-orders";
import { saveRepairCaseDomesticOrderIssueDates } from "./domestic-order-issue-dates";
import { softDeleteDomesticOrder } from "./domestic-orders-trash";
import {
  DOMESTIC_ORDER_COMPLETED_LOCK_MESSAGE,
  DOMESTIC_ORDER_LINE_COMPLETED_MESSAGE,
} from "@/lib/domain/domestic-order-completion-lock";
import type { DomesticOrderFields } from "@/lib/validation/domestic-order-input";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 🔴 **완료된 것은 잠근다 — 울타리가 진짜 서버에 서 있는가** (2026-11-08)
 * ============================================================================
 * 사용자 결정 원문: 「해제하지 않으면 **내자정리의 어떤 내용도 수정할 수 없도록**
 * 해줘. 이건 **수리건과 연동되는 내용들도 마찬가지**야.」
 * 되물어 받은 답: 「**1차가 완료되면 1차와 관련된 내용들만** 잠기도록 해줘.」
 *
 * 판정과 글자는 순수 함수 한 벌이 가지고(domain/domestic-order-completion-lock.ts
 * — 그 시험이 갈림을 전부 본다), **이 파일이 보는 것은 저장 통로가 정말 거절하는가**다.
 *
 * ── 🔴 내자 줄의 칸을 고치는 길을 **전부** 센다 (2026-11-08 실측) ─────────
 *  ① `updateDomesticOrder` — 표·카드의 자리편집 칸 열넷과 `줄 수정` 폼이 **함께 타는**
 *     단 하나의 길이다(둘 다 updateDomesticOrderAction → 이 함수).
 *  ② `saveRepairCaseDomesticOrderIssueDates` — 수리 건 상세의 「내자 정리 발행일」.
 *     🔴 ① 을 **안 거치는** 별도 저장 경로라(그 파일 머리말의 「합치지 마라」) 울타리를
 *     따로 한 번 더 친다. 여기를 빼면 완료된 줄의 발행일 둘은 그대로 고쳐진다.
 *  ③ `updateRepairCase` — 수리 건 상세에서 **묶인 두 칸**(고객 요청 납기일 · 실제
 *     출하일). 이쪽은 내자 표가 아니라 `repair_cases` 를 고치지만, 저장이 끝나면 그
 *     값이 완료된 내자 줄과 어긋난 채로 굳는다.
 *
 * 🔵 **PO 통로는 이 목록에 없다** — `/api/v1/domestic-orders/{id}/completion` 이 하는
 * 일은 완료 처리·완료 해제뿐이고 칸을 고치지 않는다. 그래서 이번 잠금으로 그 통로의
 * 응답은 한 글자도 달라지지 않는다(그 라우트의 시험도 그대로다).
 *
 * ── 🔵 **「되는 경우」를 같은 자리에 붙인다** ───────────────────────────
 * 「막힌다」만 재면 울타리를 너무 넓게 친 날에도 초록이다. 쌍으로 재는 것:
 *  · 줄이 완료면 막힌다 ↔ **[완료 해제] 뒤에는 고쳐진다**(영영 못 고치는 문이 아니다).
 *  · 완료된 회차는 막힌다 ↔ **다른 회차와 줄의 다른 칸은 그대로 고쳐진다**.
 *  · 묶인 두 칸은 막힌다 ↔ **A/S 본업(수리 내용)과 인수정보의 다른 칸은 그대로다**.
 *
 * ── 🔴 완료 표시는 **DB 에 직접** 찍는다 ───────────────────────────────
 * 이 잠금이 보는 입력은 `completed_at` **하나**다. 그 칸이 어떻게 차는가(승인 관문 ·
 * 회차별 완료 · 줄 전체 완료)는 이미 다른 두 파일이 본다
 * (misc-case-completion-approval… · misc-case-due-date-row-approval…). 여기서 결재선과
 * 승인을 다시 세우면 **재는 것이 흐려지고** 접수 건도 그만큼 더 만들어야 한다(한 달에
 * 99개가 한도다). 🔵 다만 **푸는 쪽은 진짜 경로**로 누른다 — 그것이 「막다른 길이
 * 아니다」의 근거이기 때문이다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 접수 월 "9611", 고객사 접두사 "AS-TEST-LOCK-", 제품 모델 접두사 "LOCK-TEST-",
 * 발주서번호 접두사 "LOCK-TEST-". after() 는 FK 차례대로 지운다 — domestic_orders 가
 * 먼저다. 납기요청일 행은 줄을 지우면 CASCADE 로 함께 사라진다.
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-LOCK-";
const TEST_MODEL_PREFIX = "LOCK-TEST-";
const TEST_PO_PREFIX = "LOCK-TEST-";
const TEST_YEAR_MONTH = "9611";
const TEST_RECEIVED_AT = "2096-11-05";

let actorUserId: string;
let engineerId: string;
let customerId: string;
const createdOrderIds: string[] = [];

function baseCreateRepairCaseInput(): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
    customerId,
    endUserId: null,
    assignedEngineerId: engineerId,
    receivedAt: TEST_RECEIVED_AT,
    customerRequestedDueDate: "2096-12-01",
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
    notes: "처음 적은 수리 메모",
    contactName: null,
    contactPhone: null,
    contactEmail: null,
  };
}

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
    purchaseOrderNumber: `${TEST_PO_PREFIX}${randomUUID().slice(0, 8)}`,
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

function fields(overrides: Partial<DomesticOrderFields> = {}): DomesticOrderFields {
  return { ...emptyFields(), ...overrides };
}

function dueDate(date: string, note: string | null) {
  return { dueDate: date, note, deliveredDate: null, deliveredBy: null };
}

type TestOrder = { id: string; version: number; fields: DomesticOrderFields };

async function createOrder(overrides: Partial<DomesticOrderFields> = {}): Promise<TestOrder> {
  const built = fields(overrides);
  const result = await createDomesticOrder({ fields: built, actorUserId });
  assert.equal(result.ok, true, `setup domestic order failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdOrderIds.push(result.id);
  return { id: result.id, version: result.version, fields: built };
}

async function createCase(): Promise<string> {
  const result = await createRepairCase(baseCreateRepairCaseInput());
  assert.equal(result.ok, true, `setup repair case failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result.id;
}

async function readOrder(id: string) {
  const [row] = await db.select().from(domesticOrders).where(eq(domesticOrders.id, id));
  assert.ok(row, `expected domestic_orders row ${id}`);
  return row;
}

async function readRows(orderId: string) {
  return db
    .select({
      dueDate: domesticOrderDueDates.dueDate,
      note: domesticOrderDueDates.note,
      deliveredDate: domesticOrderDueDates.deliveredDate,
      deliveredBy: domesticOrderDueDates.deliveredBy,
      completedAt: domesticOrderDueDates.completedAt,
      displayOrder: domesticOrderDueDates.displayOrder,
    })
    .from(domesticOrderDueDates)
    .where(eq(domesticOrderDueDates.domesticOrderId, orderId))
    .orderBy(asc(domesticOrderDueDates.displayOrder));
}

async function readCase(id: string) {
  const [row] = await db
    .select({
      version: repairCases.version,
      customerRequestedDueDate: repairCases.customerRequestedDueDate,
      actualShipmentDate: repairCases.actualShipmentDate,
      notes: repairCases.notes,
      priority: repairCases.priority,
    })
    .from(repairCases)
    .where(eq(repairCases.id, id));
  assert.ok(row, `expected repair_cases row ${id}`);
  return row;
}

/**
 * 🔴 **줄 전체를 완료로 찍는다** — DB 에 직접(머리말의 까닭). 돌려주는 것은 그 저장이
 * 올려 둔 새 version 이다.
 */
async function markLineCompleted(orderId: string): Promise<number> {
  const [row] = await db
    .update(domesticOrders)
    .set({ completedAt: new Date(), completedBy: actorUserId })
    .where(eq(domesticOrders.id, orderId))
    .returning({ version: domesticOrders.version });
  return row.version;
}

/** 🔴 **그 회차 하나만** 완료로 찍는다 — 역시 DB 에 직접. */
async function markRowCompleted(orderId: string, rowOrder: number): Promise<void> {
  await db
    .update(domesticOrderDueDates)
    .set({ completedAt: new Date(), completedBy: actorUserId })
    .where(
      and(
        eq(domesticOrderDueDates.domesticOrderId, orderId),
        eq(domesticOrderDueDates.displayOrder, rowOrder)
      )
    );
}

before(async () => {
  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false))
    )
    .limit(1);
  assert.ok(engineer, "expected at least one approved AS_ENGINEER in the test DB");
  engineerId = engineer.id;
  // created_by/updated_by 는 users 를 RESTRICT 로 가리킨다 — 실재하는 계정이어야 한다.
  actorUserId = engineer.id;
  // 🔵 「내자 정리 발행일」 저장은 행위자에게 domesticOrders WRITE 를 요구한다.
  //    AS_ENGINEER 는 기본 정책으로 그 칸을 갖는다(permission-baseline.ts).

  const [customer] = await db
    .insert(customers)
    .values({ name: `${TEST_CUSTOMER_NAME_PREFIX}${randomUUID().slice(0, 8)}` })
    .returning({ id: customers.id });
  customerId = customer.id;
});

after(async () => {
  if (createdOrderIds.length > 0) {
    await db.delete(domesticOrders).where(inArray(domesticOrders.id, createdOrderIds));
  }
  await db.delete(domesticOrders).where(like(domesticOrders.purchaseOrderNumber, `${TEST_PO_PREFIX}%`));
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db
    .delete(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

describe("㉠ 길 ① — 내자 정리의 저장 통로(자리편집 · `줄 수정` 폼이 함께 탄다)", () => {
  test("🔵 **못** — 완료 전에는 같은 저장이 통과한다", async () => {
    const order = await createOrder({ dueDates: [dueDate("2096-12-01", "1차분")] });
    const ok = await updateDomesticOrder({
      id: order.id,
      expectedVersion: order.version,
      fields: { ...order.fields, etcNote: "완료 전에 적은 메모" },
      actorUserId,
    });
    assert.equal(ok.ok, true, `완료도 아닌 줄이 막혔다: ${JSON.stringify(ok)}`);
    assert.equal((await readOrder(order.id)).etcNote, "완료 전에 적은 메모");
  });

  test("🔴 줄이 완료면 거절되고, 그 줄은 한 글자도 안 바뀐다", async () => {
    const order = await createOrder({
      dueDates: [dueDate("2096-12-01", "1차분")],
      etcNote: "완료 전 메모",
    });
    const version = await markLineCompleted(order.id);

    const blocked = await updateDomesticOrder({
      id: order.id,
      expectedVersion: version,
      fields: { ...order.fields, etcNote: "완료 뒤에 고치려는 메모" },
      actorUserId,
    });
    assert.equal(blocked.ok, false, "완료된 줄이 그대로 고쳐졌다");
    if (blocked.ok) return;
    assert.equal(blocked.code, "VALIDATION_ERROR");
    assert.equal(blocked.message, DOMESTIC_ORDER_LINE_COMPLETED_MESSAGE);
    assert.ok(
      blocked.message.startsWith(DOMESTIC_ORDER_COMPLETED_LOCK_MESSAGE),
      "막는 말이 사용자가 못 박은 문장으로 시작하지 않는다"
    );

    const row = await readOrder(order.id);
    assert.equal(row.etcNote, "완료 전 메모", "거절된 저장이 값을 바꿨다");
    assert.equal(row.version, version, "거절된 저장이 version 을 올렸다");
  });

  test("🔴 **납기요청일 목록도** 막힌다 — 줄이 완료면 딸린 표까지 잠긴다", async () => {
    const order = await createOrder({ dueDates: [dueDate("2096-12-01", "1차분")] });
    const version = await markLineCompleted(order.id);

    const blocked = await updateDomesticOrder({
      id: order.id,
      expectedVersion: version,
      fields: { ...order.fields, dueDates: [dueDate("2096-12-20", "고치려는 1차분")] },
      actorUserId,
    });
    assert.equal(blocked.ok, false, "완료된 줄의 납기요청일이 그대로 바뀌었다");

    const rows = await readRows(order.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].dueDate, "2096-12-01", "거절된 저장이 행을 건드렸다");
    assert.equal(rows[0].note, "1차분");
  });

  test("🔵 [완료 해제]는 막히지 않고, 푼 뒤에는 고쳐진다 — 막다른 길이 아니다", async () => {
    const order = await createOrder({ dueDates: [dueDate("2096-12-01", "1차분")] });
    const version = await markLineCompleted(order.id);

    // 🔴 **진짜 경로**로 푼다 — 여기가 막히면 한 번 완료한 줄은 영영 못 고친다.
    const released = await setDomesticOrderCompletion({
      id: order.id,
      expectedVersion: version,
      completed: false,
      actorUserId,
    });
    assert.equal(released.ok, true, `완료 해제가 막혔다: ${JSON.stringify(released)}`);
    if (!released.ok) return;

    const updated = await updateDomesticOrder({
      id: order.id,
      expectedVersion: released.version,
      fields: { ...order.fields, etcNote: "해제한 뒤에 적은 메모" },
      actorUserId,
    });
    assert.equal(updated.ok, true, `해제한 줄이 막혔다: ${JSON.stringify(updated)}`);
    assert.equal((await readOrder(order.id)).etcNote, "해제한 뒤에 적은 메모");
  });
});

describe("㉡ 회차 하나가 완료면 — **그 회차와 관련된 것만** 잠긴다", () => {
  /** 회차 둘짜리 기타건에서 1차만 완료로 찍어 둔다. */
  async function twoRowsWithFirstCompleted(): Promise<TestOrder> {
    const order = await createOrder({
      dueDates: [dueDate("2096-12-01", "1차분"), dueDate("2097-01-15", "2차분")],
    });
    await markRowCompleted(order.id, 1);
    // 🔵 **못** — 표본이 정말 「1차만 완료」인가. 아니면 아래가 전부 공짜다.
    const rows = await readRows(order.id);
    assert.equal(rows.length, 2, "표본의 회차가 둘이 아니다");
    assert.ok(rows[0].completedAt !== null, "표본의 1차가 완료가 아니다");
    assert.equal(rows[1].completedAt, null, "표본의 2차까지 완료라 「다른 회차」를 잴 수 없다");
    assert.equal((await readOrder(order.id)).completedAt, null, "줄까지 완료라 회차 잠금을 잴 수 없다");
    return order;
  }

  test("🔴 완료된 1차의 납기요청일을 바꾸면 거절되고, **몇 차인지** 말한다", async () => {
    const order = await twoRowsWithFirstCompleted();
    const blocked = await updateDomesticOrder({
      id: order.id,
      expectedVersion: order.version,
      fields: {
        ...order.fields,
        dueDates: [dueDate("2096-12-09", "1차분"), dueDate("2097-01-15", "2차분")],
      },
      actorUserId,
    });
    assert.equal(blocked.ok, false, "완료된 회차의 납기요청일이 그대로 바뀌었다");
    if (blocked.ok) return;
    assert.equal(blocked.code, "VALIDATION_ERROR");
    assert.equal(blocked.fieldErrors?.dueDates, blocked.message);
    assert.ok(blocked.message.includes("1차 · 납기 2096-12-01 (1차분)"), blocked.message);
    assert.ok(blocked.message.includes("[1차 해제]"), blocked.message);

    const rows = await readRows(order.id);
    assert.equal(rows[0].dueDate, "2096-12-01", "거절된 저장이 행을 건드렸다");
  });

  test("🔴 완료된 1차의 **납품 둘**을 바꿔도 거절된다", async () => {
    const order = await twoRowsWithFirstCompleted();
    const blocked = await updateDomesticOrder({
      id: order.id,
      expectedVersion: order.version,
      fields: {
        ...order.fields,
        dueDates: [
          { dueDate: "2096-12-01", note: "1차분", deliveredDate: "2096-12-05", deliveredBy: "누군가" },
          dueDate("2097-01-15", "2차분"),
        ],
      },
      actorUserId,
    });
    assert.equal(blocked.ok, false, "완료된 회차의 납품 기록이 그대로 바뀌었다");
    assert.equal((await readRows(order.id))[0].deliveredDate, null, "거절된 저장이 행을 건드렸다");
  });

  test("🔵 **2차는 그대로 고쳐진다** — 잠긴 것은 1차뿐이다", async () => {
    const order = await twoRowsWithFirstCompleted();
    const ok = await updateDomesticOrder({
      id: order.id,
      expectedVersion: order.version,
      fields: {
        ...order.fields,
        dueDates: [
          dueDate("2096-12-01", "1차분"),
          { dueDate: "2097-02-20", note: "2차분 고침", deliveredDate: "2097-02-21", deliveredBy: "2차 납품자" },
        ],
      },
      actorUserId,
    });
    assert.equal(ok.ok, true, `완료되지 않은 회차가 막혔다: ${JSON.stringify(ok)}`);

    const rows = await readRows(order.id);
    assert.equal(rows[1].dueDate, "2097-02-20");
    assert.equal(rows[1].deliveredBy, "2차 납품자");
    // 🔴 1차의 완료 표시는 그 자리에 그대로 남는다(저장이 자리로 되얹는다).
    assert.ok(rows[0].completedAt !== null, "저장 한 번에 1차의 완료 표시가 사라졌다");
  });

  test("🔵 **줄의 다른 칸**도 그대로 고쳐진다 — 회차 완료는 줄을 잠그지 않는다", async () => {
    const order = await twoRowsWithFirstCompleted();
    const ok = await updateDomesticOrder({
      id: order.id,
      expectedVersion: order.version,
      fields: { ...order.fields, etcNote: "회차 하나가 완료여도 적히는 메모" },
      actorUserId,
    });
    assert.equal(ok.ok, true, `줄의 다른 칸이 막혔다: ${JSON.stringify(ok)}`);
    assert.equal((await readOrder(order.id)).etcNote, "회차 하나가 완료여도 적히는 메모");
  });

  test("🔵 [1차 해제] 뒤에는 1차도 고쳐진다 — 막다른 길이 아니다", async () => {
    const order = await twoRowsWithFirstCompleted();
    // 🔴 **진짜 경로**로 푼다(회차별 완료 해제는 승인을 묻지 않는다).
    const released = await setDomesticOrderDueDateRowCompletion({
      id: order.id,
      expectedVersion: order.version,
      dueDateRowOrder: 1,
      completed: false,
      actorUserId,
    });
    assert.equal(released.ok, true, `[1차 해제]가 막혔다: ${JSON.stringify(released)}`);

    const ok = await updateDomesticOrder({
      id: order.id,
      expectedVersion: order.version,
      fields: {
        ...order.fields,
        dueDates: [dueDate("2096-12-09", "풀고 고친 1차분"), dueDate("2097-01-15", "2차분")],
      },
      actorUserId,
    });
    assert.equal(ok.ok, true, `푼 회차가 그대로 막혔다: ${JSON.stringify(ok)}`);
    assert.equal((await readRows(order.id))[0].dueDate, "2096-12-09");
  });
});

describe("㉢ 길 ② — 수리 건 상세의 「내자 정리 발행일」(저장 경로가 따로다)", () => {
  test("🔵 **못** — 완료 전에는 두 날짜가 실제로 저장된다", async () => {
    const caseId = await createCase();
    const order = await createOrder({ repairCaseId: caseId });

    const ok = await saveRepairCaseDomesticOrderIssueDates({
      repairCaseId: caseId,
      quoteIssuedDate: "2096-11-10",
      orderIssuedDate: "2096-11-12",
      expectedVersion: order.version,
      actorUserId,
    });
    assert.equal(ok.ok, true, `완료도 아닌 줄이 막혔다: ${JSON.stringify(ok)}`);
    const row = await readOrder(order.id);
    assert.equal(row.quoteIssuedDate, "2096-11-10");
    assert.equal(row.orderIssuedDate, "2096-11-12");
  });

  test("🔴 줄이 완료면 거절되고, 두 날짜는 그대로다", async () => {
    const caseId = await createCase();
    const order = await createOrder({
      repairCaseId: caseId,
      quoteIssuedDate: "2096-11-01",
      orderIssuedDate: "2096-11-02",
    });
    const version = await markLineCompleted(order.id);

    const blocked = await saveRepairCaseDomesticOrderIssueDates({
      repairCaseId: caseId,
      quoteIssuedDate: "2096-11-20",
      orderIssuedDate: "2096-11-22",
      expectedVersion: version,
      actorUserId,
    });
    assert.equal(blocked.ok, false, "완료된 줄의 발행일이 그대로 바뀌었다");
    if (blocked.ok) return;
    assert.equal(blocked.code, "LINE_COMPLETED");
    assert.equal(blocked.message, DOMESTIC_ORDER_LINE_COMPLETED_MESSAGE);

    const row = await readOrder(order.id);
    assert.equal(row.quoteIssuedDate, "2096-11-01", "거절된 저장이 값을 바꿨다");
    assert.equal(row.orderIssuedDate, "2096-11-02");
    assert.equal(row.version, version, "거절된 저장이 version 을 올렸다");
  });
});

describe("㉣ 길 ③ — 수리 건 상세의 **묶인 두 칸**", () => {
  /** 완료된 내자 줄이 붙은 수리 건. 실제 출하일도 적혀 있다(그 칸을 고치려면 필요하다). */
  async function caseWithCompletedLine(): Promise<{ caseId: string; orderId: string }> {
    const caseId = await createCase();
    const order = await createOrder({ repairCaseId: caseId, dueDates: [dueDate("2096-12-01", null)] });
    // 🔵 실제 출하일은 **출하 완료 전이만** 처음 적을 수 있다(그 mutation 의 규칙).
    //    여기서 재는 것은 잠금이므로 그 전이를 세우지 않고 값만 놓는다.
    await db
      .update(repairCases)
      .set({ actualShipmentDate: "2096-11-20" })
      .where(eq(repairCases.id, caseId));
    await markLineCompleted(order.id);
    return { caseId, orderId: order.id };
  }

  test("🔴 고객 요청 납기일을 바꾸면 거절되고, **어느 줄인지** 말한다", async () => {
    const { caseId, orderId } = await caseWithCompletedLine();
    const before = await readCase(caseId);
    const poNumber = (await readOrder(orderId)).purchaseOrderNumber;

    const blocked = await updateRepairCase(
      caseId,
      before.version,
      "INTAKE",
      { customerRequestedDueDate: "2097-01-20" },
      actorUserId
    );
    assert.equal(blocked.ok, false, "완료된 줄에 묶인 칸이 그대로 바뀌었다");
    if (blocked.ok) return;
    assert.equal(blocked.code, "DOMESTIC_ORDER_COMPLETED");
    assert.ok(
      blocked.message.startsWith(DOMESTIC_ORDER_COMPLETED_LOCK_MESSAGE),
      "사용자가 못 박은 문장으로 시작하지 않는다"
    );
    assert.ok(blocked.message.includes(`발주서번호 ${poNumber}`), blocked.message);
    assert.equal(blocked.fieldErrors?.customerRequestedDueDate, blocked.message);

    const after = await readCase(caseId);
    assert.equal(after.customerRequestedDueDate, before.customerRequestedDueDate, "값이 바뀌었다");
    assert.equal(after.version, before.version, "거절된 저장이 version 을 올렸다");
  });

  test("🔴 실제 출하일을 바꿔도 거절된다", async () => {
    const { caseId } = await caseWithCompletedLine();
    const before = await readCase(caseId);
    assert.equal(before.actualShipmentDate, "2096-11-20", "표본에 실제 출하일이 없다");

    const blocked = await updateRepairCase(
      caseId,
      before.version,
      "INTAKE",
      { actualShipmentDate: "2096-11-25" },
      actorUserId
    );
    assert.equal(blocked.ok, false, "완료된 줄에 묶인 칸이 그대로 바뀌었다");
    if (blocked.ok) return;
    assert.equal(blocked.code, "DOMESTIC_ORDER_COMPLETED");
    assert.equal(blocked.fieldErrors?.actualShipmentDate, blocked.message);
    assert.equal((await readCase(caseId)).actualShipmentDate, "2096-11-20");
  });

  test("🔵 **A/S 본업은 그대로 돌아간다** — 수리 메모는 저장된다", async () => {
    const { caseId } = await caseWithCompletedLine();
    const before = await readCase(caseId);

    const ok = await updateRepairCase(
      caseId,
      before.version,
      "FAULT_SERVICE",
      { notes: "완료된 줄이 붙어 있어도 적히는 수리 메모" },
      actorUserId
    );
    assert.equal(ok.ok, true, `A/S 본업까지 막혔다: ${JSON.stringify(ok)}`);
    assert.equal((await readCase(caseId)).notes, "완료된 줄이 붙어 있어도 적히는 수리 메모");
  });

  test("🔵 **인수 정보의 다른 칸도** 그대로다 — 잠기는 것은 그 둘뿐이다", async () => {
    const { caseId } = await caseWithCompletedLine();
    const before = await readCase(caseId);
    assert.notEqual(before.priority, "URGENT", "표본의 우선순위가 이미 바꿀 값과 같다");

    const ok = await updateRepairCase(caseId, before.version, "INTAKE", { priority: "URGENT" }, actorUserId);
    assert.equal(ok.ok, true, `인수 정보의 다른 칸까지 막혔다: ${JSON.stringify(ok)}`);
    assert.equal((await readCase(caseId)).priority, "URGENT");
  });

  test("🔵 **값이 안 바뀌는 제출은 통과한다** — 폼은 고칠 수 있는 칸을 늘 함께 보낸다", async () => {
    const { caseId } = await caseWithCompletedLine();
    const before = await readCase(caseId);

    const ok = await updateRepairCase(
      caseId,
      before.version,
      "INTAKE",
      {
        // 🔴 저장된 값 **그대로**다. 여기서 막으면 출하 완료된 건에서는 보고서번호
        //    하나 고치는 저장까지 막힌다(그 mutation 의 「바꾸려 할 때만」).
        customerRequestedDueDate: before.customerRequestedDueDate,
        actualShipmentDate: before.actualShipmentDate,
        legacyReportNumber: "LOCK-TEST-RPT-1",
      },
      actorUserId
    );
    assert.equal(ok.ok, true, `안 바뀐 제출이 막혔다: ${JSON.stringify(ok)}`);
  });

  test("🔵 **완료가 아니면** 두 칸이 그대로 고쳐진다", async () => {
    const caseId = await createCase();
    await createOrder({ repairCaseId: caseId, dueDates: [dueDate("2096-12-01", null)] });
    const before = await readCase(caseId);

    const ok = await updateRepairCase(
      caseId,
      before.version,
      "INTAKE",
      { customerRequestedDueDate: "2097-01-20" },
      actorUserId
    );
    assert.equal(ok.ok, true, `완료도 아닌 줄 때문에 막혔다: ${JSON.stringify(ok)}`);
    assert.equal((await readCase(caseId)).customerRequestedDueDate, "2097-01-20");
  });
});

describe("㉤ 잠그지 않기로 정한 것 — 휴지통", () => {
  /**
   * 🔴 **재서 정한 결정이다**(2026-11-08). 까닭 셋은 domain/domestic-order-completion-
   * lock.ts 머리말에 있고, 그 가운데 가장 무거운 것: 막으면 잘못 만든 줄을 지우려고
   * [완료 해제]를 눌러야 하는데 그 해제는 **붙어 있는 수리 건의 출하 완료까지
   * 되돌린다.** 줄 하나 지우자고 멀쩡한 수리 건을 뒤로 물리게 만드는 쪽이 더 나쁘다.
   */
  test("🔵 완료된 줄도 휴지통으로는 보낼 수 있다 — 그리고 완료 표시는 그대로 따라간다", async () => {
    const order = await createOrder({ dueDates: [dueDate("2096-12-01", null)] });
    const version = await markLineCompleted(order.id);

    const deleted = await softDeleteDomesticOrder({
      id: order.id,
      expectedVersion: version,
      actorUserId,
      reason: null,
    });
    assert.equal(deleted.ok, true, `완료된 줄의 휴지통 보내기가 막혔다: ${JSON.stringify(deleted)}`);

    const row = await readOrder(order.id);
    assert.equal(row.isDeleted, true);
    assert.ok(row.completedAt !== null, "휴지통이 완료 표시를 지웠다 — 복원하면 상태가 달라진다");
  });
});
