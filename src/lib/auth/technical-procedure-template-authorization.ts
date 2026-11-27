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
 * ── 🔴 2026-11-27: 위 표에서 **두 칸이 바뀌었다** ──────────────────────────
 * A/S 엔지니어가 **만들기와 초안 편집**에 들어왔다(사용자 결정 —
 * canAuthorTechnicalTemplatesByDefault 의 주석에 원문 둘). 「no ... mutation of any
 * kind」는 그 역할에 대해 더 이상 참이 아니다. 🔴 **발행과 새 버전… 중 발행은**
 * 그대로 최고관리자·관리자다. 「새 초안 버전 만들기」는 초안 편집 잎을 보므로
 * (mayCreateDraftVersionOfCategory) 엔지니어에게 **함께 열린다** — 게시본을 고치는
 * 유일한 길이라 초안 편집과 떼어 둘 수 없다. 올린 판을 **발행하는 것은 여전히 막힌다.**
 *
 * ── 🔴 2026-11-27: 이 파일의 함수들은 **더 이상 최종 관문이 아니다** ───────
 * 기술 절차의 만들기·초안 편집·발행은 설정(`technicalProcedures.*`)이 판정한다.
 * 여기 적힌 표는 **저장된 설정이 없을 때의 기본값**으로만 쓰인다
 * (permission-baseline.ts 가 이 함수들을 부른다). 최종 관문으로 다시 쓰지 마라 —
 * 그러면 설정으로 넓혀도 안 열리고 좁혀도 안 닫히는 길이 되살아난다.
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

/**
 * ============================================================================
 * 🔴 2026-11-27 — 기술 절차를 **짓는** 사람의 기본값 (사용자 결정)
 * ============================================================================
 * 사용자 원문 둘:
 *   「[절차 만들기]는 [최고 관리자/관리자/a/s엔지니어]는 [읽기+쓰기]를 기본
 *    권한으로 설정해줘.」
 *   「ㄱ으로 진행해」 — 만든 절차를 **열지도 고치지도 못하는** 상태를 보고 내린
 *    결정. 만들기와 **같은 셋**에게 초안 편집도 기본으로 연다.
 *
 * 🔴 **역할 이름이 적히는 자리는 여기 하나뿐이다.** 만들기와 초안 편집이 같은
 * 집합이라는 것이 사용자의 결정 그 자체이므로, 두 벌로 적으면 다음에 한쪽만
 * 바뀌는 날이 온다(그때 갈라지는 방향은 조용한 쪽이다 — 넓어진 쪽은 금방
 * 드러나지만 좁아진 쪽은 아무도 신고하지 않는다).
 *
 * 🔴 **「기본값」이지 관문이 아니다.** 부르는 곳은 permission-baseline.ts 둘뿐이고
 * (만들기 잎 · 초안 편집 잎), 실제 판정은 설정(`technicalProcedures.create` ·
 * `.editDraft`)이 한다 — 관리자가 설정에서 좁히면 엔지니어는 못 한다. 이 함수를
 * 최종 관문으로 쓰지 마라: 그러면 설정으로 좁혀도 안 닫히는 길이 생긴다.
 * 그래서 이름에 ByDefault 를 박아 둔다 — grep 한 번으로 구분되게.
 *
 * 🔴 **`canEditTechnicalTemplateDraft` 를 넓히지 않은 까닭**(2026-11-27 실측).
 * 그 함수는 호출부가 **셋**이라 넓히면 기본값 말고도 둘이 함께 움직인다:
 *   ① permission-baseline.ts:623 — 초안 편집 잎의 기본값 ← **여기만 넓히면 된다**
 *   ② permission-baseline.ts:276 — `case "technicalProcedures"` 메뉴 상한의 write 항
 *   ③ 아래 canActorEditTemplateOfCategory 의 TECHNICAL_TASK 가지
 * ②·③ 은 지금 **production 호출부가 0건**이지만(②는 baselinePermissionLevel 을
 * 부르는 코드가 시험밖에 없고, ③은 mayEditTemplateOfCategory 로 대체됐다), 살아
 * 있는 코드다 — 누가 다시 이으면 **허락받지 않은 넓힘**이 조용히 따라 붙는다.
 * 특히 ③을 넓히면 그 이웃 canActorManageTechnicalTemplateGraph(최고관리자·관리자)와
 * 답이 갈려, 「속성은 고치는데 노드는 못 만드는」 역할이 생긴다.
 *
 * 🔵 **만들기 쪽은 반대였다**: canCreateTechnicalTemplateDraft 의 호출부는 기본값
 * 한 곳뿐이라 그 함수를 그대로 이 집합에 묶어도 딸려 움직이는 것이 없다.
 * ============================================================================
 */
export function canAuthorTechnicalTemplatesByDefault(role: Role): boolean {
  return canManageTechnicalTemplates(role) || role === "AS_ENGINEER";
}

/**
 * Create a TECHNICAL_TASK DRAFT (from scratch, MANUAL source — technical
 * templates are never Excel-imported).
 *
 * 🔴 2026-11-27 부터 위 「짓는 사람」 집합 그대로다 — 호출부가 기본값 한 곳뿐이라
 * (permission-baseline.ts) 묶어도 딸려 움직이는 것이 없다.
 */
export function canCreateTechnicalTemplateDraft(role: Role): boolean {
  return canAuthorTechnicalTemplatesByDefault(role);
}

/**
 * Edit a TECHNICAL_TASK DRAFT's nodes/edges/properties (Phase 5C-5B's CRUD).
 *
 * 🔴 **일부러 안 넓혔다**(2026-11-27). 초안 편집의 **기본값**은 위
 * canAuthorTechnicalTemplatesByDefault 가 들고 있다 — 까닭은 그 주석의 「셋」 문단.
 * 이 함수를 넓히면 메뉴 상한과 분류별 관문까지 함께 움직인다.
 */
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
