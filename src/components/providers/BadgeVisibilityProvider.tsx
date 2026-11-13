"use client";

import { createContext, useContext } from "react";
import {
  NO_BADGE_VISIBILITY_SETTINGS,
  isBadgeVisible,
  type BadgeKey,
  type BadgePlaceKey,
  type BadgeVisibilityRow,
} from "@/lib/domain/badge-visibility";

/**
 * ============================================================================
 * 저장된 배지 표시 설정을 클라이언트 컴포넌트에 내려보내는 통로 (2026-11-13, 조각 3)
 * ============================================================================
 * 배관이 필요한 까닭은 문구(UiTextProvider)와 똑같다 — 색은 Tailwind 가 CSS 변수
 * 하나로 모아 두어 루트에 덮으면 앱 전체가 저절로 따라오지만, **배지는 제 화면에서
 * 제 손으로 그려진다.** 저장된 설정이 그 자리까지 가려면 사람이 길을 놓아야 한다.
 *
 * ── 🔴 Provider 는 (app) 레이아웃에 있다 — 루트가 **아니다** ───────────────
 * UiTextProvider 와 **일부러 다른 자리**다. 그쪽이 루트인 까닭은 `/login` ·
 * `/pending-approval` 이 (app) 밖인데 역할 이름 같은 문구를 쓰기 때문이고, 거기
 * 두지 않으면 그 화면들만 빈손이 된다. 🔴 **배지에는 그 사정이 없다**: 등록부의
 * 자리 일곱이 전부 (app) 안이고(domain/badge-visibility.ts 의 BADGE_PLACES —
 * 전체 A/S 현황 · 수리건 상세 · 내자 정리 · 기타건), 로그인 전 두 화면은 배지를
 * 한 개도 그리지 않는다. 루트에 두면 **로그인 화면마다 쓰이지 않을 조회가 한 번씩**
 * 더 돈다 — 아직 아무도 아닌 사람에게 돌리는 질의다.
 * 🔵 (app) 레이아웃은 이미 살아 있는 계정을 읽고 권한 목록을 구하고 있어, 이
 * 조회는 그 **같은 묶음(Promise.all)** 에 얹혀 왕복이 늘지 않는다.
 *
 * ── 🔴 Provider 가 없어도 던지지 않는다 — 「설정 없음」으로 떨어진다 ───────
 * createContext 의 기본값이 NO_BADGE_VISIBILITY_SETTINGS(빈 목록)이고, 빈 목록은
 * 판정에서 **전부 보임**이다(isBadgeVisible 의 규칙 2 — 빈 표 = 전부 보임). 이
 * 선택이 하는 일이 셋이다.
 *  ① 마이그레이션 전 DB · 로컬 데모 모드처럼 서버가 값을 못 읽는 상황에서도 화면이
 *    이 기능을 넣기 전과 **똑같이** 그려진다.
 *  ② Provider 밖에서 렌더되는 컴포넌트 시험(test:components)이 감싸는 껍데기 없이
 *    그대로 돈다 — 🔴 이번에 특히 중요하다. 배지를 그려 보는 기존 시험이 여럿이고
 *    (due-date-near-badge · repair-case-overdue-badge · final-shipment-approved-
 *    badge-screens · badge-visibility-panel), 그것들은 Provider 를 모른다.
 *  ③ "Provider 를 못 찾았다"고 던지는 흔한 모양을 일부러 피했다. 표식 하나를 못
 *    읽었다고 화면 전체가 죽으면, 고치러 들어갈 화면조차 안 뜬다.
 *
 * ── 서버 컴포넌트는 이 훅을 쓰지 않는다 ─────────────────────────────────
 * 서버에서는 `await getBadgeVisibilitySettings()`(lib/server/badge-visibility.ts)
 * 를 부른다. 훅은 클라이언트 전용이고, 서버 컴포넌트에서 부르면 렌더가 터진다.
 * 🔵 서버 컴포넌트인 채로 남아야 하는 배지(approvals/FinalShipmentApprovedBadge)는
 * 아래 BadgeVisibilityGate 를 그려서 판정을 클라이언트 쪽으로 넘긴다 — 그 파일이
 * 훅을 쓰기 시작하면 기타건 상세의 머리 카드(서버)가 그 배지를 못 그린다.
 * ============================================================================
 */

