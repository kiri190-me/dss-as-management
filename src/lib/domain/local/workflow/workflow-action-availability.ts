import type { Role, WorkflowType } from "../../types";
import type { ActingUser } from "../approval/transitions";
import { checkHoldEligibility, checkTransitionEligibility } from "./permissions";
import { getStepCategory, roleForCategory } from "./step-category";
import type { TransitionDefinition } from "./transition-definitions";
import type { HoldState } from "./workflow-types";

/**
 * Phase 5C-3 follow-up — pure, UI-framework-free availability/explanation
 * logic for the DATABASE-mode workflow action panel
 * (DatabaseWorkflowControlPanel.tsx), extracted so the reported
 * "all actions disabled" state can be unit-tested directly rather than only
 * through a full component render (which needs a Next.js router context
 * this module deliberately has no dependency on).
 *
 * Deliberately scoped to DatabaseWorkflowControlPanel only — the local/mock
 * panel (WorkflowControlPanel.tsx) resolves approval status from a
 * different source (the local approval store, not a DB-fetched
 * currentApprovals array) and was explicitly out of scope for this fix.
 *
 * No workflow ownership rule, transition definition, or backend semantic is
 * changed here — this file only decides what the UI *shows* for a state the
 * backend (workflow-transitions.ts) already independently computes and
 * enforces. checkTransitionEligibility/checkHoldEligibility/getStepCategory/
 * roleForCategory are reused verbatim, never duplicated.
 */

export type ActionAvailability = { available: true } | { available: false; reason: string };

/** Same wording used for both the per-button reason and the summary banner — kept as one constant so the two can never drift apart. Mirrors (not identical to, since this is a UI hint, not the actual rejection) workflow-transitions.ts's own CASE_LOCKED message. */
export const LOCKED_CASE_MESSAGE = "출하 완료로 잠긴 건은 워크플로를 변경할 수 없습니다.";

export type ApprovalGateStatus = "SATISFIED" | "NOT_APPROVED" | "STALE";

/**
 * Mirrors DatabaseWorkflowControlPanel's original evaluate() exactly, with
 * one addition: repair-case lock is now checked first, unconditionally for
 * every role (no admin/superadmin bypass) — matching
 * workflow-transitions.ts's own `if (current.isLocked)` check, which has
 * always applied to every actionCode before this fix, in the backend.
 */
export function evaluateTransitionAvailability(params: {
  transition: TransitionDefinition | null;
  actionCode: "STEP_ADVANCED" | "STEP_RETURNED" | "SHIPMENT_COMPLETED";
  actingUser: ActingUser | null;
  assignedEngineerId: string | null;
  holdState: HoldState;
  isCaseLocked: boolean;
  approvalGateStatus: ApprovalGateStatus;
}): ActionAvailability {
  if (params.isCaseLocked) {
    return { available: false, reason: LOCKED_CASE_MESSAGE };
  }

  if (!params.transition) {
    return {
      available: false,
      reason:
        params.actionCode === "STEP_ADVANCED"
          ? "이 단계에서는 다음 단계로 진행할 수 없습니다."
          : params.actionCode === "STEP_RETURNED"
            ? "이 단계에서는 이전 단계로 되돌릴 수 없습니다."
            : "현재 단계에서는 출하 완료 처리를 할 수 없습니다.",
    };
  }
  if (!params.actingUser) {
    return { available: false, reason: "로그인한 사용자 정보를 확인할 수 없습니다." };
  }

  const eligibility = checkTransitionEligibility(params.transition, params.actingUser, params.assignedEngineerId, params.holdState);
  if (!eligibility.allowed) return { available: false, reason: eligibility.reason };

  if (params.transition.requiredApprovalType && params.approvalGateStatus !== "SATISFIED") {
    return {
      available: false,
      reason:
        params.approvalGateStatus === "STALE"
          ? "접수 건 정보가 승인 이후 변경되어 기존 승인을 다시 받아야 합니다."
          : params.transition.requiredApprovalType === "REPAIR_INSPECTION"
            ? "수리 검수 승인이 완료되어야 합니다."
            : "최종 출하 승인이 완료되어야 합니다.",
    };
  }
  return { available: true };
}

