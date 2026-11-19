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
import { ROLE_CODES, type Role } from "@/lib/domain/types";
import {
  COMPLETED_DOMESTIC_ORDER_EDIT_FORBIDDEN_MESSAGE,
  canEditCompletedDomesticOrder,
  createDomesticOrder,
  setDomesticOrderCompletion,
  setDomesticOrderDueDateRowCompletion,
  updateDomesticOrder,
} from "./domestic-orders";
import { saveRepairCaseDomesticOrderIssueDates } from "./domestic-order-issue-dates";
import { saveRolePermissions } from "./role-permissions";
import { createRepairCase } from "./repair-cases";
import type { DomesticOrderFields } from "@/lib/validation/domestic-order-input";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 🔴 「완료 시 수정」 — 완료된 줄은 그 권한이 있어야 건드릴 수 있다 (2026-11-19)
 * ============================================================================
 * 사용자 요청: 「[역할별 접근 권한]에 [PO/내자]의 [내자 정리]에 [완료 시 수정]을
 * 추가해줘. 여기서 수정권한을 가진 사람만 완료된 건에 대한 수정, 완료해제를 할 수
 * 있어야 해.」 되물어 받은 답이 **「완료된 줄의 모든 변경을 한 권한으로 묶는다」**였다.
 *
 * ── 🔴 왜 **이 층**에서 재는가 ──────────────────────────────────────────
 * 관문이 서버 액션이 아니라 **mutation 안**에 있기 때문이다. 그 자리를 고른 까닭은
 * 판정이 **줄의 지금 상태**(completed_at)에 달려 있어서다 — 액션에 걸면 줄을 한 번
 * 더 읽어 같은 판정을 두 곳에서 하게 되고, 완료를 누르는 자리가 넷(화면 둘 · 서버
 * 액션 하나 · PO 가 부르는 통로 하나)인데 그 넷이 전부 이 층으로 모인다.
 * 🔵 그래서 **화면을 거치지 않고** mutation 을 직접 불러 잰다. 화면이 단추를 감추는
 * 일은 다음 조각이고, 감추든 말든 이 층이 거절해야 한다.
 *
 * ── 이 파일이 못 박는 것 ────────────────────────────────────────────────
 *  ① 🔴 **완료된 줄**: 권한이 없으면 수정이 거절되고 **한 칸도 안 바뀐다**.
 *  ② 🔴 **완료되지 않은 줄**: 권한이 없어도 그대로 고쳐진다 — 새 권한이 평소 일을
 *     막으면 안 된다. 이것이 이 조각에서 **가장 조용히 깨질 수 있는 쪽**이다.
 *  ③ 🔴 **완료 해제**: 줄 단위와 회차 단위 **둘 다** 막힌다. 반대로 **완료 처리**는
 *     예전 그대로 `domesticOrders.edit` 하나로 된다.
 *  ④ 🔴 **AND**: `edit` 와 `completedEdit` 이 **둘 다** 있어야 통과한다. 한쪽만 연
 *     조합은 양쪽 방향 모두 막힌다(설정으로 실제로 만들어 보고 잰다).
 *  ⑤ 🔴 **수리 건 상세의 발행일 둘**(mutations/domestic-order-issue-dates.ts)도 같은
 *     관문을 지난다 — 갈리면 「목록에서는 막히는데 수리 건 상세에서는 되는」 뒷문이다.
 *  ⑥ 🔵 **기본값**: 영업·엔지니어·자재 담당자는 막히고 관리자 이상은 통과한다.
 *     운영 role_permissions 에 `domesticOrders%` 행이 0건이라(2026-11-19 실측) 이
 *     표가 곧 배포 뒤의 동작이다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 스위트만 쓰는 접수 월 "9508", 고객사 접두사 "AS-TEST-DO-COMPLETED-EDIT-",
 * 제품 모델 접두사 "DO-COMPLETED-EDIT-TEST-", 계정 이메일 접두사
 * "docompletededit-test-". 만드는 내자 줄은 id 를 모아 두었다가 그대로 지운다.
 *
 * 🔴 **설정 표(role_permissions)를 만지는 시험이 하나 있다**(④의 뒷면). 그 시험은
 * try/finally 로 제가 넣은 행만 걷어내고, after() 가 한 번 더 쓸어 담는다 — 남으면
 * **뒤따르는 남의 시험이 기본값 대신 그 행을 보게 된다.**
 *
 * after() 는 FK 순서대로 지운다 — 결재 행 → 내자 줄(납기요청일은 CASCADE) → 수리 건
 * → 제품 → 채번 → 고객사 → 설정 행 → 감사 기록(행위자로) → 계정.
 * ============================================================================
 */

