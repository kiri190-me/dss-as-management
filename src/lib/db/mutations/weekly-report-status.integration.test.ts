import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  customers,
  products,
  repairCases,
  repairCaseIntakeSequences,
  statusChangeHistories,
  users,
  workflowSteps,
  workflowTemplates,
  workflowVersions,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import { setWeeklyReportStatus } from "./weekly-report-status";
import { classifyWeeklyReportStatus, type WeeklyReportStatus } from "@/lib/domain/weekly-report";
import type { RepairStatus } from "@/lib/domain/types";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 주간보고 `현 상태` 직접 변경 — 실제 DB 로 재는 시험
 * ============================================================================
 * 화면은 **분류 하나**(6칸 중 하나)를 보낸다. 서버가 그것을 단계로 번역해
 * transitionWorkflow(... "STEP_SET_MANUALLY" ...) 로 옮기는 것이 이 기능의 전부이고,
 * 여기서 못 박는 것은 넷이다.
 *
 *   1. 엔지니어가 분류를 바꾸면 **단계가 실제로 옮겨 가고**, 옮겨 간 단계의 상태가
 *      다시 그 분류로 계산된다. 분류 판정은 지어내지 않고 도메인의
 *      classifyWeeklyReportStatus 로 **다시 재서** 확인한다 — 단계 키를 박아 두면
 *      워크플로를 편집한 날 이 시험이 뜻 없이 깨진다.
 *   2. 🔴 **이력이 남는다** — action_type = STEP_SET_MANUALLY, 사유는 null,
 *      from/to 단계와 행위자가 그대로. 사유가 선택 입력이 되었어도(2026-10-04)
 *      추적이 사라지지 않는다는 것이 이 줄의 뜻이다.
 *   3. 🔴 **되돌리기도 된다.** 앞으로 간 건을 뒤쪽 분류로 다시 보내면 step_order 가
 *      작은 단계로 내려간다.
 *   4. 🔴 **역할이 안 되는 사람(영업)은 막힌다.** 막힐 뿐 아니라 **아무 흔적도
 *      남기지 않는다** — 버전도 단계도 그대로이고 이력도 생기지 않는다.
 *
 * 세션을 타지 않고 mutation 을 직접 부른다 — 이 폴더의 다른 *.integration.test.ts
 * 가 전부 그렇게 하고, 까닭도 같다(workflow-transitions.integration.test.ts 머리말).
 * Server Action 층이 하는 일은 모드 확인·세션·입력 형식 검증뿐이다.
 *
 * 격리: 접수 월 **"9310"** · 제품 모델 **"WR-STATUS-TEST-"** (다른 어느 스위트와도
 * 겹치지 않는다). 끝나면 그 행만 지운다. 고객사·사용자·워크플로는 건드리지 않는다.
 * ============================================================================
 */

const TEST_RECEIVED_AT = "2093-10-10";
const TEST_SHIPMENT_DATE = "2093-10-20";
const TEST_MODEL_PREFIX = "WR-STATUS-TEST-";
const TEST_YEAR_MONTH = "9310";
const TEST_INTAKE_LIKE = "D9310%";

let customerId: string;
let engineerId: string;
let salesId: string;

before(async () => {
  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.isDeleted, false))
    .limit(1);
  assert.ok(customer, "expected at least one non-deleted customer in the test DB");
  customerId = customer.id;

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
  assert.ok(engineer, "expected at least one approved AS_ENGINEER in the test DB");
  engineerId = engineer.id;

  const [sales] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(eq(users.role, "SALES"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false))
    )
    .limit(1);
  assert.ok(sales, "expected at least one approved SALES user in the test DB");
  salesId = sales.id;

  // 이 스위트는 PAID_MATCHER 로만 잰다 — 그 워크플로가 발행돼 있지 않으면
  // 아래 시험들이 무엇을 재는지 알 수 없으므로 여기서 멈춘다.
  const [version] = await db
    .select({ id: workflowVersions.id })
    .from(workflowVersions)
    .innerJoin(workflowTemplates, eq(workflowVersions.workflowTemplateId, workflowTemplates.id))
    .where(and(eq(workflowTemplates.code, "PAID_MATCHER"), eq(workflowVersions.isCurrent, true)));
  assert.ok(version, "expected a PUBLISHED/current PAID_MATCHER workflow_versions row");
});

