import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateTransitionAvailability,
  evaluateHoldAvailabilityForCategory,
  explainUnavailableWorkflowActions,
  LOCKED_CASE_MESSAGE,
} from "./workflow-action-availability";
import { SHIPMENT_WAITING_AUTO_ONLY_MESSAGE } from "../../shipment-waiting-auto-advance";
// 🔵 배너가 더 이상 이 표를 보지 않는다는 것을 **표의 값으로** 재기 위해서만 부른다.
import { getStepCategory } from "./step-category";
import type { TransitionDefinition } from "./transition-definitions";
import type { HoldState } from "./workflow-types";
import type { ActingUser } from "../approval/transitions";

const NOT_ON_HOLD: HoldState = { isOnHold: false, reason: null, startedByUserId: null, startedByNameSnapshot: null, startedAt: null };
const ON_HOLD: HoldState = { isOnHold: true, reason: "부품 대기", startedByUserId: "u-hold", startedByNameSnapshot: "테스트", startedAt: "2026-01-01T00:00:00Z" };

function user(role: ActingUser["role"], overrides: Partial<ActingUser> = {}): ActingUser {
  return { id: "actor-1", name: "테스트 사용자", role, approvalStatus: "APPROVED", isDeveloper: false, ...overrides };
}

function transition(overrides: Partial<TransitionDefinition> = {}): TransitionDefinition {
  return {
    id: "t-1",
    workflowType: "PAID_MATCHER",
    actionCode: "STEP_ADVANCED",
    fromStepKey: "repair_in_progress",
    toStepKey: "power_on_test",
    toStatus: "IN_REPAIR",
    direction: "FORWARD",
    allowedRoles: ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"],
    requiresAssignedEngineer: true,
    requiresReason: false,
    requiredApprovalType: null,
    ...overrides,
  };
}

// ---------------------------------------------------------- evaluateTransitionAvailability

test("locked case: unavailable with LOCKED_CASE_MESSAGE, overriding everything else — even a fully eligible SUPER_ADMIN", () => {
  const result = evaluateTransitionAvailability({
    transition: transition({ allowedRoles: ["SUPER_ADMIN", "ADMIN"] }),
    actionCode: "STEP_ADVANCED",
    actingUser: user("SUPER_ADMIN"),
    assignedEngineerId: null,
    holdState: NOT_ON_HOLD,
    isCaseLocked: true,
    approvalGateStatus: "SATISFIED",
  });
  assert.deepEqual(result, { available: false, reason: LOCKED_CASE_MESSAGE });
});

test("no transition defined at this step: unavailable with the per-action reason", () => {
  const result = evaluateTransitionAvailability({
    transition: null,
    actionCode: "SHIPMENT_COMPLETED",
    actingUser: user("SUPER_ADMIN"),
    assignedEngineerId: null,
    holdState: NOT_ON_HOLD,
    isCaseLocked: false,
    approvalGateStatus: "SATISFIED",
  });
  assert.equal(result.available, false);
  if (!result.available) assert.equal(result.reason, "현재 단계에서는 출하 완료 처리를 할 수 없습니다.");
});

test("role not eligible for this transition: unavailable, reason from checkTransitionEligibility", () => {
  const result = evaluateTransitionAvailability({
    transition: transition({ allowedRoles: ["SUPER_ADMIN", "ADMIN", "INVENTORY_MANAGER"] }),
    actionCode: "STEP_ADVANCED",
    actingUser: user("AS_ENGINEER"),
    assignedEngineerId: "actor-1",
    holdState: NOT_ON_HOLD,
    isCaseLocked: false,
    approvalGateStatus: "SATISFIED",
  });
  assert.equal(result.available, false);
  if (!result.available) assert.equal(result.reason, "현재 역할로는 이 작업을 수행할 수 없습니다.");
});

test("required approval not yet granted: unavailable with the approval-specific reason", () => {
  const result = evaluateTransitionAvailability({
    transition: transition({ requiredApprovalType: "REPAIR_INSPECTION" }),
    actionCode: "STEP_ADVANCED",
    actingUser: user("AS_ENGINEER"),
    assignedEngineerId: "actor-1",
    holdState: NOT_ON_HOLD,
    isCaseLocked: false,
    approvalGateStatus: "NOT_APPROVED",
  });
  assert.equal(result.available, false);
  if (!result.available) assert.equal(result.reason, "수리 검수 승인이 완료되어야 합니다.");
});

