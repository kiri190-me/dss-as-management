import { NextResponse, type NextRequest } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { invalidateSessionsForSsoSubject } from "@/lib/db/queries/users";
import { getLoginMode } from "@/lib/config/login-mode";
import { getSsoClientId, getSsoIssuer } from "@/lib/config/sso";

/**
 * 통합 로그인이 "이 사람 세션 끊어라"라고 알려 오는 곳
 * (OIDC Back-Channel Logout 1.0).
 *
 * 왜 필요한가: 이 시스템의 세션은 서버에 저장되지 않는다. 서명된 토큰이라
 * 발급된 뒤에는 스스로 유효하고, 포털이 자기 세션을 폐기해도 여기 쿠키는
 * 그대로 살아 있다. 공용 PC에서 로그아웃했는데 이 화면이 계속 열려 있거나,
 * 정지된 사람이 자기 세션이 만료될 때까지 계속 일할 수 있다는 뜻이다.
 *
 * ⚠️ 이 엔드포인트는 인증 없이 누구나 두드릴 수 있다. 그래서 **서명 검증이
 * 이 파일의 전부다.** 검증을 건너뛰면 아무나 아무 사람이나 로그아웃시킬 수
 * 있는 창구가 된다 — 업무 중인 사람을 계속 튕겨내는 것만으로도 충분히
 * 성가신 공격이 된다.
 *
 * 콜백 라우트가 ID 토큰을 검증하는 것과 같은 방식으로 확인한다:
 * 서명(우리가 아는 포털의 공개키), 발급자, 수신자(우리 client_id), 만료.
 */

/**
 * 콜백 라우트와 같은 이유로 한 번 만들어 재사용한다 — jose가 JWKS 캐시와
 * 키 교체를 알아서 처리한다. 요청마다 만들면 포털을 두드리게 되고 그 캐시가
 * 무의미해진다.
 */
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;
function jwks() {
  jwksCache ??= createRemoteJWKSet(
    new URL(`${getSsoIssuer()}/.well-known/jwks.json`)
  );
  return jwksCache;
}

/** 규격이 정한 표시. 이것이 없으면 로그아웃 통보가 아니다. */
const LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";

/**
 * 규격이 요구하는 응답 헤더. 이 응답이 캐시되면 다음 통보가 서버에 닿지
 * 않고 캐시로 처리될 수 있다.
 */
const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: NextRequest) {
  // 데모 모드에서는 통합 로그인 자체를 쓰지 않는다. 열어 둘 이유가 없다.
  if (getLoginMode() !== "sso") {
    return NextResponse.json({ error: "not_enabled" }, { status: 404, headers: NO_STORE });
  }

  let token: string | null = null;
  try {
    const form = await request.formData();
    const value = form.get("logout_token");
    if (typeof value === "string") token = value;
  } catch {
    // 폼이 아니면 규격을 따르지 않는 요청이다.
  }

  if (!token) {
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 400, headers: NO_STORE }
    );
  }

  let subject: string;
  try {
    const { payload } = await jwtVerify(token, jwks(), {
      issuer: getSsoIssuer(),
      audience: getSsoClientId(),
      clockTolerance: 30,
    });

    // jwtVerify는 서명·iss·aud·exp까지만 본다. 아래 둘은 규격이 따로 요구한다.

    // nonce가 있으면 ID 토큰이다. 규격이 로그아웃 토큰에 nonce를 금지하는
    // 이유가 이것이다 — ID 토큰을 여기로 들이밀어 로그아웃시키지 못하게 한다.
    if (payload.nonce !== undefined) {
      console.error("[backchannel] nonce가 있는 토큰입니다(ID 토큰일 수 있음).");
      return NextResponse.json(
        { error: "invalid_request" },
        { status: 400, headers: NO_STORE }
      );
    }

    const events = payload.events;
    if (
      typeof events !== "object" ||
      events === null ||
      !(LOGOUT_EVENT in (events as Record<string, unknown>))
    ) {
      console.error("[backchannel] 로그아웃 이벤트 표시가 없습니다.");
      return NextResponse.json(
        { error: "invalid_request" },
        { status: 400, headers: NO_STORE }
      );
    }

    if (typeof payload.sub !== "string" || payload.sub === "") {
      console.error("[backchannel] sub가 없습니다.");
      return NextResponse.json(
        { error: "invalid_request" },
        { status: 400, headers: NO_STORE }
      );
    }
    subject = payload.sub;
  } catch (error) {
    console.error("[backchannel] 토큰 검증 실패:", error);
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 400, headers: NO_STORE }
    );
  }

  // sid를 쓰지 않고 sub 단위로 끊는다. 이 시스템의 세션에는 지목할 대상이
  // 없어 특정 세션 하나만 골라낼 수 없다(users.sessions_valid_from 주석 참조).
  const affected = await invalidateSessionsForSsoSubject(subject);

  if (affected) {
    console.info(`[backchannel] 세션을 끊었습니다: ${subject}`);
  } else {
    // 연결되지 않은 사람의 통보일 수 있다 — 오류가 아니다. 규격도 이 경우
    // 성공으로 답하라고 한다(끊을 것이 없는 것도 "끊긴 상태"다).
    console.info(`[backchannel] 끊을 세션이 없습니다: ${subject}`);
  }

  return new NextResponse(null, { status: 204, headers: NO_STORE });
}
