import "../../../../scripts/load-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  customers,
  products,
  repairCaseApprovals,
  repairCaseIntakeSequences,
  repairCases,
  representativeChangeHistory,
  shipmentApprovalDelegations,
  shipmentApprovalRouteSteps,
  shipmentApprovalRoutes,
  users,
  workflowTransitions,
} from "../schema";
import { createRepairCase } from "../mutations/repair-cases";
import { createShipmentDelegation } from "../mutations/shipment-delegations";
import { setShipmentRepresentative } from "../mutations/shipment-representatives";
import {
  countRepairCasesPendingMyApproval,
  listRepairCasesPendingMyApproval,
} from "./repair-case-approvals-pending";
import type { RepairCaseApprovalType } from "@/lib/validation/repair-case-approval-input";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * listRepairCasesPendingMyApproval / countRepairCasesPendingMyApproval —
 * "내게 온 결재 요청"이 파생 계산이라는 것을 실제 DB에서 확인한다.
 *
 * 확인하는 것은 세 축이다: (1) 그 종류의 결재 요청이 들어와 아직 결정되지
 * 않았는가 — 요청조차 없음(NOT_REQUESTED)·승인(APPROVED)·반려(REJECTED)·
 * version 불일치(STALE)는 모두 빠진다, (2) 이 사용자가 그 종류를 결재할 수
 * 있는가(위임 포함), (3) 휴지통·출하 완료 잠김·유무상 미확정 건은 빠지는가.
 *
 * **워크플로 단계는 축이 아니다.** 요청이 들어와 있으면 그 건이 어느 단계에
 * 서 있든 나온다 — 실제 결재를 처리하는 decideRepairCaseApproval도 단계를
 * 보지 않기 때문이다. 예전에는 조회만 단계를 함께 요구했고, 그래서 승인이
 * 걸린 전이가 없는 단계(인수점검·출하 대기)에서 들어온 진짜 요청이 결재자
 * 알림에서 통째로 사라졌다. 그 회귀를 "단계와 무관하게 나온다" 테스트들이
 * 막는다.
 *
 * (1)이 좁혀져 있으므로, "**다른 이유로** 빠진다"를 보이려는 테스트는 대상
 * 건에 반드시 REQUESTED 기록을 넣어 둔다. 넣지 않으면 그 "다른 이유"와 상관
 * 없이 어차피 빠져서, 검사를 통째로 지워도 초록색인 테스트가 된다 — 각 테스트
 * 안의 "대조가 성립한다" 단언이 그 함정에 빠지지 않았다는 증거다.
 *
 * 격리 규약은 이 디렉터리의 다른 통합 테스트와 같다 — 접수 월 "9705"(다른
 * 어떤 스위트도 쓰지 않는 달), 제품 모델 접두사 "PENDAPPR-TEST-", 사용자
 * 이메일 접두사 "pending-approval-test-". after()가 이 스위트가 만든 행만
 * FK 순서대로 지우며, 미리 있던 접수 건·시드 데이터는 건드리지 않는다.
 */

const TEST_RECEIVED_AT = "2097-05-10";
const TEST_SHIPMENT_DATE = "2097-05-20";
const TEST_MODEL_PREFIX = "PENDAPPR-TEST-";
const TEST_YEAR_MONTH = "9705";
const TEST_EMAIL_PREFIX = "pending-approval-test-";

let customerId: string;
let engineerId: string;
let superAdminId: string;
const createdTestUserIds: string[] = [];
const createdCaseIds: string[] = [];

async function createTestUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const [row] = await db
    .insert(users)
    .values({
      email: `${TEST_EMAIL_PREFIX}${randomUUID().slice(0, 8)}@example.test`,
      name: "Pending Approval Test User",
      role: "AS_ENGINEER",
      approvalStatus: "APPROVED",
      isActive: true,
      ...overrides,
    })
    .returning({ id: users.id });
  createdTestUserIds.push(row.id);
  return row.id;
}

async function createTestRepresentative() {
  const id = await createTestUser();
  const result = await setShipmentRepresentative(id, true, superAdminId, null, false);
  assert.equal(result.ok, true, `setup: failed to flag test representative: ${JSON.stringify(result)}`);
  return id;
}

