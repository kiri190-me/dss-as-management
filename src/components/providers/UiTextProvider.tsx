"use client";

import { createContext, useContext } from "react";
import { DEFAULT_UI_TEXT, type UiText } from "@/lib/domain/ui-text";

/**
 * ============================================================================
 * 저장된 화면 문구를 클라이언트 컴포넌트에 내려보내는 통로
 * ============================================================================
 * 색(화면 토큰)에는 이런 통로가 필요 없었다 — Tailwind 가 CSS 변수로 모아 두어
 * 루트에 변수 하나만 덮으면 앱 전체가 저절로 따라왔기 때문이다. **문구에는
 * 그런 통로가 없다.** 화면이 `roleLabels[user.role]` 처럼 코드 표를 직접
 * 읽으므로, 저장된 값이 화면까지 가려면 사람이 배관을 놓아야 한다. 그 배관이
 * 이 파일이다.
 *
 * ── 🔴 Provider 는 루트 레이아웃(app/layout.tsx)에 있다 ─────────────────
 * (app) 레이아웃이 아니다. /login · /pending-approval 은 (app) 밖에 있는데
 * 역할 이름 같은 문구를 쓴다 — (app) 안에 두면 그 화면들만 빈손이 된다.
 *
 * ── 🔴 Provider 가 없어도 코드 기본값으로 그린다 ────────────────────────
 * createContext 의 기본값이 DEFAULT_UI_TEXT 다. 이 선택이 하는 일이 셋이다.
 *  ① 마이그레이션 전 DB·로컬 데모 모드처럼 서버가 값을 못 읽는 상황에서도
 *    화면이 지금과 **똑같이** 그려진다.
 *  ② Provider 밖에서 렌더되는 컴포넌트 시험(test:components)이 감싸는 껍데기
 *    없이 그대로 돈다 — 시험을 고치려고 화면 코드를 비틀 일이 없다.
 *  ③ "Provider 를 못 찾았다"고 던지는 흔한 모양을 일부러 피했다. 이름표
 *    하나를 못 읽었다고 화면 전체가 죽으면, 고치러 들어갈 화면조차 안 뜬다.
 *    이 값은 없으면 기본값으로 되돌아가면 그만인 종류의 값이다.
 *
 * ── 서버 컴포넌트는 이 훅을 쓰지 않는다 ─────────────────────────────────
 * 서버에서는 `await getUiText()`(lib/server/ui-text.ts)를 부른다. 훅은
 * 클라이언트 컴포넌트 전용이고, 서버 컴포넌트에서 부르면 렌더가 터진다.
 * ============================================================================
 */

const UiTextContext = createContext<UiText>(DEFAULT_UI_TEXT);

/**
 * 서버가 병합해 둔 문구 한 벌을 아래 트리에 흘려보낸다.
 *
 * DOM 을 하나도 만들지 않는다 — `<body>` 의 직계 자식이 그대로 children 이므로
 * 이 Provider 를 끼워도 flex 배치가 달라지지 않는다.
 */
export function UiTextProvider({
  value,
  children,
}: {
  value: UiText;
  children: React.ReactNode;
}) {
  return <UiTextContext.Provider value={value}>{children}</UiTextContext.Provider>;
}

/**
 * 클라이언트 컴포넌트에서 저장된 문구를 읽는다.
 *
 * 쓰는 모양을 지금과 최대한 닮게 두었다 — `roleLabels[user.role]` 이었던 자리가
 * `uiText.role[user.role]` 이 된다. 이름을 `uiText` 로 통일한 것은 읽는 자리에서
 * "이건 저장된 문구"임이 한눈에 보이게 하려는 것이다.
 */
export function useUiText(): UiText {
  return useContext(UiTextContext);
}
