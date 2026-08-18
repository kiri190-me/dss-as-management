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
 *  - Create: SUPER_ADMIN/ADMIN on any case; AS_ENGINEER only on a case they
 *    are directly assigned to. SALES/INVENTORY_MANAGER never create.
 *  - Invalidate: SUPER_ADMIN/ADMIN only. Never AS_ENGINEER (not even their
 *    own record), never SALES/INVENTORY_MANAGER.
 *  - Shipment-lock removal policy: `ctx.isCaseLocked` is intentionally
 *    still accepted by both functions below (every call site keeps passing
 *    the real repair_cases.is_locked value, unchanged) but is no longer
 *    read — a shipped case's work records stay fully create/invalidate-able.
 *    See isBlockedByShipmentLock (repair-case-edit-authorization.ts) for the
 *    full policy-change rationale.
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

/** AS_ENGINEER may only create on their own assigned case; SUPER_ADMIN/ADMIN may create on any case. */
export function canCreateWorkRecord(role: Role, ctx: CreateWorkRecordContext): boolean {
  void ctx.isCaseLocked;
  if (role === "SUPER_ADMIN" || role === "ADMIN") return true;
  if (role === "AS_ENGINEER") return ctx.isAssignedToCase;
  return false;
}

export type InvalidateWorkRecordContext = {
  isCaseLocked: boolean;
};

/** SUPER_ADMIN/ADMIN only — never AS_ENGINEER, regardless of authorship. */
export function canInvalidateWorkRecord(role: Role, ctx: InvalidateWorkRecordContext): boolean {
  void ctx.isCaseLocked;
  return role === "SUPER_ADMIN" || role === "ADMIN";
}