function hoursFromNow(h: number): Date {
  return new Date(Date.now() + h * 60 * 60 * 1000);
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

async function createTestCase(): Promise<string> {
  const created = await createRepairCase(baseCreateInput());
  assert.equal(created.ok, true, `setup create failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  createdCaseIds.push(created.id);
  return created.id;
}

async function getCase(repairCaseId: string) {
  const [row] = await db
    .select({
      workflowVersionId: repairCases.workflowVersionId,
      currentWorkflowStepId: repairCases.currentWorkflowStepId,
      version: repairCases.version,
    })
    .from(repairCases)
    .where(eq(repairCases.id, repairCaseId));
  return row;
}

/**
 * 이 건을 **그 결재를 요구하는 단계**에 세운다. 단계 key를 코드에 박지 않고
 * 전이표에서 찾는 이유는, 판정 근거가 단계 이름이 아니라 전이의
 * required_approval_type이기 때문이다(조회 함수가 보는 것과 같은 값).
 */
async function setStepRequiringApproval(repairCaseId: string, approvalType: RepairCaseApprovalType) {
  const current = await getCase(repairCaseId);
  const [transition] = await db
    .select({ fromStepId: workflowTransitions.fromStepId })
    .from(workflowTransitions)
    .where(
      and(
        eq(workflowTransitions.workflowVersionId, current.workflowVersionId),
        eq(workflowTransitions.requiredApprovalType, approvalType)
      )
    )
    .limit(1);
  assert.ok(transition, `expected an approval-gated (${approvalType}) transition in this workflow version`);
  await db
    .update(repairCases)
    .set({ currentWorkflowStepId: transition.fromStepId })
    .where(eq(repairCases.id, repairCaseId));
}

async function insertApproval(
  repairCaseId: string,
  approvalType: RepairCaseApprovalType,
  status: "REQUESTED" | "APPROVED" | "REJECTED",
  versionAtRequest: number,
  deciderId: string | null,
  /** 지정 승인자. 기본값 null 이 「지정 없음」이고, 기존 시험들은 전부 이쪽이다. */
  assignedApproverUserId: string | null = null,
  /**
   * 결재선 두 칸. 기본값 null 이 「결재선을 타지 않는다」이고, 기존 시험들은
   * 전부 이쪽이다 — 그 경로가 한 톨도 바뀌지 않았음을 그대로 지킨다.
   */
  route: { routeId: string; routeStepOrder: number } | null = null
) {
  await db.insert(repairCaseApprovals).values({
    repairCaseId,
    approvalType,
    status,
    requestedByUserId: engineerId,
    assignedApproverUserId,
    routeId: route?.routeId ?? null,
    routeStepOrder: route?.routeStepOrder ?? null,
    repairCaseVersionAtRequest: versionAtRequest,
    ...(status === "REQUESTED"
      ? {}
      : {
          decidedByUserId: deciderId,
          decidedAt: new Date(),
          decisionReason: status === "REJECTED" ? "테스트 반려 사유" : null,
        }),
  });
}

/**
 * ⚠️ **이 시험 파일이 만든 결재선 판은 afterEach 로 반드시 걷는다.** 시험 DB 에
 * 판이 남으면 뒤에 도는 다른 시험 파일이 갑자기 결재선을 타면서 깨진다
 * (shipment-approval-routes / repair-case-approvals-route 의 before() 는 판이
 * 하나도 없는 상태를 전제로 한다). 아래 두 배열이 그 청소의 유일한 근거다.
 */
const createdRouteIds: string[] = [];
const routeTestCaseIds: string[] = [];

/**
 * 결재선 판 하나를 **직접 넣는다.** saveShipmentApprovalRoute 를 거치지 않는
 * 이유는 그 mutation 이 감사 기록을 남기는데, 그 행위자로 쓸 수 있는 것이 이
 * 파일이 만들지 않은 시드 최고관리자뿐이라 청소할 때 남의 감사 기록까지 지우게
 * 되기 때문이다. 이 시험이 보려는 것은 판을 **저장하는 절차**가 아니라
 * 「판을 탄 요청이 누구에게 보이는가」다(저장 절차는
 * mutations/shipment-approval-routes.integration.test.ts 가 본다).
 */
async function createTestRoute(approverUserIds: string[]): Promise<string> {
  // 판 번호는 **그 용도 안에서** 센다 — 표 전체의 일련번호가 아니다.
  const [latest] = await db
    .select({ version: shipmentApprovalRoutes.version })
    .from(shipmentApprovalRoutes)
    .where(eq(shipmentApprovalRoutes.scope, "FINAL_SHIPMENT"))
    .orderBy(desc(shipmentApprovalRoutes.version))
    .limit(1);
  const [route] = await db
    .insert(shipmentApprovalRoutes)
    .values({
      scope: "FINAL_SHIPMENT",
      version: (latest?.version ?? 0) + 1,
      createdByUserId: superAdminId,
    })
    .returning({ id: shipmentApprovalRoutes.id });
  createdRouteIds.push(route.id);

  if (approverUserIds.length > 0) {
    await db.insert(shipmentApprovalRouteSteps).values(
      approverUserIds.map((approverUserId, index) => ({
        routeId: route.id,
        stepOrder: index + 1,
        approverUserId,
      }))
    );
  }
  return route.id;
}

/** 결재선을 타는 접수 건 하나 — 청소 대상으로 함께 적어 둔다. */
async function createRouteTestCase(): Promise<string> {
  const caseId = await createTestCase();
  routeTestCaseIds.push(caseId);
  return caseId;
}

async function idsFor(actorId: string): Promise<string[]> {
  return (await listRepairCasesPendingMyApproval(actorId)).map((item) => item.repairCaseId);
}

before(async () => {
  const [customer] = await db.select({ id: customers.id }).from(customers).where(eq(customers.isDeleted, false)).limit(1);
  assert.ok(customer, "expected at least one non-deleted customer in the test DB");
  customerId = customer.id;

  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(engineer, "expected an approved AS_ENGINEER in the test DB");
  engineerId = engineer.id;

  const [superAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(superAdmin, "expected an approved SUPER_ADMIN in the test DB");
  superAdminId = superAdmin.id;
});

afterEach(async () => {
  // ⚠️ 판을 만든 시험 뒤에만 움직인다 — 다른 시험이 쌓아 둔 결재 행을 건드리지
  // 않기 위해서다. 삭제 순서가 있다: 결재 행이 판을 RESTRICT 로 참조한다.
  if (createdRouteIds.length === 0) return;
  if (routeTestCaseIds.length > 0) {
    await db.delete(repairCaseApprovals).where(inArray(repairCaseApprovals.repairCaseId, routeTestCaseIds));
  }
  await db.delete(shipmentApprovalRouteSteps).where(inArray(shipmentApprovalRouteSteps.routeId, createdRouteIds));
  await db.delete(shipmentApprovalRoutes).where(inArray(shipmentApprovalRoutes.id, createdRouteIds));
  createdRouteIds.length = 0;
  routeTestCaseIds.length = 0;
});

after(async () => {
  for (const caseId of createdCaseIds) {
    await db.delete(repairCaseApprovals).where(eq(repairCaseApprovals.repairCaseId, caseId));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));

  for (const id of createdTestUserIds) {
    await db.delete(shipmentApprovalDelegations).where(eq(shipmentApprovalDelegations.representativeUserId, id));
    await db.delete(shipmentApprovalDelegations).where(eq(shipmentApprovalDelegations.delegateUserId, id));
    await db.delete(representativeChangeHistory).where(eq(representativeChangeHistory.targetUserId, id));
    await db.delete(representativeChangeHistory).where(eq(representativeChangeHistory.changedByUserId, id));
  }
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%`));

  await pgClient.end({ timeout: 5 });
});

