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
import { createDomesticOrder, setDomesticOrderDueDateRowConfirmation } from "./domestic-orders";
import { confirmedDueDateRowBlocksRepairCaseSyncMessage } from "@/lib/domain/domestic-order-due-date-rows";
import type { DomesticOrderFields } from "@/lib/validation/domestic-order-input";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 🔴 **확정된 회차에는 수리 건의 날짜가 흘러들지 못한다** (2026-11-25)
 * ============================================================================
 * 회차별 [납기일 확정]은 「이 날짜가 더 이상 안 바뀐다」는 잠금이고, 내자 쪽 저장
 * 통로에서는 울타리 하나가 그것을 지킨다(domain/domestic-order-due-date-rows.ts 의
 * 넷째 울타리). 🔴 **그런데 길이 하나 더 있었다**: 수리 건 상세에서 고객 요청
 * 납기일을 고치면 연결된 내자 회차의 날짜가 **묶기로** 따라간다
 * (mutations/repair-cases.ts). 그 길은 저장 payload 가 아니라 한 칸 UPDATE 라 울타리를
 * 안 지나고, 그래서 **확정된 날짜가 바뀌고 확정 표시만 남는** 상태가 열려 있었다.
 *
 * 사용자 결정(2026-11-25): 「**거절하되 왜 거절되는지 팝업으로** 알려주도록 해」.
 *
 * ── 🔴 이 파일이 지키는 것 ──────────────────────────────────────────────
 *  ① 🔵 **확정되지 않은 회차는 예전 그대로 맞춰진다.** 🔴 **이것이 먼저다** — 「막는가」만
 *     재면 **전부 막아 버린 구현**이 그대로 통과하고, 그러면 2026-10-30 에 만든 묶기가
 *     통째로 죽는다(사용자가 고친 바로 그 어긋남이 되돌아온다).
 *  ② 🔴 **확정된 회차가 걸리면 저장이 거절된다** — 그리고 **내자의 날짜도 확정도,
 *     수리 건의 날짜도 version 도** 한 글자가 안 바뀐다(값으로 본다).
 *  ③ 🔴 **거절은 그 저장 통째다** — 같은 저장에 실려 온 **다른 칸**도 안 바뀐다
 *     (사용자가 말한 「거절」이고, 반쯤 저장되는 것이 제일 나쁘다).
 *  ④ 🔴 **날짜를 안 바꾸는 저장은 확정된 회차가 있어도 통과한다** — 묶기가 애초에
 *     할 일이 없는 저장이다. 이것을 안 재면 「확정된 회차가 있으면 무조건 거절」이
 *     통과해서, 확정한 건은 **인수정보를 영영 못 고치는 건**이 된다.
 *  ⑤ 🔵 **[확정 해제] 뒤에는 다시 맞춰진다** — 막다른 길이 아니라는 사실.
 *  ⑥ 🔴 **거절 문구에 까닭과 길이 담긴다** — 어느 회차인지 · 어느 화면에서 · 무엇을.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 스위트만 쓰는 접수 월 "9512", 고객사 접두사 "AS-TEST-DUE-CONFIRM-LINK-",
 * 제품 모델 접두사 "DUE-CONFIRM-LINK-TEST-". 인수번호의 연월은 receivedAt 에서
 * 나오므로 TEST_YEAR_MONTH 와 TEST_RECEIVED_AT 은 같은 달을 가리켜야 한다.
 * 만드는 내자 줄은 id 를 모아 두었다가 그대로 지운다(납기요청일 행은 CASCADE).
 *
 * 🔴 **계정을 만들지 않는다** — 이웃 requested-due-date-link.integration.test.ts 와 같이
 * 이미 있는 승인된 엔지니어 하나를 빌려 쓴다. 이 파일은 인가를 재지 않는다(그 관문은
 * domestic-order-due-date-confirmation.integration.test.ts ⑥ 이 잰다).
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-DUE-CONFIRM-LINK-";
const TEST_MODEL_PREFIX = "DUE-CONFIRM-LINK-TEST-";
const TEST_YEAR_MONTH = "9512";
const TEST_RECEIVED_AT = "2095-12-05";

