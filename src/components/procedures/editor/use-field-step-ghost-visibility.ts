"use client";

import { useSyncExternalStore } from "react";

import {
  FIELD_STEP_GHOST_VISIBILITY_STORAGE_KEY,
  readFieldStepGhostVisibility,
  writeFieldStepGhostVisibility,
  type FieldStepGhostVisibilityStore,
} from "@/lib/domain/procedure-field-added-steps";

/**
 * ============================================================================
 * 「현장 단계」를 그림에서 끄고 켠 상태 — **이 브라우저에만** 남는다
 * ============================================================================
 * 사용자 결정(2026-11-04) — 「편집기에서 [현장 단계]를 모두 비가시 처리할 수
 * 있는 기능을 넣어줘」.
 *
 * 판정과 읽고 쓰는 규칙은 전부 도메인(procedure-field-added-steps.ts)에 있다.
 * 여기 있는 것은 **`window.localStorage` 를 실제로 두드리는 일**과, 값이 바뀌었음을
 * 화면에 알리는 일 둘뿐이다(주간보고 가로폭과 같은 규약 — WeeklyReportWidthFrame).
 *
 * ── 🔴 왜 useState + useEffect 가 아니라 useSyncExternalStore 인가 ──────
 * 편집기 화면은 클라이언트 부품이지만 **서버에서도 한 번 그려진다.** 첫 렌더에서
 * 저장소를 그냥 읽으면 서버가 그린 것과 달라져 hydration 이 어긋나고, 효과에서
 * 읽어 setState 하면 **꺼 둔 사람의 화면에 유령이 한 프레임 스쳐 지나간다.**
 * useSyncExternalStore 는 서버 몫(getServerSnapshot)을 따로 받으므로 둘 다 없다.
 *
 * ── 🔵 적지 못하는 브라우저에서도 이번 방문 동안은 먹힌다 ───────────────
 * 사생활 보호 창에서는 저장소에 손대는 것 자체가 터진다. 그때도 고른 값을 아래
 * 메모리에 들고 있어서 화면은 그대로 따라온다 — 못 적은 대가는 다음에 열었을 때
 * 기본값(보임)으로 돌아가는 것뿐이다.
 * ============================================================================
 */

const listeners = new Set<() => void>();

/** 이번 방문 동안의 값. 저장소에 못 적는 브라우저에서도 화면이 따라오게 하는 받침이다. */
let inMemoryVisible: boolean | null = null;

/** 저장소를 집는다. **속성을 읽는 것 자체가 던진다**(사생활 보호 창). 그래서 통째로 감싼다. */
function ghostVisibilityStore(): FieldStepGhostVisibilityStore | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 참/거짓이라 값으로 비교된다 — 신원이 흔들려 끝없이 다시 그리는 일이 없다. */
function getSnapshot(): boolean {
  if (inMemoryVisible !== null) return inMemoryVisible;
  return readFieldStepGhostVisibility(ghostVisibilityStore(), FIELD_STEP_GHOST_VISIBILITY_STORAGE_KEY);
}

/** 서버에는 저장소가 없다. 🔴 아직 아무것도 안 고른 사람과 **같은 화면**(보임)을 준다. */
function getServerSnapshot(): boolean {
  return true;
}

function setGhostVisibility(visible: boolean): void {
  inMemoryVisible = visible;
  writeFieldStepGhostVisibility(ghostVisibilityStore(), FIELD_STEP_GHOST_VISIBILITY_STORAGE_KEY, visible);
  for (const listener of listeners) listener();
}

/** 그림에 현장 단계(유령 칸·점선)를 보일 것인가와, 그것을 바꾸는 길. */
export function useFieldStepGhostVisibility(): { ghostsVisible: boolean; setGhostsVisible: (visible: boolean) => void } {
  const ghostsVisible = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { ghostsVisible, setGhostsVisible: setGhostVisibility };
}
