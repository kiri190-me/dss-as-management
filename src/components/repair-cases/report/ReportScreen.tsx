"use client";

import { useMemo, useState } from "react";
import LoadingNotice from "@/components/domain/LoadingNotice";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import { validateActivityDateRange } from "@/lib/domain/local/activity/filters";
import { applyRedaction } from "@/lib/domain/local/report/report-redaction";
import { buildReportFilename } from "@/lib/domain/local/report/report-filename";
import {
  buildDefaultReportSelection,
  reportTypeLabels,
  type ApprovalSummaryEntry,
  type ReportSelection,
} from "@/lib/domain/local/report/report-types";
import { useReportData } from "@/lib/domain/local/report/use-report-data";
import { useEffectiveRepairCase, type EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import ReportControlPanel from "./ReportControlPanel";
import ReportHeaderSummary from "./ReportHeaderSummary";
import ReportPreview from "./ReportPreview";
import ReportPrintButton from "./ReportPrintButton";

/**
 * Stage F-1 메인 오케스트레이터다. 기존 어댑터/훅을 그대로 조립할 뿐,
 * 워크플로/승인/첨부파일/활동 정규화 로직을 다시 만들지 않는다. reportType은
 * 이 파일 전체에서 절대 selection.reportType을 그대로 쓰지 않고 항상
 * "SERVICE_SUMMARY" 리터럴로 고정한다 — ReportControlPanel이 이미 비활성
 * 종류를 선택하지 못하게 막고 있지만, 실제 보고서 데이터/파일명 생성
 * 경로에서 한 번 더 강제해 비활성 종류가 실제 데이터에 절대 들어가지
 * 않는다는 보장을 완결시킨다.
 */

function isApprovalDataUnverifiable(entry: ApprovalSummaryEntry): boolean {
  if (entry.status === "NOT_REQUESTED") return false;
  if (!entry.requestedByName) return true;
  if (
    (entry.status === "APPROVED" || entry.status === "REJECTED" || entry.status === "CHANGES_REQUESTED") &&
    !entry.decidedByName
  ) {
    return true;
  }
  return false;
}

function ReportBuildErrorNotice() {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
    >
      보고서 데이터를 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.
    </div>
  );
}

export type ReportScreenProps = {
  resolved: ResolvedRepairCase;
  generatedByUser: ActingUser | null;
};

/** 이미 확보한 ResolvedRepairCase에 워크플로 재정의를 입힌다(Stage E-1 단일
 * 병합 지점 패턴, ActivityTimelineScreen/ApprovalScreen과 동일). */
export default function ReportScreen({ resolved, generatedByUser }: ReportScreenProps) {
  const { effective, isHydrated: effectiveHydrated } = useEffectiveRepairCase(resolved);

  if (!effectiveHydrated || !effective) {
    return <LoadingNotice />;
  }

  return <ReportScreenBody effective={effective} generatedByUser={generatedByUser} />;
}

/**
 * useReportData는 effectiveRepairCase가 non-null이어야 하므로, effective가
 * 준비되기 전까지는 이 컴포넌트 자체를 마운트하지 않는다(위 ReportScreen의
 * 로딩 게이트) — 그래야 이 컴포넌트 안의 훅들은 항상 무조건 호출된다(Rules
 * of Hooks를 어기지 않는다).
 */
