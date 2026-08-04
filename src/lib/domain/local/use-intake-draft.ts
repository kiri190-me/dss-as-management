"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearDraft,
  createDefaultDraft,
  isDraftEmpty,
  readDraft,
  writeDraft,
  type IntakeDraftData,
} from "./draft-storage";

const AUTO_SAVE_DELAY_MS = 500;

function formatSavedAtLabel(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * 이 훅은 반드시 하이드레이션이 끝난 뒤에만 마운트되는 컴포넌트(예:
 * IntakeFormInner, useIsHydrated로 게이팅된 부모 아래)에서만 사용해야 한다.
 * 그 전제 덕분에 초기값을 useState의 lazy initializer로 한 번만 읽으면
 * 되고, effect 안에서 마운트 시점에 setState를 호출하는 패턴(캐스케이딩
 * 리렌더를 유발해 react-hooks/set-state-in-effect가 금지하는 패턴)을 쓰지
 * 않는다. 서버에는 애초에 렌더되지 않으므로 하이드레이션 불일치도 없다.
 */
export function useIntakeDraft() {
  const [initial] = useState(() => readDraft());
  const [draft, setDraftState] = useState<IntakeDraftData>(initial.draft);
  const [savedAtIso, setSavedAtIso] = useState<string | null>(initial.savedAt);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const savedAt = writeDraft(draft);
      setSavedAtIso(savedAt);
    }, AUTO_SAVE_DELAY_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [draft]);

  const updateDraft = useCallback((partial: Partial<IntakeDraftData>) => {
    setDraftState((prev) => ({ ...prev, ...partial }));
  }, []);

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    isFirstRender.current = true;
    clearDraft();
    setDraftState(createDefaultDraft());
    setSavedAtIso(null);
  }, []);

  return {
    draft,
    updateDraft,
    isEmpty: isDraftEmpty(draft),
    savedAtLabel: formatSavedAtLabel(savedAtIso),
    clear,
  };
}
