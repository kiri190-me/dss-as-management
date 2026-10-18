import "server-only";
import { NextResponse } from "next/server";

import { NO_STORE, readBearerToken, safeEqual } from "./shared-token";

/**
 * ============================================================================
 * 다른 사내 시스템이 A/S 의 자료를 **고칠 때**의 자격 — 쓰기 공유 토큰
 * ============================================================================
 * 쓰는 곳: `src/app/api/v1/domestic-orders/[id]/completion` (PO·내자 사이트가
 * 「이 내자 줄을 완료 처리/완료 해제해 달라」고 부르는 통로). 부르는 쪽은 사람이
 * 아니라 **PO 사이트의 서버**다.
 *
 * ── 🔴 읽기 토큰과 다른 값이다 ──────────────────────────────────────────
 * 이웃 `shared-token.ts`(`AS_API_TOKEN`)는 재고 관리가 **읽어 가는** 통로 셋의
 * 자격이다. 가르는 것은 부르는 쪽이 아니라 **하는 일**이다 — 읽기 토큰 하나로
 * 쓰기까지 열면, 그 토큰을 가진 모든 시스템이 내자 줄을 완료 처리할 수 있게 된다.
 * A/S 가 재고 관리를 부를 때도 같은 모양으로 갈라 둔다
 * (`server/inventory-gateway.ts` 의 `INVENTORY_API_TOKEN` / `INVENTORY_WRITE_TOKEN`).
 * 🔴 두 값을 **같게 적지 마라** — 같게 적으면 갈라 둔 뜻이 그 자리에서 사라진다.
 *
 * ── 포털이 서명한 토큰을 쓰지 않는 까닭 ─────────────────────────────────
 * `lib/auth/portal-service-token.ts` 쪽이 더 튼튼하다(포털의 개인키로 서명하고
 * JWKS 로 검증하므로, 토큰이 새어도 쓰임과 수명이 토큰 안에 박혀 있다). 그런데
 * 그 토큰은 **포털만 구울 수 있다.** PO 는 포털이 아니라 또 하나의 사이트라
 * 그 열쇠가 없고, 구울 수 있게 하려면 포털 저장소(dss-auth)에 새 쓰임을 더해야
 * 한다. 그것은 이 조각의 범위가 아니다. 포털이 PO 에게 토큰을 구워 주게 되는
 * 날 이 문지기를 그쪽으로 갈아끼우면 된다 — 통로의 모양은 그대로 둔 채.
 *
 * ── 판단은 읽기 쪽 문지기와 글자 그대로 같다 ────────────────────────────
 *  - `Authorization: Bearer <토큰>` 로만 받는다(🔴 쿼리 문자열로 받지 않는다 —
 *    쿼리는 서버 접근 로그와 브라우저 히스토리에 그대로 남는다).
 *  - 글자 비교는 `timingSafeEqual`(`safeEqual`). `===` 로 비교하면 앞에서부터
 *    다른 자리에서 바로 끝나, 한 글자씩 맞혀 갈 단서를 준다.
 *  - 🔴 **설정이 비어 있으면 통로를 열지 않는다**(503). 빈 글자끼리 비교해
 *    통과하는 구멍이 가장 흔하다 — `!expected` 가 그 구멍을 막는 유일한 줄이고,
 *    `write-token.test.ts` 가 그 줄을 못 박는다.
 *  - 🔴 **왜 거절했는지를 응답에 담지 않는다.** 「토큰 없음」과 「토큰 틀림」을
 *    한 가지 답으로 접는다. 가른 까닭을 알려 주면 두드려 보는 쪽에 실마리가 된다.
 *    까닭은 **서버 로그에만** 남긴다.
 *  - 🔴 로그에도 토큰이나 그 일부를 적지 않는다.
 * ============================================================================
 */

/**
 * 🔴 **이 환경변수를 읽는 자리는 여기 하나뿐이다.** 이 저장소는 중앙 `env` 객체를
 * 두지 않고 설정마다 읽는 함수를 하나씩 둔다(`shared-token.ts` · `config/*.ts`).
 * 부를 때마다 읽으므로 시험이 `process.env` 를 갈아 끼울 수 있다.
 *
 * PO 사이트(dss-po)에도 **같은 이름**으로 **같은 값**을 넣는다.
 */
export function getWriteApiToken(): string {
  return process.env.AS_WRITE_TOKEN?.trim() ?? "";
}

/**
 * 쓰기 통로 하나의 문지기. 통과하면 `null`, 막으면 그대로 돌려줄 응답.
 *
 * 라우트는 **맨 첫 줄에서** 이것을 부르고, `null` 이 아니면 아무 일도 하지 않고
 * 그대로 돌려준다. 조회가 먼저 돌면 거절당한 요청도 DB 를 두드린 뒤에 막힌다.
 */
export function checkWriteApiToken(request: Request): NextResponse | null {
  const expected = getWriteApiToken();
  if (!expected) {
    // 🔴 「고칠 자리」를 로그가 알려 줘야 한다 — 값을 맞추는 일이 아니라 값을
    // 넣는 일이다. 응답만 보면 둘이 구별되지 않는다.
    console.error("[api] AS_WRITE_TOKEN 이 설정되지 않아 쓰기 통로가 닫혀 있습니다.");
    return NextResponse.json(
      { error: "api_closed", message: "API 토큰이 설정되지 않아 통로가 닫혀 있습니다." },
      { status: 503, headers: NO_STORE }
    );
  }

  const given = readBearerToken(request.headers.get("authorization"));
  if (!given || !safeEqual(given, expected)) {
    // 받은 토큰도 기대한 토큰도 적지 않는다 — 로그는 사람이 읽고 흘리는 곳이다.
    console.error("[api] 쓰기 통로: 토큰이 없거나 맞지 않습니다.", { hadHeader: given !== "" });
    return NextResponse.json(
      { error: "unauthorized", message: "토큰이 없거나 맞지 않습니다." },
      { status: 401, headers: { ...NO_STORE, "www-authenticate": "Bearer" } }
    );
  }

  return null;
}
