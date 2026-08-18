import { workflowSteps } from "../../mock-data";
import { repairStatusLabels } from "../../types";
import { resolveStepLabel } from "../activity/adapters";
import type { UnifiedActivityEvent } from "../activity/activity-types";
import { attachmentCategoryLabels, type LocalAttachmentMetadata } from "../attachments/attachment-types";
import type { LocalApprovalRecord } from "../approval/approval-types";
import type { LocalShipmentDelegation } from "../approval/delegation-types";
import { getKyosanEvidenceSnapshot } from "../approval/kyosan-evidence";
import { getStepCategory } from "../workflow/step-category";
import type { EffectiveRepairCase } from "../workflow/effective-repair-case";
import {
  FIXED_LIMITATIONS,
  type ApprovalSummaryEntry,
  type AttachmentSummaryEntry,
  type RepairCaseReportData,
  type ReportType,
  type WorkflowStepProgress,
} from "./report-types";

/**
 * Stage F-1 전용. 이 어댑터는 순수 함수다 — localStorage를 직접 읽지 않고,
 * React 훅을 쓰지 않으며, 전달받은 어떤 입력도 mutate하지 않는다. 손상된
 * (malformed) 저장소 처리는 이 파일의 책임이 아니다 — 호출부(향후
 * use-report-data.ts)가 각 스토어 훅의 isMalformed를 별도로 관리하고, 손상된
 * 소스의 배열은 이미 비어 있는 채로 이 함수에 전달된다. 이 함수는 그 배열이
 * 왜 비어 있는지 알지 못하며 알 필요도 없다.
 *
 * ReportSelection(섹션 선택/리댁션/첨부파일 삭제 포함 여부/활동 이력
 * latest-20·50·all 범위)은 여기서 적용하지 않는다 — 이 함수는 항상 "선택 이전의
 * 완전한" 모델을 만든다. 섹션 표시 여부·마스킹·개수 제한은 이후 UI/훅
 * 계층에서만 적용한다(순수 데이터 조립과 화면 선택 로직을 분리하기 위함).
 *
 * Stage F-2 방향(문서화만, 이번 스테이지에서 구현하지 않음): 실제 PDF/XLSX
 * 생성은 이 동일한 RepairCaseReportData 모델을 입력으로 받는 전용 백엔드
 * 생성 서비스(또는 작업만 enqueue하는 얇은 Route Handler)에서 서버 측
 * 권한 검사·감사 로그·한글 폰트 임베딩과 함께 수행되어야 하며, NAS 저장/버전
 * 관리도 서버 측에서 처리되어야 한다 — 운영 데이터에 브라우저 localStorage를
 * 신뢰하지 않는다.
 */

const CHECKSUM_DISCLAIMER = "실제 파일 내용이 아닌 메타데이터 기준 데모 체크섬입니다.";

function buildApprovalSummaryEntry(
  approvalType: "REPAIR_INSPECTION" | "FINAL_SHIPMENT",
  records: readonly LocalApprovalRecord[],
  delegations: readonly LocalShipmentDelegation[]
): ApprovalSummaryEntry {
  const record = records.find((r) => r.approvalType === approvalType) ?? null;

  if (!record) {
    return {
      approvalType,
      status: "NOT_REQUESTED",
      requestedByUserId: null,
      requestedByName: null,
      requestedAt: null,
      decidedByUserId: null,
      decidedByName: null,
      decidedAt: null,
      decisionComment: null,
      usedDelegation: false,
      delegateName: null,
    };
  }

  const delegation = record.delegationId ? (delegations.find((d) => d.id === record.delegationId) ?? null) : null;

  return {
    approvalType,
    status: record.status,
    requestedByUserId: record.requestedByUserId,
    requestedByName: record.requestedByNameSnapshot,
    requestedAt: record.requestedAt,
    decidedByUserId: record.decidedByUserId,
    decidedByName: record.decidedByNameSnapshot,
    decidedAt: record.decidedAt,
    decisionComment: record.decisionComment,
    usedDelegation: record.delegationId !== null,
    delegateName: delegation?.delegateNameSnapshot ?? null,
  };
}

