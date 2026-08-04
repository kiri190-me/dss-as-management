// Stage D-2 첨부파일 "메타데이터만" 데모 타입이다. 실제 바이너리는 어떤 경로로도
// 저장하지 않으며, DATABASE_DESIGN.md 10번(Attachment Strategy)에는 아직
// category/description/checksum/previewStatus/originalFileName·displayName
// 분리가 정의되어 있지 않다 — 여기 정의된 필드는 그 실제 스키마 결정이 아니라
// 이 데모 화면 전용 상위 집합이다.

export const ATTACHMENT_CATEGORY_CODES = [
  "INTAKE_PHOTO",
  "EXTERNAL_CONDITION",
  "INSPECTION_REPORT",
  "REPAIR_REPORT",
  "KYOSAN_DOCUMENT",
  "CUSTOMER_DOCUMENT",
  "OSCILLOSCOPE_DATA",
  "LOG_FILE",
  "FIRMWARE",
  "CIRCUIT_DIAGRAM",
  "OTHER",
] as const;
export type AttachmentCategory = (typeof ATTACHMENT_CATEGORY_CODES)[number];
export const attachmentCategoryLabels: Record<AttachmentCategory, string> = {
  INTAKE_PHOTO: "인수 사진",
  EXTERNAL_CONDITION: "외관 상태",
  INSPECTION_REPORT: "점검 보고서",
  REPAIR_REPORT: "수리 보고서",
  KYOSAN_DOCUMENT: "교산 문서",
  CUSTOMER_DOCUMENT: "고객사 문서",
  OSCILLOSCOPE_DATA: "오실로스코프 데이터",
  LOG_FILE: "로그 파일",
  FIRMWARE: "펌웨어",
  CIRCUIT_DIAGRAM: "회로도",
  OTHER: "기타",
};

export const PREVIEW_STATUS_CODES = ["NOT_AVAILABLE", "PENDING", "READY", "FAILED"] as const;
export type PreviewStatus = (typeof PREVIEW_STATUS_CODES)[number];
export const previewStatusLabels: Record<PreviewStatus, string> = {
  NOT_AVAILABLE: "미지원",
  PENDING: "생성 대기",
  READY: "미리보기 가능",
  FAILED: "생성 실패",
};

/**
 * types.ts에 이미 존재하는 단순한 AttachmentMetadata.malwareScanStatus
 * ("PENDING"|"CLEAN"|"INFECTED")와 값 구성이 달라 타입 이름을 분리했다
 * (LocalMalwareScanStatus). 두 타입을 혼용하지 않는다.
 */
export const LOCAL_MALWARE_SCAN_STATUS_CODES = [
  "NOT_SCANNED",
  "PENDING",
  "CLEAN",
  "BLOCKED",
  "ERROR",
] as const;
export type LocalMalwareScanStatus = (typeof LOCAL_MALWARE_SCAN_STATUS_CODES)[number];
export const malwareScanStatusLabels: Record<LocalMalwareScanStatus, string> = {
  NOT_SCANNED: "미검사",
  PENDING: "검사 대기",
  CLEAN: "이상 없음",
  BLOCKED: "차단됨",
  ERROR: "검사 오류",
};

export const ATTACHMENT_EVENT_TYPE_CODES = [
  "CREATED",
  "RENAMED",
  "DESCRIPTION_UPDATED",
  "SOFT_DELETED",
  "RESTORED",
  "DOWNLOAD_SIMULATED",
  "PREVIEW_SIMULATED",
] as const;
export type AttachmentEventType = (typeof ATTACHMENT_EVENT_TYPE_CODES)[number];
export const attachmentEventTypeLabels: Record<AttachmentEventType, string> = {
  CREATED: "메타데이터 등록",
  RENAMED: "표시 이름 변경",
  DESCRIPTION_UPDATED: "설명 수정",
  SOFT_DELETED: "삭제(소프트)",
  RESTORED: "복원",
  DOWNLOAD_SIMULATED: "다운로드 시뮬레이션",
  PREVIEW_SIMULATED: "미리보기 시뮬레이션",
};

export type LocalAttachmentMetadata = {
  id: string;
  repairCaseId: string;
  /** 최초 등록 시점의 파일명. 생성 후 절대 변경되지 않는다(확장자의 유일한 근거). */
  originalFileName: string;
  /** 사용자가 자유롭게 바꿀 수 있는 표시용 이름. 확장자/MIME/원본 파일명에 영향을 주지 않는다. */
  displayName: string;
  /** originalFileName에서만 파생된다(소문자, 점 없음). */
  fileExtension: string;
  mimeType: string;
  fileSizeBytes: number;
  category: AttachmentCategory;
  uploadedByUserId: string;
  uploadedByNameSnapshot: string;
  uploadedAt: string;
  previewStatus: PreviewStatus;
  malwareScanStatus: LocalMalwareScanStatus;
  /** "demo-meta-sha256:<64자 hex>" 형식. 실제 파일 내용 해시가 아니다. */
  checksum: string;
  description: string | null;
  isDeleted: boolean;
  deletedByUserId: string | null;
  deletedByNameSnapshot: string | null;
  deletedAt: string | null;
  deletionReason: string | null;
  source: "LOCAL_DEMO";
};

export type LocalAttachmentEvent = {
  id: string;
  attachmentId: string;
  repairCaseId: string;
  eventType: AttachmentEventType;
  actorUserId: string;
  actorNameSnapshot: string;
  occurredAt: string;
  /** SOFT_DELETED의 삭제 사유, DESCRIPTION_UPDATED의 새 설명 등 이벤트별 자유 코멘트. */
  comment: string | null;
  /** eventType이 RENAMED일 때만 값을 가지며, 그 외에는 항상 null이다. */
  previousDisplayName: string | null;
  newDisplayName: string | null;
  source: "LOCAL_DEMO";
};

export type LocalAttachmentEnvelope = {
  version: 1;
  records: LocalAttachmentMetadata[];
  events: LocalAttachmentEvent[];
};

export const LOCAL_ATTACHMENT_STORAGE_KEY = "dss-as-local-attachments-v1";
