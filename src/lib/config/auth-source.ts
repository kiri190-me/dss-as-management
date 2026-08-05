import "server-only";

/**
 * Server-only feature flag controlling where login and session→user
 * resolution read accounts from. Never exposed to the client (no
 * NEXT_PUBLIC_ prefix, never logged) — same discipline as
 * REPAIR_CASE_READ_SOURCE/REPAIR_CASE_WRITE_SOURCE.
 *
 * Policy:
 *  - absent → defaults to "mock" (current default; matches today's only
 *    login path, DEMO_LOGIN_ENABLED, unchanged until this is opted in).
 *  - "mock" | "database" are the only accepted values.
 *  - anything else throws clearly — never silently falls back.
 *
 * In "database" mode, session.userId is always a real `users.id` UUID
 * (see resolveDbLogin / resolveActingUserForSession) — required by every
 * DB mutation that stamps an actor (e.g. status_change_histories.
 * actor_user_id, a NOT NULL FK to users.id).
 */
export const AUTH_SOURCES = ["mock", "database"] as const;
export type AuthSource = (typeof AUTH_SOURCES)[number];

export function getAuthSource(): AuthSource {
  const raw = process.env.AUTH_SOURCE;

  if (raw === undefined || raw === "") {
    return "mock";
  }

  if ((AUTH_SOURCES as readonly string[]).includes(raw)) {
    return raw as AuthSource;
  }

  // Not a secret (unlike DATABASE_URL/AUTH_SESSION_SECRET) — safe to
  // include the invalid value itself so the misconfiguration is easy to spot.
  throw new Error(`AUTH_SOURCE must be one of ${AUTH_SOURCES.join(" | ")}, got: "${raw}"`);
}
