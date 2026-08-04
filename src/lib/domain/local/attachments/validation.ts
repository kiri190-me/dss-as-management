import { mockRepairCases, mockUsers } from "../../mock-data";
import { isLocalId } from "../local-types";
import { isNonEmptyTrimmedString, isValidIsoDateTimeString } from "../validation";
import {
  ATTACHMENT_CATEGORY_CODES,
  ATTACHMENT_EVENT_TYPE_CODES,
  LOCAL_MALWARE_SCAN_STATUS_CODES,
  PREVIEW_STATUS_CODES,
  type AttachmentCategory,
  type AttachmentEventType,
  type LocalAttachmentEvent,
  type LocalAttachmentMetadata,
  type LocalMalwareScanStatus,
  type PreviewStatus,
} from "./attachment-types";
import { MAX_ATTACHMENT_SIZE_BYTES, isExtensionAllowedForCategory, isExtensionMimeCompatible } from "./allowlist";
import { isValidDemoChecksum } from "./checksum";
import {
  MAX_DELETION_REASON_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_FILE_NAME_LENGTH,
  deriveExtensionFromFileName,
  hasExecutableExtension,
  isSafeFileNameString,
} from "./filename";

function isOneOf<T extends string>(value: unknown, codes: readonly T[]): value is T {
  return typeof value === "string" && (codes as readonly string[]).includes(value);
}

function isKnownRepairCaseId(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (isLocalId(value)) return true;
  return mockRepairCases.some((c) => c.id === value);
}

function findUser(userId: string) {
  return mockUsers.find((u) => u.id === userId);
}

function isNullableBoundedString(value: unknown, maxLength: number): value is string | null {
  if (value === null) return true;
  return isNonEmptyTrimmedString(value) && (value as string).length <= maxLength;
}

/**
 * 첨부파일 메타데이터 레코드 검증. 관계/보안에 민감한 값(첨부 대상 접수 건,
 * 업로더/삭제자 자격, 확장자-MIME 궁합, 확장자-카테고리 궁합)이 어긋나면
 * 다른 값으로 보정하지 않고 레코드 전체를 버린다. fileExtension은 항상
 * originalFileName에서 다시 파생해 저장된 값과 일치하는지 검증한다
 * (확장자 불변성 — 저장된 값을 그대로 신뢰하지 않는다).
 */
export function validateAttachmentRecord(raw: unknown): LocalAttachmentMetadata | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  if (!isNonEmptyTrimmedString(r.id)) return null;
  if (!(r.id.startsWith("attachment-") || r.id.startsWith("seed-att-"))) return null;
  if (!isKnownRepairCaseId(r.repairCaseId)) return null;

  if (!isSafeFileNameString(r.originalFileName, MAX_FILE_NAME_LENGTH)) return null;
  const extension = deriveExtensionFromFileName(r.originalFileName as string);
  if (!extension) return null;
  if (hasExecutableExtension(extension)) return null;
  if (r.fileExtension !== extension) return null;

  if (!isSafeFileNameString(r.displayName, MAX_DISPLAY_NAME_LENGTH)) return null;

  if (!isOneOf<AttachmentCategory>(r.category, ATTACHMENT_CATEGORY_CODES)) return null;
  if (!isExtensionAllowedForCategory(extension, r.category as AttachmentCategory)) return null;

  if (typeof r.mimeType !== "string" || r.mimeType.length === 0) return null;
  if (!isExtensionMimeCompatible(extension, r.mimeType)) return null;

  if (
    typeof r.fileSizeBytes !== "number" ||
    !Number.isInteger(r.fileSizeBytes) ||
    r.fileSizeBytes <= 0 ||
    r.fileSizeBytes > MAX_ATTACHMENT_SIZE_BYTES
  ) {
    return null;
  }

  if (!isNonEmptyTrimmedString(r.uploadedByUserId) || !findUser(r.uploadedByUserId)) return null;
  if (!isNonEmptyTrimmedString(r.uploadedByNameSnapshot)) return null;
  if (!isValidIsoDateTimeString(r.uploadedAt)) return null;

  if (!isOneOf<PreviewStatus>(r.previewStatus, PREVIEW_STATUS_CODES)) return null;
  if (!isOneOf<LocalMalwareScanStatus>(r.malwareScanStatus, LOCAL_MALWARE_SCAN_STATUS_CODES)) return null;

  if (!isValidDemoChecksum(r.checksum)) return null;

  if (!isNullableBoundedString(r.description, MAX_DESCRIPTION_LENGTH)) return null;

  if (typeof r.isDeleted !== "boolean") return null;
  if (r.isDeleted) {
    if (!isNonEmptyTrimmedString(r.deletedByUserId) || !findUser(r.deletedByUserId)) return null;
    if (!isNonEmptyTrimmedString(r.deletedByNameSnapshot)) return null;
    if (!isValidIsoDateTimeString(r.deletedAt)) return null;
    if (
      !isNonEmptyTrimmedString(r.deletionReason) ||
      (r.deletionReason as string).length > MAX_DELETION_REASON_LENGTH
    ) {
      return null;
    }
  } else if (
    r.deletedByUserId !== null ||
    r.deletedByNameSnapshot !== null ||
    r.deletedAt !== null ||
    r.deletionReason !== null
  ) {
    return null;
  }

  if (r.source !== "LOCAL_DEMO") return null;

  return {
    id: r.id,
    repairCaseId: r.repairCaseId as string,
    originalFileName: r.originalFileName as string,
    displayName: r.displayName as string,
    fileExtension: extension,
    mimeType: r.mimeType,
    fileSizeBytes: r.fileSizeBytes,
    category: r.category as AttachmentCategory,
    uploadedByUserId: r.uploadedByUserId,
    uploadedByNameSnapshot: r.uploadedByNameSnapshot as string,
    uploadedAt: r.uploadedAt as string,
    previewStatus: r.previewStatus as PreviewStatus,
    malwareScanStatus: r.malwareScanStatus as LocalMalwareScanStatus,
    checksum: r.checksum as string,
    description: (r.description as string | null) ?? null,
    isDeleted: r.isDeleted,
    deletedByUserId: (r.deletedByUserId as string | null) ?? null,
    deletedByNameSnapshot: (r.deletedByNameSnapshot as string | null) ?? null,
    deletedAt: (r.deletedAt as string | null) ?? null,
    deletionReason: (r.deletionReason as string | null) ?? null,
    source: "LOCAL_DEMO",
  };
}

