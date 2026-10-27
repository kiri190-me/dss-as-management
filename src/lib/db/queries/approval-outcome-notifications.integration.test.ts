import "../../../../scripts/load-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  auditLogs,
  customers,
  notificationAcknowledgements,
  products,
  repairCaseApprovals,
  repairCaseIntakeSequences,
  repairCases,
  shipmentApprovalRouteSteps,
  shipmentApprovalRoutes,
  users,
} from "../schema";
import { createRepairCase } from "../mutations/repair-cases";
import { decideRepairCaseApproval, requestRepairCaseApproval } from "../mutations/repair-case-approvals";
import { acknowledgeNotification } from "../mutations/notification-acknowledgements";
import { getCurrentApprovalsForCase } from "./repair-case-approvals";
import { isUndefinedTableError } from "./notification-acknowledgements";
import { listMyNotifications } from "./notifications";
import {
  listMyGrantedApprovalOutcomes,
  listMyRejectedApprovalOutcomes,
  type ApprovalOutcome,
} from "./approval-outcome-notifications";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";
import type { RepairCaseApprovalType } from "@/lib/validation/repair-case-approval-input";
import { ROLE_CODES, type Role } from "@/lib/domain/types";
import {
  APPROVAL_OUTCOME_NOTIFICATION_WINDOW_DAYS,
  buildApprovalGrantedNotification,
  buildApprovalRejectedNotification,
} from "@/lib/domain/notifications";

/**
 * ============================================================================
 * 내가 요청한 결재의 결과 — 실제 DB (시험 DB)
 * ============================================================================
 * listMyGrantedApprovalOutcomes · listMyRejectedApprovalOutcomes 와, 그것을 태운
 * 종 알림 「승인 완료」·「반려됨」(listMyNotifications)을 본다.
 *
 * 결재 사슬은 **진짜 mutation 으로** 만든다(requestRepairCaseApproval ·
 * decideRepairCaseApproval) — 「중간 단계 승인이면 다음 단계 행이 더 늦게 생긴다」는
 * 사슬의 모양이 이 조회의 「최종」 판정의 전제라서, 손으로 흉내 낸 행이 아니라 사슬
 * 잇는 코드가 실제로 만든 행으로 봐야 뜻이 있다. 결재선 판만 손으로 넣는다.
 *
 * 🔴 **부품 불출(PART_ISSUE) 갈래는 2026-10-27(조각 13-C3)에 여기서 빠졌다.** 옛 재고
 * 기능이 별도 시스템(dss-inventory)으로 옮겨 가면서 화면과 경로가 13-A 에서 사라졌고
 * (`/inventory` 는 404), 이 파일이 사슬을 잇는 데 쓰던
 * mutations/inventory-part-issue-requests.ts 의 decidePartIssueRequestApproval ·
 * cancelPartIssueRequest 가 13-C4 에서 지워진다. 사슬을 잇는 코드가 없으면 위에 적은
 * 「진짜 mutation 으로 만든다」가 성립하지 않아 **갈래째** 들어냈다 — 밑자락만 갈아
 * 끼우면 되는 repair-cases-purge/permanent-delete 쪽과 다른 점이다.
 * 🔵 **그래서 지금 비어 있는 자리**: queries/approval-outcome-notifications.ts 의
 * listPartIssueApprovalOutcomes 는 **살아 있는 코드인데 통합 시험이 없다.** 불출 결재
 * 행을 새로 만드는 길이 A/S 에 남지 않으므로 운영에서 새 결과가 생길 일은 없지만,
 * 그 조회를 고치면 여기서 걸리지 않는다. 13-C5(알림 3종 정리) 때 그 조회·
 * domain/notifications.ts 의 PART_ISSUE 갈래를 **어떻게 할지 함께 정해야 한다.**
 *
 * 이 파일이 못 박는 것:
 *  1. 🔴 **요청자에게만** 간다 — 결정자·다음 단계 승인자·다른 요청자에게는 없다.
 *  2. 🔴 **중간 단계 승인은 안 잡히고 마지막 단계 승인만** 잡힌다(검수·출하).
 *  3. 반려는 **어느 단계에서든** 잡힌다.
 *  4. 🔴 **결정자가 요청자 본인이면** 안 잡힌다 — 스스로 승인한 검수, 최고관리자가
 *     자기 요청을 스스로 반려.
 *  6. **7일 창** — 결정 시각으로 잰다.
 *  7. 휴지통에 간 접수 건·영구 삭제된 접수 건(repair_case_id NULL)의 결재는 안 잡힌다.
 *  8. 🔴 「최신 행」 판정이 getCurrentApprovalsForCase 와 같은 말이다.
 *  9. 🔴 레지스트리: 확인한 키는 빠지고, 남의 확인은 영향이 없다. 역할로 거르지 않는다.
 * 10. 표가 없을 때의 오류(42P01)를 Drizzle 이 감싼 모양 그대로 알아본다.
 * (5번은 불출 전용이라 함께 빠졌다. 번호는 시험 이름과 맞추려고 **다시 매기지 않는다.**)
 *
 * 격리·청소 규약은 mutations/repair-case-approvals-route.integration.test.ts 를 본떴다.
 * 이 파일이 만든 "apoutcome-test-" 계정과 "D9711" 접수 건만 쓴다(접수월 9711 은 다른
 * 시험이 쓰지 않는다 — 청소가 인수번호 접두사로 이뤄지므로 겹치면 서로의 행을 지운다).
 * ⚠️ **결재 행·결재선 판은 afterEach 로 반드시 걷는다** — 시험 DB 에 판이 남으면 다른
 * 시험 파일이 갑자기 결재선을 타면서 깨진다. 사람 참조가 RESTRICT 라 삭제에는 순서가
 * 있다: 결재 행 → 결재선 판(단계 CASCADE) → 확인 기록 → 감사 기록 →
 * (after) 접수 건·제품·접수 번호표 → 사람.
 * ============================================================================
 */

