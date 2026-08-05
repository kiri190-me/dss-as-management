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
 * request. Excludes soft-deleted rows — a deleted user resolves to null,
 * same as a nonexistent one.
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
    .where(and(eq(users.id, id), eq(users.isDeleted, false)))
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
 * UI hint only (whether to show the FINAL_SHIPMENT decide buttons at all)
 * — never the enforcement boundary. decideRepairCaseApproval() (mutation
 * layer) independently re-reads this same flag from the DB before allowing
 * a FINAL_SHIPMENT decision, exactly like every other server-re-checks-what-
 * the-UI-hid pattern in this codebase.
 */
export async function isUserShipmentRepresentative(id: string): Promise<boolean> {
  if (!UUID_PATTERN.test(id)) {
    return false;
  }
  const [row] = await db
    .select({ isShipmentRepresentative: users.isShipmentRepresentative })
    .from(users)
    .where(and(eq(users.id, id), eq(users.isDeleted, false)))
    .limit(1);
  return row?.isShipmentRepresentative ?? false;
}
