import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { isHttpsRequest, isTrustedOrigin } from "@/lib/auth/request-guards";
import { getLoginMode } from "@/lib/config/login-mode";
import { getSsoEndSessionUrl } from "@/lib/config/sso";

// Mobile-LAN redirect fix — see login/route.ts's redirectTo doc comment
// for the confirmed root cause. A relative Location lets the browser
// resolve against its own current origin instead of request.url.
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

/**
 * Where to send the browser after this system's own cookie is cleared.
 *
 * Demo mode: this system's login screen. Nothing else is involved.
 *
 * SSO mode: the portal's end_session endpoint, and then wherever the portal
 * decides — deliberately without `post_logout_redirect_uri`.
 *
 * Ending the portal session is the point: clearing only the local cookie
 * leaves it alive, so 로그아웃 drops the user on a login button that walks
 * straight through a still-signed-in portal and returns them, logged in
 * again, without ever asking who they are. That reads as a broken logout —
 * and on a shared PC it is one.
 *
 * Coming back *here* afterwards is not the point. Sending
 * post_logout_redirect_uri would land them on this system's own login page,
 * which is one more screen saying "go to the portal" before the portal
 * screen that actually logs them in. Leaving it off puts them on the
 * portal's sign-in page directly, which is both one screen shorter and the
 * honest place to be: they just left every system, not only this one.
 * (The portal still supports the parameter — other systems may want it.)
 */
function logoutDestination(): string {
  if (getLoginMode() !== "sso") return "/login";
  return getSsoEndSessionUrl();
}

function expire(response: NextResponse, name: string, request: NextRequest) {
  response.cookies.set(name, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttpsRequest(request),
    path: "/",
    maxAge: 0,
  });
}

export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) {
    return NextResponse.json(
      { error: "요청 출처를 확인할 수 없습니다." },
      { status: 403 }
    );
  }

  const response = redirectTo(logoutDestination());
  expire(response, SESSION_COOKIE_NAME, request);
  return response;
}
