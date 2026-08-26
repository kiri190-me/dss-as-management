import "server-only";

/**
 * Server-only feature flag controlling *how identity is proven* at login.
 *
 * Deliberately a separate axis from AUTH_SOURCE, which controls *where
 * accounts are read from* (mock/database). Turning SSO on does not change
 * that answer — accounts still come from PostgreSQL — so AUTH_SOURCE stays
 * "database".
 *
 * Why not just add "sso" to AUTH_SOURCE: 45+ call sites gate database
 * functionality on `getAuthSource() !== "database"` (every server action in
 * src/lib/server/actions/, twelve (app) pages, permission-resolver.ts,
 * acting-user.ts). A third value would make every one of them read "not
 * database" and silently close inventory, customers, procedures, and weekly
 * reports, while acting-user.ts fell through to the mock user list. This
 * axis leaves all of them untouched.
 *
 * Policy:
 *  - absent → defaults to "demo" (today's behavior, unchanged until opted in).
 *  - "demo" | "sso" are the only accepted values.
 *  - anything else throws clearly — never silently falls back.
 *
 * "sso" is only meaningful together with AUTH_SOURCE=database: a session
 * issued from a DSS subject must resolve to a real users.id UUID, which
 * mock accounts do not have.
 */
export const LOGIN_MODES = ["demo", "sso"] as const;
export type LoginMode = (typeof LOGIN_MODES)[number];

export function getLoginMode(): LoginMode {
  const raw = process.env.LOGIN_MODE;

  if (raw === undefined || raw === "") {
    return "demo";
  }

  if ((LOGIN_MODES as readonly string[]).includes(raw)) {
    return raw as LoginMode;
  }

  // Not a secret — safe to echo the invalid value so the misconfiguration
  // is easy to spot (same reasoning as auth-source.ts).
  throw new Error(`LOGIN_MODE must be one of ${LOGIN_MODES.join(" | ")}, got: "${raw}"`);
}
