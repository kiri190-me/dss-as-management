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
import { listApprovalHistoryForUser } from "@/lib/db/queries/approval-history";
import {
  buildPortalApprovalHistory,
  parseApprovalHistoryPeriod,
} from "@/lib/server/integration/portal-approval-history";

/**
 * ============================================================================
 * 「이 사람이 이 기간에 한 결재」를 밖으로 내주는 통로 — 통합 승인함이 쓴다
 * ============================================================================
 * 사용자 요구(2026-11-17): 「내가 했던 결재나 **나를 대신해서** 어떤 결재를 했는지도
 * 확인할 수 있도록 (특정 날짜 혹은 기간을 선택해서)」. 화면은 이 집에 없다 — 통합
 * 승인함 한 곳에 두고, 포털이 **세 집(A/S · 재고관리 · 휴가)에 같은 질문**을 던져
 * 한 목록으로 모은다. 응답의 모양과 판단은 전부
 * `server/integration/portal-approval-history.ts` 에 있고, 여기 남은 일은 「머리말에서
 * 토큰 꺼내 검증하고, 기간 읽고, 그 함수 부르기」뿐이다.
 *
 * 🔴 **틀은 옆의 승인함 통로(../approvals/route.ts)를 그대로 따른다.** 왜 그래야
 * 하는지는 그 파일과 알림 통로의 머리말에 다 적혀 있다 — 여기서는 같은 규칙을 다시
 * 못 박는다:
 *  · 대상 사용자는 **토큰 안에서만** 온다. 쿼리에서 사람을 읽지 않는다 — 읽는 순간
 *    토큰 하나로 **아무의 결재 내역이나** 보는 문이 된다.
 *  · 링크는 절대 주소다. 기준 주소는 요청의 Host 가 아니라 환경에서 온다
 *    (config/sso.ts 의 getAppBaseUrl — Host 머리말은 부르는 쪽이 적는다).
 *  · 응답을 캐시하지 않는다. 기간을 바꿔 다시 물으면 다시 세어야 한다.
 *  · GET 인 것은 읽기뿐이기 때문이고, 토큰을 쿼리가 아니라 `Authorization` 머리말로
 *    받는 것은 쿼리가 접근 로그에 그대로 남기 때문이다.
 *
 * ── 🔴 여기만 다른 것: **쿼리를 읽는다** ────────────────────────────────
 * 옆 통로 셋은 쿼리를 한 글자도 읽지 않는 것이 가장 중요한 울타리였다. 이 통로는
 * **기간**을 받아야 해서 쿼리를 읽는데, 그래도 울타리는 그대로다 — 읽는 자리가
 * `parseApprovalHistoryPeriod` 하나뿐이고 **그 함수가 돌려주는 것은 기간뿐**이다.
 * 사람이 흘러들 자리가 타입에 없다. `?sub=` 를 붙여 보내도 아무 일도 일어나지 않는다.
 *
 *     GET /api/integration/approval-history?from=<ISO8601>&to=<ISO8601>
 *     Authorization: Bearer <포털 서비스 토큰>
 *     → 200 { entries: [ … ] }
 *     → 400 { error: "invalid_period" }   기간이 없거나 못 읽는다
 *     → 401 { error: "invalid_token" }
 *
 * 🔴 **글자가 세 집에서 같아야 한다.** `invalid_period` 도, `entries` 도, 줄 안의 칸
 * 이름도 포털이 그대로 읽는다 — 한 글자 어긋나면 **그 집 것만 조용히 안 그려진다.**
 *
 * ── 🔴 토큰의 쓰임새는 아직 알림 읽기 그대로다 ──────────────────────────
 * `PORTAL_TOKEN_PURPOSES.notificationsRead` 를 요구한다. 쓰임새 글자는 포털과의
 * **약속**이라 `dss-auth` 가 그 값을 굽기 시작한 뒤에야 여기서 요구할 수 있고
 * (먼저 바꾸면 이 통로가 통째로 401 이 된다), 승인함 통로가 같은 까닭으로 같은 값을
 * 쓰고 있다. 그 통로를 `dss.approvals.read` 로 옮기는 날 이 줄도 함께 옮긴다.
 * 🔵 지금 상태가 새 자료를 여는 것은 아니다 — 내주는 것은 **그 사람 자신의** 결재
 * 행적이고, 대상은 같은 토큰의 `sub` 하나로만 정해진다.
 * ============================================================================
 */

/** 기간을 바꿔 다시 물었는데 옛 답이 돌아오면 안 된다. */
const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: NextRequest) {
  // 데모 모드에서는 통합 로그인 자체를 쓰지 않는다 — 포털도, 포털의 서명도 없다.
  // 열어 둘 이유가 없다(옆 통로 넷과 같은 판단).
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

  // 🔴 기간을 **직접 읽지 않는다.** 반열린 구간의 뜻과 「못 읽는 글자」의 판정이
  //    한 함수에 있고 단위 시험이 붙어 있다 — 라우트에서 다시 적으면 세 집이 같은
  //    글자를 다르게 읽게 된다.
  const period = parseApprovalHistoryPeriod(request.nextUrl.searchParams);
  if (!period.ok) {
    // 🔴 글자가 계약이다. 아래 읽기 모드 확인보다 **먼저** 보는 것은, 잘못 적은
    //    요청이 모드에 따라 400 이 되기도 하고 200 이 되기도 하면 부르는 쪽이
    //    제 실수를 영영 못 보기 때문이다.
    return NextResponse.json({ error: "invalid_period" }, { status: 400, headers: NO_STORE });
  }

  // mock 읽기 모드에는 DB 가 없다 — 그때는 결재 자체가 없다. 옆 통로 둘과 같은
  // 규칙으로 답한다(빈 목록이지 오류가 아니다).
  if (getRepairCaseReadSource() !== "database") {
    return NextResponse.json({ entries: [] }, { headers: NO_STORE });
  }

  const history = await buildPortalApprovalHistory({
    subject: verified.subject,
    baseUrl: getAppBaseUrl(),
    period: period.period,
    // 🔴 포털 `sub` → A/S `users.id` 변환은 옆 통로 둘이 쓰는 그 조회 하나다.
    //    못 찾는 것은 정상이고(다른 집에만 계정이 있는 사람), 그때의 답이
    //    **빈 목록**인 까닭은 buildPortalApprovalHistory 의 그 절에 적혀 있다.
    findActor: getUserBySsoSubject,
    // 🔴 「무엇이 내 내역인가」를 새로 짓지 않는다 — 조각 10a 가 만들고 DB 시험으로
    //    못 박아 둔 조회를 그대로 넘긴다(표 둘 · 갈래 셋을 한 목록으로 합치는 자리도
    //    거기 하나다).
    listHistory: listApprovalHistoryForUser,
  });

  return NextResponse.json(history, { headers: NO_STORE });
}
