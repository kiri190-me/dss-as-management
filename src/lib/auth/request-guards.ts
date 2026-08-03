import type { NextRequest } from "next/server";

/**
 * 데모 로그인/로그아웃 POST 요청 전용 Origin 검증이다. 완전한 CSRF 방어
 * 수단은 아니며(토큰 기반 방어 없음), 실제 인증 도입 전에 별도의 CSRF
 * 전략이 필요하다.
 */
export function isTrustedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }
  return origin === request.nextUrl.origin;
}

export function isHttpsRequest(request: NextRequest): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto === "https";
  }
  return request.nextUrl.protocol === "https:";
}
