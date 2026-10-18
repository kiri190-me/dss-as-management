import "../../../../../scripts/load-env";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { and, eq, inArray, like } from "drizzle-orm";
import { NextRequest } from "next/server";

import { db, pgClient } from "@/lib/db/connection";
import {
  customers,
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
} from "@/lib/db/schema";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { createDomesticOrder } from "@/lib/db/mutations/domestic-orders";
import { createRepairCase } from "@/lib/db/mutations/repair-cases";
import {
  decideRepairCaseApproval,
  requestRepairCaseApproval,
} from "@/lib/db/mutations/repair-case-approvals";
import { DOMESTIC_ORDER_SHIPMENT_COMPLETION_REASON } from "@/lib/server/services/complete-domestic-order";
import { DOMESTIC_ORDER_SHIPMENT_REVERT_REASON } from "@/lib/server/services/release-domestic-order";
import type { DomesticOrderFields } from "@/lib/validation/domestic-order-input";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

import { POST } from "./[id]/completion/route";

/**
 * ============================================================================
 * PO 가 부르는 통로 — `POST /api/v1/domestic-orders/{id}/completion` (2026-10-18)
 * ============================================================================
 * 🔴 **라우트 핸들러를 진짜로 부른다.** 통로의 값어치는 「서비스가 되더라」가
 * 아니라 **자격을 가리는 두 겹이 실제로 막는가**에 있고, 그 두 겹은 라우트에만
 * 있다(서비스는 권한을 보지 않는다 — 그 파일 머리말). 서비스 자체의 네 갈래는
 * 이웃 `services/complete-domestic-order.integration.test.ts` 와
 * `release-domestic-order.integration.test.ts` 가 이미 본다.
 *
 * 여기서 못 박는 것:
 *  1. 토큰이 없으면 401 이고 **DB 에 닿지 않는다**(내자 줄이 그대로다).
 *  2. 🔴 모르는 `sub` 는 403 — PO 가 보낸 사람 식별자를 A/S 가 **다시** 본다.
 *  3. 🔴 내자 정리를 고칠 수 없는 역할은 403 — 화면의 서버 액션과 같은 관문이다.
 *  4. 🔴 승인되지 않은 계정도 403.
 *  5. 제대로 된 요청은 **내자 줄과 수리 건을 함께** 움직이고, 이력의 사유가
 *     자동 문구라 사람이 직접 누른 것과 갈린다.
 *  6. 같은 POST 에 `completed: false` 를 보내면 **되돌아간다**(통로 하나가 둘을
 *     모두 받는다).
 *  7. 🔴 `completed` 가 빠진 본문은 400 이고 **아무것도 움직이지 않는다** —
 *     조용히 「완료 해제」로 읽히면 수리 건의 출하 완료까지 풀린다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 스위트만 쓰는 접수 월 "9309", 제품 모델 접두사 "DOAPI-TEST-", 고객사 접두사
 * "AS-TEST-DOAPI-", 계정 접두사 "doapi-test-". 🔴 씨앗 계정의 `sso_subject` 를
 * 건드리지 않는다 — 부르는 사람은 전부 여기서 만들어 쓰고 after() 가 지운다.
 *
 * waiting_shipment 에 바로 세우는 것은 **상황 만들기 전용 SQL** 이다(이웃 두
 * 스위트와 같은 방식).
 *
 * after() 는 FK 차례대로 지운다 — domestic_orders → 이력·승인 → repair_cases →
 * products → 채번 → customers → 이 파일이 만든 계정.
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-DOAPI-";
const TEST_MODEL_PREFIX = "DOAPI-TEST-";
const TEST_EMAIL_PREFIX = "doapi-test-";
const TEST_YEAR_MONTH = "9309";
const TEST_RECEIVED_AT = "2093-09-10";
const TOKEN = "doapi-test-write-token-0123456789abcdef";

const ORIGINAL_WRITE_TOKEN = process.env.AS_WRITE_TOKEN;
const ORIGINAL_AUTH_SOURCE = process.env.AUTH_SOURCE;

let customerId: string;
let engineerId: string;
let adminId: string;
let representativeId: string;
let matcherWorkflowVersionId: string;

/** 내자 정리를 고칠 수 있고 출하 완료도 누를 수 있는 사람(마이그레이션 0117). */
let salesId: string;
let salesSub: string;
/**
 * 🔴 **내자 정리를 고칠 수 없는 사람의 표본.** 지키는 것은 「재고 담당자가
 * 막힌다」가 아니라 「**고칠 수 없는 사람은 이 통로로도 못 고친다**」이므로,
 * 정책이 바뀌면 지키는 대상은 그대로 두고 표본만 갈아 끼운다(같은 표본을
 * mutations/domestic-order-sheet-settings.integration.test.ts 가 쓴다).
 */
