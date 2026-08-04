import { mockRepairCases, mockUsers } from "../../mock-data";
import { isLocalId } from "../local-types";
import { isNonEmptyTrimmedString, isNotEarlierThan, isValidIsoDateTimeString } from "../validation";
import {
  APPROVAL_TYPE_CODES,
  STORED_APPROVAL_STATUS_CODES,
  APPROVAL_EVENT_TYPE_CODES,
  type ApprovalType,
  type LocalApprovalEvent,
  type LocalApprovalRecord,
  type StoredApprovalStatus,
  type ApprovalEventType,
} from "./approval-types";
import type { LocalShipmentDelegation } from "./delegation-types";

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

/**
 * 승인 레코드 검증. 관계/보안에 민감한 값(요청자·결정자 ID, 위임 ID)이
 * 잘못되면 다른 값으로 "보정"하지 않고 레코드 전체를 버린다. 이름 스냅샷은
 * 현재 mockUsers 이름으로 덮어쓰지 않고 저장된 값 그대로 신뢰한다 — 스냅샷은
 * 그 시점의 표시값을 보존하기 위한 것이지, 매번 최신 이름으로 재계산되는
 * 필드가 아니다.
 */
export function validateApprovalRecord(
  raw: unknown,
  ctx: { validDelegationIds: ReadonlySet<string> }
): LocalApprovalRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  if (!isNonEmptyTrimmedString(r.id) || !r.id.startsWith("approval-")) return null;
  if (!isKnownRepairCaseId(r.repairCaseId)) return null;
  if (!isOneOf<ApprovalType>(r.approvalType, APPROVAL_TYPE_CODES)) return null;
  if (!isOneOf<StoredApprovalStatus>(r.status, STORED_APPROVAL_STATUS_CODES)) return null;

  if (!isNonEmptyTrimmedString(r.requestedByUserId) || !findUser(r.requestedByUserId)) return null;
  if (!isNonEmptyTrimmedString(r.requestedByNameSnapshot)) return null;
  if (!isValidIsoDateTimeString(r.requestedAt)) return null;

  if (r.status === "PENDING") {
    if (
      r.decidedByUserId !== null ||
      r.decidedByNameSnapshot !== null ||
      r.decidedAt !== null ||
      r.decisionComment !== null ||
      r.delegationId !== null
    ) {
      return null;
    }
  } else {
    if (!isNonEmptyTrimmedString(r.decidedByUserId) || !findUser(r.decidedByUserId)) return null;
    if (!isNonEmptyTrimmedString(r.decidedByNameSnapshot)) return null;
    if (!isValidIsoDateTimeString(r.decidedAt)) return null;
    if (!isNotEarlierThan(r.decidedAt, r.requestedAt as string)) return null;

    if (r.status === "CHANGES_REQUESTED" || r.status === "REJECTED") {
      if (!isNonEmptyTrimmedString(r.decisionComment)) return null;
    } else if (r.decisionComment !== null && !isNonEmptyTrimmedString(r.decisionComment)) {
      return null;
    }

    if (r.delegationId !== null) {
      if (r.approvalType !== "FINAL_SHIPMENT") return null;
      if (!isNonEmptyTrimmedString(r.delegationId) || !ctx.validDelegationIds.has(r.delegationId)) {
        return null;
      }
    }
  }

  if (!isValidIsoDateTimeString(r.createdAt)) return null;
  if (!isValidIsoDateTimeString(r.updatedAt)) return null;
  if (!isNotEarlierThan(r.updatedAt as string, r.createdAt as string)) return null;
  if (r.source !== "LOCAL_DEMO") return null;

  return {
    id: r.id,
    repairCaseId: r.repairCaseId as string,
    approvalType: r.approvalType as ApprovalType,
    status: r.status as StoredApprovalStatus,
    requestedByUserId: r.requestedByUserId,
    requestedByNameSnapshot: r.requestedByNameSnapshot as string,
    requestedAt: r.requestedAt as string,
    decidedByUserId: (r.decidedByUserId as string | null) ?? null,
    decidedByNameSnapshot: (r.decidedByNameSnapshot as string | null) ?? null,
    decidedAt: (r.decidedAt as string | null) ?? null,
    decisionComment: (r.decisionComment as string | null) ?? null,
    delegationId: (r.delegationId as string | null) ?? null,
    createdAt: r.createdAt as string,
    updatedAt: r.updatedAt as string,
    source: "LOCAL_DEMO",
  };
}

