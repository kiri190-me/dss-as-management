import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  customers,
  products,
  repairCaseApprovals,
  repairCaseIntakeSequences,
  repairCases,
  representativeChangeHistory,
  shipmentApprovalDelegations,
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
  deciderId: string | null
) {
  await db.insert(repairCaseApprovals).values({
    repairCaseId,
    approvalType,
    status,
    requestedByUserId: engineerId,
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
