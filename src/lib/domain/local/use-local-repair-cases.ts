"use client";

import { useSyncExternalStore } from "react";
import {
  getLocalCasesSnapshot,
  getServerCasesSnapshot,
  subscribeLocalCases,
} from "./local-case-storage";
import type { LocalRepairCase } from "./local-types";

export type UseLocalRepairCasesResult = {
  cases: LocalRepairCase[];
  /**
   * 서버 렌더링 결과와 하이드레이션 불일치를 만들지 않기 위해, 마운트 이전에는
   * 항상 false다(useSyncExternalStore가 첫 렌더에 getServerSnapshot을 쓰고,
   * 마운트 이후에만 getSnapshot으로 전환하는 동작을 그대로 활용한다 —
   * ThemeToggle과 동일한 패턴).
   */
  isHydrated: boolean;
};

/**
 * localStorage의 로컬 데모 접수 건을 구독하는 단일 진입점이다. 대시보드/목록/
 * 로컬 상세 화면이 모두 이 훅을 통해서만 로컬 데이터를 읽는다.
 */
export function useLocalRepairCases(): UseLocalRepairCasesResult {
  const cases = useSyncExternalStore(
    subscribeLocalCases,
    getLocalCasesSnapshot,
    getServerCasesSnapshot
  );
  const isHydrated = useSyncExternalStore(
    subscribeLocalCases,
    () => true,
    () => false
  );

  return { cases, isHydrated };
}
