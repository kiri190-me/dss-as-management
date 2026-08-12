import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { isHttpsRequest, isTrustedOrigin } from "@/lib/auth/request-guards";

// Mobile-LAN redirect fix — see login/route.ts's redirectTo doc comment
// for the confirmed root cause. A relative Location lets the browser
// resolve against its own current origin instead of request.url.
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) {
    return NextResponse.json(
      { error: "요청 출처를 확인할 수 없습니다." },
      { status: 403 }
    );
  }

  const response = redirectTo("/login");
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttpsRequest(request),
    path: "/",
    maxAge: 0,
  });
  return response;
}