/** 처음 적혀 있는 납기일. 🔴 **확정은 이 날짜에 걸린다.** */
const DUE_1 = "2096-01-10";
/** 수리 건에서 **옮기려고** 보내는 날짜. 이 저장이 거절되는 것이 ② 의 요점이다. */
const DUE_MOVED = "2096-02-20";

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
  assert.equal(result.ok, true, `접수 건 만들기 실패: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result.id;
}

async function createOrder(overrides: Partial<DomesticOrderFields> = {}) {
  const result = await createDomesticOrder({ fields: fields(overrides), actorUserId });
  assert.equal(result.ok, true, `내자 줄 만들기 실패: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdOrderIds.push(result.id);
  return { id: result.id, version: result.version };
}

/** 조회 매퍼를 거치지 않은 **DB 그대로의 건**. 대조는 언제나 이 값으로 한다. */
async function readCase(id: string) {
  const [row] = await db
    .select({
      customerRequestedDueDate: repairCases.customerRequestedDueDate,
      priority: repairCases.priority,
      version: repairCases.version,
    })
    .from(repairCases)
    .where(eq(repairCases.id, id));
  return row;
}

/** 그 줄의 회차들 — **차례대로**, 확정 두 칸까지 들고 온다. */
async function readRows(orderId: string) {
  return db
    .select({
      id: domesticOrderDueDates.id,
      dueDate: domesticOrderDueDates.dueDate,
      note: domesticOrderDueDates.note,
      displayOrder: domesticOrderDueDates.displayOrder,
      confirmedAt: domesticOrderDueDates.confirmedAt,
      confirmedBy: domesticOrderDueDates.confirmedBy,
    })
    .from(domesticOrderDueDates)
    .where(eq(domesticOrderDueDates.domesticOrderId, orderId))
    .orderBy(asc(domesticOrderDueDates.displayOrder));
}

/** 그 회차를 확정한다. 실패하면 거기서 멈춘다 — 밑자락이 안 깔리면 아무것도 못 잰다. */
async function confirmRow(orderId: string, version: number, confirmed = true): Promise<void> {
  const result = await setDomesticOrderDueDateRowConfirmation({
    id: orderId,
    expectedVersion: version,
    dueDateRowOrder: 1,
    confirmed,
    actorUserId,
  });
  assert.equal(result.ok, true, `확정 조작 실패: ${JSON.stringify(result)}`);
}

/** 수리 건의 인수정보를 고치는 저장. 화면의 [인수 정보] 저장과 같은 길이다. */
async function saveCase(caseId: string, patch: Record<string, string | null>) {
  const before = await readCase(caseId);
  return updateRepairCase(caseId, before.version, "INTAKE", patch, actorUserId);
}

/**
 * 밑자락 한 벌 — **수리 건 · 그 건에 붙은 내자 줄 하나 · 그 줄의 회차 하나**.
 * 셋이 전부 DUE_1 을 가리킨다(묶기가 「안 바뀜」으로 읽지 않게, 고칠 때 날짜를 옮긴다).
 */
async function setUpLinkedPair() {
  const caseId = await createCase(DUE_1);
  const order = await createOrder({
    repairCaseId: caseId,
    dueDates: [{ dueDate: DUE_1, note: "1차분", deliveredDate: null, deliveredBy: null }],
  });
  // 전제 — 밑자락이 이 모양이 아니면 이 파일의 시험은 아무것도 못 잰다.
  const rows = await readRows(order.id);
  assert.equal(rows.length, 1, "밑자락의 회차가 하나가 아니다");
  assert.equal(rows[0].confirmedAt, null, "밑자락이 이미 확정 상태다");
  return { caseId, order };
}

before(async () => {
  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "AS_ENGINEER"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false)
      )
    )
    .limit(1);
  assert.ok(engineer, "전제가 깨졌다: 시험 DB 에 승인된 AS_ENGINEER 가 없다");
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
    // 납기요청일 행은 ON DELETE CASCADE 라 따라 사라진다.
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

// ── ① 🔵 **짝** — 확정 안 된 회차는 예전 그대로 맞춰진다 ────────────────────

