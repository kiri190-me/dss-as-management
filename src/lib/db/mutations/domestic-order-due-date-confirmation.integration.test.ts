import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  auditLogs,
  customers,
  domesticOrderDueDates,
  domesticOrders,
  products,
  repairCaseApprovals,
  repairCaseIntakeSequences,
  repairCases,
  rolePermissions,
  users,
} from "../schema";
import { hasPermission, roleOnlyActor } from "@/lib/auth/permission-resolver";
import { type Role } from "@/lib/domain/types";
import {
  COMPLETED_DOMESTIC_ORDER_EDIT_FORBIDDEN_MESSAGE,
  createDomesticOrder,
  setDomesticOrderCompletion,
  setDomesticOrderDueDateRowConfirmation,
  updateDomesticOrder,
} from "./domestic-orders";
import { createRepairCase } from "./repair-cases";
import {
  CONFIRMED_DUE_DATE_ROW_MESSAGE,
  confirmedDueDateRowChangedMessage,
} from "@/lib/domain/domestic-order-due-date-rows";
import type { DomesticOrderFields } from "@/lib/validation/domestic-order-input";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 🔴 **회차별 [납기일 확정]** — 찍기 · 풀기 · 되얹기 · 잠금 (2026-11-25)
 * ============================================================================
 * 사용자 요구 원문: 「납기 요청일 옆에 **[납기일 확정] 버튼**을 만들어줘 … 이 버튼을
 * 누르면 포털의 알림 중에 **[납기 임박] 알림이 뜨지 않도록** 해줘.」 그리고 이어진
 * 결정: 「**[확정 해제]를 해야만 날짜를 고칠 수 있도록** 해줘.」
 *
 * ── 🔴 이 파일이 지키는 것 ──────────────────────────────────────────────
 *  ① 🔴 **되얹기** — 확정한 회차의 **다른 칸**(비고·납품)을 고쳐도 확정이 살아남는다.
 *     이것이 이 기능에서 **가장 조용히 깨지는 자리**다: 회차 행은 칸 하나만 고쳐도
 *     통째로 지워지고 다시 들어오므로(replaceDueDates), 되얹기가 빠지면 **오류도
 *     로그도 없이** 확정이 풀리고 며칠 뒤 종이 다시 울리는 것으로만 드러난다.
 *  ② 🔴 **잠금** — 확정된 회차의 **날짜를 고치는 저장**과 **그 회차를 지우는 저장**이
 *     거절되고, 거절로 끝난 저장은 **한 칸도 안 바꾼다**.
 *     🔵 그 옆에 **통과해야 하는 저장**을 함께 잰다(비고·납품 고치기 · 해제한 뒤
 *     날짜 고치기) — 「막는다」만 재면 **전부 막아 버린 구현**도 통과한다.
 *  ③ 🔴 **두 칸이 따로 움직이지 않는다** — 확정하면 둘 다 차고 해제하면 둘 다 빈다
 *     (표의 CHECK 가 같은 것을 지킨다. 여기서는 **값으로** 확인한다).
 *  ④ 🔴 **뒤에 더한 회차는 확정이 아니다** — 되얹기가 **자리로** 간다는 뜻이다.
 *  ⑤ 🔴 **version 이 안 오른다** — 올리면 그 줄의 회차별 승인이 전부 STALE 이 된다.
 *  ⑥ 🔴 **수리 건이 붙은 줄에서도 확정된다** — 회차별 [완료 처리]와 **일부러 다르다**
 *     (그쪽은 기타건 전용이다). 사용자 결정이 「모든 줄」이라, 그 차이가 나중에
 *     「완료와 모양을 맞추자」로 지워지지 않도록 여기서 못 박는다.
 *  ⑦ 🔴 **완료된 줄에는 「완료 시 수정」 관문이 선다** — 줄 수정과 같은 조건이다.
 *     🔵 **완료되지 않은 줄은 그 권한 없이도 확정된다**(평소 일을 막으면 안 된다).
 *
 * ── 🔴 **이 조각은 종을 끄지 않는다** ───────────────────────────────────
 * 확정 두 칸이 찍히는 것이 전부이고, 「납기 임박」 알림이 그 값을 보는 일은 다음
 * 조각이다. 그래서 이 파일에는 알림을 재는 시험이 **없다** — 지금은 확정해도 종이
 * 울리는 것이 맞다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 스위트만 쓰는 접수 월 "9511", 고객사 접두사 "AS-TEST-DO-DUE-CONFIRM-", 제품
 * 모델 접두사 "DO-DUE-CONFIRM-TEST-", 계정 이메일 접두사 "doduecfm-test-".
 * 만드는 내자 줄은 id 를 모아 두었다가 그대로 지운다(납기요청일 행은 CASCADE).
 *
 * 🔴 **설정 표(role_permissions)를 한 글자도 안 건드린다.** ⑦ 은 기본값 그대로의
 * 역할 둘(관리자 · 영업)로 재고, before() 가 그 기본값을 먼저 확인한다 — 어긋나면
 * 엉뚱한 까닭으로 통과하거나 실패하므로 거기서 멈춘다.
 * ============================================================================
 */

const TEST_EMAIL_PREFIX = "doduecfm-test-";
const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-DO-DUE-CONFIRM-";
const TEST_MODEL_PREFIX = "DO-DUE-CONFIRM-TEST-";
const TEST_YEAR_MONTH = "9511";
const TEST_RECEIVED_AT = "2095-11-05";

