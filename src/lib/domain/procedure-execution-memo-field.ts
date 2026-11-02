/**
 * 작업 메모 칸이 **어느 노드의 것인지**와 **지금 고치는 중인지**(2026-11-03,
 * 조각 12). 순수 함수만 — DOM 도 React 도 DB 도 건드리지 않는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 왜 이 파일이 생겼는가 — 메모 칸이 안 비워졌다 (사용자 말 그대로)
 * ──────────────────────────────────────────────────────────────────────
 * 「메모를 저장한 후에 다른 노드로 이동하게 되면 [작업 메모]가 비어있도록 해줘.」
 *
 * 까닭은 React 의 상태 수명이다. 「지금 할 일」 큰 카드는 트리에서 **같은 자리에
 * 같은 부품**으로 다시 그려지므로, 노드가 바뀌어도 컴포넌트 인스턴스가 그대로
 * 살아 있다 — `useState(node.workMemo ?? "")` 의 **처음 값은 다시 안 읽힌다.**
 * 그래서 앞 노드에 적던 글자가 다음 노드의 칸에 그대로 남아 있었다. 오류가 안
 * 나고, 저장 단추도 안 떠서(고친 적이 없으니) **그 글이 남의 노드에 붙어 있는
 * 줄을 모른 채** 이어서 적게 된다.
 *
 * 고치는 길이 둘이다 — 부모가 `key={node.id}` 로 다시 태어나게 하거나, 칸이
 * 스스로 「노드가 바뀌었다」를 보고 다시 서거나. **뒤를 골랐다**: 앞의 것은
 * 화면 트리에 적히는 한 글자라 **시험이 잴 수 없고**(markup 에 안 남는다),
 * 칸을 쓰는 자리가 셋(지금 할 일 · 차단됨 카드 · 실행 이력의 끝난 작업)이라
 * 한 곳만 빠뜨리면 그 자리에서만 조용히 되살아난다. 규칙을 값으로 옮겨 두면
 * 세 자리가 같은 함수를 쓰고 시험이 그 함수를 직접 잰다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 [수정]을 눌러야 고쳐진다 (사용자 말 그대로)
 * ──────────────────────────────────────────────────────────────────────
 * 「지금은 [실행 이력]에 작업메모가 언제든 수정할 수 있도록 되어 있는데,
 *  [수정]버튼을 누르고서 수정할 수 있도록 해줘.」
 *
 * 그래서 칸은 **평소 글자**이고(isEditing === false), [수정]을 눌러야 칸이 된다.
 * 🔵 고친 내용은 **이력에 남는다** — 쓰기 쪽이 전부터 NODE_MEMO_UPDATED 를 적고
 * 있었고(before/after 메모까지), 조각 12 의 목록이 그 줄을 실제로 그린다. 그래서
 * 이력 쪽에 새로 더할 것이 없다.
 */

export type MemoFieldState = {
  /** 이 칸이 **어느 실행 노드**의 것인가. 이 값이 바뀌면 칸이 다시 선다. */
  executionNodeId: string;
  /** 고치는 중일 때 칸에 들어 있는 글. 평소에는 저장된 메모와 같다. */
  draft: string;
  isEditing: boolean;
};

/** 칸이 처음 설 때의 모습 — 저장된 메모를 그대로 보여 주고, 고치는 중이 아니다. */
export function memoFieldForNode(node: { executionNodeId: string; savedMemo: string | null }): MemoFieldState {
  return { executionNodeId: node.executionNodeId, draft: node.savedMemo ?? "", isEditing: false };
}

/**
 * 다시 그려질 때마다 부른다. **노드가 그대로면 받은 것을 그대로 돌려준다** —
 * 🔴 여기서 새 객체를 만들면 적던 글이 글자 하나 칠 때마다 날아간다(컴포넌트가
 * 「바뀌었다」로 읽고 상태를 다시 세운다).
 *
 * 노드가 바뀌었으면 **그 노드의 저장된 메모로 다시 선다.** 앞 노드에 적던 글은
 * 버린다 — 남겨 두면 남의 노드에 그 글을 저장하게 된다(위 머리말).
 */
export function nextMemoFieldState(
  state: MemoFieldState,
  node: { executionNodeId: string; savedMemo: string | null }
): MemoFieldState {
  if (state.executionNodeId === node.executionNodeId) return state;
  return memoFieldForNode(node);
}

/**
 * [수정]을 눌렀다 — **저장된 메모**를 칸에 담아 연다.
 *
 * 🔴 `state.draft` 가 아니라 저장된 값에서 시작한다. 저장하지 않고 [취소]한 글이
 * 남아 있으면 다음에 [수정]을 눌렀을 때 그 글이 다시 뜨는데, 그것은 DB 에 없는
 * 글이라 사람이 「저장돼 있었다」고 읽는다.
 */
export function beginMemoEdit(
  state: MemoFieldState,
  node: { executionNodeId: string; savedMemo: string | null }
): MemoFieldState {
  return { executionNodeId: state.executionNodeId, draft: node.savedMemo ?? "", isEditing: true };
}

/** [취소] — 적던 글을 버리고 저장된 메모만 보이는 상태로 돌아간다. */
export function cancelMemoEdit(
  state: MemoFieldState,
  node: { executionNodeId: string; savedMemo: string | null }
): MemoFieldState {
  return memoFieldForNode({ executionNodeId: state.executionNodeId, savedMemo: node.savedMemo });
}

/** 칸에 글자를 쳤다. 고치는 중이 아닐 때는 아무 일도 없다(칸이 아예 안 그려진다). */
export function typeMemoDraft(state: MemoFieldState, draft: string): MemoFieldState {
  return { ...state, draft };
}

/**
 * 서버로 보낼 값. 🔴 **빈 글자는 null 로** 보낸다 — 공백만 남긴 메모를 「적었다」로
 * 저장하면 이력에 빈 줄이 쌓인다(쓰기 쪽도 같은 잣대로 한 번 더 다듬는다).
 */
export function memoSavePayload(state: MemoFieldState): string | null {
  const trimmed = state.draft.trim();
  return trimmed === "" ? null : trimmed;
}
