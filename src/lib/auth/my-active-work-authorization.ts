import type { Role } from "@/lib/domain/types";

/**
 * Centralized, server-side authorization for the "내 담당 제품" / My Active
 * Work screen (Phase 5C-3). Same convention as
 * repair-case-work-record-authorization.ts: a pure function of `Role`, used
 * both by navigation.ts (UX convenience — which nav items render) and
 * independently re-checked by the route itself
 * (repair-cases/mine/page.tsx) — hiding the nav item is never the
 * enforcement boundary on its own.
 *
 * Policy (final, per Phase 5C-3 approval): AS_ENGINEER only. This is
 * deliberately narrower than every other gated feature in this codebase —
 * ADMIN/SUPER_ADMIN are excluded, not just unprivileged for extra actions,
 * because "내 담당 제품" means "assigned to me personally," and
 * ADMIN/SUPER_ADMIN accounts are essentially never the value stored in
 * repair_cases.assigned_engineer_id. A cross-engineer supervisory view is a
 * deliberately separate, later feature — this predicate must not be
 * loosened to accommodate it.
 */
export function canViewMyActiveWork(role: Role): boolean {
  return role === "AS_ENGINEER";
}
