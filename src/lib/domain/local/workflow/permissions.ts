import type { WorkflowType } from "../../types";
import type { ActingUser } from "../approval/transitions";
import { getStepCategory, roleForCategory } from "./step-category";
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
  if (!isApprovedAccount(actingUser)) {
    return { allowed: false, reason: "승인되지 않은 계정은 이 작업을 수행할 수 없습니다." };
  }
  if (actingUser.role === "SUPER_ADMIN" || actingUser.role === "ADMIN") return { allowed: true };

  const category = getStepCategory(workflowType, stepKey);
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
