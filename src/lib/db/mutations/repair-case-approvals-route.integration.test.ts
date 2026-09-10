import "../../../../scripts/load-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  auditLogs,
  customers,
  products,
  repairCaseApprovals,
  repairCaseIntakeSequences,
  repairCases,
  shipmentApprovalRouteSteps,
  shipmentApprovalRoutes,
  users,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import { decideRepairCaseApproval, requestRepairCaseApproval } from "./repair-case-approvals";
import { saveShipmentApprovalRoute } from "./shipment-approval-routes";
import { getCurrentShipmentApprovalRoute } from "../queries/shipment-approval-routes";
import { resolveApprovalValidity } from "../queries/repair-case-approvals";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 최종 출하 승인 순차 진행(결재선) — 실제 DB (시험 DB)
 * ============================================================================
 * 결재선 판(shipment_approval_routes)이 있을 때 최종 출하 승인이 **여러 명에게
 * 순서대로** 넘어가는지, 그리고 판이 없을 때는 **어제와 한 칸도 다르지 않은지**를
 * 못 박는다.
 *
 * 여기서 지키려는 것은 여섯이다:
 *  1. 🔴 **판이 없으면(또는 단계 0개면) 이 기능이 생기기 전과 완전히 같다** —
 *     세 칸 전부 NULL, 「출하 대표」가 승인, 출하 문이 열린다.
 *  2. 단계마다 요청 행이 **하나씩**이고, 한 시점에 REQUESTED 는 언제나 하나다
 *     (repair_case_approvals_one_active_request 부분 유니크가 그대로 보증한다).
 *  3. 🔴 **중간 단계에서는 출하 문이 닫혀 있다.** resolveApprovalValidity 는
 *     「가장 최근 행이 APPROVED 인가」만 보므로 저절로 그렇게 된다 — 그 함수를
 *     고칠 이유가 없다는 것을 시험이 증명한다.
 *  4. 🔴 **절차가 대표를 대신한다.** 단계 승인자는 대표가 아니어도 승인할 수
 *     있고, 대표라도 자기 단계가 아니면 승인할 수 없다.
 *  5. 🔴 **진행 중인 건은 옛 판을 끝까지 따라간다.** 관리자가 절차를 바꿔도
 *     이미 요청된 건의 2단계는 옛 판의 2단계다.
 *  6. 사슬이 이어진 행은 요청자·사유·접수 건 버전을 물려받고, **requested_at 만
 *     물려받지 않는다**(같은 시각이면 「가장 최근 행」이 정해지지 않는다).
 *
 * 격리·청소 규약은 shipment-approval-routes.integration.test.ts 를 그대로
 * 본떴다: 이 파일이 만든 "shiproutechain-test-" 계정과 "D9708" 접수 건만 쓰고,
 * ⚠️ **판·단계는 afterEach 로 반드시 걷는다** — 시험 DB 에 판이 남으면 다른
 * 시험 파일(repair-case-approvals-delegation 등)이 갑자기 결재선을 타면서
 * 깨진다. 사람 참조가 RESTRICT 라 삭제에는 순서가 있다(결재 행 → 단계 → 판 →
 * 감사 기록 → 사람).
 * ============================================================================
 */

const TEST_RECEIVED_AT = "2097-08-10";
const TEST_SHIPMENT_DATE = "2097-08-20";
const TEST_MODEL_PREFIX = "SHIPROUTECHAIN-TEST-";
const TEST_YEAR_MONTH = "9708";
const TEST_INTAKE_PREFIX = "D9708%";
const TEST_EMAIL_PREFIX = "shiproutechain-test-";

let customerId: string;
let engineerId: string; // 요청자 겸 검수 결재자 (AS_ENGINEER)
let superAdminId: string; // 판을 저장하는 사람 + 「언제나 처리할 수 있는」 비상구
let representativeId: string; // is_shipment_representative = true, 결재선에는 없음
let stepAId: string;
let stepBId: string;
let stepCId: string;

const createdTestUserIds: string[] = [];
const createdCaseIds: string[] = [];

