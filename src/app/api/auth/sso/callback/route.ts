import { NextResponse, type NextRequest } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { isHttpsRequest } from "@/lib/auth/request-guards";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth/session";
import { resolveSsoLogin } from "@/lib/auth/sso-login";
import { verifyToken } from "@/lib/auth/token";
import { getLoginMode } from "@/lib/config/login-mode";
import {
  getSsoClientId,
  getSsoClientSecret,
  getSsoIssuer,
  getSsoRedirectUri,
} from "@/lib/config/sso";
import {
  SSO_TX_COOKIE_NAME,
  type SsoTransaction,
} from "@/lib/auth/sso-transaction";

/**
 * Relative Location, for the same reason api/auth/login/route.ts uses one:
 * `next dev` can report request.url as the server's own bind address for a
 * request a LAN client addressed to its real IP, producing an absolute
 * Location a phone cannot follow. Per RFC 9110 the browser resolves a
 * relative Location against the request's own (correct) origin.
 */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

/**
 * Created once and reused: jose handles JWKS caching, key rollover, and
 * re-fetch cooldown internally. Building it per request would hammer the
 * login server and defeat that caching.
 *
 * Lazy rather than module-level so importing this route during `next build`
 * does not require SSO_ISSUER to be set.
 */
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;
function jwks() {
  jwksCache ??= createRemoteJWKSet(
    new URL(`${getSsoIssuer()}/.well-known/jwks.json`)
  );
  return jwksCache;
}

function clearTransaction(response: NextResponse, request: NextRequest): NextResponse {
  response.cookies.set(SSO_TX_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttpsRequest(request),
    path: "/api/auth/sso",
    maxAge: 0,
  });
  return response;
}

function isTransaction(value: unknown): value is SsoTransaction {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.state === "string" &&
    typeof candidate.nonce === "string" &&
    typeof candidate.codeVerifier === "string" &&
    typeof candidate.expiresAt === "number"
  );
}

/**
 * Where dss-auth sends the browser back to.
 *
 * Everything a caller could tamper with is checked before any account is
 * touched: the transaction cookie's signature, its expiry, the state match,
 * and then the ID token's signature, issuer, audience, expiry, and nonce.
 * Only after all of that is the subject trusted and handed to
 * resolveSsoLogin.
 *
 * Session issuance itself is unchanged — createSessionToken and the
 * dss_session cookie are exactly what demo mode already used. The only
 * thing this route replaces is the evidence behind the session.
 */
