import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../client";
import { users } from "../schema";
import type { AccountApprovalStatus, Role } from "@/lib/domain/types";

export type UserRow = {
  id: string;
  email: string;
  name: string;
  role: Role;
  approvalStatus: AccountApprovalStatus;
  isActive: boolean;
  lockedAt: Date | null;
};

const SELECT_COLUMNS = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  approvalStatus: users.approvalStatus,
  isActive: users.isActive,
  lockedAt: users.lockedAt,
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Used by acting-user.ts to resolve a session's userId (a real users.id
 * UUID in database mode) back to display/role information on every
 * request. Excludes soft-deleted, deactivated, and locked rows — any of
 * those resolves to null, same as a nonexistent one, so a session survives
 * only as long as the account behind it stays deleted-free, active, and
 * unlocked (re-checked on every request, not just at login).
 *
 * A non-UUID-shaped id resolves to null before ever reaching the DB,
 * instead of letting Postgres throw "invalid input syntax for type uuid" —
 * a stale/forged/pre-migration session cookie could still carry a
 * mock-data-style id (e.g. "u-001"), and this must fail closed, not throw,
 * the same way parseSessionToken treats any malformed token as null.
 */
export async function getUserById(id: string): Promise<UserRow | null> {
  if (!UUID_PATTERN.test(id)) {
    return null;
  }
  const [row] = await db
    .select(SELECT_COLUMNS)
    .from(users)
    .where(and(eq(users.id, id), eq(users.isDeleted, false), eq(users.isActive, true), isNull(users.lockedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * Used only by db-login.ts at login time. Case-insensitive (company email
 * addresses are conventionally treated as such) — compares lower(email) on
 * both sides rather than relying on the caller having already normalized
 * case, so this stays correct even if a future caller forgets to.
 * Excludes soft-deleted rows — a deleted account behaves like a
 * nonexistent one at login (never distinguished, to avoid revealing it
 * once existed).
 */
export async function getUserForLoginByEmail(email: string): Promise<UserRow | null> {
  const [row] = await db
    .select(SELECT_COLUMNS)
    .from(users)
    .where(and(sql`lower(${users.email}) = lower(${email})`, eq(users.isDeleted, false)))
    .limit(1);
  return row ?? null;
}

export type LoginPickerUserRow = Pick<UserRow, "id" | "email" | "name" | "role" | "approvalStatus">;

/**
 * Used only by the demo login page in AUTH_SOURCE=database mode, to render
 * a picker of real accounts in place of the hardcoded mock-data list — same
 * no-password trust model as the existing mock demo login, just backed by
 * real rows. Excludes soft-deleted, deactivated, and locked accounts (those
 * should never be selectable, not merely rejected after the fact by
 * resolveDbLogin).
 */
export async function listUsersForLoginPicker(): Promise<LoginPickerUserRow[]> {
  return db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      approvalStatus: users.approvalStatus,
    })
    .from(users)
    .where(and(eq(users.isDeleted, false), eq(users.isActive, true), isNull(users.lockedAt)))
    .orderBy(users.name);
}


/**
 * Used only by sso-login.ts. Resolves a DSS subject (the ID token's `sub`,
 * which is dss-auth's own users.id) back to a local account.
 *
 * Deliberately keyed on sso_subject and never on email: a Kakao account
 * holder can change their email at any time, so it cannot anchor an
 * identity. Excludes soft-deleted rows — a deleted account behaves like a
 * nonexistent one at login, exactly as getUserForLoginByEmail does.
 */
export async function getUserBySsoSubject(subject: string): Promise<UserRow | null> {
  if (!subject) {
    return null;
  }
  const [row] = await db
    .select(SELECT_COLUMNS)
    .from(users)
    .where(and(eq(users.ssoSubject, subject), eq(users.isDeleted, false)))
    .limit(1);
  return row ?? null;
}

/**
 * One-time link of an existing local account to a DSS subject, used on a
 * user's first SSO login when their account predates SSO.
 *
 * The `sso_subject IS NULL` guard is the security-relevant part, not an
 * optimization: without it, anyone whose DSS profile carried a matching
 * email could re-point an account that is already linked to someone else,
 * taking it over. Conditional UPDATE makes that impossible at the database
 * level rather than relying on the caller to check first (which would race).
 *
 * Returns true only when this call performed the link.
 */
export async function linkUserToSsoSubject(userId: string, subject: string): Promise<boolean> {
  if (!UUID_PATTERN.test(userId) || !subject) {
    return false;
  }
  const linked = await db
    .update(users)
    .set({ ssoSubject: subject, ssoLinkedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(users.id, userId),
        isNull(users.ssoSubject),
        eq(users.isDeleted, false),
        eq(users.isActive, true)
      )
    )
    .returning({ id: users.id });
  return linked.length > 0;
}
