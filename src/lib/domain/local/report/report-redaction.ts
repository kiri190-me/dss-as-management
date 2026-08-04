import type { UnifiedActivityEvent, WorkActivityDetails } from "../activity/activity-types";
import type {
  ApprovalSummaryEntry,
  AttachmentSummaryEntry,
  RepairCaseReportData,
  RedactionMode,
  WorkflowStepProgress,
} from "./report-types";

/**
 * Stage F-1 전용 순수 리댁션(마스킹) 변환이다. applyRedaction은 항상 새
 * RepairCaseReportData 객체를 반환하며, 입력으로 받은 reportData나 그 안의
 * 어떤 중첩 객체/배열도 절대 mutate하지 않는다(모든 레벨에서 새 객체/배열을
 * 만든다). 이 파일은 화면 표시 시점의 마스킹일 뿐이며, 원본 로컬 스토리지
 * 레코드에는 어떤 경로로도 접근하거나 쓰지 않는다.
 */

const MASK_MARKER = " (데모 마스킹)";

/** 같은 문자열에 마커가 이미 붙어 있으면 다시 붙이지 않는다(우발적 이중 적용 방지). */
function withMarker(value: string): string {
  return value.endsWith(MASK_MARKER) ? value : value + MASK_MARKER;
}

/** null은 항상 null로 남긴다 — 존재하지 않는 값을 "비공개" 문구로 지어내지 않는다. */
function maskNullable(value: string | null, maskFn: (v: string) => string): string | null {
  return value === null ? null : maskFn(value);
}

/** 앞 2글자만 보존하고 나머지는 ○로 마스킹한다. 1~2글자 입력도 예외 없이 처리한다. */
function maskNamePartial(name: string): string {
  const visible = name.slice(0, 2);
  const hiddenCount = Math.max(name.length - visible.length, 0);
  return withMarker(visible + "○".repeat(hiddenCount));
}

/** 길이가 4보다 클 때만 끝 4자리만 남기고 마스킹한다. 4자 이하는 그대로 표시한다
 * (끝 4자리를 보여주는 규칙 자체가 이미 전체를 노출하는 것과 같으므로). */
function maskFinalFour(value: string): string {
  const masked = value.length > 4 ? `****${value.slice(-4)}` : value;
  return withMarker(masked);
}

/** DEMO_SAFE 고정 치환 문구용. 원본 값은 보지 않는다. */
function maskFixed(replacement: string): string {
  return withMarker(replacement);
}

function maskNullableFixed(value: string | null, replacement: string): string | null {
  return value === null ? null : withMarker(replacement);
}

const DEMO_SAFE_CUSTOMER_HIDDEN = "고객사 정보 비공개";
const DEMO_SAFE_END_USER_HIDDEN = "End-User 정보 비공개";
const DEMO_SAFE_IDENTIFIER_HIDDEN = "비공개";
const DEMO_SAFE_PERSON_HIDDEN = "담당자 비공개";
const DEMO_SAFE_TEXT_HIDDEN = "내용 비공개";
const DEMO_SAFE_FILENAME_HIDDEN = "파일명 비공개";

const REDACTION_DISCLOSURE_LIMITATION = "마스킹은 화면 표시 시점에만 적용되며 되돌릴 수 없는 익명화가 아닙니다.";

function appendRedactionLimitation(limitations: readonly string[]): string[] {
  if (limitations.includes(REDACTION_DISCLOSURE_LIMITATION)) {
    return [...limitations];
  }
  return [...limitations, REDACTION_DISCLOSURE_LIMITATION];
}

// ---- UnifiedActivityEvent 전용 복제/마스킹 헬퍼 ---------------------------
// workSummary/activityTimeline 둘 다 이 하나의 헬퍼만 거친다(별도 로직 두 벌을
// 만들지 않는다). id/sourceType/sourceRecordId/category/workflowType/
// previousStatus/nextStatus/previousWorkflowStepKey/nextWorkflowStepKey/
// relatedApprovalType/relatedApprovalDecision/relatedAttachmentCategory/
// occurredAt/source/eventType/title/relatedAttachmentId/actorUserId는 어떤
// 모드에서도 절대 건드리지 않는다 — actorNameSnapshot/description/
// relatedAttachmentName/workDetails의 5개 텍스트 필드만 DEMO_SAFE에서 치환한다.

