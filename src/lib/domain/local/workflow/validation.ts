import { mockRepairCases, mockUsers, workflowSteps } from "../../mock-data";
import { REPAIR_STATUS_CODES, WORKFLOW_TYPE_CODES, type RepairStatus, type WorkflowType } from "../../types";
import { isLocalId } from "../local-types";
import { isNonEmptyTrimmedString, isValidIsoDateTimeString } from "../validation";
import { findTransitionDefinition } from "./transition-definitions";
import {
  ACTION_CODES,
  WORKFLOW_EVENT_TYPE_CODES,
  type ActionCode,
  type HoldState,
  type LocalWorkflowEvent,
  type LocalWorkflowState,
  type WorkflowEventType,
} from "./workflow-types";
import { getStepStatus, hasStepStatusMapping } from "./step-status-map";

function isOneOf<T extends string>(value: unknown, codes: readonly T[]): value is T {
  return typeof value === "string" && (codes as readonly string[]).includes(value);
}

function isKnownRepairCaseId(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (isLocalId(value)) return true;
  return mockRepairCases.some((c) => c.id === value);
}

function findUser(userId: string) {
  return mockUsers.find((u) => u.id === userId);
}

function stepExists(workflowType: WorkflowType, stepKey: string): boolean {
  return workflowSteps.some((s) => s.workflowType === workflowType && s.key === stepKey);
}

function isValidHoldState(raw: unknown): raw is HoldState {
  if (typeof raw !== "object" || raw === null) return false;
  const h = raw as Record<string, unknown>;
  if (typeof h.isOnHold !== "boolean") return false;

  if (!h.isOnHold) {
    return h.reason === null && h.startedByUserId === null && h.startedByNameSnapshot === null && h.startedAt === null;
  }
  if (!isNonEmptyTrimmedString(h.reason)) return false;
  if (!isNonEmptyTrimmedString(h.startedByUserId) || !findUser(h.startedByUserId)) return false;
  if (!isNonEmptyTrimmedString(h.startedByNameSnapshot)) return false;
  if (!isValidIsoDateTimeString(h.startedAt)) return false;
  return true;
}

/**
 * 단계-상태 매핑표(step-status-map.ts)에 없는 (workflowType, stepKey) 조합은
 * "안전하게 검증 실패"로 처리한다(추측하지 않는다) — hasStepStatusMapping이
 * false면 이 레코드 전체를 버린다.
 */
export function validateWorkflowState(raw: unknown): LocalWorkflowState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  if (!isNonEmptyTrimmedString(r.id) || !r.id.startsWith("workflow-state-")) return null;
  if (!isKnownRepairCaseId(r.repairCaseId)) return null;
  if (!isOneOf<WorkflowType>(r.workflowType, WORKFLOW_TYPE_CODES)) return null;
  if (!isOneOf<RepairStatus>(r.currentStatus, REPAIR_STATUS_CODES)) return null;
  if (!isNonEmptyTrimmedString(r.currentWorkflowStepKey)) return null;
  if (!stepExists(r.workflowType, r.currentWorkflowStepKey)) return null;
  if (!hasStepStatusMapping(r.workflowType, r.currentWorkflowStepKey)) return null;
  if (getStepStatus(r.workflowType, r.currentWorkflowStepKey) !== r.currentStatus) return null;

  if (!isValidHoldState(r.holdState)) return null;

  if (r.currentStatus === "SHIPMENT_COMPLETED") {
    if (!isValidIsoDateTimeString(r.shipmentCompletedAt)) return null;
  } else if (r.shipmentCompletedAt !== null) {
    return null;
  }

  if (!isNonEmptyTrimmedString(r.updatedByUserId) || !findUser(r.updatedByUserId)) return null;
  if (!isNonEmptyTrimmedString(r.updatedByNameSnapshot)) return null;
  if (!isValidIsoDateTimeString(r.updatedAt)) return null;
  if (r.source !== "LOCAL_DEMO") return null;

  return {
    id: r.id,
    repairCaseId: r.repairCaseId as string,
    workflowType: r.workflowType,
    currentStatus: r.currentStatus,
    currentWorkflowStepKey: r.currentWorkflowStepKey,
    holdState: r.holdState as HoldState,
    shipmentCompletedAt: (r.shipmentCompletedAt as string | null) ?? null,
    updatedByUserId: r.updatedByUserId,
    updatedByNameSnapshot: r.updatedByNameSnapshot as string,
    updatedAt: r.updatedAt as string,
    source: "LOCAL_DEMO",
  };
}

/** repairCaseId당 하나만 유지한다(먼저 등장한 레코드를 유지, id 중복도 제거). */
export function dedupeWorkflowStates(states: LocalWorkflowState[]): LocalWorkflowState[] {
  const seenIds = new Set<string>();
  const seenCases = new Set<string>();
  const result: LocalWorkflowState[] = [];
  for (const state of states) {
    if (seenIds.has(state.id) || seenCases.has(state.repairCaseId)) continue;
    seenIds.add(state.id);
    seenCases.add(state.repairCaseId);
    result.push(state);
  }
  return result;
}

