import "../../../../scripts/load-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, like, ne, sql } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  customers,
  products,
  repairCaseApprovals,
  repairCaseIntakeSequences,
  repairCases,
  shipmentApprovalRouteSteps,
  shipmentApprovalRoutes,
  statusChangeHistories,
  users,
  workflowSteps,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import { decideRepairCaseApproval, requestRepairCaseApproval } from "./repair-case-approvals";
import { transitionWorkflow } from "./workflow-transitions";
import {
  autoAdvanceToShipmentWaitingInTx,
  SHIPMENT_WAITING_AUTO_ADVANCE_METADATA,
  SHIPMENT_WAITING_AUTO_ADVANCE_REASON,
} from "./shipment-waiting-auto-advance";
import {
  SHIPMENT_WAITING_AUTO_ONLY_MESSAGE,
  SHIPMENT_WAITING_REPAIR_STATUS,
} from "@/lib/domain/shipment-waiting-auto-advance";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 출하 승인이 **모두** 끝나면 단계가 저절로 [출하 대기]로 — 실제 DB (시험 DB)
 * ============================================================================
 * 순수 판정(domain/shipment-waiting-auto-advance.ts)은 unit 목록의
 * shipment-waiting-auto-advance.test.ts 가 까닭별로 못 박았고, 화면·서버가 **같은
 * 문장**을 쓰는지도 그쪽이 원본 글자로 본다. 여기서 재는 것은 그 둘이 못 재는 것
 * 하나다 — **표에 실제로 무슨 일이 일어나는가.**
 *
 * ── 🔴 이 파일이 존재하는 가장 큰 까닭: version 함정 ────────────────────
 * 승인은 요청 당시의 `repair_cases.version` 에 묶여 있고
 * (repair_case_approvals.repair_case_version_at_request), 출하 완료 전이는 그
 * version 이 **지금 값과 같을 때만** 통과한다. 자동 전환이 평범한 전이처럼
 * version 을 올렸다면 **방금 끝난 그 최종 출하 승인이 그 자리에서 무효
 * (APPROVAL_STALE)가 되어 [출하 완료] 가 영영 막힌다** — 사람은 검수 승인부터
 * 전부 다시 받아야 한다. mutations/shipment-waiting-auto-advance.ts 의 머리말이
 * 그래서 「version 을 올리지 않는다」를 길게 적어 두었는데, 그 글만으로는 아무도
 * 지켜 주지 않는다. 아래 1번이 그 회귀 시험이다:
 *  · version 이 그대로인가 (직접 재는 쪽)
 *  · 그 직후 SHIPMENT_COMPLETED 가 **실제로 되는가** (증상으로 재는 쪽)
 * 둘 다 둔 것은 의도다. 앞의 것만 두면 「version 말고 다른 것이 승인을 무효로
 * 만드는」 날을 놓치고, 뒤의 것만 두면 왜 막혔는지가 안 보인다. 출하 완료를 부를
 * 때 **그 시점의 version 을 다시 읽어 넘기는** 것도 의도다 — 낡은 값을 넘기면
 * 낙관적 잠금(CONFLICT)에 먼저 걸려 정작 보려던 APPROVAL_STALE 가 가려진다.
 *
 * ── 접수 건을 몇 개 만드는가: **여섯** ──────────────────────────────────
 * 🔴 인수번호는 한 달에 99개가 한도다(scripts 의 채번). 접수 건을 헤프게 만들면
 * 한참 뒤 전혀 다른 시험이 까닭 없이 깨진다. 그래서 한 건에 여러 상황을 세운다:
 *  · 2번 — 검수 승인 · 반려 · 사람 길 넷 · 그리고 대조(재요청 후 승인)까지 한 건
 *  · 6번 — 까닭 일곱을 **값으로** 재는 것을 한 건에서 상태만 바꿔 가며
 * 그리고 이 파일은 **계정을 하나도 만들지 않는다**(씨앗 계정만 고른다).
 *
 * 격리 이름: 접수 월 "9908" · 제품 모델 "AUTOWAIT-TEST-". 결재선 판은 3번에서만
 * 만들고 ⚠️ **afterEach 로 반드시 걷는다** — 시험 DB 에 판이 남으면 다른 파일의
 * 출하 승인이 갑자기 결재선을 타면서 깨진다(repair-case-approvals-route 의 경고).
 * ============================================================================
 */

const TEST_RECEIVED_AT = "2099-08-10";
const TEST_SHIPMENT_DATE = "2099-08-20";
const TEST_MODEL_PREFIX = "AUTOWAIT-TEST-";
const TEST_YEAR_MONTH = "9908";
const TEST_INTAKE_PREFIX = "D9908%";