function cloneWorkDetails(details: WorkActivityDetails | null): WorkActivityDetails | null {
  return details ? { ...details } : null;
}

function cloneActivityEvent(event: UnifiedActivityEvent): UnifiedActivityEvent {
  return { ...event, workDetails: cloneWorkDetails(event.workDetails) };
}

function cloneActivityEvents(events: readonly UnifiedActivityEvent[]): UnifiedActivityEvent[] {
  return events.map(cloneActivityEvent);
}

function demoSafeActivityEvent(event: UnifiedActivityEvent): UnifiedActivityEvent {
  const workDetails = event.workDetails
    ? {
        symptom: maskNullableFixed(event.workDetails.symptom, DEMO_SAFE_TEXT_HIDDEN),
        suspectedCause: maskNullableFixed(event.workDetails.suspectedCause, DEMO_SAFE_TEXT_HIDDEN),
        actionTaken: maskNullableFixed(event.workDetails.actionTaken, DEMO_SAFE_TEXT_HIDDEN),
        partsUsed: maskNullableFixed(event.workDetails.partsUsed, DEMO_SAFE_TEXT_HIDDEN),
        nextAction: maskNullableFixed(event.workDetails.nextAction, DEMO_SAFE_TEXT_HIDDEN),
      }
    : null;

  return {
    ...event,
    actorNameSnapshot: maskNullableFixed(event.actorNameSnapshot, DEMO_SAFE_PERSON_HIDDEN),
    description: maskNullableFixed(event.description, DEMO_SAFE_TEXT_HIDDEN),
    relatedAttachmentName: maskNullableFixed(event.relatedAttachmentName, DEMO_SAFE_FILENAME_HIDDEN),
    workDetails,
  };
}

// ---- 나머지 중첩 구조 복제 헬퍼 -------------------------------------------

function cloneApprovalEntry(entry: ApprovalSummaryEntry): ApprovalSummaryEntry {
  return { ...entry };
}

function demoSafeApprovalEntry(entry: ApprovalSummaryEntry): ApprovalSummaryEntry {
  return {
    ...entry,
    requestedByName: maskNullableFixed(entry.requestedByName, DEMO_SAFE_PERSON_HIDDEN),
    decidedByName: maskNullableFixed(entry.decidedByName, DEMO_SAFE_PERSON_HIDDEN),
    decisionComment: maskNullableFixed(entry.decisionComment, DEMO_SAFE_TEXT_HIDDEN),
    delegateName: maskNullableFixed(entry.delegateName, DEMO_SAFE_PERSON_HIDDEN),
  };
}

function cloneAttachmentEntry(entry: AttachmentSummaryEntry): AttachmentSummaryEntry {
  return { ...entry };
}

function demoSafeAttachmentEntry(entry: AttachmentSummaryEntry): AttachmentSummaryEntry {
  return {
    ...entry,
    displayName: maskFixed(DEMO_SAFE_FILENAME_HIDDEN),
    originalFileName: maskFixed(DEMO_SAFE_FILENAME_HIDDEN),
    uploadedByName: maskFixed(DEMO_SAFE_PERSON_HIDDEN),
  };
}

function cloneWorkflowStep(step: WorkflowStepProgress): WorkflowStepProgress {
  return { ...step };
}

/**
 * 전체 구조를 새 객체/배열 그래프로 복제한다. NONE 모드는 이 함수의 결과를
 * 그대로 반환한다 — 값은 원본과 같지만 참조는 항상 독립적이다(호출자가
 * 반환값을 수정해도 원본 reportData에 영향이 없다).
 */
