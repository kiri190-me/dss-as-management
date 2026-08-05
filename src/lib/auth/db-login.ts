import "server-only";
import { getUserForLoginByEmail } from "@/lib/db/queries/users";
import type { AccountApprovalStatus, Role } from "@/lib/domain/types";

export type DbLoginResultCode = "ACCOUNT_LOCKED" | "ACCOUNT_DISABLED" | "INVALID_CREDENTIALS" | "DATABASE_UNAVAILABLE";

export type DbLoginResult =
  | { outcome: "SESSION"; user: { id: string; role: Role; approvalStatus: AccountApprovalStatus; name: string } }
  | { outcome: "REJECTED"; code: DbLoginResultCode };

/**
 * Database-mode login resolution: submitted email → normalize → query
 * PostgreSQL users → account-state checks → session-worthy user, or a
 * rejection. Never creates a user (no self-registration requirement
 * exists). Never trusts a client-supplied role or id — both always come
 * from the DB row.
 *
 * Deliberately does NOT distinguish "email not found" from "account
 * locked/disabled" in what gets shown to the browser (see the login route,
 * which maps every REJECTED code except DATABASE_UNAVAILABLE to the same
 * generic message) — this function still returns the specific code so
 * callers/tests/logs can tell them apart, but revealing that distinction
 * to an anonymous caller would itself be an account-existence oracle.
 * ACCOUNT_PENDING is deliberately not a REJECTED code here — a pending
 * account still gets a session (existing pending-approval UX, unchanged by
 * this task), it's just routed to /pending-approval instead of /dashboard
 * by the caller based on `user.approvalStatus`.
 */
export async function resolveDbLogin(rawEmail: string): Promise<DbLoginResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { outcome: "REJECTED", code: "INVALID_CREDENTIALS" };
  }

  let row;
  try {
    row = await getUserForLoginByEmail(email);
  } catch {
    return { outcome: "REJECTED", code: "DATABASE_UNAVAILABLE" };
  }

  if (!row) {
    return { outcome: "REJECTED", code: "INVALID_CREDENTIALS" };
  }
  if (row.lockedAt !== null) {
    return { outcome: "REJECTED", code: "ACCOUNT_LOCKED" };
  }
  if (!row.isActive) {
    return { outcome: "REJECTED", code: "ACCOUNT_DISABLED" };
  }

  return {
    outcome: "SESSION",
    user: { id: row.id, role: row.role, approvalStatus: row.approvalStatus, name: row.name },
  };
}
