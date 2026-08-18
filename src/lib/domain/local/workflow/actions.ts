import type { RepairStatus, WorkflowType } from "../../types";
import type { ActingUser } from "../approval/transitions";
import { resolveVerifiedApprovalRecordId } from "./approval-lookup";
import { checkHoldEligibility, checkNotOnHold, checkTransitionEligibility } from "./permissions";
import { findTransitionDefinition } from "./transition-definitions";
import { getWorkflowStoreSnapshot, writeWorkflowEnvelope } from "./workflow-storage";
import {
  RELEASED_HOLD_STATE,
  type HoldState,
  type LocalWorkflowEvent,
  type LocalWorkflowState,
} from "./workflow-types";
import { validateWorkflowEvent, validateWorkflowState } from "./validation";
import { generateClientUuid } from "@/lib/client-uuid";

function generateStateId(): string {
  return `workflow-state-${generateClientUuid()}`;
}
function generateEventId(): string {
  return `workflow-event-${generateClientUuid()}`;
}

export type WorkflowActionErrorReason =
  | "NOT_FOUND_TRANSITION"
  | "NOT_ELIGIBLE"
  | "ON_HOLD"
  | "ALREADY_ON_HOLD"
  | "NOT_ON_HOLD"
  | "REASON_REQUIRED"
  | "APPROVAL_NOT_SATISFIED"
  | "STORAGE_CONFLICT";

export type WorkflowActionResult =
  | { ok: true; state: LocalWorkflowState }
  | { ok: false; reason: WorkflowActionErrorReason; message: string };

type BaseInput = {
  repairCaseId: string;
  workflowType: WorkflowType;
  assignedEngineerId: string | null;
  /** 아직 로컬 재정의가 없을 때만 쓰이는 원본 ResolvedRepairCase 값이다. */
  baselineStatus: RepairStatus;
  baselineStepKey: string;
  actingUser: ActingUser;
};

type CurrentResolved = {
  existing: LocalWorkflowState | null;
  status: RepairStatus;
  stepKey: string;
  holdState: HoldState;
};

function resolveCurrent(
  states: readonly LocalWorkflowState[],
  input: BaseInput
): CurrentResolved {
  const existing = states.find((s) => s.repairCaseId === input.repairCaseId) ?? null;
  if (existing) {
    return { existing, status: existing.currentStatus, stepKey: existing.currentWorkflowStepKey, holdState: existing.holdState };
  }
  return { existing: null, status: input.baselineStatus, stepKey: input.baselineStepKey, holdState: RELEASED_HOLD_STATE };
}

/**
 * 모든 액션이 거치는 단일 커밋 경로다 — 만든 state/event를 저장소 검증
 * 규칙으로 재검증한 뒤 전체 배열을 한 번의 setItem으로 함께 쓴다.
 */
function commit(
  currentStates: readonly LocalWorkflowState[],
  currentEvents: readonly LocalWorkflowEvent[],
  nextState: LocalWorkflowState,
  nextEvent: LocalWorkflowEvent
): WorkflowActionResult {
  if (!validateWorkflowState(nextState)) {
    return { ok: false, reason: "STORAGE_CONFLICT", message: "저장 중 충돌이 발생했습니다. 다시 시도해 주세요." };
  }
  const nextStates = [...currentStates.filter((s) => s.id !== nextState.id), nextState];
  const statesById = new Map(nextStates.map((s) => [s.id, s]));
  if (!validateWorkflowEvent(nextEvent, { statesById })) {
    return { ok: false, reason: "STORAGE_CONFLICT", message: "저장 중 충돌이 발생했습니다. 다시 시도해 주세요." };
  }
  const nextEvents = [...currentEvents, nextEvent];
  writeWorkflowEnvelope(nextStates, nextEvents);
  return { ok: true, state: nextState };
}

export type AdvanceOrReturnInput = BaseInput & { reason?: string };

