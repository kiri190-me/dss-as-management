import { NextResponse, type NextRequest } from "next/server";
import { mockUsers } from "@/lib/domain/mock-data";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth/session";
import { isHttpsRequest, isTrustedOrigin } from "@/lib/auth/request-guards";

// 데모 전용 로그인 라우트다. DEMO_LOGIN_ENABLED가 정확히 "true"일 때만
// 동작한다. 운영 환경에서는 절대 활성화해서는 안 되며, Kakao OAuth/회사
// 이메일 인증이 도입되면 이 라우트는 폐기된다.
function isDemoLoginEnabled(): boolean {
  return process.env.DEMO_LOGIN_ENABLED === "true";
}

export async function POST(request: NextRequest) {
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
  const userId = formData.get("userId");

  if (typeof userId !== "string") {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  const user = mockUsers.find((candidate) => candidate.id === userId);
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  const token = createSessionToken(user);
  const destination =
    user.approvalStatus === "APPROVED" ? "/dashboard" : "/pending-approval";

  const response = NextResponse.redirect(new URL(destination, request.url), 303);
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttpsRequest(request),
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
