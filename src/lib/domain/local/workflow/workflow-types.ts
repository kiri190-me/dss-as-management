import type { RepairStatus, WorkflowType } from "../../types";

// Stage E-1 로컬 데모 워크플로 상태 전이 타입. 실제 DB 스키마 결정이 아니며,
// DATABASE_DESIGN.md의 workflow_versions/workflow_steps/status_change_histories
// 관계형 모델을 흉내 낸 데모 전용 상위 레이어다. mock-data.ts/types.ts는 이
// 스테이지에서도 런타임에 절대 mutate하지 않는다.

export const ACTION_CODES = [
  "STEP_ADVANCED",
  "STEP_RETURNED",
  "HOLD_STARTED",
  "HOLD_RELEASED",
  "SHIPMENT_COMPLETED",
] as const;
export type ActionCode = (typeof ACTION_CODES)[number];

/**
 * 이벤트 코드는 ACTION_CODES 5종 + 예약된 2종(STATUS_CHANGED, ADMIN_OVERRIDE)이다.
 * 예약된 두 코드는 Stage E-1의 어떤 액션도 생성하지 않는다 — 타입에는 존재하되
 * 실제로 쓰이지 않는 미사용 코드임을 여기 명시한다:
 *   - STATUS_CHANGED: 단계 이동을 동반하지 않는 직접 상태 변경(추후 스테이지용,
 *     이번 스테이지는 구현하지 않음).
 *   - ADMIN_OVERRIDE: 임의 이동 예외 처리(추후 스테이지용, 이번 스테이지는
 *     명시적으로 구현하지 않음 — "Do not implement ADMIN_OVERRIDE").
 */
export const WORKFLOW_EVENT_TYPE_CODES = [
  "STATUS_CHANGED",
  "STEP_ADVANCED",
  "STEP_RETURNED",
  "HOLD_STARTED",
  "HOLD_RELEASED",
  "SHIPMENT_COMPLETED",
  "ADMIN_OVERRIDE",
] as const;
export type WorkflowEventType = (typeof WORKFLOW_EVENT_TYPE_CODES)[number];
export const workflowEventTypeLabels: Record<WorkflowEventType, string> = {
  STATUS_CHANGED: "상태 직접 변경(미사용)",
  STEP_ADVANCED: "다음 단계로 진행",
  STEP_RETURNED: "이전 단계로 되돌림",
  HOLD_STARTED: "보류 시작",
  HOLD_RELEASED: "보류 해제",
  SHIPMENT_COMPLETED: "출하 완료 처리",
  ADMIN_OVERRIDE: "관리자 강제 이동(미사용)",
};

export const APPROVAL_TYPE_FOR_TRANSITION_CODES = ["REPAIR_INSPECTION", "FINAL_SHIPMENT"] as const;
export type ApprovalTypeForTransition = (typeof APPROVAL_TYPE_FOR_TRANSITION_CODES)[number];

/**
 * 기존 exceptionStatus(정적 시드 필드), 계산되는 isOverdue와 완전히 분리된
 * 새 상호작용형 보류 개념이다. rc-006의 ON_HOLD exceptionStatus를 이 구조로
 * 전환하지 않는다 — 서로 다른 축으로 영구히 유지한다.
 */
export type HoldState = {
  isOnHold: boolean;
  reason: string | null;
  startedByUserId: string | null;
  startedByNameSnapshot: string | null;
  startedAt: string | null;
};

export const RELEASED_HOLD_STATE: HoldState = {
  isOnHold: false,
  reason: null,
  startedByUserId: null,
  startedByNameSnapshot: null,
  startedAt: null,
};

export type LocalWorkflowState = {
  id: string;
  repairCaseId: string;
  workflowType: WorkflowType;
  currentStatus: RepairStatus;
  currentWorkflowStepKey: string;
  holdState: HoldState;
  /** currentStatus가 SHIPMENT_COMPLETED일 때만 값을 가진다(그 외에는 항상 null). */
  shipmentCompletedAt: string | null;
  updatedByUserId: string;
  updatedByNameSnapshot: string;
  updatedAt: string;
  source: "LOCAL_DEMO";
};

export type LocalWorkflowEvent = {
  id: string;
  workflowStateId: string;
  repairCaseId: string;
  workflowType: WorkflowType;
  eventType: WorkflowEventType;
  fromStatus: RepairStatus;
  toStatus: RepairStatus;
  fromWorkflowStepKey: string;
  toWorkflowStepKey: string;
  actorUserId: string;
  actorNameSnapshot: string;
  occurredAt: string;
  reason: string | null;
  /** 검증을 통과한 실제 승인 레코드 id만 저장한다(문자열 접두어만 확인하고
   * 신뢰하지 않는다 — approval-lookup.ts가 쓰기 시점에 실제로 검증한다). */
  relatedApprovalRecordId: string | null;
  source: "LOCAL_DEMO";
};

export type LocalWorkflowEnvelope = {
  version: 1;
  states: LocalWorkflowState[];
  events: LocalWorkflowEvent[];
};

export const LOCAL_WORKFLOW_STORAGE_KEY = "dss-as-local-workflow-states-v1";
