import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * ============================================================================
 * 다른 사내 시스템이 A/S 를 부를 때의 자격 — **공유 토큰**
 * ============================================================================
 * 쓰는 곳: `src/app/api/v1/**` 의 읽기 전용 통로 셋(인수번호 조회 · 사람 명부 ·
 * 제품 모델). 부르는 쪽은 재고 관리 시스템의 **서버**다.
 *
 * 🔴 `lib/auth/portal-service-token.ts` 를 쓰지 않는 까닭: 그쪽은 **포털이
 * 서명한** 토큰을 푸는 것이다. 여기서 부르는 쪽은 포털이 아니라 서버 하나이고,
 * 포털의 열쇠로 토큰을 구울 수 없다. 사람도 아니므로 세션도 아니다. 그래서
 * 서버 둘이 나눠 가진 글자 하나로 가른다.
 *
 * 판단은 재고 관리 쪽 거울상(`dss-inventory/src/lib/api/auth.ts`)과 **글자 그대로
 * 같다** — 두 시스템이 서로를 부르는 두 방향의 문이 다르게 굴면 둘 중 하나를
 * 고칠 때마다 다른 쪽을 잊는다.
 *
 *  - `Authorization: Bearer <토큰>` 로만 받는다. 🔴 쿼리 문자열로 받지 않는다 —
 *    쿼리는 서버 접근 로그와 브라우저 히스토리에 그대로 남는다.
 *  - 글자 비교는 `timingSafeEqual`. 길이가 다르면 비교 자체를 하지 않는다
 *    (`timingSafeEqual` 은 길이가 다르면 던진다).
 *  - 🔴 토큰이 **설정되지 않았으면 통로가 닫힌 것**(503)이다. 비어 있다고 열어
 *    두면 환경변수를 빠뜨린 서버가 조용히 전부 내주는 문이 된다.
 *  - 토큰이 없거나 틀리면 401 + `www-authenticate: Bearer`.
 *  - 🔴 오류 본문에 토큰이나 그 일부를 담지 않는다. 왜 거절했는지도 「없거나
 *    틀림」 한 가지로만 답한다 — 가른 까닭을 알려 주면 맞혀 가며 두드릴 실마리가
 *    된다(portal-service-token.ts 와 같은 판단).
 * ============================================================================
 */

/** 이 통로의 응답은 캐시되면 안 된다 — 사람 명부와 인수품 정보다. */
export const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * 🔴 **환경변수를 읽는 자리는 여기 하나뿐이다.** 이 저장소는 중앙 `env` 객체를
 * 두지 않고 설정마다 읽는 함수를 하나씩 둔다(`src/lib/config/*.ts`). 그 방식을
 * 그대로 따른다 — 부를 때마다 읽으므로 시험이 `process.env` 를 갈아 끼울 수 있다.
 *
 * 재고 관리 쪽 짝은 `AS_LOOKUP_TOKEN` 이다. **같은 값**을 양쪽에 넣는다.
 */
export function getSharedApiToken(): string {
  return process.env.AS_API_TOKEN?.trim() ?? "";
}

/**
 * 길이가 새지 않는 글자 비교. 길이가 다르면 `timingSafeEqual` 이 던지므로 먼저
 * 가른다 — 길이는 어차피 머리말 길이로 드러난다.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * `Authorization: Bearer <토큰>` 에서 토큰만 꺼낸다. 머리말이 없거나 모양이
 * 다르면 빈 글자 — 부르는 쪽에는 「토큰 없음」과 같은 답이 간다.
 */
export function readBearerToken(authorizationHeader: string | null): string {
  if (!authorizationHeader) return "";
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(authorizationHeader);
  return match ? match[1] : "";
}

/**
 * 통로 하나의 문지기. 통과하면 `null`, 막으면 그대로 돌려줄 응답.
 *
 * 라우트는 **맨 첫 줄에서** 이것을 부르고, `null` 이 아니면 아무 일도 하지 않고
 * 그대로 돌려준다. 조회가 먼저 돌면 거절당한 요청도 DB 를 두드린 뒤에 막힌다.
 */
export function checkSharedApiToken(request: Request): NextResponse | null {
  const expected = getSharedApiToken();
  if (!expected) {
    return NextResponse.json(
      { error: "api_closed", message: "API 토큰이 설정되지 않아 통로가 닫혀 있습니다." },
      { status: 503, headers: NO_STORE }
    );
  }

  const given = readBearerToken(request.headers.get("authorization"));
  if (!given || !safeEqual(given, expected)) {
    return NextResponse.json(
      { error: "unauthorized", message: "토큰이 없거나 맞지 않습니다." },
      { status: 401, headers: { ...NO_STORE, "www-authenticate": "Bearer" } }
    );
  }

  return null;
}
