import { workflowSteps } from "../../mock-data";
import { workHistoryTypeLabels, type WorkflowType } from "../../types";
import type { WorkHistoryRow } from "../../work-history-rows";
import type {
  ApprovalType,
  DisplayApprovalStatus,
  LocalApprovalEvent,
  LocalApprovalRecord,
  ApprovalEventType,
} from "../approval/approval-types";
import { approvalTypeLabels } from "../approval/approval-types";
import type { LocalShipmentDelegation } from "../approval/delegation-types";
import type {
  AttachmentEventType,
  LocalAttachmentEvent,
  LocalAttachmentMetadata,
} from "../attachments/attachment-types";
import { attachmentEventTypeLabels } from "../attachments/attachment-types";
import type { ResolvedRepairCase } from "../resolved-repair-case";
import { resolveDisplayApprovalRecord } from "../workflow/approval-lookup";
import type { ActionCode, LocalWorkflowEvent } from "../workflow/workflow-types";
import { buildUnifiedEventId, type ActivityCategory, type UnifiedActivityEvent } from "./activity-types";

/**
 * ============================================================================
 * Stage E-2 순수 어댑터 모음 — 각 함수는 이미 검증을 통과한(각 저장소 자신의
 * validation.ts가 이미 걸러낸) 배열만 입력으로 받는다. 여기서는 어떤
 * localStorage도 읽지 않고, 어떤 원본 레코드도 mutate하지 않는다.
 * ============================================================================
 */

export function resolveActorDisplay(actorUserId: string | null, actorNameSnapshot: string | null): string {
  if (actorNameSnapshot) return actorNameSnapshot;
  if (actorUserId) return "사용자 정보 없음";
  return "등록자 정보 없음";
}

/**
 * (workflowType, stepKey) 조합으로만 라벨을 조회한다 — 단계 key는 워크플로별
 * 로만 유일하므로 workflowType 없이는 올바르게 해석할 수 없다. 유효한 조합이
 * 아니면(데이터 정합성 문제) 라벨을 추측하지 않고 "알 수 없는 단계"를 반환한다.
 */
export function resolveStepLabel(workflowType: WorkflowType | null, stepKey: string | null): string | null {
  if (!workflowType || !stepKey) return null;
  const step = workflowSteps.find((s) => s.workflowType === workflowType && s.key === stepKey);
  return step?.label ?? "알 수 없는 단계";
}

export function workHistoryAdapter(rows: readonly WorkHistoryRow[]): UnifiedActivityEvent[] {
  return rows.map((row) => {
    const isStatusChange = row.workType === "STATUS_CHANGE";
    return {
      id: buildUnifiedEventId("WORK_HISTORY", row.id),
      repairCaseId: row.repairCaseId,
      occurredAt: row.workedAt,
      sourceType: "WORK_HISTORY",
      eventType: row.workType,
      category: (isStatusChange ? "STATUS_CHANGE" : "WORK") as ActivityCategory,
      title: workHistoryTypeLabels[row.workType] + (isStatusChange ? " (상태 변경)" : ""),
      description: row.description,
      actorUserId: row.engineerId,
      actorNameSnapshot: row.engineerName,
      previousStatus: row.previousStatus,
      nextStatus: row.newStatus,
      workflowType: null,
      previousWorkflowStepKey: null,
      nextWorkflowStepKey: null,
      relatedApprovalType: null,
      relatedApprovalDecision: null,
      relatedAttachmentId: null,
      relatedAttachmentName: null,
      relatedAttachmentCategory: null,
      workDetails: {
        symptom: row.symptom,
        suspectedCause: row.suspectedCause,
        actionTaken: row.actionTaken,
        partsUsed: row.partsUsed,
        nextAction: row.nextAction,
      },
      sourceRecordId: row.id,
      source: "SEEDED_MOCK",
    };
  });
}

const WORKFLOW_EVENT_TITLES: Record<ActionCode, string> = {
  STEP_ADVANCED: "다음 단계로 진행",
  STEP_RETURNED: "이전 단계로 되돌림",
  HOLD_STARTED: "보류 시작",
  HOLD_RELEASED: "보류 해제",
  SHIPMENT_COMPLETED: "출하 완료 처리",
};

function categoryForWorkflowEvent(eventType: ActionCode): ActivityCategory {
  if (eventType === "HOLD_STARTED" || eventType === "HOLD_RELEASED") return "HOLD";
  if (eventType === "SHIPMENT_COMPLETED") return "SHIPMENT";
  return "STATUS_CHANGE";
}

