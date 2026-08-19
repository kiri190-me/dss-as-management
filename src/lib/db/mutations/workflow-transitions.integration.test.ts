import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, like, ne } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  customers,
  users,
  products,
  repairCases,
  repairCaseIntakeSequences,
  statusChangeHistories,
  workflowSteps,
  workflowTemplates,
  workflowVersions,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import { transitionWorkflow } from "./workflow-transitions";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Real-DB integration test for transitionWorkflow(), the mutation behind
 * transition-workflow.ts's Server Action. Calls the mutation directly with
 * real DB user UUIDs (not through readSession()) — same layering choice
 * every other *.integration.test.ts file in this directory already makes,
 * and necessary here for an additional, pre-existing reason: this
 * codebase's only login path (DEMO_LOGIN_ENABLED) creates sessions from
 * mock-data.ts user ids ("u-001", ...), which never match a real `users.id`
 * UUID — see the final report's "remaining risks" for why that also
 * affects the shipped create/idempotency features, not just this one.
 *
 * Deliberately self-cleaning and isolated to test month "9904" (distinct
 * from every other isolated month already in use) and a "WORKFLOW-TEST-"
 * product prefix. Must never touch D2608, customers, users, End-Users, or
 * workflows.
 *
 * Approval-gated transitions (every workflow's SHIPMENT_COMPLETED, plus one
 * REPAIR_INSPECTION-gated advance per workflow) are now backed by
 * repair_case_approvals — see
 * workflow-transitions-approval-gating.integration.test.ts for the
 * dedicated suite proving those transitions actually succeed once a valid
 * approval exists. Test 12 below stays in *this* file only to confirm the
 * no-approval-yet rejection path leaves no side effects; tests 12/13 both
 * directly UPDATE test rows' current_workflow_step_id/is_locked in their
 * arrange phase (bypassing transitionWorkflow itself, clearly commented)
 * purely to reach the specific state under test, since no legitimate
 * transition chain can reach "waiting_shipment" without a satisfied
 * REPAIR_INSPECTION approval first.
 */

const TEST_RECEIVED_AT = "2099-04-10";
const TEST_SHIPMENT_DATE = "2099-04-20";
const TEST_MODEL_PREFIX = "WORKFLOW-TEST-";
const TEST_YEAR_MONTH = "9904";

let customerId: string;
let engineerId: string;
let adminId: string;
let salesId: string;
let matcherWorkflowVersionId: string;

before(async () => {
  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.isDeleted, false))
    .limit(1);
  assert.ok(customer, "expected at least one non-deleted customer in the dev DB");
  customerId = customer.id;

  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(engineer, "expected at least one approved AS_ENGINEER in the dev DB");
  engineerId = engineer.id;

  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        ne(users.role, "AS_ENGINEER"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false),
        eq(users.role, "ADMIN")
      )
    )
    .limit(1);
  const [superAdmin] = admin
    ? []
    : await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
        .limit(1);
  const resolvedAdmin = admin ?? superAdmin;
  assert.ok(resolvedAdmin, "expected at least one approved ADMIN or SUPER_ADMIN in the dev DB");
  adminId = resolvedAdmin.id;

  const [sales] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SALES"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(sales, "expected at least one approved SALES user in the dev DB");
  salesId = sales.id;

  const [version] = await db
    .select({ id: workflowVersions.id })
    .from(workflowVersions)
    .innerJoin(workflowTemplates, eq(workflowVersions.workflowTemplateId, workflowTemplates.id))
    .where(and(eq(workflowTemplates.code, "PAID_MATCHER"), eq(workflowVersions.isCurrent, true)));
  assert.ok(version, "expected a PUBLISHED/current PAID_MATCHER workflow_versions row");
  matcherWorkflowVersionId = version.id;
});

after(async () => {
  // Deletion order: status_change_histories references repair_cases with
  // ON DELETE RESTRICT — delete history for each test case first.
  const testCaseIds = await db
    .select({ id: repairCases.id })
    .from(repairCases)
    .where(like(repairCases.intakeNumber, "D9904%"));
  if (testCaseIds.length > 0) {
    for (const { id } of testCaseIds) {
      await db.delete(statusChangeHistories).where(eq(statusChangeHistories.repairCaseId, id));
    }
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, "D9904%"));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await pgClient.end({ timeout: 5 });
});

