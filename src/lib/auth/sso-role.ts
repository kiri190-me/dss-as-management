import { ROLE_CODES, type Role } from "@/lib/domain/types";

/**
 * What to do with the `role` claim the login portal put in the ID token.
 *
 * The portal is authoritative for roles here: whatever it sends replaces
 * this system's `users.role` on every SSO login. That is a deliberate
 * choice, and it means the portal admin can hand out SUPER_ADMIN. The one
 * thing this module refuses to do is *guess* — a value this system does not
 * recognize never becomes a role.
 *
 * No "server-only": pure decision logic, unit-tested directly.
 */
export type SsoRoleDecision =
  /** No claim. The portal is not managing this account's role — leave it. */
  | { kind: "KEEP" }
  /** A role this system knows. Becomes the account's role. */
  | { kind: "APPLY"; role: Role }
  /** Something we do not recognize. The login is refused. */
  | { kind: "REJECT"; received: string };

/**
 * Absent claim is KEEP, not REJECT.
 *
 * A grant can legitimately carry no role: the portal predates roles, or the
 * client does not use them. Refusing those logins would break every account
 * granted before roles existed. "The portal said nothing" and "the portal
 * said something wrong" are different, and only the second is an error.
 *
 * An unrecognized value is REJECT, not KEEP.
 *
 * Keeping the old role would fail open — an admin who typed the role wrong
 * while *demoting* someone would leave them at their old, higher role and
 * see no sign of it. Refusing the login affects only the accounts whose role
 * is misconfigured, surfaces the mistake immediately, and leaves every other
 * account able to sign in and fix it.
 */
export function decideSsoRole(claim: unknown): SsoRoleDecision {
  if (claim === undefined || claim === null) {
    return { kind: "KEEP" };
  }

  if (typeof claim !== "string") {
    // A non-string role is a protocol error, not a naming mismatch.
    return { kind: "REJECT", received: typeof claim };
  }

  if ((ROLE_CODES as readonly string[]).includes(claim)) {
    return { kind: "APPLY", role: claim as Role };
  }

  return { kind: "REJECT", received: claim };
}
