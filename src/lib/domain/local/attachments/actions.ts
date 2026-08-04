import type { ActingUser } from "../approval/transitions";
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  isAllowedExtension,
  isExtensionAllowedForCategory,
  isExtensionMimeCompatible,
  isPreviewCapableExtension,
} from "./allowlist";
import { getAttachmentStoreSnapshot, writeAttachmentEnvelope } from "./attachment-storage";
import type { AttachmentCategory, LocalAttachmentEvent, LocalAttachmentMetadata } from "./attachment-types";
import { computeDemoChecksum } from "./checksum";
import {
  MAX_DELETION_REASON_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_FILE_NAME_LENGTH,
  deriveExtensionFromFileName,
  hasExecutableExtension,
  isSafeFileNameString,
} from "./filename";
import { validateAttachmentEvent, validateAttachmentRecord } from "./validation";

function generateAttachmentId(): string {
  return `attachment-${crypto.randomUUID()}`;
}
function generateAttachmentEventId(): string {
  return `attachment-event-${crypto.randomUUID()}`;
}

export type AttachmentActionErrorReason =
  | "NOT_FOUND"
  | "ALREADY_DELETED"
  | "NOT_DELETED"
  | "VALIDATION_FAILED"
  | "STORAGE_CONFLICT";

export const attachmentActionErrorMessages: Record<AttachmentActionErrorReason, string> = {
  NOT_FOUND: "대상 첨부파일 메타데이터를 찾을 수 없습니다.",
  ALREADY_DELETED: "이미 삭제된 항목입니다. 복원 후 다시 시도해 주세요.",
  NOT_DELETED: "삭제되지 않은 항목은 복원할 수 없습니다.",
  VALIDATION_FAILED: "입력값을 확인해 주세요.",
  STORAGE_CONFLICT: "저장 중 충돌이 발생했습니다. 다시 시도해 주세요.",
};

export type AttachmentActionResult =
  | { ok: true; record: LocalAttachmentMetadata }
  | { ok: false; reason: AttachmentActionErrorReason; message?: string };

function findRecord(
  records: readonly LocalAttachmentMetadata[],
  attachmentId: string,
  repairCaseId: string
): LocalAttachmentMetadata | null {
  return records.find((r) => r.id === attachmentId && r.repairCaseId === repairCaseId) ?? null;
}

/**
 * 모든 액션이 거치는 단일 커밋 경로다. 방금 만든 레코드/이벤트가 저장소
 * 검증 규칙 자체를 통과하는지 다시 확인한 뒤(단일 소스 유지), 전체 레코드/
 * 이벤트 배열을 한 번의 setItem으로 함께 쓴다. 버튼이 비활성화되어 있었는지
 * 여부에 의존하지 않고 매번 최신 저장소를 다시 읽고 재검증한다.
 */
function commit(
  currentRecords: readonly LocalAttachmentMetadata[],
  currentEvents: readonly LocalAttachmentEvent[],
  nextRecord: LocalAttachmentMetadata,
  nextEvent: LocalAttachmentEvent
): AttachmentActionResult {
  if (!validateAttachmentRecord(nextRecord)) {
    return { ok: false, reason: "STORAGE_CONFLICT" };
  }
  const nextRecords = [...currentRecords.filter((r) => r.id !== nextRecord.id), nextRecord];
  const recordsById = new Map(nextRecords.map((r) => [r.id, r]));
  if (!validateAttachmentEvent(nextEvent, { recordsById })) {
    return { ok: false, reason: "STORAGE_CONFLICT" };
  }
  const nextEvents = [...currentEvents, nextEvent];
  writeAttachmentEnvelope(nextRecords, nextEvents);
  return { ok: true, record: nextRecord };
}

export type AddAttachmentInput = {
  repairCaseId: string;
  originalFileName: string;
  displayName: string;
  fileSizeBytes: number;
  category: AttachmentCategory;
  mimeType: string;
  description: string | null;
  actingUser: ActingUser;
};

