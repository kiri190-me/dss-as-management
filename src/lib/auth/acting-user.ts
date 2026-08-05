import "server-only";
import { mockUsers } from "@/lib/domain/mock-data";
import { getUserById } from "@/lib/db/queries/users";
import { getAuthSource } from "@/lib/config/auth-source";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import type { SessionPayload } from "./session";

/**
 * Single source of truth for turning a verified session into the
 * ActingUser shape every repair-case page/action needs — source-aware
 * (AUTH_SOURCE), replacing what used to be 6 duplicated
 * mockUsers.find(session.userId) call sites.
 *
 * In "database" mode this re-reads the DB on every call (never cached off
 * the session token) so a deactivated/demoted/deleted account loses access
 * immediately rather than waiting out the token's 8-hour expiry. In "mock"
 * mode this preserves the exact prior lookup — local/mock behavior is
 * unchanged.
 */
export async function resolveActingUserForSession(
  session: SessionPayload
): Promise<ActingUser | null> {
  if (getAuthSource() === "database") {
    const row = await getUserById(session.userId);
    if (!row) {
      return null;
    }
    return { id: row.id, name: row.name, role: row.role, approvalStatus: row.approvalStatus };
  }

  const user = mockUsers.find((candidate) => candidate.id === session.userId);
  return user
    ? { id: user.id, name: user.name, role: user.role, approvalStatus: user.approvalStatus }
    : null;
}
