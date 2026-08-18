import ApprovalStatusBadge from "@/components/repair-cases/approval/ApprovalStatusBadge";
import KyosanEvidenceCard from "@/components/repair-cases/approval/KyosanEvidenceCard";
import { HoldBadge, OverdueBadge, PriorityBadge, SourceBadge, StatusBadge } from "@/components/repair-cases/badges";
import ExceptionStatusNotice from "@/components/repair-cases/detail/ExceptionStatusNotice";
import {
  CategoryBadge,
  DeletedStatusBadge,
  MalwareScanStatusBadge,
  PreviewStatusBadge,
} from "@/components/repair-cases/files/badges";
import { approvalTypeLabels } from "@/lib/domain/local/approval/approval-types";
import { formatAttachmentDateTime } from "@/lib/domain/local/attachments/format";
import type { UnifiedActivityEvent } from "@/lib/domain/local/activity/activity-types";
import { reportSectionLabels, stepCategoryLabels, type RepairCaseReportData, type WorkflowStepProgress } from "@/lib/domain/local/report/report-types";
import { priorityLabels, workflowTypeLabels } from "@/lib/domain/types";

/**
 * Stage F-1 전용 순수 프레젠테이션 섹션 모음이다. 훅을 쓰지 않고,
 * localStorage/세션/window에 접근하지 않으며, 전달받은 어떤 값도 mutate하지
 * 않는다. reportData는 이미 리댁션이 적용된 결과라고 가정한다 — 여기서
 * RedactionMode를 검사하거나 값을 다시 가리는 로직을 절대 넣지 않는다.
 * attachmentSummary도 이미 호출부(ReportPreview)가 includeDeletedAttachments
 * 기준으로 필터링을 마친 배열이라고 가정한다.
 *
 * "report-section"/"report-section-compact" 클래스는 이후 스테이지의 인쇄용
 * CSS 훅이다 — 지금은 전역 CSS를 추가하지 않는다.
 */

const sectionBaseClass =
  "report-section rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";
const sectionCompactClass = `${sectionBaseClass} report-section-compact`;
const thBaseClass =
  "border-b border-zinc-200 bg-white px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400";
const tdBaseClass = "px-3 py-2 align-top";
const emptyStateClass =
  "rounded-lg border border-zinc-200 bg-white p-4 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400";

const INFO_NONE = "정보 없음";

function orInfoNone(value: string | null): string {
  return value ?? INFO_NONE;
}

/**
 * repairCase.createdAt/approval requestedAt·decidedAt/attachment uploadedAt처럼
 * 전체 ISO datetime 문자열에 쓴다. 파싱 실패/누락 시 "정보 없음"을 반환하며,
 * 인자 없는 new Date()로 "지금"을 대체값으로 쓰지 않는다.
 */
function formatReportDateTime(iso: string | null): string {
  if (!iso) return INFO_NONE;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return INFO_NONE;
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * receivedAt/internalTargetShipmentDate/actualShipmentDate/evidenceDate처럼
 * "YYYY-MM-DD" 날짜 전용 문자열에 쓴다. new Date("YYYY-MM-DD")는 UTC 자정으로
 * 해석되어 시간대에 따라 날짜가 하루 밀릴 수 있으므로(activity/filters.ts의
 * localDayStartMs와 동일한 이유), 문자열을 직접 분해해 로컬 Date를 만든다.
 */
function formatReportDateOnly(value: string | null): string {
  if (!value) return INFO_NONE;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return INFO_NONE;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return INFO_NONE;
  return date.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-sm text-zinc-900 dark:text-zinc-50">{orInfoNone(value)}</dd>
    </div>
  );
}

// ---- BASIC_INFO ------------------------------------------------------------

export function BasicInfoSection({
  repairCase,
  assignedEngineerName,
}: {
  repairCase: RepairCaseReportData["repairCase"];
  assignedEngineerName: string | null;
}) {
  return (
    <section className={sectionBaseClass}>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{reportSectionLabels.BASIC_INFO}</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <PriorityBadge priority={repairCase.priority} />
        <SourceBadge source={repairCase.source} />
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <Field label="접수번호" value={repairCase.intakeNumber} />
        <Field label="보고서번호" value={repairCase.legacyReportNumber} />
        <Field label="인수일" value={formatReportDateOnly(repairCase.receivedAt)} />
        <Field label="접수 등록 일시" value={formatReportDateTime(repairCase.createdAt)} />
        <Field label="담당 엔지니어" value={assignedEngineerName} />
        <Field label="워크플로 유형" value={workflowTypeLabels[repairCase.workflowType]} />
        <Field label="우선순위" value={priorityLabels[repairCase.priority]} />
      </dl>
    </section>
  );
}

// ---- CUSTOMER_INFO ----------------------------------------------------------