const TEST_EMAIL_PREFIX = "apoutcome-test-";
const TEST_MODEL_PREFIX = "APOUTCOME-TEST-";
const TEST_YEAR_MONTH = "9711";
const TEST_INTAKE_PREFIX = `D${TEST_YEAR_MONTH}%`;
const TEST_RECEIVED_AT = "2097-11-10";
const TEST_SHIPMENT_DATE = "2097-11-20";

const DAY_MS = 24 * 60 * 60 * 1000;

let customerId: string;
let requesterId: string; // 결재를 올리는 사람 (AS_ENGINEER)
let otherRequesterId: string; // 다른 요청자 — 내 결과가 여기 새면 안 된다
let inspectorId: string; // 검수 결재자 (AS_ENGINEER)
let stepAId: string; // 결재선 1단계
let stepBId: string; // 결재선 2단계
let superAdminId: string; // 판을 만드는 사람 + 비상구

const testUserIds: string[] = [];
const userNames = new Map<string, string>();
let routeVersionCounter = 0;

async function createTestUser(name: string, overrides: Partial<typeof users.$inferInsert> = {}): Promise<string> {
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
  testUserIds.push(row.id);
  userNames.set(row.id, name);
  return row.id;
}

function baseCreateInput(): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
    customerId,
    endUserId: null,
    // 담당 엔지니어를 비워 둔다 — 접수 건이 이 파일의 사람을 붙잡지 않아야 청소
    // 순서가 사람 쪽으로 번지지 않는다.
    assignedEngineerId: null,
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

