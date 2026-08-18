import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  customers,
  products,
  repairCaseIntakeSequences,
  repairCases,
  statusChangeHistories,
  users,
  workflowSteps,
  workflowTemplates,
  workflowTransitions,
  workflowVersions,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import { addCaseWorkflowStep } from "./case-workflow-steps";
import { transitionWorkflow } from "./workflow-transitions";
import { getWorkflowTemplateDetail } from "../queries/workflow-templates";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * 건별 워크플로 변주(addCaseWorkflowStep)의 실 DB 통합 테스트.
 *
 * 여기서 확인하려는 핵심은 "단계 행이 생겼는가"가 아니라 **끼워넣은 단계가
 * 실제로 흐름에 들어갔는가**다. 전이를 다시 이어 붙이지 못하면 그 접수 건은
 * 갇힌다(시드 데이터에서 실제로 겪었던 실패다). 그래서 추가한 뒤 그 단계로
 * 진행하고 되돌아오는 것까지 transitionWorkflow로 확인한다 — 전이 엔진은 이
 * 기능을 위해 한 줄도 고치지 않았으므로, 엔진이 통과시키면 규칙이 제대로
 * 놓인 것이다.
 *
 * 다른 통합 테스트와 같은 규칙으로 스스로 정리한다: 접수월 "9702"와
 * "CASESTEP-TEST-" 모델 접두사만 쓰고, 만들어진 건 전용 workflow_versions까지
 * 지운다(그 행은 접수 건을 지워도 남는다 — repair_case_id에 FK가 없다).
 */

const TEST_RECEIVED_AT = "2097-02-10";
const TEST_SHIPMENT_DATE = "2097-02-20";
const TEST_MODEL_PREFIX = "CASESTEP-TEST-";
const TEST_YEAR_MONTH = "9702";
const TEST_INTAKE_PREFIX = "D9702";

let customerId: string;
let engineerId: string;
let otherEngineerId: string;
let adminId: string;
let salesId: string;

before(async () => {
  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.isDeleted, false))
    .limit(1);
  assert.ok(customer, "삭제되지 않은 고객이 최소 1건 필요합니다");
  customerId = customer.id;

  const engineers = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(2);
  assert.equal(engineers.length, 2, "승인된 AS_ENGINEER가 2명 이상 필요합니다(담당/비담당 구분 테스트)");
  engineerId = engineers[0].id;
  otherEngineerId = engineers[1].id;

  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  const [superAdmin] = admin
    ? []
    : await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
        .limit(1);
  const resolvedAdmin = admin ?? superAdmin;
  assert.ok(resolvedAdmin, "승인된 ADMIN 또는 SUPER_ADMIN이 필요합니다");
  adminId = resolvedAdmin.id;

  const [sales] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SALES"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(sales, "승인된 SALES 사용자가 필요합니다");
  salesId = sales.id;
});

after(async () => {
  const testCases = await db
    .select({ id: repairCases.id })
    .from(repairCases)
    .where(like(repairCases.intakeNumber, `${TEST_INTAKE_PREFIX}%`));
  const caseIds = testCases.map((c) => c.id);

  for (const id of caseIds) {
    await db.delete(statusChangeHistories).where(eq(statusChangeHistories.repairCaseId, id));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `${TEST_INTAKE_PREFIX}%`));

  // 접수 건을 지워도 건 전용 버전은 남는다(repair_case_id에 FK가 없다 —
  // 스키마 순환 참조를 피하려고 일부러 걸지 않았다). 여기서 직접 지운다.
  if (caseIds.length > 0) {
    const scoped = await db
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .where(and(eq(workflowVersions.isCaseScoped, true), inArray(workflowVersions.repairCaseId, caseIds)));
    const versionIds = scoped.map((v) => v.id);
    if (versionIds.length > 0) {
      await db.delete(workflowTransitions).where(inArray(workflowTransitions.workflowVersionId, versionIds));
      await db.delete(workflowSteps).where(inArray(workflowSteps.workflowVersionId, versionIds));
      await db.delete(workflowVersions).where(inArray(workflowVersions.id, versionIds));
    }
  }

  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await pgClient.end({ timeout: 5 });
});

