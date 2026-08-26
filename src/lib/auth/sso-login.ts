import "server-only";
import { getUserBySsoSubject } from "@/lib/db/queries/users";
import type { DbLoginResult } from "./db-login";

export type SsoLoginResultCode =
  | "NOT_PROVISIONED"
  | "ACCOUNT_LOCKED"
  | "ACCOUNT_DISABLED"
  | "DATABASE_UNAVAILABLE";

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
export async function resolveSsoLogin(subject: string): Promise<SsoLoginResult> {
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

  // ACCOUNT_PENDING is deliberately not a rejection, matching db-login.ts: a
  // pending account still gets a session and is routed to /pending-approval
  // by the caller based on approvalStatus.
  return {
    outcome: "SESSION",
    user: {
      id: row.id,
      role: row.role,
      approvalStatus: row.approvalStatus,
      name: row.name,
    },
  };
}
