import "../../../../scripts/load-env";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { and, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../../db/connection";
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
} from "../../db/schema";
import { createDomesticOrder } from "../../db/mutations/domestic-orders";
import { createRepairCase } from "../../db/mutations/repair-cases";
import {
  decideRepairCaseApproval,
  requestRepairCaseApproval,
} from "../../db/mutations/repair-case-approvals";
import { transitionWorkflow } from "../../db/mutations/workflow-transitions";
import {
  DOMESTIC_ORDER_SHIPMENT_COMPLETION_REASON,
  completeDomesticOrderWithShipment,
} from "./complete-domestic-order";
import type { DomesticOrderFields } from "@/lib/validation/domestic-order-input";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 내자 정리 [완료 처리] 한 번이 수리 건까지 출하 완료로 넘기는가 (2026-10-18)
 * ============================================================================
 * 네 갈래를 전부 **진짜 DB 로** 못 박는다. 이 조각의 값어치는 "되더라"가 아니라
 * **막혔을 때 아무것도 저장되지 않는가**에 있으므로, 성공뿐 아니라 거절된 뒤의
 * domestic_orders 행을 매번 다시 읽어 확인한다.
 *
 *  ① 수리 건이 붙지 않은 줄(repair_case_id = NULL)은 예전처럼 완료 처리만 된다.
 *  ② 최종 출하 승인이 **없는** 건이 붙은 줄은 거절되고, 🔴 그때 내자 줄의
 *     completed_at 이 **여전히 NULL** 이다(version 도 그대로다).
 *  ③ 승인이 **있는** 건이 붙은 줄은 완료되고, 수리 건이 출하 완료 단계로
 *     옮겨간다 — is_locked · actual_shipment_date · 이력 한 줄까지 본다.
 *     그 이력의 사유가 **자동 문구**여야 한다(사람이 직접 누른 것과 갈린다).
 *  ④ 이미 출하 완료된 건이 붙은 줄은 **건너뛰고** 내자 줄만 완료된다. 이것이
 *     서비스 머리말이 말하는 재시도 복구 경로라, 수리 건의 version 이 한 번도
 *     더 오르지 않는 것과 이력이 한 줄뿐인 것을 함께 본다.
 *
 * 인가는 여기서 보지 않는다 — 서비스는 권한을 묻지 않고(그 파일 머리말),
 * domesticOrders WRITE 는 서버 액션의 몫이다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 스위트만 쓰는 접수 월 "9311"(다른 스위트는 9401~9412 · 9501~9912 를 쓰고,
 * PO 쪽 저장소가 9503 · 9506 을 쓴다), 제품 모델 접두사 "DOSHIP-TEST-",
 * 고객사 접두사 "AS-TEST-DOSHIP-".
 *
 * waiting_shipment 에 바로 세우는 것은 **상황 만들기 전용 SQL** 이다 —
 * PAID_MATCHER 를 처음부터 걸어가면 전이가 16번 넘게 필요하고, 그것은 여기서
 * 시험하는 동작이 아니다. workflow-transitions-approval-gating.integration.
 * test.ts 가 같은 자리에서 쓰는 방식 그대로다.
 *
 * after() 는 이 스위트가 만든 것만 FK 차례대로 지운다 — domestic_orders 가
 * 먼저다. 그 표가 repair_cases 와 customers 를 가리키고 있어서, 차례를 바꾸면
 * customers 의 RESTRICT 에 걸려 정리가 통째로 실패한다.
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-DOSHIP-";
const TEST_MODEL_PREFIX = "DOSHIP-TEST-";
const TEST_YEAR_MONTH = "9311";
const TEST_RECEIVED_AT = "2093-11-10";

let customerId: string;
let engineerId: string;
let adminId: string;
let representativeId: string;
let matcherWorkflowVersionId: string;
const createdOrderIds: string[] = [];

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

  // 최종 출하 승인을 내릴 수 있는 사람이자, 출하 완료를 누르는 사람이다.
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