/** id 중복을 제거한다(먼저 등장한 레코드를 유지). */
export function dedupeAttachmentRecords(records: LocalAttachmentMetadata[]): LocalAttachmentMetadata[] {
  const seen = new Set<string>();
  const result: LocalAttachmentMetadata[] = [];
  for (const record of records) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    result.push(record);
  }
  return result;
}

/**
 * 이벤트는 반드시 검증을 통과한 현재 레코드 목록을 기준으로만 검증한다 —
 * 참조하는 레코드가 없거나 repairCaseId가 레코드와 다르면 고아 이벤트로
 * 간주해 버린다(화면에 표시하지 않는다). RENAMED만 previousDisplayName/
 * newDisplayName을 요구하고, 그 외 이벤트 타입은 두 필드 모두 null이어야 한다.
 */
export function validateAttachmentEvent(
  raw: unknown,
  ctx: { recordsById: ReadonlyMap<string, LocalAttachmentMetadata> }
): LocalAttachmentEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  if (!isNonEmptyTrimmedString(r.id)) return null;
  if (!(r.id.startsWith("attachment-event-") || r.id.startsWith("seed-att-"))) return null;

  if (!isNonEmptyTrimmedString(r.attachmentId)) return null;
  const record = ctx.recordsById.get(r.attachmentId);
  if (!record) return null;
  if (r.repairCaseId !== record.repairCaseId) return null;

  if (!isOneOf<AttachmentEventType>(r.eventType, ATTACHMENT_EVENT_TYPE_CODES)) return null;

  if (!isNonEmptyTrimmedString(r.actorUserId) || !findUser(r.actorUserId)) return null;
  if (!isNonEmptyTrimmedString(r.actorNameSnapshot)) return null;
  if (!isValidIsoDateTimeString(r.occurredAt)) return null;

  if (!isNullableBoundedString(r.comment, MAX_DESCRIPTION_LENGTH)) return null;

  if (r.eventType === "RENAMED") {
    if (!isNonEmptyTrimmedString(r.previousDisplayName)) return null;
    if (!isNonEmptyTrimmedString(r.newDisplayName)) return null;
  } else if (r.previousDisplayName !== null || r.newDisplayName !== null) {
    return null;
  }

  if (r.source !== "LOCAL_DEMO") return null;

  return {
    id: r.id,
    attachmentId: r.attachmentId,
    repairCaseId: record.repairCaseId,
    eventType: r.eventType as AttachmentEventType,
    actorUserId: r.actorUserId,
    actorNameSnapshot: r.actorNameSnapshot as string,
    occurredAt: r.occurredAt as string,
    comment: (r.comment as string | null) ?? null,
    previousDisplayName: (r.previousDisplayName as string | null) ?? null,
    newDisplayName: (r.newDisplayName as string | null) ?? null,
    source: "LOCAL_DEMO",
  };
}

export function dedupeAttachmentEvents(events: LocalAttachmentEvent[]): LocalAttachmentEvent[] {
  const seen = new Set<string>();
  const result: LocalAttachmentEvent[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    result.push(event);
  }
  return result;
}