const TEST_EMAIL_PREFIX = "docompletededit-test-";
const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-DO-COMPLETED-EDIT-";
const TEST_MODEL_PREFIX = "DO-COMPLETED-EDIT-TEST-";
const TEST_YEAR_MONTH = "9508";
const TEST_RECEIVED_AT = "2095-08-05";

/** 설정으로 만져 보는 두 잎. after() 가 이 둘만 쓸어 담는다. */
const TOUCHED_LEAF_KEYS = ["domesticOrders.edit", "domesticOrders.completedEdit"] as const;

/** 기본값으로 **통과하는** 사람(관리자). */
let adminId: string;
/** 설정을 넓힐 수 있는 유일한 역할 — ④의 뒷면이 이 사람으로 저장한다. */
let superAdminId: string;
/** 🔴 **`edit` 은 있고 `completedEdit` 만 없는 사람.** ④ AND 의 앞면이다. */
let salesId: string;
/** 접수 건의 담당 엔지니어 겸, 영업과 같은 자리에 있는 또 한 사람. */
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

async function readDueDateRows(orderId: string) {
  return db
    .select({
      displayOrder: domesticOrderDueDates.displayOrder,
      completedAt: domesticOrderDueDates.completedAt,
    })
    .from(domesticOrderDueDates)
    .where(eq(domesticOrderDueDates.domesticOrderId, orderId))
    .orderBy(asc(domesticOrderDueDates.displayOrder));
}

