import "server-only";

import { loadBadgeVisibilitySettings } from "@/lib/db/queries/badge-visibility-settings";
import type { BadgeVisibilityRow } from "@/lib/domain/badge-visibility";

/**
 * ============================================================================
 * 서버 컴포넌트가 배지 표시 설정을 읽는 자리 (2026-11-13, 조각 3)
 * ============================================================================
 * 클라이언트는 useBadgeVisibilitySettings()·useIsBadgeVisible()
 * (components/providers/BadgeVisibilityProvider.tsx), 서버는 이 파일이다 —
 * lib/server/ui-text.ts 가 선 자리와 같다. 판정은 양쪽 모두 domain/badge-visibility.ts
 * 의 isBadgeVisible 하나로만 한다: 서버가 제 나름대로 한 번 더 손보기 시작하면 같은
 * 배지가 목록(클라이언트)과 상세(서버)에서 다르게 보이는 날이 온다.
 *
 * ── 🔵 여기서 cache() 로 **다시** 감싸지 않는다 ────────────────────────────
 * getUiText 는 cache() 로 감쌌다 — 그 아래 조회 둘이 각자 캐시돼 있어도 **병합이**
 * 부르는 자리마다 다시 돌기 때문이다. 이쪽에는 병합이 없다: 바로 아래
 * loadBadgeVisibilitySettings 가 이미 React 의 cache() 라, 같은 요청에서 몇 번을
 * 불러도 질의는 한 번이다. 한 겹 더 씌우면 캐시가 두 곳이 되고 **어느 쪽이 답했는지**
 * 알 수 없어진다.
 *
 * 🔴 표가 아직 없는 DB(마이그레이션 적용 전)에서도 죽지 않는다 — 42P01 "표 없음"만
 * 삼키고 빈 목록으로 답하는 것은 그 조회 함수의 일이다(그 파일 머리말). 빈 목록은
 * 「전부 보임」이고, 그것은 이 기능을 넣기 전과 똑같은 화면이다.
 * ============================================================================
 */

/**
 * 저장된 설정 행 전부. (app) 레이아웃이 불러 BadgeVisibilityProvider 에 싣는다.
 *
 * 🔴 **행이 없는 쌍은 결과에 나오지 않는다** — 그 빈자리가 「보임」이다. 끈 것만
 * 행이 되고, 다시 켜는 것은 행을 지우는 일이다(저장 쪽의 규칙).
 *
 * 🔵 **서버 컴포넌트가 배지 하나를 그릴지 물어야 할 때**는 여기서 읽은 행을
 * domain/badge-visibility.ts 의 isBadgeVisible 에 그대로 넘기면 된다 — 판정 함수를
 * 이 파일에 한 벌 더 두지 않는 까닭은 위 머리말 그대로다(규칙이 두 벌이 되면
 * 설정 화면이 보여 주는 체크 상태와 실제 화면이 갈린다). 2026-11-13 현재 그렇게
 * 묻는 화면은 아직 없다: 수리건 쪽 배지 스물넷이 전부 클라이언트 트리에서 그려지고,
 * 서버로 남아야 하는 배지 하나(approvals/FinalShipmentApprovedBadge)는 클라이언트
 * 조각(BadgeVisibilityGate)을 그려서 가린다.
 */
export async function getBadgeVisibilitySettings(): Promise<readonly BadgeVisibilityRow[]> {
  return loadBadgeVisibilitySettings();
}
