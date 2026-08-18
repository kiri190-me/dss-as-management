const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidRepairCaseId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * Standalone literal tuple (not imported from the local-demo domain layer),
 * matching workflow-transition-input.ts's existing convention of keeping
 * this validation module free of a domain-layer dependency. Values are
 * identical to approval-types.ts's APPROVAL_TYPE_CODES — no new approval
 * types invented.
 */
export const REPAIR_CASE_APPROVAL_TYPES = ["REPAIR_INSPECTION", "FINAL_SHIPMENT"] as const;
export type RepairCaseApprovalType = (typeof REPAIR_CASE_APPROVAL_TYPES)[number];

export function isValidApprovalType(value: unknown): value is RepairCaseApprovalType {
  return typeof value === "string" && (REPAIR_CASE_APPROVAL_TYPES as readonly string[]).includes(value);
}

export const APPROVAL_DECISION_CODES = ["APPROVED", "REJECTED"] as const;
export type ApprovalDecisionCode = (typeof APPROVAL_DECISION_CODES)[number];

export function isValidApprovalDecision(value: unknown): value is ApprovalDecisionCode {
  return typeof value === "string" && (APPROVAL_DECISION_CODES as readonly string[]).includes(value);
}

const MAX_REASON_LENGTH = 2000;

export type ReasonValidationResult =
  | { ok: true; reason: string | null }
  | { ok: false; error: string };

/**
 * Pure format check only — identical shape to workflow-transition-input.ts's
 * validateReasonFormat. Whether a reason is *required* (e.g. REJECTED
 * always requires one, matching the local-demo layer's
 * COMMENT_REQUIRED rule) is a stateful decision made in the mutation layer,
 * not here.
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

export type ApprovalActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "ALREADY_REQUESTED"
  | "CASE_LOCKED"
  | "BILLING_DECISION_REQUIRED"
  | "INVALID_APPROVAL_TYPE"
  | "DATABASE_UNAVAILABLE";

export type ApprovalActionResult =
  | { ok: true; id: string }
  | { ok: false; code: ApprovalActionResultCode; message: string };
