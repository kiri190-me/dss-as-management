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
 *  - Locked-case behavior is unconditional for every role, including
 *    SUPER_ADMIN — see isBlockedByCaseLock, mirroring
 *    repair-case-edit-authorization.ts's isBlockedByShipmentLock.
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
 * Locked-case behavior is unconditional for every role, including
 * SUPER_ADMIN/ADMIN — no exception, per the Phase 5A plan §11. Post-shipment
 * correction is out of scope for Phase 5A entirely (blocked on the
 * not-yet-implemented unlock_requests mechanism), so there is no override
 * path here at all, unlike a role-gated function.
 */
export function isBlockedByCaseLock(isLocked: boolean): boolean {
  return isLocked;
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