export function advanceStep(input: AdvanceOrReturnInput): WorkflowActionResult {
  const { states, events } = getWorkflowStoreSnapshot();
  const current = resolveCurrent(states, input);

  const transition = findTransitionDefinition(input.workflowType, "STEP_ADVANCED", current.stepKey);
  if (!transition) {
    return { ok: false, reason: "NOT_FOUND_TRANSITION", message: "이 단계에서는 다음 단계로 진행할 수 없습니다." };
  }

  const hold = checkNotOnHold(current.holdState, false);
  if (!hold.allowed) return { ok: false, reason: "ON_HOLD", message: hold.reason };

  const eligibility = checkTransitionEligibility(transition, input.actingUser, input.assignedEngineerId, current.holdState);
  if (!eligibility.allowed) return { ok: false, reason: "NOT_ELIGIBLE", message: eligibility.reason };

  let relatedApprovalRecordId: string | null = null;
  if (transition.requiredApprovalType) {
    const approval = resolveVerifiedApprovalRecordId(input.repairCaseId, transition.requiredApprovalType);
    if (!approval.satisfied) {
      return { ok: false, reason: "APPROVAL_NOT_SATISFIED", message: approval.reason };
    }
    relatedApprovalRecordId = approval.recordId;
  }

  const nowIso = new Date().toISOString();
  const nextState: LocalWorkflowState = {
    id: current.existing?.id ?? generateStateId(),
    repairCaseId: input.repairCaseId,
    workflowType: input.workflowType,
    currentStatus: transition.toStatus,
    currentWorkflowStepKey: transition.toStepKey,
    holdState: RELEASED_HOLD_STATE,
    shipmentCompletedAt: null,
    updatedByUserId: input.actingUser.id,
    updatedByNameSnapshot: input.actingUser.name,
    updatedAt: nowIso,
    source: "LOCAL_DEMO",
  };
  const event: LocalWorkflowEvent = {
    id: generateEventId(),
    workflowStateId: nextState.id,
    repairCaseId: input.repairCaseId,
    workflowType: input.workflowType,
    eventType: "STEP_ADVANCED",
    fromStatus: current.status,
    toStatus: transition.toStatus,
    fromWorkflowStepKey: current.stepKey,
    toWorkflowStepKey: transition.toStepKey,
    actorUserId: input.actingUser.id,
    actorNameSnapshot: input.actingUser.name,
    occurredAt: nowIso,
    reason: null,
    relatedApprovalRecordId,
    source: "LOCAL_DEMO",
  };

  return commit(states, events, nextState, event);
}

/** STEP_RETURNED: SUPER_ADMIN/ADMIN + 담당 AS_ENGINEER, 사유는 선택(2026-08-18 완화 — 아래 주석 참조), SHIPMENT_COMPLETED 이후에는 표에 대응 행이 없어 자동으로 차단된다. */
export function returnStep(input: AdvanceOrReturnInput): WorkflowActionResult {
  const { states, events } = getWorkflowStoreSnapshot();
  const current = resolveCurrent(states, input);

  const transition = findTransitionDefinition(input.workflowType, "STEP_RETURNED", current.stepKey);
  if (!transition) {
    return { ok: false, reason: "NOT_FOUND_TRANSITION", message: "이 단계에서는 이전 단계로 되돌릴 수 없습니다." };
  }

  const hold = checkNotOnHold(current.holdState, false);
  if (!hold.allowed) return { ok: false, reason: "ON_HOLD", message: hold.reason };

  const eligibility = checkTransitionEligibility(transition, input.actingUser, input.assignedEngineerId, current.holdState);
  if (!eligibility.allowed) return { ok: false, reason: "NOT_ELIGIBLE", message: eligibility.reason };

  // 되돌리기 사유는 선택 입력이다(2026-08-18 완화). DB 모드가
  // transition.requiresReason 플래그로 판정하는 것과 달리 로컬 모드는 여기서
  // 무조건 필수로 검사하고 있었다 — 그 하드코딩된 검사를 제거해 두 모드를
  // 다시 일치시킨다. 다시 필수로 되돌린다면 이 자리에
  // `if (transition.requiresReason && !reason)` 형태로 플래그를 보게 하는 편이
  // 낫다(그래야 표 한 곳만 고치면 양쪽이 같이 움직인다).
  const trimmedReason = input.reason?.trim() ?? "";
  const reason = trimmedReason === "" ? null : trimmedReason;

  const nowIso = new Date().toISOString();
  const nextState: LocalWorkflowState = {
    id: current.existing?.id ?? generateStateId(),
    repairCaseId: input.repairCaseId,
    workflowType: input.workflowType,
    currentStatus: transition.toStatus,
    currentWorkflowStepKey: transition.toStepKey,
    holdState: RELEASED_HOLD_STATE,
    shipmentCompletedAt: null,
    updatedByUserId: input.actingUser.id,
    updatedByNameSnapshot: input.actingUser.name,
    updatedAt: nowIso,
    source: "LOCAL_DEMO",
  };
  const event: LocalWorkflowEvent = {
    id: generateEventId(),
    workflowStateId: nextState.id,
    repairCaseId: input.repairCaseId,
    workflowType: input.workflowType,
    eventType: "STEP_RETURNED",
    fromStatus: current.status,
    toStatus: transition.toStatus,
    fromWorkflowStepKey: current.stepKey,
    toWorkflowStepKey: transition.toStepKey,
    actorUserId: input.actingUser.id,
    actorNameSnapshot: input.actingUser.name,
    occurredAt: nowIso,
    reason,
    relatedApprovalRecordId: null,
    source: "LOCAL_DEMO",
  };

  return commit(states, events, nextState, event);
}

