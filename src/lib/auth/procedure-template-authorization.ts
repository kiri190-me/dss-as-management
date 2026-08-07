import type { Role } from "@/lib/domain/types";

/**
 * Centralized, server-side authorization for procedure-template
 * management (Phase 2 of the repair-center workflow digitization). Same
 * convention as repair-case-edit-authorization.ts: pure functions of
 * `Role`, used both by UI components (to decide what to render) and by the
 * mutation layer (procedure-templates.ts), which re-checks every one of
 * these independently against the live DB role — a hidden button here is
 * a UX convenience only, never the enforcement boundary.
 *
 * Policy is this task's explicit permission table:
 *  - SUPER_ADMIN: view all (including DRAFT/ARCHIVED), import, validate,
 *    publish, archive.
 *  - ADMIN: view (published only) + inspect validation issues.
 *  - AS_ENGINEER: view published templates only.
 *  - SALES / INVENTORY_MANAGER: no access at all (the task's "no
 *    template-management access unless current project rules explicitly
 *    allow it" — no existing project rule grants either role any access
 *    here, so both are excluded).
 *  - DEVELOPER is not a role in this codebase (users.is_developer is a
 *    separate flag) and is not introduced by this task.
 */

export function canViewPublishedProcedureTemplates(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "AS_ENGINEER";
}

/** DRAFT and ARCHIVED templates are only visible to the two management roles. */
export function canViewAllProcedureTemplateStatuses(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

export function canInspectValidationIssues(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

export function canImportProcedureTemplates(role: Role): boolean {
  return role === "SUPER_ADMIN";
}

export function canPublishProcedureTemplates(role: Role): boolean {
  return role === "SUPER_ADMIN";
}

export function canArchiveProcedureTemplates(role: Role): boolean {
  return role === "SUPER_ADMIN";
}

/** Editing a published template into a new draft version — same gate as import/publish (no Phase 2 UI exposes this; verified by the mutation layer's own tests). */
export function canCreateProcedureTemplateDraft(role: Role): boolean {
  return role === "SUPER_ADMIN";
}

/**
 * Phase 3A: gates whether the validation-resolution routes/button exist at
 * all for a role. SUPER_ADMIN and ADMIN both get read access (issue list,
 * evidence, candidates, history) — ADMIN's access is view-only, enforced by
 * canResolveProcedureValidationIssues below, not by a second view-gate
 * function. No existing policy in this codebase grants ADMIN any
 * procedure-template mutation, so this phase does not add a separate
 * ADMIN-can-comment write path either — a deliberate scope decision, not an
 * oversight.
 */
export function canViewProcedureValidationManagement(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

/** Bind a connector, resolve/defer without a graph change, reopen, or roll back an edge — SUPER_ADMIN only, same tier as import/publish/archive. */
export function canResolveProcedureValidationIssues(role: Role): boolean {
  return role === "SUPER_ADMIN";
}

/**
 * Phase 4A — the controlled workflow editor (/procedures/[id]/edit):
 * editing a DRAFT's node/edge properties, repositioning nodes, retargeting
 * or creating edges, saving layout, and triggering a validate run. Gates
 * the same tier as import/publish/archive/canCreateProcedureTemplateDraft
 * (this task's explicit permission table: "ADMIN: Read-only for this phase
 * unless an existing explicit procedure-edit permission already exists" —
 * none does, so ADMIN gets no new write access here, only the pre-existing
 * canViewAllProcedureTemplateStatuses read access). Every mutation in
 * procedure-template-editor.ts re-checks this independently of whatever
 * the editor UI renders, exactly like every other function in this file.
 */
export function canEditProcedureTemplateDraft(role: Role): boolean {
  return role === "SUPER_ADMIN";
}
