import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { planProcedureDeleteKey, isTextEntryTarget, type ProcedureDeleteKeyInput } from "./procedure-editor-delete-key";

/**
 * 「기술 작업 절차」 편집기 — **[Delete] 키로 지우기**(2026-11-21)의 순수 판정 시험.
 * React 도 DOM 도 서버 액션도 DB 도 안 부른다.
 *
 * 쓰는 분의 요청(원문): 「노드나 연결선을 지울 때 [DELETE] 키를 눌러서 지울 수
 * 있도록 해 달라.」
 *
 * ── 🔴 여기서 가장 크게 다칠 수 있는 것 ────────────────────────────────
 * ① **글자를 치는 중에 노드가 사라지는 것.** 제목·설명·삭제 사유 칸에서 [Delete]
 *    는 「글자 하나 지우기」다. 이 보호가 빠지면 오류도 경고도 없이 노드가 사라지고,
 *    사람은 제가 무엇을 눌러서 그랬는지도 모른다. ②절이 그것만 잰다.
 * ② **단추는 흐린데 키로는 지워지는 것.** 선이 붙은 노드는 서버가 거절하므로
 *    화면이 미리 막아 두었다. 키가 그 판정을 다시 적으면 두 잣대가 생기고, 한쪽만
 *    고치는 날 「지웠는데 한참 뒤 [저장]이 통째로 막히는」 꼴이 된다. ③절.
 * ③ **고른 것이 둘일 때 엉뚱한 것이 지워지는 것.** 경로점·노드·연결선이 겹쳐 고른
 *    상태가 될 수 있다. ④절이 차례를 못 박는다.
 * ④ **Backspace 가 슬그머니 삭제키가 되는 것.** 2026-11-21 에 쓰는 분이 「Delete
 *    키만」이라고 정했다. 나중에 「맥 쓰는 사람을 위해」로 한 줄 더하기 쉬운 자리라
 *    ⑥절이 지킨다.
 *
 * ── 🔵 표본이 비어 공짜로 통과하지 않게 ────────────────────────────────
 * 아래 「안 지워진다」 단언들은 **지워지는 입력 하나(BASE)에서 칸 하나만 뒤집어**
 * 만든다. ①절이 그 BASE 가 실제로 지운다는 것을 먼저 보인다 — 안 그러면 입력이
 * 틀려서 안 지워지는 것인지 보호가 일해서 안 지워지는 것인지 갈 수 없다.
 */

/** 🔵 진짜 id 모양이면 되고 실제 데이터와는 아무 상관이 없다(서버의 randomUUID() 와 같은 꼴). */
const NODE_ID = "11111111-1111-4111-8111-111111111111";
const EDGE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/**
 * **노드가 지워지는** 입력 한 벌. 아래 시험들은 여기서 칸 하나씩만 바꾼다.
 * (기술 작업 분류의 초안을 편집 권한으로 열고, 선이 안 붙은 노드를 고른 채
 * 그림판에 포커스가 있는 상태.)
 */
const BASE: ProcedureDeleteKeyInput = {
  key: "Delete",
  isTypingTarget: false,
  canEdit: true,
  canDeleteGraph: true,
  selectedNodeId: NODE_ID,
  selectedEdgeId: null,
  selectedWaypointIndex: null,
  nodeDeleteBlockedReason: null,
};

const plan = (patch: Partial<ProcedureDeleteKeyInput> = {}) => planProcedureDeleteKey({ ...BASE, ...patch });

describe("[Delete] 로 지우기 — ① 먼저 표본 확인", () => {
  test("🔵 BASE 는 **실제로 노드를 지운다** — 이게 없으면 아래 「안 지워진다」가 전부 공짜로 통과한다", () => {
    assert.deepEqual(plan(), { action: "DELETE_NODE", nodeId: NODE_ID });
  });

  test("🔵 연결선만 고른 BASE 도 **실제로 연결선을 지운다**", () => {
    assert.deepEqual(plan({ selectedNodeId: null, selectedEdgeId: EDGE_ID }), { action: "DELETE_EDGE", edgeId: EDGE_ID });
  });

  test("🔵 경로점을 고른 BASE 도 **실제로 경로점을 지운다**", () => {
    assert.deepEqual(plan({ selectedNodeId: null, selectedEdgeId: EDGE_ID, selectedWaypointIndex: 2 }), {
      action: "REMOVE_WAYPOINT",
      edgeId: EDGE_ID,
      waypointIndex: 2,
    });
  });

  test("🔴 지울 대상의 id 를 **판정이 들고 나온다** — 화면이 제 state 에서 다시 꺼내면 그 사이 바뀐 선택을 지운다", () => {
    const other = "33333333-3333-4333-8333-333333333333";
    const result = plan({ selectedNodeId: other });
    assert.equal(result.action, "DELETE_NODE");
    assert.equal(result.action === "DELETE_NODE" ? result.nodeId : null, other);
  });
});