test("stale approval (case changed since approval): unavailable with the stale-specific reason, distinct from not-approved", () => {
  const result = evaluateTransitionAvailability({
    transition: transition({ requiredApprovalType: "FINAL_SHIPMENT" }),
    actionCode: "SHIPMENT_COMPLETED",
    actingUser: user("ADMIN"),
    assignedEngineerId: null,
    holdState: NOT_ON_HOLD,
    isCaseLocked: false,
    approvalGateStatus: "STALE",
  });
  assert.equal(result.available, false);
  if (!result.available) assert.equal(result.reason, "접수 건 정보가 승인 이후 변경되어 기존 승인을 다시 받아야 합니다.");
});

test("everything satisfied: available", () => {
  const result = evaluateTransitionAvailability({
    transition: transition(),
    actionCode: "STEP_ADVANCED",
    actingUser: user("AS_ENGINEER"),
    assignedEngineerId: "actor-1",
    holdState: NOT_ON_HOLD,
    isCaseLocked: false,
    approvalGateStatus: "SATISFIED",
  });
  assert.deepEqual(result, { available: true });
});

// ------------------------------------------------------- evaluateHoldAvailabilityForCategory

test("locked case blocks hold start/release too, unconditionally — no admin bypass", () => {
  for (const role of ["AS_ENGINEER", "ADMIN", "SUPER_ADMIN"] as const) {
    const result = evaluateHoldAvailabilityForCategory({
      isRelease: false,
      actingUser: user(role),
      holdState: NOT_ON_HOLD,
      stepCategory: "TECHNICAL",
      assignedEngineerId: "actor-1",
      isCaseLocked: true,
    });
    assert.deepEqual(result, { available: false, reason: LOCKED_CASE_MESSAGE }, `${role} must be blocked when locked`);
  }
});

test("hold-release attempted while not on hold: unavailable", () => {
  const result = evaluateHoldAvailabilityForCategory({
    isRelease: true,
    actingUser: user("SUPER_ADMIN"),
    holdState: NOT_ON_HOLD,
    stepCategory: "TECHNICAL",
    assignedEngineerId: null,
    isCaseLocked: false,
  });
  assert.equal(result.available, false);
  if (!result.available) assert.equal(result.reason, "보류 중이 아닙니다.");
});

test("hold-start attempted while already on hold: unavailable", () => {
  const result = evaluateHoldAvailabilityForCategory({
    isRelease: false,
    actingUser: user("SUPER_ADMIN"),
    holdState: ON_HOLD,
    stepCategory: "TECHNICAL",
    assignedEngineerId: null,
    isCaseLocked: false,
  });
  assert.equal(result.available, false);
  if (!result.available) assert.equal(result.reason, "이미 보류 중입니다.");
});

test("AS_ENGINEER on their own TECHNICAL step, unlocked, not on hold: hold start is available", () => {
  const result = evaluateHoldAvailabilityForCategory({
    isRelease: false,
    actingUser: user("AS_ENGINEER"),
    holdState: NOT_ON_HOLD,
    stepCategory: "TECHNICAL",
    assignedEngineerId: "actor-1",
    isCaseLocked: false,
  });
  assert.deepEqual(result, { available: true });
});

test("분류가 없는 단계(건별로 추가한 case_step_N 등)에서는 관리자만 보류할 수 있다", () => {
  // 서버(checkHoldEligibilityForCategory)와 같은 판정이다. 예전처럼 TS 표에서
  // 분류를 찾았다면 DB에만 있는 단계는 늘 null이 되어 담당자까지 막혔다.
  const engineer = evaluateHoldAvailabilityForCategory({
    isRelease: false,
    actingUser: user("AS_ENGINEER"),
    holdState: NOT_ON_HOLD,
    stepCategory: null,
    assignedEngineerId: "actor-1",
    isCaseLocked: false,
  });
  assert.equal(engineer.available, false);

  const admin = evaluateHoldAvailabilityForCategory({
    isRelease: false,
    actingUser: user("ADMIN"),
    holdState: NOT_ON_HOLD,
    stepCategory: null,
    assignedEngineerId: "actor-1",
    isCaseLocked: false,
  });
  assert.deepEqual(admin, { available: true });
});