/** id 중복, (repairCaseId, approvalType) 중복을 모두 제거한다(먼저 등장한 것을 유지). */
export function dedupeApprovalRecords(records: LocalApprovalRecord[]): LocalApprovalRecord[] {
  const seenIds = new Set<string>();
  const seenPairs = new Set<string>();
  const result: LocalApprovalRecord[] = [];
  for (const record of records) {
    const pairKey = `${record.repairCaseId}::${record.approvalType}`;
    if (seenIds.has(record.id) || seenPairs.has(pairKey)) continue;
    seenIds.add(record.id);
    seenPairs.add(pairKey);
    result.push(record);
  }
  return result;
}

/**
 * 이벤트는 반드시 검증을 통과한 현재 레코드 목록을 기준으로만 검증한다 —
 * 참조하는 레코드가 없거나, repairCaseId/approvalType이 레코드와 다르면
 * 고아 이벤트로 간주해 버린다(화면에 표시하지 않는다).
 */
export function validateApprovalEvent(
  raw: unknown,
  ctx: { recordsById: ReadonlyMap<string, LocalApprovalRecord>; validDelegationIds: ReadonlySet<string> }
): LocalApprovalEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  if (!isNonEmptyTrimmedString(r.id) || !r.id.startsWith("approval-event-")) return null;
  if (!isNonEmptyTrimmedString(r.approvalRecordId)) return null;
  const record = ctx.recordsById.get(r.approvalRecordId);
  if (!record) return null;

  if (r.repairCaseId !== record.repairCaseId) return null;
  if (r.approvalType !== record.approvalType) return null;
  if (!isOneOf<ApprovalEventType>(r.eventType, APPROVAL_EVENT_TYPE_CODES)) return null;

  if (!isNonEmptyTrimmedString(r.actorUserId) || !findUser(r.actorUserId)) return null;
  if (!isNonEmptyTrimmedString(r.actorNameSnapshot)) return null;
  if (!isValidIsoDateTimeString(r.occurredAt)) return null;

  if (r.comment !== null && !isNonEmptyTrimmedString(r.comment)) return null;

  if (r.delegationId !== null) {
    if (record.approvalType !== "FINAL_SHIPMENT") return null;
    if (!isNonEmptyTrimmedString(r.delegationId) || !ctx.validDelegationIds.has(r.delegationId)) {
      return null;
    }
  }

  if (r.source !== "LOCAL_DEMO") return null;

  return {
    id: r.id,
    approvalRecordId: r.approvalRecordId,
    repairCaseId: record.repairCaseId,
    approvalType: record.approvalType,
    eventType: r.eventType as ApprovalEventType,
    actorUserId: r.actorUserId,
    actorNameSnapshot: r.actorNameSnapshot as string,
    occurredAt: r.occurredAt as string,
    comment: (r.comment as string | null) ?? null,
    delegationId: (r.delegationId as string | null) ?? null,
    source: "LOCAL_DEMO",
  };
}

export function dedupeApprovalEvents(events: LocalApprovalEvent[]): LocalApprovalEvent[] {
  const seen = new Set<string>();
  const result: LocalApprovalEvent[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    result.push(event);
  }
  return result;
}

export function validateDelegation(raw: unknown): LocalShipmentDelegation | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  if (!isNonEmptyTrimmedString(r.id) || !r.id.startsWith("delegation-")) return null;
  if (!isNonEmptyTrimmedString(r.principalUserId) || !findUser(r.principalUserId)) return null;
  if (!isNonEmptyTrimmedString(r.principalNameSnapshot)) return null;
  if (!isNonEmptyTrimmedString(r.delegateUserId) || !findUser(r.delegateUserId)) return null;
  if (!isNonEmptyTrimmedString(r.delegateNameSnapshot)) return null;
  if (r.principalUserId === r.delegateUserId) return null;
  if (!isValidIsoDateTimeString(r.startsAt)) return null;
  if (!isValidIsoDateTimeString(r.endsAt)) return null;
  if (!((r.startsAt as string) < (r.endsAt as string))) return null;
  if (!isNonEmptyTrimmedString(r.reason)) return null;
  if (!isValidIsoDateTimeString(r.createdAt)) return null;
  if (r.source !== "LOCAL_DEMO") return null;

  return {
    id: r.id,
    principalUserId: r.principalUserId,
    principalNameSnapshot: r.principalNameSnapshot as string,
    delegateUserId: r.delegateUserId,
    delegateNameSnapshot: r.delegateNameSnapshot as string,
    startsAt: r.startsAt as string,
    endsAt: r.endsAt as string,
    reason: r.reason as string,
    createdAt: r.createdAt as string,
    source: "LOCAL_DEMO",
  };
}

export function dedupeDelegations(delegations: LocalShipmentDelegation[]): LocalShipmentDelegation[] {
  const seen = new Set<string>();
  const result: LocalShipmentDelegation[] = [];
  for (const delegation of delegations) {
    if (seen.has(delegation.id)) continue;
    seen.add(delegation.id);
    result.push(delegation);
  }
  return result;
}