/**
 * STEP_ADVANCED/STEP_RETURNED/SHIPMENT_COMPLETED는 transition-definitions.ts의
 * 정확히 일치하는 행이 존재해야 한다(순서 연산이 아니라 표 조회). HOLD_STARTED/
 * HOLD_RELEASED는 단계를 이동하지 않으므로 표에 없고, from===to로만 검증한다.
 * STATUS_CHANGED/ADMIN_OVERRIDE는 Stage E-1에서 생성되지 않는 예약 코드이므로
 * 저장소에서 발견되면 무조건 무효로 처리한다(고아/위조 데이터로 간주).
 */
export function validateWorkflowEvent(
  raw: unknown,
  ctx: { statesById: ReadonlyMap<string, LocalWorkflowState> }
): LocalWorkflowEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  if (!isNonEmptyTrimmedString(r.id) || !r.id.startsWith("workflow-event-")) return null;
  if (!isNonEmptyTrimmedString(r.workflowStateId)) return null;
  const state = ctx.statesById.get(r.workflowStateId);
  if (!state) return null;
  if (r.repairCaseId !== state.repairCaseId) return null;
  if (r.workflowType !== state.workflowType) return null;

  if (!isOneOf<WorkflowEventType>(r.eventType, WORKFLOW_EVENT_TYPE_CODES)) return null;
  if (r.eventType === "STATUS_CHANGED" || r.eventType === "ADMIN_OVERRIDE") return null;

  if (!isOneOf<RepairStatus>(r.fromStatus, REPAIR_STATUS_CODES)) return null;
  if (!isOneOf<RepairStatus>(r.toStatus, REPAIR_STATUS_CODES)) return null;
  if (!isNonEmptyTrimmedString(r.fromWorkflowStepKey) || !stepExists(state.workflowType, r.fromWorkflowStepKey)) {
    return null;
  }
  if (!isNonEmptyTrimmedString(r.toWorkflowStepKey) || !stepExists(state.workflowType, r.toWorkflowStepKey)) {
    return null;
  }

  if (!isNonEmptyTrimmedString(r.actorUserId) || !findUser(r.actorUserId)) return null;
  if (!isNonEmptyTrimmedString(r.actorNameSnapshot)) return null;
  if (!isValidIsoDateTimeString(r.occurredAt)) return null;

  if (r.reason !== null && !isNonEmptyTrimmedString(r.reason)) return null;
  if (r.relatedApprovalRecordId !== null) {
    if (!isNonEmptyTrimmedString(r.relatedApprovalRecordId) || !r.relatedApprovalRecordId.startsWith("approval-")) {
      return null;
    }
  }

  if (r.eventType === "HOLD_STARTED" || r.eventType === "HOLD_RELEASED") {
    if (r.fromWorkflowStepKey !== r.toWorkflowStepKey) return null;
    if (r.fromStatus !== r.toStatus) return null;
    if (!isNonEmptyTrimmedString(r.reason)) return null; // 보류 시작/해제 모두 사유 필수
    if (r.relatedApprovalRecordId !== null) return null;
  } else {
    // STEP_ADVANCED / STEP_RETURNED / SHIPMENT_COMPLETED
    const definition = findTransitionDefinition(
      state.workflowType,
      r.eventType as ActionCode,
      r.fromWorkflowStepKey as string
    );
    if (!definition) return null;
    if (definition.toStepKey !== r.toWorkflowStepKey) return null;
    if (definition.toStatus !== r.toStatus) return null;
    if (definition.requiresReason && !isNonEmptyTrimmedString(r.reason)) return null;
    if (definition.requiredApprovalType && !r.relatedApprovalRecordId) return null;
  }

  if (r.source !== "LOCAL_DEMO") return null;

  return {
    id: r.id,
    workflowStateId: r.workflowStateId,
    repairCaseId: state.repairCaseId,
    workflowType: state.workflowType,
    eventType: r.eventType as WorkflowEventType,
    fromStatus: r.fromStatus,
    toStatus: r.toStatus,
    fromWorkflowStepKey: r.fromWorkflowStepKey as string,
    toWorkflowStepKey: r.toWorkflowStepKey as string,
    actorUserId: r.actorUserId,
    actorNameSnapshot: r.actorNameSnapshot as string,
    occurredAt: r.occurredAt as string,
    reason: (r.reason as string | null) ?? null,
    relatedApprovalRecordId: (r.relatedApprovalRecordId as string | null) ?? null,
    source: "LOCAL_DEMO",
  };
}

export function dedupeWorkflowEvents(events: LocalWorkflowEvent[]): LocalWorkflowEvent[] {
  const seen = new Set<string>();
  const result: LocalWorkflowEvent[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    result.push(event);
  }
  return result;
}

// re-export for actions.ts convenience
export const WORKFLOW_ACTION_CODES: readonly ActionCode[] = ACTION_CODES;
