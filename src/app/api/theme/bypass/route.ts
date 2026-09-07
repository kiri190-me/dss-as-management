import { NextResponse, type NextRequest } from "next/server";
import {
  UI_THEME_BYPASS_COOKIE,
  UI_THEME_BYPASS_MAX_AGE_SECONDS,
  UI_THEME_BYPASS_VALUE,
} from "@/lib/domain/ui-theme-tokens";

/**
 * ============================================================================
 * 화면 토큰 우회 — 화면이 안 보이게 됐을 때의 탈출구
 * ============================================================================
 * 주소창에 `/api/theme/bypass` 를 치면 이 브라우저만 하루 동안 오버라이드를
 * 무시하고, `/api/theme/bypass?off=1` 이면 다시 따른다. 둘 다 끝나면
 * /settings/developer 로 보낸다.
 *
 * ── 왜 "주소창에 치는 것만으로" 동작해야 하는가 ─────────────────────────
 * 이것이 필요해지는 순간은 정의상 **화면이 안 보이는 순간**이다. 단추를
 * 눌러야 한다면 그 단추가 있는 화면을 먼저 볼 수 있어야 하는데, 그럴 수
 * 있었다면 애초에 이 탈출구가 필요 없다. GET 하나로 끝나는 것이 요점이다.
 *
 * ── 🔴 인가를 걸지 않는다 — 로그인 여부조차 보지 않는다 ─────────────────
 * 이 저장소의 다른 라우트와 정반대라서 이유를 적어 둔다.
 *
 *  ① 바꾸는 것이 **자기 브라우저 하나뿐**이다. 저장된 값(ui_theme_tokens)을
 *     건드리지 않고, 남의 화면에도 영향이 없다. 쓰기가 아니라 "내 브라우저가
 *     무엇을 무시할지"의 선언이다.
 *  ② "화면이 안 보인다"는 최고관리자만 겪는 일이 아니다. 잘못된 값 하나면 전
 *     직원이 동시에 겪고, **로그인 화면 자체가 안 보일 수 있다** — 루트
 *     레이아웃이 로그인 화면 위에도 있기 때문이다. 로그인을 요구하면 로그인할
 *     수 없어서 못 고치는 상태가 만들어진다.
 *  ③ 공격자가 이걸로 할 수 있는 최대치는 "당신 브라우저가 테마 오버라이드를
 *     하루 무시한다"이고, 그 상태는 이 기능이 없던 때의 화면과 똑같다. 얻을
 *     것도 잃을 것도 없다 — 그래서 CSRF 가드(isTrustedOrigin)도 걸지 않는다.
 *     남이 몰래 걸어 봐야 상대는 기본 팔레트를 보게 될 뿐이다.
 *  ④ 24시간 뒤 저절로 풀린다(UI_THEME_BYPASS_MAX_AGE_SECONDS). 우회 상태에
 *     영영 갇히는 사람이 안 생기고, 끄는 길(?off=1)도 따로 있다.
 * ============================================================================
 */

// 쿠키를 읽고 굽는 라우트다. 어떤 형태로도 캐시되면 안 된다 — 캐시된 응답이
// 돌아오면 Set-Cookie가 함께 사라져 우회가 걸리지 않는다.
export const dynamic = "force-dynamic";

/** 우회를 끝낸 사람이 돌아갈 곳. 개발자 설정 화면에 이 축이 모여 있다. */
const RETURN_PATH = "/settings/developer";

export async function GET(request: NextRequest) {
  // 상대 경로 Location — api/auth/logout·login의 redirectTo와 같은 이유다.
  // 절대 URL(request.url 기준)로 보내면 모바일이 사내망 IP로 들어왔을 때
  // 서버가 아는 호스트로 튕겨 나간다.
  const response = new NextResponse(null, {
    status: 302,
    headers: { Location: RETURN_PATH },
  });

  const turningOff = request.nextUrl.searchParams.get("off") === "1";

  response.cookies.set(UI_THEME_BYPASS_COOKIE, turningOff ? "" : UI_THEME_BYPASS_VALUE, {
    // 이 쿠키를 읽는 것은 서버(app/layout.tsx)뿐이다. 화면 쪽 스크립트가 읽을
    // 일이 없으므로 문서 자바스크립트에서 아예 안 보이게 둔다.
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // 🔴 secure를 켜지 않는다. 지금 사내망은 HTTP라, 켜면 쿠키가 아예 저장되지
    // 않아 탈출구가 조용히 작동하지 않는다 — 그것도 하필 화면이 안 보이는
    // 순간에. 세션 쿠키(api/auth/logout)는 isHttpsRequest(request)로 요청마다
    // 판정하는데, 여기는 담긴 것이 비밀이 아니라 "무시하라"는 표시 하나뿐이라
    // 가로채여도 잃을 것이 없다. HTTPS가 붙는 날 세션 쿠키와 함께 본다.
    maxAge: turningOff ? 0 : UI_THEME_BYPASS_MAX_AGE_SECONDS,
  });

  return response;
}
