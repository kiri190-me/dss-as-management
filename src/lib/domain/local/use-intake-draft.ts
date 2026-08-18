"use client";

import { useCallback, useState } from "react";
import { createDefaultDraft, isDraftEmpty, type IntakeDraftData } from "./draft-storage";
import { getOrCreateIntakeIdempotencyKey, resetIntakeIdempotencyKey } from "./intake-idempotency-key";

/**
 * 접수 폼 상태는 오직 현재 페이지 세션(마운트) 동안만 메모리에 존재한다 —
 * localStorage에 쓰지 않고, 이전 미완성 입력을 복원하지도 않는다(A/S INTAKE
 * UX 체크포인트: 새로고침/재방문은 항상 빈 폼에서 시작). 페이지 안에서의
 * 일반적인 입력/수정 동작은 그대로다 — 오직 "새로고침 후 복원"만 없앤다.
 *
 * idempotency 키도 같은 원칙을 따른다: 마운트마다 이전에 남아있을 수 있는
 * 키를 버리고 새로 발급한다(오래된 "성공" 키가 새로고침 후의 완전히 다른
 * 새 제출과 뒤섞이지 않도록). 반면 같은 세션 안에서의 재시도(더블클릭,
 * SUBMISSION_IN_PROGRESS로 인한 재시도, 실패 후 같은 내용으로 재제출 등)는
 * 이 state가 리렌더 동안 그대로 유지되므로 여전히 하나의 키로 보호된다 —
 * 즉 "제출 자체의 idempotency 보호"는 그대로 유지되고, 바뀌는 것은 그
 * 보호 범위가 "이 폼을 새로고침 없이 붙잡고 있는 동안"으로 좁혀졌을
 * 뿐이다.
 *
 * 이 훅은 반드시 하이드레이션이 끝난 뒤에만 마운트되는 컴포넌트(예:
 * IntakeFormInner, useIsHydrated로 게이팅된 부모 아래)에서만 사용해야 한다
 * — idempotency 키 발급이 여전히 window.localStorage를 건드리기 때문이다.
 * 서버에는 애초에 렌더되지 않으므로 하이드레이션 불일치는 없다.
 */
export function useIntakeDraft() {
  const [draft, setDraftState] = useState<IntakeDraftData>(() => createDefaultDraft());
  const [idempotencyKey, setIdempotencyKey] = useState(() => {
    resetIntakeIdempotencyKey();
    return getOrCreateIntakeIdempotencyKey();
  });

  const updateDraft = useCallback((partial: Partial<IntakeDraftData>) => {
    setDraftState((prev) => ({ ...prev, ...partial }));
  }, []);

  const clear = useCallback(() => {
    setDraftState(createDefaultDraft());
    // A new draft starts here (successful submit or explicit "지우기") — the
    // old key must never be reused by whatever the user types next.
    resetIntakeIdempotencyKey();
    setIdempotencyKey(getOrCreateIntakeIdempotencyKey());
  }, []);

  return {
    draft,
    updateDraft,
    isEmpty: isDraftEmpty(draft),
    clear,
    idempotencyKey,
  };
}