export function CustomerInfoSection({ customer }: { customer: RepairCaseReportData["customer"] }) {
  return (
    <section className={sectionBaseClass}>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{reportSectionLabels.CUSTOMER_INFO}</h2>
      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <Field label="고객사" value={customer.customerName} />
        <Field label="End-User" value={customer.endUserName} />
      </dl>
    </section>
  );
}

// ---- PRODUCT_INFO ------------------------------------------------------------

export function ProductInfoSection({ product }: { product: RepairCaseReportData["product"] }) {
  return (
    <section className={sectionBaseClass}>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{reportSectionLabels.PRODUCT_INFO}</h2>
      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <Field label="Model" value={product.modelName} />
        <Field label="L/N" value={product.lotNumber} />
        <Field label="S/N" value={product.serialNumber} />
      </dl>
    </section>
  );
}

// ---- REPORTED_SYMPTOM --------------------------------------------------------

export function ReportedSymptomSection({ reportedSymptom }: { reportedSymptom: string | null }) {
  return (
    <section className={sectionCompactClass}>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{reportSectionLabels.REPORTED_SYMPTOM}</h2>
      <p className="mt-2 text-sm break-words text-zinc-900 dark:text-zinc-50">{orInfoNone(reportedSymptom)}</p>
    </section>
  );
}

// ---- CURRENT_STATUS -----------------------------------------------------------

export function CurrentStatusSection({ repairCase }: { repairCase: RepairCaseReportData["repairCase"] }) {
  return (
    <section className={sectionBaseClass}>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{reportSectionLabels.CURRENT_STATUS}</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusBadge status={repairCase.currentStatus} />
        <HoldBadge isOnHold={repairCase.isOnHold} />
        <OverdueBadge isOverdue={repairCase.isOverdue} />
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <Field label="현재 상태" value={repairCase.currentStatusLabel} />
        <Field label="현재 워크플로 단계" value={repairCase.currentWorkflowStepLabel} />
        <Field label="보류 사유" value={repairCase.holdReason} />
      </dl>
      <div className="mt-3">
        <ExceptionStatusNotice exceptionStatus={repairCase.exceptionStatus} />
      </div>
    </section>
  );
}

// ---- WORKFLOW_PROGRESS --------------------------------------------------------

const WORKFLOW_STEP_STATE_LABELS: Record<WorkflowStepProgress["state"], string> = {
  COMPLETED: "완료",
  CURRENT: "현재 단계",
  UPCOMING: "예정",
};

const WORKFLOW_STEP_STATE_CLASSES: Record<WorkflowStepProgress["state"], string> = {
  COMPLETED: "border-green-300 bg-green-50 dark:border-green-900 dark:bg-green-950",
  CURRENT: "border-zinc-900 bg-zinc-50 dark:border-zinc-50 dark:bg-zinc-800",
  UPCOMING: "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900",
};

/** 이 목록은 접수 시점 기준 유효 단계(effectiveWorkflowStepKey)만 "현재 단계"로
 * 표시한다 — 과거 이력이 아니다. 실제 운영용 워크플로 엔진이 아닌 데모 순서
 * 표시라는 점은 report-adapter.ts의 buildWorkflowSummary가 이미 보장한다. */
