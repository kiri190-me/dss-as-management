/**
 * What to copy from the login portal onto the local account.
 *
 * The portal owns identity here — 실명 and 이메일 are entered and approved
 * there, once, for every system. Keeping a second copy that drifts is how a
 * user management screen ends up showing a name nobody recognizes.
 *
 * Email is safe to *display* from an unverified claim, and unsafe to *link*
 * by. Linking is done on `sso_subject` alone (see sso-login.ts); nothing in
 * this file decides who someone is, only what to label them.
 *
 * No "server-only": pure decision logic, unit-tested directly.
 */
export type SsoProfilePatch = {
  email?: string;
  name?: string;
};

export type CurrentProfile = {
  email: string;
  name: string;
};

/**
 * Emails are stored lowercase here (scripts/link-sso-subject.ts does the
 * same), so a portal admin typing "CHM@dss21.com" must not read as a change
 * on every single login.
 */
function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Returns only what actually differs — an empty object means "nothing to
 * write". The caller can then skip the UPDATE entirely, which is the common
 * case on every login after the first.
 *
 * A missing or blank claim is left alone rather than cleared. Both columns
 * are NOT NULL here, and "the portal did not say" is not the same as "the
 * portal said empty" — clearing a name on a silent claim would wipe real
 * data over an omission.
 */
export function decideSsoProfile(
  claims: { email?: unknown; name?: unknown },
  current: CurrentProfile
): SsoProfilePatch {
  const patch: SsoProfilePatch = {};

  if (typeof claims.email === "string") {
    const email = normalizeEmail(claims.email);
    if (email !== "" && email !== normalizeEmail(current.email)) {
      patch.email = email;
    }
  }

  if (typeof claims.name === "string") {
    const name = claims.name.trim();
    if (name !== "" && name !== current.name) {
      patch.name = name;
    }
  }

  return patch;
}