/** 1차 납기일. 🔴 **확정은 이 날짜에 걸린다** — 바뀌면 울타리가 문다. */
const DUE_1 = "2095-12-01";
/** 2차 납기일. */
const DUE_2 = "2096-01-15";
/** 1차를 **옮기려고** 쓰는 날짜. 이 저장이 거절되는 것이 ② 의 요점이다. */
const DUE_1_MOVED = "2095-12-20";

/** 기본값으로 **통과하는** 사람(관리자 — `edit` 과 `completedEdit` 둘 다 있다). */
let adminId: string;
/** 접수 건을 만들고 완료를 찍는 사람. */
let superAdminId: string;
/** 🔴 `edit` 은 있고 `completedEdit` 만 **없는** 사람. ⑦ 의 앞면이다. */
let salesId: string;
/** 접수 건의 담당 엔지니어. */
let engineerId: string;
let customerId: string;

const createdTestUserIds: string[] = [];
const createdOrderIds: string[] = [];

async function createTestUser(role: Role, name: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      email: `${TEST_EMAIL_PREFIX}${randomUUID().slice(0, 8)}@example.test`,
      name,
      role,
      approvalStatus: "APPROVED",
      isActive: true,
    })
    .returning({ id: users.id });
  createdTestUserIds.push(row.id);
  return row.id;
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

/** 납기요청일 한 줄. 보내는 모양은 **네 칸**이다(확정도 완료도 여기 없다). */
function dueDateInput(
  dueDate: string,
  overrides: { note?: string | null; deliveredDate?: string | null; deliveredBy?: string | null } = {}
) {
  return {
    dueDate,
    note: overrides.note ?? null,
    deliveredDate: overrides.deliveredDate ?? null,
    deliveredBy: overrides.deliveredBy ?? null,
  };
}

