import { NextResponse, type NextRequest } from "next/server";
import { mockUsers } from "@/lib/domain/mock-data";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth/session";
import { isHttpsRequest, isTrustedOrigin } from "@/lib/auth/request-guards";
import { getAuthSource } from "@/lib/config/auth-source";
import { getLoginMode } from "@/lib/config/login-mode";
import { resolveDbLogin } from "@/lib/auth/db-login";
import type { AccountApprovalStatus, Role } from "@/lib/domain/types";

// 데모 전용 로그인 라우트다. DEMO_LOGIN_ENABLED가 정확히 "true"일 때만
// 동작한다. 운영 환경에서는 절대 활성화해서는 안 되며, Kakao OAuth/회사
// 이메일 인증이 도입되면 이 라우트는 폐기된다.
function isDemoLoginEnabled(): boolean {
  return process.env.DEMO_LOGIN_ENABLED === "true";
}

/**
 * Mobile-LAN redirect fix — `NextResponse.redirect(new URL(path,
 * request.url), 303)` resolves `path` against `request.url`, which a live
 * `next dev` diagnostic confirmed can report the server's own bind
 * address (`http://localhost:3000`) even for a request a LAN client
 * genuinely addressed to `http://192.168.1.132:3000` (Host/
 * X-Forwarded-Host on that same request both correctly showed the real
 * LAN address — only request.url/nextUrl disagreed). That produced an
 * absolute `Location: http://localhost:3000/...` a phone cannot follow
 * (`localhost` there is the phone itself), even though login/logout
 * themselves succeeded. A relative Location header sidesteps the bug
 * entirely — per RFC 9110 the browser resolves a relative Location
 * against the request's own (correct) current origin, so this never
 * needs request.url/nextUrl, and works identically for localhost, any
 * LAN address, or a future real domain with no environment-specific code.
 */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

export async function POST(request: NextRequest) {
  // SSO 모드에서는 이 라우트가 살아 있으면 안 된다. DEMO_LOGIN_ENABLED가
  // 실수로 true로 남아 있어도 여기서 먼저 막힌다 — 통합 로그인을 우회하는
  // 경로를 설정이 아니라 코드로 봉인한다.
  if (getLoginMode() === "sso") {
    return NextResponse.json(
      { error: "통합 로그인만 사용할 수 있습니다." },
      { status: 403 }
    );
  }

  if (!isDemoLoginEnabled()) {
    return NextResponse.json(
      { error: "데모 로그인이 비활성화되어 있습니다." },
      { status: 403 }
    );
  }

  if (!isTrustedOrigin(request)) {
    return NextResponse.json(
      { error: "요청 출처를 확인할 수 없습니다." },
      { status: 403 }
    );
  }

  const formData = await request.formData();
  const authSource = getAuthSource();

  let sessionUser: { id: string; role: Role; approvalStatus: AccountApprovalStatus };

  if (authSource === "database") {
    const email = formData.get("email");
    if (typeof email !== "string") {
      return redirectTo("/login");
    }
    const loginResult = await resolveDbLogin(email);
    if (loginResult.outcome !== "SESSION") {
      return redirectTo("/login");
    }
    // loginResult.user.id is always a real users.id UUID here (never a
    // mock-data id) — see resolveDbLogin/db-login.integration.test.ts.
    sessionUser = loginResult.user;
  } else {
    const userId = formData.get("userId");
    if (typeof userId !== "string") {
      return redirectTo("/login");
    }
    const user = mockUsers.find((candidate) => candidate.id === userId);
    if (!user) {
      return redirectTo("/login");
    }
    sessionUser = user;
  }

  const token = createSessionToken(sessionUser);
  const destination =
    sessionUser.approvalStatus === "APPROVED" ? "/dashboard" : "/pending-approval";

  const response = redirectTo(destination);
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttpsRequest(request),
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