describe("listRepairCasesPendingMyApproval: 결정되지 않은 결재 요청 (워크플로 단계와 무관)", () => {
  test("1. 결재 필요 단계 + 결재 요청이 들어옴 + 결재 권한 있음 → 목록에 나온다", async () => {
    const caseId = await createTestCase();
    await setStepRequiringApproval(caseId, "REPAIR_INSPECTION");
    const current = await getCase(caseId);
    await insertApproval(caseId, "REPAIR_INSPECTION", "REQUESTED", current.version, null);

    const items = await listRepairCasesPendingMyApproval(engineerId);
    const item = items.find((row) => row.repairCaseId === caseId);
    assert.ok(item, "결재를 요구하는 단계 + 아직 결정되지 않은 요청이면 내게 온 결재 요청이다");
    assert.equal(item!.approvalType, "REPAIR_INSPECTION");
    assert.equal(item!.state, "PENDING");
  });

  test("결재 요청이 아직 없으면(NOT_REQUESTED) 나오지 않는다 — 다음 차례는 엔지니어의 요청이다", async () => {
    const caseId = await createTestCase();
    await setStepRequiringApproval(caseId, "REPAIR_INSPECTION");

    assert.equal((await idsFor(engineerId)).includes(caseId), false, "요청이 없으면 결재자가 지금 할 일이 없다");

    // 대조 — 요청만 들어오면 같은 건이 그대로 잡힌다(빠진 이유가 요청 부재였다).
    const current = await getCase(caseId);
    await insertApproval(caseId, "REPAIR_INSPECTION", "REQUESTED", current.version, null);
    assert.ok((await idsFor(engineerId)).includes(caseId), "요청이 들어오면 잡힌다 — 대조가 성립한다");
  });

  test("결재를 요구하지 않는 단계(접수 직후)에 서 있어도 요청이 들어오면 나온다 — 단계는 결과를 바꾸지 않는다", async () => {
    const caseId = await createTestCase();
    // 접수 직후 단계에는 승인이 걸린 전이가 하나도 없다. 그래도 요청이
    // 들어와 있으면 결재자가 지금 눌러서 처리할 수 있는 건이다 —
    // decideRepairCaseApproval도 단계를 보지 않는다.
    const current = await getCase(caseId);
    await insertApproval(caseId, "REPAIR_INSPECTION", "REQUESTED", current.version, null);

    assert.ok((await idsFor(engineerId)).includes(caseId), "요청이 들어와 있으면 단계와 무관하게 나온다");

    // 대조 — 그 결재를 요구하는 단계로 옮겨도 결과가 달라지지 않는다.
    await setStepRequiringApproval(caseId, "REPAIR_INSPECTION");
    assert.ok((await idsFor(engineerId)).includes(caseId), "단계를 옮겨도 여전히 나온다 — 단계가 결과를 바꾸지 않는다");
  });

  test("승인이 걸린 전이가 하나도 없는 단계 + 검수 승인 요청 → 목록·건수 양쪽에 잡힌다 (사용자 신고 재현)", async () => {
    // 실제로 터진 상황: 엔지니어가 "인수점검"·"출하 대기"처럼 검수 승인이
    // 앞을 막지 않는 단계에서 검수 승인을 요청했는데(요청 버튼은 결재 상태만
    // 본다), 조회만 단계를 함께 요구해서 결재자 알림에 전혀 뜨지 않았다.
    const countBefore = await countRepairCasesPendingMyApproval(engineerId);
    const caseId = await createTestCase(); // 접수 직후 = 승인이 걸린 전이가 없는 단계
    const current = await getCase(caseId);
    await insertApproval(caseId, "REPAIR_INSPECTION", "REQUESTED", current.version, null);

    const item = (await listRepairCasesPendingMyApproval(engineerId)).find((row) => row.repairCaseId === caseId);
    assert.ok(item, "목록에 잡혀야 한다 — 지금 눌러서 승인·반려할 수 있는 진짜 요청이다");
    assert.equal(item!.approvalType, "REPAIR_INSPECTION");
    assert.equal(item!.state, "PENDING");
    assert.equal(
      await countRepairCasesPendingMyApproval(engineerId),
      countBefore + 1,
      "건수(배지·종 알림)에도 세어져야 한다"
    );
  });

  test("다른 종류의 결재가 걸린 단계에 서 있어도 요청한 종류가 잡힌다", async () => {
    // D260701처럼 출하 승인이 앞을 막는 단계에 서 있는 건에 검수 승인 요청이
    // 들어온 경우 — 잡히는 종류는 단계에 걸린 종류가 아니라 요청된 종류다.
    const caseId = await createTestCase();
    await setStepRequiringApproval(caseId, "FINAL_SHIPMENT");
    const current = await getCase(caseId);
    await insertApproval(caseId, "REPAIR_INSPECTION", "REQUESTED", current.version, null);

    const item = (await listRepairCasesPendingMyApproval(engineerId)).find((row) => row.repairCaseId === caseId);
    assert.ok(item, "단계에 걸린 종류가 아니라 요청이 들어온 종류로 잡힌다");
    assert.equal(item!.approvalType, "REPAIR_INSPECTION");
    assert.equal(item!.state, "PENDING");
  });

  test("다른 종류의 요청은 이 종류를 열지 않는다 — (건, 종류)별로 따로 본다", async () => {
    const caseId = await createTestCase();
    await setStepRequiringApproval(caseId, "REPAIR_INSPECTION");
    const current = await getCase(caseId);
    await insertApproval(caseId, "FINAL_SHIPMENT", "REQUESTED", current.version, null);

    assert.equal((await idsFor(engineerId)).includes(caseId), false, "검수 요청이 아니라 출하 요청이 들어와 있다");

    await insertApproval(caseId, "REPAIR_INSPECTION", "REQUESTED", current.version, null);
    assert.ok((await idsFor(engineerId)).includes(caseId), "같은 종류의 요청이 들어오면 잡힌다 — 대조가 성립한다");
  });
});