describe("① 🔵 확정되지 않은 회차는 지금까지와 똑같이 맞춰진다", () => {
  test("🔵 고객 요청 납기일을 고치면 내자의 납기요청일이 **따라간다** — 막는 것은 확정된 회차뿐이다", async () => {
    const { caseId, order } = await setUpLinkedPair();

    const result = await saveCase(caseId, { customerRequestedDueDate: DUE_MOVED });
    assert.equal(result.ok, true, `확정 안 된 줄의 묶기가 막혔다: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.deepEqual(result.requestedDueDateLink, { linked: true });

    const rows = await readRows(order.id);
    assert.equal(rows.length, 1, "행이 늘거나 줄었다 — 날짜 칸만 고쳐야 한다");
    assert.equal(rows[0].dueDate, DUE_MOVED, "내자의 날짜가 안 따라갔다");
    assert.equal(rows[0].note, "1차분", "비고가 사라졌다");
  });
});

// ── ② 🔴 확정된 회차 — **거절되고 한 글자도 안 바뀐다** ──────────────────────

describe("② 🔴 확정된 회차가 걸리면 수리 건 저장이 거절된다", () => {
  test("🔴 거절되고 **내자의 날짜도 확정도** 그대로다", async () => {
    const { caseId, order } = await setUpLinkedPair();
    await confirmRow(order.id, order.version);
    const confirmedBefore = (await readRows(order.id))[0];
    assert.notEqual(confirmedBefore.confirmedAt, null, "밑자락이 확정되지 않았다");

    const result = await saveCase(caseId, { customerRequestedDueDate: DUE_MOVED });
    assert.equal(result.ok, false, "확정된 회차가 있는데 저장이 통과했다");
    if (result.ok) return;
    assert.equal(result.code, "DOMESTIC_ORDER_DUE_DATE_CONFIRMED");

    const rows = await readRows(order.id);
    assert.equal(rows.length, 1, "거절됐는데 회차 수가 달라졌다");
    assert.equal(rows[0].dueDate, DUE_1, "🔴 확정된 회차의 날짜가 바뀌었다 — 잠금이 뚫렸다");
    assert.equal(rows[0].id, confirmedBefore.id, "행이 지워지고 새로 생겼다");
    assert.notEqual(rows[0].confirmedAt, null, "확정이 풀렸다");
    assert.equal(rows[0].confirmedBy, confirmedBefore.confirmedBy);
  });

  test("🔴 **수리 건 쪽도** 한 글자가 안 바뀐다 — 날짜도 version 도", async () => {
    const { caseId, order } = await setUpLinkedPair();
    await confirmRow(order.id, order.version);
    const before = await readCase(caseId);

    const result = await saveCase(caseId, { customerRequestedDueDate: DUE_MOVED });
    assert.equal(result.ok, false);

    const afterSave = await readCase(caseId);
    assert.equal(
      afterSave.customerRequestedDueDate,
      DUE_1,
      "거절했는데 수리 건의 날짜만 바뀌었다 — 두 표가 갈라진다"
    );
    assert.equal(afterSave.version, before.version, "거절한 저장이 version 을 올렸다");
  });
});

// ── ③ 🔴 거절은 **그 저장 통째**다 ────────────────────────────────────────

describe("③ 🔴 같은 저장에 실린 다른 칸도 함께 거절된다", () => {
  test("🔴 우선순위를 함께 보내도 **둘 다** 안 바뀐다 — 반쯤 저장되지 않는다", async () => {
    const { caseId, order } = await setUpLinkedPair();
    await confirmRow(order.id, order.version);
    const before = await readCase(caseId);
    // 전제: 보내는 값이 지금 값과 달라야 「안 바뀌었다」가 뜻을 가진다.
    const nextPriority = before.priority === "HIGH" ? "NORMAL" : "HIGH";

    const result = await saveCase(caseId, {
      customerRequestedDueDate: DUE_MOVED,
      priority: nextPriority,
    });
    assert.equal(result.ok, false, "확정된 회차가 있는데 저장이 통과했다");

    const afterSave = await readCase(caseId);
    assert.equal(afterSave.priority, before.priority, "🔴 거절했는데 우선순위만 저장됐다");
    assert.equal(afterSave.customerRequestedDueDate, DUE_1);
    assert.equal(afterSave.version, before.version);
  });
});

// ── ④ 🔴 **날짜를 안 바꾸는 저장은 통과한다** ────────────────────────────────

describe("④ 🔴 확정된 회차가 있어도 날짜를 안 바꾸는 저장은 통과한다", () => {
  test("🔴 우선순위만 고치는 저장은 그대로 저장된다 — 확정이 건 전체를 잠그지 않는다", async () => {
    const { caseId, order } = await setUpLinkedPair();
    await confirmRow(order.id, order.version);
    const before = await readCase(caseId);
    const nextPriority = before.priority === "HIGH" ? "NORMAL" : "HIGH";

    const result = await saveCase(caseId, { priority: nextPriority });
    assert.equal(result.ok, true, `확정된 건의 다른 칸까지 막혔다: ${JSON.stringify(result)}`);

    const afterSave = await readCase(caseId);
    assert.equal(afterSave.priority, nextPriority, "우선순위가 저장되지 않았다");
    assert.equal(afterSave.customerRequestedDueDate, DUE_1, "날짜가 멋대로 바뀌었다");
  });

  test("🔴 **같은 날짜를 다시 보내는 저장**도 통과한다 — 묶기가 할 일이 없는 저장이다", async () => {
    const { caseId, order } = await setUpLinkedPair();
    await confirmRow(order.id, order.version);

    const result = await saveCase(caseId, { customerRequestedDueDate: DUE_1 });
    assert.equal(result.ok, true, `안 바뀐 날짜를 보냈는데 거절됐다: ${JSON.stringify(result)}`);

    const rows = await readRows(order.id);
    assert.equal(rows[0].dueDate, DUE_1);
    assert.notEqual(rows[0].confirmedAt, null, "확정이 풀렸다");
  });
});

// ── ⑤ 🔵 **[확정 해제] 뒤에는 다시 맞춰진다** ────────────────────────────────

describe("⑤ 🔵 막다른 길이 아니다 — 확정을 풀면 예전처럼 맞춰진다", () => {
  test("🔵 [확정 해제] 뒤의 같은 저장은 통과하고 내자 날짜가 따라간다", async () => {
    const { caseId, order } = await setUpLinkedPair();
    await confirmRow(order.id, order.version);
    const blocked = await saveCase(caseId, { customerRequestedDueDate: DUE_MOVED });
    assert.equal(blocked.ok, false, "밑자락이 막힌 상태가 아니다 — 이 시험은 아무것도 못 잰다");

    await confirmRow(order.id, order.version, false);

    const result = await saveCase(caseId, { customerRequestedDueDate: DUE_MOVED });
    assert.equal(result.ok, true, `확정을 풀었는데도 막혔다: ${JSON.stringify(result)}`);

    const rows = await readRows(order.id);
    assert.equal(rows[0].dueDate, DUE_MOVED, "확정을 풀었는데 날짜가 안 따라갔다");
    assert.equal(rows[0].confirmedAt, null);
  });
});

// ── ⑥ 🔴 **거절 문구에 까닭과 길이 담긴다** ──────────────────────────────────

describe("⑥ 🔴 거절 문구 — 어느 회차인지 · 어디서 · 무엇을", () => {
  test("🔴 문장은 **도메인 한 곳**이 만든 그 글자 그대로다", async () => {
    const { caseId, order } = await setUpLinkedPair();
    await confirmRow(order.id, order.version);

    const result = await saveCase(caseId, { customerRequestedDueDate: DUE_MOVED });
    assert.equal(result.ok, false);
    if (result.ok) return;

    // 🔴 글자를 여기서 다시 적지 않는다 — 베껴 적으면 문구를 다듬는 날 둘이 갈린다.
    const expected = confirmedDueDateRowBlocksRepairCaseSyncMessage(1, DUE_1);
    assert.equal(result.message, expected);
    // 🔴 그 글에 **셋**이 들어 있어야 한다: 어느 회차인지 · 어느 화면으로 · 무엇을.
    //    셋 중 하나라도 빠지면 사람은 수리 건 화면에서 없는 단추를 찾는다.
    assert.ok(result.message.includes(DUE_1), `거절 문구에 막힌 회차의 날짜가 없다: ${result.message}`);
    assert.ok(result.message.includes("[내자 정리]"), `거절 문구에 갈 곳이 없다: ${result.message}`);
    assert.ok(result.message.includes("[확정 해제]"), `거절 문구에 할 일이 없다: ${result.message}`);
    // 🔵 칸 오류로도 같은 글이 간다 — 알림을 닫은 뒤에도 어느 칸이 막혔는지 보인다.
    assert.equal(result.fieldErrors?.customerRequestedDueDate, expected);
  });
});