async function createTestUser(
  name: string,
  overrides: Partial<typeof users.$inferInsert> = {}
): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      email: `${TEST_EMAIL_PREFIX}${randomUUID().slice(0, 8)}@example.test`,
      name,
      role: "AS_ENGINEER",
      approvalStatus: "APPROVED",
      isActive: true,
      isDeveloper: false,
      ...overrides,
    })
    .returning({ id: users.id });
  createdTestUserIds.push(row.id);
  return row.id;
}

function baseCreateInput(): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
    customerId,
    endUserId: null,
    assignedEngineerId: engineerId,
    receivedAt: TEST_RECEIVED_AT,
    customerRequestedDueDate: null,
    internalTargetShipmentDate: TEST_SHIPMENT_DATE,
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

/**
 * 최종 출하 승인을 요청할 수 있는 상태의 접수 건 하나 — 검수 승인까지 진짜
 * 경로로 받아 둔다(요청 mutation 이 그것을 사전 조건으로 본다).
 */
async function createCaseReadyForShipmentRequest(): Promise<string> {
  const created = await createRepairCase(baseCreateInput());
  assert.equal(created.ok, true, `setup create failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  createdCaseIds.push(created.id);

  const inspection = await requestRepairCaseApproval(created.id, "REPAIR_INSPECTION", engineerId, null);
  assert.equal(inspection.ok, true, `setup inspection request failed: ${JSON.stringify(inspection)}`);
  const decided = await decideRepairCaseApproval(created.id, "REPAIR_INSPECTION", "APPROVED", engineerId, null);
  assert.equal(decided.ok, true, `setup inspection approval failed: ${JSON.stringify(decided)}`);

  return created.id;
}

/** 그 건의 최종 출하 승인 행들 — 오래된 것부터. */
async function shipmentRows(repairCaseId: string) {
  return db
    .select()
    .from(repairCaseApprovals)
    .where(
      and(
        eq(repairCaseApprovals.repairCaseId, repairCaseId),
        eq(repairCaseApprovals.approvalType, "FINAL_SHIPMENT")
      )
    )
    .orderBy(asc(repairCaseApprovals.requestedAt));
}

/** 「지금 대기 중인 단계」가 몇 개인가 — 언제나 0 또는 1이어야 한다. */
async function pendingShipmentCount(repairCaseId: string): Promise<number> {
  const rows = await shipmentRows(repairCaseId);
  return rows.filter((row) => row.status === "REQUESTED").length;
}

/** 출하 문 — 접수 건 버전은 이 시험에서 바뀌지 않으므로 언제나 1이다. */
async function shipmentGate(repairCaseId: string) {
  return resolveApprovalValidity(repairCaseId, "FINAL_SHIPMENT", 1);
}

async function saveRoute(approverUserIds: string[]): Promise<string> {
  const result = await saveShipmentApprovalRoute(approverUserIds, superAdminId, "FINAL_SHIPMENT");
  assert.equal(result.ok, true, `setup route save failed: ${JSON.stringify(result)}`);
  const current = await getCurrentShipmentApprovalRoute("FINAL_SHIPMENT");
  assert.ok(current, "저장했는데 현재 판이 없다");
  return current.id;
}

/**
 * 이 파일이 남긴 결재 행·판·단계·감사 기록을 걷는다. 접수 건과 사람은 after()가
 * 마지막에 지운다(결재 행이 사람을 RESTRICT 로 참조하므로 순서가 있다).
 */
async function removeRouteFixtures(): Promise<void> {
  // 결재 행이 판을 RESTRICT 로 참조한다 — 결재 행이 먼저다.
  if (createdCaseIds.length > 0) {
    await db.delete(repairCaseApprovals).where(inArray(repairCaseApprovals.repairCaseId, createdCaseIds));
  }
  if (createdTestUserIds.length > 0) {
    await db
      .delete(shipmentApprovalRouteSteps)
      .where(inArray(shipmentApprovalRouteSteps.approverUserId, createdTestUserIds));
    await db
      .delete(shipmentApprovalRoutes)
      .where(inArray(shipmentApprovalRoutes.createdByUserId, createdTestUserIds));
    // audit_logs.actor_user_id → users (restrict): 행위자로만 고른다 —
    // target_record_id 로 고르는 모양은 test-cleanup-static-safety.test.ts 가 금지한다.
    await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, createdTestUserIds));
  }
}

/** 이전 실행이 중간에 끊겨 남은 이 파일의 계정과 그 흔적까지 걷는다. */
async function removeTestUsersByPrefix(): Promise<void> {
  const leftovers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  const ids = leftovers.map((row) => row.id);
  if (ids.length === 0) return;

  const leftoverCases = await db
    .select({ id: repairCases.id })
    .from(repairCases)
    .where(like(repairCases.intakeNumber, TEST_INTAKE_PREFIX));
  for (const { id } of leftoverCases) {
    await db.delete(repairCaseApprovals).where(eq(repairCaseApprovals.repairCaseId, id));
  }
  await db.delete(repairCaseApprovals).where(inArray(repairCaseApprovals.requestedByUserId, ids));

  await db
    .delete(shipmentApprovalRouteSteps)
    .where(inArray(shipmentApprovalRouteSteps.approverUserId, ids));
  await db.delete(shipmentApprovalRoutes).where(inArray(shipmentApprovalRoutes.createdByUserId, ids));
  await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, ids));

  await db.delete(repairCases).where(like(repairCases.intakeNumber, TEST_INTAKE_PREFIX));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(users).where(inArray(users.id, ids));
}

before(async () => {
  await removeTestUsersByPrefix();

  const [route] = await db.select({ id: shipmentApprovalRoutes.id }).from(shipmentApprovalRoutes).limit(1);
  assert.equal(
    route,
    undefined,
    "이 시험은 shipment_approval_routes 가 비어 있는 상태를 전제로 합니다"
  );

  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.isDeleted, false))
    .limit(1);
  assert.ok(customer, "expected at least one non-deleted customer in the test DB");
  customerId = customer.id;

  engineerId = await createTestUser("결재선시험 엔지니어");
  superAdminId = await createTestUser("결재선시험 최고관리자", { role: "SUPER_ADMIN" });
  // Arrange-only: 대표 지정 mutation 을 거치지 않고 깃발만 세운다 — 이 시험이
  // 보려는 것은 대표 지정 절차가 아니라 「대표가 있어도 절차가 이긴다」이다.
  representativeId = await createTestUser("결재선시험 출하대표", { isShipmentRepresentative: true });
  stepAId = await createTestUser("결재선시험 1단계");
  stepBId = await createTestUser("결재선시험 2단계");
  stepCId = await createTestUser("결재선시험 3단계");
});

afterEach(async () => {
  // ⚠️ 판이 남으면 다른 시험 파일이 갑자기 결재선을 타면서 깨진다. 매 시험마다
  // 판 번호가 1부터 다시 시작해야 각 시험이 스스로 상태를 정할 수 있다.
  await removeRouteFixtures();
});

after(async () => {
  await removeRouteFixtures();
  await db.delete(repairCases).where(like(repairCases.intakeNumber, TEST_INTAKE_PREFIX));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

describe("최종 출하 승인 — 결재선이 없을 때는 어제와 같다", () => {
  test("🔴 1. 판이 하나도 없으면 세 칸이 NULL 이고 대표가 승인하며 출하 문이 열린다", async () => {
    assert.equal(await getCurrentShipmentApprovalRoute("FINAL_SHIPMENT"), null, "이 시험은 판이 없는 상태를 전제로 한다");

    const caseId = await createCaseReadyForShipmentRequest();
    const requested = await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, "출하 승인 요청");
    assert.equal(requested.ok, true, `요청이 막혔다: ${JSON.stringify(requested)}`);

    const [row] = await shipmentRows(caseId);
    assert.equal(row.routeId, null, "판이 없는데 route_id 가 채워졌다");
    assert.equal(row.routeStepOrder, null, "판이 없는데 route_step_order 가 채워졌다");
    assert.equal(row.assignedApproverUserId, null, "판이 없는데 지정이 채워졌다");

    // 출하 문은 승인 전에는 닫혀 있다.
    assert.notEqual((await shipmentGate(caseId)).state, "VALID");

    const decided = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", representativeId, null);
    assert.equal(decided.ok, true, `대표가 막혔다: ${JSON.stringify(decided)}`);

    assert.equal((await shipmentGate(caseId)).state, "VALID", "승인했는데 출하 문이 닫혀 있다");
    assert.equal((await shipmentRows(caseId)).length, 1, "판이 없는데 다음 단계 행이 생겼다");
  });

  test("🔴 2. 단계 0개인 판도 같다 — 「절차를 쓰지 않겠다」는 뜻이다", async () => {
    await saveRoute([]);

    const caseId = await createCaseReadyForShipmentRequest();
    const requested = await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, null);
    assert.equal(requested.ok, true, `요청이 막혔다: ${JSON.stringify(requested)}`);

    const [row] = await shipmentRows(caseId);
    assert.equal(row.routeId, null, "빈 판인데 route_id 가 채워졌다");
    assert.equal(row.routeStepOrder, null);
    assert.equal(row.assignedApproverUserId, null);

    const decided = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", representativeId, null);
    assert.equal(decided.ok, true, `빈 판에서 대표가 막혔다: ${JSON.stringify(decided)}`);
    assert.equal((await shipmentGate(caseId)).state, "VALID");
    assert.equal((await shipmentRows(caseId)).length, 1);
  });

  test("2b. 검수 승인은 결재선과 무관하다 — 판이 있어도 세 칸이 NULL 이다", async () => {
    // 결재선은 최종 출하 승인만의 것이다(CHECK 도 그렇게 막는다).
    await saveRoute([stepAId, stepBId]);

    const created = await createRepairCase(baseCreateInput());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    createdCaseIds.push(created.id);

    const requested = await requestRepairCaseApproval(created.id, "REPAIR_INSPECTION", engineerId, null);
    assert.equal(requested.ok, true, `검수 요청이 막혔다: ${JSON.stringify(requested)}`);

    const [row] = await db
      .select()
      .from(repairCaseApprovals)
      .where(
        and(
          eq(repairCaseApprovals.repairCaseId, created.id),
          eq(repairCaseApprovals.approvalType, "REPAIR_INSPECTION")
        )
      );
    assert.equal(row.routeId, null, "검수 승인이 결재선을 탔다");
    assert.equal(row.routeStepOrder, null);
    assert.equal(row.assignedApproverUserId, null);

    const decided = await decideRepairCaseApproval(created.id, "REPAIR_INSPECTION", "APPROVED", engineerId, null);
    assert.equal(decided.ok, true, `검수 결재가 막혔다: ${JSON.stringify(decided)}`);
  });
});

describe("최종 출하 승인 — 결재선을 순서대로 탄다", () => {
  test("🔴 3. 3단계 판에서 요청하면 1단계 행 하나만 생긴다", async () => {
    const routeId = await saveRoute([stepAId, stepBId, stepCId]);

    const caseId = await createCaseReadyForShipmentRequest();
    const requested = await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, "출하 부탁드립니다");
    assert.equal(requested.ok, true, `요청이 막혔다: ${JSON.stringify(requested)}`);

    const rows = await shipmentRows(caseId);
    assert.equal(rows.length, 1, "요청 한 번에 행이 하나보다 많이 생겼다");
    assert.equal(rows[0].routeId, routeId, "현재 판을 가리켜야 한다");
    assert.equal(rows[0].routeStepOrder, 1);
    assert.equal(rows[0].assignedApproverUserId, stepAId, "1단계 승인자에게 지정돼야 한다");
    assert.equal(rows[0].status, "REQUESTED");
    assert.equal(rows[0].delegatedFromUserId, null);
  });

  test("🔴 4. 중간 단계에서는 출하 문이 닫혀 있고, 마지막 단계가 승인되면 열린다", async () => {
    const routeId = await saveRoute([stepAId, stepBId, stepCId]);
    const caseId = await createCaseReadyForShipmentRequest();
    assert.equal((await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, null)).ok, true);

    // 1단계 승인 → 2단계 대기. 출하 문은 그대로 닫혀 있다.
    const first = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", stepAId, null);
    assert.equal(first.ok, true, `1단계가 막혔다: ${JSON.stringify(first)}`);
    assert.notEqual((await shipmentGate(caseId)).state, "VALID", "1단계만 끝났는데 출하 문이 열렸다");
    assert.equal(await pendingShipmentCount(caseId), 1, "대기 중인 단계는 언제나 하나여야 한다");

    let rows = await shipmentRows(caseId);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].routeId, routeId, "같은 판을 이어 써야 한다");
    assert.equal(rows[1].routeStepOrder, 2);
    assert.equal(rows[1].assignedApproverUserId, stepBId);

    // 2단계 승인 → 3단계 대기. 아직도 닫혀 있다.
    const second = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", stepBId, null);
    assert.equal(second.ok, true, `2단계가 막혔다: ${JSON.stringify(second)}`);
    assert.notEqual((await shipmentGate(caseId)).state, "VALID", "2단계까지인데 출하 문이 열렸다");
    assert.equal(await pendingShipmentCount(caseId), 1);

    rows = await shipmentRows(caseId);
    assert.equal(rows.length, 3);
    assert.equal(rows[2].routeStepOrder, 3);
    assert.equal(rows[2].assignedApproverUserId, stepCId);

    // 3단계(마지막) 승인 → 다음 행은 생기지 않고 출하 문이 열린다.
    const third = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", stepCId, null);
    assert.equal(third.ok, true, `3단계가 막혔다: ${JSON.stringify(third)}`);
    assert.equal((await shipmentRows(caseId)).length, 3, "마지막 단계 뒤에 행이 또 생겼다");
    assert.equal(await pendingShipmentCount(caseId), 0);
    assert.equal((await shipmentGate(caseId)).state, "VALID", "다 끝났는데 출하 문이 닫혀 있다");
  });

  test("🔴 5. 이어진 행이 요청자·사유·접수 건 버전을 물려받고 requested_at 만 새로 찍힌다", async () => {
    await saveRoute([stepAId, stepBId]);
    const caseId = await createCaseReadyForShipmentRequest();
    assert.equal(
      (await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, "8월 출하 건입니다")).ok,
      true
    );
    assert.equal((await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", stepAId, null)).ok, true);

    const [first, second] = await shipmentRows(caseId);
    assert.equal(second.requestedByUserId, first.requestedByUserId, "요청한 사람은 그대로다");
    assert.equal(second.requestedByUserId, engineerId);
    assert.equal(second.requestReason, "8월 출하 건입니다", "사유도 그대로 이어진다");
    assert.equal(
      second.repairCaseVersionAtRequest,
      first.repairCaseVersionAtRequest,
      "🔴 버전을 단계마다 새로 찍으면 1단계는 무효인데 3단계만 멀쩡해 보인다"
    );
    // 🔴 requested_at 은 물려받지 않는다 — 같은 시각이면 「가장 최근 행」을
    // 고르는 조회들이 어느 행을 고를지 정해지지 않는다.
    assert.ok(
      second.requestedAt.getTime() > first.requestedAt.getTime(),
      `이어진 행의 requested_at 이 앞 행보다 늦지 않다: ${first.requestedAt.toISOString()} / ${second.requestedAt.toISOString()}`
    );
    assert.equal(second.status, "REQUESTED");
    assert.equal(second.decidedByUserId, null);
    assert.equal(second.decidedAt, null);
    assert.equal(second.delegatedFromUserId, null, "결재선 경로는 위임이 아니다");
  });
});

describe("최종 출하 승인 — 결재선 경로의 인가", () => {
  test("🔴 6. 단계 승인자가 아니면 거절된다 — 출하 대표여도 거절된다", async () => {
    await saveRoute([stepAId, stepBId]);
    const caseId = await createCaseReadyForShipmentRequest();
    assert.equal((await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, null)).ok, true);

    // 절차가 대표를 **대신한다** — 대표라는 것만으로는 남의 단계를 결재할 수 없다.
    const byRepresentative = await decideRepairCaseApproval(
      caseId,
      "FINAL_SHIPMENT",
      "APPROVED",
      representativeId,
      null
    );
    assert.equal(byRepresentative.ok, false, "대표가 절차를 건너뛰었다");
    if (!byRepresentative.ok) assert.equal(byRepresentative.code, "FORBIDDEN");

    // 2단계 승인자도 아직은 자기 차례가 아니다.
    const byNextStep = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", stepBId, null);
    assert.equal(byNextStep.ok, false, "2단계 승인자가 1단계를 결재했다");
    if (!byNextStep.ok) assert.equal(byNextStep.code, "FORBIDDEN");

    const rows = await shipmentRows(caseId);
    assert.equal(rows.length, 1, "거절이 행을 만들었다");
    assert.equal(rows[0].status, "REQUESTED", "거절됐는데 행이 바뀌었다");
    assert.equal(rows[0].decidedByUserId, null);
  });

  test("🔴 7. 단계 승인자는 출하 대표가 아니어도 승인할 수 있다", async () => {
    await saveRoute([stepAId]);
    const caseId = await createCaseReadyForShipmentRequest();
    assert.equal((await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, null)).ok, true);

    const [before] = await db
      .select({ isShipmentRepresentative: users.isShipmentRepresentative })
      .from(users)
      .where(eq(users.id, stepAId));
    assert.equal(before.isShipmentRepresentative, false, "대조가 성립하지 않는다 — 이 사람은 대표가 아니어야 한다");

    const decided = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", stepAId, null);
    assert.equal(decided.ok, true, `단계 승인자가 막혔다: ${JSON.stringify(decided)}`);

    const [row] = await shipmentRows(caseId);
    assert.equal(row.decidedByUserId, stepAId);
    assert.equal(row.delegatedFromUserId, null);
    assert.equal((await shipmentGate(caseId)).state, "VALID", "1단계짜리 판인데 출하 문이 닫혀 있다");
  });

  test("8. 최고관리자는 언제나 처리할 수 있다 — 지정된 사람이 자리를 비워도 막히지 않는다", async () => {
    await saveRoute([stepAId, stepBId]);
    const caseId = await createCaseReadyForShipmentRequest();
    assert.equal((await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, null)).ok, true);

    const decided = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", superAdminId, null);
    assert.equal(decided.ok, true, `최고관리자가 막혔다: ${JSON.stringify(decided)}`);

    // 대신 처리해도 사슬은 그대로 이어진다.
    const rows = await shipmentRows(caseId);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].assignedApproverUserId, stepBId);
  });

  test("🔴 9. 비활성·잠긴 계정은 결재선 경로에서도 거절된다", async () => {
    await saveRoute([stepAId, stepBId]);
    const caseId = await createCaseReadyForShipmentRequest();
    assert.equal((await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, null)).ok, true);

    // 결재선에 올라간 뒤 계정이 잠기거나 꺼지는 일은 실제로 일어난다. 그때는 그
    // 단계에서 멈추고 최고관리자가 대신 처리하는 것이 설계다.
    for (const [label, patch] of [
      ["비활성", { isActive: false }],
      ["잠김", { lockedAt: new Date() }],
    ] as const) {
      await db.update(users).set(patch).where(eq(users.id, stepAId));
      try {
        const decided = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", stepAId, null);
        assert.equal(decided.ok, false, `${label} 계정이 통과했다`);
        if (!decided.ok) assert.equal(decided.code, "FORBIDDEN", label);
        assert.equal(await pendingShipmentCount(caseId), 1, `${label}: 거절됐는데 사슬이 움직였다`);
        assert.equal((await shipmentRows(caseId)).length, 1, `${label}: 거절됐는데 행이 늘었다`);
      } finally {
        await db.update(users).set({ isActive: true, lockedAt: null }).where(eq(users.id, stepAId));
      }
    }

    // 대조 — 되돌리면 같은 사람이 그대로 승인한다.
    const decided = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", stepAId, null);
    assert.equal(decided.ok, true, `대조가 성립하지 않는다: ${JSON.stringify(decided)}`);
  });
});

describe("최종 출하 승인 — 사슬이 끊길 때와 판이 바뀔 때", () => {
  test("🔴 10. 반려하면 사슬이 끊기고, 재요청하면 1단계부터 다시 시작한다", async () => {
    const routeId = await saveRoute([stepAId, stepBId, stepCId]);
    const caseId = await createCaseReadyForShipmentRequest();
    assert.equal((await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, null)).ok, true);

    const rejected = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "REJECTED", stepAId, "부품 재확인 필요");
    assert.equal(rejected.ok, true, `반려가 막혔다: ${JSON.stringify(rejected)}`);

    let rows = await shipmentRows(caseId);
    assert.equal(rows.length, 1, "반려했는데 다음 단계 행이 생겼다");
    assert.equal(rows[0].status, "REJECTED");
    assert.equal(await pendingShipmentCount(caseId), 0);
    assert.notEqual((await shipmentGate(caseId)).state, "VALID");

    // 재요청 — 2단계가 아니라 1단계부터다.
    const again = await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, "다시 요청합니다");
    assert.equal(again.ok, true, `재요청이 막혔다: ${JSON.stringify(again)}`);

    rows = await shipmentRows(caseId);
    assert.equal(rows.length, 2, "반려 이력이 남아야 한다");
    assert.equal(rows[1].routeId, routeId);
    assert.equal(rows[1].routeStepOrder, 1, "재요청은 1단계부터다");
    assert.equal(rows[1].assignedApproverUserId, stepAId);
  });

  test("🔴 11. 판을 바꿔도 진행 중인 건은 옛 판을 따른다", async () => {
    const oldRouteId = await saveRoute([stepAId, stepBId]);
    const caseId = await createCaseReadyForShipmentRequest();
    assert.equal((await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, null)).ok, true);

    // 요청 뒤에 관리자가 절차를 통째로 바꾼다 — 2단계가 다른 사람이 된다.
    const newRouteId = await saveRoute([stepCId, stepAId]);
    assert.notEqual(newRouteId, oldRouteId, "새 판이 얹히지 않았다");

    const decided = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", stepAId, null);
    assert.equal(decided.ok, true, `1단계가 막혔다: ${JSON.stringify(decided)}`);

    const rows = await shipmentRows(caseId);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].routeId, oldRouteId, "🔴 진행 중인 건이 새 판으로 갈아탔다");
    assert.equal(rows[1].routeStepOrder, 2);
    assert.equal(
      rows[1].assignedApproverUserId,
      stepBId,
      "🔴 2단계는 옛 판의 2단계(stepB)여야 한다 — 새 판의 2단계(stepA)가 아니다"
    );

    // 그리고 새 판의 2단계인 사람은 이 건을 결재할 수 없다.
    const byNewRouteStep = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", stepCId, null);
    assert.equal(byNewRouteStep.ok, false, "새 판의 사람이 옛 판의 건을 결재했다");
    if (!byNewRouteStep.ok) assert.equal(byNewRouteStep.code, "FORBIDDEN");
  });

  test("🔴 12. 한 시점에 그 (건, 종류)의 REQUESTED 행은 언제나 하나뿐이다", async () => {
    await saveRoute([stepAId, stepBId, stepCId]);
    const caseId = await createCaseReadyForShipmentRequest();
    assert.equal((await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, null)).ok, true);
    assert.equal(await pendingShipmentCount(caseId), 1, "요청 직후");

    // 사슬이 도는 내내 하나다. 그리고 대기 중에는 새 요청이 들어오지 못한다.
    for (const approverId of [stepAId, stepBId]) {
      const blocked = await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, null);
      assert.equal(blocked.ok, false, "대기 중인데 요청이 하나 더 통과했다");
      if (!blocked.ok) assert.equal(blocked.code, "ALREADY_REQUESTED");

      assert.equal(
        (await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", approverId, null)).ok,
        true
      );
      assert.equal(await pendingShipmentCount(caseId), 1, "승인 직후에도 대기는 하나여야 한다");
    }

    assert.equal((await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", stepCId, null)).ok, true);
    assert.equal(await pendingShipmentCount(caseId), 0, "마지막 단계 뒤에는 대기가 없어야 한다");
  });

  test("13. 이미 처리된 단계는 다시 결재할 수 없다 — CONFLICT", async () => {
    await saveRoute([stepAId, stepBId]);
    const caseId = await createCaseReadyForShipmentRequest();
    assert.equal((await requestRepairCaseApproval(caseId, "FINAL_SHIPMENT", engineerId, null)).ok, true);
    assert.equal((await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", stepAId, null)).ok, true);

    // 이제 최신 행은 2단계(stepB 지정)다 — stepA 가 다시 누르면 지정 관문에 막힌다.
    const again = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", stepAId, null);
    assert.equal(again.ok, false, "이미 끝낸 사람이 다음 단계까지 결재했다");
    if (!again.ok) assert.equal(again.code, "FORBIDDEN");

    assert.equal((await shipmentRows(caseId)).length, 2, "거절이 행을 만들었다");
  });
});
