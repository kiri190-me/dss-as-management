import "server-only";
import { applySsoIdentity, getUserBySsoSubject } from "@/lib/db/queries/users";
import type { Role } from "@/lib/domain/types";
import type { DbLoginResult } from "./db-login";
import { decideSsoProfile } from "./sso-profile";
import { decideSsoRole } from "./sso-role";

export type SsoLoginResultCode =
  | "NOT_PROVISIONED"
  | "ACCOUNT_LOCKED"
  | "ACCOUNT_DISABLED"
  | "DATABASE_UNAVAILABLE"
  /** The portal sent a role this system does not recognize — see sso-role.ts. */
  | "UNKNOWN_ROLE";

/**
 * Reuses db-login.ts's SESSION shape verbatim so the login route can hand
 * either result to the same downstream code (createSessionToken, cookie,
 * destination). Only the rejection codes differ.
 */
export type SsoLoginResult =
  | Extract<DbLoginResult, { outcome: "SESSION" }>
  | { outcome: "REJECTED"; code: SsoLoginResultCode };

/**
 * SSO login resolution: a verified DSS subject → local account → session, or
 * a rejection. Sits beside db-login.ts rather than modifying it, so the
 * tests pinned to resolveDbLogin's exact signature and rejection codes
 * (db-login.integration.test.ts, session-actor-e2e.integration.test.ts)
 * never need revisiting.
 *
 * **Never creates an account, and never links one.** Both are deliberate:
 *
 *  - No creation: dss-auth knows a person works here, but not what they
 *    should be allowed to do here. Role is this system's decision, so an
 *    account must already exist with a role assigned.
 *
 *  - No auto-linking by email: it would be convenient to match an unlinked
 *    local account by the email carried in the ID token, but that email is
 *    typed in by a dss-auth portal admin — it is not verified, and Kakao
 *    never supplied it. Honoring it would let a portal admin set someone's
 *    email to this system's SUPER_ADMIN address and inherit that account on
 *    first login. Being a portal admin already grants "who may reach which
 *    system"; it must not silently grant "which role you land as inside
 *    one". Linking is an explicit act here — see scripts/link-sso-subject.ts.
 *
 * A caller must have verified the ID token's signature, issuer, audience,
 * expiry, and nonce before calling this. The subject is trusted here.
 */
export async function resolveSsoLogin(
  subject: string,
  /**
   * The ID token's claims, verbatim and unvalidated. Typed unknown on
   * purpose — they arrive from a JWT payload, and the only places allowed to
   * decide what they mean are decideSsoRole and decideSsoProfile.
   */
  claims: { role?: unknown; email?: unknown; name?: unknown } = {}
): Promise<SsoLoginResult> {
  if (!subject) {
    return { outcome: "REJECTED", code: "NOT_PROVISIONED" };
  }

  let row;
  try {
    row = await getUserBySsoSubject(subject);
  } catch {
    return { outcome: "REJECTED", code: "DATABASE_UNAVAILABLE" };
  }

  if (!row) {
    return { outcome: "REJECTED", code: "NOT_PROVISIONED" };
  }
  if (row.lockedAt !== null) {
    return { outcome: "REJECTED", code: "ACCOUNT_LOCKED" };
  }
  if (!row.isActive) {
    return { outcome: "REJECTED", code: "ACCOUNT_DISABLED" };
  }

  // ── What the portal decided ──
  //
  // Applied before the session is built, because the session token carries
  // the role and the name: resolving them afterwards would hand out a session
  // stamped with the previous values and only take effect one login later.
  const roleDecision = decideSsoRole(claims.role);

  if (roleDecision.kind === "REJECT") {
    console.error(
      `[sso] 알 수 없는 역할이 왔습니다: ${JSON.stringify(roleDecision.received)} (subject ${subject})`
    );
    return { outcome: "REJECTED", code: "UNKNOWN_ROLE" };
  }

  const profile = decideSsoProfile(claims, { email: row.email, name: row.name });
  const patch: { role?: Role; email?: string; name?: string } = { ...profile };
  if (roleDecision.kind === "APPLY" && roleDecision.role !== row.role) {
    patch.role = roleDecision.role;
  }

  let applied = { role: row.role, name: row.name };
  if (patch.role !== undefined || patch.email !== undefined || patch.name !== undefined) {
    try {
      if (await applySsoIdentity(subject, row.id, patch)) {
        // Deliberately visible. A role change grants real permissions here,
        // and a name/email change is what the user management screen shows.
        console.info(`[sso] 포털 값을 반영합니다: ${row.name} ${JSON.stringify(patch)}`);
        applied = {
          role: patch.role ?? row.role,
          name: patch.name ?? row.name,
        };
      }
      // false means the row stopped matching between the read and the write
      // (deleted or unlinked mid-login). Falling through with what we read is
      // right: never report values the database does not hold.
    } catch (error) {
      // The likely cause is the unique index on email — the portal handed us
      // an address another local account already uses. That is a
      // configuration mistake, not a reason to lock someone out of the
      // system, so the login continues with the values already stored.
      console.error(
        `[sso] 포털 값을 반영하지 못했습니다(기존 값으로 계속합니다): ${JSON.stringify(patch)}`,
        error
      );
      if (patch.role !== undefined) {
        // Role is the half that matters for permissions — retry it alone, in
        // case only the email collided.
        try {
          if (await applySsoIdentity(subject, row.id, { role: patch.role })) {
            applied = { role: patch.role, name: row.name };
          }
        } catch {
          return { outcome: "REJECTED", code: "DATABASE_UNAVAILABLE" };
        }
      }
    }
  }

  // ACCOUNT_PENDING is deliberately not a rejection, matching db-login.ts: a
  // pending account still gets a session and is routed to /pending-approval
  // by the caller based on approvalStatus.
  return {
    outcome: "SESSION",
    user: {
      id: row.id,
      role: applied.role,
      approvalStatus: row.approvalStatus,
      name: applied.name,
    },
  };
}