// ------------------------------------------------------- explainUnavailableWorkflowActions
//
// 🔴 분류는 **인자로 들어온다**(2026-11-03). 아래 시험들이 단계 키 대신 분류를
// 넘기는 까닭이고, 맨 끝의 두 시험이 「DB 가 표를 이긴다」를 직접 잰다.

test("locked case: LOCKED explanation, takes priority over everything else", () => {
  const result = explainUnavailableWorkflowActions({
    stepCategory: "TECHNICAL",
    actingRole: "AS_ENGINEER",
    isCaseLocked: true,
    isOnHold: true,
  });
  assert.deepEqual(result, { kind: "LOCKED", message: LOCKED_CASE_MESSAGE });
});

test("on hold (not locked): no explanation — the per-button hold reason is already specific enough", () => {
  const result = explainUnavailableWorkflowActions({
    stepCategory: "BUSINESS",
    actingRole: "AS_ENGINEER",
    isCaseLocked: false,
    isOnHold: true,
  });
  assert.equal(result, null);
});

test("AS_ENGINEER on a SALES-owned (BUSINESS) step: role-ownership explanation with the exact expected wording", () => {
  const result = explainUnavailableWorkflowActions({
    stepCategory: "BUSINESS",
    actingRole: "AS_ENGINEER",
    isCaseLocked: false,
    isOnHold: false,
  });
  assert.deepEqual(result, {
    kind: "ROLE_OWNED_BY_OTHER",
    owningRole: "SALES",
    message: "현재 단계는 영업 담당 단계입니다. 다음 작업은 영업 담당자가 진행할 수 있습니다.",
  });
});

test("AS_ENGINEER on an INVENTORY_MANAGER-owned (PARTS_SHIPMENT) step: role-ownership explanation with the exact expected wording", () => {
  const result = explainUnavailableWorkflowActions({
    stepCategory: "PARTS_SHIPMENT",
    actingRole: "AS_ENGINEER",
    isCaseLocked: false,
    isOnHold: false,
  });
  assert.deepEqual(result, {
    kind: "ROLE_OWNED_BY_OTHER",
    owningRole: "INVENTORY_MANAGER",
    message: "현재 단계는 재고/출하 담당 단계입니다. 다음 작업은 재고/출하 담당자가 진행할 수 있습니다.",
  });
});

test("AS_ENGINEER on their own TECHNICAL step: no foreign-role message", () => {
  const result = explainUnavailableWorkflowActions({
    stepCategory: "TECHNICAL",
    actingRole: "AS_ENGINEER",
    isCaseLocked: false,
    isOnHold: false,
  });
  assert.equal(result, null);
});

test("SALES viewing a TECHNICAL (AS_ENGINEER-owned) step also gets a role-ownership message — not AS_ENGINEER-specific", () => {
  const result = explainUnavailableWorkflowActions({
    stepCategory: "TECHNICAL",
    actingRole: "SALES",
    isCaseLocked: false,
    isOnHold: false,
  });
  assert.deepEqual(result, {
    kind: "ROLE_OWNED_BY_OTHER",
    owningRole: "AS_ENGINEER",
    message: "현재 단계는 기술(수리) 담당 단계입니다. 다음 작업은 담당 엔지니어가 진행할 수 있습니다.",
  });
});

test("ADMIN never sees a role-ownership message, even on a step normally owned by another role", () => {
  const result = explainUnavailableWorkflowActions({
    stepCategory: "BUSINESS",
    actingRole: "ADMIN",
    isCaseLocked: false,
    isOnHold: false,
  });
  assert.equal(result, null);
});

test("SUPER_ADMIN never sees a role-ownership message, even on a step normally owned by another role", () => {
  const result = explainUnavailableWorkflowActions({
    stepCategory: "PARTS_SHIPMENT",
    actingRole: "SUPER_ADMIN",
    isCaseLocked: false,
    isOnHold: false,
  });
  assert.equal(result, null);
});

test("분류가 없는 단계(종료 단계·건별로 끼워 넣은 단계): 설명 없음 — 담당을 지어내지 않는다", () => {
  const result = explainUnavailableWorkflowActions({
    stepCategory: null,
    actingRole: "AS_ENGINEER",
    isCaseLocked: false,
    isOnHold: false,
  });
  assert.equal(result, null);
});

