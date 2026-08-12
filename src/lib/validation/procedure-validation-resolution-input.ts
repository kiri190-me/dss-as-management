const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

const MAX_NOTE_LENGTH = 2000;

export function validateRequiredNote(value: unknown): { ok: true; note: string } | { ok: false; error: string } {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, error: "해결 메모는 필수입니다." };
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_NOTE_LENGTH) {
    return { ok: false, error: `해결 메모는 ${MAX_NOTE_LENGTH}자를 초과할 수 없습니다.` };
  }
  return { ok: true, note: trimmed };
}

/**
 * Phase 5C-5B usability — TECHNICAL_TASK authoring's own reason fields
 * (delete node/edge, node-type change, retarget, create edge) are optional,
 * unlike every other reason field in this codebase (all still mandatory via
 * validateRequiredNote above, untouched). Same absent/null/empty-normalizes-
 * to-null convention as validateReasonFormat elsewhere in this codebase
 * (workflow-transition-input.ts etc.) — still enforces the max-length cap
 * when a reason IS supplied.
 */
export function validateOptionalNote(value: unknown): { ok: true; note: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === "") {
    return { ok: true, note: null };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "사유 값을 확인할 수 없습니다." };
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_NOTE_LENGTH) {
    return { ok: false, error: `사유는 ${MAX_NOTE_LENGTH}자를 초과할 수 없습니다.` };
  }
  return { ok: true, note: trimmed === "" ? null : trimmed };
}