function cloneReportData(data: RepairCaseReportData): RepairCaseReportData {
  return {
    ...data,
    repairCase: { ...data.repairCase },
    customer: { ...data.customer },
    product: { ...data.product },
    intake: { ...data.intake },
    workSummary: cloneActivityEvents(data.workSummary),
    workflowSummary: data.workflowSummary.map(cloneWorkflowStep),
    approvalSummary: {
      repairInspection: cloneApprovalEntry(data.approvalSummary.repairInspection),
      finalShipment: cloneApprovalEntry(data.approvalSummary.finalShipment),
    },
    // KyosanEvidenceSnapshot = { status, evidenceType, referenceNumber, evidenceDate, note } —
    // 이름/코멘트/이메일 형태 텍스트 필드가 존재하지 않는다(실제 타입 확인 완료).
    // 따라서 얕은 복제만 하고 어떤 모드에서도 값을 치환하지 않는다.
    kyosanEvidence: { ...data.kyosanEvidence },
    attachmentSummary: data.attachmentSummary.map(cloneAttachmentEntry),
    activityTimeline: cloneActivityEvents(data.activityTimeline),
    limitations: [...data.limitations],
  };
}

function applyPartial(data: RepairCaseReportData): RepairCaseReportData {
  const base = cloneReportData(data);

  return {
    ...base,
    customer: {
      customerName: maskNamePartial(base.customer.customerName),
      endUserName: maskNullable(base.customer.endUserName, maskNamePartial),
    },
    product: {
      ...base.product,
      serialNumber: maskFinalFour(base.product.serialNumber),
      lotNumber: maskFinalFour(base.product.lotNumber),
    },
    // repairCase/intake/workSummary/workflowSummary/approvalSummary/kyosanEvidence/
    // attachmentSummary/activityTimeline은 base(복제본)에서 그대로 유지한다 —
    // PARTIAL 모드에서는 직원 이름·코멘트·설명·작업 상세·파일명을 전부 원문 그대로 둔다.
    limitations: appendRedactionLimitation(base.limitations),
  };
}

function applyDemoSafe(data: RepairCaseReportData): RepairCaseReportData {
  const base = cloneReportData(data);

  return {
    ...base,
    repairCase: {
      ...base.repairCase,
      holdReason: maskNullableFixed(base.repairCase.holdReason, DEMO_SAFE_TEXT_HIDDEN),
    },
    customer: {
      customerName: maskFixed(DEMO_SAFE_CUSTOMER_HIDDEN),
      endUserName: maskNullableFixed(base.customer.endUserName, DEMO_SAFE_END_USER_HIDDEN),
    },
    product: {
      ...base.product,
      serialNumber: maskFixed(DEMO_SAFE_IDENTIFIER_HIDDEN),
      lotNumber: maskFixed(DEMO_SAFE_IDENTIFIER_HIDDEN),
    },
    intake: {
      ...base.intake,
      assignedEngineerName: maskNullableFixed(base.intake.assignedEngineerName, DEMO_SAFE_PERSON_HIDDEN),
    },
    workSummary: base.workSummary.map(demoSafeActivityEvent),
    activityTimeline: base.activityTimeline.map(demoSafeActivityEvent),
    approvalSummary: {
      repairInspection: demoSafeApprovalEntry(base.approvalSummary.repairInspection),
      finalShipment: demoSafeApprovalEntry(base.approvalSummary.finalShipment),
    },
    attachmentSummary: base.attachmentSummary.map(demoSafeAttachmentEntry),
    // kyosanEvidence: base.kyosanEvidence는 이미 cloneReportData에서 얕은 복제되었고
    // 치환할 이름/코멘트 필드가 없으므로 그대로 유지한다(§Kyosan 참고).
    limitations: appendRedactionLimitation(base.limitations),
  };
}

export function applyRedaction(reportData: RepairCaseReportData, mode: RedactionMode): RepairCaseReportData {
  if (mode === "NONE") {
    return cloneReportData(reportData);
  }
  if (mode === "PARTIAL") {
    return applyPartial(reportData);
  }
  return applyDemoSafe(reportData);
}
