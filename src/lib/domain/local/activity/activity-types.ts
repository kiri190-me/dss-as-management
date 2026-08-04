import type { ApprovalType, DisplayApprovalStatus } from "../approval/approval-types";
import type { AttachmentCategory } from "../attachments/attachment-types";
import type { RepairStatus, WorkflowType } from "../../types";

// Stage E-2 읽기 전용 정규화 활동 타임라인 타입. 어떤 원본 저장소(mock
// work-history, 워크플로/승인/첨부파일 로컬 스토리지)도 이 타입을 위해
// mutate/rewrite되지 않는다 — 이 타입은 항상 읽을 때마다 그 시점의 원본
// 레코드들로부터 다시 계산되는 표시 전용 뷰다.

export const ACTIVITY_SOURCE_TYPE_CODES = [
  "WORK_HISTORY",
  "WORKFLOW",
  "APPROVAL",
  "ATTACHMENT",
  "CASE_CREATED",
] as const;
export type ActivitySourceType = (typeof ACTIVITY_SOURCE_TYPE_CODES)[number];
export const activitySourceTypeLabels: Record<ActivitySourceType, string> = {
  WORK_HISTORY: "작업 기록",
  WORKFLOW: "워크플로",
  APPROVAL: "승인",
  ATTACHMENT: "파일",
  CASE_CREATED: "접수 등록",
};

/**
 * category는 sourceType과 별개의 축이다 — WORK_HISTORY의 STATUS_CHANGE
 * 항목과 WORKFLOW의 STEP_ADVANCED/STEP_RETURNED가 같은 category(STATUS_CHANGE)
 * 로 묶이는 것처럼, 필터링에 의미 있는 분류는 sourceType 하나로 충분하지
 * 않다. WORKFLOW는 카테고리 코드에 없다 — 모든 워크플로 이벤트는 이미
 * STATUS_CHANGE/HOLD/SHIPMENT 중 하나로 의미상 분류되기 때문이다.
 */
export const ACTIVITY_CATEGORY_CODES = [
  "WORK",
  "STATUS_CHANGE",
  "HOLD",
  "SHIPMENT",
  "APPROVAL",
  "ATTACHMENT",
  "CASE_CREATED",
] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORY_CODES)[number];
export const activityCategoryLabels: Record<ActivityCategory, string> = {
  WORK: "작업 기록",
  STATUS_CHANGE: "상태 변경",
  HOLD: "보류",
  SHIPMENT: "출하",
  APPROVAL: "승인",
  ATTACHMENT: "파일",
  CASE_CREATED: "접수 등록",
};

export type WorkActivityDetails = {
  symptom: string | null;
  suspectedCause: string | null;
  actionTaken: string | null;
  partsUsed: string | null;
  nextAction: string | null;
};

export type UnifiedActivityEvent = {
  id: string;
  repairCaseId: string;
  /** 원본 소스의 문자열 형식을 그대로 보존한다(work-history는 +09:00 고정
   * 오프셋, 그 외는 UTC "Z") — 표시 시에만 하나의 공통 포매터를 통과시킨다. */
  occurredAt: string;
  sourceType: ActivitySourceType;
  eventType: string;
  category: ActivityCategory;
  title: string;
  description: string | null;
  actorUserId: string | null;
  actorNameSnapshot: string | null;
  previousStatus: RepairStatus | null;
  nextStatus: RepairStatus | null;
  /** WORKFLOW 소스 이벤트에서만 값을 가진다. 이 값이 있어야
   * previousWorkflowStepKey/nextWorkflowStepKey를 올바른 워크플로의 단계
   * 목록에서 라벨로 해석할 수 있다(단계 key는 워크플로별로만 유일하다). */
  workflowType: WorkflowType | null;
  previousWorkflowStepKey: string | null;
  nextWorkflowStepKey: string | null;
  relatedApprovalType: ApprovalType | null;
  relatedApprovalDecision: DisplayApprovalStatus | null;
  relatedAttachmentId: string | null;
  relatedAttachmentName: string | null;
  /** 첨부파일 레코드를 찾을 수 없으면 null이다(ActivityCategory.ATTACHMENT와
   * 별개의, 파일 자체의 분류다 — 혼용하지 않는다). */
  relatedAttachmentCategory: AttachmentCategory | null;
  workDetails: WorkActivityDetails | null;
  /** 원본 레코드의 실제 id(예: "wh-010", "workflow-event-…"). 정규화된 id와는
   * 별개로, 원본 출처를 그대로 추적할 수 있도록 항상 보존한다. */
  sourceRecordId: string;
  source: "SEEDED_MOCK" | "LOCAL_DEMO";
};

export function buildUnifiedEventId(sourceType: ActivitySourceType, sourceRecordId: string): string {
  return `${sourceType}:${sourceRecordId}`;
}
