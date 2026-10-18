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
import { createDomesticOrder, setDomesticOrderCompletion } from "../../db/mutations/domestic-orders";
import { createRepairCase } from "../../db/mutations/repair-cases";
import {
  decideRepairCaseApproval,
  requestRepairCaseApproval,
} from "../../db/mutations/repair-case-approvals";
import { transitionWorkflow } from "../../db/mutations/workflow-transitions";
import {
  DOMESTIC_ORDER_SHIPMENT_REVERT_REASON,
  releaseDomesticOrderWithShipment,
} from "./release-domestic-order";
import type { DomesticOrderFields } from "@/lib/validation/domestic-order-input";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 내자 정리 [완료 해제] 한 번이 수리 건의 출하 완료까지 되돌리는가 (2026-10-18)
 * ============================================================================
 * complete-domestic-order.integration.test.ts 의 **거울**이다. 그쪽과 같은
 * 규약·같은 상황 만들기를 쓰되, 보는 것은 되돌아간 **결과 세 가지**와 그 뒤에
 * 다시 나갈 수 있는가다.
 *
 *  ① 수리 건이 붙지 않은 줄은 예전처럼 내자 줄만 해제된다.
 *  ② 붙었지만 **출하 완료가 아니면** 건너뛰고 내자 줄만 해제된다(수리 건의
 *     version 도 단계도 그대로다 — 건드리지 않았다는 증거다).
 *  ③ 출하 완료된 건이 붙은 줄은 수리 건이 되돌아간다. 🔴 DB 에서 **셋을 전부**
 *     읽는다: 단계가 출하 완료 **직전 단계**인가 · is_locked 가 false 인가 ·
 *     actual_shipment_date 가 NULL 인가.
 *  ④ 🔴 **되돌린 뒤 다시 출하 완료를 할 수 있는가** — 이것이 이 조각의 핵심
 *     증거다. 되돌렸는데 다시 못 나가면 되돌린 것이 아니다. 두 걸음으로 본다:
 *       ④-a 되돌린 직후의 transitionWorkflow 는 **CASE_LOCKED 가 아니다.**
 *            (잠금이 풀렸고 단계도 제자리라는 뜻이다.) 막히는 까닭은 승인이
 *            소모되었기 때문이고(APPROVAL_STALE), 그것은 이 조각이 만든 규칙이
 *            아니라 「승인은 그 건의 version 에 묶인다」는 원래 규칙이다.
 *       ④-b 승인을 다시 받으면 transitionWorkflow 가 **성공한다.**
 *  ⑤ 되돌리기가 막히면 🔴 내자 줄의 completed_at 이 **그대로 남아 있다**
 *     (version 도 그대로다). 막히는 표본은 아래 unknownActorId 주석 참고 —
 *     **역할로는 막히는 사람을 고를 수 없게 되었다.**
 *  ⑥ 이력이 남고, 평범한 단계 되돌리기와 **구분되는 표시**가 들어 있다
 *     (metadata.revertedShipmentCompletion + 자동 사유 문구).
 *
 * 인가는 서비스가 보지 않는다(그 파일 머리말) — 여기서 보는 FORBIDDEN 은
 * mutation(revertShipmentCompletion)이 전이의 allowed_roles 로 판정한 것이다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 스위트만 쓰는 접수 월 "9312"(형제 스위트가 9311 을 쓰고, 다른 스위트는
 * 9401~9412 · 9501~9912 를, PO 쪽 저장소가 9503 · 9506 을 쓴다), 제품 모델
 * 접두사 "DOREL-TEST-", 고객사 접두사 "AS-TEST-DOREL-".
 *
 * waiting_shipment 에 바로 세우는 것은 **상황 만들기 전용 SQL** 이다 —
 * PAID_MATCHER 를 처음부터 걸어가면 전이가 16번 넘게 필요하고, 그것은 여기서
 * 시험하는 동작이 아니다(형제 스위트와 같은 방식).
 *
 * after() 는 이 스위트가 만든 것만 FK 차례대로 지운다 — domestic_orders 가
 * 먼저다. 그 표가 repair_cases 와 customers 를 가리키고 있어서, 차례를 바꾸면
 * customers 의 RESTRICT 에 걸려 정리가 통째로 실패한다.
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-DOREL-";
const TEST_MODEL_PREFIX = "DOREL-TEST-";
const TEST_YEAR_MONTH = "9312";
const TEST_RECEIVED_AT = "2093-12-10";

