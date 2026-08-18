import type { Role } from "@/lib/domain/types";

/**
 * Centralized, server-side authorization for repair-case flowcharts
 * (Phase 5C-6B, assignment restriction removed in Checkpoint 3A). Same
 * convention as repair-case-work-record-authorization.ts and
 * procedure-case-execution-authorization.ts: pure functions of `Role` (plus
 * live lock context), used both by UI components (to decide what to
 * render) and re-checked independently by every mutation gate that calls
 * this — a hidden button here is a UX convenience only, never the
 * enforcement boundary.
 *
 * Policy (Checkpoint 3A — approved final rule):
 *  - View: all 5 roles, same "if you can open this case, you can read its
 *    flowcharts" rule as work records — repair-case detail viewing itself is
 *    not role/assignment-restricted anywhere in this codebase.
 *  - Mutate (create/update metadata/graph editing/soft-delete/restore — one
 *    shared rule for all of them): SUPER_ADMIN/ADMIN/AS_ENGINEER may manage ANY
 *    repair case's flowcharts, unconditionally — AS_ENGINEER is deliberately
 *    not assignment-scoped (repair_cases.assigned_engineer_id is not read by
 *    this function at all). SALES/INVENTORY_MANAGER never mutate.
 *  - Shipment-lock removal policy: `ctx.isCaseLocked` is intentionally still
 *    accepted (every call site keeps passing the real repair_cases.is_locked
 *    value, unchanged) but is no longer read by this function — a shipped
 *    case's flowcharts stay fully create/edit/delete/restore-able. See
 *    isBlockedByShipmentLock (repair-case-edit-authorization.ts) for the
 *    full policy-change rationale.
 *  - Permanent delete (hard delete of an already-trashed flowchart) is a
 *    NARROWER, separate rule — SUPER_ADMIN/ADMIN only, never AS_ENGINEER —
 *    see canPermanentlyDeleteRepairCaseFlowchart below. It takes no
 *    case-lock context at all: the target row is already soft-deleted, so
 *    there was never a lock check to remove here in the first place.
 */

export function canViewRepairCaseFlowcharts(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "AS_ENGINEER" || role === "SALES" || role === "INVENTORY_MANAGER";
}

export type MutateRepairCaseFlowchartContext = {
  isCaseLocked: boolean;
};

/** Governs create, update-metadata, graph editing, soft-delete, and restore alike — one identical rule for all of them, not per-action rules. */
export function canMutateRepairCaseFlowchart(role: Role, ctx: MutateRepairCaseFlowchartContext): boolean {
  void ctx;
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "AS_ENGINEER";
}

/**
 * UI-only convenience for surfaces that decide whether to show manage
 * controls (e.g. 진단 Flowchart 관리's "새 Flowchart 추가"/삭제 buttons)
 * before any SPECIFIC repair case — and therefore its real isCaseLocked
 * value — is known. Reuses canMutateRepairCaseFlowchart directly (role tier
 * only matters here; a hypothetical "unlocked" case is passed purely to
 * evaluate the role branch) rather than re-listing the role set a second
 * time. Every actual create/edit/delete action still independently
 * re-checks canMutateRepairCaseFlowchart against the real target case's
 * lock state server-side — this can never itself grant access to a locked
 * case.
 */
export function canManageRepairCaseFlowchartsGlobally(role: Role): boolean {
  return canMutateRepairCaseFlowchart(role, { isCaseLocked: false });
}

/**
 * Permanent-delete (hard delete of an already-soft-deleted flowchart, 휴지통
 * 완전 삭제) — SUPER_ADMIN/ADMIN only. Deliberately a separate, narrower
 * function from canMutateRepairCaseFlowchart rather than a third ctx flag on
 * it: AS_ENGINEER may soft-delete/restore but must never permanently
 * destroy data, so this is not "one shared rule with an exception," it's a
 * genuinely different authorization tier. No context parameter at all — no
 * case-lock, no other state — the caller (permanentlyDeleteRepairCaseFlowchart)
 * separately re-verifies the flowchart is actually soft-deleted before this
 * is ever consulted.
 */
export function canPermanentlyDeleteRepairCaseFlowchart(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}