let inventoryManagerSub: string;
/** 승인 대기 계정 — 역할은 열려 있어도 막혀야 한다. */
let pendingSalesSub: string;

const createdOrderIds: string[] = [];
const createdUserIds: string[] = [];

async function createTestUser(overrides: Partial<typeof users.$inferInsert> = {}): Promise<{
  id: string;
  sub: string;
}> {
  const sub = randomUUID();
  const [row] = await db
    .insert(users)
    .values({
      email: `${TEST_EMAIL_PREFIX}${randomUUID().slice(0, 8)}@example.test`,
      name: "DomesticOrder API Test User",
      role: "SALES",
      approvalStatus: "APPROVED",
      isActive: true,
      ssoSubject: sub,
      ...overrides,
    })
    .returning({ id: users.id });
  createdUserIds.push(row.id);
  return { id: row.id, sub };
}

/** 이전 실행이 중간에 끊겨 남은 것까지 접두사로 함께 걷는다. */
async function removeTestUsersByPrefix(): Promise<void> {
  const leftovers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  const ids = leftovers.map((row) => row.id);
  if (ids.length === 0) return;
  await db.delete(users).where(inArray(users.id, ids));
}

before(async () => {
  process.env.AS_WRITE_TOKEN = TOKEN;
  process.env.AUTH_SOURCE = "database";

  await removeTestUsersByPrefix();

  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(engineer, "expected at least one approved AS_ENGINEER in the test DB");
  engineerId = engineer.id;

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

  const sales = await createTestUser({ role: "SALES", name: "DOAPI 영업" });
  salesId = sales.id;
  salesSub = sales.sub;
  inventoryManagerSub = (await createTestUser({ role: "INVENTORY_MANAGER", name: "DOAPI 재고 담당" })).sub;
  pendingSalesSub = (await createTestUser({ approvalStatus: "PENDING", name: "DOAPI 승인 대기 영업" })).sub;

  // 전제: 시험 DB 의 권한 설정이 기본 정책과 같다. 여기서 어긋나면 아래 인가
  // 시험이 엉뚱한 이유로 통과·실패하므로 먼저 멈춘다.
  assert.equal(
    await hasPermission({ role: "SALES", isDeveloper: false }, "domesticOrders", "WRITE"),
    true,
    "영업이 내자 정리를 고칠 수 없는 설정이다 — 이 시험의 전제가 깨졌다"
  );
  assert.equal(
    await hasPermission({ role: "INVENTORY_MANAGER", isDeveloper: false }, "domesticOrders", "WRITE"),
    false,
    "재고 담당자가 내자 정리를 고칠 수 있는 설정이다 — 막히는 쪽 표본을 갈아 끼워야 한다"
  );

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
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  await removeTestUsersByPrefix();

  if (ORIGINAL_WRITE_TOKEN === undefined) delete process.env.AS_WRITE_TOKEN;
  else process.env.AS_WRITE_TOKEN = ORIGINAL_WRITE_TOKEN;
  if (ORIGINAL_AUTH_SOURCE === undefined) delete process.env.AUTH_SOURCE;
  else process.env.AUTH_SOURCE = ORIGINAL_AUTH_SOURCE;

  await pgClient.end({ timeout: 5 });
});

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

