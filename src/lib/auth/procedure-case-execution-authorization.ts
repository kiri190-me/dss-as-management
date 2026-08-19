import type { Role } from "@/lib/domain/types";

/**
 * Centralized, server-side authorization for repair-case procedure
 * execution (Phase 5A). Same convention as repair-case-edit-authorization.ts
 * and procedure-template-authorization.ts: pure functions of `Role` (plus,
 * for AS_ENGINEER, assignment membership), used both by UI components and
 * re-checked independently by every mutation in
 * db/mutations/procedure-case-execution.ts — a hidden button here is a UX
 * convenience only, never the enforcement boundary.
 *
 * Policy is the approved Phase 5A plan's role table:
 *  - SUPER_ADMIN / ADMIN: full view + mutate access, including reopening a
 *    COMPLETED or SKIPPED node.
 *  - AS_ENGINEER: view + mutate only when assigned — either to the case
 *    (repair_cases.assigned_engineer_id) or to the specific node
 *    (procedure_case_execution_nodes.assigned_engineer_id, the "effective
 *    assignee" coalesce). May reopen a BLOCKED node they're assigned to,
 *    but never a COMPLETED/SKIPPED one (that requires ADMIN+).
 *  - SALES / INVENTORY_MANAGER: read-only.
 *  - Shipment-lock removal policy: isBlockedByCaseLock below always
 *    returns false now — a shipped case's procedure execution stays fully
 *    mutable. See isBlockedByShipmentLock (repair-case-edit-authorization.ts)
 *    for the full policy-change rationale.
 */

export function canViewProcedureExecution(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "AS_ENGINEER" || role === "SALES" || role === "INVENTORY_MANAGER";
}

export type EffectiveAssigneeContext = {
  /** procedure_case_execution_nodes.assigned_engineer_id ?? repair_cases.assigned_engineer_id — the coalesce is the caller's responsibility (queries/procedure-case-execution.ts), this function only compares the resolved id against the actor. */
  effectiveAssigneeId: string | null;
  actorUserId: string;
};

function isAssignedActor(ctx: EffectiveAssigneeContext): boolean {
  return ctx.effectiveAssigneeId !== null && ctx.effectiveAssigneeId === ctx.actorUserId;
}

/** Start execution, start/complete/block/skip a node, add an extra task, update a memo — the Phase 5A "ordinary mutation" tier. */
/**
 * 이 역할은 자기 담당 건에서만 절차를 진행할 수 있는가.
 * repair-case-work-record-authorization.ts의 같은 이름 함수와 같은 이유로 있다.
 */
export function executionRequiresOwnAssignment(role: Role): boolean {
  return role === "AS_ENGINEER";
}

export function canPerformOrdinaryExecutionMutation(role: Role, assignment: EffectiveAssigneeContext): boolean {
  if (role === "SUPER_ADMIN" || role === "ADMIN") return true;
  if (role === "AS_ENGINEER") return isAssignedActor(assignment);
  return false;
}

/** Reopening a COMPLETED or SKIPPED node — ADMIN+ only, never AS_ENGINEER regardless of assignment (a stronger bar than an ordinary mutation, matching the "finished determination" rationale in the Phase 5A plan §8). */
export function canReopenCompletedOrSkippedNode(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

/** Reopening a BLOCKED node — ADMIN+, or the assigned AS_ENGINEER (closer to resuming a paused IN_PROGRESS node than undoing a finished determination). */
export function canReopenBlockedNode(role: Role, assignment: EffectiveAssigneeContext): boolean {
  if (role === "SUPER_ADMIN" || role === "ADMIN") return true;
  if (role === "AS_ENGINEER") return isAssignedActor(assignment);
  return false;
}

/**
 * `isLocked` is intentionally still accepted here (not removed from the
 * signature) so every call site's shape stays unchanged and this remains
 * the single place to reintroduce execution-locking later if ever needed —
 * always returns false now, unconditionally (shipment-lock removal policy).
 */
export function isBlockedByCaseLock(isLocked: boolean): boolean {
  void isLocked;
  return false;
}

/** Convenience guard combining role/assignment + lock check for the common "ordinary mutation" path — mutations call this once instead of composing the two checks themselves at every call site. */
export function authorizeOrdinaryExecutionMutation(
  role: Role,
  assignment: EffectiveAssigneeContext,
  isCaseLocked: boolean
): boolean {
  if (isBlockedByCaseLock(isCaseLocked)) return false;
  return canPerformOrdinaryExecutionMutation(role, assignment);
}