export async function GET(request: NextRequest) {
  if (getLoginMode() !== "sso") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SESSION_SECRET이 설정되지 않았습니다. .env.local을 확인하세요."
    );
  }

  const fail = (reason: string) =>
    clearTransaction(redirectTo(`/login?error=${encodeURIComponent(reason)}`), request);

  const params = request.nextUrl.searchParams;

  // dss-auth reports its own failures this way (access_denied, invalid_scope…).
  const upstreamError = params.get("error");
  if (upstreamError) {
    console.error("[sso] 로그인 포털이 요청을 거절했습니다:", upstreamError);
    return fail("sso");
  }

  const rawTransaction = request.cookies.get(SSO_TX_COOKIE_NAME)?.value;
  const decoded = rawTransaction ? verifyToken(rawTransaction, secret) : null;
  if (!isTransaction(decoded)) {
    return fail("expired");
  }
  if (decoded.expiresAt <= Math.floor(Date.now() / 1000)) {
    return fail("expired");
  }

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state || state !== decoded.state) {
    return fail("state");
  }

  // ── Exchange the code (server to server; the secret never reaches a browser) ──

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(`${getSsoIssuer()}/api/oidc/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        // Must match the authorize request character for character.
        redirect_uri: getSsoRedirectUri(),
        code_verifier: decoded.codeVerifier,
        client_id: getSsoClientId(),
        client_secret: getSsoClientSecret(),
      }),
      cache: "no-store",
    });
  } catch (error) {
    console.error("[sso] 로그인 포털에 연결할 수 없습니다:", error);
    return fail("sso");
  }

  if (!tokenResponse.ok) {
    // Logged, never shown: the portal's error body can describe internal
    // configuration.
    console.error("[sso] 토큰 교환 거절:", tokenResponse.status);
    return fail("sso");
  }

  const body = (await tokenResponse.json()) as { id_token?: unknown };
  if (typeof body.id_token !== "string") {
    console.error("[sso] 응답에 id_token이 없습니다.");
    return fail("sso");
  }

  // ── Verify the ID token ──

  let subject: string;
  // Read from the same verified payload as `sub`, so they carry the same
  // signature / issuer / audience guarantees. Kept as unknown on purpose —
  // sso-role.ts and sso-profile.ts are the only places allowed to decide what
  // these values mean.
  let profileClaims: { role?: unknown; email?: unknown; name?: unknown } = {};
  try {
    const { payload } = await jwtVerify(body.id_token, jwks(), {
      issuer: getSsoIssuer(),
      audience: getSsoClientId(),
      // Absorbs a few seconds of clock drift between this host and the
      // portal. Beyond that the clock needs fixing, not accommodating.
      clockTolerance: 30,
    });

    // jwtVerify checks signature, iss, aud, and exp — not nonce. Skipping
    // this leaves ID token replay open.
    if (payload.nonce !== decoded.nonce) {
      console.error("[sso] nonce가 일치하지 않습니다.");
      return fail("sso");
    }
    if (typeof payload.sub !== "string" || payload.sub === "") {
      console.error("[sso] id_token에 sub가 없습니다.");
      return fail("sso");
    }
    subject = payload.sub;
    profileClaims = {
      role: payload.role,
      email: payload.email,
      name: payload.name,
    };
  } catch (error) {
    console.error("[sso] id_token 검증 실패:", error);
    return fail("sso");
  }

  // ── Resolve to a local account ──

  const result = await resolveSsoLogin(subject, profileClaims);
  if (result.outcome !== "SESSION") {
    // 이 네 가지만 따로 알린다. 공통점은 **사람에게 다음 행동이 실제로
    // 있다**는 것이다(포털 설정을 고치거나, 관리자에게 그 사실을 전하거나).
    // 나머지는 일반 실패로 뭉뚱그린다 — 자세히 알려주면 이 화면이 "누가 이
    // 시스템 사용자인지" 확인해 주는 조회 도구가 된다.
    const SPOKEN: Partial<Record<typeof result.code, string>> = {
      UNKNOWN_ROLE: "unknown_role",
      // 포털에서 권한을 주며 역할을 지정하지 않은 경우. 계정을 자동으로
      // 만들려 해도 이 시스템의 역할은 전부 실질적인 쓰기 권한이라
      // 임의로 정하지 않는다(sso-provision.ts).
      PORTAL_ROLE_MISSING: "portal_role_missing",
      PORTAL_EMAIL_MISSING: "portal_email_missing",
      // 같은 이메일을 쓰는 계정이 이미 있다. 주워가지 않는 것이 이 설계의
      // 핵심이라, 사람이 sso:link로 명시적으로 잇게 한다.
      EMAIL_TAKEN: "email_taken",
      NOT_PROVISIONED: "not_provisioned",
    };

    const spoken = SPOKEN[result.code];
    if (spoken) {
      // resolveSsoLogin이 이미 사유와 다음 명령을 로그에 남겼다.
      console.warn(`[sso] 로그인 거절(${result.code}): subject ${subject}`);
      return fail(spoken);
    }
    console.warn("[sso] 로그인 거절:", result.code);
    return fail("sso");
  }

  const destination =
    result.user.approvalStatus === "APPROVED" ? "/dashboard" : "/pending-approval";

  const response = clearTransaction(redirectTo(destination), request);
  response.cookies.set(SESSION_COOKIE_NAME, createSessionToken(result.user), {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttpsRequest(request),
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
