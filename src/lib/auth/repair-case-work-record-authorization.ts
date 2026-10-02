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
 *  - Edit (2026-10-02, canEditWorkRecord 아래): **작성자 본인만.** 이 자리에는
 *    예전에 "There is no edit authorization function at all" 이라고 적혀
 *    있었다 — 사용자 결정으로 작업 기록의 글과 기록 구분을 고칠 수 있게
 *    되면서 그 문장이 사실이 아니게 되었다.
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

export type EditWorkRecordContext = {
  /** 이 기록을 쓴 사람이 나인가. 거짓이면 어떤 역할도 고칠 수 없다. */
  isAuthor: boolean;
  /** 이 건의 담당 엔지니어가 나인가. AS_ENGINEER 에게만 붙는 조건이다. */
  isAssignedToCase: boolean;
  isCaseLocked: boolean;
};

/**
 * 작업 기록의 **글과 기록 구분**을 고칠 수 있는가(2026-10-02).
 *
 * 🔴 **작성자 본인이 아니면 누구도 못 고친다 — 관리자도.** 남이 쓴 작업 기록의
 * 글을 고치면 그 사람 이름으로 남아 있는 기록의 내용이 본인 모르게 바뀐다.
 * 관리자에게 열려 있는 길은 고치기가 아니라 **무효 처리**다
 * (canInvalidateWorkRecord — 원본을 그대로 두고 「무효」라고 표시한다).
 *
 * AS_ENGINEER 는 거기에 더해 자기 담당 건이어야 한다 — canCreateWorkRecord 와
 * 같은 조건이다(남길 수 없는 건의 기록을 고칠 수 있으면 앞뒤가 안 맞는다).
 * SUPER_ADMIN/ADMIN 은 본인이 쓴 것이면 담당 여부를 묻지 않는다(그쪽도
 * 남길 때 담당을 묻지 않는다).
 *
 * 🔴 **출하 잠금(ctx.isCaseLocked)은 보지 않는다.** 위 두 함수가 둘 다
 * `void ctx.isCaseLocked` 로 무시하는 것과 같게 맞춘 것이다 — 출하된 건에도
 * 작업 기록을 남길 수 있고 무효 처리도 되는데 오탈자 고치기만 막히면
 * 일관성이 없다(그 정책 변경의 전체 근거는 repair-case-edit-authorization.ts
 * 의 isBlockedByShipmentLock 주석에 있다). 맥락은 계속 받는다 — 부르는 쪽이
 * 전부 진짜 repair_cases.is_locked 값을 그대로 넘긴다.
 *
 * 🔴 권한 영역에서 고치기는 **WRITE** 로 본다(`repairCases.workRecords` 에
 * WRITE 이상) — manage(무효 처리)를 엔지니어에게 열지 않는다. 그래야 관리자가
 * 그 역할을 READ 로 낮추면 남기기와 고치기가 함께 막힌다. 그 짝은 mutation 과
 * 화면이 각각 hasPermission(…, "WRITE") 로 묻는다.
 */
export function canEditWorkRecord(role: Role, ctx: EditWorkRecordContext): boolean {
  void ctx.isCaseLocked;
  if (!ctx.isAuthor) return false;
  if (role === "SUPER_ADMIN" || role === "ADMIN") return true;
  if (role === "AS_ENGINEER") return ctx.isAssignedToCase;
  return false;
}