describe("[Delete] 로 지우기 — ②🔴🔴 글자를 치는 중에는 절대 안 된다", () => {
  test("🔴 글자 칸 안이면 **아무 일도 안 일어난다** — 노드도 연결선도 경로점도", () => {
    // 🔴 BASE 는 ①절에서 노드를 지운다는 것이 확인됐다. 바꾼 칸은 isTypingTarget 하나뿐이다.
    assert.deepEqual(plan({ isTypingTarget: true }), { action: "NONE", reason: "TYPING" });
    assert.deepEqual(plan({ isTypingTarget: true, selectedNodeId: null, selectedEdgeId: EDGE_ID }), { action: "NONE", reason: "TYPING" });
    assert.deepEqual(plan({ isTypingTarget: true, selectedNodeId: null, selectedEdgeId: EDGE_ID, selectedWaypointIndex: 0 }), {
      action: "NONE",
      reason: "TYPING",
    });
  });

  test("🔴 Backspace 도 마찬가지다 — 글자 칸에서는 경로점조차 안 지운다(글자 지우기를 뺏으면 안 된다)", () => {
    assert.deepEqual(plan({ key: "Backspace", isTypingTarget: true, selectedNodeId: null, selectedEdgeId: EDGE_ID, selectedWaypointIndex: 0 }), {
      action: "NONE",
      reason: "TYPING",
    });
  });

  test("🔴 까닭이 TYPING 으로 따로 나온다 — 화면이 그때만 preventDefault 를 건너뛸 수 있어야 한다", () => {
    // 🔴 글자 칸에서 preventDefault 를 하면 **글자가 안 지워진다.** 다른 까닭
    //    (권한 없음 · 고른 것 없음)과 한 값이면 화면이 그 자리를 못 가린다.
    const typing = plan({ isTypingTarget: true });
    const nothing = plan({ selectedNodeId: null });
    assert.equal(typing.action, "NONE");
    assert.equal(nothing.action, "NONE");
    assert.notEqual(typing.action === "NONE" ? typing.reason : null, nothing.action === "NONE" ? nothing.reason : null);
  });

  test("🔴 글자 칸 판정 — input · textarea · select · contenteditable 넷 다 막는다", () => {
    assert.equal(isTextEntryTarget({ tagName: "INPUT" }), true);
    assert.equal(isTextEntryTarget({ tagName: "TEXTAREA" }), true);
    assert.equal(isTextEntryTarget({ tagName: "SELECT" }), true);
    assert.equal(isTextEntryTarget({ tagName: "DIV", isContentEditable: true }), true);
  });

  test("🔵 그림판·단추·몸통은 글자 칸이 아니다 — 아니면 키가 영영 안 듣는다", () => {
    assert.equal(isTextEntryTarget({ tagName: "BODY" }), false);
    assert.equal(isTextEntryTarget({ tagName: "DIV" }), false);
    assert.equal(isTextEntryTarget({ tagName: "DIV", isContentEditable: false }), false);
    assert.equal(isTextEntryTarget({ tagName: "BUTTON" }), false);
    assert.equal(isTextEntryTarget(null), false, "포커스가 아무 데도 없는 상태(activeElement 가 null)");
  });

  test("🔵 SVG 쪽에서 오는 소문자 tagName 도 같은 답이다 — 그림판 안에서 누르는 기능이다", () => {
    assert.equal(isTextEntryTarget({ tagName: "input" }), true);
    assert.equal(isTextEntryTarget({ tagName: "g" }), false);
  });
});