export function WorkflowProgressSection({ steps }: { steps: WorkflowStepProgress[] }) {
  return (
    <section className={sectionBaseClass}>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{reportSectionLabels.WORKFLOW_PROGRESS}</h2>
      <ol className="mt-3 flex flex-col gap-2">
        {steps.map((step) => (
          <li
            key={step.key}
            className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm ${WORKFLOW_STEP_STATE_CLASSES[step.state]}`}
          >
            <span className="text-zinc-900 dark:text-zinc-50">
              {step.order}. {step.label}
              {step.category && (
                <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">({stepCategoryLabels[step.category]})</span>
              )}
            </span>
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{WORKFLOW_STEP_STATE_LABELS[step.state]}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---- WORK_SUMMARY --------------------------------------------------------------

/** 통합 활동 이력(ACTIVITY_TIMELINE) 전체를 다시 보여주지 않는다 — 작업
 * 이력(WORK_HISTORY) 항목만 간결한 표로 요약한다. 과거 시점 값을 그대로
 * 보존하며 재해석하지 않는다. */
export function WorkSummarySection({ events }: { events: UnifiedActivityEvent[] }) {
  return (
    <section className={sectionBaseClass}>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{reportSectionLabels.WORK_SUMMARY}</h2>
      {events.length === 0 ? (
        <p className={`mt-3 ${emptyStateClass}`}>등록된 작업 이력이 없습니다.</p>
      ) : (
        <>
          <div className="mt-3 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <caption className="sr-only">작업 이력 목록</caption>
              <thead>
                <tr>
                  <th scope="col" className={thBaseClass}>일시</th>
                  <th scope="col" className={thBaseClass}>작업자</th>
                  <th scope="col" className={thBaseClass}>증상</th>
                  <th scope="col" className={thBaseClass}>조치 내용</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    <td className={`${tdBaseClass} whitespace-nowrap`}>
                      <time dateTime={event.occurredAt}>{formatReportDateTime(event.occurredAt)}</time>
                    </td>
                    <td className={`${tdBaseClass} whitespace-nowrap`}>{orInfoNone(event.actorNameSnapshot)}</td>
                    <td className={`${tdBaseClass} max-w-[240px] break-words`}>
                      {orInfoNone(event.workDetails?.symptom ?? null)}
                    </td>
                    <td className={`${tdBaseClass} max-w-[280px] break-words`}>
                      {orInfoNone(event.workDetails?.actionTaken ?? event.description ?? null)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="mt-3 flex flex-col gap-2 md:hidden">
            {events.map((event) => (
              <li key={event.id} className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <time dateTime={event.occurredAt} className="text-xs text-zinc-500 dark:text-zinc-400">
                  {formatReportDateTime(event.occurredAt)}
                </time>
                <p className="mt-1 text-zinc-900 dark:text-zinc-50">처리자: {orInfoNone(event.actorNameSnapshot)}</p>
                <p className="mt-1 break-words text-zinc-700 dark:text-zinc-300">
                  증상: {orInfoNone(event.workDetails?.symptom ?? null)}
                </p>
                <p className="mt-1 break-words text-zinc-700 dark:text-zinc-300">
                  조치: {orInfoNone(event.workDetails?.actionTaken ?? event.description ?? null)}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// ---- APPROVAL_HISTORY -----------------------------------------------------------

function ApprovalEntryBlock({ entry }: { entry: RepairCaseReportData["approvalSummary"]["repairInspection"] }) {
  return (
    <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{approvalTypeLabels[entry.approvalType]}</h3>
        <ApprovalStatusBadge status={entry.status} />
      </div>
      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <Field label="요청자" value={entry.requestedByName} />
        <Field label="승인자" value={entry.decidedByName} />
        <Field label="요청 시각" value={formatReportDateTime(entry.requestedAt)} />
        <Field label="결정 시각" value={formatReportDateTime(entry.decidedAt)} />
      </dl>
      <div className="mt-2">
        <Field label="결정 코멘트" value={entry.decisionComment} />
      </div>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        {entry.usedDelegation ? `대표 위임 처리됨 (위임자: ${orInfoNone(entry.delegateName)})` : "위임 없이 처리됨"}
      </p>
    </div>
  );
}

/** 검수 승인과 최종 출하 승인을 절대 하나로 합치지 않고 각각 별도 블록으로
 * 보여준다. 저장된 현재 상태(status)를 그대로 표시하며, 전자서명이 존재한다는
 * 표현은 어디에도 쓰지 않는다. */
export function ApprovalHistorySection({
  approvalSummary,
}: {
  approvalSummary: RepairCaseReportData["approvalSummary"];
}) {
  return (
    <section className={sectionBaseClass}>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{reportSectionLabels.APPROVAL_HISTORY}</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ApprovalEntryBlock entry={approvalSummary.repairInspection} />
        <ApprovalEntryBlock entry={approvalSummary.finalShipment} />
      </div>
    </section>
  );
}

// ---- KYOSAN_EVIDENCE -----------------------------------------------------------

/** 기존 KyosanEvidenceCard(순수 표시 전용, 액션 버튼 없음)를 그대로 재사용한다
 * — 내부 승인 이력과 절대 같은 블록으로 합치지 않는다. "실제 이메일이나
 * 문서는 첨부되지 않은 데모 증빙입니다."는 evidence.note에 이미 고정되어
 * 있다(getKyosanEvidenceSnapshot 참고). */
export function KyosanEvidenceSection({ evidence }: { evidence: RepairCaseReportData["kyosanEvidence"] }) {
  return (
    <div className="report-section report-section-compact">
      <KyosanEvidenceCard evidence={evidence} />
    </div>
  );
}

// ---- ATTACHMENT_METADATA --------------------------------------------------------

const CURRENT_METADATA_DISCLAIMER = "현재 저장된 첨부파일 메타데이터 기준이며, 실제 파일 원본은 포함되지 않습니다.";
const NO_REAL_SCAN_DISCLAIMER = "악성코드 검사 상태는 데모 시뮬레이션 값이며, 실제 백신 검사 결과가 아닙니다.";

export function AttachmentMetadataSection({
  attachments,
}: {
  attachments: RepairCaseReportData["attachmentSummary"];
}) {
  const checksumDisclaimer = attachments[0]?.checksumDisclaimer ?? null;

  return (
    <section className={sectionBaseClass}>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{reportSectionLabels.ATTACHMENT_METADATA}</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{CURRENT_METADATA_DISCLAIMER}</p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{NO_REAL_SCAN_DISCLAIMER}</p>
      {checksumDisclaimer && <p className="text-xs text-zinc-500 dark:text-zinc-400">{checksumDisclaimer}</p>}

      {attachments.length === 0 ? (
        <p className={`mt-3 ${emptyStateClass}`}>표시할 첨부파일 메타데이터가 없습니다.</p>
      ) : (
        <>
          <div className="mt-3 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <caption className="sr-only">첨부파일 메타데이터 목록</caption>
              <thead>
                <tr>
                  <th scope="col" className={thBaseClass}>파일명</th>
                  <th scope="col" className={thBaseClass}>분류</th>
                  <th scope="col" className={thBaseClass}>크기</th>
                  <th scope="col" className={thBaseClass}>업로더</th>
                  <th scope="col" className={thBaseClass}>업로드 일시</th>
                  <th scope="col" className={thBaseClass}>미리보기</th>
                  <th scope="col" className={thBaseClass}>검사 상태</th>
                  <th scope="col" className={thBaseClass}>삭제 상태</th>
                </tr>
              </thead>
              <tbody>
                {attachments.map((entry) => (
                  <tr key={entry.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    <td className={`${tdBaseClass} max-w-[220px] break-all`}>
                      <p className="font-medium text-zinc-900 dark:text-zinc-50">{entry.displayName}</p>
                      {entry.displayName !== entry.originalFileName && (
                        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">원본: {entry.originalFileName}</p>
                      )}
                    </td>
                    <td className={tdBaseClass}>
                      <CategoryBadge category={entry.category} />
                    </td>
                    <td className={`${tdBaseClass} whitespace-nowrap`}>
                      .{entry.fileExtension} / {entry.fileSizeLabel}
                    </td>
                    <td className={`${tdBaseClass} whitespace-nowrap`}>{entry.uploadedByName}</td>
                    <td className={`${tdBaseClass} whitespace-nowrap`}>{formatAttachmentDateTime(entry.uploadedAt)}</td>
                    <td className={tdBaseClass}>
                      <PreviewStatusBadge status={entry.previewStatus} />
                    </td>
                    <td className={tdBaseClass}>
                      <MalwareScanStatusBadge status={entry.malwareScanStatus} />
                    </td>
                    <td className={tdBaseClass}>
                      <DeletedStatusBadge isDeleted={entry.isDeleted} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="mt-3 flex flex-col gap-2 md:hidden">
            {attachments.map((entry) => (
              <li key={entry.id} className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium break-all text-zinc-900 dark:text-zinc-50">{entry.displayName}</p>
                  <DeletedStatusBadge isDeleted={entry.isDeleted} />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <CategoryBadge category={entry.category} />
                  <PreviewStatusBadge status={entry.previewStatus} />
                  <MalwareScanStatusBadge status={entry.malwareScanStatus} />
                </div>
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                  .{entry.fileExtension} / {entry.fileSizeLabel} · {entry.uploadedByName}
                </p>
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{formatAttachmentDateTime(entry.uploadedAt)}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// ---- SHIPMENT_INFO -----------------------------------------------------------

export function ShipmentInfoSection({ intake }: { intake: RepairCaseReportData["intake"] }) {
  const shipmentStatusLabel = intake.actualShipmentDate ? "출하 완료" : "출하 대기";
  return (
    <section className={sectionCompactClass}>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{reportSectionLabels.SHIPMENT_INFO}</h2>
      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Field label="사내 목표 출하일" value={formatReportDateOnly(intake.internalTargetShipmentDate)} />
        <Field label="실제 출하일" value={formatReportDateOnly(intake.actualShipmentDate)} />
        <Field label="출하 상태" value={shipmentStatusLabel} />
      </dl>
    </section>
  );
}

// ---- LIMITATIONS -----------------------------------------------------------

export function LimitationsSection({ limitations }: { limitations: readonly string[] }) {
  return (
    <section className={sectionCompactClass}>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{reportSectionLabels.LIMITATIONS}</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
        {limitations.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

// ---- DATA_WARNINGS -----------------------------------------------------------

/** 이 컴포넌트는 malformedSources 등 어떤 스토어 플래그도 직접 읽지 않는다 —
 * 호출부가 이미 계산해 넘긴 문자열만 그대로 나열한다. */
export function DataWarningsSection({ warnings }: { warnings: readonly string[] }) {
  if (warnings.length === 0) return null;

  return (
    <section className={sectionCompactClass}>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{reportSectionLabels.DATA_WARNINGS}</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800 dark:text-amber-300">
        {warnings.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
