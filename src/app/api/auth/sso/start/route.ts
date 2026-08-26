import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isHttpsRequest } from "@/lib/auth/request-guards";
import { signPayload } from "@/lib/auth/token";
import { getLoginMode } from "@/lib/config/login-mode";
import {
  getSsoClientId,
  getSsoIssuer,
  getSsoRedirectUri,
} from "@/lib/config/sso";
import {
  SSO_TX_COOKIE_NAME,
  SSO_TX_MAX_AGE_SECONDS,
  type SsoTransaction,
} from "@/lib/auth/sso-transaction";


/**
 * Starts the SSO login round trip.
 *
 * Three values are generated here, each closing a different hole:
 *   state         — login CSRF (someone else's login response landing in
 *                   this browser and signing it in as them)
 *   nonce         — ID token replay (an old, still-valid token re-presented)
 *   code_verifier — authorization code interception (PKCE: the code alone
 *                   is useless without the verifier that never left here)
 *
 * They are signed into a cookie with the same HMAC helper the session
 * cookie uses (auth/token.ts) rather than a new mechanism — the signature
 * is what stops the browser from editing code_verifier to defeat PKCE, and
 * this codebase already has exactly one audited way to sign a payload.
 */
export async function GET(request: NextRequest) {
  // Not an error worth explaining: in demo mode this route simply does not
  // exist as far as callers are concerned.
  if (getLoginMode() !== "sso") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SESSION_SECRET이 설정되지 않았습니다. .env.local을 확인하세요."
    );
  }

  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  // 64 bytes → 86 base64url characters, inside RFC 7636's 43–128 range.
  const codeVerifier = randomBytes(64).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier, "ascii")
    .digest("base64url");

  const transaction: SsoTransaction = {
    state,
    nonce,
    codeVerifier,
    expiresAt: Math.floor(Date.now() / 1000) + SSO_TX_MAX_AGE_SECONDS,
  };

  const authorizeUrl = new URL(`${getSsoIssuer()}/api/oidc/authorize`);
  authorizeUrl.search = new URLSearchParams({
    client_id: getSsoClientId(),
    redirect_uri: getSsoRedirectUri(),
    response_type: "code",
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  }).toString();

  const response = NextResponse.redirect(authorizeUrl, 302);
  response.cookies.set(SSO_TX_COOKIE_NAME, signPayload(transaction, secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttpsRequest(request),
    path: "/api/auth/sso",
    maxAge: SSO_TX_MAX_AGE_SECONDS,
  });
  return response;
}