async function stepIdForKey(key: string): Promise<string> {
  const [step] = await db
    .select({ id: workflowSteps.id })
    .from(workflowSteps)
    .where(and(eq(workflowSteps.workflowVersionId, matcherWorkflowVersionId), eq(workflowSteps.key, key)));
  assert.ok(step, `expected workflow_steps row for PAID_MATCHER/${key}`);
  return step.id;
}

/** 상황 만들기 전용 — 위 머리말의 '상황 만들기 전용 SQL' 참고. */
async function placeCaseAtStep(caseId: string, key: string) {
  const stepId = await stepIdForKey(key);
  await db.update(repairCases).set({ currentWorkflowStepId: stepId }).where(eq(repairCases.id, caseId));
}

/** 최종 출하 승인까지 받아 둔다(수리 검수 승인이 먼저다 — 그 순서가 규칙이다). */
async function grantFinalShipmentApproval(caseId: string) {
  const inspectionRequest = await requestRepairCaseApproval(caseId, "REPAIR_INSPECTION", engineerId, null);
  assert.equal(inspectionRequest.ok, true, `inspection request failed: ${JSON.stringify(inspectionRequest)}`);
  const inspectionDecision = await decideRepairCaseApproval(caseId, "REPAIR_INSPECTION", "APPROVED", adminId, null);
  assert.equal(inspectionDecision.ok, true, `inspection decision failed: ${JSON.stringify(inspectionDecision)}`);

  const shipmentRequest = await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, null);
  assert.equal(shipmentRequest.ok, true, `shipment request failed: ${JSON.stringify(shipmentRequest)}`);
  const shipmentDecision = await decideRepairCaseApproval(
    caseId,
    "FINAL_SHIPMENT",
    "APPROVED",
    representativeId,
    null
  );
  assert.equal(shipmentDecision.ok, true, `shipment decision failed: ${JSON.stringify(shipmentDecision)}`);
}