describe("[Delete] 로 지우기 — ③🔴 단추가 흐려지는 조건과 **같은 값 하나**를 본다", () => {
  test("🔴 못 지우는 까닭이 있으면 키로도 안 지워진다 — 「단추는 흐린데 키로는 지워진다」 금지", () => {
    // 🔴 화면이 [노드 삭제] 단추에 넘기는 그 값(selectedNodeDeleteBlockedReason)
    //    그대로가 여기 들어온다. 화면이 만드는 문구를 그대로 쓴다.
    // 🔵 2026-11-21 에 **표본을 갈았다.** 전에는 「연결선 2개가 붙어 있어 삭제할 수
    //    없습니다」를 썼는데, 그 막음이 없어졌다(쓰는 분 결정 — 노드를 지우면 붙은
    //    선도 함께 지워진다). 없어진 문구를 표본으로 두면 「지금 실제로 들어올 수
    //    있는 값」을 아무도 안 재게 된다.
    const result = plan({ nodeDeleteBlockedReason: "체크리스트 또는 고장 진단표 내용이 연결되어 있어 삭제할 수 없습니다." });
    assert.deepEqual(result, { action: "NONE", reason: "NODE_DELETE_BLOCKED" });
  });

  test("🔵 **이 판정은 까닭을 제가 세지 않는다** — 막음이 하나 없어져도 여기는 안 고친다", () => {
    // 🔵 2026-11-21 에 막는 까닭 하나(「연결선이 붙어 있다」)가 없어졌다. 이 파일이
    //    한 글자도 안 바뀐 까닭이 여기 있다 — 받은 값이 null 이면 지우고 아니면
    //    안 지운다, 그뿐이다. 글자가 무엇이든 답이 같다는 것을 못 박아 둔다.
    assert.deepEqual(plan({ nodeDeleteBlockedReason: "무슨 까닭이든" }), { action: "NONE", reason: "NODE_DELETE_BLOCKED" });
    assert.deepEqual(plan({ nodeDeleteBlockedReason: null }), { action: "DELETE_NODE", nodeId: NODE_ID });
  });

  test("🔴 막힌 노드에서 **연결선으로 흘러내리지 않는다** — 지우려던 것은 노드였다", () => {
    // 🔴 막힌 상태에서 노드와 연결선이 둘 다 고른 상태가 될 수 있다. 흘러내리면
    //    「노드를 지우려 했는데 그 노드에 붙어 있던 선이 사라지는」 일이 난다.
    const result = plan({
      selectedEdgeId: EDGE_ID,
      nodeDeleteBlockedReason: "체크리스트 또는 고장 진단표 내용이 연결되어 있어 삭제할 수 없습니다.",
    });
    assert.deepEqual(result, { action: "NONE", reason: "NODE_DELETE_BLOCKED" });
  });

  test("🔴 지울 권한이 없으면 노드도 연결선도 안 지워진다(읽기 전용 · 「기술 작업」 분류가 아닌 절차)", () => {
    assert.deepEqual(plan({ canDeleteGraph: false }), { action: "NONE", reason: "NOT_ALLOWED" });
    assert.deepEqual(plan({ canDeleteGraph: false, selectedNodeId: null, selectedEdgeId: EDGE_ID }), { action: "NONE", reason: "NOT_ALLOWED" });
  });

  test("🔵 권한 잣대가 둘로 갈린다 — 삭제는 canDeleteGraph, 경로점은 canEdit", () => {
    // 🔵 「기술 작업」이 아닌 절차(canDeleteGraph=false)에서도 경로는 고칠 수 있다 —
    //    화면의 경로점 단추들이 canEdit 만 보고 서는 것과 같은 잣대다.
    assert.deepEqual(plan({ canDeleteGraph: false, selectedNodeId: null, selectedEdgeId: EDGE_ID, selectedWaypointIndex: 1 }), {
      action: "REMOVE_WAYPOINT",
      edgeId: EDGE_ID,
      waypointIndex: 1,
    });
    // 읽기 전용이면 경로점도 안 지워진다.
    assert.deepEqual(plan({ canEdit: false, canDeleteGraph: false, selectedNodeId: null, selectedEdgeId: EDGE_ID, selectedWaypointIndex: 1 }), {
      action: "NONE",
      reason: "NOT_ALLOWED",
    });
  });
});