/**
 * 🔴 그 기타건의 **그 회차**에 「지금 판에 대한 승인」을 하나 박는다.
 *
 * 2026-11-07 부터 기타건(수리 건이 붙지 않은 줄)은 승인이 유효해야 완료된다. 이
 * 파일이 재는 것은 그 승인 절차가 아니라 **완료된 줄을 누가 건드릴 수 있는가**이므로,
 * 결재선·결재자·지정 관문을 끌어오지 않고 행을 직접 넣는다(이웃
 * domestic-orders.integration.test.ts 와 같은 판단 — 절차 자체는
 * misc-case-completion-approval.integration.test.ts 가 진짜 경로로 본다).
 *
 * 🔴 `repair_case_version_at_request` 가 **지금 version 이어야** 유효한 승인이다.
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

/** 승인을 박고 **줄 전체를 완료**까지 시켜 둔 기타건 하나. 완료 뒤 version 을 돌려준다. */
async function completedMiscOrder(overrides: Partial<DomesticOrderFields> = {}) {
  const created = await createOrder(overrides);
  await grantMiscCaseApproval(created.id, created.version);
  const completed = await setDomesticOrderCompletion({
    id: created.id,
    expectedVersion: created.version,
    completed: true,
    actorUserId: superAdminId,
  });
  assert.equal(completed.ok, true, `완료 처리 실패: ${JSON.stringify(completed)}`);
  if (!completed.ok) throw new Error("unreachable");
  const row = await readOrder(created.id);
  assert.notEqual(row.completedAt, null, "밑자락이 완료 상태가 아니다 — 이 시험은 아무것도 못 잰다");
  return { id: created.id, version: completed.version };
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

/** 이 스위트가 설정 표에 남긴 행만 걷는다 — 건드린 두 잎 × 영업 하나다. */
async function removeTouchedRolePermissions(): Promise<void> {
  await db
    .delete(rolePermissions)
    .where(
      and(
        eq(rolePermissions.role, "SALES"),
        inArray(rolePermissions.areaKey, [...TOUCHED_LEAF_KEYS])
      )
    );
}

before(async () => {
  await removeTestUsersByPrefix();

  superAdminId = await createTestUser("SUPER_ADMIN", "CompletedEdit 최고관리자");
  adminId = await createTestUser("ADMIN", "CompletedEdit 관리자");
  salesId = await createTestUser("SALES", "CompletedEdit 영업");
  engineerId = await createTestUser("AS_ENGINEER", "CompletedEdit 엔지니어");

  // ── 🔴 전제 — 표본이 비어서 공짜로 통과하지 않게 한다 ───────────────────
  // 시험 DB 의 설정이 기본 정책과 같아야 아래 시험들이 **뜻하는 것을 잰다.**
  // 어긋나면 엉뚱한 이유로 통과하거나 실패하므로 여기서 먼저 멈춘다.
  const stored = await db
    .select({ role: rolePermissions.role, areaKey: rolePermissions.areaKey })
    .from(rolePermissions)
    .where(inArray(rolePermissions.areaKey, [...TOUCHED_LEAF_KEYS]));
  assert.deepEqual(
    stored,
    [],
    "전제가 깨졌다: 시험 DB 에 내자 수정 권한 설정이 남아 있다 — 앞 실행이 치우지 못한 행이다"
  );

  assert.equal(
    await hasPermission(roleOnlyActor("SALES"), "domesticOrders.edit", "WRITE"),
    true,
    "전제가 깨졌다: 영업이 내자 줄을 고칠 수 없다 — AND 의 앞면을 잴 표본이 아니다"
  );
  assert.equal(
    await hasPermission(roleOnlyActor("SALES"), "domesticOrders.completedEdit", "WRITE"),
    false,
    "전제가 깨졌다: 영업에게 「완료 시 수정」이 열려 있다 — 막히는 역할을 다시 골라야 한다"
  );
  assert.equal(
    await hasPermission(roleOnlyActor("ADMIN"), "domesticOrders.edit", "WRITE"),
    true,
    "전제가 깨졌다: 관리자가 내자 줄을 고칠 수 없다"
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
  await removeTouchedRolePermissions();
  await removeTestUsersByPrefix();
  await pgClient.end({ timeout: 5 });
});

// ── ① 완료된 줄의 수정 ────────────────────────────────────────────────────

describe("① 🔴 완료된 줄은 「완료 시 수정」이 있어야 고쳐진다", () => {
  test("🔴 권한이 없으면 거절하고 **한 칸도 안 바꾼다**", async () => {
    const order = await completedMiscOrder({ purchaseOrderNumber: "PO-BEFORE" });

    const result = await updateDomesticOrder({
      id: order.id,
      expectedVersion: order.version,
      fields: fields({ purchaseOrderNumber: "PO-AFTER" }),
      actorUserId: salesId,
    });

    assert.equal(result.ok, false, "완료된 줄이 권한 없이 고쳐졌다");
    if (result.ok) return;
    assert.equal(result.code, "FORBIDDEN");
    assert.equal(result.message, COMPLETED_DOMESTIC_ORDER_EDIT_FORBIDDEN_MESSAGE);

    // 🔴 거절로 끝난 저장이 반만 들어가 있으면 안 된다 — version 도 안 오른다.
    const row = await readOrder(order.id);
    assert.equal(row.purchaseOrderNumber, "PO-BEFORE");
    assert.equal(row.version, order.version);
    assert.notEqual(row.completedAt, null, "거절된 저장이 완료 표시를 건드렸다");
  });

  test("🔴 권한이 있으면 그대로 고쳐진다 — 완료된 줄도 관리자는 만진다", async () => {
    const order = await completedMiscOrder({ purchaseOrderNumber: "PO-ADMIN-BEFORE" });

    const result = await updateDomesticOrder({
      id: order.id,
      expectedVersion: order.version,
      fields: fields({ purchaseOrderNumber: "PO-ADMIN-AFTER" }),
      actorUserId: adminId,
    });

    assert.equal(result.ok, true, `권한이 있는데 막혔다: ${JSON.stringify(result)}`);
    const row = await readOrder(order.id);
    assert.equal(row.purchaseOrderNumber, "PO-ADMIN-AFTER");
    assert.equal(row.version, order.version + 1);
    // 고친다고 완료가 풀리지는 않는다 — 이 저장은 그 칸을 건드리지 않는다.
    assert.notEqual(row.completedAt, null);
  });

  test("🔴 **완료되지 않은 줄**은 「완료 시 수정」이 없어도 고쳐진다", async () => {
    // 🔴 이 조각에서 가장 조용히 깨질 수 있는 쪽이다 — 새 권한이 평소 일까지
    //    막으면 영업은 내자 정리를 아예 못 쓰게 되는데, 아무도 「권한 때문」이라고
    //    생각하지 못한다.
    const order = await createOrder({ purchaseOrderNumber: "PO-OPEN-BEFORE" });
    const row = await readOrder(order.id);
    assert.equal(row.completedAt, null, "표본이 이미 완료다 — 이 시험이 뜻을 잃는다");

    const result = await updateDomesticOrder({
      id: order.id,
      expectedVersion: order.version,
      fields: fields({ purchaseOrderNumber: "PO-OPEN-AFTER" }),
      actorUserId: salesId,
    });

    assert.equal(result.ok, true, `완료되지 않은 줄이 막혔다: ${JSON.stringify(result)}`);
    assert.equal((await readOrder(order.id)).purchaseOrderNumber, "PO-OPEN-AFTER");
  });
});

// ── ② 완료 해제 — 줄 단위 ─────────────────────────────────────────────────

describe("② 🔴 줄의 완료 해제", () => {
  test("🔴 권한이 없으면 거절하고 줄은 완료인 채로 남는다", async () => {
    const order = await completedMiscOrder();

    const result = await setDomesticOrderCompletion({
      id: order.id,
      expectedVersion: order.version,
      completed: false,
      actorUserId: salesId,
    });

    assert.equal(result.ok, false, "권한 없이 완료가 풀렸다");
    if (result.ok) return;
    assert.equal(result.code, "FORBIDDEN");
    assert.equal(result.message, COMPLETED_DOMESTIC_ORDER_EDIT_FORBIDDEN_MESSAGE);

    const row = await readOrder(order.id);
    assert.notEqual(row.completedAt, null, "거절했는데 완료가 풀려 있다");
    assert.equal(row.version, order.version, "거절한 저장이 version 을 올렸다");
  });

  test("🔴 권한이 있으면 풀린다 — 두 칸이 함께 비워진다", async () => {
    const order = await completedMiscOrder();

    const result = await setDomesticOrderCompletion({
      id: order.id,
      expectedVersion: order.version,
      completed: false,
      actorUserId: adminId,
    });

    assert.equal(result.ok, true, `권한이 있는데 막혔다: ${JSON.stringify(result)}`);
    const row = await readOrder(order.id);
    assert.equal(row.completedAt, null);
    assert.equal(row.completedBy, null);
  });

  test("🔵 **완료 처리**는 막지 않는다 — 영업이 예전 그대로 끝낸다", async () => {
    // 🔴 사용자가 요구한 것은 「완료된 건의 수정과 완료 해제」다. 완료 처리까지
    //    막으면 내자 정리의 평소 흐름이 관리자에게만 열린 기능이 된다.
    const created = await createOrder();
    await grantMiscCaseApproval(created.id, created.version);

    const result = await setDomesticOrderCompletion({
      id: created.id,
      expectedVersion: created.version,
      completed: true,
      actorUserId: salesId,
    });

    assert.equal(result.ok, true, `완료 처리가 막혔다: ${JSON.stringify(result)}`);
    assert.notEqual((await readOrder(created.id)).completedAt, null);
  });
});

// ── ③ 완료 해제 — 회차 단위 ───────────────────────────────────────────────

describe("③ 🔴 회차의 완료 해제", () => {
  /**
   * 🔴 **한 시험 안에서 차례대로 밟는다.** 회차 완료는 앞 단계의 결과 위에서만 뜻을
   * 갖고(2차를 끝내야 줄이 완료된다), 단계를 시험 여럿으로 쪼개면 실행 차례에 기대는
   * 모양이 된다. 단계마다 무엇을 재는지는 아래 주석이 말한다.
   */
  test("완료 처리는 되고, 해제는 권한이 있어야 한다 — 그리고 줄까지 함께 풀린다", async () => {
    const order = await createOrder({
      dueDates: [
        { dueDate: "2095-08-20", note: "1차분", deliveredDate: null, deliveredBy: null },
        { dueDate: "2095-09-20", note: "2차분", deliveredDate: null, deliveredBy: null },
      ],
    });
    // 회차마다 승인이 따로 선다(2026-11-08 결정 13). 회차 완료는 version 을 올리지
    // 않으므로 둘 다 지금 version 으로 박아 둔다.
    await grantMiscCaseApproval(order.id, order.version, 1);
    await grantMiscCaseApproval(order.id, order.version, 2);
    assert.equal((await readDueDateRows(order.id)).length, 2, "표본이 회차 둘이 아니다");

    // ── ㉠ 회차 **완료 처리**는 영업이 그대로 한다 ─────────────────────────
    const completedFirst = await setDomesticOrderDueDateRowCompletion({
      id: order.id,
      expectedVersion: order.version,
      dueDateRowOrder: 1,
      completed: true,
      actorUserId: salesId,
    });
    assert.equal(completedFirst.ok, true, `회차 완료가 막혔다: ${JSON.stringify(completedFirst)}`);
    assert.notEqual((await readDueDateRows(order.id))[0].completedAt, null);

    // ── ㉡ 그 회차의 **해제**는 막힌다 ─────────────────────────────────────
    const deniedRelease = await setDomesticOrderDueDateRowCompletion({
      id: order.id,
      expectedVersion: order.version,
      dueDateRowOrder: 1,
      completed: false,
      actorUserId: salesId,
    });
    assert.equal(deniedRelease.ok, false, "권한 없이 회차 완료가 풀렸다");
    if (deniedRelease.ok) return;
    assert.equal(deniedRelease.code, "FORBIDDEN");
    assert.equal(deniedRelease.message, COMPLETED_DOMESTIC_ORDER_EDIT_FORBIDDEN_MESSAGE);
    assert.notEqual(
      (await readDueDateRows(order.id))[0].completedAt,
      null,
      "거절했는데 회차가 풀려 있다"
    );

    // ── ㉢ 2차까지 끝나면 줄이 자동으로 완료된다(결정 8) ───────────────────
    const completedSecond = await setDomesticOrderDueDateRowCompletion({
      id: order.id,
      expectedVersion: order.version,
      dueDateRowOrder: 2,
      completed: true,
      actorUserId: salesId,
    });
    assert.equal(completedSecond.ok, true, `2차 완료가 막혔다: ${JSON.stringify(completedSecond)}`);
    assert.notEqual((await readOrder(order.id)).completedAt, null, "줄이 자동 완료되지 않았다");

    // ── ㉣ 권한이 있으면 풀린다 — 그리고 줄의 완료도 함께 거둬진다 ─────────
    // 🔴 이것이 회차 해제를 같은 열쇠로 막는 까닭이다. 안 막으면 영업은 회차 단추로
    //    **줄 단위 완료 해제**를 하게 된다.
    const released = await setDomesticOrderDueDateRowCompletion({
      id: order.id,
      expectedVersion: order.version,
      dueDateRowOrder: 2,
      completed: false,
      actorUserId: adminId,
    });
    assert.equal(released.ok, true, `권한이 있는데 막혔다: ${JSON.stringify(released)}`);
    assert.equal((await readDueDateRows(order.id))[1].completedAt, null);
    assert.equal((await readOrder(order.id)).completedAt, null, "줄의 완료가 따라 풀리지 않았다");
  });
});

// ── ④ AND — 둘 다 있어야 한다 ─────────────────────────────────────────────

describe("④ 🔴 `edit` 와 `completedEdit` 은 AND 다", () => {
  test("🔴 `edit` 는 있고 `completedEdit` 만 없으면 막힌다 — 영업의 기본 상태", async () => {
    // 🔵 ①의 첫 시험과 같은 사실을 **판정 함수로** 다시 못 박는다. 저쪽은 저장이
    //    거절되는 것을, 이쪽은 **그 거절의 까닭**이 AND 라는 것을 잰다.
    assert.equal(
      await hasPermission(roleOnlyActor("SALES"), "domesticOrders.edit", "WRITE"),
      true,
      "표본이 깨졌다 — 수정 자체가 막혀 있으면 AND 를 재지 못한다"
    );
    assert.equal(await canEditCompletedDomesticOrder(roleOnlyActor("SALES")), false);
  });

  test("🔴 거꾸로도 막힌다 — `completedEdit` 만 열고 `edit` 를 닫으면 통과하지 못한다", async () => {
    /**
     * 🔴 설정으로 **실제로 만들어 보고** 잰다. 두 잎이 따로 저장되므로 이 조합은
     * 관리자가 만들 수 있고, 이 시험이 없으면 「수정은 닫아 뒀는데 완료된 줄만
     * 고쳐지는」 문이 조용히 열려도 아무도 모른다.
     *
     * 🔴 **최고관리자로 저장한다** — 기본 정책보다 넓게 주는 것은 최고관리자만 할 수
     * 있어서, 관리자로 부르면 영업 쪽이 **조용히 기본값으로 깎인 채 ok:true** 가 온다.
     * 🔴 끝에서 반드시 치운다. 남으면 뒤따르는 남의 시험이 기본값 대신 이 행을 본다.
     */
    const order = await completedMiscOrder({ purchaseOrderNumber: "PO-AND-BEFORE" });
    try {
      const saved = await saveRolePermissions({
        changes: [
          {
            role: "SALES",
            levels: {
              "domesticOrders.edit": "NONE",
              "domesticOrders.completedEdit": "WRITE",
            },
          },
        ],
        actorUserId: superAdminId,
      });
      assert.equal(saved.ok, true, `설정 저장이 거절됐다: ${JSON.stringify(saved)}`);
      if (!saved.ok) return;
      assert.equal(saved.changedCount, 2, "두 잎 모두 실제로 저장돼야 한다");

      // 🔴 설정이 정말로 그 모양인지 먼저 본다 — 깎인 채 저장됐으면 아래 단언이
      //    「AND 때문에 막혔다」가 아니라 「애초에 안 열렸다」를 재게 된다.
      assert.equal(
        await hasPermission(roleOnlyActor("SALES"), "domesticOrders.completedEdit", "WRITE"),
        true,
        "넓힌 설정이 반영되지 않았다"
      );
      assert.equal(
        await hasPermission(roleOnlyActor("SALES"), "domesticOrders.edit", "WRITE"),
        false,
        "좁힌 설정이 반영되지 않았다"
      );

      assert.equal(
        await canEditCompletedDomesticOrder(roleOnlyActor("SALES")),
        false,
        "OR 로 걸려 있다 — 수정을 닫아 둔 사람에게 완료된 줄이 열렸다"
      );

      const result = await updateDomesticOrder({
        id: order.id,
        expectedVersion: order.version,
        fields: fields({ purchaseOrderNumber: "PO-AND-AFTER" }),
        actorUserId: salesId,
      });
      assert.equal(result.ok, false, "한쪽만 연 조합으로 완료된 줄이 고쳐졌다");
      if (result.ok) return;
      assert.equal(result.code, "FORBIDDEN");
      assert.equal((await readOrder(order.id)).purchaseOrderNumber, "PO-AND-BEFORE");
    } finally {
      await removeTouchedRolePermissions();
    }

    // 치운 뒤에는 기본값으로 돌아온다 — 설정을 만지지 않은 상태가 종전 동작이다.
    assert.equal(
      await hasPermission(roleOnlyActor("SALES"), "domesticOrders.edit", "WRITE"),
      true,
      "설정을 치웠는데 기본값으로 안 돌아왔다"
    );
    assert.equal(
      await hasPermission(roleOnlyActor("SALES"), "domesticOrders.completedEdit", "WRITE"),
      false
    );
  });
});

// ── ⑤ 수리 건 상세의 발행일 둘 ────────────────────────────────────────────

describe("⑤ 🔴 수리 건 상세에서 고치는 발행일도 같은 관문을 지난다", () => {
  test("완료된 줄이면 영업은 거절당하고, 관리자는 저장한다", async () => {
    // 🔴 갈리면 「목록에서는 막히는데 수리 건 상세에서는 되는」 뒷문이다. 그 화면은
    //    줄 전체를 들고 있지 않아 **다른 저장 경로**를 쓴다(그 파일 머리말).
    const created = await createRepairCase(baseCreateRepairCaseInput());
    assert.equal(created.ok, true, `수리 건 만들기 실패: ${JSON.stringify(created)}`);
    if (!created.ok) return;

    const order = await createOrder({ repairCaseId: created.id });
    // 🔵 수리 건이 붙은 줄은 기타건이 아니라 승인 관문이 서지 않는다 — 바로 완료된다.
    const completed = await setDomesticOrderCompletion({
      id: order.id,
      expectedVersion: order.version,
      completed: true,
      actorUserId: superAdminId,
    });
    assert.equal(completed.ok, true, `밑자락 완료 실패: ${JSON.stringify(completed)}`);
    if (!completed.ok) return;

    const denied = await saveRepairCaseDomesticOrderIssueDates({
      repairCaseId: created.id,
      quoteIssuedDate: "2095-08-10",
      orderIssuedDate: null,
      expectedVersion: completed.version,
      actorUserId: salesId,
    });
    assert.equal(denied.ok, false, "완료된 줄의 발행일이 권한 없이 바뀌었다");
    if (denied.ok) return;
    assert.equal(denied.code, "FORBIDDEN");
    // 🔴 `edit` 관문의 문장이 아니라 **「완료 시 수정」의 문장**이어야 한다 — 두 거절이
    //    같은 코드를 쓰므로, 글자가 갈라야 어느 관문에 걸렸는지 알 수 있다.
    assert.equal(denied.message, COMPLETED_DOMESTIC_ORDER_EDIT_FORBIDDEN_MESSAGE);
    assert.equal((await readOrder(order.id)).quoteIssuedDate, null, "거절했는데 날짜가 들어갔다");

    const allowed = await saveRepairCaseDomesticOrderIssueDates({
      repairCaseId: created.id,
      quoteIssuedDate: "2095-08-10",
      orderIssuedDate: null,
      expectedVersion: completed.version,
      actorUserId: adminId,
    });
    assert.equal(allowed.ok, true, `권한이 있는데 막혔다: ${JSON.stringify(allowed)}`);
    assert.equal((await readOrder(order.id)).quoteIssuedDate, "2095-08-10");
  });
});

// ── ⑥ 기본값 — 역할마다 무엇이 되고 안 되는가 ─────────────────────────────

describe("⑥ 🔵 기본 정책에서 통과하는 역할", () => {
  test("최고관리자·관리자만 통과한다 — 영업·엔지니어·자재 담당자는 막힌다", async () => {
    // 🔴 운영 `role_permissions` 에 `domesticOrders%` 행이 0건이라(2026-11-19 실측)
    //    이 표가 곧 배포 뒤의 동작이다. 넓게 잡으면 배포해도 아무것도 안 막힌다.
    const expected: Record<Role, boolean> = {
      SUPER_ADMIN: true,
      ADMIN: true,
      SALES: false,
      AS_ENGINEER: false,
      INVENTORY_MANAGER: false,
    };
    assert.equal(ROLE_CODES.length, 5, "역할 수가 달라졌다 — 이 표를 다시 잴 것");
    for (const role of ROLE_CODES) {
      assert.equal(
        await canEditCompletedDomesticOrder(roleOnlyActor(role)),
        expected[role],
        `${role}: 완료된 줄을 건드릴 수 있는가가 달라졌다`
      );
    }
    // 표본이 공짜가 아니다 — 통과하는 쪽과 막히는 쪽이 둘 다 있다.
    const values = ROLE_CODES.map((role) => expected[role]);
    assert.ok(values.includes(true) && values.includes(false));
  });

  test("🔵 엔지니어도 완료된 줄은 못 고친다 — 수정은 되는데 그 줄만 막힌다", async () => {
    // 2026-09-29 에 보기·고치기가 엔지니어까지 넓어졌다(domestic-order-authorization.ts).
    // 그 결정은 「읽기/쓰기」까지였고 삭제·복원은 관리자 이상 그대로다 — 새 잎은 그
    // 뒤쪽 선에 붙는다.
    const order = await completedMiscOrder({ purchaseOrderNumber: "PO-ENG-BEFORE" });
    const result = await updateDomesticOrder({
      id: order.id,
      expectedVersion: order.version,
      fields: fields({ purchaseOrderNumber: "PO-ENG-AFTER" }),
      actorUserId: engineerId,
    });
    assert.equal(result.ok, false, "엔지니어가 완료된 줄을 고쳤다");
    if (result.ok) return;
    assert.equal(result.code, "FORBIDDEN");
    assert.equal((await readOrder(order.id)).purchaseOrderNumber, "PO-ENG-BEFORE");
  });
});
