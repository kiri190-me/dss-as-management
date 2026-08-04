"use client";

import { useMemo } from "react";
import { buildWorkHistoryRows } from "../../work-history-rows";
import { useApprovalStore, useShipmentDelegations } from "../approval/use-approval-data";
import { useAttachmentStore } from "../attachments/use-attachment-data";
import { isLocalId } from "../local-types";
import type { ResolvedRepairCase } from "../resolved-repair-case";
import { useWorkflowStore } from "../workflow/use-workflow-data";
import {
  approvalAdapter,
  attachmentAdapter,
  caseCreatedAdapter,
  workflowAdapter,
  workHistoryAdapter,
} from "./adapters";
import type { ActivitySourceType, UnifiedActivityEvent } from "./activity-types";

const SOURCE_PRIORITY: Record<ActivitySourceType, number> = {
  WORKFLOW: 0,
  APPROVAL: 1,
  ATTACHMENT: 2,
  WORK_HISTORY: 3,
  CASE_CREATED: 4,
};

/** occurredAt이 Date.parse로 파싱되지 않는 이벤트만 건너뛴다(그 하나만) —
 * 다른 소스의 이벤트에는 영향을 주지 않는다. */
function withValidTimestamp(events: UnifiedActivityEvent[]): UnifiedActivityEvent[] {
  return events.filter((e) => !Number.isNaN(Date.parse(e.occurredAt)));
}

/** sourceType+sourceRecordId 조합(= id)으로만 중복을 제거한다 — 시간/설명/
 * 상태/액터가 같아 보여도 id가 다르면 절대 합치지 않는다. */
export function dedupeActivityEvents(events: UnifiedActivityEvent[]): UnifiedActivityEvent[] {
  const seen = new Set<string>();
  const result: UnifiedActivityEvent[] = [];
  for (const e of events) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    result.push(e);
  }
  return result;
}

/**
 * 절대 문자열 사전순으로 정렬하지 않는다 — Date.parse로 얻은 실제 epoch
 * 밀리초로만 비교한다(occurredAt 형식이 소스마다 다르므로 문자열 비교는
 * 신뢰할 수 없다).
 */
export function sortActivityEvents(events: UnifiedActivityEvent[]): UnifiedActivityEvent[] {
  return [...events].sort((a, b) => {
    const diff = Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
    if (diff !== 0) return diff;
    const priorityDiff = SOURCE_PRIORITY[a.sourceType] - SOURCE_PRIORITY[b.sourceType];
    if (priorityDiff !== 0) return priorityDiff;
    return a.sourceRecordId.localeCompare(b.sourceRecordId);
  });
}

export type UseUnifiedActivityResult = {
  /** 정규화 + 중복 제거 + 정렬까지 끝난, 아직 필터가 적용되지 않은 전체 목록. */
  events: UnifiedActivityEvent[];
  isHydrated: boolean;
  /** isMalformed인 로컬 저장소 목록이다(작업 이력/CASE_CREATED는 이 배열에
   * 절대 포함되지 않는다 — mock 데이터는 손상될 수 없다). */
  malformedSources: ActivitySourceType[];
};

/**
 * 이 훅 하나가 5개 소스를 합치는 유일한 지점이다 — 어떤 UI 컴포넌트도
 * 직접 각 스토어 훅을 호출해 병합하지 않는다. 정규화·중복 제거·정렬을
 * 한 번의 useMemo로 수행하고, 필터링은 호출부(ActivityTimelineScreen)가
 * 별도의 두 번째 useMemo로 이어서 수행한다.
 */
export function useUnifiedActivity(resolved: ResolvedRepairCase | null): UseUnifiedActivityResult {
  const workflowStore = useWorkflowStore();
  const approvalStore = useApprovalStore();
  const delegationStore = useShipmentDelegations();
  const attachmentStore = useAttachmentStore();

  const events = useMemo(() => {
    if (!resolved) return [];

    const workHistoryRows = isLocalId(resolved.id) ? [] : buildWorkHistoryRows(resolved.id);
    const caseWorkflowEvents = workflowStore.events.filter((e) => e.repairCaseId === resolved.id);
    const caseApprovalEvents = approvalStore.events.filter((e) => e.repairCaseId === resolved.id);
    const caseAttachmentEvents = attachmentStore.events.filter((e) => e.repairCaseId === resolved.id);

    const merged: UnifiedActivityEvent[] = [
      ...caseCreatedAdapter(resolved),
      ...workHistoryAdapter(workHistoryRows),
      ...workflowAdapter(caseWorkflowEvents, approvalStore.records),
      ...approvalAdapter(caseApprovalEvents, delegationStore.delegations),
      ...attachmentAdapter(caseAttachmentEvents, attachmentStore.records),
    ];

    return sortActivityEvents(dedupeActivityEvents(withValidTimestamp(merged)));
  }, [
    resolved,
    workflowStore.events,
    approvalStore.records,
    approvalStore.events,
    delegationStore.delegations,
    attachmentStore.records,
    attachmentStore.events,
  ]);

  const malformedSources: ActivitySourceType[] = [
    ...(workflowStore.isMalformed ? (["WORKFLOW"] as const) : []),
    ...(approvalStore.isMalformed ? (["APPROVAL"] as const) : []),
    ...(attachmentStore.isMalformed ? (["ATTACHMENT"] as const) : []),
  ];

  return {
    events,
    isHydrated:
      workflowStore.isHydrated && approvalStore.isHydrated && delegationStore.isHydrated && attachmentStore.isHydrated,
    malformedSources,
  };
}