async function createOrder(overrides: Partial<DomesticOrderFields> = {}) {
  const result = await createDomesticOrder({ fields: fields(overrides), actorUserId: superAdminId });
  assert.equal(result.ok, true, `줄 만들기 실패: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdOrderIds.push(result.id);
  return { id: result.id, version: result.version };
}

/** 조회 매퍼를 거치지 않은 **DB 그대로의 줄**. 대조는 언제나 이 값으로 한다. */
async function readOrder(id: string) {
  const [row] = await db.select().from(domesticOrders).where(eq(domesticOrders.id, id));
  return row;
}

/** 그 줄의 회차들 — **차례대로**, 되얹기가 보는 칸을 전부 들고 온다. */
async function readRows(orderId: string) {
  return db
    .select({
      displayOrder: domesticOrderDueDates.displayOrder,
      dueDate: domesticOrderDueDates.dueDate,
      note: domesticOrderDueDates.note,
      deliveredDate: domesticOrderDueDates.deliveredDate,
      deliveredBy: domesticOrderDueDates.deliveredBy,
      completedAt: domesticOrderDueDates.completedAt,
      confirmedAt: domesticOrderDueDates.confirmedAt,
      confirmedBy: domesticOrderDueDates.confirmedBy,
    })
    .from(domesticOrderDueDates)
    .where(eq(domesticOrderDueDates.domesticOrderId, orderId))
    .orderBy(asc(domesticOrderDueDates.displayOrder));
}

/** 그 회차를 확정한다. 실패하면 거기서 멈춘다 — 밑자락이 안 깔리면 아무것도 못 잰다. */
async function confirmRow(id: string, version: number, rowOrder: number, actorUserId = adminId) {
  const result = await setDomesticOrderDueDateRowConfirmation({
    id,
    expectedVersion: version,
    dueDateRowOrder: rowOrder,
    confirmed: true,
    actorUserId,
  });
  assert.equal(result.ok, true, `확정 실패: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

/**
 * 🔴 그 기타건의 그 회차에 「지금 판에 대한 승인」을 하나 박는다.
 *
 * 이 파일이 재는 것은 승인 절차가 아니라 **확정**이므로, 결재선·지정 관문을 끌어오지
 * 않고 행을 직접 넣는다(이웃 domestic-order-completed-edit.integration.test.ts 와 같은
 * 판단). 🔴 `repair_case_version_at_request` 가 **지금 version 이어야** 유효하다.
 */
async function grantMiscCaseApproval(orderId: string, version: number, rowOrder = 1): Promise<void> {
  await db.insert(repairCaseApprovals).values({
    domesticOrderId: orderId,
    approvalType: "DOMESTIC_ORDER_FINAL_SHIPMENT",
    dueDateRowOrder: rowOrder,
    status: "APPROVED",
    requestedByUserId: superAdminId,
    decidedByUserId: superAdminId,
    decidedAt: new Date(),
    repairCaseVersionAtRequest: version,
  });
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

async function removeTestUsersByPrefix(): Promise<void> {
  const leftovers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  const ids = leftovers.map((row) => row.id);
  if (ids.length === 0) return;
  // audit_logs.actor_user_id → users (restrict): **행위자로만** 고른다 —
  // target_record_id 로 고르는 모양은 test-cleanup-static-safety.test.ts 가 금지한다.
  await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, ids));
  await db.delete(users).where(inArray(users.id, ids));
}

before(async () => {
  await removeTestUsersByPrefix();

  superAdminId = await createTestUser("SUPER_ADMIN", "DueConfirm 최고관리자");
  adminId = await createTestUser("ADMIN", "DueConfirm 관리자");
  salesId = await createTestUser("SALES", "DueConfirm 영업");
  engineerId = await createTestUser("AS_ENGINEER", "DueConfirm 엔지니어");

  // ── 🔴 전제 — 표본이 비어서 공짜로 통과하지 않게 한다 ───────────────────
  // ⑦ 은 **설정을 건드리지 않고** 기본값 둘로 잰다. 시험 DB 의 설정이 기본 정책과
  // 어긋나 있으면 그 시험이 엉뚱한 까닭으로 통과하거나 실패하므로 여기서 먼저 멈춘다.
  const stored = await db
    .select({ role: rolePermissions.role, areaKey: rolePermissions.areaKey })
    .from(rolePermissions)
    .where(inArray(rolePermissions.areaKey, ["domesticOrders.edit", "domesticOrders.completedEdit"]));
  assert.deepEqual(
    stored,
    [],
    "전제가 깨졌다: 시험 DB 에 내자 수정 권한 설정이 남아 있다 — 앞 실행이 치우지 못한 행이다"
  );
  assert.equal(
    await hasPermission(roleOnlyActor("SALES"), "domesticOrders.edit", "WRITE"),
    true,
    "전제가 깨졌다: 영업이 내자 줄을 고칠 수 없다 — ⑦ 의 앞면을 잴 표본이 아니다"
  );
  assert.equal(
    await hasPermission(roleOnlyActor("SALES"), "domesticOrders.completedEdit", "WRITE"),
    false,
    "전제가 깨졌다: 영업에게 「완료 시 수정」이 열려 있다 — 막히는 역할을 다시 골라야 한다"
  );
  assert.equal(
    await hasPermission(roleOnlyActor("ADMIN"), "domesticOrders.completedEdit", "WRITE"),
    true,
    "전제가 깨졌다: 관리자에게 「완료 시 수정」이 없다 — 통과하는 쪽을 잴 표본이 없다"
  );

  const [customer] = await db
    .insert(customers)
    .values({ name: `${TEST_CUSTOMER_NAME_PREFIX}${randomUUID().slice(0, 8)}` })
    .returning({ id: customers.id });
  customerId = customer.id;
});

after(async () => {
  if (createdOrderIds.length > 0) {
    // 🔴 결재 행이 먼저다. 내자 줄을 지우면 그 칸이 NULL 로 풀릴 뿐 행은 남는다
    //    (표의 ON DELETE SET NULL) — 걷지 않으면 주인 없는 결재 기록이 쌓인다.
    await db
      .delete(repairCaseApprovals)
      .where(inArray(repairCaseApprovals.domesticOrderId, createdOrderIds));
    // 납기요청일 행은 ON DELETE CASCADE 라 따라 사라진다.
    await db.delete(domesticOrders).where(inArray(domesticOrders.id, createdOrderIds));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db
    .delete(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  await removeTestUsersByPrefix();
  await pgClient.end({ timeout: 5 });
});

// ── ① 찍기와 풀기 ─────────────────────────────────────────────────────────

describe("① 🔴 확정하면 두 칸이 함께 차고, 해제하면 함께 빈다", () => {
  test("🔴 확정 — `confirmed_at` 과 `confirmed_by` 가 **둘 다** 들어간다", async () => {
    const order = await createOrder({ dueDates: [dueDateInput(DUE_1, { note: "1차분" })] });
    // 전제: 태어난 회차는 확정이 아니다(아니면 이 시험은 아무것도 못 잰다).
    const before = await readRows(order.id);
    assert.equal(before.length, 1);
    assert.equal(before[0].confirmedAt, null, "새로 만든 회차가 이미 확정 상태다");
    assert.equal(before[0].confirmedBy, null);

    await confirmRow(order.id, order.version, 1);

    const rows = await readRows(order.id);
    assert.notEqual(rows[0].confirmedAt, null, "확정 시각이 안 찍혔다");
    assert.equal(rows[0].confirmedBy, adminId, "확정한 사람이 안 찍혔다");
    // 🔵 **완료와 섞이지 않는다** — 뜻이 다른 값이다.
    assert.equal(rows[0].completedAt, null, "확정이 완료까지 찍었다");
    // 🔴 날짜·비고는 한 글자도 안 바뀐다 — 확정은 표시일 뿐이다.
    assert.equal(rows[0].dueDate, DUE_1);
    assert.equal(rows[0].note, "1차분");
  });

  test("🔴 해제 — 두 칸이 **함께** 비워진다", async () => {
    const order = await createOrder({ dueDates: [dueDateInput(DUE_1)] });
    await confirmRow(order.id, order.version, 1);

    const released = await setDomesticOrderDueDateRowConfirmation({
      id: order.id,
      expectedVersion: order.version,
      dueDateRowOrder: 1,
      confirmed: false,
      actorUserId: adminId,
    });
    assert.equal(released.ok, true, `해제 실패: ${JSON.stringify(released)}`);

    const rows = await readRows(order.id);
    assert.equal(rows[0].confirmedAt, null, "해제했는데 시각이 남았다");
    assert.equal(rows[0].confirmedBy, null, "해제했는데 사람이 남았다");
  });

  test("🔴 **version 이 안 오른다** — 올리면 그 줄의 회차별 승인이 전부 STALE 이 된다", async () => {
    const order = await createOrder({ dueDates: [dueDateInput(DUE_1)] });
    const confirmed = await confirmRow(order.id, order.version, 1);
    assert.equal(confirmed.version, order.version, "확정이 version 을 올렸다");

    const row = await readOrder(order.id);
    assert.equal(row.version, order.version, "DB 의 version 이 올랐다");
    // 🔵 그래서 **같은 version 으로 해제도 된다** — 끊긴 요청을 다시 보내도 안전하다.
    const released = await setDomesticOrderDueDateRowConfirmation({
      id: order.id,
      expectedVersion: order.version,
      dueDateRowOrder: 1,
      confirmed: false,
      actorUserId: adminId,
    });
    assert.equal(released.ok, true, `같은 version 으로 해제가 안 된다: ${JSON.stringify(released)}`);
  });

  test("🔴 **회차마다 따로** 찍힌다 — 1차를 확정해도 2차는 그대로다", async () => {
    const order = await createOrder({
      dueDates: [dueDateInput(DUE_1, { note: "1차분" }), dueDateInput(DUE_2, { note: "2차분" })],
    });
    await confirmRow(order.id, order.version, 2);

    const rows = await readRows(order.id);
    assert.equal(rows[0].confirmedAt, null, "2차를 확정했는데 1차가 함께 찍혔다");
    assert.notEqual(rows[1].confirmedAt, null, "2차가 안 찍혔다");
  });
});

// ── ② 🔴 되얹기 — 이 조각의 핵심 보호 장치 ────────────────────────────────

describe("② 🔴 되얹기 — 다른 칸을 고쳐도 확정이 살아남는다", () => {
  test("🔴 **비고와 납품 둘을 고치는 저장** 뒤에도 확정이 그대로다", async () => {
    const order = await createOrder({
      dueDates: [dueDateInput(DUE_1, { note: "1차분" }), dueDateInput(DUE_2)],
    });
    await confirmRow(order.id, order.version, 1);
    const stamped = (await readRows(order.id))[0].confirmedAt;
    assert.notEqual(stamped, null, "밑자락이 확정 상태가 아니다 — 이 시험은 아무것도 못 잰다");

    // 🔴 **날짜는 그대로 두고** 비고와 납품만 고친다 — 날짜를 건드리면 울타리에 걸려
    //    되얹기를 잴 수 없다(그쪽은 ③ 이 따로 잰다).
    const saved = await updateDomesticOrder({
      id: order.id,
      expectedVersion: order.version,
      fields: fields({
        dueDates: [
          dueDateInput(DUE_1, { note: "1차분(수정)", deliveredDate: "2095-12-02", deliveredBy: "홍길동" }),
          dueDateInput(DUE_2, { note: "2차분" }),
        ],
      }),
      actorUserId: adminId,
    });
    assert.equal(saved.ok, true, `저장 실패: ${JSON.stringify(saved)}`);

    const rows = await readRows(order.id);
    // 전제: 고친 칸은 실제로 바뀌었다(안 바뀌었으면 이 시험은 공짜로 통과한다).
    assert.equal(rows[0].note, "1차분(수정)", "비고가 안 바뀌었다 — 저장 자체가 안 돌았다");
    assert.equal(rows[0].deliveredDate, "2095-12-02");
    assert.equal(rows[0].deliveredBy, "홍길동");
    // 🔴 그런데도 확정은 **그 자리에 그대로** 있다.
    assert.notEqual(rows[0].confirmedAt, null, "다른 칸을 고쳤더니 확정이 조용히 풀렸다");
    assert.equal(rows[0].confirmedBy, adminId, "확정한 사람이 사라졌다");
    assert.deepEqual(rows[0].confirmedAt, stamped, "확정 시각이 다시 찍혔다 — 되얹기가 아니라 덮어쓰기다");
    // 2차는 원래 확정이 아니었고 그대로다.
    assert.equal(rows[1].confirmedAt, null);
  });

  test("🔴 **뒤에 회차를 더해도** 새 회차는 확정이 아니다 — 되얹기는 자리로 간다", async () => {
    const order = await createOrder({ dueDates: [dueDateInput(DUE_1)] });
    await confirmRow(order.id, order.version, 1);

    const saved = await updateDomesticOrder({
      id: order.id,
      expectedVersion: order.version,
      fields: fields({ dueDates: [dueDateInput(DUE_1), dueDateInput(DUE_2)] }),
      actorUserId: adminId,
    });
    assert.equal(saved.ok, true, `저장 실패: ${JSON.stringify(saved)}`);

    const rows = await readRows(order.id);
    assert.equal(rows.length, 2, "회차가 둘이 아니다 — 밑자락이 깨졌다");
    assert.notEqual(rows[0].confirmedAt, null, "1차의 확정이 사라졌다");
    assert.equal(rows[1].confirmedAt, null, "새로 더한 회차가 확정으로 태어났다");
    assert.equal(rows[1].confirmedBy, null);
  });
});

// ── ③ 🔴 잠금 — 확정된 회차의 날짜는 못 고치고 그 줄도 못 지운다 ──────────

describe("③ 🔴 확정은 잠금이다 — 「[확정 해제]를 해야만 날짜를 고칠 수 있도록」", () => {
  test("🔴 확정된 회차의 **날짜를 고치는 저장이 거절되고, 한 칸도 안 바뀐다**", async () => {
    const order = await createOrder({
      dueDates: [dueDateInput(DUE_1, { note: "1차분" }), dueDateInput(DUE_2)],
    });
    await confirmRow(order.id, order.version, 1);

    const saved = await updateDomesticOrder({
      id: order.id,
      expectedVersion: order.version,
      // 🔴 1차의 날짜만 옮긴다. 비고는 그대로다 — 막는 것이 **날짜**임을 못 박는다.
      fields: fields({
        purchaseOrderNumber: "PO-SHOULD-NOT-LAND",
        dueDates: [dueDateInput(DUE_1_MOVED, { note: "1차분" }), dueDateInput(DUE_2)],
      }),
      actorUserId: adminId,
    });

    assert.equal(saved.ok, false, "확정된 회차의 날짜가 고쳐졌다");
    if (saved.ok) return;
    assert.equal(saved.code, "VALIDATION_ERROR");
    assert.equal(saved.message, confirmedDueDateRowChangedMessage(1, DUE_1));
    assert.equal(saved.fieldErrors?.dueDates, saved.message);
    // 🔴 **되돌리는 길**과 **어느 회차인지**가 글에 있어야 한다.
    assert.ok(saved.message.includes("[확정 해제]"), `되돌리는 길을 안 말한다: ${saved.message}`);
    assert.ok(saved.message.includes(DUE_1), `어느 날짜가 막혔는지 안 말한다: ${saved.message}`);

    // 🔴 거절로 끝난 저장은 **줄의 다른 칸도** 안 바꾼다(울타리가 UPDATE 앞에 선다).
    const row = await readOrder(order.id);
    assert.equal(row.purchaseOrderNumber, null, "거절됐는데 반은 저장됐다");
    assert.equal(row.version, order.version, "거절됐는데 version 이 올랐다");
    const rows = await readRows(order.id);
    assert.equal(rows[0].dueDate, DUE_1, "거절됐는데 날짜가 바뀌었다");
    assert.notEqual(rows[0].confirmedAt, null, "거절됐는데 확정이 풀렸다");
  });

  test("🔴 확정된 회차를 **지우는 저장도 거절된다** — 지우고 새로 만들면 그만이 되면 안 된다", async () => {
    const order = await createOrder({ dueDates: [dueDateInput(DUE_1), dueDateInput(DUE_2)] });
    await confirmRow(order.id, order.version, 2);

    const saved = await updateDomesticOrder({
      id: order.id,
      expectedVersion: order.version,
      fields: fields({ dueDates: [dueDateInput(DUE_1)] }),
      actorUserId: adminId,
    });

    assert.equal(saved.ok, false, "확정된 회차가 지워졌다");
    if (saved.ok) return;
    assert.equal(saved.code, "VALIDATION_ERROR");
    assert.equal(saved.message, CONFIRMED_DUE_DATE_ROW_MESSAGE);
    assert.ok(saved.message.includes("[확정 해제]"), "되돌리는 길을 안 말한다");

    const rows = await readRows(order.id);
    assert.equal(rows.length, 2, "거절됐는데 회차가 지워졌다");
  });

  test("🔵 **비고·납품만 고치는 저장은 통과한다** — 확정이 잠그는 것은 납기요청일 하나다", async () => {
    // 🔴 이 짝이 없으면 **전부 막아 버린 구현**도 위 두 시험을 통과한다.
    const order = await createOrder({ dueDates: [dueDateInput(DUE_1)] });
    await confirmRow(order.id, order.version, 1);

    const saved = await updateDomesticOrder({
      id: order.id,
      expectedVersion: order.version,
      fields: fields({
        dueDates: [dueDateInput(DUE_1, { note: "메모만 바뀐다", deliveredBy: "김유진" })],
      }),
      actorUserId: adminId,
    });
    assert.equal(saved.ok, true, `확정된 회차의 비고까지 막혔다: ${JSON.stringify(saved)}`);

    const rows = await readRows(order.id);
    assert.equal(rows[0].note, "메모만 바뀐다");
    assert.equal(rows[0].deliveredBy, "김유진");
    assert.notEqual(rows[0].confirmedAt, null, "통과한 저장이 확정을 지웠다");
  });

  test("🔴 **해제한 뒤에는 날짜가 고쳐진다** — 막다른 길이 아니다", async () => {
    const order = await createOrder({ dueDates: [dueDateInput(DUE_1)] });
    await confirmRow(order.id, order.version, 1);

    // ① 해제 — version 은 안 오르므로 같은 값을 그대로 쓴다.
    const released = await setDomesticOrderDueDateRowConfirmation({
      id: order.id,
      expectedVersion: order.version,
      dueDateRowOrder: 1,
      confirmed: false,
      actorUserId: adminId,
    });
    assert.equal(released.ok, true, `해제 실패: ${JSON.stringify(released)}`);

    // ② 날짜 고치기 — 이제 통과해야 한다.
    const saved = await updateDomesticOrder({
      id: order.id,
      expectedVersion: order.version,
      fields: fields({ dueDates: [dueDateInput(DUE_1_MOVED)] }),
      actorUserId: adminId,
    });
    assert.equal(saved.ok, true, `해제했는데도 날짜가 안 고쳐진다: ${JSON.stringify(saved)}`);

    const rows = await readRows(order.id);
    assert.equal(rows[0].dueDate, DUE_1_MOVED, "날짜가 안 바뀌었다");
    assert.equal(rows[0].confirmedAt, null, "해제한 확정이 되얹혔다");
    assert.equal(rows[0].confirmedBy, null);
  });
});

// ── ④ 거절하는 길들 ───────────────────────────────────────────────────────

describe("④ 🔴 확정이 거절되는 자리", () => {
  test("🔴 납기요청일이 **없는 줄**에서는 확정할 수 없다", async () => {
    const order = await createOrder();
    const result = await setDomesticOrderDueDateRowConfirmation({
      id: order.id,
      expectedVersion: order.version,
      dueDateRowOrder: 1,
      confirmed: true,
      actorUserId: adminId,
    });
    assert.equal(result.ok, false, "회차가 없는 줄에서 확정이 됐다");
    if (result.ok) return;
    assert.equal(result.code, "VALIDATION_ERROR");
    assert.ok(result.message.includes("납기요청일"), `무엇을 먼저 해야 하는지 안 말한다: ${result.message}`);
  });

  test("🔴 **없는 회차 번호**는 거절된다", async () => {
    const order = await createOrder({ dueDates: [dueDateInput(DUE_1)] });
    const result = await setDomesticOrderDueDateRowConfirmation({
      id: order.id,
      expectedVersion: order.version,
      dueDateRowOrder: 2,
      confirmed: true,
      actorUserId: adminId,
    });
    assert.equal(result.ok, false, "없는 회차가 확정됐다");
    if (!result.ok) assert.equal(result.code, "VALIDATION_ERROR");
    const rows = await readRows(order.id);
    assert.equal(rows[0].confirmedAt, null, "엉뚱한 회차가 확정됐다");
  });

  test("🔴 **version 이 어긋나면** CONFLICT 이고 아무것도 안 바뀐다", async () => {
    const order = await createOrder({ dueDates: [dueDateInput(DUE_1)] });
    const result = await setDomesticOrderDueDateRowConfirmation({
      id: order.id,
      expectedVersion: order.version + 1,
      dueDateRowOrder: 1,
      confirmed: true,
      actorUserId: adminId,
    });
    assert.equal(result.ok, false, "낡은 version 으로 확정이 됐다");
    if (!result.ok) assert.equal(result.code, "CONFLICT");
    const rows = await readRows(order.id);
    assert.equal(rows[0].confirmedAt, null, "CONFLICT 인데 확정이 찍혔다");
  });

  test("🔴 **없는 줄**은 NOT_FOUND 다", async () => {
    const result = await setDomesticOrderDueDateRowConfirmation({
      id: randomUUID(),
      expectedVersion: 1,
      dueDateRowOrder: 1,
      confirmed: true,
      actorUserId: adminId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });
});

// ── ⑤ 🔴 수리 건이 붙은 줄 — 회차 완료와 **일부러 다르다** ────────────────

describe("⑤ 🔴 수리 건이 붙은 줄에서도 확정된다 — 기타건 전용이 아니다", () => {
  test("🔴 수리 건이 붙은 줄의 회차도 확정되고 해제된다", async () => {
    // 🔴 회차별 [완료 처리]는 이 줄을 거절한다(기타건 전용). 확정은 **모든 줄**이다
    //    (2026-11-25 사용자 결정) — 그 차이가 「완료와 모양을 맞추자」로 지워지면
    //    수리 건이 붙은 줄에서는 영영 종을 끌 수 없게 된다.
    const created = await createRepairCase(baseCreateRepairCaseInput());
    assert.equal(created.ok, true, `접수 건 만들기 실패: ${JSON.stringify(created)}`);
    if (!created.ok) return;

    const order = await createOrder({
      repairCaseId: created.id,
      dueDates: [dueDateInput(DUE_1)],
    });
    const result = await setDomesticOrderDueDateRowConfirmation({
      id: order.id,
      expectedVersion: order.version,
      dueDateRowOrder: 1,
      confirmed: true,
      actorUserId: adminId,
    });
    assert.equal(result.ok, true, `수리 건이 붙은 줄에서 확정이 거절됐다: ${JSON.stringify(result)}`);

    const rows = await readRows(order.id);
    assert.notEqual(rows[0].confirmedAt, null, "확정이 안 찍혔다");
  });
});

// ── ⑥ 🔴 완료된 줄 — 「완료 시 수정」 관문 ────────────────────────────────

describe("⑥ 🔴 완료된 줄은 「완료 시 수정」이 있어야 확정·해제된다", () => {
  test("🔵 **완료되지 않은 줄**은 그 권한 없이도 확정된다 — 평소 일을 막으면 안 된다", async () => {
    const order = await createOrder({ dueDates: [dueDateInput(DUE_1)] });
    const result = await setDomesticOrderDueDateRowConfirmation({
      id: order.id,
      expectedVersion: order.version,
      dueDateRowOrder: 1,
      confirmed: true,
      // 🔴 `completedEdit` 이 **없는** 사람이다(before() 가 그 사실을 확인한다).
      actorUserId: salesId,
    });
    assert.equal(result.ok, true, `완료 전인 줄의 확정이 막혔다: ${JSON.stringify(result)}`);
    const rows = await readRows(order.id);
    assert.equal(rows[0].confirmedBy, salesId);
  });

  test("🔴 **완료된 줄**은 그 권한이 없으면 거절되고 한 칸도 안 바뀐다", async () => {
    const order = await createOrder({ dueDates: [dueDateInput(DUE_1)] });
    await grantMiscCaseApproval(order.id, order.version);
    const completed = await setDomesticOrderCompletion({
      id: order.id,
      expectedVersion: order.version,
      completed: true,
      actorUserId: superAdminId,
    });
    assert.equal(completed.ok, true, `완료 처리 실패: ${JSON.stringify(completed)}`);
    if (!completed.ok) return;
    const line = await readOrder(order.id);
    assert.notEqual(line.completedAt, null, "밑자락이 완료 상태가 아니다 — 이 시험은 아무것도 못 잰다");

    const denied = await setDomesticOrderDueDateRowConfirmation({
      id: order.id,
      expectedVersion: completed.version,
      dueDateRowOrder: 1,
      confirmed: true,
      actorUserId: salesId,
    });
    assert.equal(denied.ok, false, "완료된 줄이 권한 없이 확정됐다");
    if (denied.ok) return;
    assert.equal(denied.code, "FORBIDDEN");
    assert.equal(denied.message, COMPLETED_DOMESTIC_ORDER_EDIT_FORBIDDEN_MESSAGE);
    const rows = await readRows(order.id);
    assert.equal(rows[0].confirmedAt, null, "거절됐는데 확정이 찍혔다");

    // 🔵 권한이 있는 사람은 **같은 줄에서 그대로 된다** — 막는 것이 권한이지
    //    「완료된 줄」 자체가 아니다.
    const allowed = await setDomesticOrderDueDateRowConfirmation({
      id: order.id,
      expectedVersion: completed.version,
      dueDateRowOrder: 1,
      confirmed: true,
      actorUserId: adminId,
    });
    assert.equal(allowed.ok, true, `권한이 있는데도 막혔다: ${JSON.stringify(allowed)}`);
    const after = await readRows(order.id);
    assert.equal(after[0].confirmedBy, adminId);
  });
});

// ── ⑦ 🔴 **빌려 온 날짜에서 확정하면 회차가 생긴다** (2026-11-25) ──────────

/**
 * 사용자 결정 원문: 「[내자정리]에서 **[수리건 요청일]도** 내자정리에서 작성한
 * [납기요청일]과 **같은 취급**을 해줘.」
 *
 * 납기요청일 행이 **하나도 없는** 줄은 연결된 수리 건의 고객 요청 납기일을 화면에
 * 대신 그린다. 날짜는 보이는데 **적을 자리가 없어** 확정을 할 수 없었다. 이제 그
 * 줄에서 확정을 누르면 **그 날짜로 1차 회차가 생기면서 확정된다.**
 *
 * 🔴 **날짜는 서버가 제 손으로 읽는다** — 화면이 보낸 날짜를 받지 않는다. 그래서
 * 여기서 재는 것은 「무엇이 들어갔는가」이고, 답은 **수리 건의 그 칸 값**이어야 한다.
 * 🔴 「수리 건 요청일」 꼬리표가 사라지는 것은 **받아들인 결과**다(그 꼬리표가 뜨는
 * 조건은 「회차가 0개다」 하나뿐이다) — 사용자 결정이고, 출처 칸은 만들지 않았다.
 */
describe("⑦ 🔴 빌려 온 날짜에서 확정하면 그 날짜로 회차가 생긴다", () => {
  test("🔴 회차 0 → 1, 날짜는 **수리 건의 그 칸 값**, 그리고 확정 상태다", async () => {
    const created = await createRepairCase({
      ...baseCreateRepairCaseInput(),
      customerRequestedDueDate: DUE_1,
    });
    assert.equal(created.ok, true, `접수 건 만들기 실패: ${JSON.stringify(created)}`);
    if (!created.ok) return;

    // 🔴 **회차가 0개인 줄**이다 — 화면은 여기서 수리 건의 날짜를 빌려 그린다.
    const order = await createOrder({ repairCaseId: created.id, dueDates: [] });
    const before = await readRows(order.id);
    assert.equal(before.length, 0, "밑자락에 이미 회차가 있다 — 이 시험은 빌려 온 줄을 못 잰다");

    const result = await setDomesticOrderDueDateRowConfirmation({
      id: order.id,
      expectedVersion: order.version,
      dueDateRowOrder: 1,
      confirmed: true,
      actorUserId: adminId,
    });
    assert.equal(result.ok, true, `빌려 온 날짜의 확정이 거절됐다: ${JSON.stringify(result)}`);

    const rows = await readRows(order.id);
    assert.equal(rows.length, 1, "회차가 생기지 않았다(또는 둘 이상 생겼다)");
    assert.equal(rows[0].dueDate, DUE_1, "🔴 생긴 회차의 날짜가 수리 건의 값과 다르다");
    assert.equal(rows[0].displayOrder, 1, "차례가 1차가 아니다");
    assert.notEqual(rows[0].confirmedAt, null, "회차는 생겼는데 확정이 안 찍혔다");
    assert.equal(rows[0].confirmedBy, adminId, "확정한 사람이 안 찍혔다");
    // 🔴 아무도 적은 적 없는 값을 지어내지 않는다 — 비고도 납품 두 칸도 비어 있다.
    assert.equal(rows[0].note, null, "아무도 적지 않은 비고가 생겼다");
    assert.equal(rows[0].deliveredDate, null);
    assert.equal(rows[0].deliveredBy, null);
    assert.equal(rows[0].completedAt, null, "확정이 완료까지 찍었다");
  });

  test("🔴 **수리 건의 날짜는 그대로다** — 넣은 값이 그 칸의 값 그대로이므로 고칠 것이 없다", async () => {
    const created = await createRepairCase({
      ...baseCreateRepairCaseInput(),
      customerRequestedDueDate: DUE_1,
    });
    if (!created.ok) return;
    const order = await createOrder({ repairCaseId: created.id, dueDates: [] });
    const [caseBefore] = await db
      .select({ dueDate: repairCases.customerRequestedDueDate, version: repairCases.version })
      .from(repairCases)
      .where(eq(repairCases.id, created.id));

    await confirmRow(order.id, order.version, 1);

    const [caseAfter] = await db
      .select({ dueDate: repairCases.customerRequestedDueDate, version: repairCases.version })
      .from(repairCases)
      .where(eq(repairCases.id, created.id));
    assert.equal(caseAfter.dueDate, caseBefore.dueDate, "수리 건의 날짜가 바뀌었다");
    // 🔴 묶기를 태우지 않았다는 사실 — 태웠으면 이 version 이 올랐을 수 있다.
    assert.equal(caseAfter.version, caseBefore.version, "수리 건의 version 이 올랐다");
    // 🔴 줄의 version 도 그대로다(확정은 줄을 안 건드린다) — 올리면 그 줄의 회차별
    //    승인이 전부 STALE 이 된다.
    const line = await readOrder(order.id);
    assert.equal(line.version, order.version, "회차를 만들면서 줄의 version 이 올랐다");
  });

  test("🔴 빌릴 날짜가 **없으면** 거절되고 회차도 안 생긴다 — 화면에도 단추가 없는 줄이다", async () => {
    // ㉮ 수리 건이 붙었지만 그 칸이 비어 있다(화면에 "-" 만 보인다).
    const created = await createRepairCase(baseCreateRepairCaseInput());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const linked = await createOrder({ repairCaseId: created.id, dueDates: [] });
    const deniedLinked = await setDomesticOrderDueDateRowConfirmation({
      id: linked.id,
      expectedVersion: linked.version,
      dueDateRowOrder: 1,
      confirmed: true,
      actorUserId: adminId,
    });
    assert.equal(deniedLinked.ok, false, "빌릴 날짜가 없는데 확정됐다");
    if (!deniedLinked.ok) assert.equal(deniedLinked.code, "VALIDATION_ERROR");
    assert.equal((await readRows(linked.id)).length, 0, "회차가 생겼다");

    // ㉯ 수리 건 자체가 안 붙은 줄(기타건) — 빌릴 곳이 아예 없다.
    const misc = await createOrder({ dueDates: [] });
    const deniedMisc = await setDomesticOrderDueDateRowConfirmation({
      id: misc.id,
      expectedVersion: misc.version,
      dueDateRowOrder: 1,
      confirmed: true,
      actorUserId: adminId,
    });
    assert.equal(deniedMisc.ok, false, "연결도 날짜도 없는 줄이 확정됐다");
    if (!deniedMisc.ok) assert.equal(deniedMisc.code, "VALIDATION_ERROR");
    assert.equal((await readRows(misc.id)).length, 0, "회차가 생겼다");
  });

  test("🔴 **해제**와 **1차가 아닌 번호**로는 회차가 생기지 않는다", async () => {
    const created = await createRepairCase({
      ...baseCreateRepairCaseInput(),
      customerRequestedDueDate: DUE_1,
    });
    if (!created.ok) return;

    // ㉮ 없는 회차의 확정을 푼다는 말은 성립하지 않는다 — 만들어서 풀면 더 이상하다.
    const releasing = await createOrder({ repairCaseId: created.id, dueDates: [] });
    const deniedRelease = await setDomesticOrderDueDateRowConfirmation({
      id: releasing.id,
      expectedVersion: releasing.version,
      dueDateRowOrder: 1,
      confirmed: false,
      actorUserId: adminId,
    });
    assert.equal(deniedRelease.ok, false, "없는 회차가 해제됐다");
    assert.equal((await readRows(releasing.id)).length, 0, "해제인데 회차가 생겼다");

    // ㉯ 만들 자리는 1차 하나뿐이다 — 2차를 보내면 거절이다(낡은 화면의 요청이다).
    const second = await createOrder({ repairCaseId: created.id, dueDates: [] });
    const deniedSecond = await setDomesticOrderDueDateRowConfirmation({
      id: second.id,
      expectedVersion: second.version,
      dueDateRowOrder: 2,
      confirmed: true,
      actorUserId: adminId,
    });
    assert.equal(deniedSecond.ok, false, "없는 2차가 확정됐다");
    assert.equal((await readRows(second.id)).length, 0, "2차를 보냈는데 회차가 생겼다");
  });

  test("🔴 생긴 회차는 **울타리가 지킨다** — 그 줄을 다시 0회차로 저장할 수 없다", async () => {
    const created = await createRepairCase({
      ...baseCreateRepairCaseInput(),
      customerRequestedDueDate: DUE_1,
    });
    if (!created.ok) return;
    const order = await createOrder({ repairCaseId: created.id, dueDates: [] });
    await confirmRow(order.id, order.version, 1);

    // 🔴 **열려 있던 내자 정리 화면**이 보내는 저장이다 — 그 화면은 회차가 0개이던
    //    때의 목록을 들고 있다. 확정은 줄의 version 을 안 올리므로 낙관적 잠금에는
    //    안 걸리고, 넷째 울타리가 막는다(확정된 회차가 있는데 줄이 줄어드는 저장).
    const stale = await updateDomesticOrder({
      id: order.id,
      expectedVersion: order.version,
      fields: fields({ repairCaseId: created.id, dueDates: [] }),
      actorUserId: adminId,
    });
    assert.equal(stale.ok, false, "낡은 화면의 저장이 확정된 회차를 지웠다");
    if (!stale.ok) {
      assert.equal(stale.code, "VALIDATION_ERROR");
      assert.equal(stale.message, CONFIRMED_DUE_DATE_ROW_MESSAGE);
    }
    const rows = await readRows(order.id);
    assert.equal(rows.length, 1, "거절됐는데 회차가 사라졌다");
    assert.equal(rows[0].dueDate, DUE_1);
    assert.notEqual(rows[0].confirmedAt, null);
  });
});
