import type { WorkflowType } from "../../types";
import type { ActingUser } from "../approval/transitions";
import { getStepCategory, roleForCategory, type StepCategory } from "./step-category";
import type { TransitionDefinition } from "./transition-definitions";
import type { HoldState } from "./workflow-types";

export type PermissionCheckResult = { allowed: true } | { allowed: false; reason: string };

function isApprovedAccount(user: ActingUser): boolean {
  return user.approvalStatus === "APPROVED";
}

/**
 * 역할/승인 계정 자격만 확인한다(담당 엔지니어 일치 여부는 별도
 * checkAssignedEngineer에서 확인한다 — 두 검사를 분리해 각각 다른 한국어
 * 메시지를 보여줄 수 있게 한다).
 */
export function checkRoleEligibility(
  transition: TransitionDefinition,
  actingUser: ActingUser
): PermissionCheckResult {
  if (!isApprovedAccount(actingUser)) {
    return { allowed: false, reason: "승인되지 않은 계정은 이 작업을 수행할 수 없습니다." };
  }
  if (!transition.allowedRoles.includes(actingUser.role)) {
    return { allowed: false, reason: "현재 역할로는 이 작업을 수행할 수 없습니다." };
  }
  return { allowed: true };
}

/**
 * SUPER_ADMIN/ADMIN은 담당 엔지니어 일치 여부를 검사하지 않는다(우회).
 * AS_ENGINEER는 담당 엔지니어가 배정되어 있어야 하고, 배정된 엔지니어와
 * actingUser.id가 정확히 같아야 한다.
 */
export function checkAssignedEngineer(
  transition: TransitionDefinition,
  actingUser: ActingUser,
  assignedEngineerId: string | null
): PermissionCheckResult {
  if (!transition.requiresAssignedEngineer) return { allowed: true };
  if (actingUser.role === "SUPER_ADMIN" || actingUser.role === "ADMIN") return { allowed: true };
  if (actingUser.role !== "AS_ENGINEER") return { allowed: true }; // 역할 검사는 checkRoleEligibility가 담당

  if (!assignedEngineerId) {
    return { allowed: false, reason: "이 접수 건에는 담당 엔지니어가 배정되어 있지 않습니다." };
  }
  if (assignedEngineerId !== actingUser.id) {
    return { allowed: false, reason: "담당 엔지니어만 이 작업을 수행할 수 있습니다." };
  }
  return { allowed: true };
}

/**
 * HOLD_STARTED/HOLD_RELEASED는 transition-definitions.ts에 행이 없다(단계를
 * 이동하지 않으므로). 대신 현재 단계의 step-category.ts 분류로 자격을
 * 판정한다 — SUPER_ADMIN/ADMIN은 항상 허용, 그 외에는 해당 카테고리에 대응하는
 * 단일 역할만 허용하며 AS_ENGINEER는 담당 엔지니어 일치까지 확인한다.
 */
export function checkHoldEligibility(
  workflowType: WorkflowType,
  stepKey: string,
  actingUser: ActingUser,
  assignedEngineerId: string | null
): PermissionCheckResult {
  // 로컬(mock) 모드 전용 진입점 — 분류를 TS 표에서 찾아 아래 공통 판정에
  // 넘긴다. DB 모드는 checkHoldEligibilityForCategory를 직접 호출해 DB의
  // workflow_steps.category를 넘긴다(Phase 2). 판정 로직 자체는 한 벌뿐이다.
  return checkHoldEligibilityForCategory(
    getStepCategory(workflowType, stepKey) ?? null,
    actingUser,
    assignedEngineerId
  );
}

/**
 * 보류 자격 판정의 실제 구현. 단계의 담당 분류를 **인자로 받는다** — 분류를
 * 어디서 얻었는지(TS 표인지 DB인지)는 판정과 무관해야 하기 때문이다.
 * Phase 2에서 규칙 출처를 DB로 옮기면서, 이 함수를 두 벌로 복제하는 대신
 * 입력만 분리했다.
 */
