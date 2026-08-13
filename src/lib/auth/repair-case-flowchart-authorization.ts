import type { Role } from "@/lib/domain/types";

/**
 * Centralized, server-side authorization for repair-case flowcharts
 * (Phase 5C-6B). Same convention as repair-case-work-record-authorization.ts
 * and procedure-case-execution-authorization.ts: pure functions of `Role`
 * (plus live assignment/lock context), used both by UI components (to
 * decide what to render) and re-checked independently by every mutation in
 * db/mutations/repair-case-flowcharts.ts — a hidden button here is a UX
 * convenience only, never the enforcement boundary.
 *
 * Policy (per the approved 5C-6B plan):
 *  - View: all 5 roles, same "if you can open this case, you can read its
 *    flowcharts" rule as work records — repair-case detail viewing itself is
 *    not role/assignment-restricted anywhere in this codebase.
 *  - Mutate (create/update metadata/soft-delete — one shared rule for all
 *    three, unlike work records where create/invalidate differ):
 *    SUPER_ADMIN/ADMIN on any unlocked case; AS_ENGINEER only on an unlocked
 *    case they are directly assigned to (repair_cases.assigned_engineer_id).
 *    SALES/INVENTORY_MANAGER never mutate.
 *  - The lock check is unconditional and checked first, for every role
 *    including SUPER_ADMIN — no hidden bypass, same discipline as
 *    isBlockedByCaseLock/isBlockedByShipmentLock elsewhere.
 */

export function canViewRepairCaseFlowcharts(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "AS_ENGINEER" || role === "SALES" || role === "INVENTORY_MANAGER";
}

export type MutateRepairCaseFlowchartContext = {
  isAssignedToCase: boolean;
  isCaseLocked: boolean;
};

/** Governs create, update-metadata, and soft-delete alike — the 5C-6B plan defines one identical rule for all three, not per-action rules. */
export function canMutateRepairCaseFlowchart(role: Role, ctx: MutateRepairCaseFlowchartContext): boolean {
  if (ctx.isCaseLocked) return false;
  if (role === "SUPER_ADMIN" || role === "ADMIN") return true;
  if (role === "AS_ENGINEER") return ctx.isAssignedToCase;
  return false;
}
