import type { NextRequest } from "next/server";

/** Only the first value of a possibly comma-separated forwarded header (the standard `X-Forwarded-*` convention's client-nearest value) — the rest of the chain is never trusted or inspected. */
function firstForwardedValue(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const first = headerValue.split(",")[0]?.trim();
  return first ? first : null;
}

/** A plain `host[:port]` value — no path, no scheme, no whitespace/control characters. Rejects anything else outright rather than letting it flow into URL construction, where a stray "/" could otherwise be silently reinterpreted as a path separator instead of causing a safe rejection. */
const HOST_PATTERN = /^[a-zA-Z0-9.-]+(:[0-9]{1,5})?$/;

/**
 * Derives the origin this server believes it was actually reached at, from
 * trustworthy incoming request info — deliberately never
 * `request.nextUrl.origin`. Mobile-LAN investigation (live dev-server
 * diagnostic) confirmed `next dev` can report `nextUrl.origin` as the
 * server's own configured bind address (e.g. `http://localhost:3000`) even
 * for a request a LAN client genuinely addressed to
 * `http://192.168.1.132:3000` — Origin/Host/X-Forwarded-Host on that same
 * request all agreed on the real LAN address, only `nextUrl` disagreed.
 *
 * Host precedence: X-Forwarded-Host (first value) then Host.
 * Protocol precedence: X-Forwarded-Proto (first value, `http`/`https` only)
 * then `request.nextUrl.protocol` as a last-resort fallback — protocol
 * only, never host, since Host/X-Forwarded-Host were the values observed
 * to disagree with reality, not the connection's own protocol.
 *
 * Returns null (fail closed) whenever no origin can be safely derived: no
 * usable host, a malformed host, or an X-Forwarded-Proto value that isn't
 * exactly `http`/`https` (treated as an untrustworthy header, never
 * silently ignored in favor of the fallback).
 */
function deriveExpectedOrigin(request: NextRequest): string | null {
  const host = (firstForwardedValue(request.headers.get("x-forwarded-host")) ?? request.headers.get("host"))?.trim();
  if (!host || !HOST_PATTERN.test(host)) return null;

  const forwardedProto = firstForwardedValue(request.headers.get("x-forwarded-proto"));
  let protocol: string;
  if (forwardedProto) {
    const normalized = forwardedProto.toLowerCase();
    if (normalized !== "http" && normalized !== "https") return null;
    protocol = normalized;
  } else {
    protocol = request.nextUrl.protocol.replace(/:$/, "");
  }

  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return null;
  }
}

/**
 * 데모 로그인/로그아웃 POST 요청 전용 Origin 검증이다. 완전한 CSRF 방어
 * 수단은 아니며(토큰 기반 방어 없음), 실제 인증 도입 전에 별도의 CSRF
 * 전략이 필요하다.
 *
 * 모바일 LAN 접속 조사 결과 — 일반 HTML `<form method="post">` 최상위
 * 탐색은 브라우저에 따라 동일 출처 요청에서도 `Origin` 헤더를 생략할 수
 * 있다 (fetch/XHR와 달리 스펙상 허용됨). 그 경우 `localhost`뿐 아니라
 * `192.168.1.132:3000` 같은 LAN IP 접속도 정당한 동일 출처 요청인데도
 * 차단되었다. 게다가 실제 `next dev` 진단 결과 `request.nextUrl.origin`
 * 자체가 LAN 요청에서 신뢰할 수 없는 값(서버 자체 바인드 주소)을
 * 반환한다는 것도 확인되어, 비교 기준을 deriveExpectedOrigin(신뢰 가능한
 * Host/X-Forwarded-Host + 프로토콜)으로 교체했다. 아래 우선순위는 이
 * 공백만 메우고, 다른 모든 경우는 여전히 폐쇄적으로(fail-closed)
 * 거부한다 — 정적 허용 목록이나 하드코딩된 호스트는 두지 않는다:
 *   1. deriveExpectedOrigin이 안전하게 값을 만들 수 없으면(호스트 없음,
 *      형식 오류, 허용되지 않는 X-Forwarded-Proto) 그 즉시 거부한다.
 *   2. Origin이 있으면 그것이 최종 판단이다 — 도출된 expectedOrigin과
 *      정확히 일치할 때만 신뢰, 불일치면 즉시 거부 (Sec-Fetch-Site가 아무리
 *      "same-origin"이어도 이 판단을 절대 뒤집지 않는다).
 *   3. Origin이 없으면 Sec-Fetch-Site(모든 최신 브라우저가 보내는 Fetch
 *      Metadata 헤더)가 "same-origin"일 때만 신뢰.
 *   4. 위 둘 다 쓸 수 없으면 Referer를 안전하게(파싱 실패 시 예외 없이)
 *      해석해 그 출처가 expectedOrigin과 일치할 때만 신뢰.
 *   5. 그 외 모든 경우는 거부.
 */
export function isTrustedOrigin(request: NextRequest): boolean {
  const expectedOrigin = deriveExpectedOrigin(request);
  if (!expectedOrigin) return false;

  const origin = request.headers.get("origin");
  if (origin) {
    return origin === expectedOrigin;
  }

  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite) {
    return secFetchSite === "same-origin";
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === expectedOrigin;
    } catch {
      return false; // malformed Referer — never throw, always fail closed
    }
  }

  return false;
}

export function isHttpsRequest(request: NextRequest): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto === "https";
  }
  return request.nextUrl.protocol === "https:";
}
