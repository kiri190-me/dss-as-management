import type { ApprovalType, DisplayApprovalStatus } from "../approval/approval-types";
import type { KyosanEvidenceSnapshot } from "../approval/kyosan-evidence";
import type { AttachmentCategory, LocalMalwareScanStatus, PreviewStatus } from "../attachments/attachment-types";
import type { UnifiedActivityEvent } from "../activity/activity-types";
import type { StepCategory } from "../workflow/step-category";
import type { ExceptionStatus, Priority, RepairStatus, WorkflowType } from "../../types";

// Stage F-1 읽기 전용 보고서 미리보기 모델. 어떤 원본 저장소도 이 타입을 위해
// mutate되지 않으며, buildReportData는 이미 검증된 훅 결과를 입력받는 순수
// 함수다(localStorage를 직접 읽지 않는다).

export const REPORT_TYPE_CODES = ["SERVICE_SUMMARY", "INSPECTION_REPORT", "REPAIR_REPORT", "SHIPMENT_REPORT"] as const;
export type ReportType = (typeof REPORT_TYPE_CODES)[number];
export const reportTypeLabels: Record<ReportType, string> = {
  SERVICE_SUMMARY: "A/S 종합 보고서",
  INSPECTION_REPORT: "점검 보고서",
  REPAIR_REPORT: "수리 보고서",
  SHIPMENT_REPORT: "출하 보고서",
};

/**
 * Stage F-1에서는 SERVICE_SUMMARY만 실제로 선택 가능하다 — 나머지 3종은
 * 코드/라벨만 존재하는 미래 확장용이며, UI에는 비활성 옵션으로만 노출한다.
 */
export const ENABLED_REPORT_TYPES: ReadonlySet<ReportType> = new Set(["SERVICE_SUMMARY"]);
export const REPORT_TYPE_COMING_SOON_NOTICE = "점검·수리·출하 전용 양식은 추후 지원 예정입니다.";

export const REPORT_SECTION_CODES = [
  "BASIC_INFO",
  "CURRENT_STATUS",
  "LIMITATIONS",
  "CUSTOMER_INFO",
  "PRODUCT_INFO",
  "REPORTED_SYMPTOM",
  "WORKFLOW_PROGRESS",
  "WORK_SUMMARY",
  "APPROVAL_HISTORY",
  "KYOSAN_EVIDENCE",
  "ATTACHMENT_METADATA",
  "ACTIVITY_TIMELINE",
  "SHIPMENT_INFO",
  "DATA_WARNINGS",
] as const;
export type ReportSection = (typeof REPORT_SECTION_CODES)[number];
export const reportSectionLabels: Record<ReportSection, string> = {
  BASIC_INFO: "기본 접수 정보",
  CURRENT_STATUS: "현재 진행 상태",
  LIMITATIONS: "데모 제한 안내",
  CUSTOMER_INFO: "고객사 및 End-User",
  PRODUCT_INFO: "제품 정보",
  REPORTED_SYMPTOM: "고장 증상",
  WORKFLOW_PROGRESS: "워크플로 진행",
  WORK_SUMMARY: "작업 이력",
  APPROVAL_HISTORY: "승인 이력",
  KYOSAN_EVIDENCE: "교산 증빙",
  ATTACHMENT_METADATA: "첨부파일 메타데이터",
  ACTIVITY_TIMELINE: "통합 활동 이력",
  SHIPMENT_INFO: "출하 정보",
  DATA_WARNINGS: "데이터 품질 경고",
};

/** 이 3개는 체크박스가 항상 checked+disabled로 렌더링된다 — 해제할 수 없다. */
export const REQUIRED_REPORT_SECTIONS: ReadonlySet<ReportSection> = new Set(["BASIC_INFO", "CURRENT_STATUS", "LIMITATIONS"]);

export const REDACTION_MODE_CODES = ["NONE", "PARTIAL", "DEMO_SAFE"] as const;
export type RedactionMode = (typeof REDACTION_MODE_CODES)[number];
export const redactionModeLabels: Record<RedactionMode, string> = {
  NONE: "원문 표시",
  PARTIAL: "일부 마스킹",
  DEMO_SAFE: "고객·장비 식별정보 숨김",
};

export const ACTIVITY_LIMIT_CODES = ["LATEST_20", "LATEST_50", "ALL"] as const;
export type ActivityLimit = (typeof ACTIVITY_LIMIT_CODES)[number];
export const activityLimitLabels: Record<ActivityLimit, string> = {
  LATEST_20: "최근 20건",
  LATEST_50: "최근 50건",
  ALL: "전체",
};

/** step-category.ts는 Korean 라벨을 export하지 않으므로 보고서 표시 전용으로 여기서만 정의한다. */
export const stepCategoryLabels: Record<StepCategory, string> = {
  TECHNICAL: "기술",
  BUSINESS: "영업/교산",
  PARTS_SHIPMENT: "부품/출하",
};