function baseCreateInput(): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "MATCHER",
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
  assert.equal(result.ok, true, `사전 준비(접수 생성) 실패: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

async function fetchCase(id: string) {
  const [row] = await db.select().from(repairCases).where(eq(repairCases.id, id));
  assert.ok(row);
  return row!;
}

async function stepsOfVersion(versionId: string) {
  return db
    .select({ id: workflowSteps.id, key: workflowSteps.key, order: workflowSteps.stepOrder, label: workflowSteps.label })
    .from(workflowSteps)
    .where(eq(workflowSteps.workflowVersionId, versionId))
    .orderBy(asc(workflowSteps.stepOrder));
}

describe("addCaseWorkflowStep", () => {
  test("담당 엔지니어가 현재 단계 바로 다음에 단계를 끼워넣는다", async () => {
    const created = await createTestCase();
    const before = await fetchCase(created.id);

    const result = await addCaseWorkflowStep({
      repairCaseId: created.id,
      expectedVersion: before.version,
      label: "고객 요청 추가 절연 시험",
      status: "IN_REPAIR",
      category: "TECHNICAL",
      actorUserId: engineerId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.equal(result.createdCaseVersion, true);

    const after = await fetchCase(created.id);
    assert.equal(after.workflowVersionId, result.versionId, "접수 건이 전용 버전으로 옮겨져야 한다");
    assert.notEqual(after.workflowVersionId, before.workflowVersionId);
    assert.equal(after.version, before.version + 1);

    const [version] = await db
      .select({ isCaseScoped: workflowVersions.isCaseScoped, isCurrent: workflowVersions.isCurrent, repairCaseId: workflowVersions.repairCaseId, status: workflowVersions.status })
      .from(workflowVersions)
      .where(eq(workflowVersions.id, result.versionId));
    assert.equal(version.isCaseScoped, true);
    assert.equal(version.repairCaseId, created.id);
    assert.equal(version.isCurrent, false, "전용 버전이 current가 되면 신규 접수까지 이 변주를 쓰게 된다");

    // 현재 단계는 그대로고(옮겨지지 않았고), 새 단계가 바로 뒤 순서를 가진다.
    const steps = await stepsOfVersion(result.versionId);
    const currentIndex = steps.findIndex((s) => s.id === after.currentWorkflowStepId);
    assert.ok(currentIndex >= 0, "현재 단계가 전용 버전에 있어야 한다");
    assert.equal(steps[currentIndex].key, "intake_inspection");
    assert.equal(steps[currentIndex + 1].id, result.stepId);
    assert.equal(steps[currentIndex + 1].label, "고객 요청 추가 절연 시험");

    // 순서가 1..n으로 촘촘하게 유지되어야 한다(뒤로 한 칸씩 밀렸으므로).
    assert.deepEqual(
      steps.map((s) => s.order),
      steps.map((_, i) => i + 1)
    );
  });

  test("끼워넣은 단계로 실제로 진행하고 되돌아올 수 있다", async () => {
    const created = await createTestCase();
    const added = await addCaseWorkflowStep({
      repairCaseId: created.id,
      expectedVersion: 1,
      label: "추가 확인",
      status: "IN_REPAIR",
      category: "TECHNICAL",
      actorUserId: engineerId,
    });
    assert.equal(added.ok, true, JSON.stringify(added));
    if (!added.ok) return;

    // 원래 흐름은 intake_inspection → kyosan_contact_report_sent 였다.
    const advanced = await transitionWorkflow(created.id, added.version, "STEP_ADVANCED", engineerId, null);
    assert.equal(advanced.ok, true, `새 단계로 진행 실패: ${JSON.stringify(advanced)}`);
    if (!advanced.ok) return;
    assert.match(advanced.currentWorkflowStepKey, /^case_step_\d+$/);

    // 새 단계에서 다시 앞으로 — 원래 다음 단계로 이어져야 한다.
    const advancedAgain = await transitionWorkflow(created.id, advanced.version, "STEP_ADVANCED", engineerId, null);
    assert.equal(advancedAgain.ok, true, `원래 다음 단계로 진행 실패: ${JSON.stringify(advancedAgain)}`);
    if (!advancedAgain.ok) return;
    assert.equal(advancedAgain.currentWorkflowStepKey, "kyosan_contact_report_sent");

    // 되돌아오면 새 단계로 와야 한다(원래 단계를 건너뛰면 안 된다).
    const returned = await transitionWorkflow(created.id, advancedAgain.version, "STEP_RETURNED", engineerId, null);
    assert.equal(returned.ok, true, JSON.stringify(returned));
    if (!returned.ok) return;
    assert.match(returned.currentWorkflowStepKey, /^case_step_\d+$/);

    // 새 단계에서 한 번 더 되돌리면 원래 현재 단계로 돌아간다.
    const returnedAgain = await transitionWorkflow(created.id, returned.version, "STEP_RETURNED", engineerId, null);
    assert.equal(returnedAgain.ok, true, JSON.stringify(returnedAgain));
    if (!returnedAgain.ok) return;
    assert.equal(returnedAgain.currentWorkflowStepKey, "intake_inspection");
  });

  test("두 번째 추가는 전용 버전을 새로 만들지 않고 같은 버전에 붙는다", async () => {
    const created = await createTestCase();
    const first = await addCaseWorkflowStep({
      repairCaseId: created.id,
      expectedVersion: 1,
      label: "첫 번째",
      status: "IN_REPAIR",
      category: "TECHNICAL",
      actorUserId: engineerId,
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const second = await addCaseWorkflowStep({
      repairCaseId: created.id,
      expectedVersion: first.version,
      label: "두 번째",
      status: "IN_REPAIR",
      category: "TECHNICAL",
      actorUserId: engineerId,
    });
    assert.equal(second.ok, true, JSON.stringify(second));
    if (!second.ok) return;
    assert.equal(second.createdCaseVersion, false, "이미 전용 버전을 쓰고 있으면 다시 복제하면 안 된다");
    assert.equal(second.versionId, first.versionId);

    const steps = await stepsOfVersion(first.versionId);
    const keys = steps.map((s) => s.key);
    assert.deepEqual(
      keys.filter((k) => k.startsWith("case_step_")),
      ["case_step_2", "case_step_1"],
      "둘 다 현재 단계 바로 뒤에 들어가므로 나중 것이 앞에 온다"
    );
  });

  test("담당이 아닌 엔지니어와 영업 담당자는 추가할 수 없다", async () => {
    const created = await createTestCase();

    const byOther = await addCaseWorkflowStep({
      repairCaseId: created.id,
      expectedVersion: 1,
      label: "남의 건",
      status: "IN_REPAIR",
      category: "TECHNICAL",
      actorUserId: otherEngineerId,
    });
    assert.equal(byOther.ok, false);
    if (!byOther.ok) assert.equal(byOther.code, "FORBIDDEN");

    const bySales = await addCaseWorkflowStep({
      repairCaseId: created.id,
      expectedVersion: 1,
      label: "영업",
      status: "IN_REPAIR",
      category: "BUSINESS",
      actorUserId: salesId,
    });
    assert.equal(bySales.ok, false);
    if (!bySales.ok) assert.equal(bySales.code, "FORBIDDEN");

    // 거부되었으면 전용 버전도 만들어지지 않아야 한다.
    const row = await fetchCase(created.id);
    const [version] = await db
      .select({ isCaseScoped: workflowVersions.isCaseScoped })
      .from(workflowVersions)
      .where(eq(workflowVersions.id, row.workflowVersionId));
    assert.equal(version.isCaseScoped, false);
    assert.equal(row.version, 1, "거부된 요청은 버전을 올리면 안 된다");
  });

  test("관리자는 담당이 아니어도 추가할 수 있다", async () => {
    const created = await createTestCase();
    const result = await addCaseWorkflowStep({
      repairCaseId: created.id,
      expectedVersion: 1,
      label: "관리자 추가",
      status: "IN_REPAIR",
      category: "TECHNICAL",
      actorUserId: adminId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  test("버전이 어긋나면 CONFLICT", async () => {
    const created = await createTestCase();
    const result = await addCaseWorkflowStep({
      repairCaseId: created.id,
      expectedVersion: 99,
      label: "충돌",
      status: "IN_REPAIR",
      category: "TECHNICAL",
      actorUserId: engineerId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CONFLICT");
  });

  test("잠긴(출하 완료) 건에는 추가할 수 없다", async () => {
    const created = await createTestCase();
    // 출하까지 정상 전이시키려면 승인 절차가 필요하다. 여기서 확인할 것은
    // 잠금 검사 하나뿐이므로 잠금 플래그만 직접 세운다.
    await db.update(repairCases).set({ isLocked: true }).where(eq(repairCases.id, created.id));

    const result = await addCaseWorkflowStep({
      repairCaseId: created.id,
      expectedVersion: 1,
      label: "잠김",
      status: "IN_REPAIR",
      category: "TECHNICAL",
      actorUserId: engineerId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CASE_LOCKED");

    await db.update(repairCases).set({ isLocked: false }).where(eq(repairCases.id, created.id));
  });

  test("건 전용 버전은 워크플로 관리 화면의 버전 목록에 나오지 않는다", async () => {
    const created = await createTestCase();
    const added = await addCaseWorkflowStep({
      repairCaseId: created.id,
      expectedVersion: 1,
      label: "목록 제외 확인",
      status: "IN_REPAIR",
      category: "TECHNICAL",
      actorUserId: engineerId,
    });
    assert.equal(added.ok, true);
    if (!added.ok) return;

    const [template] = await db
      .select({ code: workflowTemplates.code })
      .from(workflowTemplates)
      .innerJoin(workflowVersions, eq(workflowVersions.workflowTemplateId, workflowTemplates.id))
      .where(eq(workflowVersions.id, added.versionId));

    const detail = await getWorkflowTemplateDetail(template.code);
    assert.ok(detail);
    assert.equal(
      detail!.versions.some((v) => v.id === added.versionId),
      false,
      "템플릿 관리 화면은 템플릿 버전만 보여야 한다"
    );
    assert.ok(detail!.caseScopedVersionCount > 0, "제외한 만큼은 수로 알려 줘야 한다");
  });
});