function ReportScreenBody({
  effective,
  generatedByUser,
}: {
  effective: EffectiveRepairCase;
  generatedByUser: ActingUser | null;
}) {
  const [selection, setSelection] = useState<ReportSelection>(buildDefaultReportSelection());
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [hasInitializedGeneratedAt, setHasInitializedGeneratedAt] = useState(false);

  const generatedByName = generatedByUser?.name ?? null;

  const {
    reportData,
    isHydrated: reportDataHydrated,
    malformedSources,
  } = useReportData({
    effectiveRepairCase: effective,
    reportType: "SERVICE_SUMMARY",
    generatedAt: generatedAt ?? "",
    generatedByName,
  });

  // 렌더 중 상태 조정 패턴이다(ReportControlPanel의 날짜 draft 동기화와 동일한
  // 이유로 useEffect+setState 대신 이 방식을 쓴다) — reportDataHydrated가
  // 처음 true가 되는 순간에만 실제 벽시계 시각으로 generatedAt을 한 번
  // 초기화한다. hasInitializedGeneratedAt이 true가 된 이후에는 이 블록이
  // 다시 실행되지 않으므로, selection/리댁션 모드가 바뀌어도 generatedAt은
  // 그대로 보존된다. "생성 시각 갱신" 버튼(handleRefreshGeneratedAt)만
  // 이후에 명시적으로 이 값을 교체할 수 있다.
  if (reportDataHydrated && !hasInitializedGeneratedAt) {
    setHasInitializedGeneratedAt(true);
    setGeneratedAt(new Date().toISOString());
  }

  const redactedReportData = useMemo(() => {
    if (!reportData) return null;
    return applyRedaction(reportData, selection.redactionMode);
  }, [reportData, selection.redactionMode]);

  // 삭제된 첨부파일 포함 여부만 반영한 새 객체를 필요할 때만 만든다 —
  // redactedReportData나 그 안의 다른 필드는 절대 mutate하지 않는다.
  const displayedReportData = useMemo(() => {
    if (!redactedReportData) return null;
    if (selection.includeDeletedAttachments) return redactedReportData;
    return {
      ...redactedReportData,
      attachmentSummary: redactedReportData.attachmentSummary.filter((entry) => !entry.isDeleted),
    };
  }, [redactedReportData, selection.includeDeletedAttachments]);

  // 통합 활동 이력 처리 순서: 1) 리댁션된 activityTimeline에서 시작 2) 유효
  // 날짜 범위 적용 3) LATEST_20/50이면 최신순 정렬 후 앞에서 N개만 선택
  // 4) 최종적으로 항상 오래된 순 -> 최신 순으로 정렬해 표시한다(ALL은 자르지
  // 않고 동일하게 오래된 순으로 정렬). 문자열 사전순 비교를 쓰지 않고
  // Date.parse epoch만 비교하며, 파싱 실패 항목은 전체를 깨뜨리지 않고
  // 개별적으로만 제외한다.
  const activityEvents = useMemo(() => {
    if (!displayedReportData) return [];

    const withEpoch = displayedReportData.activityTimeline
      .map((event) => ({ event, epoch: Date.parse(event.occurredAt) }))
      .filter((entry) => !Number.isNaN(entry.epoch));

    const dateValidation = validateActivityDateRange(selection.activityDateFrom, selection.activityDateTo);
    const withinRange = withEpoch.filter(({ epoch }) => {
      if (dateValidation.startMs !== null && epoch < dateValidation.startMs) return false;
      if (dateValidation.endMs !== null && epoch > dateValidation.endMs) return false;
      return true;
    });

    const newestFirst = [...withinRange].sort((a, b) => b.epoch - a.epoch);
    const limited =
      selection.activityLimit === "LATEST_20"
        ? newestFirst.slice(0, 20)
        : selection.activityLimit === "LATEST_50"
          ? newestFirst.slice(0, 50)
          : newestFirst;

    return limited.sort((a, b) => a.epoch - b.epoch).map((entry) => entry.event);
  }, [displayedReportData, selection.activityDateFrom, selection.activityDateTo, selection.activityLimit]);

  // 데이터 품질 경고는 항상 리댁션 이전의 원본 reportData를 기준으로
  // 판단한다 — 리댁션이 값을 마스킹 문구로 바꿔버리면 "정보 없음"과
  // "마스킹됨"을 구분할 수 없어지기 때문이다. NOT_REQUESTED처럼 정상적으로
  // 있을 수 있는 상태는 절대 경고로 취급하지 않는다 — 데이터가 손상됐다고
  // 주장하지 않고 중립적으로만 알린다.
  const dataWarnings = useMemo(() => {
    if (!reportData) return [];
    const warnings: string[] = [];

    if (malformedSources.includes("WORKFLOW")) {
      warnings.push("워크플로 데이터를 확인할 수 없어 이번 세션에서는 빈 상태로 표시되었습니다.");
    }
    if (malformedSources.includes("APPROVAL")) {
      warnings.push("승인 데이터를 확인할 수 없어 이번 세션에서는 빈 상태로 표시되었습니다.");
    }
    if (malformedSources.includes("DELEGATION")) {
      warnings.push("승인 위임 데이터를 확인할 수 없어 이번 세션에서는 빈 상태로 표시되었습니다.");
    }
    if (malformedSources.includes("ATTACHMENT")) {
      warnings.push("첨부파일 데이터를 확인할 수 없어 이번 세션에서는 빈 상태로 표시되었습니다.");
    }

    if (!reportData.intake.assignedEngineerName) {
      warnings.push("담당 엔지니어 정보가 없습니다.");
    }
    if (reportData.product.serialNumber === "-") {
      warnings.push("제품 일련번호(S/N) 정보가 없습니다.");
    }
    if (reportData.product.lotNumber === "-") {
      warnings.push("제품 LOT 번호 정보가 없습니다.");
    }
    if (isApprovalDataUnverifiable(reportData.approvalSummary.repairInspection)) {
      warnings.push("수리 검수 승인 정보를 확인할 수 없습니다.");
    }
    if (isApprovalDataUnverifiable(reportData.approvalSummary.finalShipment)) {
      warnings.push("최종 출하 승인 정보를 확인할 수 없습니다.");
    }

    return warnings;
  }, [reportData, malformedSources]);

  const isReportReady = reportDataHydrated && generatedAt !== null && displayedReportData !== null;

  const proposedFilename = useMemo(() => {
    if (!generatedAt) return "";
    return buildReportFilename("SERVICE_SUMMARY", effective.intakeNumber, generatedAt, "pdf");
  }, [effective.intakeNumber, generatedAt]);

  function handleReset() {
    setSelection(buildDefaultReportSelection());
  }

  function handleRefreshGeneratedAt() {
    setGeneratedAt(new Date().toISOString());
  }

  if (!reportDataHydrated) {
    return <LoadingNotice />;
  }

  if (!displayedReportData || !generatedAt) {
    return <ReportBuildErrorNotice />;
  }

  const hasDataWarnings = dataWarnings.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <ReportHeaderSummary
        intakeNumber={displayedReportData.repairCase.intakeNumber}
        reportTitle={reportTypeLabels[displayedReportData.reportType]}
        generatedAt={displayedReportData.generatedAt}
        generatedByName={displayedReportData.generatedByName}
        currentStatusLabel={displayedReportData.repairCase.currentStatusLabel}
        currentWorkflowStepLabel={displayedReportData.repairCase.currentWorkflowStepLabel}
        source={displayedReportData.repairCase.source}
        proposedFilename={proposedFilename}
        isOnHold={displayedReportData.repairCase.isOnHold}
        isOverdue={displayedReportData.repairCase.isOverdue}
      />

      <ReportControlPanel
        selection={selection}
        onSelectionChange={setSelection}
        malformedSources={malformedSources}
        hasDataWarnings={hasDataWarnings}
        isReportReady={isReportReady}
        onReset={handleReset}
        onRefreshGeneratedAt={handleRefreshGeneratedAt}
      />

      <ReportPrintButton proposedFilename={proposedFilename} isReady={isReportReady} hasWarnings={hasDataWarnings} />

      <ReportPreview
        reportData={displayedReportData}
        selectedSections={selection.sections}
        activityEvents={activityEvents}
        dataWarnings={dataWarnings}
      />
    </div>
  );
}
