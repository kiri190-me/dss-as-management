const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Own standalone copy of the UUID format check, matching this codebase's
 * existing convention (workflow-transition-input.ts, procedure-validation-
 * resolution-input.ts each keep their own copy rather than cross-importing
 * between validation modules).
 */
export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isValidRepairCaseId(value: unknown): value is string {
  return isValidUuid(value);
}

/** null/undefined/"" are all valid "not supplied" — anything else must be a well-formed UUID. */
export function isValidOptionalUuid(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || isValidUuid(value);
}

/**
 * Same value as repair-case-input.ts/repair-case-update-input.ts's private
 * MAX_LONG_TEXT (4000) — kept as its own local constant rather than
 * imported, matching this codebase's established convention of each
 * validation module owning its own copy of shared limits (those two
 * modules don't even export MAX_LONG_TEXT, and cross-importing a repair-
 * case-domain constant into this work-record module would be an
 * inappropriate cross-domain dependency for a value that's really just
 * "the standard long-free-text limit").
 */
const MAX_MEMO_LENGTH = 4000;

export type MemoValidationResult = { ok: true; memo: string } | { ok: false; error: string };

/** Required, non-blank, trimmed, capped — never silently truncated. */
export function validateWorkRecordMemo(value: unknown): MemoValidationResult {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, error: "작업 기록 내용을 입력해 주세요." };
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_MEMO_LENGTH) {
    return { ok: false, error: `작업 기록 내용은 ${MAX_MEMO_LENGTH}자를 초과할 수 없습니다.` };
  }
  return { ok: true, memo: trimmed };
}

/**
 * Same value as workflow-transition-input.ts/repair-case-approval-input.ts/
 * shipment-delegation-input.ts's private MAX_REASON_LENGTH (2000) — own
 * local copy, same reasoning as MAX_MEMO_LENGTH above.
 */
const MAX_INVALIDATION_REASON_LENGTH = 2000;

export type InvalidationReasonValidationResult = { ok: true; reason: string } | { ok: false; error: string };

/**
 * Unlike workflow-transition-input.ts's validateReasonFormat (reason is
 * optional there, required only for some transitions), an invalidation
 * reason is unconditionally mandatory — this validator has no "not
 * supplied is fine" branch.
 */
export function validateInvalidationReason(value: unknown): InvalidationReasonValidationResult {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, error: "무효 처리 사유를 입력해 주세요." };
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_INVALIDATION_REASON_LENGTH) {
    return { ok: false, error: `무효 처리 사유는 ${MAX_INVALIDATION_REASON_LENGTH}자를 초과할 수 없습니다.` };
  }
  return { ok: true, reason: trimmed };
}

export type CreateWorkRecordActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CASE_LOCKED"
  | "INVALID_INPUT"
  | "IDEMPOTENCY_CONFLICT"
  | "DATABASE_UNAVAILABLE";

export type CreateWorkRecordActionResult =
  | { ok: true; id: string; createdAt: string; replayed: boolean }
  | { ok: false; code: CreateWorkRecordActionResultCode; message: string };

export type InvalidateWorkRecordActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CASE_LOCKED"
  | "ALREADY_INVALIDATED"
  | "DATABASE_UNAVAILABLE";

export type InvalidateWorkRecordActionResult =
  | { ok: true; id: string; invalidatedAt: string }
  | { ok: false; code: InvalidateWorkRecordActionResultCode; message: string };