/**
 * reason이 string | null인 이유: 보류 시작/해제 사유는 2026-08-18 완화로
 * 선택 입력이 되었다(DB 모드의 workflow-transitions.ts hold 분기와 동일한
 * 취급 — 두 모드의 동작이 갈리면 안 된다).
 */
export type HoldActionInput = BaseInput & { reason: string | null };

export function startHold(input: HoldActionInput): WorkflowActionResult {
  const { states, events } = getWorkflowStoreSnapshot();
  const current = resolveCurrent(states, input);

  if (current.holdState.isOnHold) {
    return { ok: false, reason: "ALREADY_ON_HOLD", message: "이미 보류 중입니다." };
  }
  const eligibility = checkHoldEligibility(input.workflowType, current.stepKey, input.actingUser, input.assignedEngineerId);
  if (!eligibility.allowed) return { ok: false, reason: "NOT_ELIGIBLE", message: eligibility.reason };

  // 사유 미입력 시 null로 기록한다(REASON_REQUIRED 반환은 2026-08-18 제거).
  const trimmedReason = input.reason?.trim() ?? "";
  const reason = trimmedReason === "" ? null : trimmedReason;

  const nowIso = new Date().toISOString();
  const holdState: HoldState = {
    isOnHold: true,
    reason,
    startedByUserId: input.actingUser.id,
    startedByNameSnapshot: input.actingUser.name,
    startedAt: nowIso,
  };
  const nextState: LocalWorkflowState = {
    id: current.existing?.id ?? generateStateId(),
    repairCaseId: input.repairCaseId,
    workflowType: input.workflowType,
    currentStatus: current.status,
    currentWorkflowStepKey: current.stepKey,
    holdState,
    shipmentCompletedAt: current.existing?.shipmentCompletedAt ?? null,
    updatedByUserId: input.actingUser.id,
    updatedByNameSnapshot: input.actingUser.name,
    updatedAt: nowIso,
    source: "LOCAL_DEMO",
  };
  const event: LocalWorkflowEvent = {
    id: generateEventId(),
    workflowStateId: nextState.id,
    repairCaseId: input.repairCaseId,
    workflowType: input.workflowType,
    eventType: "HOLD_STARTED",
    fromStatus: current.status,
    toStatus: current.status,
    fromWorkflowStepKey: current.stepKey,
    toWorkflowStepKey: current.stepKey,
    actorUserId: input.actingUser.id,
    actorNameSnapshot: input.actingUser.name,
    occurredAt: nowIso,
    reason,
    relatedApprovalRecordId: null,
    source: "LOCAL_DEMO",
  };

  return commit(states, events, nextState, event);
}

