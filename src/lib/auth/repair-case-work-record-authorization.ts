import type { Role } from "@/lib/domain/types";

/**
 * Centralized, server-side authorization for repair-case work records
 * (Phase 5C-2). Same convention as procedure-case-execution-authorization.ts
 * and inventory-authorization.ts: pure functions of `Role` (plus live
 * context where needed), used both by UI components (to decide what to
 * render) and re-checked independently by every mutation in
 * db/mutations/repair-case-work-records.ts — a hidden button here is a UX
 * convenience only, never the enforcement boundary.
 *
 * Policy (final, per Phase 5C-2 approval):
 *  - View: all 5 roles. Repair-case detail viewing itself is not currently
 *    role/assignment-restricted anywhere in this codebase (confirmed by
 *    inspection — PartRequestSection gates its CREATE action, not section
 *    visibility), so work-record visibility follows the same "if you can
 *    open this case, you can read its work records" rule as every other
 *    section on the page.
 *  - Create: SUPER_ADMIN/ADMIN on any unlocked case; AS_ENGINEER only on
 *    an unlocked case they are directly assigned to. SALES/
 *    INVENTORY_MANAGER never create.
 *  - Invalidate: SUPER_ADMIN/ADMIN only, only on an unlocked case. Never
 *    AS_ENGINEER (not even their own record), never SALES/
 *    INVENTORY_MANAGER. No hidden SUPER_ADMIN bypass of the lock check —
 *    checked first, unconditionally, same discipline as
 *    isBlockedByCaseLock in procedure-case-execution-authorization.ts.
 *  - There is no edit authorization function at all — no mutation exists
 *    to edit a work record's text, for any role.
 */

export function canViewWorkRecords(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "AS_ENGINEER" || role === "SALES" || role === "INVENTORY_MANAGER";
}

export type CreateWorkRecordContext = {
  isAssignedToCase: boolean;
  isCaseLocked: boolean;
};

/** AS_ENGINEER may only create on their own assigned case; SUPER_ADMIN/ADMIN may create on any case. The lock check is unconditional and checked first — no role bypass. */
export function canCreateWorkRecord(role: Role, ctx: CreateWorkRecordContext): boolean {
  if (ctx.isCaseLocked) return false;
  if (role === "SUPER_ADMIN" || role === "ADMIN") return true;
  if (role === "AS_ENGINEER") return ctx.isAssignedToCase;
  return false;
}

export type InvalidateWorkRecordContext = {
  isCaseLocked: boolean;
};

/** SUPER_ADMIN/ADMIN only, and only on an unlocked case — never AS_ENGINEER, regardless of authorship. */
export function canInvalidateWorkRecord(role: Role, ctx: InvalidateWorkRecordContext): boolean {
  if (ctx.isCaseLocked) return false;
  return role === "SUPER_ADMIN" || role === "ADMIN";
}