/**
 * 새로 등록되는 레코드는 항상 malwareScanStatus = NOT_SCANNED다(실제 검사가
 * 일어나지 않았으므로 CLEAN으로 시작하지 않는다). previewStatus는 확장자가
 * 미리보기 가능(jpg/jpeg/png/pdf/txt/csv) 목록에 있으면 PENDING, 그 외에는
 * NOT_AVAILABLE이다. 체크섬은 Web Crypto SHA-256을 실제로 계산한다(비동기).
 */
export async function addAttachment(input: AddAttachmentInput): Promise<AttachmentActionResult> {
  const originalFileName = input.originalFileName.trim();
  const displayName = input.displayName.trim();
  const description = input.description?.trim() || null;

  if (!isSafeFileNameString(originalFileName, MAX_FILE_NAME_LENGTH)) {
    return { ok: false, reason: "VALIDATION_FAILED", message: "원본 파일명이 올바르지 않습니다." };
  }
  const extension = deriveExtensionFromFileName(originalFileName);
  if (!extension || hasExecutableExtension(extension) || !isAllowedExtension(extension)) {
    return { ok: false, reason: "VALIDATION_FAILED", message: "허용되지 않는 파일 확장자입니다." };
  }
  if (!isExtensionAllowedForCategory(extension, input.category)) {
    return { ok: false, reason: "VALIDATION_FAILED", message: "선택한 분류에는 이 확장자를 사용할 수 없습니다." };
  }
  if (!isExtensionMimeCompatible(extension, input.mimeType)) {
    return { ok: false, reason: "VALIDATION_FAILED", message: "확장자와 MIME 유형 조합이 허용되지 않습니다." };
  }
  if (!isSafeFileNameString(displayName, MAX_DISPLAY_NAME_LENGTH)) {
    return { ok: false, reason: "VALIDATION_FAILED", message: "표시 이름이 올바르지 않습니다." };
  }
  if (
    !Number.isInteger(input.fileSizeBytes) ||
    input.fileSizeBytes <= 0 ||
    input.fileSizeBytes > MAX_ATTACHMENT_SIZE_BYTES
  ) {
    return { ok: false, reason: "VALIDATION_FAILED", message: "파일 크기는 0바이트보다 크고 300MB 이하여야 합니다." };
  }
  if (description !== null && description.length > MAX_DESCRIPTION_LENGTH) {
    return { ok: false, reason: "VALIDATION_FAILED", message: "설명이 너무 깁니다." };
  }

  const { records, events } = getAttachmentStoreSnapshot();

  const id = generateAttachmentId();
  const nowIso = new Date().toISOString();
  const previewStatus = isPreviewCapableExtension(extension) ? "PENDING" : "NOT_AVAILABLE";
  const checksum = await computeDemoChecksum({
    id,
    originalFileName,
    fileSizeBytes: input.fileSizeBytes,
    category: input.category,
    uploadedAt: nowIso,
  });

  const record: LocalAttachmentMetadata = {
    id,
    repairCaseId: input.repairCaseId,
    originalFileName,
    displayName,
    fileExtension: extension,
    mimeType: input.mimeType,
    fileSizeBytes: input.fileSizeBytes,
    category: input.category,
    uploadedByUserId: input.actingUser.id,
    uploadedByNameSnapshot: input.actingUser.name,
    uploadedAt: nowIso,
    previewStatus,
    malwareScanStatus: "NOT_SCANNED",
    checksum,
    description,
    isDeleted: false,
    deletedByUserId: null,
    deletedByNameSnapshot: null,
    deletedAt: null,
    deletionReason: null,
    source: "LOCAL_DEMO",
  };

  const event: LocalAttachmentEvent = {
    id: generateAttachmentEventId(),
    attachmentId: id,
    repairCaseId: input.repairCaseId,
    eventType: "CREATED",
    actorUserId: input.actingUser.id,
    actorNameSnapshot: input.actingUser.name,
    occurredAt: nowIso,
    comment: null,
    previousDisplayName: null,
    newDisplayName: null,
    source: "LOCAL_DEMO",
  };

  return commit(records, events, record, event);
}

export type RenameAttachmentInput = {
  attachmentId: string;
  repairCaseId: string;
  newDisplayName: string;
  actingUser: ActingUser;
};

