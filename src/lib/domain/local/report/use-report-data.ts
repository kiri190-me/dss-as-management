"use client";

import { useMemo } from "react";
import { useUnifiedActivity } from "../activity/normalize";
import { useApprovalStore, useShipmentDelegations } from "../approval/use-approval-data";
import { useAttachmentStore } from "../attachments/use-attachment-data";
import type { EffectiveRepairCase } from "../workflow/effective-repair-case";
import { buildReportData } from "./report-adapter";
import type { RepairCaseReportData, ReportType } from "./report-types";

/**
 * Stage F-1 전용. 이 훅은 새 localStorage 키나 저장소를 만들지 않는다 —
 * Stage E-1/E-2에서 이미 검증된 훅(useUnifiedActivity/useApprovalStore/
 * useShipmentDelegations/useAttachmentStore)만 구독하고, 그 결과를 순수
 * buildReportData에 그대로 넘긴다. 워크플로/승인/첨부파일 정규화 로직을
 * 여기서 다시 구현하지 않는다 — effectiveRepairCase는 호출부(향후
 * ReportScreen)가 useEffectiveRepairCase로 이미 계산해 전달한다(이 훅
 * 내부에서 다시 계산하지 않는다).
 *
 * ReportSelection(섹션 선택/리댁션/첨부파일 삭제 필터/활동 이력 20·50·all
 * 범위)은 여기서 적용하지 않는다 — 항상 "선택 이전의 완전한" 모델을
 * 만든다. 그 책임은 ReportScreen/프레젠테이션 계층에 있다.
 */

export const REPORT_MALFORMED_SOURCE_CODES = ["WORKFLOW", "APPROVAL", "DELEGATION", "ATTACHMENT"] as const;
export type ReportMalformedSource = (typeof REPORT_MALFORMED_SOURCE_CODES)[number];

export type UseReportDataOptions = {
  effectiveRepairCase: EffectiveRepairCase;
  reportType: ReportType;
  generatedAt: string;
  generatedByName: string | null;
};

export type UseReportDataResult = {
  reportData: RepairCaseReportData | null;
  isHydrated: boolean;
  malformedSources: ReportMalformedSource[];
};

export function useReportData(options: UseReportDataOptions): UseReportDataResult {
  const { effectiveRepairCase, reportType, generatedAt, generatedByName } = options;

  // EffectiveRepairCase는 ResolvedRepairCase를 확장하므로 useUnifiedActivity에
  // 그대로 넘길 수 있다 — 별도의 resolved 인자를 다시 만들지 않는다.
  const activity = useUnifiedActivity(effectiveRepairCase);
  const approvalStore = useApprovalStore();
  const delegationStore = useShipmentDelegations();
  const attachmentStore = useAttachmentStore();

  // activity.isHydrated는 이미 workflow/approval/delegation/attachment
  // 4개 스토어의 hydration을 전부 AND로 묶은 값이다(useUnifiedActivity 참고).
  // 이 훅이 직접 구독하는 approval/delegation/attachment 스토어의 isHydrated도
  // 같은 useIsHydrated() 마운트 신호를 공유하므로 값은 항상 일치하지만,
  // 이 훅이 실제로 의존하는 모든 소스를 숨기지 않고 명시적으로 나열한다.
  const isHydrated =
    activity.isHydrated && approvalStore.isHydrated && delegationStore.isHydrated && attachmentStore.isHydrated;

  // WORKFLOW/APPROVAL/ATTACHMENT는 useUnifiedActivity가 이미 각 스토어의
  // isMalformed를 판별해 반환한 값을 그대로 재사용한다(같은 파싱을 여기서
  // 다시 하지 않는다). DELEGATION은 useUnifiedActivity가 활동 소스로 다루지
  // 않으므로(위임은 승인 이벤트에 참조로만 쓰인다) delegationStore.isMalformed를
  // 별도로 반영한다 — 그렇지 않으면 위임 데이터 손상이 조용히 사라진다.
  const malformedSources = useMemo<ReportMalformedSource[]>(() => {
    const sources: ReportMalformedSource[] = [];
    if (activity.malformedSources.includes("WORKFLOW")) sources.push("WORKFLOW");
    if (activity.malformedSources.includes("APPROVAL")) sources.push("APPROVAL");
    if (activity.malformedSources.includes("ATTACHMENT")) sources.push("ATTACHMENT");
    if (delegationStore.isMalformed) sources.push("DELEGATION");
    return sources;
  }, [activity.malformedSources, delegationStore.isMalformed]);

  // 손상된 스토어는 이미 스토어 계층에서 빈 배열 + isMalformed:true로
  // 격리되어 있다(절대 예외를 던지지 않고, 손상된 저장소를 덮어쓰지 않는다).
  // 여기서는 그 빈 배열을 있는 그대로 전달할 뿐이다 — 하나의 스토어가
  // 손상되어도 나머지 소스는 그대로 reportData에 반영된다.
  const approvalRecords = useMemo(
    () => approvalStore.records.filter((r) => r.repairCaseId === effectiveRepairCase.id),
    [approvalStore.records, effectiveRepairCase.id]
  );
  const attachmentRecords = useMemo(
    () => attachmentStore.records.filter((r) => r.repairCaseId === effectiveRepairCase.id),
    [attachmentStore.records, effectiveRepairCase.id]
  );
  // LocalShipmentDelegation에는 repairCaseId가 없다(대표자 기준 위임이다) —
  // 승인 레코드의 delegationId로만 매칭되므로(report-adapter.ts 참고)
  // 여기서 필터링하지 않는다. ApprovalScreen과 동일한 관례를 따른다.

  const reportData = useMemo<RepairCaseReportData | null>(() => {
    if (!isHydrated) return null;

    try {
      return buildReportData({
        effective: effectiveRepairCase,
        activityEvents: activity.events,
        approvalRecords,
        delegations: delegationStore.delegations,
        attachmentRecords,
        reportType,
        generatedAt,
        generatedByName,
      });
    } catch {
      // buildReportData는 이미 검증된 훅 결과만 입력받는 순수 함수라 정상
      // 흐름에서는 던지지 않아야 한다. 그래도 예기치 않게 던지면 페이지를
      // 깨뜨리지 않고 null만 반환한다 — malformedSources는 이 catch와
      // 무관하게 위에서 이미 독립적으로 계산되어 있으므로 그대로 노출된다.
      return null;
    }
  }, [
    isHydrated,
    effectiveRepairCase,
    activity.events,
    approvalRecords,
    delegationStore.delegations,
    attachmentRecords,
    reportType,
    generatedAt,
    generatedByName,
  ]);

  return { reportData, isHydrated, malformedSources };
}
