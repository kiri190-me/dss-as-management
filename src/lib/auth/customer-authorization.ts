import type { Role } from "@/lib/domain/types";

/**
 * Centralized, server-side authorization for the Customer Management
 * screens (/customers, /customers/[id]) — Phase 1 (list/detail/basic edit).
 * Same convention as repair-case-flowchart-authorization.ts: pure functions
 * of `Role`, used both by the nav item / UI components (to decide what to
 * render) and re-checked independently by updateCustomerAction — a hidden
 * edit control here is a UX convenience only, never the enforcement
 * boundary.
 *
 * Policy (Customer Management phase 1 — approved scope):
 *  - View (list + detail): SUPER_ADMIN/ADMIN/AS_ENGINEER/SALES.
 *    INVENTORY_MANAGER cannot access at all (unlike repair-case flowcharts,
 *    which are viewable by all 5 roles — customer master data is out of
 *    scope for inventory work).
 *  - Edit (customer master name/contact fields): SUPER_ADMIN/ADMIN only.
 *    Narrower than view, mirroring canPermanentlyDeleteRepairCaseFlowchart's
 *    "admin-only subset of the viewing roles" shape.
 *
 * End-User + multi-contact management (approved authorization design):
 *  - Create End-User: SUPER_ADMIN/ADMIN/AS_ENGINEER/SALES — matches the
 *    trust boundary intake's own free-entry combobox already grants these
 *    roles today (resolveOrCreateEndUserByName), just a second entry point
 *    to the same decision.
 *  - Rename an EXISTING End-User: SUPER_ADMIN/ADMIN only — "undo/correct a
 *    past decision" is withheld from AS_ENGINEER/SALES, unlike creating a
 *    new one.
 *  - Add/edit a contact: SUPER_ADMIN/ADMIN/AS_ENGINEER/SALES — same
 *    create-level trust as creating the End-User itself.
 *  - Remove (soft-delete) a contact: SUPER_ADMIN/ADMIN only — same
 *    "undo a past decision is narrower" rule as renaming.
 */

export function canViewCustomers(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "AS_ENGINEER" || role === "SALES";
}

export function canEditCustomers(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

export function canCreateEndUser(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "AS_ENGINEER" || role === "SALES";
}

export function canRenameEndUser(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

export function canAddEndUserContact(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "AS_ENGINEER" || role === "SALES";
}

export function canEditEndUserContact(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "AS_ENGINEER" || role === "SALES";
}

export function canRemoveEndUserContact(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}