describe("[Delete] 로 지우기 — ④🔴 차례는 **가장 안쪽 것부터**", () => {
  test("🔴 경로점을 고른 채 누르면 **경로점**이 지워진다 — 선이 통째로 사라지면 안 된다", () => {
    assert.deepEqual(plan({ selectedNodeId: null, selectedEdgeId: EDGE_ID, selectedWaypointIndex: 0 }), {
      action: "REMOVE_WAYPOINT",
      edgeId: EDGE_ID,
      waypointIndex: 0,
    });
  });

  test("🔴 0 번 경로점도 고른 것이다 — 자리를 참·거짓으로 읽으면 첫 점에서만 선이 지워진다", () => {
    // 🔴 selectedWaypointIndex 는 0 이 될 수 있다. `if (index)` 로 재면 0 번
    //    경로점을 고른 채 누를 때만 연결선이 통째로 사라진다(그 한 점에서만 난다).
    const atZero = plan({ selectedNodeId: null, selectedEdgeId: EDGE_ID, selectedWaypointIndex: 0 });
    assert.equal(atZero.action, "REMOVE_WAYPOINT");
  });

  test("🔴 노드가 연결선을 이긴다 — 화면의 오른쪽 패널도 그 차례다(노드가 고른 상태면 연결선 패널은 안 선다)", () => {
    assert.deepEqual(plan({ selectedEdgeId: EDGE_ID }), { action: "DELETE_NODE", nodeId: NODE_ID });
  });

  test("🔴 셋이 다 고른 상태면 **경로점**이다", () => {
    assert.deepEqual(plan({ selectedEdgeId: EDGE_ID, selectedWaypointIndex: 3 }), {
      action: "REMOVE_WAYPOINT",
      edgeId: EDGE_ID,
      waypointIndex: 3,
    });
  });

  test("🔵 경로점 자리가 있어도 **연결선이 없으면** 경로점이 아니다 — 어느 선의 점인지 모른다", () => {
    assert.deepEqual(plan({ selectedEdgeId: null, selectedWaypointIndex: 1 }), { action: "DELETE_NODE", nodeId: NODE_ID });
  });
});

describe("[Delete] 로 지우기 — ⑤🔴 고른 것이 없으면 아무 일도 안 일어난다", () => {
  test("🔴 아무것도 안 고른 채 누르면 NONE 이다", () => {
    assert.deepEqual(plan({ selectedNodeId: null, selectedEdgeId: null }), { action: "NONE", reason: "NOTHING_SELECTED" });
  });

  test("🔵 삭제키가 아닌 키는 아예 쳐다보지 않는다", () => {
    for (const key of ["a", "Escape", "Enter", "ArrowLeft", "Del", "delete", " "]) {
      assert.deepEqual(plan({ key }), { action: "NONE", reason: "NOT_A_DELETE_KEY" }, `${key} 가 삭제키로 읽혔다`);
    }
  });
});

describe("[Delete] 로 지우기 — ⑥🔴 Backspace 로는 노드·연결선을 안 지운다 (2026-11-21 쓰는 분 결정)", () => {
  test("🔴 Backspace 로 노드가 지워지면 안 된다 — 「Delete 키만 받는다」", () => {
    // 🔴 BASE 는 ①절에서 노드를 지운다. 바꾼 칸은 key 하나뿐이다.
    assert.deepEqual(plan({ key: "Backspace" }), { action: "NONE", reason: "BACKSPACE_IS_NOT_FOR_GRAPH" });
  });

  test("🔴 Backspace 로 연결선도 안 지워진다", () => {
    assert.deepEqual(plan({ key: "Backspace", selectedNodeId: null, selectedEdgeId: EDGE_ID }), {
      action: "NONE",
      reason: "BACKSPACE_IS_NOT_FOR_GRAPH",
    });
  });

  test("🔴 막혀서 안 지워지는 것과 **까닭이 다르다** — 나중에 누가 Backspace 를 더해도 이 시험이 운다", () => {
    const backspace = plan({ key: "Backspace" });
    assert.equal(backspace.action, "NONE");
    assert.equal(backspace.action === "NONE" ? backspace.reason : null, "BACKSPACE_IS_NOT_FOR_GRAPH");
  });

  test("🔵 다만 **경로점**은 Backspace 로도 지워진다 — 2026-11-21 결정 이전부터의 동작이고, 쓰는 분이 말한 것은 「노드나 연결선」이었다", () => {
    assert.deepEqual(plan({ key: "Backspace", selectedNodeId: null, selectedEdgeId: EDGE_ID, selectedWaypointIndex: 4 }), {
      action: "REMOVE_WAYPOINT",
      edgeId: EDGE_ID,
      waypointIndex: 4,
    });
  });
});
