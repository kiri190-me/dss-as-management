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
import { listRepairCasesPendingMyApproval } from "@/lib/db/queries/repair-case-approvals-pending";
import { listQuoteApprovalsPendingMyApproval } from "@/lib/db/queries/quote-approvals-pending";
import { buildPortalApprovalInbox } from "@/lib/server/integration/portal-approvals";

/**
 * ============================================================================
 * 「이 사람이 결재할 건」을 밖으로 내주는 통로 — 통합 승인함이 쓴다
 * ============================================================================
 * 열째 사이트 `dss-approvals` 가 사내 시스템마다 이 통로에 물어 한 창에 모은다.
 * 응답의 모양과 판단은 전부 server/integration/portal-approvals.ts 에 있고,
 * 여기 남은 일은 「머리말에서 토큰 꺼내 검증하고 그 함수 부르기」뿐이다.
 *
 * 🔴 **틀은 알림 통로(../notifications/route.ts)를 그대로 따른다.** 왜 그래야
 * 하는지는 그 파일의 주석에 다 적혀 있다 — 여기서는 같은 규칙을 다시 못 박는
 * 것뿐이다:
 *  · 대상 사용자는 **토큰 안에서만** 온다. 쿼리 문자열을 읽지 않는다 — 읽으면
 *    토큰 하나로 **아무의 결재함이나** 볼 수 있는 문이 된다.
 *  · 링크는 절대 주소다. 기준 주소는 요청의 Host 가 아니라 환경에서 온다
 *    (config/sso.ts 의 getAppBaseUrl — Host 머리말은 부르는 쪽이 적는다).
 *  · 응답을 캐시하지 않는다. 처리된 결재가 남의 승인함에 계속 남으면 안 된다.
 *  · GET 인 것은 읽기뿐이기 때문이고, 토큰을 쿼리가 아니라 `Authorization`
 *    머리말로 받는 것은 쿼리가 접근 로그에 그대로 남기 때문이다.
 *
 * 🔴 **승인·반려를 실행하는 길은 여기 없다.** 이 통로는 읽기 전용이고,
 * [승인하기] 는 `href` 가 가리키는 A/S 화면으로 **건너가기만** 한다(2026-10-23
 * 사용자 결정). 그래서 이 파일에 POST 가 없다.
 *
 * ── 🔴 토큰의 쓰임새는 아직 알림 읽기 그대로다 ──────────────────────────
 * `PORTAL_TOKEN_PURPOSES.notificationsRead` 를 요구한다. 「결재할 건」은 종과
 * 다른 것이라 쓰임새를 따로 두는 편이 최소 권한에 맞지만, 쓰임새 글자는 포털과의
 * **약속**이라 `dss-auth` 가 그 값을 굽기 시작한 뒤에야 여기서 요구할 수 있다
 * (먼저 바꾸면 승인함이 통째로 401 이 된다). 그래서 지금은 기존 쓰임새로 두고,
 * 양쪽을 함께 고치는 날 `dss.approvals.read` 로 옮긴다.
 * 🔵 지금 상태가 새 자료를 여는 것은 아니다 — 이 통로가 내주는 결재는 종이 이미
 * 같은 토큰으로 내주던 그 사람 자신의 건이고, 자격 판정도 같은 조회 둘이 한다.
 * ============================================================================
 */

/** 이 응답이 캐시되면 처리된 결재가 남의 승인함에 계속 남는다. */
const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: NextRequest) {
  // 데모 모드에서는 통합 로그인 자체를 쓰지 않는다 — 포털도, 포털의 서명도
  // 없다. 열어 둘 이유가 없다(알림 통로와 같은 판단).
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

  // mock 읽기 모드에는 DB 가 없다 — 그때는 화면의 결재 목록도 비어 있다.
  // 알림 통로와 같은 규칙으로 답한다.
  if (getRepairCaseReadSource() !== "database") {
    return NextResponse.json({ items: [], count: 0 }, { headers: NO_STORE });
  }

  const inbox = await buildPortalApprovalInbox({
    subject: verified.subject,
    baseUrl: getAppBaseUrl(),
    findActor: getUserBySsoSubject,
    // 🔴 자격 판정을 새로 짓지 않는다 — 사이드바 배지 · 종이 이미 쓰고 통합
    // 시험으로 못 박아 둔 조회 둘을 그대로 넘긴다. 견적서 쪽은 A/S 와 PO 가 같은
    // 표를 보므로 **이 통로가 유일한 입구**다(portal-approvals.ts 의 그 주석).
    listRepairCaseApprovals: listRepairCasesPendingMyApproval,
    listQuoteApprovals: listQuoteApprovalsPendingMyApproval,
  });

  // 🔴 이 시스템에 계정이 없는 사람은 빈 목록이다 — 오류가 아니다(설계서 F-3).
  // 포털은 여러 시스템에 같은 질문을 던지고, A/S 에만 계정이 없는 사람은 흔하다.
  return NextResponse.json(inbox, { headers: NO_STORE });
}
