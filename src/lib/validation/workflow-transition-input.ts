const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidRepairCaseId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isValidExpectedVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Reuses the exact 5 action codes from workflow-types.ts's ACTION_CODES
 * (STEP_ADVANCED/STEP_RETURNED/HOLD_STARTED/HOLD_RELEASED/
 * SHIPMENT_COMPLETED) rather than a parallel list — kept as a literal
 * tuple here (not imported) so this validation module has no dependency on
 * the local-demo domain layer, matching repair-case-update-input.ts's
 * existing convention of standalone literal lists.
 */
export const WORKFLOW_ACTION_CODES = [
  "STEP_ADVANCED",
  "STEP_RETURNED",
  "HOLD_STARTED",
  "HOLD_RELEASED",
  "SHIPMENT_COMPLETED",
] as const;
export type WorkflowActionCode = (typeof WORKFLOW_ACTION_CODES)[number];

export function isValidWorkflowActionCode(value: unknown): value is WorkflowActionCode {
  return typeof value === "string" && (WORKFLOW_ACTION_CODES as readonly string[]).includes(value);
}

const MAX_REASON_LENGTH = 2000;

export type ReasonValidationResult =
  | { ok: true; reason: string | null }
  | { ok: false; error: string };

/**
 * Pure format check only — whether a reason is *required* for a given
 * action/transition is a stateful (DB-dependent) decision made in
 * workflow-transitions.ts's mutation, not here.
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

export type TransitionActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_TRANSITION"
  | "REASON_REQUIRED"
  | "CASE_LOCKED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_STALE"
  | "BILLING_DECISION_REQUIRED"
  | "DATABASE_UNAVAILABLE";

export type TransitionActionResult =
  | { ok: true; id: string; version: number; currentWorkflowStepKey: string }
  | { ok: false; code: TransitionActionResultCode; message: string };
