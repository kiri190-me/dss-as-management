import "server-only";

/**
 * Server-only settings for talking to the DSS login portal (dss-auth).
 *
 * Read through functions rather than module-level constants so `next build`
 * succeeds without them present — they are only required once a request
 * actually takes the SSO path (LOGIN_MODE=sso). Missing values throw
 * clearly rather than falling back to a default: a login server that half
 * works is worse than one that refuses to start the flow.
 */
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} is not set. Define it in .env.local (see .env.example) before using LOGIN_MODE=sso.`
    );
  }
  return value;
}

/**
 * dss-auth's issuer URL. Must match the `iss` claim of every ID token it
 * signs, character for character — a trailing slash here and none there is
 * a mismatch, and one of the harder failures to diagnose. Stripped for that
 * reason.
 */
export function getSsoIssuer(): string {
  return required("SSO_ISSUER").replace(/\/+$/, "");
}

export function getSsoClientId(): string {
  return required("SSO_CLIENT_ID");
}

export function getSsoClientSecret(): string {
  return required("SSO_CLIENT_SECRET");
}

/**
 * Must equal the value registered with dss-auth exactly.
 *
 * Deliberately configured rather than derived from the incoming request: a
 * live `next dev` diagnostic on this codebase confirmed `request.url` can
 * report the server's own bind address (`http://localhost:3000`) for a
 * request a LAN client genuinely addressed to `http://192.168.1.132:3000`
 * (see the comment in api/auth/login/route.ts). redirect_uri is compared by
 * exact string match at both the authorize and token steps, so a derived
 * value that is right on one network and wrong on another would fail in a
 * way that looks intermittent.
 */
export function getSsoRedirectUri(): string {
  return required("SSO_REDIRECT_URI");
}

/**
 * Where to send the browser so the portal ends its own session too
 * (`end_session_endpoint` in dss-auth's discovery document).
 *
 * Built from the issuer rather than fetched from discovery, matching how the
 * callback route already builds the JWKS URL. Discovery is the right answer
 * for a team integrating from outside; inside this repo one more network
 * round trip on the logout path buys nothing, and a wrong path here fails
 * loudly and immediately rather than subtly.
 */
export function getSsoEndSessionUrl(): string {
  return `${getSsoIssuer()}/api/oidc/logout`;
}

/**
 * The portal's app launcher — where a person goes to reach the other
 * systems they have access to. Not a protocol endpoint.
 */
export function getSsoPortalUrl(): string {
  return `${getSsoIssuer()}/apps`;
}
