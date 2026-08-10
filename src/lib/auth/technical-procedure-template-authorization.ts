import type { Role } from "@/lib/domain/types";
import { canViewPublishedProcedureTemplates } from "@/lib/auth/procedure-template-authorization";

/**
 * Phase 5C-5A — centralized, server-side authorization for TECHNICAL_TASK
 * procedure-template management. Deliberately a SEPARATE module from
 * procedure-template-authorization.ts, never an extension of it — every
 * function in that file (canEditProcedureTemplateDraft,
 * canCreateProcedureTemplateDraft, canPublishProcedureTemplates,
 * canArchiveProcedureTemplates, all SUPER_ADMIN-only) stays byte-for-byte
 * unchanged and continues to gate FULL_SERVICE/REFERENCE template
 * management exactly as before. Nothing in this file is ever called by
 * that file, or vice versa, so a future edit to technical-template policy
 * structurally cannot widen lifecycle/full-service permissions.
 *
 * Policy (this task's explicit approved table):
 *  - SUPER_ADMIN and ADMIN: full technical-template management — create a
 *    TECHNICAL_TASK DRAFT, edit it, publish it, create a new DRAFT version
 *    from a PUBLISHED one. Deliberately broader than the lifecycle/
 *    full-service tier (SUPER_ADMIN-only) — this is an intentional,
 *    category-scoped policy difference, not an oversight or a widening of
 *    the existing functions.
 *  - AS_ENGINEER / SALES / INVENTORY_MANAGER: no global technical-template
 *    mutation of any kind.
 *
 * Phase 5C-5A implements authorization only — no CRUD mutation, editor UI,
 * or publish UI exists yet for TECHNICAL_TASK templates (Phase 5C-5B).
 * These functions exist now so the eventual 5C-5B mutations have an
 * already-reviewed policy to call, and so this phase's foundation tests can
 * prove the policy table without waiting on the mutations themselves.
 */

export function canManageTechnicalTemplates(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

/** Create a TECHNICAL_TASK DRAFT (from scratch, MANUAL source — technical templates are never Excel-imported). */
export function canCreateTechnicalTemplateDraft(role: Role): boolean {
  return canManageTechnicalTemplates(role);
}

/** Edit a TECHNICAL_TASK DRAFT's nodes/edges/properties (Phase 5C-5B's CRUD). */
export function canEditTechnicalTemplateDraft(role: Role): boolean {
  return canManageTechnicalTemplates(role);
}

export function canPublishTechnicalTemplates(role: Role): boolean {
  return canManageTechnicalTemplates(role);
}

/** Create a new DRAFT version from a PUBLISHED TECHNICAL_TASK template. */
export function canCreateTechnicalTemplateDraftVersion(role: Role): boolean {
  return canManageTechnicalTemplates(role);
}

/**
 * Viewing a PUBLISHED technical template — reuses
 * canViewPublishedProcedureTemplates directly rather than duplicating an
 * identical role check: that function is already role-only and
 * category-agnostic (SUPER_ADMIN/ADMIN/AS_ENGINEER), which is exactly the
 * "preserve the current appropriate published-template view semantics for
 * engineering use" policy this task asks for. A thin named wrapper (rather
 * than callers importing the lifecycle function directly) keeps every
 * technical-template call site going through this module, so a future
 * category-specific view restriction — if one is ever needed — has exactly
 * one place to change.
 */
export function canViewPublishedTechnicalTemplates(role: Role): boolean {
  return canViewPublishedProcedureTemplates(role);
}
