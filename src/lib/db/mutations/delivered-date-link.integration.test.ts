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
  repairCaseApprovals,
  repairCaseIntakeSequences,
  repairCases,
  statusChangeHistories,
  users,
  workflowSteps,
  workflowTemplates,
  workflowVersions,
} from "../schema";
import { toKstDateOnly } from "@/lib/domain/date-only";
import { createRepairCase, updateRepairCase } from "./repair-cases";
import { createDomesticOrder, updateDomesticOrder } from "./domestic-orders";
import {
  decideRepairCaseApproval,
  requestRepairCaseApproval,
} from "./repair-case-approvals";
import { transitionWorkflow } from "./workflow-transitions";
import {
  DUE_DATE_ROW_HAS_DELIVERY_MESSAGE,
  LINKED_LINE_SINGLE_DUE_DATE_MESSAGE,
} from "@/lib/domain/domestic-order-due-date-rows";
import type { DomesticOrderDueDateInput, DomesticOrderFields } from "@/lib/validation/domestic-order-input";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 🔴 내자 `납품일` ↔ 수리 건 `실제 출하일` — **DB 에 정말 그렇게 쓰이는가** (2026-11-08)
 * ============================================================================
 * 사용자 요구(2026-11-07): 「납기 요청일을 여러줄로 두면, **납품일, 납품자도 그 수에
 * 맞게** 설정할 수 있도록 … 납품일과 수리건 상세의 실제 출하일이 **서로 연동**되도록」.
 *
 * 규칙은 순수 함수 한 벌이 가지고(domain/delivered-date-link.ts ·
 * domain/domestic-order-due-date-rows.ts — 그 시험들이 갈림을 전부 본다), **이 파일이
 * 보는 것은 진짜 트랜잭션에서 그렇게 되는가**다. 2026-10-30 납기요청일 묶기의
 * 짝(requested-due-date-link.integration.test.ts)과 같은 자리의 같은 규율이다:
 *
 *  · 바뀌어야 할 칸이 바뀌는가 — 그리고 **반대쪽 version 까지 올라가는가**. 안
 *    올라가면 열려 있던 상대 화면이 낡은 값으로 저장해도 통과해서, 방금 맞춘 날짜를
 *    제 옛 값으로 되돌린다.
 *  · 🔴 **안 바뀌어야 할 것이 안 바뀌는가** — 행을 만들지도 지우지도 않고, 비고와
 *    납품자가 살아남고, 아직 출하 전인 건에는 **날짜가 안 들어가는가**(그 칸은 종
 *    알림 넷의 침묵 스위치다).
 *  · 🔴 **울타리 둘이 진짜로 막는가** — 납품 기록이 달린 납기요청일 줄 지우기(결정
 *    5), 수리 건이 붙은 줄의 납기요청일 늘리기(결정 9). 그리고 **기타건에서는
 *    되는가**(금지가 넓게 번지면 분할 납품을 아예 못 적는다).
 *  · 🔴 **출하 완료 전이가 찍는가** — 그 전이 안에서 같은 트랜잭션으로 일어난다
 *    (서비스 계층에 붙이면 수리 건 상세에서 누르는 길이 빠진다).
 *
 * 인가는 여기서 보지 않는다(이 계층은 기계다 — mutations 파일 헤더의 계층 구분).
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 스위트만 쓰는 접수 월 "9709", 고객사 접두사 "AS-TEST-SHIP-LINK-",
 * 제품 모델 접두사 "SHIP-LINK-TEST-". 인수번호의 연월은 receivedAt 에서 나오므로
 * TEST_YEAR_MONTH 와 TEST_RECEIVED_AT 은 언제나 같은 달을 가리켜야 한다.
 *
 * 🔵 **접수 건을 적게 만든다** — 한 달에 99개가 한도다(인수번호 채번).
 *
 * after() 는 FK 차례대로 지운다 — domestic_orders 가 먼저다(repair_cases 와
 * customers 를 가리킨다). 납기요청일 행은 그 줄을 지우면 CASCADE 로 함께 사라진다.
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-SHIP-LINK-";
const TEST_MODEL_PREFIX = "SHIP-LINK-TEST-";
const TEST_YEAR_MONTH = "9709";
const TEST_RECEIVED_AT = "2097-09-05";

let actorUserId: string;
let engineerId: string;
let adminId: string;
let representativeId: string;
let customerId: string;
let matcherWorkflowVersionId: string;
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