async function createOrder(overrides: Partial<DomesticOrderFields> = {}) {
  const result = await createDomesticOrder({
    fields: { ...emptyFields(), ...overrides },
    actorUserId: representativeId,
  });
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

async function shipmentHistories(caseId: string) {
  return db
    .select({ reason: statusChangeHistories.reason })
    .from(statusChangeHistories)
    .where(
      and(
        eq(statusChangeHistories.repairCaseId, caseId),
        eq(statusChangeHistories.actionType, "SHIPMENT_COMPLETED")
      )
    );
}

describe("completeDomesticOrderWithShipment", () => {
  test("① 수리 건이 붙지 않은 줄은 예전처럼 완료 처리만 된다", async () => {
    const order = await createOrder({ purchaseOrderNumber: "PO-NO-CASE" });

    const result = await completeDomesticOrderWithShipment({
      id: order.id,
      expectedVersion: order.version,
      actorUserId: representativeId,
    });

    assert.equal(result.ok, true, `completion failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.repairCaseShipmentCompleted, false);

    const row = await readOrder(order.id);
    assert.ok(row.completedAt, "완료 처리는 그대로 되어야 한다");
    assert.equal(row.completedBy, representativeId);
    assert.equal(row.version, order.version + 1);
  });

  test("② 최종 출하 승인이 없는 건이 붙은 줄은 거절되고 내자 줄도 그대로다", async () => {
    const caseId = await createTestCase();
    await placeCaseAtStep(caseId, "waiting_shipment");
    const order = await createOrder({ repairCaseId: caseId, purchaseOrderNumber: "PO-NO-APPROVAL" });

    const result = await completeDomesticOrderWithShipment({
      id: order.id,
      expectedVersion: order.version,
      actorUserId: representativeId,
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "SHIPMENT_COMPLETION_BLOCKED");
    // 막힌 까닭이 그대로 올라와야 화면이 사람에게 할 말을 갖는다.
    assert.match(result.message, /최종 출하 승인/);

    // 🔴 여기가 이 시험의 핵심이다 — 내자 줄이 **한 글자도** 바뀌지 않았다.
    const row = await readOrder(order.id);
    assert.equal(row.completedAt, null, "거절된 완료 처리는 completed_at 을 남기지 않는다");
    assert.equal(row.completedBy, null);
    assert.equal(row.version, order.version, "거절된 완료 처리는 version 도 올리지 않는다");

    // 수리 건도 그대로다.
    const repairCase = await readCase(caseId);
    assert.equal(repairCase.stepKey, "waiting_shipment");
    assert.equal(repairCase.isLocked, false);
    assert.equal(repairCase.actualShipmentDate, null);
  });

  test("③ 승인이 된 건이 붙은 줄은 완료되고 수리 건도 출하 완료로 넘어간다", async () => {
    const caseId = await createTestCase();
    await placeCaseAtStep(caseId, "waiting_shipment");
    await grantFinalShipmentApproval(caseId);
    const order = await createOrder({ repairCaseId: caseId, purchaseOrderNumber: "PO-APPROVED" });

    const result = await completeDomesticOrderWithShipment({
      id: order.id,
      expectedVersion: order.version,
      actorUserId: representativeId,
    });

    assert.equal(result.ok, true, `completion failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.repairCaseShipmentCompleted, true);

    const row = await readOrder(order.id);
    assert.ok(row.completedAt, "내자 줄이 완료 처리되어야 한다");
    assert.equal(row.version, order.version + 1);

    const repairCase = await readCase(caseId);
    assert.equal(repairCase.stepKey, "shipment_completed");
    assert.equal(repairCase.isLocked, true);
    assert.ok(repairCase.actualShipmentDate, "출하 완료는 실제 출하일을 적는다");

    // 🔴 이력에 **자동으로 일어난 일**임이 드러나야 한다 — 나중에 보는 사람이
    // "사람이 직접 눌렀나, 내자에서 따라온 것인가"를 이 한 줄로 가른다.
    const histories = await shipmentHistories(caseId);
    assert.equal(histories.length, 1);
    assert.equal(histories[0].reason, DOMESTIC_ORDER_SHIPMENT_COMPLETION_REASON);
  });

  test("④ 이미 출하 완료된 건이 붙은 줄은 건너뛰고 내자 줄만 완료된다(재시도 복구 경로)", async () => {
    const caseId = await createTestCase();
    await placeCaseAtStep(caseId, "waiting_shipment");
    await grantFinalShipmentApproval(caseId);
    // 사람이 수리 건 화면에서 먼저 눌렀거나, 내자에서 눌렀다가 두 작업 사이에
    // 끊긴 상태다. 어느 쪽이든 다음 [완료 처리]는 여기서 건너뛰어야 한다.
    const shipped = await transitionWorkflow(caseId, 1, "SHIPMENT_COMPLETED", representativeId, "직접 출하 완료");
    assert.equal(shipped.ok, true, `arrange shipment failed: ${JSON.stringify(shipped)}`);
    const beforeCase = await readCase(caseId);

    const order = await createOrder({ repairCaseId: caseId, purchaseOrderNumber: "PO-ALREADY-SHIPPED" });
    const result = await completeDomesticOrderWithShipment({
      id: order.id,
      expectedVersion: order.version,
      actorUserId: representativeId,
    });

    assert.equal(result.ok, true, `completion failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    // 이번 누름이 출하 완료를 시킨 것은 아니다 — 화면 문구가 갈리는 지점이다.
    assert.equal(result.repairCaseShipmentCompleted, false);

    const row = await readOrder(order.id);
    assert.ok(row.completedAt, "내자 줄은 완료 처리되어야 한다");

    // 🔴 잠긴 건에 전이를 한 번 더 시도하지 않았다 — 했다면 CASE_LOCKED 로
    // 막혀 내자 줄까지 영영 완료되지 않았을 것이다.
    const afterCase = await readCase(caseId);
    assert.equal(afterCase.version, beforeCase.version, "건너뛴 경로는 수리 건을 건드리지 않는다");
    const histories = await shipmentHistories(caseId);
    assert.equal(histories.length, 1, "출하 완료 이력은 한 줄뿐이어야 한다");
  });
});
