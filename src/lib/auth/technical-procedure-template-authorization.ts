import type { Role } from "@/lib/domain/types";
import type { ProcedureTemplateCategory } from "@/lib/domain/procedure-template-types";
import {
  canViewPublishedProcedureTemplates,
  canEditProcedureTemplateDraft,
  canPublishProcedureTemplates,
  canCreateProcedureTemplateDraft,
} from "@/lib/auth/procedure-template-authorization";

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

/**
 * Phase 5C-5B — DRAFT/ARCHIVED technical-template visibility for the
 * technical library list (mirrors canViewAllProcedureTemplateStatuses'
 * role, SUPER_ADMIN+ADMIN, which happens to be the exact same set as
 * canManageTechnicalTemplates — reused directly rather than duplicated).
 */
export function canViewAllTechnicalTemplateStatuses(role: Role): boolean {
  return canManageTechnicalTemplates(role);
}

/**
 * Phase 5C-5B — category-dispatching authorization for the three
 * template-lifecycle actions whose permission tier now depends on WHICH
 * category the target row actually is, not just on `role` alone: edit/
 * validate a DRAFT, publish, and create a new DRAFT version from a
 * PUBLISHED row. Each function's `else` branch (FULL_SERVICE or REFERENCE)
 * calls the exact pre-existing procedure-template-authorization.ts
 * function, unchanged — only TECHNICAL_TASK ever evaluates a different
 * (broader) permission. REFERENCE is included in the dispatch only so it's
 * total over every category value; in practice a REFERENCE template never
 * reaches any of these three checks at all (assertEditableDraft's
 * isReferenceOnly guard, and createNewDraftVersion's PUBLISHED-only source
 * requirement, both block it upstream regardless of role).
 *
 * Deliberately three separate functions, not one generic
 * "canActorMutateTemplate" — edit/publish/create-draft-version are distinct
 * actions with independently reviewed FULL_SERVICE permission functions
 * today, and collapsing them into one dispatch would obscure that each one
 * still calls its own, unrelated existing SUPER_ADMIN-only function.
 */
export function canActorEditTemplateOfCategory(role: Role, category: ProcedureTemplateCategory): boolean {
  return category === "TECHNICAL_TASK" ? canEditTechnicalTemplateDraft(role) : canEditProcedureTemplateDraft(role);
}

export function canActorPublishTemplateOfCategory(role: Role, category: ProcedureTemplateCategory): boolean {
  return category === "TECHNICAL_TASK" ? canPublishTechnicalTemplates(role) : canPublishProcedureTemplates(role);
}

export function canActorCreateDraftVersionOfCategory(role: Role, category: ProcedureTemplateCategory): boolean {
  return category === "TECHNICAL_TASK" ? canCreateTechnicalTemplateDraftVersion(role) : canCreateProcedureTemplateDraft(role);
}

/**
 * Phase 5C-5B-1 — authorization for the node/edge STRUCTURAL CRUD
 * capabilities (create node, delete node, delete edge) that no category
 * had before this phase. Deliberately NOT canActorEditTemplateOfCategory:
 * that function's FULL_SERVICE/REFERENCE branch falls through to the
 * existing canEditProcedureTemplateDraft (SUPER_ADMIN-only) property-edit
 * policy, which would incorrectly hand SUPER_ADMIN this brand-new
 * destructive/structural capability on FULL_SERVICE templates too — the
 * task brief is explicit that this is a hard deny for every role on
 * FULL_SERVICE/REFERENCE, with no SUPER_ADMIN carve-out. This function is
 * therefore TECHNICAL_TASK-only by construction, never a role-only check.
 */
export function canActorManageTechnicalTemplateGraph(role: Role, category: ProcedureTemplateCategory): boolean {
  return category === "TECHNICAL_TASK" && canManageTechnicalTemplates(role);
}

/**
 * 기술 절차 휴지통 체크포인트 — 절차를 휴지통으로 보내고, 되살리고, 즉시
 * 완전삭제하는 권한.
 *
 * **canActorManageTechnicalTemplateGraph와 같은 모양으로, 일부러
 * TECHNICAL_TASK 전용이다.** canActorEditTemplateOfCategory처럼 분류별로
 * 갈라 쓰지 않는 이유도 같다 — 그 함수의 FULL_SERVICE/REFERENCE 가지는
 * 기존 canEditProcedureTemplateDraft(최고관리자 전용 속성 편집 정책)로
 * 떨어지는데, 삭제는 그 정책이 한 번도 다룬 적 없는 새 능력이다. 분류로
 * 먼저 막아 두면 나중에 누가 역할만 넓혀도 전체 서비스 절차에는 삭제가
 * 열리지 않는다.
 *
 * 보관(canArchiveProcedureTemplates, 최고관리자 전용)과도 합치지 않는다.
 * 보관은 발행된 절차를 내리는 다른 일이고 권한 계층도 다르다 — 한 함수로
 * 접으면 둘 중 하나는 반드시 잘못된 계층을 갖게 된다.
 *
 * 삭제·복원·완전삭제를 하나로 묶은 것은 다른 화면과 같은 이유다: 셋을
 * 나누면 "지울 수는 있는데 되돌릴 수는 없는" 역할이 만들어진다.
 */
export function canDeleteTechnicalTemplates(role: Role, category: ProcedureTemplateCategory): boolean {
  return category === "TECHNICAL_TASK" && canManageTechnicalTemplates(role);
}
