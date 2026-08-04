export const APPROVAL_TYPE_CODES = ["REPAIR_INSPECTION", "FINAL_SHIPMENT"] as const;
export type ApprovalType = (typeof APPROVAL_TYPE_CODES)[number];
export const approvalTypeLabels: Record<ApprovalType, string> = {
  REPAIR_INSPECTION: "수리 검수 승인",
  FINAL_SHIPMENT: "최종 출하 승인",
};

/**
 * NOT_REQUESTED는 저장되는 상태가 아니라, 어떤 (repairCaseId, approvalType)
 * 조합에 대해 LocalApprovalRecord가 아직 존재하지 않을 때의 파생 표시
 * 상태다. 실제로 저장되는 status 값은 아래 4가지뿐이다.
 */
export const STORED_APPROVAL_STATUS_CODES = [
  "PENDING",
  "APPROVED",
  "CHANGES_REQUESTED",
  "REJECTED",
] as const;
export type StoredApprovalStatus = (typeof STORED_APPROVAL_STATUS_CODES)[number];

export const DISPLAY_APPROVAL_STATUS_CODES = ["NOT_REQUESTED", ...STORED_APPROVAL_STATUS_CODES] as const;
export type DisplayApprovalStatus = (typeof DISPLAY_APPROVAL_STATUS_CODES)[number];

export const approvalStatusLabels: Record<DisplayApprovalStatus, string> = {
  NOT_REQUESTED: "요청 전",
  PENDING: "승인 대기",
  APPROVED: "승인 완료",
  CHANGES_REQUESTED: "보완 요청",
  REJECTED: "반려",
};

export const APPROVAL_EVENT_TYPE_CODES = [
  "REQUESTED",
  "RESUBMITTED",
  "APPROVED",
  "REJECTED",
  "CHANGES_REQUESTED",
] as const;
export type ApprovalEventType = (typeof APPROVAL_EVENT_TYPE_CODES)[number];
export const approvalEventTypeLabels: Record<ApprovalEventType, string> = {
  REQUESTED: "승인 요청",
  RESUBMITTED: "재요청",
  APPROVED: "승인",
  REJECTED: "반려",
  CHANGES_REQUESTED: "보완 요청",
};

/**
 * 하나의 (repairCaseId, approvalType) 조합에는 항상 최대 1개의 "현재" 레코드만
 * 존재한다 — 재요청 시 새 레코드를 만들지 않고 같은 id를 재사용해 상태를
 * 되돌린다. 과거 결정 이력은 이 레코드가 아니라 LocalApprovalEvent
 * append-only 로그를 통해서만 복원할 수 있다.
 */
export type LocalApprovalRecord = {
  id: string;
  repairCaseId: string;
  approvalType: ApprovalType;
  status: StoredApprovalStatus;
  requestedByUserId: string;
  requestedByNameSnapshot: string;
  requestedAt: string;
  decidedByUserId: string | null;
  decidedByNameSnapshot: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  /** FINAL_SHIPMENT 결정에서 위임을 통해 처리된 경우에만 값을 가진다. */
  delegationId: string | null;
  createdAt: string;
  updatedAt: string;
  source: "LOCAL_DEMO";
};

export type LocalApprovalEvent = {
  id: string;
  approvalRecordId: string;
  repairCaseId: string;
  approvalType: ApprovalType;
  eventType: ApprovalEventType;
  actorUserId: string;
  actorNameSnapshot: string;
  occurredAt: string;
  comment: string | null;
  delegationId: string | null;
  source: "LOCAL_DEMO";
};

/**
 * records와 events를 하나의 localStorage 키/봉투에 함께 저장한다.
 * 두 컬렉션을 항상 한 번의 setItem 호출로 같이 써서, 여러 키를 나눠 쓸 때
 * 생기는 트랜잭션 원자성 부재 문제를 피한다.
 */
export type LocalApprovalEnvelope = {
  version: 1;
  records: LocalApprovalRecord[];
  events: LocalApprovalEvent[];
};

export const APPROVAL_STORAGE_KEY = "dss-as-local-approvals-v1";