/** originalFileName/fileExtension/mimeType은 절대 건드리지 않는다 — displayName만 바뀐다. */
export function renameAttachment(input: RenameAttachmentInput): AttachmentActionResult {
  const { records, events } = getAttachmentStoreSnapshot();
  const existing = findRecord(records, input.attachmentId, input.repairCaseId);
  if (!existing) return { ok: false, reason: "NOT_FOUND" };
  if (existing.isDeleted) return { ok: false, reason: "ALREADY_DELETED" };

  const newDisplayName = input.newDisplayName.trim();
  if (!isSafeFileNameString(newDisplayName, MAX_DISPLAY_NAME_LENGTH)) {
    return { ok: false, reason: "VALIDATION_FAILED", message: "표시 이름이 올바르지 않습니다." };
  }
  if (newDisplayName === existing.displayName) {
    return { ok: false, reason: "VALIDATION_FAILED", message: "변경된 내용이 없습니다." };
  }

  const nowIso = new Date().toISOString();
  const record: LocalAttachmentMetadata = { ...existing, displayName: newDisplayName };
  const event: LocalAttachmentEvent = {
    id: generateAttachmentEventId(),
    attachmentId: existing.id,
    repairCaseId: existing.repairCaseId,
    eventType: "RENAMED",
    actorUserId: input.actingUser.id,
    actorNameSnapshot: input.actingUser.name,
    occurredAt: nowIso,
    comment: null,
    previousDisplayName: existing.displayName,
    newDisplayName,
    source: "LOCAL_DEMO",
  };

  return commit(records, events, record, event);
}

export type UpdateDescriptionInput = {
  attachmentId: string;
  repairCaseId: string;
  description: string | null;
  actingUser: ActingUser;
};

export function updateDescription(input: UpdateDescriptionInput): AttachmentActionResult {
  const { records, events } = getAttachmentStoreSnapshot();
  const existing = findRecord(records, input.attachmentId, input.repairCaseId);
  if (!existing) return { ok: false, reason: "NOT_FOUND" };
  if (existing.isDeleted) return { ok: false, reason: "ALREADY_DELETED" };

  const description = input.description?.trim() || null;
  if (description !== null && description.length > MAX_DESCRIPTION_LENGTH) {
    return { ok: false, reason: "VALIDATION_FAILED", message: "설명이 너무 깁니다." };
  }
  if (description === existing.description) {
    return { ok: false, reason: "VALIDATION_FAILED", message: "변경된 내용이 없습니다." };
  }

  const nowIso = new Date().toISOString();
  const record: LocalAttachmentMetadata = { ...existing, description };
  const event: LocalAttachmentEvent = {
    id: generateAttachmentEventId(),
    attachmentId: existing.id,
    repairCaseId: existing.repairCaseId,
    eventType: "DESCRIPTION_UPDATED",
    actorUserId: input.actingUser.id,
    actorNameSnapshot: input.actingUser.name,
    occurredAt: nowIso,
    comment: description ?? "설명이 삭제되었습니다.",
    previousDisplayName: null,
    newDisplayName: null,
    source: "LOCAL_DEMO",
  };

  return commit(records, events, record, event);
}

export type AttachmentTargetInput = {
  attachmentId: string;
  repairCaseId: string;
  actingUser: ActingUser;
};

/** previewStatus는 변경하지 않는다 — 실제 미리보기 생성 작업이 일어난 것이 아니다. */
export function simulatePreview(input: AttachmentTargetInput): AttachmentActionResult {
  const { records, events } = getAttachmentStoreSnapshot();
  const existing = findRecord(records, input.attachmentId, input.repairCaseId);
  if (!existing) return { ok: false, reason: "NOT_FOUND" };
  if (existing.isDeleted) return { ok: false, reason: "ALREADY_DELETED" };

  const nowIso = new Date().toISOString();
  const event: LocalAttachmentEvent = {
    id: generateAttachmentEventId(),
    attachmentId: existing.id,
    repairCaseId: existing.repairCaseId,
    eventType: "PREVIEW_SIMULATED",
    actorUserId: input.actingUser.id,
    actorNameSnapshot: input.actingUser.name,
    occurredAt: nowIso,
    comment: "실제 미리보기 생성 작업은 실행되지 않았습니다(데모).",
    previousDisplayName: null,
    newDisplayName: null,
    source: "LOCAL_DEMO",
  };

  return commit(records, events, existing, event);
}

