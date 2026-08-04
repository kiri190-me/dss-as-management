import { getApprovalStoreSnapshot, writeApprovalEnvelope } from "./approval-storage";
import { getDelegationsSnapshot } from "./delegation-storage";
import { validateApprovalEvent, validateApprovalRecord } from "./validation";
import {
  findRecordFor,
  isInspectionApprovedFor,
  isInspectionDecideEligible,
  isRequestEligible,
  resolveShipmentAuthorization,
  type ActingUser,
} from "./transitions";
import type { ApprovalType, LocalApprovalEvent, LocalApprovalRecord } from "./approval-types";

function generateApprovalRecordId(): string {
  return `approval-${crypto.randomUUID()}`;
}
function generateApprovalEventId(): string {
  return `approval-event-${crypto.randomUUID()}`;
}

export type ActionErrorReason =
  | "NOT_ELIGIBLE"
  | "INVALID_TRANSITION"
  | "ALREADY_TERMINAL"
  | "COMMENT_REQUIRED"
  | "INSPECTION_NOT_APPROVED"
  | "REPRESENTATIVE_OR_DELEGATE_REQUIRED"
  | "STORAGE_CONFLICT";

export const actionErrorMessages: Record<ActionErrorReason, string> = {
  NOT_ELIGIBLE: "이 작업을 수행할 권한이 있는 데모 역할이 아닙니다.",
  INVALID_TRANSITION: "현재 상태에서는 이 작업을 수행할 수 없습니다.",
  ALREADY_TERMINAL: "이미 승인 완료되어 이 데모 단계에서는 추가 처리를 할 수 없습니다.",
  COMMENT_REQUIRED: "보완 요청 또는 반려 시에는 코멘트를 입력해야 합니다.",
  INSPECTION_NOT_APPROVED: "수리 검수 승인이 완료된 후 최종 출하 승인을 요청할 수 있습니다.",
  REPRESENTATIVE_OR_DELEGATE_REQUIRED: "대표 또는 유효한 위임을 받은 사용자만 처리할 수 있습니다.",
  STORAGE_CONFLICT: "저장 중 충돌이 발생했습니다. 다시 시도해 주세요.",
};

export type ActionResult =
  | { ok: true; record: LocalApprovalRecord }
  | { ok: false; reason: ActionErrorReason };

export type RequestApprovalInput = {
  repairCaseId: string;
  approvalType: ApprovalType;
  actingUser: ActingUser;
};

export type DecideApprovalInput = {
  repairCaseId: string;
  approvalType: ApprovalType;
  decision: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";
  comment: string | null;
  actingUser: ActingUser;
};

/**
 * 요청/재요청 액션. 매번 호출될 때마다 1) 최신 저장소를 다시 읽고
 * 2) 전환 규칙과 3) 자격을 다시 검증한 뒤에만 쓴다 — 버튼이 비활성화되어
 * 있었는지 여부에 의존하지 않는다.
 */
export function requestApproval(input: RequestApprovalInput): ActionResult {
  const { repairCaseId, approvalType, actingUser } = input;
  const { records, events } = getApprovalStoreSnapshot();

  const existing = findRecordFor(records, repairCaseId, approvalType);
  if (existing && (existing.status === "PENDING" || existing.status === "APPROVED")) {
    return { ok: false, reason: "INVALID_TRANSITION" };
  }

  if (!isRequestEligible(actingUser)) {
    return { ok: false, reason: "NOT_ELIGIBLE" };
  }

  if (approvalType === "FINAL_SHIPMENT" && !isInspectionApprovedFor(records, repairCaseId)) {
    return { ok: false, reason: "INSPECTION_NOT_APPROVED" };
  }

  const nowIso = new Date().toISOString();
  const record: LocalApprovalRecord = existing
    ? {
        ...existing,
        status: "PENDING",
        requestedByUserId: actingUser.id,
        requestedByNameSnapshot: actingUser.name,
        requestedAt: nowIso,
        decidedByUserId: null,
        decidedByNameSnapshot: null,
        decidedAt: null,
        decisionComment: null,
        delegationId: null,
        updatedAt: nowIso,
      }
    : {
        id: generateApprovalRecordId(),
        repairCaseId,
        approvalType,
        status: "PENDING",
        requestedByUserId: actingUser.id,
        requestedByNameSnapshot: actingUser.name,
        requestedAt: nowIso,
        decidedByUserId: null,
        decidedByNameSnapshot: null,
        decidedAt: null,
        decisionComment: null,
        delegationId: null,
        createdAt: nowIso,
        updatedAt: nowIso,
        source: "LOCAL_DEMO",
      };

  const event: LocalApprovalEvent = {
    id: generateApprovalEventId(),
    approvalRecordId: record.id,
    repairCaseId,
    approvalType,
    eventType: existing ? "RESUBMITTED" : "REQUESTED",
    actorUserId: actingUser.id,
    actorNameSnapshot: actingUser.name,
    occurredAt: nowIso,
    comment: null,
    delegationId: null,
    source: "LOCAL_DEMO",
  };

  return commit(records, events, record, event);
}