function fields(overrides: Partial<DomesticOrderFields> = {}): DomesticOrderFields {
  return { ...emptyFields(), ...overrides };
}

/** 납기요청일 한 행. 🔴 **네 칸이 한 덩어리**다(사용자 결정 1 — 1번 줄 ↔ 1번 줄). */
function row(
  dueDate: string,
  overrides: Partial<Omit<DomesticOrderDueDateInput, "dueDate">> = {}
): DomesticOrderDueDateInput {
  return { dueDate, note: null, deliveredDate: null, deliveredBy: null, ...overrides };
}

async function createCase(): Promise<string> {
  const result = await createRepairCase(baseCreateRepairCaseInput());
  assert.equal(result.ok, true, `setup repair case failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result.id;
}

async function createOrder(overrides: Partial<DomesticOrderFields> = {}) {
  const result = await createDomesticOrder({ fields: fields(overrides), actorUserId });
  assert.equal(result.ok, true, `setup domestic order failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdOrderIds.push(result.id);
  return result;
}

async function readCase(id: string) {
  const [found] = await db
    .select({
      version: repairCases.version,
      actualShipmentDate: repairCases.actualShipmentDate,
      isLocked: repairCases.isLocked,
      receivedAt: repairCases.receivedAt,
    })
    .from(repairCases)
    .where(eq(repairCases.id, id));
  assert.ok(found, `expected repair_cases row ${id}`);
  return found;
}

async function readOrder(id: string) {
  const [found] = await db
    .select({ version: domesticOrders.version, updatedBy: domesticOrders.updatedBy })
    .from(domesticOrders)
    .where(eq(domesticOrders.id, id));
  assert.ok(found, `expected domestic_orders row ${id}`);
  return found;
}

/** 그 줄의 납기요청일 행 — **id 까지** 읽는다(행이 새로 만들어졌는지 보려고). */
async function readRows(orderId: string) {
  return db
    .select({
      id: domesticOrderDueDates.id,
      dueDate: domesticOrderDueDates.dueDate,
      note: domesticOrderDueDates.note,
      deliveredDate: domesticOrderDueDates.deliveredDate,
      deliveredBy: domesticOrderDueDates.deliveredBy,
      displayOrder: domesticOrderDueDates.displayOrder,
    })
    .from(domesticOrderDueDates)
    .where(eq(domesticOrderDueDates.domesticOrderId, orderId))
    .orderBy(asc(domesticOrderDueDates.displayOrder), asc(domesticOrderDueDates.dueDate));
}

/** 그 줄을 지금 상태 그대로 다시 저장하면서 납기요청일 목록만 갈아 끼운다. */
async function saveRows(orderId: string, dueDates: DomesticOrderDueDateInput[], extra: Partial<DomesticOrderFields> = {}) {
  const before = await readOrder(orderId);
  return updateDomesticOrder({
    id: orderId,
    expectedVersion: before.version,
    fields: fields({ dueDates, ...extra }),
    actorUserId,
  });
}

/**
 * 🔴 **상황 만들기 전용 SQL** — 수리 건이 붙은 줄에 납기요청일 행을 하나 더 넣는다.
 *
 * 저장 통로로는 이 모양을 만들 수 없다(사용자 결정 9 — 「수리 건이 연결된 줄에는
 * 납기요청일을 하나만」). 그래도 **이 모양을 시험해야 하는 까닭**: 결정 9 는 새로
 * 만드는 것을 막을 뿐이고, **이미 둘 이상인 줄이 실재한다**(개발 DB 1줄, 2026-11-07
 * 실측). 그 줄에서도 묶기와 출하 완료 찍기가 멈춰야 한다 — 안 멈추면 어느 회차의
 * 납품인지 아무도 모르는 날짜가 조용히 적힌다.
 */
async function addExtraRowBySql(orderId: string, dueDate: string) {
  await db.insert(domesticOrderDueDates).values({
    domesticOrderId: orderId,
    dueDate,
    displayOrder: 2,
  });
}

/** 수리 건의 실제 출하일만 고치는 저장. 화면의 인수정보 저장과 같은 길이다. */
async function saveCaseShipmentDate(caseId: string, date: string | null) {
  const before = await readCase(caseId);
  return updateRepairCase(
    caseId,
    before.version,
    "INTAKE",
    { actualShipmentDate: date },
    actorUserId
  );
}

async function stepIdForKey(key: string): Promise<string> {
  const [step] = await db
    .select({ id: workflowSteps.id })
    .from(workflowSteps)
    .where(
      and(eq(workflowSteps.workflowVersionId, matcherWorkflowVersionId), eq(workflowSteps.key, key))
    );
  assert.ok(step, `expected workflow_steps row for PAID_MATCHER/${key}`);
  return step.id;
}

/**
 * 상황 만들기 전용 SQL — PAID_MATCHER 를 처음부터 걸어가면 전이가 열여섯 번 넘게
 * 필요하고, 그것은 여기서 시험하는 동작이 아니다(complete-domestic-order 쪽과 같은
 * 방식이다). 🔵 version 을 올리지 않으므로 아래 승인이 그대로 유효하다.
 */
async function placeCaseAtWaitingShipment(caseId: string) {
  const stepId = await stepIdForKey("waiting_shipment");
  await db.update(repairCases).set({ currentWorkflowStepId: stepId }).where(eq(repairCases.id, caseId));
}

/** 최종 출하 승인까지 받아 둔다(수리 검수 승인이 먼저다 — 그 순서가 규칙이다). */
async function grantFinalShipmentApproval(caseId: string) {
  const inspectionRequest = await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);
  assert.equal(inspectionRequest.ok, true, JSON.stringify(inspectionRequest));
  const inspectionDecision = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", adminId, null);
  assert.equal(inspectionDecision.ok, true, JSON.stringify(inspectionDecision));
  const shipmentRequest = await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, null);
  assert.equal(shipmentRequest.ok, true, JSON.stringify(shipmentRequest));
  const shipmentDecision = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", representativeId, null);
  assert.equal(shipmentDecision.ok, true, JSON.stringify(shipmentDecision));
}

