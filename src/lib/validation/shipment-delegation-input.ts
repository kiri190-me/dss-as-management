const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUserId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

const MAX_REASON_LENGTH = 2000;

export type ReasonValidationResult =
  | { ok: true; reason: string | null }
  | { ok: false; error: string };

/**
 * Pure format check only — same shape/limit as every other
 * validateReasonFormat in this codebase (workflow-transition-input.ts,
 * repair-case-approval-input.ts). Kept as its own standalone copy rather
 * than a shared import, matching those modules' existing convention of
 * each validation module staying dependency-free of the others.
 */
export function validateReasonFormat(value: unknown): ReasonValidationResult {
  if (value === null || value === undefined || value === "") {
    return { ok: true, reason: null };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "사유 값을 확인할 수 없습니다." };
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_REASON_LENGTH) {
    return { ok: false, error: "사유 내용이 너무 깁니다." };
  }
  return { ok: true, reason: trimmed === "" ? null : trimmed };
}

export type DateRangeValidationResult =
  | { ok: true; startsAt: Date; endsAt: Date }
  | { ok: false; error: string };

/**
 * Format + basic sanity check only (parses, both required, ends after
 * starts). Whether the range overlaps an existing delegation, or whether
 * the representative/delegate are currently eligible, are stateful (DB-
 * dependent) checks made in the mutation layer, not here.
 */
export function validateDelegationDateRange(
  startsAtInput: unknown,
  endsAtInput: unknown
): DateRangeValidationResult {
  if (typeof startsAtInput !== "string" || typeof endsAtInput !== "string") {
    return { ok: false, error: "시작/종료 일시를 확인할 수 없습니다." };
  }
  const startsAt = new Date(startsAtInput);
  const endsAt = new Date(endsAtInput);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return { ok: false, error: "시작/종료 일시 형식이 올바르지 않습니다." };
  }
  if (endsAt.getTime() <= startsAt.getTime()) {
    return { ok: false, error: "종료 일시는 시작 일시보다 이후여야 합니다." };
  }
  return { ok: true, startsAt, endsAt };
}

export type ShipmentManagementResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DATABASE_UNAVAILABLE"
  | "INVALID_USER"
  | "INVALID_TIME_RANGE"
  | "OVERLAPPING_DELEGATION"
  | "LAST_REPRESENTATIVE"
  | "DELEGATION_EXPIRED"
  | "DELEGATION_REVOKED";

export type ShipmentManagementResult =
  | { ok: true; id: string }
  | { ok: false; code: ShipmentManagementResultCode; message: string };
