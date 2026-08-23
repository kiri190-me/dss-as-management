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
 *
 * 고객사 삭제(휴지통 → 15일 → 완전삭제, 승인된 체크포인트):
 *  - 삭제·복원·완전삭제: SUPER_ADMIN/ADMIN only — 하나의 함수로 묶는다.
 *    셋을 따로 나누면 "지울 수는 있는데 되돌릴 수는 없는" 역할이 만들어지고,
 *    그건 삭제를 더 안전하게 만드는 것이 아니라 되돌릴 방법만 없애는 것이다.
 *    접수 건 쪽 canBulkDeleteRepairCases/canRestoreRepairCases/
 *    canPermanentlyDeleteRepairCases가 결국 전부 같은 역할 집합인 것과
 *    같은 결론이며, 여기서는 처음부터 하나로 적는다.
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

/**
 * 고객사를 휴지통으로 보내고, 되살리고, 즉시 완전삭제하는 권한.
 *
 * canEditCustomers와 같은 역할 집합이지만 별도 함수다 — 권한 트리에서
 * '고객사 정보 수정'과 '삭제·복원'은 따로 여닫히는 노드이고
 * (permission-features.ts의 customers.edit / customers.lifecycle),
 * 한 함수를 둘이 나눠 쓰면 한쪽만 좁히려는 순간 다른 쪽까지 함께 좁아진다.
 */
export function canDeleteCustomers(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}