describe("listRepairCasesPendingMyApproval: 이미 결정됐거나 무효가 된 결재", () => {
  test("2. 결재 필요 단계 + 지금 version에 유효한 승인 있음 → 나오지 않는다", async () => {
    const caseId = await createTestCase();
    await setStepRequiringApproval(caseId, "REPAIR_INSPECTION");
    const current = await getCase(caseId);
    await insertApproval(caseId, "REPAIR_INSPECTION", "APPROVED", current.version, superAdminId);

    assert.equal((await idsFor(engineerId)).includes(caseId), false);
  });

  test("반려된 건(REJECTED)은 목록·건수 양쪽에서 빠진다 — 다음 차례는 엔지니어의 재요청이다", async () => {
    const caseId = await createTestCase();
    await setStepRequiringApproval(caseId, "REPAIR_INSPECTION");
    const current = await getCase(caseId);
    await insertApproval(caseId, "REPAIR_INSPECTION", "REQUESTED", current.version, null);
    assert.ok((await idsFor(engineerId)).includes(caseId), "반려 전에는 보여야 대조가 성립한다");
    const countBefore = await countRepairCasesPendingMyApproval(engineerId);

    // requested_at 기본값이 now()라 같은 밀리초에 두 행이 들어가면 순서가
    // 흔들린다 — 뒤 행을 명시적으로 나중으로 만든다.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await insertApproval(caseId, "REPAIR_INSPECTION", "REJECTED", current.version, superAdminId);

    assert.equal((await idsFor(engineerId)).includes(caseId), false, "목록에서 빠져야 한다");
    assert.equal(await countRepairCasesPendingMyApproval(engineerId), countBefore - 1, "건수에서도 빠져야 한다");
  });

  test("승인 이후 접수 건이 바뀐 건(STALE)도 빠진다 — 결재자가 아니라 요청자가 다시 움직여야 한다", async () => {
    const caseId = await createTestCase();
    await setStepRequiringApproval(caseId, "REPAIR_INSPECTION");
    const current = await getCase(caseId);
    await insertApproval(caseId, "REPAIR_INSPECTION", "APPROVED", current.version, superAdminId);
    await db.update(repairCases).set({ version: current.version + 1 }).where(eq(repairCases.id, caseId));

    assert.equal(
      (await idsFor(engineerId)).includes(caseId),
      false,
      "무효가 된 승인은 없는 것과 같지만, 그렇다고 결재자가 지금 누를 것이 생기지는 않는다"
    );

    // 대조 — 바뀐 version으로 다시 요청이 들어오면 그때 잡힌다.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await insertApproval(caseId, "REPAIR_INSPECTION", "REQUESTED", current.version + 1, null);
    const item = (await listRepairCasesPendingMyApproval(engineerId)).find((row) => row.repairCaseId === caseId);
    assert.ok(item, "재요청이 들어오면 잡힌다 — 대조가 성립한다");
    assert.equal(item!.state, "PENDING");
  });

  test("가장 최근 행만 본다 — 예전 승인이 남아 있어도 최신이 요청이면 잡힌다", async () => {
    const caseId = await createTestCase();
    await setStepRequiringApproval(caseId, "REPAIR_INSPECTION");
    const current = await getCase(caseId);
    await insertApproval(caseId, "REPAIR_INSPECTION", "APPROVED", current.version, superAdminId);
    // requested_at 기본값이 now()라 같은 밀리초에 두 행이 들어가면 순서가
    // 흔들린다 — 뒤 행을 명시적으로 나중으로 만든다.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await insertApproval(caseId, "REPAIR_INSPECTION", "REQUESTED", current.version, null);

    const item = (await listRepairCasesPendingMyApproval(engineerId)).find((row) => row.repairCaseId === caseId);
    assert.ok(item, "옛 결정 행이 아니라 최신 행으로 판정한다");
    assert.equal(item!.state, "PENDING");
  });
});

describe("listRepairCasesPendingMyApproval: 결재 권한", () => {
  test("3. 결재 필요 단계 + 요청도 들어왔지만 내가 그 종류를 결재할 수 없으면 나오지 않는다 (REPAIR_INSPECTION / 영업 담당자)", async () => {
    const salesUserId = await createTestUser({ role: "SALES" });
    const caseId = await createTestCase();
    await setStepRequiringApproval(caseId, "REPAIR_INSPECTION");
    const current = await getCase(caseId);
    await insertApproval(caseId, "REPAIR_INSPECTION", "REQUESTED", current.version, null);

    assert.ok((await idsFor(engineerId)).includes(caseId), "권한이 있는 사용자에게는 보여야 대조가 성립한다");
    assert.equal((await idsFor(salesUserId)).includes(caseId), false);
  });

  test("3b. FINAL_SHIPMENT는 대표(또는 위임받은 대리자)가 아니면 나오지 않는다 — 역할만으로는 열리지 않는다", async () => {
    const plainEngineerId = await createTestUser({ role: "AS_ENGINEER" });
    const representativeId = await createTestRepresentative();
    const caseId = await createTestCase();
    await setStepRequiringApproval(caseId, "FINAL_SHIPMENT");
    const current = await getCase(caseId);
    await insertApproval(caseId, "FINAL_SHIPMENT", "REQUESTED", current.version, null);

    assert.equal((await idsFor(plainEngineerId)).includes(caseId), false);
    const repItem = (await listRepairCasesPendingMyApproval(representativeId)).find((row) => row.repairCaseId === caseId);
    assert.ok(repItem, "대표에게는 같은 요청이 보여야 대조가 성립한다");
    assert.equal(repItem!.approvalType, "FINAL_SHIPMENT");
  });

  test("승인되지 않은 계정(approvalStatus PENDING)에게는 아무것도 보이지 않는다", async () => {
    const pendingUserId = await createTestUser({ role: "ADMIN", approvalStatus: "PENDING" });
    const caseId = await createTestCase();
    await setStepRequiringApproval(caseId, "REPAIR_INSPECTION");
    const current = await getCase(caseId);
    await insertApproval(caseId, "REPAIR_INSPECTION", "REQUESTED", current.version, null);

    assert.ok((await idsFor(engineerId)).includes(caseId), "승인된 계정에게는 같은 요청이 보인다 — 대조가 성립한다");
    assert.deepEqual(await idsFor(pendingUserId), []);
  });
});

describe("listRepairCasesPendingMyApproval: FINAL_SHIPMENT 위임", () => {
  test("4. 유효한 위임을 받은 사용자에게 위임받은 종류(FINAL_SHIPMENT)의 건이 나온다", async () => {
    const representativeId = await createTestRepresentative();
    const delegateId = await createTestUser({ role: "SALES" });
    const caseId = await createTestCase();
    await setStepRequiringApproval(caseId, "FINAL_SHIPMENT");
    const current = await getCase(caseId);
    await insertApproval(caseId, "FINAL_SHIPMENT", "REQUESTED", current.version, null);

    // 위임 전에는 보이지 않는다 — 대표에게는 보인다는 것이 대조다.
    assert.equal((await idsFor(delegateId)).includes(caseId), false);
    assert.ok((await idsFor(representativeId)).includes(caseId), "대표에게는 보여야 대조가 성립한다");

    const delegation = await createShipmentDelegation(
      representativeId,
      delegateId,
      hoursFromNow(-1),
      hoursFromNow(48),
      representativeId,
      null
    );
    assert.equal(delegation.ok, true, `setup delegation failed: ${JSON.stringify(delegation)}`);

    const item = (await listRepairCasesPendingMyApproval(delegateId)).find((row) => row.repairCaseId === caseId);
    assert.ok(item, "유효한 위임을 받았으면 위임받은 결재 건이 보여야 한다");
    assert.equal(item!.approvalType, "FINAL_SHIPMENT");
  });

  test("4b. 아직 시작하지 않은(예약) 위임으로는 보이지 않는다 — 결재 시점 판정과 같은 기준", async () => {
    const representativeId = await createTestRepresentative();
    const delegateId = await createTestUser({ role: "SALES" });
    const caseId = await createTestCase();
    await setStepRequiringApproval(caseId, "FINAL_SHIPMENT");
    const current = await getCase(caseId);
    await insertApproval(caseId, "FINAL_SHIPMENT", "REQUESTED", current.version, null);

    const delegation = await createShipmentDelegation(
      representativeId,
      delegateId,
      hoursFromNow(2),
      hoursFromNow(48),
      representativeId,
      null
    );
    assert.equal(delegation.ok, true);

    assert.ok((await idsFor(representativeId)).includes(caseId), "대표에게는 보여야 대조가 성립한다");
    assert.equal((await idsFor(delegateId)).includes(caseId), false);
  });

  test("4c. 위임을 받아도 REPAIR_INSPECTION은 열리지 않는다 — 위임은 FINAL_SHIPMENT 전용이다", async () => {
    const representativeId = await createTestRepresentative();
    const delegateId = await createTestUser({ role: "SALES" });
    const delegation = await createShipmentDelegation(
      representativeId,
      delegateId,
      hoursFromNow(-1),
      hoursFromNow(48),
      representativeId,
      null
    );
    assert.equal(delegation.ok, true);

    const caseId = await createTestCase();
    await setStepRequiringApproval(caseId, "REPAIR_INSPECTION");
    const current = await getCase(caseId);
    await insertApproval(caseId, "REPAIR_INSPECTION", "REQUESTED", current.version, null);

    assert.ok((await idsFor(engineerId)).includes(caseId), "검수를 결재할 수 있는 사용자에게는 보여야 대조가 성립한다");
    assert.equal((await idsFor(delegateId)).includes(caseId), false);
  });
});

