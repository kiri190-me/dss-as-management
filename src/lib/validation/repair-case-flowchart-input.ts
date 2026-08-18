const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Own standalone copy of the UUID format check, matching this codebase's
 * existing convention (repair-case-work-record-input.ts, workflow-
 * transition-input.ts each keep their own copy rather than cross-importing
 * between validation modules).
 */
export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isValidRepairCaseId(value: unknown): value is string {
  return isValidUuid(value);
}

export function isValidFlowchartId(value: unknown): value is string {
  return isValidUuid(value);
}

/** Same convention as repair-case-input.ts's private MAX_LONG_TEXT — own local copy, not cross-imported. */
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 4000;

export type FlowchartTitleValidationResult = { ok: true; title: string } | { ok: false; error: string };

/** Required, non-blank after trim, capped — never silently truncated. */
export function validateFlowchartTitle(value: unknown): FlowchartTitleValidationResult {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, error: "Flowchart 제목을 입력해 주세요." };
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_TITLE_LENGTH) {
    return { ok: false, error: `Flowchart 제목은 ${MAX_TITLE_LENGTH}자를 초과할 수 없습니다.` };
  }
  return { ok: true, title: trimmed };
}

export type FlowchartDescriptionValidationResult = { ok: true; description: string | null } | { ok: false; error: string };

/** Optional — null/undefined/blank-after-trim all normalize to null, matching this codebase's established "not yet entered stays distinguishable from entered as empty" convention. */
export function validateFlowchartDescription(value: unknown): FlowchartDescriptionValidationResult {
  if (value === null || value === undefined) return { ok: true, description: null };
  if (typeof value !== "string") return { ok: false, error: "Flowchart 설명 형식이 올바르지 않습니다." };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, description: null };
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
    return { ok: false, error: `Flowchart 설명은 ${MAX_DESCRIPTION_LENGTH}자를 초과할 수 없습니다.` };
  }
  return { ok: true, description: trimmed };
}

export type FlowchartDeleteReasonValidationResult = { ok: true; reason: string | null } | { ok: false; error: string };

/** Optional per the 5C-6B plan (unlike work-record invalidation, which is mandatory) — same null-normalizing convention as description. */
export function validateFlowchartDeleteReason(value: unknown): FlowchartDeleteReasonValidationResult {
  if (value === null || value === undefined) return { ok: true, reason: null };
  if (typeof value !== "string") return { ok: false, error: "삭제 사유 형식이 올바르지 않습니다." };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, reason: null };
  const MAX_REASON_LENGTH = 2000;
  if (trimmed.length > MAX_REASON_LENGTH) {
    return { ok: false, error: `삭제 사유는 ${MAX_REASON_LENGTH}자를 초과할 수 없습니다.` };
  }
  return { ok: true, reason: trimmed };
}

export type PermanentDeleteReasonValidationResult = { ok: true; reason: string } | { ok: false; error: string };

/** Mandatory — unlike validateFlowchartDeleteReason (soft-delete's reason stays optional): permanent deletion is irreversible, so a reason is always required, never null-normalized. */
export function validatePermanentDeleteReason(value: unknown): PermanentDeleteReasonValidationResult {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, error: "영구 삭제 사유를 입력해 주세요." };
  }
  const trimmed = value.trim();
  const MAX_REASON_LENGTH = 2000;
  if (trimmed.length > MAX_REASON_LENGTH) {
    return { ok: false, error: `영구 삭제 사유는 ${MAX_REASON_LENGTH}자를 초과할 수 없습니다.` };
  }
  return { ok: true, reason: trimmed };
}

export function isValidExpectedUpdatedAt(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

export type CreateRepairCaseFlowchartActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CASE_LOCKED"
  | "INVALID_INPUT"
  | "BILLING_DECISION_REQUIRED"
  | "DATABASE_UNAVAILABLE";

export type CreateRepairCaseFlowchartActionResult =
  | { ok: true; id: string; createdAt: string; updatedAt: string }
  | { ok: false; code: CreateRepairCaseFlowchartActionResultCode; message: string };

export type UpdateRepairCaseFlowchartMetadataActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CASE_LOCKED"
  | "INVALID_INPUT"
  | "STALE_REVISION"
  | "BILLING_DECISION_REQUIRED"
  | "DATABASE_UNAVAILABLE";

export type UpdateRepairCaseFlowchartMetadataActionResult =
  | { ok: true; id: string; updatedAt: string; changed: boolean }
  | { ok: false; code: UpdateRepairCaseFlowchartMetadataActionResultCode; message: string };

export type SoftDeleteRepairCaseFlowchartActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CASE_LOCKED"
  | "STALE_REVISION"
  | "DATABASE_UNAVAILABLE";

export type SoftDeleteRepairCaseFlowchartActionResult =
  | { ok: true; id: string; deletedAt: string }
  | { ok: false; code: SoftDeleteRepairCaseFlowchartActionResultCode; message: string };

export type RestoreRepairCaseFlowchartActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CASE_LOCKED"
  | "STALE_REVISION"
  | "DATABASE_UNAVAILABLE";

export type RestoreRepairCaseFlowchartActionResult =
  | { ok: true; id: string; updatedAt: string }
  | { ok: false; code: RestoreRepairCaseFlowchartActionResultCode; message: string };

export type PermanentlyDeleteRepairCaseFlowchartActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "STALE_REVISION"
  | "DATABASE_UNAVAILABLE";

export type PermanentlyDeleteRepairCaseFlowchartActionResult =
  | { ok: true; id: string }
  | { ok: false; code: PermanentlyDeleteRepairCaseFlowchartActionResultCode; message: string };
