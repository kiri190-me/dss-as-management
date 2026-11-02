import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  beginMemoEdit,
  cancelMemoEdit,
  memoFieldForNode,
  memoSavePayload,
  nextMemoFieldState,
  typeMemoDraft,
} from "./procedure-execution-memo-field";

/**
 * 작업 메모 칸의 규칙 둘(2026-11-03, 조각 12 — 사용자 결정 둘):
 *
 *   ㉠ 「메모를 저장한 후에 다른 노드로 이동하게 되면 [작업 메모]가 비어있도록 해줘.」
 *   ㉡ 「… [수정]버튼을 누르고서 수정할 수 있도록 해줘.」
 *
 * 🔴 ㉠ 이 **화면에서만 드러나는** 결함이라 여기서 값으로 잰다. 전에는 칸이
 * 컴포넌트 안의 useState 였고, React 가 같은 자리의 같은 부품을 다시 쓰므로
 * 처음 값이 다시 안 읽혔다 — 앞 노드에 적던 글자가 다음 노드 칸에 그대로 남았고,
 * 오류도 저장 단추도 안 떠서 아무도 신고하지 않았다.
 */

const A = { executionNodeId: "e1", savedMemo: "1번 노드에 저장된 메모" };
const B = { executionNodeId: "e2", savedMemo: null };
const C = { executionNodeId: "e3", savedMemo: "3번 노드에 저장된 메모" };

describe("🔵 먼저 — 칸이 처음 설 때", () => {
  test("저장된 메모를 보여 주고, 고치는 중이 아니다", () => {
    assert.deepEqual(memoFieldForNode(A), { executionNodeId: "e1", draft: A.savedMemo, isEditing: false });
    assert.deepEqual(memoFieldForNode(B), { executionNodeId: "e2", draft: "", isEditing: false });
  });
});

describe("🔴 ㉠ 다른 노드로 옮기면 칸이 **다시 선다**", () => {
  /** 1번 노드에서 메모를 고치던 중(저장하기 전후 둘 다 이 모양이 된다). */
  const typingOnA = { executionNodeId: "e1", draft: "앞 노드에 적던 글", isEditing: true };

  test("🔴 빈 노드로 옮기면 **칸이 빈다** — 남의 글이 따라가지 않는다", () => {
    const moved = nextMemoFieldState(typingOnA, B);
    assert.equal(moved.draft, "", "앞 노드의 글자가 그대로 남으면 그 글을 남의 노드에 저장하게 된다");
    assert.equal(moved.executionNodeId, "e2");
    assert.equal(moved.isEditing, false, "옮기자마자 칸이 열려 있으면 또 잘못 적게 된다");
  });

  test("🔴 **저장된 메모는 안 사라진다** — 메모가 있는 노드로 옮기면 그 노드의 글이 뜬다", () => {
    assert.equal(nextMemoFieldState(typingOnA, C).draft, C.savedMemo);
  });

  test("🔴 되돌아오면 그 노드의 저장된 메모가 **그대로** 보인다 — 칸만 비우는 것이지 지우는 것이 아니다", () => {
    const back = nextMemoFieldState(nextMemoFieldState(typingOnA, B), A);
    assert.equal(back.draft, A.savedMemo);
  });

  test("🔴 같은 노드면 **받은 것을 그대로** 돌려준다 — 글자 하나 칠 때마다 날아가면 못 적는다", () => {
    const same = nextMemoFieldState(typingOnA, { executionNodeId: "e1", savedMemo: A.savedMemo });
    assert.equal(same, typingOnA, "같은 값이 아니라 **같은 객체**여야 한다(컴포넌트가 「바뀌었다」로 읽는다)");
  });

  test("🔵 같은 노드인데 저장된 메모만 바뀌어도(새로고침) 적던 글을 안 뺏는다", () => {
    const after = nextMemoFieldState(typingOnA, { executionNodeId: "e1", savedMemo: "남이 저장한 글" });
    assert.equal(after.draft, "앞 노드에 적던 글");
  });
});

describe("🔴 ㉡ [수정]을 눌러야 고쳐진다", () => {
  test("평소에는 고치는 중이 아니다", () => {
    assert.equal(memoFieldForNode(A).isEditing, false);
  });

  test("[수정]을 누르면 **저장된 메모**가 칸에 들어온다", () => {
    const editing = beginMemoEdit(memoFieldForNode(A), A);
    assert.equal(editing.isEditing, true);
    assert.equal(editing.draft, A.savedMemo);
  });

  test("🔴 [취소]하고 다시 [수정]하면 **버린 글이 안 돌아온다** — DB 에 없는 글을 저장된 것처럼 보이면 안 된다", () => {
    const typed = typeMemoDraft(beginMemoEdit(memoFieldForNode(A), A), "저장하지 않고 버릴 글");
    const cancelled = cancelMemoEdit(typed, A);
    assert.equal(cancelled.isEditing, false);
    assert.equal(cancelled.draft, A.savedMemo, "취소했는데 적던 글이 남아 있다");
    assert.equal(beginMemoEdit(cancelled, A).draft, A.savedMemo);
  });

  test("칸에 글자를 치면 적던 글만 바뀐다", () => {
    const typed = typeMemoDraft(beginMemoEdit(memoFieldForNode(A), A), "새 글");
    assert.deepEqual(typed, { executionNodeId: "e1", draft: "새 글", isEditing: true });
  });
});

describe("서버로 보낼 값", () => {
  test("빈 글자와 공백만 남은 글은 null 로 보낸다 — 「적었다」가 되면 이력에 빈 줄이 쌓인다", () => {
    assert.equal(memoSavePayload({ executionNodeId: "e1", draft: "   ", isEditing: true }), null);
    assert.equal(memoSavePayload({ executionNodeId: "e1", draft: "", isEditing: true }), null);
  });

  test("여러 줄 메모는 줄바꿈을 지킨 채로 간다", () => {
    const memo = "FH-CONT 전압 23.4V\n규격 하한";
    assert.equal(memoSavePayload({ executionNodeId: "e1", draft: `  ${memo}  `, isEditing: true }), memo);
  });
});