export type ReportSelection = {
  reportType: ReportType;
  sections: Record<ReportSection, boolean>;
  redactionMode: RedactionMode;
  includeDeletedAttachments: boolean;
  activityLimit: ActivityLimit;
  activityDateFrom: string;
  activityDateTo: string;
  includeWarningsInDocument: boolean;
};

const ALWAYS_ON_SECTIONS: ReportSection[] = [
  "BASIC_INFO",
  "CURRENT_STATUS",
  "LIMITATIONS",
  "CUSTOMER_INFO",
  "PRODUCT_INFO",
  "REPORTED_SYMPTOM",
  "WORKFLOW_PROGRESS",
  "WORK_SUMMARY",
  "APPROVAL_HISTORY",
  "KYOSAN_EVIDENCE",
  "ATTACHMENT_METADATA",
  "SHIPMENT_INFO",
  "DATA_WARNINGS",
];

export function buildDefaultReportSelection(): ReportSelection {
  const sections = REPORT_SECTION_CODES.reduce(
    (acc, code) => {
      acc[code] = ALWAYS_ON_SECTIONS.includes(code);
      return acc;
    },
    {} as Record<ReportSection, boolean>
  );
  sections.ACTIVITY_TIMELINE = false;

  return {
    reportType: "SERVICE_SUMMARY",
    sections,
    redactionMode: "NONE",
    includeDeletedAttachments: false,
    activityLimit: "LATEST_20",
    activityDateFrom: "",
    activityDateTo: "",
    includeWarningsInDocument: true,
  };
}

export type WorkflowStepProgress = {
  key: string;
  label: string;
  order: number;
  category: StepCategory | null;
  state: "COMPLETED" | "CURRENT" | "UPCOMING";
};

export type ApprovalSummaryEntry = {
  approvalType: ApprovalType;
  status: DisplayApprovalStatus;
  requestedByUserId: string | null;
  requestedByName: string | null;
  requestedAt: string | null;
  decidedByUserId: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  usedDelegation: boolean;
  delegateName: string | null;
};

export type AttachmentSummaryEntry = {
  id: string;
  displayName: string;
  originalFileName: string;
  category: AttachmentCategory;
  categoryLabel: string;
  fileExtension: string;
  fileSizeBytes: number;
  fileSizeLabel: string;
  uploadedByUserId: string;
  uploadedByName: string;
  uploadedAt: string;
  previewStatus: PreviewStatus;
  malwareScanStatus: LocalMalwareScanStatus;
  isDeleted: boolean;
  checksumDisclaimer: string;
};

export type RepairCaseReportData = {
  generatedAt: string;
  referenceDate: string;
  reportType: ReportType;
  generatedByName: string | null;

  repairCase: {
    id: string;
    intakeNumber: string;
    receivedAt: string;
    createdAt: string;
    currentStatus: RepairStatus;
    currentStatusLabel: string;
    workflowType: WorkflowType;
    currentWorkflowStepKey: string;
    currentWorkflowStepLabel: string;
    priority: Priority;
    exceptionStatus: ExceptionStatus | null;
    isOnHold: boolean;
    holdReason: string | null;
    isOverdue: boolean;
    source: "MOCK" | "LOCAL_DEMO" | "DATABASE";
  };

  customer: { customerName: string; endUserName: string | null };

  product: { modelName: string; lotNumber: string; serialNumber: string; partNumber: string | null };

  intake: {
    reportedSymptom: string | null;
    internalTargetShipmentDate: string | null;
    actualShipmentDate: string | null;
    assignedEngineerName: string | null;
  };

  workSummary: UnifiedActivityEvent[];
  workflowSummary: WorkflowStepProgress[];
  approvalSummary: { repairInspection: ApprovalSummaryEntry; finalShipment: ApprovalSummaryEntry };
  kyosanEvidence: KyosanEvidenceSnapshot;
  attachmentSummary: AttachmentSummaryEntry[];
  activityTimeline: UnifiedActivityEvent[];

  limitations: string[];
};

export const FIXED_LIMITATIONS: string[] = [
  "이 보고서는 브라우저 localStorage 기반 로컬 데모 데이터로 생성되었습니다.",
  "브라우저 인쇄 기능을 사용한 데모이며, 서버에서 생성한 PDF가 아닙니다.",
  "이 화면은 위변조 방지 기능이 없으며 운영 승인 문서로 사용할 수 없습니다.",
  "마스킹(비공개 처리)은 화면 표시 시점에만 적용되며 되돌릴 수 없는 익명화가 아닙니다.",
  "전자서명, 인장, 실제 첨부파일 원본은 포함되어 있지 않습니다.",
  "localStorage는 브라우저 개발자 도구로 임의 수정될 수 있습니다.",
  "기밀 운영 데이터에는 사용하지 마십시오.",
];