// ────────────────────────────────────────────────────────────────────────────
// 🔴 분류의 정본은 DB 다 — TS 표(step-category.ts)와 달라도 DB 를 따른다
// ────────────────────────────────────────────────────────────────────────────
// [워크플로 관리]에서 단계 담당을 바꿔 새 판으로 게시하면 DB 의
// workflow_steps.category 가 표와 달라진다(2026-11-03 실측 — 개발 DB 의 현행 판
// 98단계 중 35개). 단추를 끄는 쪽과 서버 거절은 예전부터 DB 를 봤는데 이 배너만
// 표를 봐서, 되돌리기·보류가 **되는** 사람에게 남의 담당이라고 말했다.
//
// 🔵 아래 두 시험은 먼저 **표가 실제로 다른 값을 말한다는 것**을 못 박는다.
// 그 단언이 없으면 둘이 우연히 같은 값일 때 시험이 공짜로 통과하고, 누군가
// 배너를 표로 되돌려도 초록으로 남는다.

test("🔴 DB 분류가 표와 다르면 DB 를 따른다 — 표 BUSINESS, DB TECHNICAL 인 단계", () => {
  // 실측에서 나온 그 단계다. 표를 고쳐 둘이 같아지면 이 단언이 먼저 터진다 —
  // 그때는 표본을 아직 어긋나 있는 다른 단계로 바꿔야 한다.
  assert.equal(getStepCategory("PAID_MATCHER", "waiting_kyosan_reply"), "BUSINESS");

  const result = explainUnavailableWorkflowActions({
    stepCategory: "TECHNICAL",
    actingRole: "SALES",
    isCaseLocked: false,
    isOnHold: false,
  });
  // 표를 봤다면 SALES 는 제 담당 단계라 배너가 없었을 것이다.
  assert.deepEqual(result, {
    kind: "ROLE_OWNED_BY_OTHER",
    owningRole: "AS_ENGINEER",
    message: "현재 단계는 기술(수리) 담당 단계입니다. 다음 작업은 담당 엔지니어가 진행할 수 있습니다.",
  });
});

test("🔴 제보된 화면 — 출하 승인 단계의 담당을 A/S 엔지니어로 바꾼 건에서는 배너가 뜨지 않는다", () => {
  // 화면에 뜬 거짓말: 「담당: 관리자 또는 A/S 엔지니어」(DB 값) 바로 밑에
  // 「재고/출하 담당자가 진행할 수 있습니다」(표 값). 같은 화면에서
  // [이전 단계로 되돌리기]·[보류 시작]은 켜져 있었다 — 배너만 틀렸다.
  assert.equal(getStepCategory("PAID_MATCHER", "waiting_kyosan_shipment_approval"), "PARTS_SHIPMENT");

  const result = explainUnavailableWorkflowActions({
    stepCategory: "TECHNICAL",
    actingRole: "AS_ENGINEER",
    isCaseLocked: false,
    isOnHold: false,
  });
  assert.equal(result, null);
});

// ────────────────────────────────────────────────────────────────────────────
// 🔴 [출하 대기]는 [다음 단계로 진행]으로도 못 간다 (2026-11-03)
// ────────────────────────────────────────────────────────────────────────────
// 사용자 요구: 「[실행 가능한 작업]에서도 [다음 단계로 진행]을 통해서 출하대기로
// 넘어가지 못하도록 해줘.」 그 자리는 최종 출하 승인이 모두 끝날 때 시스템이
// 옮긴다 — 사람이 고르는 길은 전부 닫힌다.
//
// 🔴 **나가는 길은 그대로여야 한다.** 아래 마지막 둘이 그 못이다: 출하 대기에서
// 되돌리는 전이와 출하 완료로 나가는 전이는 걸리지 않는다. 걸리면 잘못 넘어간
// 건이 영영 갇힌다.

test("🔴 다음 단계가 [출하 대기]면 진행 단추가 까닭과 함께 꺼진다", () => {
  const result = evaluateTransitionAvailability({
    transition: transition({
      fromStepKey: "shipment_approved",
      toStepKey: "waiting_shipment",
      toStatus: "WAITING_SHIPMENT",
      allowedRoles: ["SUPER_ADMIN", "ADMIN", "INVENTORY_MANAGER"],
      requiresAssignedEngineer: false,
    }),
    actionCode: "STEP_ADVANCED",
    actingUser: user("SUPER_ADMIN"),
    assignedEngineerId: null,
    holdState: NOT_ON_HOLD,
    isCaseLocked: false,
    approvalGateStatus: "SATISFIED",
  });
  assert.deepEqual(result, { available: false, reason: SHIPMENT_WAITING_AUTO_ONLY_MESSAGE });
});

