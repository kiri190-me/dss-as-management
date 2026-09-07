import type { WorkflowType } from "../../types";
import type { ActingUser } from "../approval/transitions";
import { actorHasAllowedRole, actorMay } from "@/lib/auth/developer-promotion";
import { getStepCategory, roleForCategory, type StepCategory } from "./step-category";
import type { TransitionDefinition } from "./transition-definitions";
import type { HoldState } from "./workflow-types";

export type PermissionCheckResult = { allowed: true } | { allowed: false; reason: string };

function isApprovedAccount(user: ActingUser): boolean {
  return user.approvalStatus === "APPROVED";
}

/**
 * ============================================================================
 * 🔴 이 파일의 역할 비교는 두 종류다 — 방향을 틀리면 정반대가 된다
 * ============================================================================
 * 자리마다 물어야 한다: **이 비교가 문을 「여는」 것인가 「조이는」 것인가.**
 *
 *  - 여는 자리 — 「최고관리자·관리자면 담당 검사를 건너뛴다」.
 *    승격은 개발자가 그 문을 **통과하게** 한다 → `maySkipAssignmentCheck`
 *  - 조이는 자리 — 「엔지니어일 뿐이면 담당 조건을 더 건다」.
 *    승격은 개발자가 그 제약에 **걸리지 않게** 한다 → `isEngineerOnly`
 *
 * 조이는 자리에 순진하게 `actorMay` 를 씌우면 방향이 뒤집혀 **개발자에게
 * 제약이 더 붙는다.** 그래서 두 창구를 이름으로 갈라 둔다.
 *
 * ⚠️ 배정 **사실**은 어느 쪽에서도 손대지 않는다. `assignedEngineerId` ·
 * `actingUser.id` 비교는 그대로다 — 바뀌는 것은 「배정이 요구되는가」라는
 * 역할 축뿐이다(developer-promotion.ts).
 *
 * ⚠️ 승인 상태(`isApprovedAccount`)도 승격하지 않는다. 승인 안 된 개발자는
 * 여전히 아무것도 못 하고, 그 검사가 가장 먼저 오는 순서도 그대로다.
 * ============================================================================
 */

/**
 * 문을 **여는** 쪽: 담당 엔지니어 검사를 건너뛰는 역할인가.
 * 최고관리자가 건너뛰므로, 더한 결과 개발자도 건너뛴다(「최고관리자 동급」).
 */
function maySkipAssignmentCheck(user: ActingUser): boolean {
  return actorMay(user, (role) => role === "SUPER_ADMIN" || role === "ADMIN");
}

/**
 * 제약을 **조이는** 쪽: 「엔지니어일 뿐인가」. 최고관리자로도 볼 수 없는
 * 사람일 때만 참이다 — 그래서 개발자 엔지니어에게는 추가 제약이 붙지 않는다.
 *
 * 표시가 꺼진 계정의 답은 예전 `role === "AS_ENGINEER"` 와 한 톨도 다르지 않다.
 */
function isEngineerOnly(user: ActingUser): boolean {
  return !actorMay(user, (role) => role !== "AS_ENGINEER");
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
  // 🔴 전이의 허용 역할은 초안 편집기에서 사람이 정하는 값이다. 어떤 전이를
  // ["AS_ENGINEER"] 만으로 만들어 두면, 승격을 「갈아치우기」로 구현했을 때
  // 개발자 엔지니어는 진짜 역할로는 통과하는데 승격 뒤에는 막힌다. 더하기라서
  // 그런 일이 없다 — 진짜 역할이 있거나 최고관리자가 있으면 통과한다
  // (developer-promotion.ts).
  if (!actorHasAllowedRole(actingUser, transition.allowedRoles)) {
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
  // 문을 **여는** 자리 — 승격은 개발자가 통과하는 방향이다(위 두 창구 주석).
  if (maySkipAssignmentCheck(actingUser)) return { allowed: true };
  // 이 부정형도 통과를 반환하므로 **여는** 자리다. 개발자는 이미 위에서
  // 통과했으니 여기서 따로 승격할 것이 없다.
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
  // 문을 **여는** 자리 — 최고관리자·관리자는 분류도 담당도 보지 않는다.
  // 승격하면 개발자도 같다(분류가 없는 단계까지 포함해 최고관리자와 같은 답).
  if (maySkipAssignmentCheck(actingUser)) return { allowed: true };

  if (!category) {
    return { allowed: false, reason: "이 단계에서는 보류를 시작하거나 해제할 수 없습니다." };
  }
  const requiredRole = roleForCategory(category);
  if (actingUser.role !== requiredRole) {
    return { allowed: false, reason: "현재 역할로는 이 단계에서 보류를 시작하거나 해제할 수 없습니다." };
  }
  // 이 비교는 **행위자가 아니라 단계 분류에서 나온 값**(requiredRole)을 본다 —
  // 승격 대상이 아니다. 개발자는 위에서 이미 통과했으므로 여기까지 오지 않는다.
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
  // 문을 **여는** 자리 — 세 역할에게 열린 허용 목록을 부정형으로 적은 것이다.
  // 승격은 개발자가 이 문을 통과하게 한다.
  if (
    !actorMay(
      actingUser,
      (role) => role === "SUPER_ADMIN" || role === "ADMIN" || role === "AS_ENGINEER"
    )
  ) {
    return { allowed: false, reason: "현재 역할로는 단계를 직접 변경할 수 없습니다." };
  }
  // 🔴 여기는 제약을 **조이는** 자리다 — 「엔지니어일 뿐이면 자기 담당 건만」.
  // 순진하게 actorMay 를 씌우면 개발자에게 제약이 하나 더 붙는다(정반대).
  // 최고관리자로도 볼 수 없는 사람일 때만 들어가야 한다 — isEngineerOnly.
  if (isEngineerOnly(actingUser)) {
    if (!assignedEngineerId) {
      return { allowed: false, reason: "이 접수 건에는 담당 엔지니어가 배정되어 있지 않습니다." };
    }
    if (assignedEngineerId !== actingUser.id) {
      return { allowed: false, reason: "담당 엔지니어만 단계를 직접 변경할 수 있습니다." };
    }
  }
  return checkNotOnHold(holdState, false);
}
