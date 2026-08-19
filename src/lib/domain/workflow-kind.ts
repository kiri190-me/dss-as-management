import type {
  BillingType,
  NewIntakeWorkflowType,
  PendingBillingWorkflowType,
  WorkflowType,
} from "./types";

/**
 * "종류"(매쳐/제너레이터) — the same axis A/S intake already exposed instead
 * of a direct workflowType select (A/S INTAKE UX 체크포인트). workflowType
 * itself is unchanged/still real and persisted — this is purely the
 * kind/billing-type → workflowType derivation, shared by the intake form and
 * by repair-case detail's 종류 reassignment so the mapping rule is defined
 * exactly once.
 *
 * 2026-08-19: 유·무상이 붙지 않은 레거시 workflowType "MATCHER"(Matcher (기존
 * 이력))가 없어지면서, 매쳐도 제너레이터·Total Controller와 완전히 같은 규칙이
 * 되었다 — 종류에 유·무상을 붙여 workflowType을 만든다. 종류 축의 "MATCHER"는
 * 그대로다(그것이 곧 "매쳐"라는 종류이며, 없어진 것은 workflowType 쪽이다).
 */
export const WORKFLOW_KIND_CODES = ["MATCHER", "GENERATOR", "TOTAL_CONTROLLER"] as const;
export type WorkflowKind = (typeof WORKFLOW_KIND_CODES)[number];
// Existing detail-edit contract is intentionally unchanged in this checkpoint.
export const WORKFLOW_REASSIGNMENT_KIND_CODES = ["MATCHER", "GENERATOR"] as const;

export const workflowKindLabels: Record<WorkflowKind, string> = {
  MATCHER: "매쳐",
  GENERATOR: "제너레이터",
  TOTAL_CONTROLLER: "Total Controller (T/C)",
};

export function workflowKindOf(workflowType: WorkflowType): WorkflowKind {
  if (workflowType.endsWith("_MATCHER")) return "MATCHER";
  if (workflowType.endsWith("_TOTAL_CONTROLLER")) return "TOTAL_CONTROLLER";
  return "GENERATOR";
}

/**
 * Strict — never guesses. GENERATOR without a resolved billingType returns
 * null; callers that need a value regardless (e.g. intake's own mid-form
 * "적용 워크플로" preview, before the separate required billingType field is
 * itself validated) must explicitly choose a placeholder at the call site —
 * this function itself never silently picks PAID over WARRANTY or vice
 * versa. A caller that must NOT guess (e.g. repair-case detail's 종류
 * reassignment) can treat a null return directly as "billing_type must be
 * selected before this can proceed."
 */
export function deriveWorkflowType(
  kind: WorkflowKind,
  billingType: BillingType | null
): NewIntakeWorkflowType | PendingBillingWorkflowType | null {
  if (!billingType) return null;
  const prefix =
    billingType === "WARRANTY"
      ? "WARRANTY"
      : billingType === "PENDING_DECISION"
        ? "PENDING"
        : "PAID";
  if (kind === "MATCHER") return `${prefix}_MATCHER`;
  if (kind === "TOTAL_CONTROLLER") return `${prefix}_TOTAL_CONTROLLER`;
  return `${prefix}_GENERATOR`;
}