/**
 * ============================================================================
 * 지정 승인자 — 알림 종·배지가 지정을 존중한다
 * ============================================================================
 * ⚠️ 이 축은 **실패가 조용하다.** 잘못 좁히면 처리해야 할 사람이 알림을 못
 * 받는데, 그 실패는 화면에 아무 표시도 남기지 않는다(그냥 목록에 안 뜬다).
 * 그래서 첫 시험이 「NULL 이면 지금과 똑같다」를 못 박고, 나머지가 좁히는
 * 방향을 확인한다.
 * ============================================================================
 */
describe("listRepairCasesPendingMyApproval: 지정 승인자", () => {
  test("🔴 지정이 없으면(NULL) 지금과 똑같이 자격 있는 사람 **모두**에게 보인다", async () => {
    const adminUserId = await createTestUser({ role: "ADMIN" });
    const engineerUserId = await createTestUser({ role: "AS_ENGINEER" });
    const caseId = await createTestCase();
    const current = await getCase(caseId);
    await insertApproval(caseId, "REPAIR_INSPECTION", "REQUESTED", current.version, null);

    for (const [label, actorId] of [
      ["관리자", adminUserId],
      ["A/S 엔지니어", engineerUserId],
      ["최고관리자", superAdminId],
      ["요청자 본인", engineerId],
    ] as const) {
      assert.ok(
        (await idsFor(actorId)).includes(caseId),
        `${label}에게 안 보인다 — 지정이 없으면 자격 있는 사람 모두에게 보여야 한다`
      );
    }
  });

  test("지정된 건은 그 사람에게 보인다", async () => {
    const assigneeId = await createTestUser({ role: "AS_ENGINEER" });
    const caseId = await createTestCase();
    const current = await getCase(caseId);
    await insertApproval(caseId, "REPAIR_INSPECTION", "REQUESTED", current.version, null, assigneeId);

    const item = (await listRepairCasesPendingMyApproval(assigneeId)).find((row) => row.repairCaseId === caseId);
    assert.ok(item, "지정된 사람에게 안 보이면 지정이 곧 실종이다");
    assert.equal(item!.approvalType, "REPAIR_INSPECTION");
    assert.equal(item!.state, "PENDING");
  });

  test("🔴 지정된 건은 다른 사람에게 안 보인다 — 자격이 있어도 마찬가지다", async () => {
    const assigneeId = await createTestUser({ role: "AS_ENGINEER" });
    const otherAdminId = await createTestUser({ role: "ADMIN" });
    const caseId = await createTestCase();
    const current = await getCase(caseId);

    // 대조 — 지정 없이 넣으면 이 관리자에게도 보인다.
    await insertApproval(caseId, "REPAIR_INSPECTION", "REQUESTED", current.version, null);
    assert.ok((await idsFor(otherAdminId)).includes(caseId), "지정 전에는 보여야 대조가 성립한다");

    // 같은 (건, 종류)의 더 새로운 행이 지정을 달고 들어온다. 부분 유니크
    // 인덱스가 REQUESTED 를 하나로 제한하므로 앞 행을 먼저 반려로 닫는다.
    await db
      .update(repairCaseApprovals)
      .set({ status: "REJECTED", decidedByUserId: superAdminId, decidedAt: new Date(), decisionReason: "테스트" })
      .where(and(eq(repairCaseApprovals.repairCaseId, caseId), eq(repairCaseApprovals.status, "REQUESTED")));
    await new Promise((resolve) => setTimeout(resolve, 10));
    await insertApproval(caseId, "REPAIR_INSPECTION", "REQUESTED", current.version, null, assigneeId);

    assert.equal((await idsFor(otherAdminId)).includes(caseId), false, "지정된 건이 엉뚱한 사람에게 뜬다");
    assert.ok((await idsFor(assigneeId)).includes(caseId), "지정된 사람에게는 계속 보여야 한다");
  });

  test("최고관리자에게는 지정이 남에게 되어 있어도 보인다", async () => {
    const assigneeId = await createTestUser({ role: "AS_ENGINEER" });
    const caseId = await createTestCase();
    const current = await getCase(caseId);
    await insertApproval(caseId, "REPAIR_INSPECTION", "REQUESTED", current.version, null, assigneeId);

    assert.ok(
      (await idsFor(superAdminId)).includes(caseId),
      "최고관리자가 못 보면 지정된 사람이 자리를 비웠을 때 아무도 처리할 수 없다"
    );
  });

  test("건수(배지·종 알림)도 같은 규칙을 본다", async () => {
    const assigneeId = await createTestUser({ role: "AS_ENGINEER" });
    const otherAdminId = await createTestUser({ role: "ADMIN" });
    const assigneeBefore = await countRepairCasesPendingMyApproval(assigneeId);
    const otherBefore = await countRepairCasesPendingMyApproval(otherAdminId);

    const caseId = await createTestCase();
    const current = await getCase(caseId);
    await insertApproval(caseId, "REPAIR_INSPECTION", "REQUESTED", current.version, null, assigneeId);

    assert.equal(await countRepairCasesPendingMyApproval(assigneeId), assigneeBefore + 1, "지정된 사람은 1 늘어난다");
    assert.equal(await countRepairCasesPendingMyApproval(otherAdminId), otherBefore, "다른 사람은 그대로다");
  });

  test("지정은 그 (건, 종류)에만 걸린다 — 같은 건의 다른 종류는 그대로 보인다", async () => {
    const assigneeId = await createTestUser({ role: "AS_ENGINEER" });
    const representativeId = await createTestRepresentative();
    const caseId = await createTestCase();
    const current = await getCase(caseId);
    await insertApproval(caseId, "REPAIR_INSPECTION", "REQUESTED", current.version, null, assigneeId);
    await insertApproval(caseId, "FINAL_SHIPMENT", "REQUESTED", current.version, null);

    // 대표는 검수도 결재할 수 있는 역할(A/S 엔지니어)이지만 검수 요청은 남에게
    // 지정돼 있다 — 그러니 이 건에서 대표에게 남는 것은 출하 하나뿐이어야 한다.
    const repItems = (await listRepairCasesPendingMyApproval(representativeId)).filter(
      (row) => row.repairCaseId === caseId
    );
    assert.equal(repItems.length, 1, `대표에게 남는 것은 출하 하나여야 한다: ${JSON.stringify(repItems)}`);
    assert.equal(repItems[0].approvalType, "FINAL_SHIPMENT", "검수 쪽 지정이 출하 쪽을 가리면 안 된다");
  });
});

