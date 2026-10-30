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
import { createDomesticOrder, updateDomesticOrder } from "./domestic-orders";
import type { DomesticOrderFields } from "@/lib/validation/domestic-order-input";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 🔴 `납기요청일` ↔ `고객 요청 납기일` — **어느 쪽에서 고쳐도 같은 날짜인가**
 * ============================================================================
 * 2026-10-30 사용자 요구: 「어느 쪽에서 수정하든 같은 날짜를 보고 있을 수 있도록」.
 * 규칙은 순수 함수 한 벌이 가지고(domain/requested-due-date-link.ts, 그 시험이
 * 갈림을 전부 본다), **이 파일이 보는 것은 DB 에 정말 그렇게 쓰이는가**다:
 *
 *  · 바뀌어야 할 칸이 바뀌는가 — 그리고 **반대쪽 version 까지 올라가는가**.
 *    안 올라가면 열려 있던 상대 화면이 낡은 값으로 저장해도 통과해서, 방금 맞춘
 *    날짜를 제 옛 값으로 되돌린다.
 *  · 🔴 **안 바뀌어야 할 것이 안 바뀌는가** — 행을 만들지도 지우지도 않고,
 *    비고가 살아남고, 날짜를 안 건드린 저장은 상대 칸을 덮지 않는다.
 *  · 🔴 **한쪽만 써지는 길이 없는가** — version 이 어긋나 CONFLICT 로 끝난 저장은
 *    상대 칸을 한 글자도 바꾸지 않는다(같은 트랜잭션이라는 사실을 값으로 본다).
 *  · 묶지 못했을 때 **까닭이 결과에 실려 나오는가** — 조용히 건너뛰면 사람은
 *    양쪽이 맞춰진 줄 안다.
 *
 * 인가는 여기서 보지 않는다(이 계층은 기계다 — mutations 파일 헤더의 계층 구분).
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 스위트만 쓰는 접수 월 "9608", 고객사 접두사 "AS-TEST-DUE-LINK-",
 * 제품 모델 접두사 "DUE-LINK-TEST-". 인수번호의 연월은 receivedAt 에서 나오므로
 * TEST_YEAR_MONTH 와 TEST_RECEIVED_AT 은 언제나 같은 달을 가리켜야 한다.
 *
 * after() 는 FK 차례대로 지운다 — domestic_orders 가 먼저다(repair_cases 와
 * customers 를 가리킨다). 납기요청일 행은 그 줄을 지우면 CASCADE 로 함께 사라진다.
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-DUE-LINK-";
const TEST_MODEL_PREFIX = "DUE-LINK-TEST-";
const TEST_YEAR_MONTH = "9608";
const TEST_RECEIVED_AT = "2096-08-05";

let actorUserId: string;
let engineerId: string;
let customerId: string;
const createdOrderIds: string[] = [];

function baseCreateRepairCaseInput(
  customerRequestedDueDate: string | null
): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
    customerId,
    endUserId: null,
    assignedEngineerId: engineerId,
    receivedAt: TEST_RECEIVED_AT,
    customerRequestedDueDate,
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

