import type { Role } from "../../types";
import type { ActingUser } from "../approval/transitions";
import {
  isAdvanceIntoShipmentWaiting,
  SHIPMENT_WAITING_AUTO_ONLY_MESSAGE,
} from "../../shipment-waiting-auto-advance";
import { actorMay } from "@/lib/auth/developer-promotion";
import { checkHoldEligibilityForCategory, checkTransitionEligibility } from "./permissions";
import { roleForCategory, type StepCategory } from "./step-category";
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
 * enforces. checkTransitionEligibility/checkHoldEligibilityForCategory/
 * roleForCategory are reused verbatim, never duplicated.
 *
 * 🔴 이 파일은 **단계 분류(category)를 스스로 찾지 않는다** — 세 함수 모두
 * 인자로 받는다. 분류의 정본은 그 접수 건의 workflow_steps.category(DB)이고,
 * step-category.ts 의 TS 표는 이관 당시의 초기값일 뿐이다(2026-11-03). 여기서
 * 표를 한 번이라도 조회하면 화면이 서버와 다른 답을 말한다.
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
  // 🔴 [출하 대기]는 **사람이 눌러서 들어갈 수 없다**(2026-11-03 사용자 요구 —
  // 「[실행 가능한 작업]에서도 [다음 단계로 진행]을 통해서 출하대기로 넘어가지
  // 못하도록」). 최종 출하 승인이 모두 끝나면 시스템이 옮긴다
  // (db/mutations/shipment-waiting-auto-advance.ts).
  //
  // 🔵 **자리가 여기인 까닭** — 누가 누르든 같은 답이므로 역할·담당·승인 검사보다
  // 앞이다. 뒤에 두면 담당 엔지니어가 아닌 사람에게는 「담당자만 진행할 수
  // 있습니다」가 먼저 나와, 역할을 바꿔 봐도 안 되는 까닭을 끝내 모른다.
  // 🔴 잠금·전이 없음보다는 **뒤**다: 그 둘은 이 단추가 아예 성립하지 않는 경우라
  //    더 먼저 말해 주는 것이 맞다.
  //
  // 🔴 **단추를 숨기지 않고 까닭과 함께 끈다.** WorkflowActionList 가 reason 을
  // 단추 밑에 그대로 그린다 — 조용히 사라지면 사람은 고장으로 읽는다.
  if (isAdvanceIntoShipmentWaiting(params.actionCode, params.transition.toStatus)) {
    return { available: false, reason: SHIPMENT_WAITING_AUTO_ONLY_MESSAGE };
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

/**
 * 보류 시작/해제 버튼의 표시 판정. 단계의 담당 분류를 TS 표(getStepCategory)에서
 * 찾지 않고 **인자로 받는다** — 서버가 그 접수 건의 workflow_steps.category를 읽어
 * 넘겨 준다.
 *
 * 나눈 이유: TS 표는 워크플로 타입 + 단계 키로 찾는데, DB에는 그 표에 없는
 * 단계가 있을 수 있다(건별 변주로 추가한 case_step_N이 대표적이다). 그러면
 * 분류를 못 찾아 화면은 보류 버튼을 잠그는데 서버(checkHoldEligibilityForCategory,
 * DB 분류 사용)는 허용한다 — 눌리지 않는 버튼과 통과하는 요청이 어긋난다.
 * 판정 로직은 여전히 checkHoldEligibilityForCategory 한 벌뿐이고, 분류를 얻는
 * 경로만 화면과 서버가 같아진다. (분류를 TS 표에서 찾던 이전 판(evaluateHold-
 * Availability)은 이 함수로 대체되어 사라졌다 — 로컬/mock 패널은 예전부터
 * checkHoldEligibility를 직접 부르고 있어 영향이 없다.)
 */
export function evaluateHoldAvailabilityForCategory(params: {
  isRelease: boolean;
  actingUser: ActingUser | null;
  holdState: HoldState;
  stepCategory: StepCategory | null;
  assignedEngineerId: string | null;
  isCaseLocked: boolean;
}): ActionAvailability {
  if (params.isCaseLocked) {
    return { available: false, reason: LOCKED_CASE_MESSAGE };
  }
  if (!params.actingUser) return { available: false, reason: "로그인한 사용자 정보를 확인할 수 없습니다." };
  if (params.isRelease && !params.holdState.isOnHold) return { available: false, reason: "보류 중이 아닙니다." };
  if (!params.isRelease && params.holdState.isOnHold) return { available: false, reason: "이미 보류 중입니다." };

  const eligibility = checkHoldEligibilityForCategory(params.stepCategory, params.actingUser, params.assignedEngineerId);
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
 * 「실행 가능한 작업」이 통째로 막혀 보이는 까닭을 한 줄로 설명하는 안내 배너.
 * 꺼진 단추 수를 세어 지어내지 않고, 우선순위로 고른다 — 잠금 > 보류 중 >
 * 단계 담당이 남의 것 > 설명 없음.
 *
 * 🔴 **단계 분류를 인자로 받는다(2026-11-03).** 예전에는 여기서만
 * getStepCategory(step-category.ts)로 TS 표를 조회했다. 그 표는 스스로 머리말에
 * 「Stage E-1 데모 전용 설정 … 운영 업무 규칙 확정이 아님」이라 적어 둔 **초기값**
 * 이고, 운영에서는 [워크플로 관리] 화면이 단계마다 분류를 고쳐 새 판으로
 * 게시한다. 개발 DB 의 현행 판 98단계 중 35개가 표와 달랐다(2026-11-03 실측 —
 * 예: PAID_MATCHER/waiting_kyosan_reply 가 표 BUSINESS, DB TECHNICAL).
 *
 * 단추를 끄는 쪽(evaluateTransitionAvailability·evaluateHoldAvailabilityFor-
 * Category)과 서버 거절(workflow-transitions.ts)은 이미 DB 의
 * workflow_transitions.allowed_roles·workflow_steps.category 를 본다. 그래서
 * 되돌리기·보류가 **실제로 되는** A/S 엔지니어에게 이 배너만
 * 「재고/출하 담당자가 진행할 수 있습니다」라고 말했다. 판정이 아니라 설명이
 * 거짓말을 하는 쪽이라 오류가 한 번도 안 났고, 그래서 오래 남았다.
 *
 * 분류→역할 변환(roleForCategory)은 그대로 쓴다. 그건 단계마다 달라지는 값이
 * 아니라 고정 대응이고, 틀렸던 것은 **분류를 어디서 가져오는가**였다.
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
 *  - 분류가 없는 단계(stepCategory === null): 담당을 알 수 없으므로 아무것도
 *    주장하지 않는다. 종료 단계와, 건별로 끼워 넣어 DB 에만 있는 단계
 *    (case_step_N)가 여기 해당한다 — 보류 판정이 그 둘을 다루는 방식과 같다.
 *  - the acting role's category already matches the step's category.
 */
export function explainUnavailableWorkflowActions(params: {
  /** 그 접수 건의 현재 단계 분류 — 서버가 읽어 내려준 DB 값(WorkflowRulesDto.steps[].category). */
  stepCategory: StepCategory | null;
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

  if (!params.stepCategory) return null;

  const owningRole = roleForCategory(params.stepCategory);
  if (owningRole === params.actingRole) return null;

  return {
    kind: "ROLE_OWNED_BY_OTHER",
    message: `현재 단계는 ${STAGE_LABEL[owningRole]}입니다. 다음 작업은 ${ACTOR_LABEL[owningRole]}가 진행할 수 있습니다.`,
    owningRole,
  };
}

/**
 * "이 건에만 단계 추가"(case-workflow-steps.ts) 버튼의 표시 판정.
 *
 * 전이가 아니라 워크플로 자체를 손대는 조작이므로 위의 두 함수와 규칙이 다르다.
 * 보류 중에도 막지 않는다 — 단계를 하나 정의하는 것은 이 수리품에 대한 작업이
 * 아니라 앞으로 할 일을 적어 두는 것이고, 보류는 작업을 멈추는 것이지 계획을
 * 멈추는 것이 아니다. 반대로 잠금(출하 완료)은 막는다: 끝난 건의 워크플로를
 * 바꿀 이유가 없다.
 *
 * 담당 엔지니어 본인만 쓸 수 있다(사용자 결정). 관리자는 이 앱의 다른 모든
 * 담당 검사와 마찬가지로 우회한다. 여기서의 판정은 화면 힌트일 뿐이고
 * addCaseWorkflowStep()이 DB를 다시 읽어 같은 판정을 독립적으로 수행한다.
 */
export function evaluateAddCaseStepAvailability(params: {
  actingUser: ActingUser | null;
  assignedEngineerId: string | null;
  isCaseLocked: boolean;
}): ActionAvailability {
  if (params.isCaseLocked) return { available: false, reason: LOCKED_CASE_MESSAGE };
  if (!params.actingUser) return { available: false, reason: "로그인한 사용자 정보를 확인할 수 없습니다." };

  // 문을 **여는** 자리 — 「최고관리자·관리자면 담당 검사를 건너뛴다」. 승격은
  // 개발자가 이 문을 통과하는 방향이다(permissions.ts 의 두 창구 주석).
  // 서버(mutations/case-workflow-steps.ts)가 같은 식을 독립적으로 계산한다 —
  // 한쪽만 고치면 「보이는데 저장은 거절」 또는 그 반대가 된다.
  if (actorMay(params.actingUser, (role) => role === "SUPER_ADMIN" || role === "ADMIN")) {
    return { available: true };
  }
  const role = params.actingUser.role;
  // 개발자는 위에서 이미 통과했으므로 아래 두 검사에 닿지 않는다 — 여기서
  // 승격할 것이 없다. 배정 사실 비교도 그대로 둔다(역할 축만 더한다).
  if (role !== "AS_ENGINEER") {
    return { available: false, reason: "담당 엔지니어 또는 관리자만 단계를 추가할 수 있습니다." };
  }
  if (params.assignedEngineerId !== params.actingUser.id) {
    return { available: false, reason: "이 접수 건의 담당 엔지니어만 단계를 추가할 수 있습니다." };
  }
  return { available: true };
}