let customerId: string;
let engineerId: string;
let adminId: string;
let representativeId: string;
/**
 * ⑤의 「막히는 사람」 표본 — **살아 있는 계정이 아닌** id 다.
 *
 * 🔴 역할로는 막히는 사람을 고를 수 없다. 2026-10-18 마이그레이션 0117 로
 * SHIPMENT_COMPLETED 의 allowed_roles 가 다섯 역할 전부가 되었고, 되돌리기는
 * **그 전이의 역할 목록을 그대로 쓰기 때문**이다(설계가 그렇다 — 출하 완료를
 * 누를 수 있는 사람이 되돌릴 수도 있다). 그래서 자격 검사 앞단에서 막히는
 * 표본을 쓴다: 사용자 조회에서 걸린다(FORBIDDEN).
 *
 * users 표에 줄을 만들지 않는 것도 일부러다 — 다른 스위트가 그 표의 줄 수를
 * 지문으로 쥐고 있다(db/test-cleanup-guard.ts).
 */
const unknownActorId = randomUUID();
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
  // users 는 지우지 않는다 — 이 스위트는 그 표에 줄을 만들지 않는다(위 unknownActorId).
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

/** 이미 완료 표시가 된 줄을 만든다 — [완료 해제]가 눌리는 자리가 그곳이다. */
async function createCompletedOrder(overrides: Partial<DomesticOrderFields> = {}) {
  const created = await createOrder(overrides);
  const completed = await setDomesticOrderCompletion({
    id: created.id,
    expectedVersion: created.version,
    completed: true,
    actorUserId: representativeId,
  });
  assert.equal(completed.ok, true, `setup completion failed: ${JSON.stringify(completed)}`);
  if (!completed.ok) throw new Error("unreachable");
  return completed;
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

async function historiesOf(caseId: string) {
  return db
    .select({
      actionType: statusChangeHistories.actionType,
      reason: statusChangeHistories.reason,
      metadata: statusChangeHistories.metadata,
      fromStepId: statusChangeHistories.fromStepId,
      toStepId: statusChangeHistories.toStepId,
    })
    .from(statusChangeHistories)
    .where(eq(statusChangeHistories.repairCaseId, caseId));
}

/** 출하 완료까지 끝내고, 그 줄을 완료 표시해 둔다 — ③④⑤의 공통 출발점이다. */
async function arrangeShippedCaseWithCompletedOrder(purchaseOrderNumber: string) {
  const caseId = await createTestCase();
  await placeCaseAtStep(caseId, "waiting_shipment");
  await grantFinalShipmentApproval(caseId);
  const shipped = await transitionWorkflow(caseId, 1, "SHIPMENT_COMPLETED", representativeId, "직접 출하 완료");
  assert.equal(shipped.ok, true, `arrange shipment failed: ${JSON.stringify(shipped)}`);
  const order = await createCompletedOrder({ repairCaseId: caseId, purchaseOrderNumber });
  return { caseId, order };
}

describe("releaseDomesticOrderWithShipment", () => {
  test("① 수리 건이 붙지 않은 줄은 내자 줄만 해제된다", async () => {
    const order = await createCompletedOrder({ purchaseOrderNumber: "PO-REL-NO-CASE" });

    const result = await releaseDomesticOrderWithShipment({
      id: order.id,
      expectedVersion: order.version,
      actorUserId: representativeId,
    });

    assert.equal(result.ok, true, `release failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.repairCaseShipmentReverted, false);

    const row = await readOrder(order.id);
    assert.equal(row.completedAt, null, "완료 표시가 풀려야 한다");
    assert.equal(row.completedBy, null);
    assert.equal(row.version, order.version + 1);
  });

  test("② 붙었지만 출하 완료가 아니면 건너뛰고 내자 줄만 해제된다", async () => {
    const caseId = await createTestCase();
    await placeCaseAtStep(caseId, "waiting_shipment");
    const order = await createCompletedOrder({
      repairCaseId: caseId,
      purchaseOrderNumber: "PO-REL-NOT-SHIPPED",
    });
    const beforeCase = await readCase(caseId);

    const result = await releaseDomesticOrderWithShipment({
      id: order.id,
      expectedVersion: order.version,
      actorUserId: representativeId,
    });

    assert.equal(result.ok, true, `release failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.repairCaseShipmentReverted, false);

    const row = await readOrder(order.id);
    assert.equal(row.completedAt, null, "완료 표시가 풀려야 한다");

    // 🔴 수리 건은 **건드리지 않았다** — 되돌릴 것이 없는데 version 이 오르면
    // 그 건의 승인이 조용히 소모된다.
    const afterCase = await readCase(caseId);
    assert.equal(afterCase.version, beforeCase.version, "건너뛴 경로는 수리 건을 건드리지 않는다");
    assert.equal(afterCase.stepKey, "waiting_shipment");
    assert.equal(afterCase.isLocked, false);
    const histories = await historiesOf(caseId);
    assert.equal(histories.length, 0, "건너뛴 경로는 이력도 남기지 않는다");
  });

  test("③ 출하 완료된 건이 붙은 줄은 수리 건이 단계·잠금·출하일까지 되돌아간다", async () => {
    const { caseId, order } = await arrangeShippedCaseWithCompletedOrder("PO-REL-SHIPPED");

    const shippedCase = await readCase(caseId);
    assert.equal(shippedCase.stepKey, "shipment_completed", "출발점은 출하 완료다");
    assert.equal(shippedCase.isLocked, true);
    assert.ok(shippedCase.actualShipmentDate, "출하 완료는 실제 출하일을 적는다");

    const result = await releaseDomesticOrderWithShipment({
      id: order.id,
      expectedVersion: order.version,
      actorUserId: representativeId,
    });

    assert.equal(result.ok, true, `release failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.repairCaseShipmentReverted, true);

    const row = await readOrder(order.id);
    assert.equal(row.completedAt, null, "내자 줄의 완료 표시가 풀려야 한다");

    // 🔴 셋을 전부 본다.
    const afterCase = await readCase(caseId);
    assert.equal(afterCase.stepKey, "waiting_shipment", "출하 완료 직전 단계로 돌아가야 한다");
    assert.equal(afterCase.isLocked, false, "잠금이 풀려야 한다");
    assert.equal(afterCase.actualShipmentDate, null, "실제 출하일이 지워져야 한다");
    assert.equal(afterCase.version, shippedCase.version + 1);
  });

  test("④ 되돌린 뒤 다시 출하 완료할 수 있다(승인을 다시 받으면)", async () => {
    const { caseId, order } = await arrangeShippedCaseWithCompletedOrder("PO-REL-REDO");

    const released = await releaseDomesticOrderWithShipment({
      id: order.id,
      expectedVersion: order.version,
      actorUserId: representativeId,
    });
    assert.equal(released.ok, true, `release failed: ${JSON.stringify(released)}`);

    const revertedCase = await readCase(caseId);

    // ④-a 잠금이 풀렸다는 증거 — 막히더라도 CASE_LOCKED 는 아니다. 막히는
    //      까닭은 승인이 그 건의 version 에 묶여 소모되었기 때문이다.
    const tooSoon = await transitionWorkflow(
      caseId,
      revertedCase.version,
      "SHIPMENT_COMPLETED",
      representativeId,
      "되돌린 직후 재시도"
    );
    assert.equal(tooSoon.ok, false);
    if (tooSoon.ok) return;
    assert.notEqual(tooSoon.code, "CASE_LOCKED", "잠금은 풀려 있어야 한다");
    assert.notEqual(tooSoon.code, "INVALID_TRANSITION", "출하 완료 직전 단계에 서 있어야 한다");
    assert.equal(tooSoon.code, "APPROVAL_STALE");

    // ④-b 승인을 다시 받으면 **그대로 다시 나간다.**
    await grantFinalShipmentApproval(caseId);
    const reshipped = await transitionWorkflow(
      caseId,
      revertedCase.version,
      "SHIPMENT_COMPLETED",
      representativeId,
      "재출하 완료"
    );
    assert.equal(reshipped.ok, true, `re-shipment failed: ${JSON.stringify(reshipped)}`);

    const finalCase = await readCase(caseId);
    assert.equal(finalCase.stepKey, "shipment_completed");
    assert.equal(finalCase.isLocked, true);
    assert.ok(finalCase.actualShipmentDate, "다시 나갔으면 실제 출하일이 다시 찍힌다");
  });

  test("⑤ 되돌리기가 막히면 내자 줄의 완료 표시가 그대로 남는다", async () => {
    const { caseId, order } = await arrangeShippedCaseWithCompletedOrder("PO-REL-BLOCKED");
    const beforeCase = await readCase(caseId);

    const result = await releaseDomesticOrderWithShipment({
      id: order.id,
      expectedVersion: order.version,
      actorUserId: unknownActorId,
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "SHIPMENT_COMPLETION_BLOCKED");

    // 🔴 여기가 이 시험의 핵심이다 — 내자 줄이 **한 글자도** 바뀌지 않았다.
    const row = await readOrder(order.id);
    assert.ok(row.completedAt, "거절된 완료 해제는 completed_at 을 그대로 둔다");
    assert.equal(row.completedBy, representativeId);
    assert.equal(row.version, order.version, "거절된 완료 해제는 version 도 올리지 않는다");

    // 수리 건도 그대로다.
    const afterCase = await readCase(caseId);
    assert.equal(afterCase.stepKey, "shipment_completed");
    assert.equal(afterCase.isLocked, true);
    assert.ok(afterCase.actualShipmentDate);
    assert.equal(afterCase.version, beforeCase.version);
  });

  test("⑥ 이력이 평범한 단계 되돌리기와 구분되는 표시를 달고 남는다", async () => {
    const { caseId, order } = await arrangeShippedCaseWithCompletedOrder("PO-REL-HISTORY");

    const result = await releaseDomesticOrderWithShipment({
      id: order.id,
      expectedVersion: order.version,
      actorUserId: representativeId,
    });
    assert.equal(result.ok, true, `release failed: ${JSON.stringify(result)}`);

    const returned = (await historiesOf(caseId)).filter((row) => row.actionType === "STEP_RETURNED");
    assert.equal(returned.length, 1, "되돌리기 이력이 한 줄 남아야 한다");

    // 🔴 새 action_type 을 만들지 않았으므로(enum · 마이그레이션 필요), 평범한
    // 되돌리기와 가르는 것은 metadata 와 reason 이다.
    assert.deepEqual(returned[0].metadata, { revertedShipmentCompletion: true });
    assert.equal(returned[0].reason, DOMESTIC_ORDER_SHIPMENT_REVERT_REASON);

    // 어디서 어디로 갔는지도 남는다 — 출하 완료 단계 → 그 직전 단계.
    assert.equal(returned[0].fromStepId, await stepIdForKey("shipment_completed"));
    assert.equal(returned[0].toStepId, await stepIdForKey("waiting_shipment"));
  });
});
