"use client";

import { useCallback, useRef, useState } from "react";
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
export function useIntakeDraft(initialDraft?: Partial<IntakeDraftData>) {
  // 처음 만들 때 한 번만 쓴다(useState의 초기화 함수). 뒤에 initialDraft가
  // 바뀌어도 작성 중인 내용을 덮지 않는다 — 사람이 치고 있는 폼을 밑에서
  // 갈아치우는 것이 가장 나쁜 동작이다.
  const [draft, setDraftState] = useState<IntakeDraftData>(() => createDefaultDraft(initialDraft));
  const [idempotencyKey, setIdempotencyKey] = useState(() => {
    resetIntakeIdempotencyKey();
    return getOrCreateIntakeIdempotencyKey();
  });

  /**
   * 처음 받은 초기값을 붙잡아 둔다.
   *
   * clear()가 이 값을 쓰는데, 부모는 렌더마다 새 객체를 넘길 수 있다. 의존성
   * 배열에 그대로 넣으면 clear의 정체성이 매 렌더 바뀌고, clear에 기대는
   * 효과들이 함께 다시 돈다. ref 에 담아 두면 clear 는 안정적으로 남으면서
   * **폼이 시작한 그 상태**로 되돌아간다 — "지우기"의 뜻이 그것이다.
   */
  const initialDraftRef = useRef(initialDraft);

  const updateDraft = useCallback((partial: Partial<IntakeDraftData>) => {
    setDraftState((prev) => ({ ...prev, ...partial }));
  }, []);

  const clear = useCallback(() => {
    setDraftState(createDefaultDraft(initialDraftRef.current));
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