/** 실제 파일을 만들거나 다운로드하지 않는다 — 이벤트만 기록한다. */
export function simulateDownload(input: AttachmentTargetInput): AttachmentActionResult {
  const { records, events } = getAttachmentStoreSnapshot();
  const existing = findRecord(records, input.attachmentId, input.repairCaseId);
  if (!existing) return { ok: false, reason: "NOT_FOUND" };
  if (existing.isDeleted) return { ok: false, reason: "ALREADY_DELETED" };

  const nowIso = new Date().toISOString();
  const event: LocalAttachmentEvent = {
    id: generateAttachmentEventId(),
    attachmentId: existing.id,
    repairCaseId: existing.repairCaseId,
    eventType: "DOWNLOAD_SIMULATED",
    actorUserId: input.actingUser.id,
    actorNameSnapshot: input.actingUser.name,
    occurredAt: nowIso,
    comment: "실제 파일 다운로드는 발생하지 않았습니다(데모).",
    previousDisplayName: null,
    newDisplayName: null,
    source: "LOCAL_DEMO",
  };

  return commit(records, events, existing, event);
}

export type SoftDeleteAttachmentInput = {
  attachmentId: string;
  repairCaseId: string;
  reason: string;
  actingUser: ActingUser;
};

export function softDeleteAttachment(input: SoftDeleteAttachmentInput): AttachmentActionResult {
  const { records, events } = getAttachmentStoreSnapshot();
  const existing = findRecord(records, input.attachmentId, input.repairCaseId);
  if (!existing) return { ok: false, reason: "NOT_FOUND" };
  if (existing.isDeleted) return { ok: false, reason: "ALREADY_DELETED" };

  const reason = input.reason.trim();
  if (reason.length === 0 || reason.length > MAX_DELETION_REASON_LENGTH) {
    return { ok: false, reason: "VALIDATION_FAILED", message: "삭제 사유를 입력해 주세요." };
  }

  const nowIso = new Date().toISOString();
  const record: LocalAttachmentMetadata = {
    ...existing,
    isDeleted: true,
    deletedByUserId: input.actingUser.id,
    deletedByNameSnapshot: input.actingUser.name,
    deletedAt: nowIso,
    deletionReason: reason,
  };
  const event: LocalAttachmentEvent = {
    id: generateAttachmentEventId(),
    attachmentId: existing.id,
    repairCaseId: existing.repairCaseId,
    eventType: "SOFT_DELETED",
    actorUserId: input.actingUser.id,
    actorNameSnapshot: input.actingUser.name,
    occurredAt: nowIso,
    comment: reason,
    previousDisplayName: null,
    newDisplayName: null,
    source: "LOCAL_DEMO",
  };

  return commit(records, events, record, event);
}

export type RestoreAttachmentInput = AttachmentTargetInput;

/** 소프트 삭제 필드만 초기화한다 — 과거 SOFT_DELETED 이벤트 자체는 그대로 남는다. */
export function restoreAttachment(input: RestoreAttachmentInput): AttachmentActionResult {
  const { records, events } = getAttachmentStoreSnapshot();
  const existing = findRecord(records, input.attachmentId, input.repairCaseId);
  if (!existing) return { ok: false, reason: "NOT_FOUND" };
  if (!existing.isDeleted) return { ok: false, reason: "NOT_DELETED" };

  const nowIso = new Date().toISOString();
  const record: LocalAttachmentMetadata = {
    ...existing,
    isDeleted: false,
    deletedByUserId: null,
    deletedByNameSnapshot: null,
    deletedAt: null,
    deletionReason: null,
  };
  const event: LocalAttachmentEvent = {
    id: generateAttachmentEventId(),
    attachmentId: existing.id,
    repairCaseId: existing.repairCaseId,
    eventType: "RESTORED",
    actorUserId: input.actingUser.id,
    actorNameSnapshot: input.actingUser.name,
    occurredAt: nowIso,
    comment: null,
    previousDisplayName: null,
    newDisplayName: null,
    source: "LOCAL_DEMO",
  };

  return commit(records, events, record, event);
}