function buildWorkflowSummary(effective: EffectiveRepairCase): WorkflowStepProgress[] {
  const steps = workflowSteps
    .filter((s) => s.workflowType === effective.workflowType)
    .slice()
    .sort((a, b) => a.order - b.order);

  const currentStep = steps.find((s) => s.key === effective.effectiveWorkflowStepKey) ?? null;
  const currentOrder = currentStep ? currentStep.order : null;

  return steps.map((s) => ({
    key: s.key,
    label: s.label,
    order: s.order,
    category: getStepCategory(effective.workflowType, s.key) ?? null,
    state: currentOrder === null || s.order > currentOrder ? "UPCOMING" : s.order < currentOrder ? "COMPLETED" : "CURRENT",
  }));
}

function buildAttachmentSummary(records: readonly LocalAttachmentMetadata[]): AttachmentSummaryEntry[] {
  return records.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    originalFileName: r.originalFileName,
    category: r.category,
    categoryLabel: attachmentCategoryLabels[r.category],
    fileExtension: r.fileExtension,
    fileSizeBytes: r.fileSizeBytes,
    fileSizeLabel: formatFileSizeKoreanLocal(r.fileSizeBytes),
    uploadedByUserId: r.uploadedByUserId,
    uploadedByName: r.uploadedByNameSnapshot,
    uploadedAt: r.uploadedAt,
    previewStatus: r.previewStatus,
    malwareScanStatus: r.malwareScanStatus,
    isDeleted: r.isDeleted,
    checksumDisclaimer: CHECKSUM_DISCLAIMER,
  }));
}

/** attachments/format.ts의 formatFileSizeKorean과 동일한 변환이지만, 이 모듈을
 * 첨부파일 도메인 파일에 대한 의존 없이 자기완결적으로 유지하기 위해
 * 별도로 둔다(Stage E-2 activity/format.ts가 이미 채택한 동일한 관례). */
function formatFileSizeKoreanLocal(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export type BuildReportDataInput = {
  effective: EffectiveRepairCase;
  activityEvents: UnifiedActivityEvent[];
  approvalRecords: readonly LocalApprovalRecord[];
  delegations: readonly LocalShipmentDelegation[];
  attachmentRecords: readonly LocalAttachmentMetadata[];
  reportType: ReportType;
  generatedAt: string;
  generatedByName: string | null;
};

export function buildReportData(input: BuildReportDataInput): RepairCaseReportData {
  const { effective, activityEvents, approvalRecords, delegations, attachmentRecords, reportType, generatedAt, generatedByName } = input;

  const workSummary = activityEvents.filter((e) => e.sourceType === "WORK_HISTORY");

  return {
    generatedAt,
    referenceDate: generatedAt.slice(0, 10),
    reportType,
    generatedByName,

    repairCase: {
      id: effective.id,
      intakeNumber: effective.intakeNumber,
      legacyReportNumber: effective.legacyReportNumber,
      receivedAt: effective.receivedAt,
      createdAt: effective.createdAt,
      currentStatus: effective.effectiveStatus,
      currentStatusLabel: repairStatusLabels[effective.effectiveStatus],
      workflowType: effective.workflowType,
      currentWorkflowStepKey: effective.effectiveWorkflowStepKey,
      currentWorkflowStepLabel: resolveStepLabel(effective.workflowType, effective.effectiveWorkflowStepKey) ?? "알 수 없는 단계",
      priority: effective.priority,
      exceptionStatus: effective.exceptionStatus,
      isOnHold: effective.holdState?.isOnHold ?? false,
      holdReason: effective.holdState?.reason ?? null,
      isOverdue: effective.effectiveIsOverdue,
      source: effective.source,
    },

    customer: { customerName: effective.customerName, endUserName: effective.endUserName },

    product: {
      modelName: effective.modelName,
      lotNumber: effective.lotNumber,
      serialNumber: effective.serialNumber,
      partNumber: effective.partNumber,
    },

    intake: {
      reportedSymptom: effective.reportedSymptom,
      internalTargetShipmentDate: effective.internalTargetShipmentDate,
      actualShipmentDate: effective.effectiveActualShipmentDate,
      assignedEngineerName: effective.engineerName,
    },

    workSummary,
    workflowSummary: buildWorkflowSummary(effective),
    approvalSummary: {
      repairInspection: buildApprovalSummaryEntry("REPAIR_INSPECTION", approvalRecords, delegations),
      finalShipment: buildApprovalSummaryEntry("FINAL_SHIPMENT", approvalRecords, delegations),
    },
    kyosanEvidence: getKyosanEvidenceSnapshot(effective.id),
    attachmentSummary: buildAttachmentSummary(attachmentRecords),
    activityTimeline: activityEvents,

    limitations: [...FIXED_LIMITATIONS],
  };
}