/**
 * ============================================================================
 * 결재선(순차 출하 승인) — 절차가 「출하 대표」를 대신한다
 * ============================================================================
 * 최종 출하 승인 요청 행에 route_id 가 적혀 있으면 「누가 결재하는가」를 절차가
 * 정한다. 결재 mutation 이 이미 그렇게 판정하므로(그 인가는
 * mutations/repair-case-approvals-route.integration.test.ts 가 실제 DB 로 못
 * 박는다) 알림·배지도 같아야 한다 — 어긋나면 **처리해야 할 사람이 그냥 목록에서
 * 사라지고, 그 실패는 화면에 아무 표시도 남기지 않는다.**
 *
 * 그래서 여기서 지키는 것은 두 방향이다:
 *  - 넓히는 쪽: 단계 승인자는 대표가 아니어도(심지어 결재 자격이 없는 역할이어도)
 *    자기 차례의 건을 본다.
 *  - 🔴 좁히는 쪽: **결재선을 타지 않는 요청은 한 톨도 바뀌지 않는다.** 대표·
 *    위임에게 뜨고 그 밖에는 안 뜬다.
 * ============================================================================
 */
describe("listRepairCasesPendingMyApproval: 결재선(순차 출하 승인)", () => {
  test("🔴 1단계 승인자는 출하 대표가 아니어도 목록·배지에 뜬다", async () => {
    // 영업 담당자로 만든다 — 역할로는 어떤 결재도 할 수 없는 사람이다. 그래도
    // 결재선에는 올릴 수 있고(대표 지정과 마찬가지로 역할을 보지 않는다),
    // 그러면 자기 단계는 결재할 수 있어야 한다.
    const stepApproverId = await createTestUser({ role: "SALES" });
    const [stepApprover] = await db
      .select({ isShipmentRepresentative: users.isShipmentRepresentative })
      .from(users)
      .where(eq(users.id, stepApproverId));
    assert.equal(stepApprover.isShipmentRepresentative, false, "대조가 성립하지 않는다 — 대표가 아니어야 한다");
    const countBefore = await countRepairCasesPendingMyApproval(stepApproverId);

    const routeId = await createTestRoute([stepApproverId]);
    const caseId = await createRouteTestCase();
    const current = await getCase(caseId);
    await insertApproval(caseId, "FINAL_SHIPMENT", "REQUESTED", current.version, null, stepApproverId, {
      routeId,
      routeStepOrder: 1,
    });

    const item = (await listRepairCasesPendingMyApproval(stepApproverId)).find((row) => row.repairCaseId === caseId);
    assert.ok(item, "단계 승인자에게 안 보이면 결재선이 곧 실종이다 — 아무도 그 건을 처리하러 오지 않는다");
    assert.equal(item!.approvalType, "FINAL_SHIPMENT");
    assert.equal(item!.state, "PENDING");
    assert.equal(
      await countRepairCasesPendingMyApproval(stepApproverId),
      countBefore + 1,
      "건수(배지·종 알림)에도 세어져야 한다"
    );
  });

  test("🔴 그 차례가 아닌 출하 대표에게는 뜨지 않는다 — 절차가 대표를 대신한다", async () => {
    const stepApproverId = await createTestUser({ role: "SALES" });
    const representativeId = await createTestRepresentative();

    const routeId = await createTestRoute([stepApproverId]);
    const routedCaseId = await createRouteTestCase();
    const routedVersion = await getCase(routedCaseId);
    await insertApproval(
      routedCaseId,
      "FINAL_SHIPMENT",
      "REQUESTED",
      routedVersion.version,
      null,
      stepApproverId,
      { routeId, routeStepOrder: 1 }
    );

    // 대조 — 같은 대표가, 결재선을 타지 않는 다른 건은 그대로 본다. 이게 없으면
    // 「대표에게 아무것도 안 보이게 만들었다」와 구분되지 않는다.
    const plainCaseId = await createTestCase();
    const plainVersion = await getCase(plainCaseId);
    await insertApproval(plainCaseId, "FINAL_SHIPMENT", "REQUESTED", plainVersion.version, null);

    const repIds = await idsFor(representativeId);
    assert.ok(repIds.includes(plainCaseId), "대표에게는 결재선 없는 건이 보여야 대조가 성립한다");
    assert.equal(repIds.includes(routedCaseId), false, "대표가 남의 단계까지 넘겨받았다");
  });

  test("최고관리자에게는 뜬다 — 지정된 사람이 자리를 비워도 막히지 않는 비상구", async () => {
    const stepApproverId = await createTestUser({ role: "SALES" });
    const emergencySuperAdminId = await createTestUser({ role: "SUPER_ADMIN" });

    const routeId = await createTestRoute([stepApproverId]);
    const caseId = await createRouteTestCase();
    const current = await getCase(caseId);
    await insertApproval(caseId, "FINAL_SHIPMENT", "REQUESTED", current.version, null, stepApproverId, {
      routeId,
      routeStepOrder: 1,
    });

    const item = (await listRepairCasesPendingMyApproval(emergencySuperAdminId)).find(
      (row) => row.repairCaseId === caseId
    );
    assert.ok(item, "최고관리자가 못 보면 단계 승인자가 자리를 비웠을 때 아무도 처리할 수 없다");
    assert.equal(item!.approvalType, "FINAL_SHIPMENT");
  });

  test("🔴 결재선을 타지 않는 출하 요청은 지금 그대로다 — 대표에게 뜨고 그 밖에는 안 뜬다", async () => {
    // 이 시험이 이번 변경의 안전장치다. 조회 종류를 넓히면서 결재선 없는 행까지
    // 넓어지면, 대표 제도가 조용히 무력화된다(그리고 아무 표시도 남지 않는다).
    const stepApproverId = await createTestUser({ role: "SALES" });
    const plainEngineerId = await createTestUser({ role: "AS_ENGINEER" });
    const representativeId = await createTestRepresentative();
    // 이 사람은 실제로 어떤 판의 단계를 맡고 있다 — 그래도 결재선을 타지 않는
    // 요청까지 볼 수 있게 되면 안 된다.
    await createTestRoute([stepApproverId]);

    const caseId = await createRouteTestCase();
    const current = await getCase(caseId);
    await insertApproval(caseId, "FINAL_SHIPMENT", "REQUESTED", current.version, null);

    assert.ok((await idsFor(representativeId)).includes(caseId), "대표에게는 보여야 대조가 성립한다");
    assert.equal((await idsFor(stepApproverId)).includes(caseId), false, "결재선 단계 자격이 대표를 대신해 버렸다");
    assert.equal((await idsFor(plainEngineerId)).includes(caseId), false, "역할만으로 출하 결재가 열렸다");
  });

  test("🔴 판만 적히고 지정이 빈 행은 결재선으로 보지 않는다 — 대표·위임으로 되돌아간다", async () => {
    // 정상적으로는 생기지 않는 조합이다(요청 경로가 지정을 언제나 함께 채운다).
    // 만에 하나 그런 행이 있어도 **넓어지는 쪽이 아니라** 지금까지의 판정으로
    // 되돌아가야 한다 — 지정도 대표 검사도 없으면 아무나 결재하게 된다.
    const stepApproverId = await createTestUser({ role: "SALES" });
    const representativeId = await createTestRepresentative();

    const routeId = await createTestRoute([stepApproverId]);
    const caseId = await createRouteTestCase();
    const current = await getCase(caseId);
    await insertApproval(caseId, "FINAL_SHIPMENT", "REQUESTED", current.version, null, null, {
      routeId,
      routeStepOrder: 1,
    });

    assert.ok((await idsFor(representativeId)).includes(caseId), "대표·위임 판정으로 되돌아가지 않았다");
    assert.equal((await idsFor(stepApproverId)).includes(caseId), false, "지정이 빈 행이 아무에게나 열렸다");
  });

  test("🔴 비활성·잠긴 계정에는 뜨지 않는다 — 배지에 잡히는데 눌러도 막히면 배지를 믿지 않게 된다", async () => {
    const stepApproverId = await createTestUser({ role: "SALES" });
    const routeId = await createTestRoute([stepApproverId]);
    const caseId = await createRouteTestCase();
    const current = await getCase(caseId);
    await insertApproval(caseId, "FINAL_SHIPMENT", "REQUESTED", current.version, null, stepApproverId, {
      routeId,
      routeStepOrder: 1,
    });

    assert.ok((await idsFor(stepApproverId)).includes(caseId), "막기 전에는 보여야 대조가 성립한다");

    for (const [label, patch] of [
      ["비활성", { isActive: false }],
      ["잠김", { lockedAt: new Date() }],
    ] as const) {
      await db.update(users).set(patch).where(eq(users.id, stepApproverId));
      try {
        assert.equal(
          (await idsFor(stepApproverId)).includes(caseId),
          false,
          `${label} 계정에 뜬다 — 결재 mutation 은 그 둘을 결재선 경로에서도 막는다`
        );
        assert.equal(await countRepairCasesPendingMyApproval(stepApproverId), 0, `${label}: 건수에도 남아 있다`);
      } finally {
        await db.update(users).set({ isActive: true, lockedAt: null }).where(eq(users.id, stepApproverId));
      }
    }

    assert.ok((await idsFor(stepApproverId)).includes(caseId), "되돌리면 다시 보여야 한다 — 대조가 성립한다");
  });

  test("검수 승인은 결재선과 무관하다 — 판이 있어도 자격 있는 사람 모두에게 그대로 보인다", async () => {
    // 결재선은 최종 출하 승인만의 것이다(스키마 CHECK 도 그렇게 막는다).
    const stepApproverId = await createTestUser({ role: "SALES" });
    await createTestRoute([stepApproverId]);

    const adminUserId = await createTestUser({ role: "ADMIN" });
    const caseId = await createRouteTestCase();
    const current = await getCase(caseId);
    await insertApproval(caseId, "REPAIR_INSPECTION", "REQUESTED", current.version, null);

    for (const [label, actorId] of [
      ["관리자", adminUserId],
      ["A/S 엔지니어", engineerId],
      ["최고관리자", superAdminId],
    ] as const) {
      assert.ok((await idsFor(actorId)).includes(caseId), `${label}에게 안 보인다 — 검수 경로가 달라졌다`);
    }
    assert.equal((await idsFor(stepApproverId)).includes(caseId), false, "결재선 자격이 검수 승인까지 열었다");
  });

  test("배지 숫자와 목록이 어긋나지 않는다 — 결재선 건에서도", async () => {
    const stepApproverId = await createTestUser({ role: "SALES" });
    const routeId = await createTestRoute([stepApproverId]);

    for (let i = 0; i < 2; i += 1) {
      const caseId = await createRouteTestCase();
      const current = await getCase(caseId);
      await insertApproval(caseId, "FINAL_SHIPMENT", "REQUESTED", current.version, null, stepApproverId, {
        routeId,
        routeStepOrder: 1,
      });
    }

    const items = await listRepairCasesPendingMyApproval(stepApproverId);
    const distinctCases = new Set(items.map((item) => item.repairCaseId)).size;
    assert.ok(distinctCases >= 2, "비교할 대상이 있어야 한다");
    assert.equal(await countRepairCasesPendingMyApproval(stepApproverId), distinctCases);
  });

  test("승인된 단계는 목록에서 빠진다 — 다음 단계 행이 최신이 된다", async () => {
    // 사슬을 잇는 것은 결재 mutation 의 일이지만(그쪽 시험이 본다), 알림은
    // 언제나 **가장 최근 행**만 보고 그 행의 지정을 존중해야 한다.
    const firstId = await createTestUser({ role: "SALES" });
    const secondId = await createTestUser({ role: "SALES" });
    const routeId = await createTestRoute([firstId, secondId]);
    const caseId = await createRouteTestCase();
    const current = await getCase(caseId);

    await insertApproval(caseId, "FINAL_SHIPMENT", "APPROVED", current.version, firstId, firstId, {
      routeId,
      routeStepOrder: 1,
    });
    // requested_at 기본값이 now()라 같은 밀리초에 두 행이 들어가면 순서가
    // 흔들린다 — 뒤 행을 명시적으로 나중으로 만든다.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await insertApproval(caseId, "FINAL_SHIPMENT", "REQUESTED", current.version, null, secondId, {
      routeId,
      routeStepOrder: 2,
    });

    assert.ok((await idsFor(secondId)).includes(caseId), "2단계 승인자에게 넘어가지 않았다");
    assert.equal((await idsFor(firstId)).includes(caseId), false, "1단계 승인자에게 자기 몫이 끝난 건이 남아 있다");
  });
});