export function decideApproval(input: DecideApprovalInput): ActionResult {
  const { repairCaseId, approvalType, decision, comment, actingUser } = input;
  const { records, events } = getApprovalStoreSnapshot();

  const existing = findRecordFor(records, repairCaseId, approvalType);
  if (!existing) {
    return { ok: false, reason: "INVALID_TRANSITION" }; // 요청 전에는 결정할 수 없다
  }
  if (existing.status === "APPROVED") {
    return { ok: false, reason: "ALREADY_TERMINAL" };
  }
  if (existing.status !== "PENDING") {
    return { ok: false, reason: "INVALID_TRANSITION" };
  }

  const trimmedComment = comment?.trim() || null;
  if ((decision === "CHANGES_REQUESTED" || decision === "REJECTED") && !trimmedComment) {
    return { ok: false, reason: "COMMENT_REQUIRED" };
  }

  const nowIso = new Date().toISOString();
  let delegationId: string | null = null;

  if (approvalType === "REPAIR_INSPECTION") {
    if (!isInspectionDecideEligible(actingUser)) {
      return { ok: false, reason: "NOT_ELIGIBLE" };
    }
  } else {
    const { delegations } = getDelegationsSnapshot();
    const auth = resolveShipmentAuthorization(actingUser, delegations, nowIso);
    if (!auth.allowed) {
      return { ok: false, reason: "REPRESENTATIVE_OR_DELEGATE_REQUIRED" };
    }
    delegationId = auth.delegationId;
  }

  const record: LocalApprovalRecord = {
    ...existing,
    status: decision,
    decidedByUserId: actingUser.id,
    decidedByNameSnapshot: actingUser.name,
    decidedAt: nowIso,
    decisionComment: trimmedComment,
    delegationId,
    updatedAt: nowIso,
  };

  const event: LocalApprovalEvent = {
    id: generateApprovalEventId(),
    approvalRecordId: record.id,
    repairCaseId,
    approvalType,
    eventType: decision,
    actorUserId: actingUser.id,
    actorNameSnapshot: actingUser.name,
    occurredAt: nowIso,
    comment: trimmedComment,
    delegationId,
    source: "LOCAL_DEMO",
  };

  return commit(records, events, record, event);
}

function commit(
  currentRecords: LocalApprovalRecord[],
  currentEvents: LocalApprovalEvent[],
  nextRecord: LocalApprovalRecord,
  nextEvent: LocalApprovalEvent
): ActionResult {
  const { delegations } = getDelegationsSnapshot();
  const validDelegationIds = new Set(delegations.map((d) => d.id));

  // 방어적 재검증: 방금 만든 레코드/이벤트가 저장소 검증 규칙 자체를
  // 통과하는지 다시 확인한다(검증 로직을 단일 소스로 유지).
  if (!validateApprovalRecord(nextRecord, { validDelegationIds })) {
    return { ok: false, reason: "STORAGE_CONFLICT" };
  }

  const nextRecords = [...currentRecords.filter((r) => r.id !== nextRecord.id), nextRecord];
  const recordsById = new Map(nextRecords.map((r) => [r.id, r]));
  if (!validateApprovalEvent(nextEvent, { recordsById, validDelegationIds })) {
    return { ok: false, reason: "STORAGE_CONFLICT" };
  }

  const nextEvents = [...currentEvents, nextEvent];
  writeApprovalEnvelope(nextRecords, nextEvents);
  return { ok: true, record: nextRecord };
}