export function checkHoldEligibilityForCategory(
  category: StepCategory | null,
  actingUser: ActingUser,
  assignedEngineerId: string | null
): PermissionCheckResult {
  if (!isApprovedAccount(actingUser)) {
    return { allowed: false, reason: "승인되지 않은 계정은 이 작업을 수행할 수 없습니다." };
  }
  if (actingUser.role === "SUPER_ADMIN" || actingUser.role === "ADMIN") return { allowed: true };

  if (!category) {
    return { allowed: false, reason: "이 단계에서는 보류를 시작하거나 해제할 수 없습니다." };
  }
  const requiredRole = roleForCategory(category);
  if (actingUser.role !== requiredRole) {
    return { allowed: false, reason: "현재 역할로는 이 단계에서 보류를 시작하거나 해제할 수 없습니다." };
  }
  if (requiredRole === "AS_ENGINEER") {
    if (!assignedEngineerId) {
      return { allowed: false, reason: "이 접수 건에는 담당 엔지니어가 배정되어 있지 않습니다." };
    }
    if (assignedEngineerId !== actingUser.id) {
      return { allowed: false, reason: "담당 엔지니어만 이 작업을 수행할 수 있습니다." };
    }
  }
  return { allowed: true };
}

export function checkNotOnHold(holdState: HoldState, isReleaseAction: boolean): PermissionCheckResult {
  if (!holdState.isOnHold) return { allowed: true };
  if (isReleaseAction) return { allowed: true };
  return { allowed: false, reason: "보류 중에는 다른 작업을 수행할 수 없습니다. 먼저 보류를 해제하세요." };
}

/** 하나라도 실패하면 그 사유를 반환한다(순서대로 역할 → 담당 엔지니어 → 보류 상태). */
export function checkTransitionEligibility(
  transition: TransitionDefinition,
  actingUser: ActingUser,
  assignedEngineerId: string | null,
  holdState: HoldState
): PermissionCheckResult {
  const role = checkRoleEligibility(transition, actingUser);
  if (!role.allowed) return role;

  const engineer = checkAssignedEngineer(transition, actingUser, assignedEngineerId);
  if (!engineer.allowed) return engineer;

  const hold = checkNotOnHold(holdState, false);
  if (!hold.allowed) return hold;

  return { allowed: true };
}

/**
 * 작업내용 탭의 "현재 단계 직접 변경"(STEP_SET_MANUALLY) 자격 판정이다.
 * 정규 전이가 아니므로 TransitionDefinition 행이 존재하지 않고, 따라서
 * checkTransitionEligibility를 재사용할 수 없다 — 대신 그 함수와 같은 순서
 * (역할 → 담당 엔지니어 → 보류)로 같은 성격의 검사를 수행한다.
 *
 * 허용 역할은 SUPER_ADMIN/ADMIN/AS_ENGINEER이며(2026-08-18 승인), AS_ENGINEER는
 * 자신이 담당으로 배정된 접수 건만 변경할 수 있다 — 교정 반환(STEP_RETURNED)에
 * 적용한 것과 동일한 제약이다. SALES/INVENTORY_MANAGER는 단계 자체를 임의로
 * 옮길 수 없다(정규 전이에서 각자 담당 구간을 진행하는 것은 그대로 가능하다).
 *
 * 잠금(is_locked)은 여기서 보지 않는다 — 호출부가 전이와 동일하게 가장 먼저,
 * 무조건 검사한다(workflow-transitions.ts / DatabaseWorkflowControlPanel의
 * isCaseLocked 처리와 같은 규율). 이 함수에 잠금 검사를 넣으면 두 곳에서
 * 서로 다른 메시지가 나올 수 있다.
 */
export function checkManualStepSetEligibility(
  actingUser: ActingUser,
  assignedEngineerId: string | null,
  holdState: HoldState
): PermissionCheckResult {
  if (!isApprovedAccount(actingUser)) {
    return { allowed: false, reason: "승인되지 않은 계정은 이 작업을 수행할 수 없습니다." };
  }
  if (
    actingUser.role !== "SUPER_ADMIN" &&
    actingUser.role !== "ADMIN" &&
    actingUser.role !== "AS_ENGINEER"
  ) {
    return { allowed: false, reason: "현재 역할로는 단계를 직접 변경할 수 없습니다." };
  }
  if (actingUser.role === "AS_ENGINEER") {
    if (!assignedEngineerId) {
      return { allowed: false, reason: "이 접수 건에는 담당 엔지니어가 배정되어 있지 않습니다." };
    }
    if (assignedEngineerId !== actingUser.id) {
      return { allowed: false, reason: "담당 엔지니어만 단계를 직접 변경할 수 있습니다." };
    }
  }
  return checkNotOnHold(holdState, false);
}