test("표본 점검 — 같은 전이에서 도착 상태만 바꾸면 진행할 수 있다(막는 것이 도착 상태 하나인가)", () => {
  const result = evaluateTransitionAvailability({
    transition: transition({
      fromStepKey: "shipment_approved",
      toStepKey: "waiting_shipment",
      toStatus: "WAITING_SHIPMENT_APPROVAL",
      allowedRoles: ["SUPER_ADMIN", "ADMIN", "INVENTORY_MANAGER"],
      requiresAssignedEngineer: false,
    }),
    actionCode: "STEP_ADVANCED",
    actingUser: user("SUPER_ADMIN"),
    assignedEngineerId: null,
    holdState: NOT_ON_HOLD,
    isCaseLocked: false,
    approvalGateStatus: "SATISFIED",
  });
  assert.deepEqual(result, { available: true });
});

test("🔴 까닭이 역할·담당 안내보다 먼저 나온다 — 역할을 바꿔도 안 되는 까닭을 알 수 있어야 한다", () => {
  const result = evaluateTransitionAvailability({
    transition: transition({
      fromStepKey: "shipment_approved",
      toStepKey: "waiting_shipment",
      toStatus: "WAITING_SHIPMENT",
      allowedRoles: ["INVENTORY_MANAGER"],
      requiresAssignedEngineer: true,
    }),
    actionCode: "STEP_ADVANCED",
    // 역할도 담당도 맞지 않는 사람 — 그래도 「자동으로만 간다」가 먼저여야 한다.
    actingUser: user("SALES"),
    assignedEngineerId: "someone-else",
    holdState: ON_HOLD,
    isCaseLocked: false,
    approvalGateStatus: "SATISFIED",
  });
  assert.deepEqual(result, { available: false, reason: SHIPMENT_WAITING_AUTO_ONLY_MESSAGE });
});

test("🔴 잠긴 건은 잠금이 먼저다 — 이 규칙이 더 먼저 말해야 할 것을 가리지 않는다", () => {
  const result = evaluateTransitionAvailability({
    transition: transition({ toStepKey: "waiting_shipment", toStatus: "WAITING_SHIPMENT" }),
    actionCode: "STEP_ADVANCED",
    actingUser: user("SUPER_ADMIN"),
    assignedEngineerId: null,
    holdState: NOT_ON_HOLD,
    isCaseLocked: true,
    approvalGateStatus: "SATISFIED",
  });
  assert.deepEqual(result, { available: false, reason: LOCKED_CASE_MESSAGE });
});

test("🔴 나가는 길 ① — 출하 대기에서 되돌리기는 막히지 않는다", () => {
  const result = evaluateTransitionAvailability({
    transition: transition({
      actionCode: "STEP_RETURNED",
      fromStepKey: "waiting_shipment",
      toStepKey: "shipment_approved",
      toStatus: "WAITING_SHIPMENT_APPROVAL",
      requiresAssignedEngineer: false,
    }),
    actionCode: "STEP_RETURNED",
    actingUser: user("SUPER_ADMIN"),
    assignedEngineerId: null,
    holdState: NOT_ON_HOLD,
    isCaseLocked: false,
    approvalGateStatus: "SATISFIED",
  });
  assert.deepEqual(result, { available: true });
});

test("🔴 나가는 길 ② — 출하 대기에서 출하 완료로 나가는 길은 막히지 않는다", () => {
  const result = evaluateTransitionAvailability({
    transition: transition({
      actionCode: "SHIPMENT_COMPLETED",
      fromStepKey: "waiting_shipment",
      toStepKey: "shipment_completed",
      toStatus: "SHIPMENT_COMPLETED",
      allowedRoles: ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES", "INVENTORY_MANAGER"],
      requiresAssignedEngineer: false,
      requiresReason: true,
      requiredApprovalType: "FINAL_SHIPMENT",
    }),
    actionCode: "SHIPMENT_COMPLETED",
    actingUser: user("SUPER_ADMIN"),
    assignedEngineerId: null,
    holdState: NOT_ON_HOLD,
    isCaseLocked: false,
    approvalGateStatus: "SATISFIED",
  });
  assert.deepEqual(result, { available: true });
});
