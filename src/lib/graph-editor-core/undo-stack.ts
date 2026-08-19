/**
 * Generic graph-editor-core — 저장 전(클라이언트) 편집을 한 단계씩 되돌리는
 * 스냅샷 스택. Domain-free: 무엇이 한 단계인지, 스냅샷 안에 무엇이 들었는지는
 * 전혀 모른다(호출자가 타입과 동등성 판정을 준다).
 *
 * 조작별 역연산을 따로 만들지 않고 "바뀌기 직전 상태"를 통째로 쌓는다 —
 * 편집기의 저장 전 상태는 작은 Map 몇 개라 스냅샷 비용이 사실상 없고, 조작이
 * 하나 늘 때마다 역연산 짝을 맞춰야 하는(그래서 어긋나기 쉬운) 구조를 피할 수
 * 있기 때문이다.
 *
 * 서버 이력 기반 되돌리기(procedure-template-undo-redo)를 대체하지 않는다 —
 * 그쪽은 이미 저장된 변경을 다루고, 이 모듈은 아직 저장되지 않은 변경만
 * 다룬다. 저장에 성공하면 호출자가 이 스택을 비워, 같은 변경이 두 체계에
 * 중복으로 남지 않게 한다.
 */

export type UndoStack<T> = {
  /** 되돌리면 복원될 과거 상태들(마지막 원소가 가장 최근). */
  past: readonly T[];
  /** 되돌린 뒤 다시 적용할 수 있는 상태들(마지막 원소가 가장 가까운 미래). */
  future: readonly T[];
};

/** 스택에 남기는 최대 단계 수. 넘치면 가장 오래된 것부터 버린다 — 메모리보다 "무한히 거슬러 올라갈 수 있다"는 착각을 막기 위한 상한이다. */
export const MAX_UNDO_STEPS = 50;

export function createUndoStack<T>(): UndoStack<T> {
  return { past: [], future: [] };
}

type Equals<T> = (a: T, b: T) => boolean;

/**
 * 조작이 일어나기 "직전" 상태를 쌓는다. 새 조작은 다시 적용할 미래를 무효로
 * 만들므로 future를 비운다(일반적인 undo/redo 규약).
 *
 * 직전에 쌓은 것과 같은 상태면 쌓지 않는다 — 클릭만 하고 아무것도 바꾸지 않은
 * 조작이 [이전]을 눌러도 아무 일도 일어나지 않는 빈 단계로 남는 것을 막는다.
 */
export function pushUndoStep<T>(stack: UndoStack<T>, snapshot: T, isEqual: Equals<T>): UndoStack<T> {
  const top = stack.past[stack.past.length - 1];
  if (stack.past.length > 0 && isEqual(top as T, snapshot)) {
    return stack.future.length === 0 ? stack : { past: stack.past, future: [] };
  }
  const past = [...stack.past, snapshot];
  return { past: past.length > MAX_UNDO_STEPS ? past.slice(past.length - MAX_UNDO_STEPS) : past, future: [] };
}

/**
 * restored가 null이면 "되돌릴 것이 없었다"는 뜻이다. 그래도 stack은 항상
 * 돌려준다 — 건너뛴 빈 단계들이 버려진 결과를 호출자가 그대로 반영해야
 * 버튼이 계속 켜져 있는 채로 헛돌지 않는다.
 */
export type UndoResult<T> = { stack: UndoStack<T>; restored: T | null };

/**
 * 한 단계 되돌린다. 현재 상태와 똑같은 단계는 건너뛴다 — 눌렀는데 화면이
 * 그대로인 "헛도는 되돌리기"를 만들지 않기 위함이다(그런 단계는 조용히 버려진다).
 */
export function undoStep<T>(stack: UndoStack<T>, current: T, isEqual: Equals<T>): UndoResult<T> {
  const past = [...stack.past];
  let future = [...stack.future];
  while (past.length > 0) {
    const restored = past.pop() as T;
    if (isEqual(restored, current)) continue;
    future = [...future, current];
    return { stack: { past, future }, restored };
  }
  return { stack: { past, future }, restored: null };
}

/** undoStep의 반대 방향. 규칙(같은 상태는 건너뛴다)도 그대로다. */
export function redoStep<T>(stack: UndoStack<T>, current: T, isEqual: Equals<T>): UndoResult<T> {
  const future = [...stack.future];
  let past = [...stack.past];
  while (future.length > 0) {
    const restored = future.pop() as T;
    if (isEqual(restored, current)) continue;
    past = [...past, current];
    return { stack: { past, future }, restored };
  }
  return { stack: { past, future }, restored: null };
}

export function canUndo<T>(stack: UndoStack<T>): boolean {
  return stack.past.length > 0;
}

export function canRedo<T>(stack: UndoStack<T>): boolean {
  return stack.future.length > 0;
}
