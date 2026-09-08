import "server-only";

import { cache } from "react";
import { loadExceptionStatusLabels } from "@/lib/db/queries/exception-statuses";
import { loadUiTextOverrides } from "@/lib/db/queries/ui-text-overrides";
import { buildUiText, type UiText } from "@/lib/domain/ui-text";

/**
 * ============================================================================
 * 서버 컴포넌트가 문구를 읽는 자리
 * ============================================================================
 * 클라이언트는 useUiText()(components/providers/UiTextProvider.tsx), 서버는
 * 이 함수다. 둘이 **같은 값**을 봐야 하므로 병합은 양쪽 모두 domain/ui-text.ts
 * 의 buildUiText 하나로만 한다 — 서버가 자기 나름대로 한 번 더 손보기 시작하면
 * 같은 배지가 목록(클라이언트)과 상세(서버)에서 다른 문구로 나오는 날이 온다.
 *
 * ── 🔴 요청 한 번에 조회 한 번 ──────────────────────────────────────────
 * React 의 cache() 로 감쌌다. 아래의 loadUiTextOverrides ·
 * loadExceptionStatusLabels 도 각자 cache 되어 있지만, 그것만으로는 buildUiText
 * 가 부르는 자리마다 다시 돈다 — 한 화면에서 서버 컴포넌트 여럿이 문구를 읽는
 * 것은 평범한 일이고, 그때마다 표 두 개를 다시 병합할 이유가 없다. 요청이
 * 끝나면 캐시도 사라지므로 값을 바꾼 직후 다음 요청부터 바로 반영된다.
 * 🔴 프로세스 수명 캐시(unstable_cache 등)를 쓰지 않는다 — 이 기능에서는
 * "저장했는데 화면이 안 바뀐다"가 곧 고장으로 읽힌다.
 *
 * ── 둘을 나란히 읽는다 ──────────────────────────────────────────────────
 * 두 조회는 서로를 모른다(하나는 ui_text_overrides, 하나는 exception_statuses).
 * 줄 세워 기다릴 이유가 없어 Promise.all 로 함께 보낸다. 루트 레이아웃이 부르는
 * 값이라 여기서 아낀 한 왕복이 **모든 화면**의 첫 바이트에 그대로 남는다.
 * ============================================================================
 */
export const getUiText = cache(async (): Promise<UiText> => {
  const [overrides, exceptionStatusRows] = await Promise.all([
    loadUiTextOverrides(),
    loadExceptionStatusLabels(),
  ]);

  return buildUiText(overrides, exceptionStatusRows);
});
