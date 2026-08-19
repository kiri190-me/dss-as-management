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

/**
 * 이 역할은 자기 담당 건에서만 기록을 남길 수 있는가.
 *
 * 권한 판정이 role_permissions 설정으로 넘어가면서 부르는 쪽이 "이 역할이
 * 기록을 남길 수 있는가"와 "이 건이 그 사람 담당인가"를 따로 물어야 한다.
 * 뒤엣것은 맥락만으로는 답이 안 나온다 — 관리자에게는 아예 붙지 않는 조건이라
 * 역할을 함께 봐야 한다. 그래서 순수 맥락 술어가 아니라 이 형태다.
 *
 * canCreateWorkRecord와 같은 규칙을 두 번 적지 않도록, 위 함수도 이 값과 같은
 * 뜻으로 읽히게 두었다(엔지니어만 ctx.isAssignedToCase를 본다).
 */
export function workRecordRequiresOwnAssignment(role: Role): boolean {
  return role === "AS_ENGINEER";
}

export type InvalidateWorkRecordContext = {
  isCaseLocked: boolean;
};

/** SUPER_ADMIN/ADMIN only — never AS_ENGINEER, regardless of authorship. */
export function canInvalidateWorkRecord(role: Role, ctx: InvalidateWorkRecordContext): boolean {
  void ctx.isCaseLocked;
  return role === "SUPER_ADMIN" || role === "ADMIN";
}