function baseCreateInput(overrides: Partial<ValidatedCreateRepairCaseInput> = {}): ValidatedCreateRepairCaseInput {
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
    ...overrides,
  };
}

async function createTestCase(overrides: Partial<ValidatedCreateRepairCaseInput> = {}) {
  const result = await createRepairCase(baseCreateInput(overrides));
  assert.equal(result.ok, true, `setup create failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

async function fetchRow(id: string) {
  const [row] = await db.select().from(repairCases).where(eq(repairCases.id, id));
  assert.ok(row, `expected repair_cases row ${id} to exist`);
  return row!;
}

async function stepIdForKey(key: string): Promise<string> {
  const [step] = await db
    .select({ id: workflowSteps.id })
    .from(workflowSteps)
    .where(and(eq(workflowSteps.workflowVersionId, matcherWorkflowVersionId), eq(workflowSteps.key, key)));
  assert.ok(step, `expected workflow_steps row for PAID_MATCHER/${key}`);
  return step!.id;
}

describe("transitionWorkflow", () => {
  test("1. valid advance succeeds, 8. current step updates, 9. version increments exactly once", async () => {
    const created = await createTestCase();
    const result = await transitionWorkflow(created.id, 1, "STEP_ADVANCED", engineerId, null);
    assert.equal(result.ok, true, `advance failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.version, 2);
    assert.equal(result.currentWorkflowStepKey, "kyosan_contact_report_sent");

    const row = await fetchRow(created.id);
    assert.equal(row.version, 2);
    assert.equal(row.currentWorkflowStepId, await stepIdForKey("kyosan_contact_report_sent"));
  });

  // 제목의 "reason required"는 2026-08-18 완화로 더 이상 사실이 아니라
  // 제거했다 — 사유를 함께 넘기는 이 시나리오 자체는 그대로 유효하다
  // (선택 입력이므로 넘겨도 정상 기록된다). 사유 없이 되돌리는 경로는
  // 아래 10-1이 따로 검증한다.
  test("2. valid return succeeds (ADMIN/SUPER_ADMIN, with a reason)", async () => {
    const created = await createTestCase();
    const advanced = await transitionWorkflow(created.id, 1, "STEP_ADVANCED", engineerId, null);
    assert.equal(advanced.ok, true);
    if (!advanced.ok) return;

    const returned = await transitionWorkflow(created.id, advanced.version, "STEP_RETURNED", adminId, "지연 사유 확인");
    assert.equal(returned.ok, true, `return failed: ${JSON.stringify(returned)}`);
    if (!returned.ok) return;
    assert.equal(returned.currentWorkflowStepKey, "intake_inspection");
    assert.equal(returned.version, 3);
  });

  test("3. invalid transition (no such row) is rejected with INVALID_TRANSITION", async () => {
    const created = await createTestCase();
    // intake_inspection is PAID_MATCHER의 first step — no STEP_RETURNED row exists from it.
    const result = await transitionWorkflow(created.id, 1, "STEP_RETURNED", adminId, "사유");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_TRANSITION");
  });

  test("4. role restriction is enforced (SALES cannot advance a TECHNICAL step)", async () => {
    const created = await createTestCase();
    const result = await transitionWorkflow(created.id, 1, "STEP_ADVANCED", salesId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("5. stale expectedVersion returns CONFLICT", async () => {
    const created = await createTestCase();
    const first = await transitionWorkflow(created.id, 1, "STEP_ADVANCED", engineerId, null);
    assert.equal(first.ok, true);

    const stale = await transitionWorkflow(created.id, 1, "STEP_ADVANCED", engineerId, null);
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.code, "CONFLICT");
  });

  test("6. two concurrent transitions with the same version: one success, one CONFLICT", async () => {
    const created = await createTestCase();
    const [a, b] = await Promise.all([
      transitionWorkflow(created.id, 1, "STEP_ADVANCED", engineerId, null),
      transitionWorkflow(created.id, 1, "STEP_ADVANCED", engineerId, null),
    ]);
    const successes = [a, b].filter((r) => r.ok);
    const conflicts = [a, b].filter((r) => !r.ok && r.code === "CONFLICT");
    assert.equal(successes.length, 1);
    assert.equal(conflicts.length, 1);

    const row = await fetchRow(created.id);
    assert.equal(row.version, 2, "version must have incremented exactly once, not twice");
  });

  test("7. history row is inserted exactly once per successful transition", async () => {
    const created = await createTestCase();
    const result = await transitionWorkflow(created.id, 1, "STEP_ADVANCED", engineerId, null);
    assert.equal(result.ok, true);

    const rows = await db
      .select()
      .from(statusChangeHistories)
      .where(eq(statusChangeHistories.repairCaseId, created.id));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actionType, "STEP_ADVANCED");
    assert.equal(rows[0].actorUserId, engineerId);
  });

  test("a CONFLICT does not leave a stray history row behind (insert rolls back with the failed update)", async () => {
    const created = await createTestCase();
    const first = await transitionWorkflow(created.id, 1, "STEP_ADVANCED", engineerId, null);
    assert.equal(first.ok, true);

    const stale = await transitionWorkflow(created.id, 1, "STEP_ADVANCED", engineerId, null);
    assert.equal(stale.ok, false);

    const rows = await db
      .select()
      .from(statusChangeHistories)
      .where(eq(statusChangeHistories.repairCaseId, created.id));
    assert.equal(rows.length, 1, "the stale/conflicting attempt must not have inserted a second history row");
  });

  // 2026-08-18 완화: 보류 사유는 필수에서 선택으로 바뀌었다. 이 테스트는
  // 원래 "hold requires a reason"(REASON_REQUIRED 반환)을 검증하던 자리이며,
  // 완화된 동작을 그대로 뒤집어 고정한다 — 사유 없이도 보류가 시작되고,
  // 감사 이력에는 reason이 null로 남는다. 사유 요구를 다시 켜면 이 테스트가
  // 실패하므로, 의도치 않은 재강화도 여기서 걸린다.
  test("10. hold without a reason succeeds and records a null reason", async () => {
    const created = await createTestCase();
    const result = await transitionWorkflow(created.id, 1, "HOLD_STARTED", engineerId, null);
    assert.equal(result.ok, true, `hold without reason failed: ${JSON.stringify(result)}`);

    const [row] = await db
      .select({ actionType: statusChangeHistories.actionType, reason: statusChangeHistories.reason })
      .from(statusChangeHistories)
      .where(eq(statusChangeHistories.repairCaseId, created.id));
    assert.equal(row.actionType, "HOLD_STARTED");
    assert.equal(row.reason, null, "사유를 적지 않으면 빈 문자열이 아니라 null로 기록되어야 한다");
  });

  // 같은 완화의 되돌리기 쪽 짝. 이전에는 STEP_RETURNED가
  // SUPER_ADMIN/ADMIN 전용 + 사유 필수였다 — 이제 담당 엔지니어 본인도
  // 사유 없이 되돌릴 수 있어야 한다(transition-definitions.ts 헤더 주석 참조).
  test("10-1. assigned AS_ENGINEER can return a step without a reason", async () => {
    const created = await createTestCase();
    const advanced = await transitionWorkflow(created.id, 1, "STEP_ADVANCED", engineerId, null);
    assert.equal(advanced.ok, true, `advance failed: ${JSON.stringify(advanced)}`);
    if (!advanced.ok) return;

    const returned = await transitionWorkflow(created.id, advanced.version, "STEP_RETURNED", engineerId, null);
    assert.equal(returned.ok, true, `engineer return failed: ${JSON.stringify(returned)}`);
    if (!returned.ok) return;
    assert.equal(returned.currentWorkflowStepKey, "intake_inspection");

    const rows = await db
      .select({ actionType: statusChangeHistories.actionType, reason: statusChangeHistories.reason })
      .from(statusChangeHistories)
      .where(eq(statusChangeHistories.repairCaseId, created.id))
      .orderBy(statusChangeHistories.createdAt);
    assert.deepEqual(
      rows.map((r) => r.actionType),
      ["STEP_ADVANCED", "STEP_RETURNED"]
    );
    assert.equal(rows[1].reason, null);
  });

  test("11. hold start + release hold works, and hold state is correctly derived afterward", async () => {
    const created = await createTestCase();
    const started = await transitionWorkflow(created.id, 1, "HOLD_STARTED", engineerId, "부품 대기");
    assert.equal(started.ok, true, `hold start failed: ${JSON.stringify(started)}`);
    if (!started.ok) return;
    assert.equal(started.currentWorkflowStepKey, "intake_inspection", "hold must not move the step");

    const released = await transitionWorkflow(created.id, started.version, "HOLD_RELEASED", engineerId, "부품 입고 완료");
    assert.equal(released.ok, true, `hold release failed: ${JSON.stringify(released)}`);

    const historyRows = await db
      .select({ actionType: statusChangeHistories.actionType })
      .from(statusChangeHistories)
      .where(eq(statusChangeHistories.repairCaseId, created.id))
      .orderBy(statusChangeHistories.createdAt);
    assert.deepEqual(
      historyRows.map((r) => r.actionType),
      ["HOLD_STARTED", "HOLD_RELEASED"]
    );

    // Starting hold again while already released must succeed (not stuck).
    const startedAgain = await transitionWorkflow(created.id, released.ok ? released.version : 0, "HOLD_STARTED", engineerId, "재보류");
    assert.equal(startedAgain.ok, true);

    // But starting hold while already on hold must fail.
    const doubleStart = await transitionWorkflow(
      created.id,
      startedAgain.ok ? startedAgain.version : 0,
      "HOLD_STARTED",
      engineerId,
      "재보류 시도"
    );
    assert.equal(doubleStart.ok, false);
    if (!doubleStart.ok) assert.equal(doubleStart.code, "INVALID_TRANSITION");
  });

  test("12. shipment completion without a granted approval is rejected with APPROVAL_REQUIRED and applies no side effects", async () => {
    const created = await createTestCase();
    // Arrange-only: directly place the case at "waiting_shipment" — no
    // legitimate transition chain can reach it without a satisfied
    // REPAIR_INSPECTION approval first (see module header comment). This
    // bypasses transitionWorkflow() entirely; it is not exercising product
    // code, only constructing the scenario under test.
    const waitingShipmentStepId = await stepIdForKey("waiting_shipment");
    await db.update(repairCases).set({ currentWorkflowStepId: waitingShipmentStepId }).where(eq(repairCases.id, created.id));

    const result = await transitionWorkflow(created.id, 1, "SHIPMENT_COMPLETED", adminId, "출하 메모");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "APPROVAL_REQUIRED");
      assert.match(result.message, /승인/);
    }

    const row = await fetchRow(created.id);
    assert.equal(row.isLocked, false, "a rejected shipment completion must not lock the case");
    assert.equal(row.actualShipmentDate, null);
    assert.equal(row.version, 1, "a rejected transition must not increment version");

    const historyRows = await db
      .select()
      .from(statusChangeHistories)
      .where(eq(statusChangeHistories.repairCaseId, created.id));
    assert.equal(historyRows.length, 0, "a rejected transition must not insert a history row");
  });

  test("13. a locked case blocks further transitions with CASE_LOCKED", async () => {
    const created = await createTestCase();
    // Arrange-only direct SQL — see test 12's note; there is no reachable
    // path to a real lock in this suite (locking only happens on a
    // successful SHIPMENT_COMPLETED, which is deferred).
    await db.update(repairCases).set({ isLocked: true }).where(eq(repairCases.id, created.id));

    const result = await transitionWorkflow(created.id, 1, "STEP_ADVANCED", engineerId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CASE_LOCKED");
  });

  test("missing repair case returns NOT_FOUND", async () => {
    const result = await transitionWorkflow(randomUUID(), 1, "STEP_ADVANCED", engineerId, null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });
// ──────────────────────────────────────────────────────────────────────
  // STEP_SET_MANUALLY — 정규 전이표를 거치지 않는 단계 직접 변경 (2026-08-18)
  // ──────────────────────────────────────────────────────────────────────
  // 이 경로는 워크플로 규칙의 유일한 우회로이므로, "된다"보다 "막아야 할 것이
  // 막힌다"를 더 촘촘히 고정한다.

  test("14. manual step set: 관리자는 임의 단계로 직접 이동하고 STEP_SET_MANUALLY로 기록된다", async () => {
    const created = await createTestCase();
    const target = "waiting_kyosan_reply";

    const result = await transitionWorkflow(created.id, 1, "STEP_SET_MANUALLY", adminId, "고객 요청으로 단계 조정", target);
    assert.equal(result.ok, true, `manual set failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.currentWorkflowStepKey, target);
    assert.equal(result.version, 2, "직접 변경도 낙관적 잠금 버전을 정확히 1 올린다");

    const row = await fetchRow(created.id);
    assert.equal(row.currentWorkflowStepId, await stepIdForKey(target));

    const [history] = await db
      .select({ actionType: statusChangeHistories.actionType, reason: statusChangeHistories.reason })
      .from(statusChangeHistories)
      .where(eq(statusChangeHistories.repairCaseId, created.id));
    assert.equal(history.actionType, "STEP_SET_MANUALLY", "정규 진행/되돌리기와 반드시 구분되어야 한다");
    assert.equal(history.reason, "고객 요청으로 단계 조정");
  });

  test("15. manual step set: 사유가 없으면 REASON_REQUIRED (되돌리기·보류와 달리 항상 필수)", async () => {
    const created = await createTestCase();
    const result = await transitionWorkflow(created.id, 1, "STEP_SET_MANUALLY", adminId, null, "waiting_kyosan_reply");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "REASON_REQUIRED");

    const rows = await db.select().from(statusChangeHistories).where(eq(statusChangeHistories.repairCaseId, created.id));
    assert.equal(rows.length, 0, "거부된 시도는 이력을 남기지 않는다");
  });

  test("16. manual step set: 승인 게이트 단계로는 이동할 수 없다 (승인 우회 차단)", async () => {
    const created = await createTestCase();
    const result = await transitionWorkflow(created.id, 1, "STEP_SET_MANUALLY", adminId, "출하 처리 필요", "shipment_completed");
    assert.equal(result.ok, false, "최종 출하 승인 없이 출하 완료로 점프할 수 있으면 안 된다");
    if (!result.ok) assert.equal(result.code, "INVALID_TRANSITION");

    const row = await fetchRow(created.id);
    assert.equal(row.version, 1, "거부된 시도는 버전을 올리지 않는다");
  });

  test("17. manual step set: 존재하지 않는 단계 키는 거부된다", async () => {
    const created = await createTestCase();
    const result = await transitionWorkflow(created.id, 1, "STEP_SET_MANUALLY", adminId, "테스트", "존재하지_않는_단계");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_TRANSITION");
  });

  test("18. manual step set: 현재와 같은 단계를 다시 지정하면 거부된다", async () => {
    const created = await createTestCase();
    const result = await transitionWorkflow(created.id, 1, "STEP_SET_MANUALLY", adminId, "테스트", "intake_inspection");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_TRANSITION");
  });

  test("19. manual step set: 담당 엔지니어 본인은 가능하고, 담당이 아닌 역할(SALES)은 FORBIDDEN", async () => {
    const engineerCase = await createTestCase();
    const byEngineer = await transitionWorkflow(engineerCase.id, 1, "STEP_SET_MANUALLY", engineerId, "현장 판단", "waiting_kyosan_reply");
    assert.equal(byEngineer.ok, true, `assigned engineer manual set failed: ${JSON.stringify(byEngineer)}`);

    const salesCase = await createTestCase();
    const bySales = await transitionWorkflow(salesCase.id, 1, "STEP_SET_MANUALLY", salesId, "영업 판단", "waiting_kyosan_reply");
    assert.equal(bySales.ok, false, "SALES는 단계를 임의로 옮길 수 없다");
    if (!bySales.ok) assert.equal(bySales.code, "FORBIDDEN");
  });

  test("20. manual step set: 보류 중에는 거부된다", async () => {
    const created = await createTestCase();
    const held = await transitionWorkflow(created.id, 1, "HOLD_STARTED", engineerId, "부품 대기");
    assert.equal(held.ok, true);
    if (!held.ok) return;

    const result = await transitionWorkflow(created.id, held.version, "STEP_SET_MANUALLY", adminId, "그래도 옮기기", "waiting_kyosan_reply");
    assert.equal(result.ok, false, "보류 중 다른 작업 금지 규칙이 이 경로에도 적용되어야 한다");
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });

  test("21. manual step set: 버전이 어긋나면 CONFLICT", async () => {
    const created = await createTestCase();
    const first = await transitionWorkflow(created.id, 1, "STEP_SET_MANUALLY", adminId, "1차 조정", "waiting_kyosan_reply");
    assert.equal(first.ok, true);

    const stale = await transitionWorkflow(created.id, 1, "STEP_SET_MANUALLY", adminId, "2차 조정", "kyosan_contact_report_sent");
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.code, "CONFLICT");
  });
});