/**
 * 오늘 — 전이가 쓰는 그 식 그대로. 🔴 **`toKstDateOnly` 다**(2026-11-09 고침).
 * 전에는 `toISOString().slice(0, 10)` 이었는데 그것은 UTC 날짜라, 한국 시간
 * 00:00~09:00 사이에 이 시험을 돌리면 서버가 찍는 KST 날짜와 **하루가 어긋나
 * 깨졌다.** 서버와 같은 함수를 부르는 것이 답이다 — 식을 베껴 적으면 한쪽만
 * 고쳤을 때 또 어긋난다.
 */
function shipmentStampToday(): string {
  return toKstDateOnly(new Date());
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

  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "ADMIN"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false),
        eq(users.isShipmentRepresentative, false)
      )
    )
    .limit(1);
  assert.ok(admin, "expected at least one approved, non-representative ADMIN in the test DB");
  adminId = admin.id;

  const [representative] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isShipmentRepresentative, true), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(representative, "expected a seeded users.is_shipment_representative = true row");
  representativeId = representative.id;

  const [version] = await db
    .select({ id: workflowVersions.id })
    .from(workflowVersions)
    .innerJoin(workflowTemplates, eq(workflowVersions.workflowTemplateId, workflowTemplates.id))
    .where(and(eq(workflowTemplates.code, "PAID_MATCHER"), eq(workflowVersions.isCurrent, true)));
  assert.ok(version, "expected a PUBLISHED/current PAID_MATCHER workflow_versions row");
  matcherWorkflowVersionId = version.id;

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
  const testCaseIds = await db
    .select({ id: repairCases.id })
    .from(repairCases)
    .where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  for (const { id } of testCaseIds) {
    await db.delete(repairCaseApprovals).where(eq(repairCaseApprovals.repairCaseId, id));
    await db.delete(statusChangeHistories).where(eq(statusChangeHistories.repairCaseId, id));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db
    .delete(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

describe("운영에서 쓰는 그 모양 — 기타건 분할 납품", () => {
  test("🔴 납기요청일 두 줄에 납품일·납품자를 따로 적으면 **1번 줄 값이 1번 줄에 남는다**", async () => {
    // 사용자 요구 그대로의 모양이다(「납품을 여러 날짜에 나눠서 하게 되는건
    // 기타건 밖에 없어」) — 수리 건이 안 붙은 줄에 1차분·2차분.
    const order = await createOrder({
      dueDates: [
        row("2097-10-20", { note: "1차분", deliveredDate: "2097-10-22", deliveredBy: "담당자1" }),
        row("2097-11-15", { note: "2차분", deliveredDate: "2097-11-18", deliveredBy: "담당자2" }),
      ],
    });

    const rows = await readRows(order.id);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((entry) => [entry.dueDate, entry.note, entry.deliveredDate, entry.deliveredBy]),
      [
        ["2097-10-20", "1차분", "2097-10-22", "담당자1"],
        ["2097-11-15", "2차분", "2097-11-18", "담당자2"],
      ],
      "회차가 뒤섞였다 — 1번 줄의 납품일이 2번 줄로 넘어가면 이 기능의 뜻이 없다"
    );
    assert.deepEqual(rows.map((entry) => entry.displayOrder), [1, 2]);
  });

  test("🔴 2차분만 고쳐도 1차분의 납품 기록은 한 글자도 안 바뀐다", async () => {
    const order = await createOrder({
      dueDates: [
        row("2097-10-20", { note: "1차분", deliveredDate: "2097-10-22", deliveredBy: "담당자1" }),
        row("2097-11-15", { note: "2차분" }),
      ],
    });

    const saved = await saveRows(order.id, [
      row("2097-10-20", { note: "1차분", deliveredDate: "2097-10-22", deliveredBy: "담당자1" }),
      row("2097-11-15", { note: "2차분", deliveredDate: "2097-11-18", deliveredBy: "담당자2" }),
    ]);
    assert.equal(saved.ok, true, JSON.stringify(saved));

    const rows = await readRows(order.id);
    assert.deepEqual(
      rows.map((entry) => [entry.deliveredDate, entry.deliveredBy]),
      [
        ["2097-10-22", "담당자1"],
        ["2097-11-18", "담당자2"],
      ]
    );
  });
});

describe("울타리 둘", () => {
  test("🔴 결정 5 — 납품 기록이 달린 납기요청일 줄은 **못 지운다**. 까닭이 글로 온다", async () => {
    const order = await createOrder({
      dueDates: [
        row("2097-10-20", { deliveredDate: "2097-10-22", deliveredBy: "담당자1" }),
        row("2097-11-15"),
      ],
    });

    // 1차분(기록이 달린 줄)을 빼고 2차분만 보낸다.
    const removed = await saveRows(order.id, [row("2097-11-15")]);
    assert.equal(removed.ok, false, "납품 기록이 달린 줄이 조용히 지워졌다");
    if (removed.ok) return;
    assert.equal(removed.code, "VALIDATION_ERROR");
    assert.equal(removed.fieldErrors?.dueDates, DUE_DATE_ROW_HAS_DELIVERY_MESSAGE);

    // 🔴 거절된 저장은 **아무것도 바꾸지 않는다** — 행도 version 도 그대로다.
    const rows = await readRows(order.id);
    assert.equal(rows.length, 2, "거절된 저장이 행을 건드렸다");
    assert.equal((await readOrder(order.id)).version, order.version);

    // 🔵 기록 **없는** 줄은 지울 수 있다 — 금지가 넓게 번지면 안 된다.
    const okRemove = await saveRows(order.id, [
      row("2097-10-20", { deliveredDate: "2097-10-22", deliveredBy: "담당자1" }),
    ]);
    assert.equal(okRemove.ok, true, JSON.stringify(okRemove));
    assert.equal((await readRows(order.id)).length, 1);
  });

  test("🔴 닫는 길이 있다 — 기록을 지워 저장한 뒤에는 그 줄도 지워진다", async () => {
    const order = await createOrder({
      dueDates: [row("2097-10-20", { deliveredDate: "2097-10-22", deliveredBy: "담당자1" })],
    });

    const cleared = await saveRows(order.id, [row("2097-10-20")]);
    assert.equal(cleared.ok, true, `기록을 지우는 저장까지 막히면 그 줄은 영영 못 지운다: ${JSON.stringify(cleared)}`);

    const removed = await saveRows(order.id, []);
    assert.equal(removed.ok, true, JSON.stringify(removed));
    assert.deepEqual(await readRows(order.id), []);
  });

  test("🔴 결정 9 — 수리 건이 붙은 줄에는 납기요청일을 둘 이상 못 만든다", async () => {
    const caseId = await createCase();
    const order = await createOrder({ repairCaseId: caseId, dueDates: [row("2097-10-20")] });

    const grown = await saveRows(order.id, [row("2097-10-20"), row("2097-11-15")], {
      repairCaseId: caseId,
    });
    assert.equal(grown.ok, false, "수리 건이 붙은 줄에 분할 납품이 생겼다");
    if (grown.ok) return;
    assert.equal(grown.fieldErrors?.dueDates, LINKED_LINE_SINGLE_DUE_DATE_MESSAGE);
    assert.equal((await readRows(order.id)).length, 1, "거절된 저장이 행을 더했다");

    // 🔵 **기타건에서는 된다** — 금지가 넓게 번지면 분할 납품을 아예 못 적는다.
    const misc = await createOrder({ dueDates: [row("2097-10-20")] });
    const grownMisc = await saveRows(misc.id, [row("2097-10-20"), row("2097-11-15")]);
    assert.equal(grownMisc.ok, true, JSON.stringify(grownMisc));
    assert.equal((await readRows(misc.id)).length, 2);
  });
});

describe("내자 → 수리 건", () => {
  test("납품일을 적으면 수리 건의 실제 출하일이 그 날짜가 된다 — 🔴 그 건의 version 도 오른다", async () => {
    const caseId = await createCase();
    // 이미 나간 건이어야 한다(아직 출하 전인 건에는 밀어 넣지 않는다 — 아래 시험).
    await db
      .update(repairCases)
      .set({ actualShipmentDate: "2097-09-20" })
      .where(eq(repairCases.id, caseId));
    const order = await createOrder({ repairCaseId: caseId, dueDates: [row("2097-10-20")] });
    const caseBefore = await readCase(caseId);

    const saved = await saveRows(
      order.id,
      [row("2097-10-20", { deliveredDate: "2097-10-22", deliveredBy: "담당자1" })],
      { repairCaseId: caseId }
    );
    assert.equal(saved.ok, true, JSON.stringify(saved));
    if (!saved.ok) return;
    assert.deepEqual(saved.deliveredDateLink, { linked: true });

    const caseAfter = await readCase(caseId);
    assert.equal(caseAfter.actualShipmentDate, "2097-10-22");
    // 🔴 version 이 올라야 열려 있던 수리 건 상세가 이 날짜를 덮지 못한다.
    assert.equal(caseAfter.version, caseBefore.version + 1, "수리 건의 version 이 그대로다");
  });

  test("🔴 아직 출하 완료되지 않은 건에는 **밀어 넣지 않고 말한다** — 종 알림 넷의 침묵 스위치다", async () => {
    const caseId = await createCase();
    const order = await createOrder({ repairCaseId: caseId, dueDates: [row("2097-10-20")] });

    const saved = await saveRows(
      order.id,
      [row("2097-10-20", { deliveredDate: "2097-10-22" })],
      { repairCaseId: caseId }
    );
    assert.equal(saved.ok, true, JSON.stringify(saved));
    if (!saved.ok) return;
    assert.equal(saved.deliveredDateLink?.linked, false);
    if (saved.deliveredDateLink?.linked !== false) return;
    assert.equal(saved.deliveredDateLink.reason, "NOT_SHIPPED");

    // 🔴 내자 쪽은 저장됐고, 수리 건은 한 글자도 안 바뀌었다.
    assert.equal((await readRows(order.id))[0].deliveredDate, "2097-10-22");
    assert.equal((await readCase(caseId)).actualShipmentDate, null, "안 나간 건에 출하일이 찍혔다");
  });

  test("🔴 인수일보다 이른 날짜는 수리 건에 반영하지 않는다 — 저쪽 잣대를 우회하지 않는다", async () => {
    const caseId = await createCase();
    await db
      .update(repairCases)
      .set({ actualShipmentDate: "2097-09-20" })
      .where(eq(repairCases.id, caseId));
    const order = await createOrder({ repairCaseId: caseId, dueDates: [row("2097-10-20")] });

    // 인수일은 2097-09-05 다.
    const saved = await saveRows(
      order.id,
      [row("2097-10-20", { deliveredDate: "2097-09-01" })],
      { repairCaseId: caseId }
    );
    assert.equal(saved.ok, true, JSON.stringify(saved));
    if (!saved.ok) return;
    assert.equal(saved.deliveredDateLink?.linked, false);
    if (saved.deliveredDateLink?.linked !== false) return;
    assert.equal(saved.deliveredDateLink.reason, "BLOCKED_BY_RECEIVED_AT");
    assert.equal((await readCase(caseId)).actualShipmentDate, "2097-09-20", "잣대를 우회했다");
  });

  test("🔴 납품일을 지워도 수리 건의 출하일은 그대로다 — 저쪽은 비우기를 거절한다", async () => {
    const caseId = await createCase();
    await db
      .update(repairCases)
      .set({ actualShipmentDate: "2097-09-20" })
      .where(eq(repairCases.id, caseId));
    const order = await createOrder({ repairCaseId: caseId, dueDates: [row("2097-10-20")] });

    // 먼저 적는다 — 이 저장이 수리 건의 출하일을 2097-10-22 로 맞춘다.
    const written = await saveRows(
      order.id,
      [row("2097-10-20", { deliveredDate: "2097-10-22" })],
      { repairCaseId: caseId }
    );
    assert.equal(written.ok, true, JSON.stringify(written));
    assert.equal((await readCase(caseId)).actualShipmentDate, "2097-10-22", "전제가 깨졌다 — 안 묶였다");
    const caseBefore = await readCase(caseId);

    // 🔴 그다음 지운다 — 수리 건 쪽은 **한 글자도 안 바뀐다**(version 까지).
    const cleared = await saveRows(order.id, [row("2097-10-20")], { repairCaseId: caseId });
    assert.equal(cleared.ok, true, JSON.stringify(cleared));
    if (!cleared.ok) return;
    assert.equal(cleared.deliveredDateLink, undefined, "지우는 저장이 「무슨 일이 있었다」로 올라왔다");
    assert.equal((await readRows(order.id))[0].deliveredDate, null, "내자 쪽은 지워져야 한다");
    const caseAfter = await readCase(caseId);
    assert.equal(caseAfter.actualShipmentDate, "2097-10-22");
    assert.equal(caseAfter.version, caseBefore.version, "지우는 저장이 수리 건을 건드렸다");
  });

  test("🔴 version 이 어긋나면 수리 건도 한 글자도 안 바뀐다 — 한쪽만 써지는 길이 없다", async () => {
    const caseId = await createCase();
    await db
      .update(repairCases)
      .set({ actualShipmentDate: "2097-09-20" })
      .where(eq(repairCases.id, caseId));
    const order = await createOrder({ repairCaseId: caseId, dueDates: [row("2097-10-20")] });
    const caseBefore = await readCase(caseId);

    const conflicted = await updateDomesticOrder({
      id: order.id,
      // 낡은 판 번호다 — 그 사이 남이 먼저 저장한 상태를 흉내 낸다.
      expectedVersion: order.version + 5,
      fields: fields({
        repairCaseId: caseId,
        dueDates: [row("2097-10-20", { deliveredDate: "2097-10-22" })],
      }),
      actorUserId,
    });
    assert.equal(conflicted.ok, false);
    if (conflicted.ok) return;
    assert.equal(conflicted.code, "CONFLICT");

    const caseAfter = await readCase(caseId);
    assert.equal(caseAfter.actualShipmentDate, "2097-09-20");
    assert.equal(caseAfter.version, caseBefore.version, "충돌한 저장이 수리 건을 건드렸다");
  });
});

describe("수리 건 → 내자", () => {
  test("실제 출하일을 고치면 행의 납품일이 따라온다 — 🔴 행도 비고도 납품자도 그대로다", async () => {
    const caseId = await createCase();
    await db
      .update(repairCases)
      .set({ actualShipmentDate: "2097-09-20" })
      .where(eq(repairCases.id, caseId));
    const order = await createOrder({
      repairCaseId: caseId,
      dueDates: [
        row("2097-10-20", { note: "1차분", deliveredDate: "2097-09-20", deliveredBy: "담당자1" }),
      ],
    });
    const [rowBefore] = await readRows(order.id);
    const orderBefore = await readOrder(order.id);

    const saved = await saveCaseShipmentDate(caseId, "2097-09-25");
    assert.equal(saved.ok, true, JSON.stringify(saved));
    if (!saved.ok) return;
    assert.deepEqual(saved.deliveredDateLink, { linked: true });

    const rows = await readRows(order.id);
    assert.equal(rows.length, 1, "행이 늘거나 줄었다 — 날짜 칸만 고쳐야 한다");
    assert.equal(rows[0].deliveredDate, "2097-09-25");
    // 🔴 같은 행이어야 한다. 지우고 새로 만드는 방식이면 id 가 바뀌고, 그때 비고와
    //    납품자가 말없이 사라진다.
    assert.equal(rows[0].id, rowBefore.id, "행을 지우고 새로 만들었다");
    assert.equal(rows[0].note, "1차분", "비고가 사라졌다");
    assert.equal(rows[0].deliveredBy, "담당자1", "납품자가 사라졌다");
    assert.equal(rows[0].dueDate, "2097-10-20", "납기요청일이 함께 바뀌었다");

    // 🔴 그 줄의 version 이 올라야 열려 있던 내자 정리 화면이 이 날짜를 덮지 못한다.
    const orderAfter = await readOrder(order.id);
    assert.equal(orderAfter.version, orderBefore.version + 1, "내자 줄의 version 이 그대로다");
    assert.equal(orderAfter.updatedBy, actorUserId);
  });

  test("🔴 내자에 행이 없으면 만들지 않는다 — 그 줄은 이미 이 날짜를 빌려 그린다", async () => {
    const caseId = await createCase();
    await db
      .update(repairCases)
      .set({ actualShipmentDate: "2097-09-20" })
      .where(eq(repairCases.id, caseId));
    const order = await createOrder({ repairCaseId: caseId, dueDates: [] });
    const orderBefore = await readOrder(order.id);

    const saved = await saveCaseShipmentDate(caseId, "2097-09-25");
    assert.equal(saved.ok, true, JSON.stringify(saved));
    if (!saved.ok) return;
    assert.equal(saved.deliveredDateLink, undefined);

    assert.deepEqual(await readRows(order.id), [], "없던 납기요청일 행이 생겼다");
    assert.equal((await readOrder(order.id)).version, orderBefore.version);
  });

  test("🔴 행이 여럿이면 바꾸지 않고 **까닭을 돌려준다**", async () => {
    const caseId = await createCase();
    await db
      .update(repairCases)
      .set({ actualShipmentDate: "2097-09-20" })
      .where(eq(repairCases.id, caseId));
    const order = await createOrder({ repairCaseId: caseId, dueDates: [row("2097-10-20")] });
    await addExtraRowBySql(order.id, "2097-11-15");

    const saved = await saveCaseShipmentDate(caseId, "2097-09-25");
    assert.equal(saved.ok, true, JSON.stringify(saved));
    if (!saved.ok) return;
    assert.equal(saved.deliveredDateLink?.linked, false);
    if (saved.deliveredDateLink?.linked !== false) return;
    assert.equal(saved.deliveredDateLink.reason, "AMBIGUOUS");

    const rows = await readRows(order.id);
    assert.deepEqual(rows.map((entry) => entry.deliveredDate), [null, null], "행 하나가 몰래 바뀌었다");
    // 수리 건 쪽은 저장됐다 — 「저장 자체가 실패했다」가 아니다.
    assert.equal((await readCase(caseId)).actualShipmentDate, "2097-09-25");
  });

  test("🔴 수리 건 쪽 잣대 셋은 그대로다 — 비울 수 없다 · 인수일보다 이를 수 없다 · 출하 전엔 못 적는다", async () => {
    const caseId = await createCase();
    const order = await createOrder({
      repairCaseId: caseId,
      dueDates: [row("2097-10-20", { deliveredDate: "2097-10-22" })],
    });

    // ① 아직 출하 전인 건에는 적을 수 없다(그 경로 자체가 막혀 있다).
    const beforeShipment = await saveCaseShipmentDate(caseId, "2097-09-25");
    assert.equal(beforeShipment.ok, false);
    if (!beforeShipment.ok) assert.equal(beforeShipment.code, "VALIDATION_ERROR");

    await db
      .update(repairCases)
      .set({ actualShipmentDate: "2097-09-20" })
      .where(eq(repairCases.id, caseId));

    // ② 비울 수 없다.
    const cleared = await saveCaseShipmentDate(caseId, null);
    assert.equal(cleared.ok, false);
    if (!cleared.ok) {
      assert.ok(cleared.fieldErrors?.actualShipmentDate?.includes("비울 수 없습니다"));
    }

    // ③ 인수일(2097-09-05)보다 이를 수 없다.
    const tooEarly = await saveCaseShipmentDate(caseId, "2097-09-01");
    assert.equal(tooEarly.ok, false);
    if (!tooEarly.ok) {
      assert.ok(tooEarly.fieldErrors?.actualShipmentDate?.includes("인수일보다"));
    }

    // 🔴 거절된 저장은 내자 쪽도 한 글자도 안 바꾼다.
    assert.equal((await readRows(order.id))[0].deliveredDate, "2097-10-22");
  });
});

describe("출하 완료 전이", () => {
  test("🔴 [출하 완료]가 연결된 줄의 **빈 행**에 오늘 날짜를 찍는다 (사용자 결정 6)", async () => {
    const caseId = await createCase();
    const order = await createOrder({ repairCaseId: caseId, dueDates: [row("2097-10-20", { note: "1차분" })] });
    await placeCaseAtWaitingShipment(caseId);
    await grantFinalShipmentApproval(caseId);
    const orderBefore = await readOrder(order.id);

    const caseVersion = (await readCase(caseId)).version;
    const shipped = await transitionWorkflow(caseId, caseVersion, "SHIPMENT_COMPLETED", representativeId, "출하 완료");
    assert.equal(shipped.ok, true, JSON.stringify(shipped));
    if (!shipped.ok) return;
    assert.deepEqual(shipped.deliveredDateLink, { linked: true });

    const today = shipmentStampToday();
    assert.equal((await readCase(caseId)).actualShipmentDate, today);
    const rows = await readRows(order.id);
    assert.equal(rows[0].deliveredDate, today, "출하 완료가 내자 납품일을 안 찍었다");
    assert.equal(rows[0].note, "1차분", "비고가 사라졌다");
    // 🔵 **납품자는 안 찍는다** — 전이를 누른 사람이 보낸 사람과 다를 수 있다.
    assert.equal(rows[0].deliveredBy, null);
    // 🔴 그 줄의 version 도 오른다.
    assert.equal((await readOrder(order.id)).version, orderBefore.version + 1);
  });

  test("🔴 [출하 완료]는 **이미 적힌 납품일을 덮지 않는다** — 운송 시차가 말없이 사라진다", async () => {
    const caseId = await createCase();
    const order = await createOrder({
      repairCaseId: caseId,
      dueDates: [row("2097-10-20", { deliveredDate: "2097-10-22", deliveredBy: "담당자1" })],
    });
    await placeCaseAtWaitingShipment(caseId);
    await grantFinalShipmentApproval(caseId);
    const orderBefore = await readOrder(order.id);

    const caseVersion = (await readCase(caseId)).version;
    const shipped = await transitionWorkflow(caseId, caseVersion, "SHIPMENT_COMPLETED", representativeId, "출하 완료");
    assert.equal(shipped.ok, true, JSON.stringify(shipped));
    if (!shipped.ok) return;
    assert.equal(shipped.deliveredDateLink, undefined, "덮지 않았는데 「무슨 일이 있었다」로 올라왔다");

    const rows = await readRows(order.id);
    assert.equal(rows[0].deliveredDate, "2097-10-22", "자동 처리가 손으로 적은 납품일을 덮었다");
    assert.equal(rows[0].deliveredBy, "담당자1");
    assert.equal((await readOrder(order.id)).version, orderBefore.version, "안 바꿨는데 version 이 올랐다");
  });

  test("🔴 납기요청일 행이 여럿이면 자동으로 안 찍고 말한다 (사용자 결정 7)", async () => {
    const caseId = await createCase();
    const order = await createOrder({ repairCaseId: caseId, dueDates: [row("2097-10-20")] });
    await addExtraRowBySql(order.id, "2097-11-15");
    await placeCaseAtWaitingShipment(caseId);
    await grantFinalShipmentApproval(caseId);

    const caseVersion = (await readCase(caseId)).version;
    const shipped = await transitionWorkflow(caseId, caseVersion, "SHIPMENT_COMPLETED", representativeId, "출하 완료");
    assert.equal(shipped.ok, true, JSON.stringify(shipped));
    if (!shipped.ok) return;
    assert.equal(shipped.deliveredDateLink?.linked, false);
    if (shipped.deliveredDateLink?.linked !== false) return;
    assert.equal(shipped.deliveredDateLink.reason, "AMBIGUOUS");

    // 수리 건은 나갔고, 내자의 행들은 한 글자도 안 바뀌었다.
    assert.equal((await readCase(caseId)).actualShipmentDate, shipmentStampToday());
    assert.deepEqual(
      (await readRows(order.id)).map((entry) => entry.deliveredDate),
      [null, null]
    );
  });
});
