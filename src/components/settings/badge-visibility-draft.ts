import type { BadgeVisibilityPlacementInput } from "@/lib/db/mutations/badge-visibility-settings";
import type { BadgeVisibilityBadgeView } from "@/lib/db/queries/badge-visibility-settings";

/**
 * ============================================================================
 * [배지 표시] 탭이 쥐고 있는 **체크 상태**의 규칙 (2026-11-13)
 * ============================================================================
 * 화면에서 떼어 둔 까닭은 users-tab-access.ts 와 같다 — 순수 함수라야 값으로 잴 수
 * 있고, 화면 본체는 React 상태를 물고 있어 시험에서 눌러 볼 수 없다. 여기 있는 셋이
 * 이 탭의 전부다: 「처음 체크 상태」 · 「서버 값이 달라졌는가」 · 「무엇을 보낼 것인가」.
 *
 * 🔴 **DB 도 등록부도 읽지 않는다.** 넘어온 자료(buildBadgeVisibilityView)만 본다 —
 * 등록부를 여기서 다시 읽으면 서버가 보낸 차례와 화면이 그리는 차례가 갈릴 수 있고,
 * 그 어긋남은 오류 없이 체크상자 하나가 엉뚱한 쌍을 가리키는 모양으로 나타난다.
 * ============================================================================
 */

/**
 * 체크 상태를 담는 열쇠.
 *
 * 🔴 배지 키도 자리 키도 공백 없는 영문 식별자(camelCase)라 이어 붙인 글자가 다른
 * 쌍의 것과 겹칠 수 없다 — domain/badge-visibility.ts 가 허용 쌍 집합을 만들 때 선
 * 그 판단과 같다. 두 쌍이 한 열쇠로 접히면 체크 하나가 두 자리를 함께 움직이고,
 * 그것은 오류 없이 화면에서만 드러난다.
 */
export function badgeDraftKey(badgeKey: string, placeKey: string): string {
  return `${badgeKey} ${placeKey}`;
}

/** 서버가 넘긴 값 그대로의 체크 상태(체크 = 보임). */
export function badgeDraftFromView(
  badges: readonly BadgeVisibilityBadgeView[]
): Record<string, boolean> {
  const draft: Record<string, boolean> = {};
  for (const badge of badges) {
    for (const place of badge.places) {
      draft[badgeDraftKey(badge.badgeKey, place.placeKey)] = place.visible;
    }
  }
  return draft;
}

/**
 * 서버가 넘긴 값의 **지문**. 이것이 달라질 때만 사람이 만지던 체크 상태를 버린다.
 *
 * 🔴 `badges` 배열의 **신원**(===)으로 재면 안 된다 — 서버 컴포넌트는 다시 그릴
 * 때마다 새 배열을 만들므로, 저장이 **실패해서** 아무것도 안 바뀐 뒤에도 사람이 고쳐
 * 둔 체크가 통째로 날아간다. 값으로 재면 바뀐 것이 없을 때는 지문도 같다.
 */
export function badgeViewSignature(badges: readonly BadgeVisibilityBadgeView[]): string {
  return badges
    .flatMap((badge) =>
      badge.places.map(
        (place) => `${badgeDraftKey(badge.badgeKey, place.placeKey)}=${place.visible}`
      )
    )
    .join(",");
}

/**
 * 서버로 보낼 쌍 — **바뀐 것만**이다.
 *
 * 🔴 33개를 통째로 보내지 않는 까닭은 액션 주석에 있다(다른 관리자가 그 사이에 바꿔
 * 둔 자리를 내 화면의 옛 값으로 덮어쓴다). [저장]을 여닫는 조건도 이 목록이 비었는가
 * 하나다 — 두 곳에서 따로 세면 「단추는 켜졌는데 보낼 것이 없는」 자리가 생긴다.
 *
 * 🔵 차례는 화면에 보이는 차례 그대로다(배지 → 자리). 저장 쪽이 받은 차례대로 쓰므로,
 * 감사 기록도 사람이 화면에서 읽은 차례로 남는다.
 */
export function changedBadgePlacements(
  badges: readonly BadgeVisibilityBadgeView[],
  draft: Record<string, boolean>
): BadgeVisibilityPlacementInput[] {
  return badges.flatMap((badge) =>
    badge.places
      .filter((place) => draft[badgeDraftKey(badge.badgeKey, place.placeKey)] !== place.visible)
      .map((place) => ({
        badgeKey: badge.badgeKey,
        placeKey: place.placeKey,
        isVisible: draft[badgeDraftKey(badge.badgeKey, place.placeKey)],
      }))
  );
}