async function createTestCase(): Promise<{ id: string; intakeNumber: string }> {
  const created = await createRepairCase(baseCreateInput());
  assert.equal(created.ok, true, `setup case failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  const [row] = await db
    .select({ intakeNumber: repairCases.intakeNumber })
    .from(repairCases)
    .where(eq(repairCases.id, created.id));
  assert.ok(row.intakeNumber.startsWith(`D${TEST_YEAR_MONTH}`), `접수월이 어긋났다: ${row.intakeNumber}`);
  return { id: created.id, intakeNumber: row.intakeNumber };
}

/**
 * 결재선 판 하나. 판을 넣으면 그 용도의 「현재 판」이 된다(이 시험은 판이 없는 상태에서
 * 시작한다). 🔵 받는 용도가 "FINAL_SHIPMENT" 하나인 것은 13-C3 에서 불출 갈래가 빠졌기
 * 때문이다 — DB enum 의 "PART_ISSUE" 자체는 **영구 유지**다(과거 결재 기록이 쓴다).
 */
async function insertRoute(scope: "FINAL_SHIPMENT", approverUserIds: readonly string[]): Promise<string> {
  routeVersionCounter += 1;
  const [route] = await db
    .insert(shipmentApprovalRoutes)
    .values({ scope, version: routeVersionCounter, createdByUserId: superAdminId })
    .returning({ id: shipmentApprovalRoutes.id });
  await db.insert(shipmentApprovalRouteSteps).values(
    approverUserIds.map((approverUserId, index) => ({ routeId: route.id, stepOrder: index + 1, approverUserId }))
  );
  return route.id;
}

/** 그 (접수 건, 종류)의 가장 최근 행 id — getCurrentApprovalsForCase 가 고르는 그 행. */
async function currentApprovalId(repairCaseId: string, approvalType: RepairCaseApprovalType): Promise<string> {
  const current = await getCurrentApprovalsForCase(repairCaseId);
  const latest = current.find((state) => state.approvalType === approvalType)?.latest;
  assert.ok(latest, `${approvalType} 행이 없다`);
  return latest.id;
}

async function requestCaseApproval(
  repairCaseId: string,
  approvalType: RepairCaseApprovalType,
  actorUserId: string
): Promise<string> {
  const result = await requestRepairCaseApproval(repairCaseId, approvalType, actorUserId, null);
  assert.equal(result.ok, true, `요청이 막혔다: ${JSON.stringify(result)}`);
  return currentApprovalId(repairCaseId, approvalType);
}

async function decideCaseApproval(
  repairCaseId: string,
  approvalType: RepairCaseApprovalType,
  decision: "APPROVED" | "REJECTED",
  actorUserId: string,
  reason: string | null = decision === "REJECTED" ? "시험 반려 사유" : null
): Promise<void> {
  const result = await decideRepairCaseApproval(repairCaseId, approvalType, decision, actorUserId, reason);
  assert.equal(result.ok, true, `결정이 막혔다: ${JSON.stringify(result)}`);
}

/** 요청자가 검수를 올리고 검수 결재자가 승인한 접수 건 — 출하 승인을 요청할 수 있다. */
async function createInspectedCase(): Promise<{ id: string; intakeNumber: string; inspectionId: string }> {
  const repairCase = await createTestCase();
  const inspectionId = await requestCaseApproval(repairCase.id, "REPAIR_INSPECTION", requesterId);
  await decideCaseApproval(repairCase.id, "REPAIR_INSPECTION", "APPROVED", inspectorId);
  return { ...repairCase, inspectionId };
}

const grantedIds = async (userId: string, now?: Date) =>
  (await listMyGrantedApprovalOutcomes(userId, now ? { now } : {})).map((outcome) => outcome.approvalId);
const rejectedIds = async (userId: string, now?: Date) =>
  (await listMyRejectedApprovalOutcomes(userId, now ? { now } : {})).map((outcome) => outcome.approvalId);

/** 이 사람의 종에 뜬 결재 결과 알림의 id(= 확인 키). 다른 종류는 시드 자료에 흔들리므로 뺀다. */
async function outcomeNotificationIds(userId: string, role: Role): Promise<string[]> {
  const items = await listMyNotifications(userId, role);
  return items
    .filter((item) => item.kind === "APPROVAL_GRANTED" || item.kind === "APPROVAL_REJECTED")
    .map((item) => item.id);
}

/** 이 파일이 만든 결재 행·판·확인 기록·감사 기록을 걷는다. 접수 건·사람은 after() 가 지운다. */
async function removeOutcomeFixtures(): Promise<void> {
  if (testUserIds.length > 0) {
    // 결재 행은 판을 RESTRICT 로 참조한다 — 결재 행이 먼저다. 요청자로 고르므로 접수
    // 건이 NULL 이 된 행(시험 7)까지 걷힌다.
    await db.delete(repairCaseApprovals).where(inArray(repairCaseApprovals.requestedByUserId, testUserIds));
    // 판을 지우면 단계는 CASCADE 로 함께 사라진다.
    await db.delete(shipmentApprovalRoutes).where(inArray(shipmentApprovalRoutes.createdByUserId, testUserIds));
    await db.delete(notificationAcknowledgements).where(inArray(notificationAcknowledgements.userId, testUserIds));
    // audit_logs.actor_user_id → users (restrict): 행위자로만 고른다 —
    // target_record_id 로 고르는 모양은 test-cleanup-static-safety.test.ts 가 금지한다.
    await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, testUserIds));
  }
  routeVersionCounter = 0;
}

/** 이전 실행이 중간에 끊겨 남은 이 파일의 계정과 그 흔적까지 걷는다. */
async function removeTestFixturesByPrefix(): Promise<void> {
  const leftovers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  const ids = leftovers.map((row) => row.id);

  if (ids.length > 0) {
    // 🔵 13-C3 전에는 여기서 불출 신청·항목·결재 행·부품 요청까지 걷었다. 이 파일이
    //    그 행들을 더는 만들지 않으므로 함께 뺐다 — 만들지 않는 것을 걷는 코드는
    //    「이 파일이 그것도 만든다」는 거짓말이 된다.
    await db.delete(repairCaseApprovals).where(inArray(repairCaseApprovals.requestedByUserId, ids));
    await db.delete(shipmentApprovalRouteSteps).where(inArray(shipmentApprovalRouteSteps.approverUserId, ids));
    await db.delete(shipmentApprovalRoutes).where(inArray(shipmentApprovalRoutes.createdByUserId, ids));
    await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, ids));
  }

  await db.delete(repairCases).where(like(repairCases.intakeNumber, TEST_INTAKE_PREFIX));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));

  if (ids.length > 0) {
    // 확인 기록은 사람과 함께 CASCADE 로 사라진다.
    await db.delete(users).where(inArray(users.id, ids));
  }
}

before(async () => {
  await removeTestFixturesByPrefix();

  const [route] = await db.select({ id: shipmentApprovalRoutes.id }).from(shipmentApprovalRoutes).limit(1);
  assert.equal(route, undefined, "이 시험은 shipment_approval_routes 가 비어 있는 상태를 전제로 합니다");

  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.isDeleted, false))
    .limit(1);
  assert.ok(customer, "expected at least one non-deleted customer in the test DB");
  customerId = customer.id;

  requesterId = await createTestUser("결과시험 요청자");
  otherRequesterId = await createTestUser("결과시험 다른 요청자");
  inspectorId = await createTestUser("결과시험 검수 결재자");
  stepAId = await createTestUser("결과시험 1단계");
  stepBId = await createTestUser("결과시험 2단계");
  superAdminId = await createTestUser("결과시험 최고관리자", { role: "SUPER_ADMIN" });
});

afterEach(async () => {
  await removeOutcomeFixtures();
});

after(async () => {
  await removeOutcomeFixtures();
  await removeTestFixturesByPrefix();
  await pgClient.end({ timeout: 5 });
});

// ═══════════════════════════════════════════════ 접수 건 결재 — 검수 · 출하

describe("접수 건 결재 — 최종 승인과 반려", () => {
  test("🔴 2. 결재선 2단계 출하 — 1단계 승인은 안 잡히고 마지막 단계 승인만 잡힌다(검수 승인도 잡힌다)", async () => {
    await insertRoute("FINAL_SHIPMENT", [stepAId, stepBId]);
    const repairCase = await createInspectedCase();
    assert.deepEqual(await grantedIds(requesterId), [repairCase.inspectionId], "검수 승인 완료가 잡혀야 한다");

    const step1Id = await requestCaseApproval(repairCase.id, "FINAL_SHIPMENT", requesterId);
    await decideCaseApproval(repairCase.id, "FINAL_SHIPMENT", "APPROVED", stepAId);

    // 사슬이 실제로 이어졌다 — 1단계는 APPROVED 이고, 더 늦은 2단계 REQUESTED 가 있다.
    const step2Id = await currentApprovalId(repairCase.id, "FINAL_SHIPMENT");
    assert.notEqual(step2Id, step1Id, "다음 단계 행이 생기지 않았다");
    const [step1Row] = await db
      .select({ status: repairCaseApprovals.status })
      .from(repairCaseApprovals)
      .where(eq(repairCaseApprovals.id, step1Id));
    assert.equal(step1Row.status, "APPROVED");

    assert.deepEqual(await grantedIds(requesterId), [repairCase.inspectionId], "중간 단계 승인이 승인 완료로 잡혔다");

    await decideCaseApproval(repairCase.id, "FINAL_SHIPMENT", "APPROVED", stepBId);
    const granted = await listMyGrantedApprovalOutcomes(requesterId);
    assert.deepEqual(
      granted.map((outcome) => outcome.approvalId),
      [step2Id, repairCase.inspectionId],
      "마지막 단계 승인이 잡히고, 결정이 늦은 것부터 온다"
    );
    const [finalOutcome] = granted;
    assert.equal(finalOutcome.source, "REPAIR_CASE");
    if (finalOutcome.source === "REPAIR_CASE") {
      assert.equal(finalOutcome.approvalType, "FINAL_SHIPMENT");
      assert.equal(finalOutcome.intakeNumber, repairCase.intakeNumber);
      assert.equal(finalOutcome.repairCaseId, repairCase.id);
    }
    assert.equal(finalOutcome.decidedByName, userNames.get(stepBId), "결정자는 마지막 단계를 결재한 사람이다");
    assert.deepEqual(await rejectedIds(requesterId), []);
  });

  test("🔴 3. 반려는 어느 단계에서든 잡힌다 — 1단계 반려 · 2단계 반려", async () => {
    await insertRoute("FINAL_SHIPMENT", [stepAId, stepBId]);

    const rejectedAtStep1 = await createInspectedCase();
    const step1Id = await requestCaseApproval(rejectedAtStep1.id, "FINAL_SHIPMENT", requesterId);
    await decideCaseApproval(rejectedAtStep1.id, "FINAL_SHIPMENT", "REJECTED", stepAId, "1단계에서 사진 누락");

    const rejectedAtStep2 = await createInspectedCase();
    const firstOfSecond = await requestCaseApproval(rejectedAtStep2.id, "FINAL_SHIPMENT", requesterId);
    await decideCaseApproval(rejectedAtStep2.id, "FINAL_SHIPMENT", "APPROVED", stepAId);
    const step2Id = await currentApprovalId(rejectedAtStep2.id, "FINAL_SHIPMENT");
    await decideCaseApproval(rejectedAtStep2.id, "FINAL_SHIPMENT", "REJECTED", stepBId, "2단계에서 수량 확인 필요");

    const rejected = await listMyRejectedApprovalOutcomes(requesterId);
    assert.deepEqual(rejected.map((outcome) => outcome.approvalId), [step2Id, step1Id], "결정이 늦은 것부터");
    assert.equal(rejected[0].decisionReason, "2단계에서 수량 확인 필요");
    assert.equal(rejected[1].decisionReason, "1단계에서 사진 누락");

    const granted = await grantedIds(requesterId);
    assert.ok(!granted.includes(firstOfSecond), "반려로 끝난 사슬의 중간 승인이 승인 완료로 잡혔다");
    assert.deepEqual(
      [...granted].sort(),
      [rejectedAtStep1.inspectionId, rejectedAtStep2.inspectionId].sort(),
      "출하가 반려돼도 먼저 끝난 검수 승인은 그대로다"
    );
  });

  test("🔴 4. 결정자가 요청자 본인이면 안 잡힌다 — 스스로 승인한 검수 · 최고관리자가 자기 요청을 스스로 반려", async () => {
    const selfApproved = await createTestCase();
    const selfApprovedId = await requestCaseApproval(selfApproved.id, "REPAIR_INSPECTION", requesterId);
    await decideCaseApproval(selfApproved.id, "REPAIR_INSPECTION", "APPROVED", requesterId);

    const adminOwn = await createTestCase();
    const adminOwnId = await requestCaseApproval(adminOwn.id, "REPAIR_INSPECTION", superAdminId);
    await decideCaseApproval(adminOwn.id, "REPAIR_INSPECTION", "REJECTED", superAdminId, "스스로 거둠");

    // 대조 — 같은 요청자의 건을 남이 승인하면 잡힌다. 이것이 없으면 위의 「안 잡힘」이
    // 조회가 아예 비어서인지 가를 수 없다.
    const decidedByOther = await createInspectedCase();

    assert.ok(!(await grantedIds(requesterId)).includes(selfApprovedId), "스스로 승인한 검수가 잡혔다");
    assert.deepEqual(await grantedIds(requesterId), [decidedByOther.inspectionId]);
    assert.ok(!(await rejectedIds(superAdminId)).includes(adminOwnId), "스스로 반려한 요청이 잡혔다");
    assert.deepEqual(await rejectedIds(superAdminId), []);
  });

  test("🔴 1. 요청자에게만 간다 — 결정자·결재선 승인자·다른 요청자에게는 없다", async () => {
    await insertRoute("FINAL_SHIPMENT", [stepAId]);
    const repairCase = await createInspectedCase();
    await requestCaseApproval(repairCase.id, "FINAL_SHIPMENT", requesterId);
    await decideCaseApproval(repairCase.id, "FINAL_SHIPMENT", "APPROVED", stepAId);
    const rejectedCase = await createTestCase();
    await requestCaseApproval(rejectedCase.id, "REPAIR_INSPECTION", requesterId);
    await decideCaseApproval(rejectedCase.id, "REPAIR_INSPECTION", "REJECTED", inspectorId);

    assert.equal((await grantedIds(requesterId)).length, 2);
    assert.equal((await rejectedIds(requesterId)).length, 1);
    for (const someoneElse of [inspectorId, stepAId, otherRequesterId, superAdminId]) {
      assert.deepEqual(await grantedIds(someoneElse), [], `${userNames.get(someoneElse)} 에게 승인 완료가 샌다`);
      assert.deepEqual(await rejectedIds(someoneElse), [], `${userNames.get(someoneElse)} 에게 반려가 샌다`);
    }
  });

  test("6. 7일 창 — 결정 시각으로 재고, 창 밖은 확인하지 않아도 뜨지 않는다", async () => {
    const granted = await createInspectedCase();
    const rejectedCase = await createTestCase();
    const rejectedId = await requestCaseApproval(rejectedCase.id, "REPAIR_INSPECTION", requesterId);
    await decideCaseApproval(rejectedCase.id, "REPAIR_INSPECTION", "REJECTED", inspectorId);

    const now = Date.now();
    const justInside = new Date(now + (APPROVAL_OUTCOME_NOTIFICATION_WINDOW_DAYS * DAY_MS - 60_000));
    const justOutside = new Date(now + (APPROVAL_OUTCOME_NOTIFICATION_WINDOW_DAYS * DAY_MS + 60_000));
    assert.deepEqual(await grantedIds(requesterId, justInside), [granted.inspectionId], "창 끝 1분 전에는 보여야 한다");
    assert.deepEqual(await rejectedIds(requesterId, justInside), [rejectedId]);
    assert.deepEqual(await grantedIds(requesterId, justOutside), [], "창을 1분 넘기면 사라져야 한다");
    assert.deepEqual(await rejectedIds(requesterId, justOutside), []);

    // 요청이 오래됐어도 결정이 최근이면 창 안이다 — 창은 결정 시각으로 잰다.
    await db
      .update(repairCaseApprovals)
      .set({ requestedAt: new Date(now - 30 * DAY_MS) })
      .where(eq(repairCaseApprovals.id, granted.inspectionId));
    assert.deepEqual(await grantedIds(requesterId), [granted.inspectionId], "요청 시각으로 창을 쟀다");

    // 결정이 8일 전이면 지금 기준으로도 사라진다 — 종에서도.
    await db
      .update(repairCaseApprovals)
      .set({ decidedAt: new Date(now - 8 * DAY_MS) })
      .where(inArray(repairCaseApprovals.id, [granted.inspectionId, rejectedId]));
    assert.deepEqual(await grantedIds(requesterId), []);
    assert.deepEqual(await rejectedIds(requesterId), []);
    assert.deepEqual(await outcomeNotificationIds(requesterId, "AS_ENGINEER"), [], "창 밖의 결과가 종에 떴다");
  });

  test("7. 휴지통에 간 접수 건과 영구 삭제된 접수 건(repair_case_id NULL)의 결재는 안 잡힌다", async () => {
    const trashed = await createInspectedCase();
    const orphanCase = await createTestCase();
    const orphanId = await requestCaseApproval(orphanCase.id, "REPAIR_INSPECTION", requesterId);
    await decideCaseApproval(orphanCase.id, "REPAIR_INSPECTION", "REJECTED", inspectorId);
    assert.deepEqual(await grantedIds(requesterId), [trashed.inspectionId], "전제 — 삭제 전에는 잡힌다");
    assert.deepEqual(await rejectedIds(requesterId), [orphanId], "전제 — 삭제 전에는 잡힌다");

    await db
      .update(repairCases)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(repairCases.id, trashed.id));
    // 영구 삭제의 결과(ON DELETE SET NULL)를 흉내 낸다 — 접수 건 행 자체를 지우면 청소
    // 규약(접두사로 한 번에 걷는다)이 흔들린다.
    await db.update(repairCaseApprovals).set({ repairCaseId: null }).where(eq(repairCaseApprovals.id, orphanId));

    assert.deepEqual(await grantedIds(requesterId), [], "휴지통에 간 건의 승인 완료가 잡혔다");
    assert.deepEqual(await rejectedIds(requesterId), [], "접수 건이 없는 결재의 반려가 잡혔다");
  });

  test("🔴 8. 「최신 행」 판정이 getCurrentApprovalsForCase 와 같은 말이다 — 여러 모양의 사슬에서", async () => {
    await insertRoute("FINAL_SHIPMENT", [stepAId, stepBId]);

    // ① 출하 결재선 끝까지 승인 ② 1단계 승인 뒤 대기 ③ 2단계 반려 ④ 승인된 검수를 다시
    // 요청해 대기(한때 최종이던 승인이 최신이 아니게 된다) ⑤ 스스로 승인한 검수.
    const fullyApproved = await createInspectedCase();
    await requestCaseApproval(fullyApproved.id, "FINAL_SHIPMENT", requesterId);
    await decideCaseApproval(fullyApproved.id, "FINAL_SHIPMENT", "APPROVED", stepAId);
    await decideCaseApproval(fullyApproved.id, "FINAL_SHIPMENT", "APPROVED", stepBId);

    const midway = await createInspectedCase();
    await requestCaseApproval(midway.id, "FINAL_SHIPMENT", requesterId);
    await decideCaseApproval(midway.id, "FINAL_SHIPMENT", "APPROVED", stepAId);

    const rejectedLate = await createInspectedCase();
    await requestCaseApproval(rejectedLate.id, "FINAL_SHIPMENT", requesterId);
    await decideCaseApproval(rejectedLate.id, "FINAL_SHIPMENT", "APPROVED", stepAId);
    await decideCaseApproval(rejectedLate.id, "FINAL_SHIPMENT", "REJECTED", stepBId);

    const reRequested = await createInspectedCase();
    await requestCaseApproval(reRequested.id, "REPAIR_INSPECTION", requesterId);

    const selfApproved = await createTestCase();
    await requestCaseApproval(selfApproved.id, "REPAIR_INSPECTION", requesterId);
    await decideCaseApproval(selfApproved.id, "REPAIR_INSPECTION", "APPROVED", requesterId);

    // getCurrentApprovalsForCase 의 「가장 최근 행」에서 기대값을 만든다 — 요청자 본인 ·
    // APPROVED · 남이 결정.
    const expected: string[] = [];
    for (const repairCase of [fullyApproved, midway, rejectedLate, reRequested, selfApproved]) {
      for (const state of await getCurrentApprovalsForCase(repairCase.id)) {
        const latest = state.latest;
        if (
          latest &&
          latest.status === "APPROVED" &&
          latest.requestedByUserId === requesterId &&
          latest.decidedByUserId !== requesterId
        ) {
          expected.push(latest.id);
        }
      }
    }
    assert.ok(expected.length >= 4, `기대값이 너무 적다 — 시나리오가 제대로 서지 않았다: ${expected.length}`);
    assert.deepEqual([...(await grantedIds(requesterId))].sort(), expected.sort());
    assert.ok(
      !(await grantedIds(requesterId)).includes(reRequested.inspectionId),
      "다시 요청해 최신이 아니게 된 옛 승인이 잡혔다"
    );
  });
});

// ═════════════════════════════════════ 레지스트리 — listMyNotifications 를 그대로 태운다

describe("종 알림 — 승인 완료 · 반려됨", () => {
  /**
   * 요청자에게 승인 완료 하나와 반려 하나를 만든다 — **서로 다른 접수 건의 검수 결재**다.
   *
   * 🔵 13-C3 전에는 반려 쪽이 직접 사용 **불출 신청**이었다(두 줄의 원본 표가 갈렸다).
   *    불출 갈래가 이 파일에서 빠지면서 같은 표의 두 건으로 바꿨다 — 아래 세 시험이
   *    재는 것은 **레지스트리가 종류(승인 완료/반려됨)별 묶음을 순서대로 내는가**와
   *    **확인 키가 사건마다 따로인가**라, 원본 표가 같아도 그대로 선다. 반대로 「원본
   *    표가 달라도 한 묶음에 섞인다」를 재던 자리는 아니었다.
   */
  async function arrangeOneOfEach(): Promise<{
    grantedKey: string;
    rejectedKey: string;
    grantedHref: string;
    rejectedCaseId: string;
  }> {
    const grantedCase = await createInspectedCase();
    const rejectedCase = await createTestCase();
    const rejectedApprovalId = await requestCaseApproval(rejectedCase.id, "REPAIR_INSPECTION", requesterId);
    await decideCaseApproval(rejectedCase.id, "REPAIR_INSPECTION", "REJECTED", inspectorId);

    const [grantedOutcome] = await listMyGrantedApprovalOutcomes(requesterId);
    const [rejectedOutcome] = await listMyRejectedApprovalOutcomes(requesterId);
    assert.equal(grantedOutcome.approvalId, grantedCase.inspectionId);
    assert.equal(rejectedOutcome.approvalId, rejectedApprovalId);
    const granted = buildApprovalGrantedNotification(grantedOutcome as ApprovalOutcome);
    const rejected = buildApprovalRejectedNotification(rejectedOutcome as ApprovalOutcome);
    return {
      grantedKey: granted.id,
      rejectedKey: rejected.id,
      grantedHref: granted.href,
      rejectedCaseId: rejectedCase.id,
    };
  }

  test("🔴 9. 요청자의 종에 두 줄이 뜨고, 다른 사람의 종에는 없다", async () => {
    const { grantedKey, rejectedKey, grantedHref, rejectedCaseId } = await arrangeOneOfEach();

    const items = (await listMyNotifications(requesterId, "AS_ENGINEER")).filter(
      (item) => item.kind === "APPROVAL_GRANTED" || item.kind === "APPROVAL_REJECTED"
    );
    // 🔴 아래 두 줄은 **차례(index)로** 집는다 — 위 deepEqual 이 [승인 완료, 반려됨]
    //    차례를 이미 못 박으므로 0 이 승인 완료, 1 이 반려됨이다. 13-C3 에서 반려 쪽
    //    표본이 불출에서 검수로 바뀌었으니(arrangeOneOfEach 주석) 기대값도 함께 바꿨다.
    assert.deepEqual(items.map((item) => item.id), [grantedKey, rejectedKey], "레지스트리 순서대로 종류별로 온다");
    assert.equal(items.length, 2, "차례로 집기 전에 줄 수부터 못 박는다");
    assert.equal(items[0].targetKey, grantedKey, "사건 하나가 한 건이다");
    assert.equal(items[0].href, grantedHref);
    assert.equal(
      items[1].href,
      `/repair-cases/${rejectedCaseId}/approval`,
      "반려는 **다시 올리는 자리**로 간다 — 그 건의 결재 화면(재요청 단추가 거기 있다)"
    );
    assert.equal(items[1].detail, "수리 검수 승인 · 사유: 시험 반려 사유");

    for (const [someoneElse, role] of [
      [stepAId, "AS_ENGINEER"],
      [inspectorId, "AS_ENGINEER"],
      [otherRequesterId, "AS_ENGINEER"],
      [superAdminId, "SUPER_ADMIN"],
    ] as const) {
      assert.deepEqual(await outcomeNotificationIds(someoneElse, role), [], `${userNames.get(someoneElse)} 의 종에 떴다`);
    }
  });

  test("🔴 9. 확인한 키는 종에서 빠지고, 남이 같은 키를 확인해도 내 종은 그대로다", async () => {
    const { grantedKey, rejectedKey } = await arrangeOneOfEach();

    // 남이 같은 키를 확인한다(형식상 누구든 적을 수 있다 — 자기 종에서만 걸러진다).
    assert.deepEqual(await acknowledgeNotification({ userId: otherRequesterId, notificationKey: grantedKey }), {
      ok: true,
      newlyAcknowledged: true,
    });
    assert.deepEqual(
      await outcomeNotificationIds(requesterId, "AS_ENGINEER"),
      [grantedKey, rejectedKey],
      "남이 확인한 기록 때문에 내 알림이 사라졌다"
    );

    assert.deepEqual(await acknowledgeNotification({ userId: requesterId, notificationKey: grantedKey }), {
      ok: true,
      newlyAcknowledged: true,
    });
    assert.deepEqual(await outcomeNotificationIds(requesterId, "AS_ENGINEER"), [rejectedKey], "확인한 알림이 남았다");

    await acknowledgeNotification({ userId: requesterId, notificationKey: rejectedKey });
    assert.deepEqual(await outcomeNotificationIds(requesterId, "AS_ENGINEER"), []);

    // 확인은 종에서만 거른다 — 결과 사건 자체는 그대로다(결재 기록을 건드리지 않는다).
    assert.equal((await grantedIds(requesterId)).length, 1);
    assert.equal((await rejectedIds(requesterId)).length, 1);
  });

  test("🔴 역할로 거르지 않는다 — 다섯 역할 어느 것으로 불러도 자기 결재 결과를 받는다", async () => {
    const { grantedKey, rejectedKey } = await arrangeOneOfEach();
    for (const role of ROLE_CODES) {
      assert.deepEqual(await outcomeNotificationIds(requesterId, role), [grantedKey, rejectedKey], role);
    }
  });

  test("10. 확인 기록 표가 없을 때의 오류(42P01)를 Drizzle 이 감싼 모양 그대로 알아본다 — 다른 오류는 삼키지 않는다", async () => {
    let undefinedTable: unknown;
    try {
      await db.execute(sql`select 1 from apoutcome_test_no_such_table`);
    } catch (err) {
      undefinedTable = err;
    }
    assert.ok(undefinedTable, "없는 표를 읽었는데 오류가 나지 않았다");
    assert.equal(isUndefinedTableError(undefinedTable), true, "감싼 오류의 cause 까지 내려가지 못한다");

    let invalidUuid: unknown;
    try {
      await db.select().from(users).where(and(eq(users.id, "not-a-uuid"), eq(users.isDeleted, false)));
    } catch (err) {
      invalidUuid = err;
    }
    assert.ok(invalidUuid, "형식이 틀린 uuid 로 읽었는데 오류가 나지 않았다");
    assert.equal(isUndefinedTableError(invalidUuid), false, "표 없음이 아닌 오류까지 삼킨다");
  });
});
