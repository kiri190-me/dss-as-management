import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateTransitionAvailability,
  evaluateHoldAvailabilityForCategory,
  explainUnavailableWorkflowActions,
  LOCKED_CASE_MESSAGE,
} from "./workflow-action-availability";
import type { TransitionDefinition } from "./transition-definitions";
import type { HoldState } from "./workflow-types";
import type { ActingUser } from "../approval/transitions";

const NOT_ON_HOLD: HoldState = { isOnHold: false, reason: null, startedByUserId: null, startedByNameSnapshot: null, startedAt: null };
const ON_HOLD: HoldState = { isOnHold: true, reason: "부품 대기", startedByUserId: "u-hold", startedByNameSnapshot: "테스트", startedAt: "2026-01-01T00:00:00Z" };

function user(role: ActingUser["role"], overrides: Partial<ActingUser> = {}): ActingUser {
  return { id: "actor-1", name: "테스트 사용자", role, approvalStatus: "APPROVED", ...overrides };
}

function transition(overrides: Partial<TransitionDefinition> = {}): TransitionDefinition {
  return {
    id: "t-1",
    workflowType: "MATCHER",
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

test("locked case: LOCKED explanation, takes priority over everything else", () => {
  const result = explainUnavailableWorkflowActions({
    workflowType: "MATCHER",
    currentStepKey: "repair_in_progress",
    actingRole: "AS_ENGINEER",
    isCaseLocked: true,
    isOnHold: true,
  });
  assert.deepEqual(result, { kind: "LOCKED", message: LOCKED_CASE_MESSAGE });
});

test("on hold (not locked): no explanation — the per-button hold reason is already specific enough", () => {
  const result = explainUnavailableWorkflowActions({
    workflowType: "MATCHER",
    currentStepKey: "waiting_po",
    actingRole: "AS_ENGINEER",
    isCaseLocked: false,
    isOnHold: true,
  });
  assert.equal(result, null);
});

test("AS_ENGINEER on a SALES-owned (BUSINESS) step: role-ownership explanation with the exact expected wording", () => {
  const result = explainUnavailableWorkflowActions({
    workflowType: "MATCHER",
    currentStepKey: "waiting_po",
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
    workflowType: "MATCHER",
    currentStepKey: "parts_supply",
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
    workflowType: "MATCHER",
    currentStepKey: "repair_in_progress",
    actingRole: "AS_ENGINEER",
    isCaseLocked: false,
    isOnHold: false,
  });
  assert.equal(result, null);
});

test("SALES viewing a TECHNICAL (AS_ENGINEER-owned) step also gets a role-ownership message — not AS_ENGINEER-specific", () => {
  const result = explainUnavailableWorkflowActions({
    workflowType: "MATCHER",
    currentStepKey: "repair_in_progress",
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
    workflowType: "MATCHER",
    currentStepKey: "waiting_po",
    actingRole: "ADMIN",
    isCaseLocked: false,
    isOnHold: false,
  });
  assert.equal(result, null);
});

test("SUPER_ADMIN never sees a role-ownership message, even on a step normally owned by another role", () => {
  const result = explainUnavailableWorkflowActions({
    workflowType: "MATCHER",
    currentStepKey: "parts_supply",
    actingRole: "SUPER_ADMIN",
    isCaseLocked: false,
    isOnHold: false,
  });
  assert.equal(result, null);
});

test("a step with no category entry (e.g. a terminal step): no explanation, never guessed", () => {
  const result = explainUnavailableWorkflowActions({
    workflowType: "MATCHER",
    currentStepKey: "shipment_completed",
    actingRole: "AS_ENGINEER",
    isCaseLocked: false,
    isOnHold: false,
  });
  assert.equal(result, null);
});