/**
 * 자동 전환이 남긴 이력을 가르는 열쇠. 🔴 action_type 은 사람이 누른 진행과
 * **똑같이** STEP_ADVANCED 라, 이 metadata 한 칸이 유일한 구분이다. 아래 0번이
 * 이 글자가 실제 상수와 같은지 맞대어 본다 — 상수 이름이 바뀌면 이 파일의 질의가
 * **오류 없이 0건**을 세기 시작하고, 그러면 「안 움직였다」 쪽 단언이 전부 공짜로
 * 통과한다.
 */
const AUTO_ADVANCE_METADATA_KEY = "autoAdvancedOnShipmentApproval";

let customerId: string;
let engineerId: string; // 요청자 겸 담당 엔지니어 (AS_ENGINEER)
let adminId: string; // 검수 결재자 · 단계 직접 변경 자격자
let representativeId: string; // 출하 대표 — 결재선이 없을 때의 최종 출하 결재자
let routeApproverIds: string[] = []; // 3번의 결재선 단계 승인자 셋

const createdCaseIds: string[] = [];
const createdRouteIds: string[] = [];

function baseCreateInput(
  workflowType: ValidatedCreateRepairCaseInput["workflowType"]
): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType,
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

async function createTestCase(
  workflowType: ValidatedCreateRepairCaseInput["workflowType"] = "PAID_MATCHER"
): Promise<string> {
  const created = await createRepairCase(baseCreateInput(workflowType));
  assert.equal(created.ok, true, `setup create failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  createdCaseIds.push(created.id);
  return created.id;
}

/** 그 건의 워크플로 버전에서 단계 key 의 행 id. 없으면 null. */
async function stepIdOf(repairCaseId: string, stepKey: string): Promise<string | null> {
  const [row] = await db
    .select({ id: workflowSteps.id })
    .from(repairCases)
    .innerJoin(workflowSteps, eq(workflowSteps.workflowVersionId, repairCases.workflowVersionId))
    .where(and(eq(repairCases.id, repairCaseId), eq(workflowSteps.key, stepKey)));
  return row?.id ?? null;
}

/**
 * Arrange-only 직접 SQL — 정식 경로로 이 자리까지 오려면 전이가 16번 넘게
 * 필요하고, 그것은 이 파일이 보려는 동작이 아니다. workflow-transitions-approval-
 * gating.integration.test.ts 가 같은 자리에서 쓰는 방식 그대로다.
 */
async function placeCaseAtStep(repairCaseId: string, stepKey: string): Promise<string> {
  const stepId = await stepIdOf(repairCaseId, stepKey);
  assert.ok(stepId, `그 건의 워크플로에 ${stepKey} 단계가 없다 — 표본이 어긋났다`);
  await db
    .update(repairCases)
    .set({ currentWorkflowStepId: stepId! })
    .where(eq(repairCases.id, repairCaseId));
  return stepId!;
}

/** 지금 이 건이 어디에 서 있고 version 이 얼마인가. */
async function caseState(
  repairCaseId: string
): Promise<{ stepKey: string; stepId: string; version: number; isLocked: boolean }> {
  const [row] = await db
    .select({
      stepKey: workflowSteps.key,
      stepId: workflowSteps.id,
      version: repairCases.version,
      isLocked: repairCases.isLocked,
    })
    .from(repairCases)
    .innerJoin(workflowSteps, eq(repairCases.currentWorkflowStepId, workflowSteps.id))
    .where(eq(repairCases.id, repairCaseId));
  assert.ok(row, "접수 건을 못 읽었다");
  return row;
}

/**
 * 🔴 **자동 전환이 남긴 줄만** 고른다 — 지시서가 적은 그대로
 * `metadata->>'autoAdvancedOnShipmentApproval' = 'true'` 로 가린다. 글자가 상수와
 * 어긋나면 0번이 먼저 빨개진다.
 */
async function autoAdvanceRows(repairCaseId: string) {
  return db
    .select({
      id: statusChangeHistories.id,
      actionType: statusChangeHistories.actionType,
      fromStepId: statusChangeHistories.fromStepId,
      toStepId: statusChangeHistories.toStepId,
      actorUserId: statusChangeHistories.actorUserId,
      reason: statusChangeHistories.reason,
    })
    .from(statusChangeHistories)
    .where(
      and(
        eq(statusChangeHistories.repairCaseId, repairCaseId),
        eq(statusChangeHistories.actionType, "STEP_ADVANCED"),
        sql`${statusChangeHistories.metadata}->>'autoAdvancedOnShipmentApproval' = 'true'`
      )
    );
}

/**
 * 그 건의 이력 줄 수 전부. 「이력도 그대로인가」를 0 이 아니라 **늘지 않았는가**로
 * 재기 위한 것이다 — 접수 생성이 이력을 남기든 말든 이 파일이 영향을 받지 않는다.
 */
async function historyCount(repairCaseId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(statusChangeHistories)
    .where(eq(statusChangeHistories.repairCaseId, repairCaseId));
  return row.count;
}

/** 최종 출하 승인 행들 — 오래된 것부터. */
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

/** 최종 출하 승인을 요청할 수 있는 상태로 만든다 — 검수 승인을 진짜 경로로 받는다. */
async function approveInspection(repairCaseId: string): Promise<void> {
  const requested = await requestRepairCaseApproval(repairCaseId, "REPAIR_INSPECTION", engineerId, null);
  assert.equal(requested.ok, true, `검수 승인 요청이 막혔다: ${JSON.stringify(requested)}`);
  const decided = await decideRepairCaseApproval(repairCaseId, "REPAIR_INSPECTION", "APPROVED", adminId, null);
  assert.equal(decided.ok, true, `검수 승인이 막혔다: ${JSON.stringify(decided)}`);
}

/** 최종 출하 승인을 요청한다. */
async function requestFinalShipment(repairCaseId: string): Promise<void> {
  const requested = await requestRepairCaseApproval(repairCaseId, "FINAL_SHIPMENT", engineerId, null);
  assert.equal(requested.ok, true, `최종 출하 승인 요청이 막혔다: ${JSON.stringify(requested)}`);
}

/**
 * 결재선 판 하나를 **직접 넣는다**(arrange-only). saveShipmentApprovalRoute 를
 * 쓰지 않는 것은 의도다 — 그 함수는 권한 판정과 감사 기록까지 함께 하는데, 그
 * 동작은 shipment-approval-routes.integration.test.ts 가 이미 재고 있고 여기서
 * 다시 재면 남의 감사 줄까지 걷어야 한다(계정 참조가 RESTRICT 다).
 */
async function insertRoute(approverUserIds: string[]): Promise<string> {
  const [route] = await db
    .insert(shipmentApprovalRoutes)
    .values({ scope: "FINAL_SHIPMENT", version: 1, createdByUserId: adminId })
    .returning({ id: shipmentApprovalRoutes.id });
  createdRouteIds.push(route.id);
  await db.insert(shipmentApprovalRouteSteps).values(
    approverUserIds.map((approverUserId, index) => ({
      routeId: route.id,
      stepOrder: index + 1,
      approverUserId,
    }))
  );
  return route.id;
}

/**
 * 판·단계를 걷는다. 🔴 결재 행이 판을 RESTRICT 로 참조하므로 **결재 행이 먼저**다.
 * 판을 만든 시험이 하나뿐이라도 afterEach 에 두는 까닭은, 그 시험이 중간에
 * 던졌을 때도 판이 남지 않게 하기 위해서다.
 */
async function removeRouteFixtures(): Promise<void> {
  if (createdRouteIds.length === 0) return;
  if (createdCaseIds.length > 0) {
    await db.delete(repairCaseApprovals).where(inArray(repairCaseApprovals.repairCaseId, createdCaseIds));
  }
  await db.delete(shipmentApprovalRouteSteps).where(inArray(shipmentApprovalRouteSteps.routeId, createdRouteIds));
  await db.delete(shipmentApprovalRoutes).where(inArray(shipmentApprovalRoutes.id, createdRouteIds));
  createdRouteIds.length = 0;
}

/** 이 파일이 만든 접수 건·제품·채번을 걷는다(이전 실행이 끊겼을 때도 같은 것을 건다). */
async function removeCaseFixtures(): Promise<void> {
  const leftovers = await db
    .select({ id: repairCases.id })
    .from(repairCases)
    .where(like(repairCases.intakeNumber, TEST_INTAKE_PREFIX));
  for (const { id } of leftovers) {
    await db.delete(repairCaseApprovals).where(eq(repairCaseApprovals.repairCaseId, id));
    await db.delete(statusChangeHistories).where(eq(statusChangeHistories.repairCaseId, id));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, TEST_INTAKE_PREFIX));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
}

before(async () => {
  await removeCaseFixtures();

  // 🔴 이 파일의 1·2·5·6번은 **결재선이 없는** 대표·위임 방식을 전제로 한다.
  // 판이 남아 있으면 요청이 결재선을 타면서 「마지막 승인」의 뜻이 달라진다.
  const [leftoverRoute] = await db.select({ id: shipmentApprovalRoutes.id }).from(shipmentApprovalRoutes).limit(1);
  assert.equal(
    leftoverRoute,
    undefined,
    "이 시험은 shipment_approval_routes 가 비어 있는 상태를 전제로 합니다(앞 시험의 판이 남았는지 보세요)"
  );

  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.isDeleted, false))
    .limit(1);
  assert.ok(customer, "삭제되지 않은 고객이 최소 1건 필요합니다");
  customerId = customer.id;

  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "AS_ENGINEER"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false),
        eq(users.isActive, true)
      )
    )
    .limit(1);
  assert.ok(engineer, "승인된 AS_ENGINEER 가 필요합니다");
  engineerId = engineer.id;

  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "ADMIN"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false),
        eq(users.isActive, true)
      )
    )
    .limit(1);
  assert.ok(admin, "승인된 ADMIN 이 필요합니다");
  adminId = admin.id;

  const [representative] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isShipmentRepresentative, true), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(representative, "씨앗의 users.is_shipment_representative = true 행이 필요합니다");
  representativeId = representative.id;

  // 결재선 단계 승인자 셋. 🔴 **요청자(engineerId)는 빼야 한다** — 요청자 본인
  // 단계는 사슬이 건너뛰므로(domain/shipment-approval-route.ts), 섞이면 3번이
  // 재려는 「중간 단계」가 사라진다.
  const candidates = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isActive, true),
        eq(users.isDeleted, false),
        isNull(users.lockedAt),
        ne(users.id, engineerId)
      )
    )
    .orderBy(asc(users.createdAt))
    .limit(3);
  assert.equal(candidates.length, 3, "결재선 3단계를 세울 수 있는 계정이 3명 필요합니다");
  routeApproverIds = candidates.map((row) => row.id);
});

afterEach(async () => {
  await removeRouteFixtures();
});

after(async () => {
  await removeRouteFixtures();
  await removeCaseFixtures();
  await pgClient.end({ timeout: 5 });
});

describe("출하 대기 자동 전환 — 표본 점검", () => {
  test("0. 이 파일이 세는 열쇠·문장이 실제 상수와 같다", () => {
    // 🔴 이것이 어긋나면 아래 질의가 **오류 없이 0건**을 세고, 「안 움직였다」 쪽
    // 단언이 전부 공짜로 통과한다. 가장 먼저 재야 하는 것이다.
    assert.deepEqual(
      Object.keys(SHIPMENT_WAITING_AUTO_ADVANCE_METADATA),
      [AUTO_ADVANCE_METADATA_KEY],
      "metadata 열쇠가 바뀌었다 — 이 파일의 질의도 함께 고쳐야 한다"
    );
    assert.equal(SHIPMENT_WAITING_AUTO_ADVANCE_METADATA.autoAdvancedOnShipmentApproval, true);
    assert.ok(
      SHIPMENT_WAITING_AUTO_ADVANCE_REASON.length > 0,
      "사유 문장이 비어 있으면 이력 화면에서 마지막 결재자가 손으로 옮긴 것처럼 읽힌다"
    );
    assert.ok(SHIPMENT_WAITING_AUTO_ONLY_MESSAGE.length > 0);
  });
});

describe("🔴 출하 대기 자동 전환 — 실제로 옮겨지는가", () => {
  test("🔴 1. 최종 출하 승인이 끝나면 [출하 대기]로 옮겨지고, version 은 그대로이며, 그 직후 [출하 완료]가 된다", async () => {
    const caseId = await createTestCase();
    const fromStepId = await placeCaseAtStep(caseId, "shipment_approved");
    const toStepId = await stepIdOf(caseId, "waiting_shipment");
    assert.ok(toStepId, "매쳐 워크플로에 waiting_shipment 단계가 없다 — 표본이 어긋났다");

    const start = await caseState(caseId);
    assert.equal(start.stepKey, "shipment_approved", "출발 자리를 못 세웠다");
    const historyBefore = await historyCount(caseId);

    // 대조 — 검수 승인은 이 자동 전환을 열지 않는다(아래 2번이 값으로도 잰다).
    await approveInspection(caseId);
    assert.equal(
      (await caseState(caseId)).stepKey,
      "shipment_approved",
      "검수 승인만으로 단계가 움직였다"
    );

    await requestFinalShipment(caseId);
    const decided = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", representativeId, null);
    assert.equal(decided.ok, true, `최종 출하 승인이 막혔다: ${JSON.stringify(decided)}`);

    const moved = await caseState(caseId);
    assert.equal(moved.stepKey, "waiting_shipment", "출하 승인이 다 끝났는데 단계가 그대로다");
    assert.equal(
      moved.version,
      start.version,
      "🔴 version 이 올랐다 — 방금 끝난 최종 출하 승인이 그 자리에서 무효가 되어 [출하 완료]가 영영 막힌다"
    );

    // 이력 한 줄 — action_type 은 평범한 진행과 같고, 가르는 것은 metadata 와 사유다.
    const autoRows = await autoAdvanceRows(caseId);
    assert.equal(autoRows.length, 1, "자동 전환 이력이 한 줄이 아니다");
    assert.equal(autoRows[0].actionType, "STEP_ADVANCED", "새 action_type 을 만들면 enum 마이그레이션이 필요하다");
    assert.equal(autoRows[0].fromStepId, fromStepId);
    assert.equal(autoRows[0].toStepId, toStepId);
    assert.equal(
      autoRows[0].reason,
      SHIPMENT_WAITING_AUTO_ADVANCE_REASON,
      "사유가 비면 처리자 칸의 마지막 결재자가 손으로 옮긴 것으로 읽힌다"
    );
    assert.equal(
      autoRows[0].actorUserId,
      representativeId,
      "actor_user_id 는 NOT NULL 이라 마지막으로 결재를 누른 사람이 들어간다"
    );
    assert.equal(await historyCount(caseId), historyBefore + 1, "이력이 한 줄만 늘어야 한다");

    // 🔴 여기가 알맹이다. **지금 version 을 다시 읽어** 넘긴다 — 낡은 값을 넘기면
    // 낙관적 잠금(CONFLICT)에 먼저 걸려 정작 보려던 APPROVAL_STALE 가 가려진다.
    const fresh = await caseState(caseId);
    const completed = await transitionWorkflow(
      caseId,
      fresh.version,
      "SHIPMENT_COMPLETED",
      representativeId,
      "출하 완료 메모"
    );
    if (!completed.ok) {
      assert.notEqual(
        completed.code,
        "APPROVAL_STALE",
        "🔴 자동 전환이 승인을 무효로 만들었다 — version 을 올리고 있다는 뜻이다"
      );
    }
    assert.equal(completed.ok, true, `출하 완료가 막혔다: ${JSON.stringify(completed)}`);
    if (!completed.ok) return;
    assert.equal(completed.currentWorkflowStepKey, "shipment_completed");

    const [row] = await db.select().from(repairCases).where(eq(repairCases.id, caseId));
    assert.equal(row!.isLocked, true, "출하 완료인데 잠기지 않았다");
  });

  test("🔴 2. 검수 승인 · 반려 · 사람이 고르는 길로는 안 움직인다 — 그리고 다시 승인받으면 그대로 옮겨진다", async () => {
    const caseId = await createTestCase();
    await placeCaseAtStep(caseId, "shipment_approved");
    const start = await caseState(caseId);
    const historyBefore = await historyCount(caseId);

    // (가) 수리 검수 승인 — 이 자동 전환은 최종 출하 승인에만 걸린다.
    await approveInspection(caseId);
    assert.equal((await caseState(caseId)).stepKey, "shipment_approved", "검수 승인으로 움직였다");
    assert.equal((await autoAdvanceRows(caseId)).length, 0, "검수 승인이 자동 전환 이력을 남겼다");

    // (나) 반려 — 사슬이 끊긴 것이지 끝난 것이 아니다.
    await requestFinalShipment(caseId);
    const rejected = await decideRepairCaseApproval(
      caseId,
      "FINAL_SHIPMENT",
      "REJECTED",
      representativeId,
      "부품 재확인 필요"
    );
    assert.equal(rejected.ok, true, `반려가 막혔다: ${JSON.stringify(rejected)}`);
    assert.equal((await caseState(caseId)).stepKey, "shipment_approved", "반려했는데 단계가 움직였다");
    assert.equal((await autoAdvanceRows(caseId)).length, 0, "반려가 자동 전환 이력을 남겼다");
    assert.equal((await caseState(caseId)).version, start.version);

    // (다) 🔴 사람은 [다음 단계로 진행] 으로 그 길을 탈 수 없다. **역할이 되는
    // 사람과 안 되는 사람이 같은 까닭을 받아야** 한다 — 관문이 역할 검사보다
    // 뒤에 있으면 엔지니어 쪽이 「담당 엔지니어만…」(FORBIDDEN)을 받고, 그러면
    // 역할을 바꿔 봐도 안 되는 까닭을 끝내 모른다.
    // (ADMIN 은 이 전이의 allowedRoles 에 있고 AS_ENGINEER 는 없다 —
    //  domain/local/workflow/transition-definitions.ts 의 매쳐 ADV-shipment_approved.)
    for (const [label, actorId] of [
      ["역할이 되는 관리자", adminId],
      ["역할이 안 되는 담당 엔지니어", engineerId],
    ] as const) {
      const blocked = await transitionWorkflow(caseId, start.version, "STEP_ADVANCED", actorId, null);
      assert.equal(blocked.ok, false, `${label}: 사람이 [출하 대기]로 넘어갔다`);
      if (!blocked.ok) {
        assert.equal(blocked.code, "INVALID_TRANSITION", label);
        assert.equal(blocked.message, SHIPMENT_WAITING_AUTO_ONLY_MESSAGE, label);
      }
      assert.equal((await caseState(caseId)).stepKey, "shipment_approved", `${label}: 거절됐는데 단계가 움직였다`);
    }

    // (라) [단계 직접 변경] 목록에도 그 단계는 없다(queries/workflow-rules.ts).
    const manual = await transitionWorkflow(
      caseId,
      start.version,
      "STEP_SET_MANUALLY",
      adminId,
      null,
      "waiting_shipment"
    );
    assert.equal(manual.ok, false, "[단계 직접 변경]으로 출하 대기에 닿았다");
    if (!manual.ok) assert.equal(manual.code, "INVALID_TRANSITION");

    assert.equal(await historyCount(caseId), historyBefore, "거절된 길들이 이력을 남겼다");

    // (마) 🔴 대조 — 막은 것은 **사람 길뿐**이다. 다시 요청해 승인하면 시스템은
    // 그대로 옮긴다. 이 줄이 없으면 위 단언들은 「아무 일도 안 일어나는 건」에서
    // 공짜로 통과한다.
    await requestFinalShipment(caseId);
    const approved = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", representativeId, null);
    assert.equal(approved.ok, true, `재요청 승인이 막혔다: ${JSON.stringify(approved)}`);
    const moved = await caseState(caseId);
    assert.equal(moved.stepKey, "waiting_shipment", "🔴 대조가 성립하지 않는다 — 승인해도 안 움직인다");
    assert.equal(moved.version, start.version, "🔴 version 이 올랐다");
    assert.equal((await autoAdvanceRows(caseId)).length, 1);
  });

  test("🔴 3. 결재선이 여러 단계면 중간에는 안 움직이고 마지막 단계에서 움직인다", async () => {
    const routeId = await insertRoute(routeApproverIds);
    const caseId = await createTestCase();
    await placeCaseAtStep(caseId, "shipment_approved");
    const start = await caseState(caseId);

    await approveInspection(caseId);
    await requestFinalShipment(caseId);

    // 표본 점검 — 정말 결재선을 탔는가. 안 탔으면 아래 세 번의 승인이 그냥
    // 「마지막 승인 한 번」이 되어 이 시험은 아무것도 재지 않는다.
    const opened = await shipmentRows(caseId);
    assert.equal(opened.length, 1, "요청 한 번에 행이 하나여야 한다");
    assert.equal(opened[0].routeId, routeId, "결재선을 타지 않았다 — 이 시험은 아무것도 재지 않는다");
    assert.equal(opened[0].routeStepOrder, 1);
    assert.equal(opened[0].assignedApproverUserId, routeApproverIds[0]);

    // 1·2단계 — 사슬이 이어지므로 「모두 끝난 것」이 아니다.
    for (const [index, approverId] of [routeApproverIds[0], routeApproverIds[1]].entries()) {
      const decided = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", approverId, null);
      assert.equal(decided.ok, true, `${index + 1}단계가 막혔다: ${JSON.stringify(decided)}`);
      const state = await caseState(caseId);
      assert.equal(state.stepKey, "shipment_approved", `${index + 1}단계만 끝났는데 단계가 움직였다`);
      assert.equal(state.version, start.version);
      assert.equal((await autoAdvanceRows(caseId)).length, 0, `${index + 1}단계가 자동 전환 이력을 남겼다`);
      assert.equal((await shipmentRows(caseId)).length, index + 2, "다음 단계 행이 안 열렸다");
    }

    // 3단계(마지막) — 다음 행이 안 열리는 승인이 곧 마지막 승인이다.
    const last = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", routeApproverIds[2], null);
    assert.equal(last.ok, true, `3단계가 막혔다: ${JSON.stringify(last)}`);
    assert.equal((await shipmentRows(caseId)).length, 3, "마지막 단계 뒤에 행이 또 생겼다");

    const moved = await caseState(caseId);
    assert.equal(moved.stepKey, "waiting_shipment", "결재선이 다 끝났는데 단계가 그대로다");
    assert.equal(moved.version, start.version, "🔴 version 이 올랐다");
    const autoRows = await autoAdvanceRows(caseId);
    assert.equal(autoRows.length, 1);
    assert.equal(
      autoRows[0].actorUserId,
      routeApproverIds[2],
      "마지막으로 결재를 누른 사람이 이력의 처리자여야 한다"
    );
  });

  test("4. 이미 [출하 대기]인 건은 단계도 version 도 이력도 그대로다", async () => {
    const caseId = await createTestCase();
    await placeCaseAtStep(caseId, "waiting_shipment");
    const start = await caseState(caseId);
    const historyBefore = await historyCount(caseId);

    await approveInspection(caseId);
    await requestFinalShipment(caseId);
    const decided = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", representativeId, null);
    assert.equal(decided.ok, true, `최종 출하 승인이 막혔다: ${JSON.stringify(decided)}`);

    const after = await caseState(caseId);
    assert.equal(after.stepKey, "waiting_shipment");
    assert.equal(after.stepId, start.stepId, "같은 자리인데 단계 행이 바뀌었다");
    assert.equal(after.version, start.version);
    assert.equal((await autoAdvanceRows(caseId)).length, 0, "이미 출하 대기인데 이력이 남았다");
    assert.equal(await historyCount(caseId), historyBefore, "이력이 늘었다");

    // 🔵 대조 — 아무 일도 안 한 것이 아니라 **승인이 멀쩡히 유효하다.** 이 줄이
    // 없으면 승인이 조용히 깨진 건에서도 위 단언들이 그대로 통과한다.
    const fresh = await caseState(caseId);
    const completed = await transitionWorkflow(
      caseId,
      fresh.version,
      "SHIPMENT_COMPLETED",
      representativeId,
      "출하 완료 메모"
    );
    assert.equal(completed.ok, true, `출하 완료가 막혔다: ${JSON.stringify(completed)}`);
  });

  test("5. 제너레이터 워크플로에서는 아무 일도 없다 — 그 워크플로엔 출하 대기 단계가 없다", async () => {
    const caseId = await createTestCase("PAID_GENERATOR");
    await placeCaseAtStep(caseId, "shipment_approved");
    const start = await caseState(caseId);
    const historyBefore = await historyCount(caseId);

    // 표본 점검 — 정말 그 단계가 없는가(있으면 이 시험은 엉뚱한 것을 잰다).
    const waitingSteps = await db
      .select({ key: workflowSteps.key })
      .from(repairCases)
      .innerJoin(workflowSteps, eq(workflowSteps.workflowVersionId, repairCases.workflowVersionId))
      .where(and(eq(repairCases.id, caseId), eq(workflowSteps.repairStatus, SHIPMENT_WAITING_REPAIR_STATUS)));
    assert.deepEqual(waitingSteps, [], "제너레이터에 출하 대기 단계가 생겼다 — 이 시험의 전제가 바뀌었다");

    // 까닭도 값으로 재 둔다 — 「안 움직였다」만으로는 왜 안 움직였는지 모른다.
    const decision = await autoAdvanceToShipmentWaitingInTx(db, {
      repairCaseId: caseId,
      actorUserId: representativeId,
      approvalType: "FINAL_SHIPMENT",
      decision: "APPROVED",
      hasNextRouteStep: false,
    });
    assert.deepEqual(decision, { move: false, reason: "NO_SHIPMENT_WAITING_STEP" });

    // 진짜 결재 경로로도 같다.
    await approveInspection(caseId);
    await requestFinalShipment(caseId);
    const decided = await decideRepairCaseApproval(caseId, "FINAL_SHIPMENT", "APPROVED", representativeId, null);
    assert.equal(decided.ok, true, `최종 출하 승인이 막혔다: ${JSON.stringify(decided)}`);

    const after = await caseState(caseId);
    assert.equal(after.stepKey, "shipment_approved", "제너레이터 건이 움직였다");
    assert.equal(after.version, start.version);
    assert.equal((await autoAdvanceRows(caseId)).length, 0);
    assert.equal(await historyCount(caseId), historyBefore, "이력이 늘었다");

    // 🔵 대조 — 제너레이터는 출하 승인 단계에서 **바로** 출하 완료로 간다.
    const fresh = await caseState(caseId);
    const completed = await transitionWorkflow(
      caseId,
      fresh.version,
      "SHIPMENT_COMPLETED",
      representativeId,
      "출하 완료 메모"
    );
    assert.equal(completed.ok, true, `출하 완료가 막혔다: ${JSON.stringify(completed)}`);
    if (completed.ok) assert.equal(completed.currentWorkflowStepKey, "shipment_completed");
  });
});

/**
 * ============================================================================
 * 🔴 왜 안 옮겼나 — **까닭을 값으로** 재는 갈래
 * ============================================================================
 * 위 갈래는 결재 경로를 통째로 태워 「표가 어떻게 됐는가」를 본다. 그것만으로는
 * **왜** 안 움직였는지 알 수 없다 — 잠금 때문인지 보류 때문인지 자리가 멀어서인지
 * 전부 「단계가 그대로」로만 보인다. 그래서 여기서는 쓰는 쪽 함수를 직접 불러
 * 돌려주는 까닭을 맞대어 본다(그 함수는 던지지 않고 결정을 돌려준다 — 바로 이
 * 시험을 위해 그렇게 돼 있다).
 *
 * 🔴 접수 건은 **하나**다. 결재 행을 만들지 않고 인자로 상황을 넘기므로, 자리와
 * 깃발만 바꿔 가며 까닭 일곱을 한 건에서 전부 잴 수 있다. 인수번호는 한 달에
 * 99개가 한도라 이렇게 아껴야 한다.
 * ============================================================================
 */
describe("🔴 출하 대기 자동 전환 — 안 옮기는 까닭을 값으로 잰다", () => {
  test("🔴 6. 까닭 일곱과 대조 하나 — 한 접수 건에서", async () => {
    const caseId = await createTestCase();
    const approvedStepId = await stepIdOf(caseId, "shipment_approved");
    const waitingStepId = await stepIdOf(caseId, "waiting_shipment");
    assert.ok(approvedStepId && waitingStepId, "매쳐 워크플로의 두 단계를 못 찾았다");

    const [{ workflowVersionId }] = await db
      .select({ workflowVersionId: repairCases.workflowVersionId })
      .from(repairCases)
      .where(eq(repairCases.id, caseId));

    /** 「출하 승인이 모두 끝났다」에 해당하는 입력 — 여기서 막히면 까닭은 건 쪽이다. */
    const finalApproved = {
      repairCaseId: caseId,
      actorUserId: representativeId,
      approvalType: "FINAL_SHIPMENT",
      decision: "APPROVED",
      hasNextRouteStep: false,
    } as const;

    // (가) 결재 쪽에서 돌아서는 셋 — 접수 건을 한 줄도 읽기 전에 끝난다.
    await placeCaseAtStep(caseId, "shipment_approved");
    assert.deepEqual(
      await autoAdvanceToShipmentWaitingInTx(db, { ...finalApproved, approvalType: "REPAIR_INSPECTION" }),
      { move: false, reason: "NOT_FINAL_SHIPMENT" }
    );
    assert.deepEqual(await autoAdvanceToShipmentWaitingInTx(db, { ...finalApproved, decision: "REJECTED" }), {
      move: false,
      reason: "NOT_APPROVED",
    });
    assert.deepEqual(await autoAdvanceToShipmentWaitingInTx(db, { ...finalApproved, hasNextRouteStep: true }), {
      move: false,
      reason: "ROUTE_HAS_NEXT_STEP",
    });

    // (나) 먼 자리 — 승인 기록만으로 단계를 통째로 건너뛰게 하지 않는다.
    await placeCaseAtStep(caseId, "power_on_test");
    assert.deepEqual(await autoAdvanceToShipmentWaitingInTx(db, finalApproved), {
      move: false,
      reason: "NOT_AT_PRECEDING_STEP",
    });

    // (다) 잠긴 건 — 출하 완료 뒤에는 되돌리기 하나만 문이 열려 있다.
    await placeCaseAtStep(caseId, "shipment_approved");
    await db.update(repairCases).set({ isLocked: true }).where(eq(repairCases.id, caseId));
    try {
      assert.deepEqual(await autoAdvanceToShipmentWaitingInTx(db, finalApproved), {
        move: false,
        reason: "CASE_LOCKED",
      });
    } finally {
      await db.update(repairCases).set({ isLocked: false }).where(eq(repairCases.id, caseId));
    }

    // (라) 보류 중 — 사람이 못 옮기는 자리를 시스템이 몰래 옮기면 보류가 뜻을 잃는다.
    // 보류 상태는 전용 칸이 없어 사건 기록에서 되살린다(readIsOnHold). 두 줄의
    // 차례가 곧 판정이므로 created_at 을 **명시해** 같은 시각이 되지 않게 한다.
    await db.insert(statusChangeHistories).values({
      repairCaseId: caseId,
      workflowVersionId,
      actionType: "HOLD_STARTED",
      actorUserId: adminId,
      reason: "자동 전환 시험 — 보류",
      createdAt: new Date("2099-08-11T00:00:00.000Z"),
    });
    assert.deepEqual(await autoAdvanceToShipmentWaitingInTx(db, finalApproved), {
      move: false,
      reason: "ON_HOLD",
    });
    await db.insert(statusChangeHistories).values({
      repairCaseId: caseId,
      workflowVersionId,
      actionType: "HOLD_RELEASED",
      actorUserId: adminId,
      reason: "자동 전환 시험 — 보류 해제",
      createdAt: new Date("2099-08-12T00:00:00.000Z"),
    });

    // (마) 🔴 대조 — 여기까지 전부 「안 움직인다」였다. 보류를 풀면 **움직여야**
    // 한다. 이 줄이 없으면 위 일곱이 「어차피 아무 일도 안 일어나는 건」에서
    // 공짜로 통과한다.
    const before = await caseState(caseId);
    assert.equal((await autoAdvanceRows(caseId)).length, 0, "여기까지는 이력이 없어야 한다");
    assert.deepEqual(await autoAdvanceToShipmentWaitingInTx(db, finalApproved), {
      move: true,
      fromStepKey: "shipment_approved",
      toStepKey: "waiting_shipment",
    });
    const moved = await caseState(caseId);
    assert.equal(moved.stepId, waitingStepId);
    assert.equal(moved.version, before.version, "🔴 version 이 올랐다");
    assert.equal((await autoAdvanceRows(caseId)).length, 1);

    // (바) 그리고 이미 [출하 대기]면 두 번째 부름은 아무것도 하지 않는다.
    assert.deepEqual(await autoAdvanceToShipmentWaitingInTx(db, finalApproved), {
      move: false,
      reason: "ALREADY_SHIPMENT_WAITING",
    });
    assert.equal((await autoAdvanceRows(caseId)).length, 1, "두 번째 부름이 이력을 하나 더 남겼다");

    // (사) 🔴 **나가는 길은 막히지 않는다** — 판정이 도착 상태만 보므로 출하
    // 대기에서 다른 단계로 직접 변경하는 길은 그대로다. 잘못 들어간 건이 영영
    // 갇히면 안 된다.
    const fresh = await caseState(caseId);
    const out = await transitionWorkflow(
      caseId,
      fresh.version,
      "STEP_SET_MANUALLY",
      adminId,
      "자동 전환 시험 — 나가는 길",
      "power_on_test"
    );
    assert.equal(out.ok, true, `출하 대기에서 빠져나오지 못한다: ${JSON.stringify(out)}`);
    if (out.ok) assert.equal(out.currentWorkflowStepKey, "power_on_test");
  });
});