/** Mirrors DatabaseWorkflowControlPanel's original evaluateHold() exactly, with the same unconditional lock check added first. */
export function evaluateHoldAvailability(params: {
  isRelease: boolean;
  actingUser: ActingUser | null;
  holdState: HoldState;
  workflowType: WorkflowType;
  currentStepKey: string;
  assignedEngineerId: string | null;
  isCaseLocked: boolean;
}): ActionAvailability {
  if (params.isCaseLocked) {
    return { available: false, reason: LOCKED_CASE_MESSAGE };
  }
  if (!params.actingUser) return { available: false, reason: "로그인한 사용자 정보를 확인할 수 없습니다." };
  if (params.isRelease && !params.holdState.isOnHold) return { available: false, reason: "보류 중이 아닙니다." };
  if (!params.isRelease && params.holdState.isOnHold) return { available: false, reason: "이미 보류 중입니다." };

  const eligibility = checkHoldEligibility(params.workflowType, params.currentStepKey, params.actingUser, params.assignedEngineerId);
  if (!eligibility.allowed) return { available: false, reason: eligibility.reason };
  return { available: true };
}

// roleForCategory (step-category.ts) only ever returns AS_ENGINEER/SALES/
// INVENTORY_MANAGER — SUPER_ADMIN/ADMIN entries below are unreachable
// (explainUnavailableWorkflowActions returns null for those roles before
// this table is consulted) but included so `Record<Role, string>` stays a
// total, safely-indexable map rather than a narrowed-and-cast one.
const STAGE_LABEL: Record<Role, string> = {
  AS_ENGINEER: "기술(수리) 담당 단계",
  SALES: "영업 담당 단계",
  INVENTORY_MANAGER: "재고/출하 담당 단계",
  SUPER_ADMIN: "",
  ADMIN: "",
};
const ACTOR_LABEL: Record<Role, string> = {
  AS_ENGINEER: "담당 엔지니어",
  SALES: "영업 담당자",
  INVENTORY_MANAGER: "재고/출하 담당자",
  SUPER_ADMIN: "",
  ADMIN: "",
};

export type WorkflowActionExplanation =
  | { kind: "LOCKED"; message: string }
  | { kind: "ROLE_OWNED_BY_OTHER"; message: string; owningRole: Role }
  | null;

/**
 * One summary explanation for why the action list may look entirely
 * unavailable, chosen by priority (locked > active hold > role-ownership
 * mismatch > no explanation) — never invented from counting disabled
 * buttons, always derived from the same authoritative
 * getStepCategory/roleForCategory table transition-definitions.ts and
 * permissions.ts already use for the real eligibility checks above, so
 * this can never drift into a second, competing workflow-step-to-role
 * source of truth.
 *
 * Returns null (no banner) when:
 *  - the case is on hold: checkNotOnHold already attaches a specific,
 *    correct per-button reason to advance/return/ship — a role-ownership
 *    banner here would be actively misleading (the real blocker is the
 *    hold, not who owns this step).
 *  - actingRole is SUPER_ADMIN/ADMIN: their authorization bypass
 *    (checkRoleEligibility/checkAssignedEngineer/checkHoldEligibility all
 *    special-case these two roles) means step ownership never actually
 *    blocks them, so the message would be false.
 *  - the step has no category entry (e.g. a genuinely terminal step) —
 *    ownership can't be determined, so nothing is claimed.
 *  - the acting role's category already matches the step's category.
 */
export function explainUnavailableWorkflowActions(params: {
  workflowType: WorkflowType;
  currentStepKey: string;
  actingRole: Role;
  isCaseLocked: boolean;
  isOnHold: boolean;
}): WorkflowActionExplanation {
  if (params.isCaseLocked) {
    return { kind: "LOCKED", message: LOCKED_CASE_MESSAGE };
  }
  if (params.isOnHold) {
    return null;
  }
  if (params.actingRole === "SUPER_ADMIN" || params.actingRole === "ADMIN") {
    return null;
  }

  const category = getStepCategory(params.workflowType, params.currentStepKey);
  if (!category) return null;

  const owningRole = roleForCategory(category);
  if (owningRole === params.actingRole) return null;

  return {
    kind: "ROLE_OWNED_BY_OTHER",
    message: `현재 단계는 ${STAGE_LABEL[owningRole]}입니다. 다음 작업은 ${ACTOR_LABEL[owningRole]}가 진행할 수 있습니다.`,
    owningRole,
  };
}