describe("listRepairCasesPendingMyApproval: 휴지통", () => {
  test("5. 소프트 삭제된 건은 제외된다", async () => {
    const caseId = await createTestCase();
    await setStepRequiringApproval(caseId, "REPAIR_INSPECTION");
    const current = await getCase(caseId);
    await insertApproval(caseId, "REPAIR_INSPECTION", "REQUESTED", current.version, null);
    assert.ok((await idsFor(engineerId)).includes(caseId), "삭제 전에는 보여야 대조가 성립한다");

    await db
      .update(repairCases)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: superAdminId, deleteReason: "테스트 삭제" })
      .where(eq(repairCases.id, caseId));

    assert.equal((await idsFor(engineerId)).includes(caseId), false);
  });

  test("출하 완료로 잠긴 건은 제외된다 — 결재를 받아도 진행할 수 있는 전이가 없다", async () => {
    const caseId = await createTestCase();
    await setStepRequiringApproval(caseId, "FINAL_SHIPMENT");
    const current = await getCase(caseId);
    await insertApproval(caseId, "FINAL_SHIPMENT", "REQUESTED", current.version, null);
    const representativeId = await createTestRepresentative();
    assert.ok((await idsFor(representativeId)).includes(caseId), "잠그기 전에는 보여야 대조가 성립한다");

    await db.update(repairCases).set({ isLocked: true }).where(eq(repairCases.id, caseId));
    assert.equal((await idsFor(representativeId)).includes(caseId), false);
  });
});