async function createTestCase(): Promise<string> {
  const result = await createRepairCase(baseCreateRepairCaseInput());
  assert.equal(result.ok, true, `setup repair case failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result.id;
}

async function placeCaseAtStep(caseId: string, key: string) {
  const [step] = await db
    .select({ id: workflowSteps.id })
    .from(workflowSteps)
    .where(and(eq(workflowSteps.workflowVersionId, matcherWorkflowVersionId), eq(workflowSteps.key, key)));
  assert.ok(step, `expected workflow_steps row for PAID_MATCHER/${key}`);
  await db.update(repairCases).set({ currentWorkflowStepId: step.id }).where(eq(repairCases.id, caseId));
}

/** 최종 출하 승인까지 받아 둔다(수리 검수 승인이 먼저다 — 그 순서가 규칙이다). */
async function grantFinalShipmentApproval(caseId: string) {
  const inspectionRequest = await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);
  assert.equal(inspectionRequest.ok, true, `inspection request failed: ${JSON.stringify(inspectionRequest)}`);
  const inspectionDecision = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", adminId, null);
  assert.equal(inspectionDecision.ok, true, `inspection decision failed: ${JSON.stringify(inspectionDecision)}`);

  const shipmentRequest = await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, null);
  assert.equal(shipmentRequest.ok, true, `shipment request failed: ${JSON.stringify(shipmentRequest)}`);
  const shipmentDecision = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", representativeId, null);
  assert.equal(shipmentDecision.ok, true, `shipment decision failed: ${JSON.stringify(shipmentDecision)}`);
}

async function createOrder(overrides: Partial<DomesticOrderFields> = {}) {
  const result = await createDomesticOrder({ fields: { ...emptyFields(), ...overrides }, actorUserId: salesId });
  assert.equal(result.ok, true, `setup create order failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdOrderIds.push(result.id);
  return result;
}

async function readOrder(id: string) {
  const [row] = await db.select().from(domesticOrders).where(eq(domesticOrders.id, id));
  assert.ok(row, `expected domestic_orders row ${id} to exist`);
  return row;
}

async function readCase(id: string) {
  const [row] = await db
    .select({
      version: repairCases.version,
      isLocked: repairCases.isLocked,
      actualShipmentDate: repairCases.actualShipmentDate,
      stepKey: workflowSteps.key,
    })
    .from(repairCases)
    .innerJoin(workflowSteps, eq(workflowSteps.id, repairCases.currentWorkflowStepId))
    .where(eq(repairCases.id, id));
  assert.ok(row, `expected repair_cases row ${id} to exist`);
  return row;
}

async function historyReasons(caseId: string) {
  const rows = await db
    .select({ reason: statusChangeHistories.reason })
    .from(statusChangeHistories)
    .where(eq(statusChangeHistories.repairCaseId, caseId));
  return rows.map((row) => row.reason);
}

/** 통로를 실제로 두드린다. `token: null` 이면 머리말을 아예 안 붙인다. */
async function call(
  id: string,
  body: unknown,
  options: { token?: string | null } = {}
): Promise<{ status: number; json: Record<string, unknown> }> {
  const token = options.token === undefined ? TOKEN : options.token;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  const request = new NextRequest(`http://as.example.test/api/v1/domestic-orders/${id}/completion`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const response = await POST(request, { params: Promise.resolve({ id }) });
  assert.equal(response.headers.get("cache-control"), "no-store", "응답이 캐시될 수 있다");
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

describe("POST /api/v1/domestic-orders/{id}/completion — 자격", () => {
  test("① 토큰이 없으면 401 이고 내자 줄은 그대로다", async () => {
    const order = await createOrder({ purchaseOrderNumber: "PO-NO-TOKEN" });

    const noHeader = await call(order.id, { completed: true, expectedVersion: order.version, requester: { sub: salesSub } }, { token: null });
    assert.equal(noHeader.status, 401);
    assert.deepEqual(noHeader.json, { error: "unauthorized", message: "토큰이 없거나 맞지 않습니다." });

    const wrong = await call(order.id, { completed: true, expectedVersion: order.version, requester: { sub: salesSub } }, { token: "wrong-token" });
    assert.equal(wrong.status, 401);

    const row = await readOrder(order.id);
    assert.equal(row.completedAt, null, "토큰 없이 완료 처리가 되었다");
    assert.equal(row.version, order.version);
  });

  test("② 🔴 모르는 sub 는 403 — PO 의 말을 믿지 않는다", async () => {
    const order = await createOrder({ purchaseOrderNumber: "PO-UNKNOWN-SUB" });

    const result = await call(order.id, {
      completed: true,
      expectedVersion: order.version,
      requester: { sub: randomUUID() },
    });

    assert.equal(result.status, 403);
    assert.equal(result.json.code, "FORBIDDEN");
    const row = await readOrder(order.id);
    assert.equal(row.completedAt, null);
    assert.equal(row.version, order.version);
  });

  test("③ 🔴 내자 정리를 고칠 수 없는 역할은 403 — 화면과 같은 관문이다", async () => {
    const order = await createOrder({ purchaseOrderNumber: "PO-NO-PERMISSION" });

    const result = await call(order.id, {
      completed: true,
      expectedVersion: order.version,
      requester: { sub: inventoryManagerSub },
    });

    assert.equal(result.status, 403);
    assert.equal(result.json.code, "FORBIDDEN");
    const row = await readOrder(order.id);
    assert.equal(row.completedAt, null, "권한 없는 사람의 요청으로 완료 처리가 되었다");
    assert.equal(row.version, order.version);
  });

  test("④ 승인되지 않은 계정도 403", async () => {
    const order = await createOrder({ purchaseOrderNumber: "PO-PENDING" });

    const result = await call(order.id, {
      completed: true,
      expectedVersion: order.version,
      requester: { sub: pendingSalesSub },
    });

    assert.equal(result.status, 403);
    const row = await readOrder(order.id);
    assert.equal(row.completedAt, null);
  });

  test("⑤ 🔴 거절 응답이 까닭을 가르지 않는다 — 두드려 볼 실마리를 주지 않는다", async () => {
    const order = await createOrder({ purchaseOrderNumber: "PO-OPAQUE" });
    const unknown = await call(order.id, {
      completed: true,
      expectedVersion: order.version,
      requester: { sub: randomUUID() },
    });
    const noPermission = await call(order.id, {
      completed: true,
      expectedVersion: order.version,
      requester: { sub: inventoryManagerSub },
    });
    assert.deepEqual(unknown.json, noPermission.json, "「그런 사람 없음」과 「권한 없음」이 응답에서 갈린다");
  });
});

describe("POST /api/v1/domestic-orders/{id}/completion — 본문 검증", () => {
  test("🔴 completed 가 빠지면 400 이고 아무것도 움직이지 않는다", async () => {
    const caseId = await createTestCase();
    await placeCaseAtStep(caseId, "waiting_shipment");
    const order = await createOrder({ repairCaseId: caseId, purchaseOrderNumber: "PO-NO-COMPLETED-KEY" });

    const result = await call(order.id, { expectedVersion: order.version, requester: { sub: salesSub } });

    assert.equal(result.status, 400);
    assert.equal(result.json.code, "VALIDATION_ERROR");
    assert.deepEqual(result.json.fieldErrors, { completed: "완료 여부를 확인할 수 없습니다." });

    const row = await readOrder(order.id);
    assert.equal(row.completedAt, null);
    assert.equal(row.version, order.version);
    const repairCase = await readCase(caseId);
    assert.equal(repairCase.stepKey, "waiting_shipment", "완료 해제로 읽혀 수리 건이 움직였다");
  });

  test("본문이 JSON 이 아니면 400 — 「칸이 빠졌음」으로 둔갑하지 않는다", async () => {
    const order = await createOrder({ purchaseOrderNumber: "PO-BAD-JSON" });
    const result = await call(order.id, "not json at all");
    assert.equal(result.status, 400);
    assert.deepEqual(result.json.fieldErrors, { body: "요청 본문을 읽을 수 없습니다." });
  });

  test("id 가 UUID 모양이 아니면 400 — DB 에 닿기 전에 막는다", async () => {
    const result = await call("not-a-uuid", {
      completed: true,
      expectedVersion: 1,
      requester: { sub: salesSub },
    });
    assert.equal(result.status, 400);
    assert.deepEqual(result.json.fieldErrors, { id: "항목을 확인할 수 없습니다." });
  });

  test("version 이 어긋나면 409 CONFLICT", async () => {
    const order = await createOrder({ purchaseOrderNumber: "PO-STALE-VERSION" });
    const result = await call(order.id, {
      completed: true,
      expectedVersion: order.version + 5,
      requester: { sub: salesSub },
    });
    assert.equal(result.status, 409);
    assert.equal(result.json.code, "CONFLICT");
  });
});

describe("POST /api/v1/domestic-orders/{id}/completion — 실제로 움직인다", () => {
  test("🔴 제대로 된 요청은 내자 줄과 수리 건을 함께 움직이고, 다시 부르면 되돌아간다", async () => {
    const caseId = await createTestCase();
    await placeCaseAtStep(caseId, "waiting_shipment");
    await grantFinalShipmentApproval(caseId);
    const order = await createOrder({ repairCaseId: caseId, purchaseOrderNumber: "PO-THROUGH-API" });

    // ── 완료 처리 ──────────────────────────────────────────────────────
    const completed = await call(order.id, {
      completed: true,
      expectedVersion: order.version,
      requester: { sub: salesSub },
    });

    assert.equal(completed.status, 200, `completion failed: ${JSON.stringify(completed.json)}`);
    assert.equal(completed.json.ok, true);
    assert.equal(completed.json.id, order.id);
    assert.equal(completed.json.version, order.version + 1);
    // 🔵 PO 화면이 성공 문구를 가르는 데 쓰는 두 칸이 그대로 실려 나간다.
    assert.equal(completed.json.repairCaseShipmentCompleted, true);
    assert.equal(completed.json.repairCaseShipmentReverted, false);

    const afterComplete = await readOrder(order.id);
    assert.ok(afterComplete.completedAt, "내자 줄이 완료 처리되어야 한다");
    // 🔴 「누가 눌렀나」가 PO 가 보낸 sub 로 되짚어진 A/S 계정이어야 한다.
    assert.equal(afterComplete.completedBy, salesId);

    const shippedCase = await readCase(caseId);
    assert.equal(shippedCase.stepKey, "shipment_completed");
    assert.equal(shippedCase.isLocked, true);
    assert.ok(shippedCase.actualShipmentDate, "출하 완료는 실제 출하일을 적는다");

    // 🔴 이력에 **내자에서 따라온 일**임이 드러나야 한다.
    const reasonsAfterComplete = await historyReasons(caseId);
    assert.ok(
      reasonsAfterComplete.includes(DOMESTIC_ORDER_SHIPMENT_COMPLETION_REASON),
      `자동 문구가 이력에 없다: ${JSON.stringify(reasonsAfterComplete)}`
    );

    // ── 완료 해제 — 같은 POST 가 둘을 모두 받는다 ──────────────────────
    const released = await call(order.id, {
      completed: false,
      expectedVersion: afterComplete.version,
      requester: { sub: salesSub },
    });

    assert.equal(released.status, 200, `release failed: ${JSON.stringify(released.json)}`);
    assert.equal(released.json.repairCaseShipmentReverted, true);
    assert.equal(released.json.repairCaseShipmentCompleted, false);

    const afterRelease = await readOrder(order.id);
    assert.equal(afterRelease.completedAt, null, "완료 표시가 풀려야 한다");

    const revertedCase = await readCase(caseId);
    assert.equal(revertedCase.stepKey, "waiting_shipment", "출하 완료가 되돌아가야 한다");
    assert.equal(revertedCase.isLocked, false);
    assert.equal(revertedCase.actualShipmentDate, null);

    const reasonsAfterRelease = await historyReasons(caseId);
    assert.ok(
      reasonsAfterRelease.includes(DOMESTIC_ORDER_SHIPMENT_REVERT_REASON),
      `되돌리기 자동 문구가 이력에 없다: ${JSON.stringify(reasonsAfterRelease)}`
    );
  });

  test("🔵 업무 거절은 까닭을 그대로 내보낸다 — 사람에게 보여 줄 글이다", async () => {
    // 승인을 받지 않은 건이라 출하 완료로 넘어가지 못한다.
    const caseId = await createTestCase();
    await placeCaseAtStep(caseId, "waiting_shipment");
    const order = await createOrder({ repairCaseId: caseId, purchaseOrderNumber: "PO-BLOCKED" });

    const result = await call(order.id, {
      completed: true,
      expectedVersion: order.version,
      requester: { sub: salesSub },
    });

    assert.equal(result.status, 409);
    assert.equal(result.json.code, "SHIPMENT_COMPLETION_BLOCKED");
    // 🔴 자격 실패와 달리 이쪽은 가리지 않는다 — 가리면 사람이 같은 단추를 계속 누른다.
    assert.match(String(result.json.message), /최종 출하 승인/);

    // 그리고 내자 줄은 한 글자도 바뀌지 않았다.
    const row = await readOrder(order.id);
    assert.equal(row.completedAt, null);
    assert.equal(row.version, order.version);
  });
});
