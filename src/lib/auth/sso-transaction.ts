/**
 * The values that must survive the round trip to the DSS login portal and
 * back, plus the cookie that carries them.
 *
 * Kept here rather than in either route file: both routes need them, and
 * importing non-route exports out of a route module is a habit worth
 * avoiding — route files are analyzed for their HTTP handlers.
 *
 * No "server-only" marker: this file holds a type and two constants, no
 * secrets and no server APIs.
 */
export const SSO_TX_COOKIE_NAME = "dss_sso_tx";

/**
 * Ten minutes. Long enough to hesitate on the Kakao consent screen, short
 * enough that an abandoned attempt stops being usable quickly.
 */
export const SSO_TX_MAX_AGE_SECONDS = 600;

export type SsoTransaction = {
  /** Guards against a login response for someone else landing here. */
  state: string;
  /** Guards against an old ID token being replayed. */
  nonce: string;
  /** PKCE: never leaves this server, so an intercepted code is unusable. */
  codeVerifier: string;
  /** Unix seconds. Checked on the way back — the cookie's own Max-Age is a browser courtesy, not a guarantee. */
  expiresAt: number;
};