describe("listRepairCasesPendingMyApproval: 유·무상 미확정", () => {
  test("6. PENDING_DECISION 건은 목록·건수 양쪽에서 빠진다", async () => {
    // 그 상태에서는 decideRepairCaseApproval이 BILLING_DECISION_REQUIRED로
    // 거절한다 — 배지에 잡히는데 눌러도 막히면 배지를 믿지 않게 된다.
    const caseId = await createTestCase();
    await setStepRequiringApproval(caseId, "REPAIR_INSPECTION");
    const current = await getCase(caseId);
    await insertApproval(caseId, "REPAIR_INSPECTION", "REQUESTED", current.version, null);
    assert.ok((await idsFor(engineerId)).includes(caseId), "확정 상태에서는 보여야 대조가 성립한다");
    const countBefore = await countRepairCasesPendingMyApproval(engineerId);

    await db.update(repairCases).set({ billingType: "PENDING_DECISION" }).where(eq(repairCases.id, caseId));

    assert.equal((await idsFor(engineerId)).includes(caseId), false, "목록에서 빠져야 한다");
    assert.equal(await countRepairCasesPendingMyApproval(engineerId), countBefore - 1, "건수에서도 빠져야 한다");
  });
});

describe("countRepairCasesPendingMyApproval", () => {
  test("결재할 게 하나도 없는 사용자는 0 — 배지를 그리지 않는 조건", async () => {
    const salesUserId = await createTestUser({ role: "SALES" });
    const caseId = await createTestCase();
    await setStepRequiringApproval(caseId, "REPAIR_INSPECTION");
    const current = await getCase(caseId);
    await insertApproval(caseId, "REPAIR_INSPECTION", "REQUESTED", current.version, null);

    assert.ok(
      (await countRepairCasesPendingMyApproval(engineerId)) > 0,
      "결재할 수 있는 사용자는 이 요청을 센다 — 대조가 성립한다"
    );
    assert.equal(await countRepairCasesPendingMyApproval(salesUserId), 0);
  });

  test("요청이 들어오지 않은 건은 건수에도 잡히지 않는다", async () => {
    const countBefore = await countRepairCasesPendingMyApproval(engineerId);
    const caseId = await createTestCase();
    await setStepRequiringApproval(caseId, "REPAIR_INSPECTION");

    assert.equal(await countRepairCasesPendingMyApproval(engineerId), countBefore, "요청이 없으면 건수가 늘지 않는다");

    const current = await getCase(caseId);
    await insertApproval(caseId, "REPAIR_INSPECTION", "REQUESTED", current.version, null);
    assert.equal(
      await countRepairCasesPendingMyApproval(engineerId),
      countBefore + 1,
      "요청이 들어오면 1 늘어난다 — 대조가 성립한다"
    );
  });

  test("건수는 목록의 서로 다른 접수 건 수와 같다", async () => {
    const representativeId = await createTestRepresentative();
    // 대표가 볼 것이 실제로 있는 상태에서 비교한다 — 0 === 0으로는 아무것도
    // 확인하지 못한다.
    for (let i = 0; i < 2; i += 1) {
      const caseId = await createTestCase();
      await setStepRequiringApproval(caseId, "FINAL_SHIPMENT");
      const current = await getCase(caseId);
      await insertApproval(caseId, "FINAL_SHIPMENT", "REQUESTED", current.version, null);
    }

    const items = await listRepairCasesPendingMyApproval(representativeId);
    const distinctCases = new Set(items.map((item) => item.repairCaseId)).size;
    assert.ok(distinctCases >= 2, "비교할 대상이 있어야 한다");
    assert.equal(await countRepairCasesPendingMyApproval(representativeId), distinctCases);
  });
});