after(async () => {
  // status_change_histories 가 repair_cases 를 ON DELETE RESTRICT 로 참조한다 —
  // 이력을 먼저 지운다(이웃 스위트와 같은 차례).
  const testCaseIds = await db
    .select({ id: repairCases.id })
    .from(repairCases)
    .where(like(repairCases.intakeNumber, TEST_INTAKE_LIKE));
  for (const { id } of testCaseIds) {
    await db.delete(statusChangeHistories).where(eq(statusChangeHistories.repairCaseId, id));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, TEST_INTAKE_LIKE));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db
    .delete(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await pgClient.end({ timeout: 5 });
});

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

async function createTestCase() {
  const result = await createRepairCase(baseCreateInput());
  assert.equal(result.ok, true, `setup create failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

type StepSnapshot = {
  stepId: string;
  key: string;
  order: number;
  status: RepairStatus | null;
  version: number;
};

/** 그 접수 건이 지금 서 있는 단계 — 주간보고가 보는 값 그대로. */
async function snapshot(repairCaseId: string): Promise<StepSnapshot> {
  const [row] = await db
    .select({
      stepId: workflowSteps.id,
      key: workflowSteps.key,
      order: workflowSteps.stepOrder,
      status: workflowSteps.repairStatus,
      version: repairCases.version,
    })
    .from(repairCases)
    .innerJoin(workflowSteps, eq(repairCases.currentWorkflowStepId, workflowSteps.id))
    .where(eq(repairCases.id, repairCaseId));
  assert.ok(row, `expected repair_cases row ${repairCaseId} to exist`);
  return row!;
}

/**
 * 지금 단계가 주간보고의 어느 칸으로 계산되는가. 🔴 분류 표를 이 파일에 베껴
 * 적지 않고 **도메인 함수를 그대로 부른다** — 베끼면 그 표가 바뀐 날 시험만 옛
 * 규칙을 고집한다.
 */
function classificationOf(step: StepSnapshot): WeeklyReportStatus | null {
  return classifyWeeklyReportStatus({ status: step.status, currentWorkflowStepKey: step.key });
}

async function historyOf(repairCaseId: string) {
  return db
    .select({
      actionType: statusChangeHistories.actionType,
      reason: statusChangeHistories.reason,
      fromStepId: statusChangeHistories.fromStepId,
      toStepId: statusChangeHistories.toStepId,
      actorUserId: statusChangeHistories.actorUserId,
    })
    .from(statusChangeHistories)
    .where(eq(statusChangeHistories.repairCaseId, repairCaseId));
}

describe("setWeeklyReportStatus", () => {
  test("1. 엔지니어가 분류를 바꾸면 단계가 옮겨 가고, 그 단계가 다시 그 분류로 계산된다", async () => {
    const created = await createTestCase();
    const start = await snapshot(created.id);
    assert.equal(
      classificationOf(start),
      "INSPECTION_WAITING",
      "표본 점검: 새 접수 건은 점검 대기에서 시작한다"
    );

    const result = await setWeeklyReportStatus(created.id, start.version, "SHIPMENT_WAITING", engineerId);
    assert.equal(result.ok, true, `status change failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const moved = await snapshot(created.id);
    assert.notEqual(moved.stepId, start.stepId, "단계가 실제로 옮겨 가야 한다");
    assert.equal(moved.version, start.version + 1, "버전은 정확히 한 번 오른다");
    assert.equal(moved.key, result.currentWorkflowStepKey);
    assert.equal(
      classificationOf(moved),
      "SHIPMENT_WAITING",
      "옮겨 간 단계가 고른 분류로 다시 계산되어야 한다 — 그래야 표에 그 글자가 적힌다"
    );
  });

  test("2. 이력이 남는다 — 단계 직접 변경, 사유는 null, 행위자·from·to 그대로", async () => {
    const created = await createTestCase();
    const start = await snapshot(created.id);

    const result = await setWeeklyReportStatus(created.id, start.version, "IN_REPAIR", engineerId);
    assert.equal(result.ok, true, `status change failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    const moved = await snapshot(created.id);
    assert.equal(classificationOf(moved), "IN_REPAIR");

    const rows = await historyOf(created.id);
    assert.equal(rows.length, 1, "변경 한 번에 이력 한 줄");
    const [history] = rows;
    assert.equal(history.actionType, "STEP_SET_MANUALLY");
    // 🔴 사유가 선택 입력이 된 뒤에도 나머지는 전부 남는다(파일 헤더).
    assert.equal(history.reason, null, "이 화면에는 사유를 적을 자리가 없다 — null 로 남는다");
    assert.equal(history.fromStepId, start.stepId);
    assert.equal(history.toStepId, moved.stepId);
    assert.equal(history.actorUserId, engineerId);
  });

  test("3. 되돌리기도 된다 — 앞으로 간 건을 뒤쪽 분류로 보내면 step_order 가 내려간다", async () => {
    const created = await createTestCase();
    const start = await snapshot(created.id);

    const forward = await setWeeklyReportStatus(created.id, start.version, "SHIPMENT_WAITING", engineerId);
    assert.equal(forward.ok, true, `setup forward failed: ${JSON.stringify(forward)}`);
    if (!forward.ok) return;
    const ahead = await snapshot(created.id);
    assert.ok(ahead.order > start.order, "표본 점검: 출하 대기는 점검 대기보다 뒤에 있다");

    const back = await setWeeklyReportStatus(created.id, ahead.version, "INSPECTION_WAITING", engineerId);
    assert.equal(back.ok, true, `return failed: ${JSON.stringify(back)}`);
    if (!back.ok) return;

    const returned = await snapshot(created.id);
    assert.ok(returned.order < ahead.order, "뒤로 가는 길이 막혀 있지 않다");
    assert.equal(classificationOf(returned), "INSPECTION_WAITING");
  });

  test("4. 역할이 안 되는 사람(영업)은 막히고, 아무 흔적도 남지 않는다", async () => {
    const created = await createTestCase();
    const start = await snapshot(created.id);

    const result = await setWeeklyReportStatus(created.id, start.version, "SHIPMENT_WAITING", salesId);
    assert.equal(result.ok, false, "영업은 단계를 직접 옮길 수 없다");
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");

    const afterTry = await snapshot(created.id);
    assert.equal(afterTry.stepId, start.stepId, "막혔으면 단계도 그대로다");
    assert.equal(afterTry.version, start.version, "막혔으면 버전도 오르지 않는다");
    assert.deepEqual(await historyOf(created.id), [], "막힌 시도는 이력도 남기지 않는다");
  });

  test("5. 없는 접수 건은 NOT_FOUND — 조용히 통과하지 않는다", async () => {
    const result = await setWeeklyReportStatus(randomUUID(), 1, "IN_REPAIR", engineerId);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });

  test("6. 낡은 버전으로 보내면 CONFLICT — 낡은 화면이 남의 변경을 덮어쓰지 못한다", async () => {
    const created = await createTestCase();
    const start = await snapshot(created.id);

    const first = await setWeeklyReportStatus(created.id, start.version, "SHIPMENT_WAITING", engineerId);
    assert.equal(first.ok, true, `setup failed: ${JSON.stringify(first)}`);

    const stale = await setWeeklyReportStatus(created.id, start.version, "IN_REPAIR", engineerId);
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.code, "CONFLICT");
  });
});
