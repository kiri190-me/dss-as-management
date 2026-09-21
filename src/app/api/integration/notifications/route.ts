import { NextResponse, type NextRequest } from "next/server";
import {
  PORTAL_TOKEN_PURPOSES,
  readBearerToken,
  verifyPortalServiceToken,
} from "@/lib/auth/portal-service-token";
import { getAppBaseUrl } from "@/lib/config/sso";
import { getLoginMode } from "@/lib/config/login-mode";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getUserBySsoSubject } from "@/lib/db/queries/users";
import { listMyNotifications } from "@/lib/db/queries/notifications";
import { buildPortalNotificationFeed } from "@/lib/server/integration/portal-notifications";

/**
 * ============================================================================
 * 「이 사람의 지금 알림」을 밖으로 내주는 통로
 * ============================================================================
 * 통합 종이 쓴다 — 포털이 등록된 시스템마다 이 통로에 물어 합친다
 * (NOTIFICATION_AND_IDENTITY_DESIGN.md E절). 알림을 저장하지 않는 A/S 의 방식은
 * 그대로 두고, **매 요청마다 계산해 내주기만** 한다.
 *
 * 🔴 대상 사용자는 **토큰 안에서만** 온다. 쿼리 문자열을 읽지 않는다 — 읽으면
 * 토큰 하나로 아무 사람의 알림이나 볼 수 있는 문이 된다.
 *
 * 🔴 링크는 절대 주소로 바꿔 내보낸다. 기준 주소는 요청의 Host 가 아니라
 * 환경(SSO_REDIRECT_URI)에서 온다 — config/sso.ts 의 getAppBaseUrl 주석.
 *
 * GET 인 것은 읽기뿐이기 때문이고, 토큰을 쿼리가 아니라 `Authorization` 머리말로
 * 받는 것은 쿼리가 접근 로그에 그대로 남기 때문이다.
 * ============================================================================
 */

/** 이 응답이 캐시되면 처리된 일이 남의 종에 계속 남는다. */
const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: NextRequest) {
  // 데모 모드에서는 통합 로그인 자체를 쓰지 않는다 — 포털도, 포털의 서명도
  // 없다. 열어 둘 이유가 없다(백채널 로그아웃과 같은 판단).
  if (getLoginMode() !== "sso") {
    return NextResponse.json({ error: "not_enabled" }, { status: 404, headers: NO_STORE });
  }

  const verified = await verifyPortalServiceToken(
    readBearerToken(request.headers.get("authorization")),
    PORTAL_TOKEN_PURPOSES.notificationsRead
  );
  if (!verified.ok) {
    // 왜 거절했는지는 밖으로 내보내지 않는다 — 부르는 쪽이 맞혀 가며 두드릴
    // 실마리가 된다. 까닭은 서버 로그에 남는다(portal-service-token.ts).
    return NextResponse.json(
      { error: "invalid_token" },
      { status: 401, headers: { ...NO_STORE, "www-authenticate": "Bearer" } }
    );
  }

  // mock 읽기 모드에는 DB 가 없다 — 화면의 종도 그때는 빈 목록이다
  // ((app)/layout.tsx). 같은 규칙으로 답한다.
  if (getRepairCaseReadSource() !== "database") {
    return NextResponse.json({ items: [], count: 0 }, { headers: NO_STORE });
  }

  const feed = await buildPortalNotificationFeed({
    subject: verified.subject,
    baseUrl: getAppBaseUrl(),
    findActor: getUserBySsoSubject,
    listNotifications: listMyNotifications,
  });

  // 🔴 이 시스템에 계정이 없는 사람은 빈 목록이다 — 오류가 아니다(설계서 F-3).
  // 포털은 여러 시스템에 같은 질문을 던지고, A/S 에만 계정이 없는 사람은
  // 흔하다. 그 사람에게 오류를 돌려주면 포털의 종이 그 줄에서 빨갛게 된다.
  return NextResponse.json(feed, { headers: NO_STORE });
}