const BadgeVisibilityContext = createContext<readonly BadgeVisibilityRow[]>(
  NO_BADGE_VISIBILITY_SETTINGS
);

/**
 * 서버가 읽어 둔 설정 행을 아래 트리에 흘려보낸다.
 *
 * DOM 을 하나도 만들지 않는다(Context.Provider 뿐이다) — children 이 여전히 제
 * 부모의 직계 자식이므로 이 Provider 를 끼워도 flex 배치가 달라지지 않는다.
 * UiTextProvider 가 선 자리와 같은 규율이다.
 */
export function BadgeVisibilityProvider({
  value,
  children,
}: {
  value: readonly BadgeVisibilityRow[];
  children: React.ReactNode;
}) {
  return <BadgeVisibilityContext.Provider value={value}>{children}</BadgeVisibilityContext.Provider>;
}

/** 저장된 행 그대로. 판정은 아래 훅이 한다 — 쓰는 쪽이 직접 뒤지지 않는다. */
export function useBadgeVisibilitySettings(): readonly BadgeVisibilityRow[] {
  return useContext(BadgeVisibilityContext);
}

/**
 * 이 자리에서 이 배지를 그릴 것인가.
 *
 * 🔴 **`placeKey` 가 없으면 언제나 참이다.** 이것이 이 기능 전체의 안전장치다:
 *  · 설정 화면의 보기 배지(settings/badge-samples.tsx)는 자리를 한 글자도 안 넘긴다
 *    — 「상태」를 끈 순간 설정 화면의 그 줄이 비면 다시 켤 길을 잃는다.
 *  · 설정 대상이 아닌 화면(내 담당 제품 · 내 작업기록 · 휴지통 · 고객사 상세 ·
 *    제품모델 상세 · 워크플로 관리)도 자리를 안 넘겨 지금과 똑같이 그려진다.
 * 🔵 자리를 **주는데 등록부에 없는 쌍**이어도 판정은 「보임」이다(isBadgeVisible 의
 * 규칙 1) — 되돌릴 수 있는 쪽으로 틀린다.
 */
export function useIsBadgeVisible(
  badgeKey: BadgeKey,
  placeKey: BadgePlaceKey | undefined
): boolean {
  const settings = useBadgeVisibilitySettings();
  if (placeKey === undefined) return true;
  return isBadgeVisible(settings, badgeKey, placeKey);
}

/**
 * 훅을 쓸 수 없는 자리에서 쓰는 판정 — **그려서** 가린다.
 *
 * 쓰는 자리가 둘이고, 둘 다 「훅을 넣으면 안 되는」 까닭이 또렷하다:
 *  ① approvals/FinalShipmentApprovedBadge — `"use client"` 가 없는 **서버 컴포넌트**다.
 *    기타건 상세의 머리 카드(서버)가 그대로 그리고 있어, 그 파일에 훅이 들어가면
 *    그 화면이 통째로 죽는다(그 파일 머리말).
 *  ② repair-cases/RequestedDueDateValue · detail/IntakeInfoSection — 지금은 클라이언트
 *    쪽 부모만 쓰지만 제 파일에 경계가 적혀 있지 않다. 훅을 넣으면 **그 파일이
 *    조용히 클라이언트 전용이 되고**, 나중에 서버 화면이 그 조각을 쓰는 날
 *    `npm run build` 에서만 터진다(app/server-client-boundary-source.test.ts 머리말).
 *
 * 🔴 DOM 을 만들지 않는다 — 보일 때는 children 을 **그대로** 돌려준다. 감싸는 요소를
 * 하나라도 끼우면 알약들이 선 flex 줄의 간격이 달라지고, 그것은 오류 없이 화면에서만
 * 드러난다.
 */
export function BadgeVisibilityGate({
  badgeKey,
  placeKey,
  children,
}: {
  badgeKey: BadgeKey;
  placeKey: BadgePlaceKey | undefined;
  children: React.ReactNode;
}) {
  const visible = useIsBadgeVisible(badgeKey, placeKey);
  if (!visible) return null;
  return <>{children}</>;
}