export function releaseHold(input: HoldActionInput): WorkflowActionResult {
  const { states, events } = getWorkflowStoreSnapshot();
  const current = resolveCurrent(states, input);

  if (!current.holdState.isOnHold) {
    return { ok: false, reason: "NOT_ON_HOLD", message: "보류 중이 아닙니다." };
  }
  const eligibility = checkHoldEligibility(input.workflowType, current.stepKey, input.actingUser, input.assignedEngineerId);
  if (!eligibility.allowed) return { ok: false, reason: "NOT_ELIGIBLE", message: eligibility.reason };

  // 사유 미입력 시 null로 기록한다(REASON_REQUIRED 반환은 2026-08-18 제거).
  const trimmedReason = input.reason?.trim() ?? "";
  const reason = trimmedReason === "" ? null : trimmedReason;

  const nowIso = new Date().toISOString();
  const nextState: LocalWorkflowState = {
    id: current.existing?.id ?? generateStateId(),
    repairCaseId: input.repairCaseId,
    workflowType: input.workflowType,
    currentStatus: current.status,
    currentWorkflowStepKey: current.stepKey,
    holdState: RELEASED_HOLD_STATE,
    shipmentCompletedAt: current.existing?.shipmentCompletedAt ?? null,
    updatedByUserId: input.actingUser.id,
    updatedByNameSnapshot: input.actingUser.name,
    updatedAt: nowIso,
    source: "LOCAL_DEMO",
  };
  const event: LocalWorkflowEvent = {
    id: generateEventId(),
    workflowStateId: nextState.id,
    repairCaseId: input.repairCaseId,
    workflowType: input.workflowType,
    eventType: "HOLD_RELEASED",
    fromStatus: current.status,
    toStatus: current.status,
    fromWorkflowStepKey: current.stepKey,
    toWorkflowStepKey: current.stepKey,
    actorUserId: input.actingUser.id,
    actorNameSnapshot: input.actingUser.name,
    occurredAt: nowIso,
    reason,
    relatedApprovalRecordId: null,
    source: "LOCAL_DEMO",
  };

  return commit(states, events, nextState, event);
}

export type CompleteShipmentInput = BaseInput & { note: string };

export function completeShipment(input: CompleteShipmentInput): WorkflowActionResult {
  const { states, events } = getWorkflowStoreSnapshot();
  const current = resolveCurrent(states, input);

  const transition = findTransitionDefinition(input.workflowType, "SHIPMENT_COMPLETED", current.stepKey);
  if (!transition) {
    return {
      ok: false,
      reason: "NOT_FOUND_TRANSITION",
      message: "현재 단계에서는 출하 완료 처리를 할 수 없습니다. 정확한 사전 단계에 있어야 합니다.",
    };
  }

  const hold = checkNotOnHold(current.holdState, false);
  if (!hold.allowed) return { ok: false, reason: "ON_HOLD", message: hold.reason };

  const eligibility = checkTransitionEligibility(transition, input.actingUser, input.assignedEngineerId, current.holdState);
  if (!eligibility.allowed) return { ok: false, reason: "NOT_ELIGIBLE", message: eligibility.reason };

  const note = input.note.trim();
  if (!note) {
    return { ok: false, reason: "REASON_REQUIRED", message: "출하 완료 메모를 입력해 주세요." };
  }

  if (!transition.requiredApprovalType) {
    return { ok: false, reason: "STORAGE_CONFLICT", message: "저장 중 충돌이 발생했습니다. 다시 시도해 주세요." };
  }
  const approval = resolveVerifiedApprovalRecordId(input.repairCaseId, transition.requiredApprovalType);
  if (!approval.satisfied) {
    return { ok: false, reason: "APPROVAL_NOT_SATISFIED", message: approval.reason };
  }

  const nowIso = new Date().toISOString();
  const nextState: LocalWorkflowState = {
    id: current.existing?.id ?? generateStateId(),
    repairCaseId: input.repairCaseId,
    workflowType: input.workflowType,
    currentStatus: "SHIPMENT_COMPLETED",
    currentWorkflowStepKey: "shipment_completed",
    holdState: RELEASED_HOLD_STATE,
    shipmentCompletedAt: nowIso,
    updatedByUserId: input.actingUser.id,
    updatedByNameSnapshot: input.actingUser.name,
    updatedAt: nowIso,
    source: "LOCAL_DEMO",
  };
  const event: LocalWorkflowEvent = {
    id: generateEventId(),
    workflowStateId: nextState.id,
    repairCaseId: input.repairCaseId,
    workflowType: input.workflowType,
    eventType: "SHIPMENT_COMPLETED",
    fromStatus: current.status,
    toStatus: "SHIPMENT_COMPLETED",
    fromWorkflowStepKey: current.stepKey,
    toWorkflowStepKey: "shipment_completed",
    actorUserId: input.actingUser.id,
    actorNameSnapshot: input.actingUser.name,
    occurredAt: nowIso,
    reason: note,
    relatedApprovalRecordId: approval.recordId,
    source: "LOCAL_DEMO",
  };

  return commit(states, events, nextState, event);
}