async function createCase(customerRequestedDueDate: string | null): Promise<string> {
  const result = await createRepairCase(baseCreateRepairCaseInput(customerRequestedDueDate));
  assert.equal(result.ok, true, `setup repair case failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result.id;
}

async function createOrder(overrides: Partial<DomesticOrderFields> = {}): Promise<string> {
  const result = await createDomesticOrder({ fields: fields(overrides), actorUserId });
  assert.equal(result.ok, true, `setup domestic order failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdOrderIds.push(result.id);
  return result.id;
}

async function readCase(id: string) {
  const [row] = await db
    .select({
      customerRequestedDueDate: repairCases.customerRequestedDueDate,
      version: repairCases.version,
    })
    .from(repairCases)
    .where(eq(repairCases.id, id));
  return row;
}

async function readOrder(id: string) {
  const [row] = await db
    .select({ version: domesticOrders.version, updatedBy: domesticOrders.updatedBy })
    .from(domesticOrders)
    .where(eq(domesticOrders.id, id));
  return row;
}

/** 그 줄의 납기요청일 행 — **id 까지** 읽는다(행이 새로 만들어졌는지 보려고). */
async function readDueDateRows(orderId: string) {
  return db
    .select({
      id: domesticOrderDueDates.id,
      dueDate: domesticOrderDueDates.dueDate,
      note: domesticOrderDueDates.note,
      displayOrder: domesticOrderDueDates.displayOrder,
    })
    .from(domesticOrderDueDates)
    .where(eq(domesticOrderDueDates.domesticOrderId, orderId))
    .orderBy(asc(domesticOrderDueDates.displayOrder), asc(domesticOrderDueDates.dueDate));
}

/** 수리 건의 고객 요청 납기일만 고치는 저장. 화면의 인수정보 저장과 같은 길이다. */
async function saveCaseDueDate(caseId: string, dueDate: string | null) {
  const before = await readCase(caseId);
  return updateRepairCase(
    caseId,
    before.version,
    "INTAKE",
    { customerRequestedDueDate: dueDate },
    actorUserId
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
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db
    .delete(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

describe("수리 건 → 내자", () => {
  test("고객 요청 납기일을 고치면 내자의 납기요청일이 같은 날짜가 된다 — 🔴 행도 비고도 그대로다", async () => {
    const caseId = await createCase("2096-09-01");
    const orderId = await createOrder({
      repairCaseId: caseId,
      dueDates: [{ dueDate: "2096-09-01", note: "1차분" }],
    });
    const [rowBefore] = await readDueDateRows(orderId);
    const orderBefore = await readOrder(orderId);

    const result = await saveCaseDueDate(caseId, "2096-10-15");
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.deepEqual(result.requestedDueDateLink, { linked: true });

    const rows = await readDueDateRows(orderId);
    assert.equal(rows.length, 1, "행이 늘거나 줄었다 — 날짜 칸만 고쳐야 한다");
    assert.equal(rows[0].dueDate, "2096-10-15");
    // 🔴 같은 행이어야 한다. 지우고 새로 만드는 방식이면 id 가 바뀌고, 그때 비고가
    // 말없이 사라진다(운영에 비고가 적힌 행이 5행 있다).
    assert.equal(rows[0].id, rowBefore.id, "행을 지우고 새로 만들었다");
    assert.equal(rows[0].note, "1차분", "비고가 사라졌다");
    assert.equal(rows[0].displayOrder, rowBefore.displayOrder);

    // 🔴 그 줄의 version 이 올라야 열려 있던 내자 정리 화면이 이 날짜를 덮지 못한다.
    const orderAfter = await readOrder(orderId);
    assert.equal(orderAfter.version, orderBefore.version + 1, "내자 줄의 version 이 그대로다");
    assert.equal(orderAfter.updatedBy, actorUserId);
  });

  test("🔴 내자에 날짜 행이 없으면 만들지 않는다 — 그 줄은 이미 이 날짜를 빌려 그린다", async () => {
    const caseId = await createCase("2096-09-01");
    const orderId = await createOrder({ repairCaseId: caseId, dueDates: [] });
    const orderBefore = await readOrder(orderId);

    const result = await saveCaseDueDate(caseId, "2096-10-15");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // 할 일이 없었으므로 아무 말도 하지 않는다 — 화면이 「무슨 일이 있었다」로 읽지
    // 않게. 알림이 뜰 자리가 아니다.
    assert.equal(result.requestedDueDateLink, undefined);

    assert.deepEqual(await readDueDateRows(orderId), [], "없던 납기요청일 행이 생겼다");
    const orderAfter = await readOrder(orderId);
    assert.equal(orderAfter.version, orderBefore.version, "건드리지 않았는데 version 이 올랐다");
  });

  test("🔴 날짜가 여럿이면 바꾸지 않고 **까닭을 돌려준다**", async () => {
    const caseId = await createCase("2096-09-01");
    const orderId = await createOrder({
      repairCaseId: caseId,
      dueDates: [
        { dueDate: "2096-09-01", note: "1차분" },
        { dueDate: "2096-09-20", note: "2차분" },
      ],
    });

    const result = await saveCaseDueDate(caseId, "2096-10-15");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.requestedDueDateLink?.linked, false);
    if (result.requestedDueDateLink?.linked !== false) return;
    assert.equal(result.requestedDueDateLink.reason, "AMBIGUOUS");
    assert.match(result.requestedDueDateLink.message, /내자 정리의 납기요청일은 그대로/);

    // 수리 건 쪽은 저장됐고, 내자 쪽은 두 행 그대로다.
    assert.equal((await readCase(caseId)).customerRequestedDueDate, "2096-10-15");
    assert.deepEqual(
      (await readDueDateRows(orderId)).map((row) => row.dueDate),
      ["2096-09-01", "2096-09-20"]
    );
  });

  test("🔴 고객 요청 납기일을 지워도 내자 행은 그대로다 — 비고째 사라지면 안 된다", async () => {
    const caseId = await createCase("2096-09-01");
    const orderId = await createOrder({
      repairCaseId: caseId,
      dueDates: [{ dueDate: "2096-09-01", note: "1차분" }],
    });

    const result = await saveCaseDueDate(caseId, null);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.requestedDueDateLink, undefined);

    assert.equal((await readCase(caseId)).customerRequestedDueDate, null);
    const rows = await readDueDateRows(orderId);
    assert.equal(rows.length, 1, "수리 건의 날짜를 지웠더니 내자 행이 사라졌다");
    assert.equal(rows[0].dueDate, "2096-09-01");
    assert.equal(rows[0].note, "1차분");
  });

  test("🔴 version 이 어긋난 저장은 내자 날짜를 한 건도 바꾸지 않는다", async () => {
    // 한쪽만 써지는 길이 있는지 보는 시험이다. 날짜를 먼저 고쳐 놓고 version 을 보면,
    // 충돌한 저장이 남의 날짜를 바꿔 놓은 채로 실패한다.
    const caseId = await createCase("2096-09-01");
    const orderId = await createOrder({
      repairCaseId: caseId,
      dueDates: [{ dueDate: "2096-09-01", note: "1차분" }],
    });
    const stale = (await readCase(caseId)).version - 1;

    const result = await updateRepairCase(
      caseId,
      stale,
      "INTAKE",
      { customerRequestedDueDate: "2096-10-15" },
      actorUserId
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "CONFLICT");

    const rows = await readDueDateRows(orderId);
    assert.equal(rows[0].dueDate, "2096-09-01", "실패한 저장이 내자 날짜를 바꿔 놓았다");
    assert.equal((await readCase(caseId)).customerRequestedDueDate, "2096-09-01");
  });
});

describe("내자 → 수리 건", () => {
  test("납기요청일을 고치면 수리 건의 고객 요청 납기일이 같은 날짜가 된다", async () => {
    const caseId = await createCase("2096-09-01");
    const orderId = await createOrder({
      repairCaseId: caseId,
      dueDates: [{ dueDate: "2096-09-01", note: "1차분" }],
    });
    const caseBefore = await readCase(caseId);

    const result = await updateDomesticOrder({
      id: orderId,
      expectedVersion: (await readOrder(orderId)).version,
      fields: fields({
        repairCaseId: caseId,
        dueDates: [{ dueDate: "2096-11-20", note: "1차분" }],
      }),
      actorUserId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.deepEqual(result.requestedDueDateLink, { linked: true });

    const caseAfter = await readCase(caseId);
    assert.equal(caseAfter.customerRequestedDueDate, "2096-11-20");
    // 🔴 version 이 올라야 열려 있던 수리 건 상세가 이 날짜를 덮지 못한다.
    assert.equal(caseAfter.version, caseBefore.version + 1, "수리 건의 version 이 그대로다");
  });

  test("🔴 수리 건 쪽이 비어 있으면 채우지 않는다 — 그 건은 이 날짜를 빌려 그린다", async () => {
    const caseId = await createCase(null);
    const orderId = await createOrder({
      repairCaseId: caseId,
      dueDates: [{ dueDate: "2096-09-01", note: null }],
    });
    const caseBefore = await readCase(caseId);

    const result = await updateDomesticOrder({
      id: orderId,
      expectedVersion: (await readOrder(orderId)).version,
      fields: fields({ repairCaseId: caseId, dueDates: [{ dueDate: "2096-11-20", note: null }] }),
      actorUserId,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.requestedDueDateLink, undefined);

    const caseAfter = await readCase(caseId);
    assert.equal(caseAfter.customerRequestedDueDate, null, "빌려 그리던 건에 날짜가 박혔다");
    assert.equal(caseAfter.version, caseBefore.version, "건드리지 않았는데 version 이 올랐다");
  });

  test("🔴 인수일보다 이른 날짜는 수리 건에 넣지 않고 까닭을 돌려준다 — 잣대를 우회하지 않는다", async () => {
    const caseId = await createCase("2096-09-01");
    const orderId = await createOrder({
      repairCaseId: caseId,
      dueDates: [{ dueDate: "2096-09-01", note: null }],
    });

    const result = await updateDomesticOrder({
      id: orderId,
      expectedVersion: (await readOrder(orderId)).version,
      // 인수일은 2096-08-05 다.
      fields: fields({ repairCaseId: caseId, dueDates: [{ dueDate: "2096-08-01", note: null }] }),
      actorUserId,
    });
    assert.equal(result.ok, true, "내자 쪽 저장까지 막으면 안 된다 — 그쪽에는 그 잣대가 없다");
    if (!result.ok) return;
    assert.equal(result.requestedDueDateLink?.linked, false);
    if (result.requestedDueDateLink?.linked !== false) return;
    assert.equal(result.requestedDueDateLink.reason, "BLOCKED_BY_RECEIVED_AT");
    assert.match(result.requestedDueDateLink.message, /인수일/);

    // 내자 줄은 저장됐고, 수리 건은 그대로다.
    assert.deepEqual(
      (await readDueDateRows(orderId)).map((row) => row.dueDate),
      ["2096-08-01"]
    );
    assert.equal((await readCase(caseId)).customerRequestedDueDate, "2096-09-01");
  });

  test("🔴 날짜를 안 건드린 저장은 수리 건을 덮지 않는다 — 다른 칸만 고쳤다", async () => {
    // 양쪽이 **서로 다른 날짜**인 상태(운영 실측의 ③)에서 발주서번호 하나를 고친다.
    // 내자 정리는 어느 칸을 고쳐도 줄 전체를 다시 보내므로, 여기가 깨지면 그 저장이
    // 수리 건의 날짜를 조용히 덮는다.
    const caseId = await createCase(null);
    const orderId = await createOrder({
      repairCaseId: caseId,
      purchaseOrderNumber: "PO-BEFORE",
      dueDates: [{ dueDate: "2096-09-20", note: "1차분" }],
    });
    // 🔴 **줄을 만든 뒤에** 수리 건의 날짜를 적는다 — 줄을 만드는 저장도 묶기를 타므로
    // (바로 아래 시험), 먼저 적어 두면 그 create 가 이 값을 2096-09-20 으로 덮어
    // 「양쪽이 다른 상태」라는 이 시험의 전제가 사라진다. 그래서 여기서는 화면 길이
    // 아니라 표에 바로 적는다(운영 실측의 ③ 상태를 그대로 만든다).
    await db
      .update(repairCases)
      .set({ customerRequestedDueDate: "2096-12-01" })
      .where(eq(repairCases.id, caseId));
    const caseBefore = await readCase(caseId);
    assert.equal(caseBefore.customerRequestedDueDate, "2096-12-01", "전제가 깨졌다");

    const result = await updateDomesticOrder({
      id: orderId,
      expectedVersion: (await readOrder(orderId)).version,
      fields: fields({
        repairCaseId: caseId,
        purchaseOrderNumber: "PO-AFTER",
        // 화면이 되실어 보내는 것과 같은 목록이다(차례도 그대로).
        dueDates: [{ dueDate: "2096-09-20", note: "1차분" }],
      }),
      actorUserId,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.requestedDueDateLink, undefined);

    const caseAfter = await readCase(caseId);
    assert.equal(caseAfter.customerRequestedDueDate, "2096-12-01", "안 고친 날짜가 덮였다");
    assert.equal(caseAfter.version, caseBefore.version);
  });

  test("새 줄을 만들면서 적은 납기요청일도 수리 건과 묶인다", async () => {
    const caseId = await createCase("2096-09-01");
    const result = await createDomesticOrder({
      fields: fields({
        repairCaseId: caseId,
        dueDates: [{ dueDate: "2096-11-20", note: null }],
      }),
      actorUserId,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    createdOrderIds.push(result.id);
    assert.deepEqual(result.requestedDueDateLink, { linked: true });
    assert.equal((await readCase(caseId)).customerRequestedDueDate, "2096-11-20");
  });

  test("🔴 그 건에 내자 줄이 둘이면 수리 건을 바꾸지 않고 까닭을 돌려준다", async () => {
    const caseId = await createCase("2096-09-01");
    const firstId = await createOrder({
      repairCaseId: caseId,
      dueDates: [{ dueDate: "2096-09-10", note: "1차 발주" }],
    });
    await createOrder({
      repairCaseId: caseId,
      dueDates: [{ dueDate: "2096-09-25", note: "2차 발주" }],
    });
    // 🔴 **지금 적혀 있는 값**을 기준으로 삼는다 — 첫 줄을 만든 저장은 줄이 하나였으므로
    // 그때 이미 묶였고(바로 위 시험), 둘째 줄부터 「여럿」이 된다. 처음 적은 값으로
    // 견주면 이 시험은 그 사실 때문에 깨진다.
    const caseBefore = await readCase(caseId);

    const result = await updateDomesticOrder({
      id: firstId,
      expectedVersion: (await readOrder(firstId)).version,
      fields: fields({ repairCaseId: caseId, dueDates: [{ dueDate: "2096-11-20", note: "1차 발주" }] }),
      actorUserId,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.requestedDueDateLink?.linked, false);
    if (result.requestedDueDateLink?.linked !== false) return;
    assert.equal(result.requestedDueDateLink.reason, "AMBIGUOUS");

    // 고친 줄은 저장됐고, 수리 건은 그대로다.
    assert.deepEqual(
      (await readDueDateRows(firstId)).map((row) => row.dueDate),
      ["2096-11-20"]
    );
    const caseAfter = await readCase(caseId);
    assert.equal(caseAfter.customerRequestedDueDate, caseBefore.customerRequestedDueDate);
    assert.equal(caseAfter.version, caseBefore.version);
  });
});