/**
 * relatedApprovalRecordId가 있을 때, 그 이벤트가 어떤 ApprovalType의 경계를
 * 통과시켰는지는 Stage E-1의 전이 규칙과 동일하게 판정한다(추측하지 않는다):
 * SHIPMENT_COMPLETED는 항상 FINAL_SHIPMENT, WAITING_SHIPMENT_APPROVAL로
 * 진입하는 STEP_ADVANCED는 항상 REPAIR_INSPECTION.
 */
function relatedApprovalTypeForWorkflowEvent(event: LocalWorkflowEvent): ApprovalType | null {
  if (!event.relatedApprovalRecordId) return null;
  if (event.eventType === "SHIPMENT_COMPLETED") return "FINAL_SHIPMENT";
  if (event.eventType === "STEP_ADVANCED" && event.toStatus === "WAITING_SHIPMENT_APPROVAL") {
    return "REPAIR_INSPECTION";
  }
  return null;
}

export function workflowAdapter(
  events: readonly LocalWorkflowEvent[],
  approvalRecords: readonly LocalApprovalRecord[]
): UnifiedActivityEvent[] {
  const result: UnifiedActivityEvent[] = [];

  for (const e of events) {
    // STATUS_CHANGED/ADMIN_OVERRIDE는 예약된 미사용 코드다 — 저장소 검증에서
    // 이미 걸러지지만, 발생한 것처럼 표시하지 않도록 여기서도 방어적으로
    // 한 번 더 건너뛴다.
    if (!(e.eventType in WORKFLOW_EVENT_TITLES)) continue;
    const eventType = e.eventType as ActionCode;

    const relatedApprovalType = relatedApprovalTypeForWorkflowEvent(e);
    let relatedApprovalDecision: DisplayApprovalStatus | null = null;
    if (relatedApprovalType && e.relatedApprovalRecordId) {
      const record = resolveDisplayApprovalRecord(
        e.relatedApprovalRecordId,
        e.repairCaseId,
        relatedApprovalType,
        approvalRecords
      );
      relatedApprovalDecision = record ? record.status : null;
    }

    result.push({
      id: buildUnifiedEventId("WORKFLOW", e.id),
      repairCaseId: e.repairCaseId,
      occurredAt: e.occurredAt,
      sourceType: "WORKFLOW",
      eventType,
      category: categoryForWorkflowEvent(eventType),
      title: WORKFLOW_EVENT_TITLES[eventType],
      description: e.reason,
      actorUserId: e.actorUserId,
      actorNameSnapshot: e.actorNameSnapshot,
      previousStatus: e.fromStatus,
      nextStatus: e.toStatus,
      workflowType: e.workflowType,
      previousWorkflowStepKey: e.fromWorkflowStepKey,
      nextWorkflowStepKey: e.toWorkflowStepKey,
      relatedApprovalType,
      relatedApprovalDecision,
      relatedAttachmentId: null,
      relatedAttachmentName: null,
      relatedAttachmentCategory: null,
      workDetails: null,
      sourceRecordId: e.id,
      source: "LOCAL_DEMO",
    });
  }

  return result;
}

const APPROVAL_EVENT_PHRASE: Record<ApprovalEventType, string> = {
  REQUESTED: "요청",
  RESUBMITTED: "재요청",
  APPROVED: "완료",
  CHANGES_REQUESTED: "보완 요청",
  REJECTED: "반려",
};

/**
 * 이 이벤트 자체의 eventType으로부터만 그 시점의 결정을 파생한다 — 현재
 * LocalApprovalRecord.status(이후 재요청·재결정으로 바뀔 수 있는 값)를
 * 참조하지 않는다. 과거 사실은 과거 사실 그대로 남는다.
 */
const APPROVAL_EVENT_TO_HISTORICAL_DECISION: Record<ApprovalEventType, DisplayApprovalStatus> = {
  REQUESTED: "PENDING",
  RESUBMITTED: "PENDING",
  APPROVED: "APPROVED",
  CHANGES_REQUESTED: "CHANGES_REQUESTED",
  REJECTED: "REJECTED",
};

