import {
  ApprovalHistorySection,
  AttachmentMetadataSection,
  BasicInfoSection,
  CurrentStatusSection,
  CustomerInfoSection,
  DataWarningsSection,
  KyosanEvidenceSection,
  LimitationsSection,
  ProductInfoSection,
  ReportedSymptomSection,
  ShipmentInfoSection,
  WorkflowProgressSection,
  WorkSummarySection,
} from "./ReportSections";
import ReportTimelineSection from "./ReportTimelineSection";
import { REQUIRED_REPORT_SECTIONS, type RepairCaseReportData, type ReportSection } from "@/lib/domain/local/report/report-types";
import type { UnifiedActivityEvent } from "@/lib/domain/local/activity/activity-types";

/**
 * Stage F-1 전용 순수 오케스트레이션 컴포넌트다. 스토어/세션에 접근하지
 * 않고, window.print()를 호출하지 않으며, generatedAt을 만들거나 리댁션·
 * 활동 필터링을 직접 수행하지 않는다 — reportData/activityEvents/
 * dataWarnings는 전부 호출부(향후 ReportScreen/use-report-data 파생 값)가
 * 이미 준비해 넘긴 값이라고 가정한다. ReportHeaderSummary는 이 컴포넌트
 * 밖(또는 별도)에서 렌더링되므로 여기서 다시 렌더링하지 않는다.
 */

/**
 * 문서에 실제로 인쇄될 때의 안정적인 업무 순서다. report-types.ts의
 * REPORT_SECTION_CODES 선언 순서(체크박스 목록 순서)와는 별개다 — 이 배열이
 * "포함할 항목" 순서를 반영하지 않는다고 해서 버그가 아니다.
 */
const REPORT_DOCUMENT_SECTION_ORDER: ReportSection[] = [
  "BASIC_INFO",
  "CUSTOMER_INFO",
  "PRODUCT_INFO",
  "REPORTED_SYMPTOM",
  "CURRENT_STATUS",
  "WORKFLOW_PROGRESS",
  "WORK_SUMMARY",
  "APPROVAL_HISTORY",
  "KYOSAN_EVIDENCE",
  "ATTACHMENT_METADATA",
  "SHIPMENT_INFO",
  "ACTIVITY_TIMELINE",
  "DATA_WARNINGS",
  "LIMITATIONS",
];

export type ReportPreviewProps = {
  reportData: RepairCaseReportData;
  selectedSections: Readonly<Record<ReportSection, boolean>>;
  activityEvents: readonly UnifiedActivityEvent[];
  dataWarnings: readonly string[];
};

/**
 * 필수 섹션(BASIC_INFO/CURRENT_STATUS/LIMITATIONS)은 호출부의 selectedSections
 * 값이 잘못되어 false로 들어와도 항상 렌더링한다 — ReportControlPanel이 이미
 * 이 세 값을 false로 만들 수 없게 막고 있지만, 여기서도 한 번 더 강제해
 * "필수 섹션이 절대 빠지지 않는다"는 보장을 이 컴포넌트 하나로 완결시킨다.
 * DATA_WARNINGS는 선택되어 있고 실제 경고 문자열이 있을 때만 렌더링한다.
 */
function shouldRenderSection(
  section: ReportSection,
  selectedSections: Readonly<Record<ReportSection, boolean>>,
  dataWarnings: readonly string[]
): boolean {
  if (REQUIRED_REPORT_SECTIONS.has(section)) return true;
  if (section === "DATA_WARNINGS") return selectedSections.DATA_WARNINGS && dataWarnings.length > 0;
  return selectedSections[section];
}

// 이 switch는 REPORT_SECTION_CODES(14종)와 항상 동기화되어야 한다. 새 섹션
// 코드가 추가되면 여기 case도 함께 추가해야 한다 — 누락되어도 런타임 예외를
// 던지지 않고 조용히 아무것도 렌더링하지 않는다(화면을 깨뜨리지 않는다).
function renderSection(
  section: ReportSection,
  reportData: RepairCaseReportData,
  activityEvents: readonly UnifiedActivityEvent[],
  dataWarnings: readonly string[]
) {
  switch (section) {
    case "BASIC_INFO":
      return (
        <BasicInfoSection
          key={section}
          repairCase={reportData.repairCase}
          assignedEngineerName={reportData.intake.assignedEngineerName}
        />
      );
    case "CUSTOMER_INFO":
      return <CustomerInfoSection key={section} customer={reportData.customer} />;
    case "PRODUCT_INFO":
      return <ProductInfoSection key={section} product={reportData.product} />;
    case "REPORTED_SYMPTOM":
      return <ReportedSymptomSection key={section} reportedSymptom={reportData.intake.reportedSymptom} />;
    case "CURRENT_STATUS":
      return <CurrentStatusSection key={section} repairCase={reportData.repairCase} />;
    case "WORKFLOW_PROGRESS":
      return <WorkflowProgressSection key={section} steps={reportData.workflowSummary} />;
    case "WORK_SUMMARY":
      return <WorkSummarySection key={section} events={reportData.workSummary} />;
    case "APPROVAL_HISTORY":
      return <ApprovalHistorySection key={section} approvalSummary={reportData.approvalSummary} />;
    case "KYOSAN_EVIDENCE":
      return <KyosanEvidenceSection key={section} evidence={reportData.kyosanEvidence} />;
    case "ATTACHMENT_METADATA":
      return <AttachmentMetadataSection key={section} attachments={reportData.attachmentSummary} />;
    case "SHIPMENT_INFO":
      return <ShipmentInfoSection key={section} intake={reportData.intake} />;
    case "ACTIVITY_TIMELINE":
      return <ReportTimelineSection key={section} events={activityEvents} />;
    case "DATA_WARNINGS":
      return <DataWarningsSection key={section} warnings={dataWarnings} />;
    case "LIMITATIONS":
      return <LimitationsSection key={section} limitations={reportData.limitations} />;
    default:
      return null;
  }
}

export default function ReportPreview({ reportData, selectedSections, activityEvents, dataWarnings }: ReportPreviewProps) {
  return (
    <article className="report-document flex flex-col gap-4">
      {REPORT_DOCUMENT_SECTION_ORDER.filter((section) => shouldRenderSection(section, selectedSections, dataWarnings)).map(
        (section) => renderSection(section, reportData, activityEvents, dataWarnings)
      )}
    </article>
  );
}
