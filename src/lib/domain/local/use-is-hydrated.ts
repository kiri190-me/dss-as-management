"use client";

import { useSyncExternalStore } from "react";

function subscribeNever(): () => void {
  return () => {};
}

/**
 * 서버 렌더와 하이드레이션 직후 첫 클라이언트 렌더는 항상 false를 반환하고,
 * 마운트 이후에만 true로 전환된다(ThemeToggle과 동일한
 * useSyncExternalStore 트릭). effect 안에서 setState를 호출하는 방식보다
 * 안전하게 하이드레이션 완료 시점을 알 수 있다.
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}
