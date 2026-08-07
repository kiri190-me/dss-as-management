import type { Role } from "@/lib/domain/types";

/**
 * Centralized, server-side authorization for Phase 5B-2 inventory
 * mutations. Same convention as procedure-case-execution-authorization.ts:
 * pure functions of `Role` (plus, for stock USE, live assignment/lock
 * context), used both by UI components (to decide what to render) and
 * re-checked independently by every mutation in
 * db/mutations/inventory.ts — a hidden button here is a UX convenience
 * only, never the enforcement boundary.
 *
 * Policy is the approved Phase 5B-2 plan's permission tables:
 *  - View stock/price/transaction history: all 5 roles.
 *  - Create/edit part, receive stock, return stock: SUPER_ADMIN/ADMIN/
 *    INVENTORY_MANAGER only.
 *  - Stock USE has its own, more granular rule — see canUseStock below.
 *  - repair_cases.is_locked blocks USE unconditionally for every role,
 *    including SUPER_ADMIN — no exception, mirroring Phase 5A's policy
 *    exactly (confirmed, not a design recommendation).
 */

export function canViewInventory(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "AS_ENGINEER" || role === "SALES" || role === "INVENTORY_MANAGER";
}

export function canCreateOrEditPart(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "INVENTORY_MANAGER";
}

export function canReceiveStock(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "INVENTORY_MANAGER";
}

export function canReturnStock(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "INVENTORY_MANAGER";
}

export function canViewTransactionHistory(role: Role): boolean {
  return canViewInventory(role);
}

/**
 * UI-visibility helper only — "does this role ever have a path to a
 * successful USE," ignoring the per-balance/per-case context that
 * canUseStock below requires (repair-case assignment, lock state,
 * procedure-execution node). Every role this returns true for still goes
 * through the real consumeStockAction → canUseStock check with full live
 * context; this is only for deciding whether the 사용 button should
 * render at all. SALES never has a path to USE regardless of context —
 * every other role sometimes does.
 */
export function canSeeUseStockButton(role: Role): boolean {
  return role !== "SALES";
}

/**
 * Stock USE authorization context — every field must be computed fresh
 * inside the same DB transaction as the mutation itself, never trusted
 * from the client. `isEffectiveAssigneeOfSuppliedNode` is only meaningful
 * when a `procedureExecutionNodeId` was supplied AND independently
 * verified to belong to an execution whose repair_case_id equals the
 * submitted repairCaseId — a caller must never be able to satisfy this by
 * naming an unrelated node from a different case (see
 * db/mutations/inventory.ts's useStock for that verification).
 */
export type UseStockAuthorizationContext = {
  hasRepairCase: boolean;
  isCaseLocked: boolean;
  isAssignedToCase: boolean;
  isEffectiveAssigneeOfSuppliedNode: boolean;
};

/**
 * Confirmed final rule (Phase 5B-2 plan §9), not a recommendation:
 *  - A repair-case-linked USE is rejected the instant the case is locked,
 *    for every role, no exception — checked first, before any role logic.
 *  - SUPER_ADMIN / ADMIN / INVENTORY_MANAGER: may USE against any
 *    unlocked repair case, and may also USE with only a destination_note
 *    (no repair case at all).
 *  - AS_ENGINEER: a repair case is *required* — never a destination-only
 *    USE in Phase 5B-2 — and is authorized only when directly assigned to
 *    that case, or when the effective assignee of a supplied, validated
 *    procedure-execution node context matches them.
 *  - SALES and any other role: never authorized to USE stock.
 */
export function canUseStock(role: Role, ctx: UseStockAuthorizationContext): boolean {
  if (ctx.hasRepairCase && ctx.isCaseLocked) return false;

  if (role === "SUPER_ADMIN" || role === "ADMIN" || role === "INVENTORY_MANAGER") return true;

  if (role === "AS_ENGINEER") {
    if (!ctx.hasRepairCase) return false;
    return ctx.isAssignedToCase || ctx.isEffectiveAssigneeOfSuppliedNode;
  }

  return false;
}