export function approvalAdapter(
  events: readonly LocalApprovalEvent[],
  delegations: readonly LocalShipmentDelegation[]
): UnifiedActivityEvent[] {
  return events.map((e) => {
    const delegation = e.delegationId ? (delegations.find((d) => d.id === e.delegationId) ?? null) : null;
    const delegationNote = delegation ? `위임 처리(${delegation.delegateNameSnapshot})` : null;

    return {
      id: buildUnifiedEventId("APPROVAL", e.id),
      repairCaseId: e.repairCaseId,
      occurredAt: e.occurredAt,
      sourceType: "APPROVAL",
      eventType: e.eventType,
      category: "APPROVAL",
      title: `${approvalTypeLabels[e.approvalType]} ${APPROVAL_EVENT_PHRASE[e.eventType]}`,
      description: [e.comment, delegationNote].filter((v): v is string => Boolean(v)).join(" · ") || null,
      actorUserId: e.actorUserId,
      actorNameSnapshot: e.actorNameSnapshot,
      previousStatus: null,
      nextStatus: null,
      workflowType: null,
      previousWorkflowStepKey: null,
      nextWorkflowStepKey: null,
      relatedApprovalType: e.approvalType,
      relatedApprovalDecision: APPROVAL_EVENT_TO_HISTORICAL_DECISION[e.eventType],
      relatedAttachmentId: null,
      relatedAttachmentName: null,
      relatedAttachmentCategory: null,
      workDetails: null,
      sourceRecordId: e.id,
      source: "LOCAL_DEMO",
    };
  });
}

export function attachmentAdapter(
  events: readonly LocalAttachmentEvent[],
  records: readonly LocalAttachmentMetadata[]
): UnifiedActivityEvent[] {
  return events.map((e) => {
    const record = records.find((r) => r.id === e.attachmentId) ?? null;
    const eventType = e.eventType as AttachmentEventType;
    const isRenamed = eventType === "RENAMED";

    // RENAMED는 이벤트 자체에 저장된 previousDisplayName/newDisplayName이
    // 실제 그 시점의 스냅샷이다. 그 외 이벤트는 이벤트에 이름 스냅샷이 없으므로
    // "현재" 검증된 레코드의 표시 이름을 대상 파일 이름으로만 보여준다 — 그
    // 이름이 이벤트 발생 시점의 스냅샷이라고 암시하지 않는다.
    const name = isRenamed
      ? (e.newDisplayName ?? record?.displayName ?? "(알 수 없는 파일)")
      : (record?.displayName ?? "(알 수 없는 파일)");
    const description =
      isRenamed && e.previousDisplayName && e.newDisplayName
        ? `${e.previousDisplayName} → ${e.newDisplayName}`
        : e.comment;

    return {
      id: buildUnifiedEventId("ATTACHMENT", e.id),
      repairCaseId: e.repairCaseId,
      occurredAt: e.occurredAt,
      sourceType: "ATTACHMENT",
      eventType,
      category: "ATTACHMENT",
      title: attachmentEventTypeLabels[eventType],
      description,
      actorUserId: e.actorUserId,
      actorNameSnapshot: e.actorNameSnapshot,
      previousStatus: null,
      nextStatus: null,
      workflowType: null,
      previousWorkflowStepKey: null,
      nextWorkflowStepKey: null,
      relatedApprovalType: null,
      relatedApprovalDecision: null,
      relatedAttachmentId: e.attachmentId,
      relatedAttachmentName: name,
      relatedAttachmentCategory: record?.category ?? null,
      workDetails: null,
      sourceRecordId: e.id,
      source: "LOCAL_DEMO",
    };
  });
}

/**
 * createdAt이 유효한 타임스탬프가 아니면(이론상으로만 가능) 이 접수 건의
 * CASE_CREATED 이벤트 하나만 건너뛴다 — 다른 소스의 이벤트에는 영향을 주지
 * 않는다. actor는 항상 null이다: mock RepairCase/LocalRepairCase 어느 쪽에도
 * "등록자" 필드가 없으므로 지어내지 않는다.
 */
export function caseCreatedAdapter(resolved: ResolvedRepairCase): UnifiedActivityEvent[] {
  if (Number.isNaN(Date.parse(resolved.createdAt))) return [];

  return [
    {
      id: buildUnifiedEventId("CASE_CREATED", resolved.id),
      repairCaseId: resolved.id,
      occurredAt: resolved.createdAt,
      sourceType: "CASE_CREATED",
      eventType: "CASE_CREATED",
      category: "CASE_CREATED",
      title: "접수 등록",
      description: null,
      actorUserId: null,
      actorNameSnapshot: null,
      previousStatus: null,
      nextStatus: null,
      workflowType: null,
      previousWorkflowStepKey: null,
      nextWorkflowStepKey: null,
      relatedApprovalType: null,
      relatedApprovalDecision: null,
      relatedAttachmentId: null,
      relatedAttachmentName: null,
      relatedAttachmentCategory: null,
      workDetails: null,
      sourceRecordId: resolved.id,
      source: resolved.source === "MOCK" ? "SEEDED_MOCK" : "LOCAL_DEMO",
    },
  ];
}
