import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  applyProcedureAutoLayoutMemory,
  computeProcedureAutoLayout,
  type ProcedureAutoLayoutEdge,
  type ProcedureAutoLayoutMemory,
  type ProcedureAutoLayoutNode,
} from "./procedure-auto-layout";

/**
 * ============================================================================
 * 🔴 **선을 지워도 이미 놓인 칸은 안 움직인다** (2026-11-20)
 * ============================================================================
 * 쓰는 분 신고: 「연결선을 삭제하면 노드 위치가 튄다.」 끊긴 칸만이 아니라 **둘레가
 * 전부** 움직였다.
 *
 * ── 🔴 무엇이 움직이는가 ────────────────────────────────────────────────
 * computeProcedureAutoLayout 은 (노드, 선)의 순수 함수다. 선이 하나 사라지면
 *  ① 끊긴 칸이 **뿌리**가 되어 숲의 맨 아래로 내려가고(가로 차례도 다시 매겨진다),
 *  ② 그 칸이 쓰던 높이가 사라져 **아래쪽 형제들이 위로 당겨진다**.
 * 둘 다 알고리즘이 일부러 그러는 것이라 셈을 고쳐서는 못 푼다 — 순수 함수가
 * 「전에 어디 있었는지」를 알 길이 없기 때문이다.
 *
 * 그래서 **먼저 그려 준 자리를 기억**한다(applyProcedureAutoLayoutMemory). 이
 * 파일이 그 약속을 값으로 지킨다. 그림 부품(ProcedureFlowGraph)은 @xyflow/react 의
 * .css 를 물고 있어 시험에서 import 할 수 없으므로, 재는 것은 언제나 이 순수
 * 함수 쪽이다 — 그림이 그 함수를 정말 쓰는지는 화면 시험이 따로 본다
 * (src/components/procedures/procedure-flow-graph-layout-memory.test.ts).
 *
 * 🔴 **표본의 이름은 전부 가짜다.** 신고에 쓰인 모양(세로 사슬 + 오른쪽 가지 +
 * 가지 하나에 매달린 끝 칸)만 베꼈다 — 실제 고객사·절차·기판 이름은 공개
 * 저장소에 한 글자도 들어가면 안 된다.
 * ============================================================================
 */

function node(id: string, sortOrder: number, title: string, nodeType: ProcedureAutoLayoutNode["nodeType"] = "TASK"): ProcedureAutoLayoutNode {
  return { id, nodeType, title, sortOrder, positionX: 0, positionY: sortOrder * 120, userPositionX: null, userPositionY: null };
}

function edge(fromNodeId: string, toNodeId: string, branchType: ProcedureAutoLayoutEdge["branchType"] = "DEFAULT"): ProcedureAutoLayoutEdge {
  return { fromNodeId, toNodeId, branchType };
}

/**
 * 신고된 모양 그대로의 가짜 표본.
 *  - `c1 → c2 → c3 → done` 이 왼쪽에 세로로 선다(판단 셋 + 끝).
 *  - 판단마다 NG 가지가 오른쪽으로 하나씩 뻗는다(`b1`·`b2`·`b3`).
 *  - 가지 하나(`b2`)에 끝 칸 `tail` 이 매달린다 — **지울 선이 이것**이다.
 *
 * 🔴 `tail` 의 sortOrder 를 **가장 작게** 둔다. 뿌리의 가로 차례는 sortOrder 가
 * 정하므로(computeLayeredGraphLayout 의 「깊이 0 은 왼쪽부터 한 칸씩」), 끊긴 칸이
 * 주 뿌리보다 앞 번호면 **그림 전체가 한 칸 오른쪽으로** 밀린다. 신고된 스크린샷이
 * 그 모습이었다 — 번호를 크게 두면 움직이는 칸이 넷으로 줄어 시험이 무는 힘이 는다.
 */
const NODES: ProcedureAutoLayoutNode[] = [
  node("tail", 0, "가짜 기판 교환"),
  node("c1", 1, "1.가짜 값 확인", "DECISION"),
  node("c2", 2, "2.가짜 전압 확인", "DECISION"),
  node("c3", 3, "3.가짜 통전 확인", "DECISION"),
  node("done", 4, "가짜 수리 완료", "END"),
  node("b1", 5, "가짜 값 변경"),
  node("b2", 6, "가짜 전압 재조정"),
  node("b3", 7, "가짜 문의"),
];

const EDGES: ProcedureAutoLayoutEdge[] = [
  edge("c1", "c2", "YES"),
  edge("c2", "c3", "YES"),
  edge("c3", "done", "YES"),
  edge("c1", "b1", "NG"),
  edge("c2", "b2", "NG"),
  edge("c3", "b3", "NG"),
  edge("b2", "tail", "DEFAULT"),
];

/** 지울 선 하나(`b2 → tail`)를 뺀 목록. */
const EDGES_AFTER_DELETE = EDGES.filter((e) => !(e.fromNodeId === "b2" && e.toNodeId === "tail"));

const layoutOf = (edges: readonly ProcedureAutoLayoutEdge[]) => computeProcedureAutoLayout({ nodes: NODES, edges });

/** 두 지도에서 **자리가 달라진 칸**의 id 와 그 차이. 비면 아무도 안 움직인 것이다. */
function movedBetween(
  before: ReadonlyMap<string, { x: number; y: number }>,
  after: ReadonlyMap<string, { x: number; y: number }>
): { id: string; dx: number; dy: number }[] {
  const moved: { id: string; dx: number; dy: number }[] = [];
  for (const [id, a] of before) {
    const b = after.get(id);
    if (b === undefined) continue;
    if (a.x !== b.x || a.y !== b.y) moved.push({ id, dx: b.x - a.x, dy: b.y - a.y });
  }
  return moved;
}

describe("자동 배치 기억 — ① 먼저 표본 확인", () => {
  /**
   * 🔵 **이 묶음이 없으면 아래가 전부 공짜로 통과한다.** 「아무도 안 움직인다」는
   * 지도가 비어 있어도 참이고, 「선을 지우면 움직인다」는 표본이 한 칸짜리면
   * 거짓인 줄도 모른다.
   */
  test("🔵 표본이 실제로 여덟 칸을 세우고, 칸마다 다른 자리를 받는다", () => {
    const layout = layoutOf(EDGES);
    assert.equal(layout.size, NODES.length, "자동 배치가 넘긴 칸을 전부 돌려줘야 한다");
    const distinct = new Set([...layout.values()].map((p) => `${p.x},${p.y}`));
    assert.equal(distinct.size, NODES.length, "자리가 겹치면 「안 움직인다」를 재도 뜻이 없다");
  });

  /**
   * 🔴 **고치려는 결함이 실재한다**는 값. 기억을 안 쓰면(= 2026-11-20 이전) 선
   * 하나를 지웠을 뿐인데 여덟 칸이 전부 움직인다.
   */
  test("🔴 기억을 안 쓰면 — 선 하나를 지우자 **여덟 칸이 전부** 움직인다", () => {
    const moved = movedBetween(layoutOf(EDGES), layoutOf(EDGES_AFTER_DELETE));
    assert.equal(moved.length, NODES.length, `선 하나에 이만큼 움직인다: ${JSON.stringify(moved)}`);
    // 끊긴 칸만의 일이 아니다 — 손도 안 댄 칸들이 **가로로 한 칸(280)** 넘게 밀린다.
    const untouched = moved.filter((m) => m.id !== "tail");
    assert.equal(untouched.length, NODES.length - 1);
    for (const m of untouched) {
      assert.ok(m.dx >= 280, `${m.id} 이 가로로 ${m.dx} 밀렸다 — 한 칸(280) 이상이어야 신고된 모습이다`);
    }
  });
});

describe("자동 배치 기억 — ② 선을 지워도 안 움직인다", () => {
  test("🔴 **한 칸도 안 움직인다** — 끊긴 칸까지 포함해 여덟 칸 전부 제자리", () => {
    // ① 처음 그린다(기억 없음) → 그 자리가 곧 기억이 된다.
    const first = applyProcedureAutoLayoutMemory(layoutOf(EDGES), new Map());
    assert.equal(first.remembered.size, NODES.length, "표본 확인 — 기억이 비면 아래가 공짜로 통과한다");

    // ② 선을 하나 지우고 다시 그린다.
    const second = applyProcedureAutoLayoutMemory(layoutOf(EDGES_AFTER_DELETE), first.remembered);

    const moved = movedBetween(first.layout, second.layout);
    assert.deepEqual(moved, [], `선을 지웠는데 움직인 칸이 있다: ${JSON.stringify(moved)}`);
  });

  test("🔴 **선을 되살리면(되돌리기) 그대로** — 제자리에서 한 번 더 안 튄다", () => {
    const first = applyProcedureAutoLayoutMemory(layoutOf(EDGES), new Map());
    const deleted = applyProcedureAutoLayoutMemory(layoutOf(EDGES_AFTER_DELETE), first.remembered);
    const restored = applyProcedureAutoLayoutMemory(layoutOf(EDGES), deleted.remembered);
    assert.deepEqual(movedBetween(first.layout, restored.layout), []);
  });

  /**
   * 🔴 「안 움직인다」가 **기억이 이겨서**인지, 아니면 애초에 갓 센 값이 같아서인지
   * 갈라 둔다. 갈라 두지 않으면 기억을 통째로 무시하는 구현도 이 묶음을 통과한다.
   */
  test("🔵 갓 센 값은 분명히 달랐다 — 같은 자리로 보이는 것은 **기억이 이겼기 때문**이다", () => {
    const fresh = layoutOf(EDGES_AFTER_DELETE);
    const first = applyProcedureAutoLayoutMemory(layoutOf(EDGES), new Map());
    const second = applyProcedureAutoLayoutMemory(fresh, first.remembered);
    const differsFromFresh = movedBetween(fresh, second.layout);
    assert.equal(differsFromFresh.length, NODES.length, "갓 센 값과 한 칸도 안 다르면 기억이 아무 일도 안 한 것이다");
  });
});

describe("자동 배치 기억 — ③ 새로 만든 칸은 여전히 자동으로 놓인다", () => {
  /**
   * 🔴 이 묶음이 없으면 「전부 얼린다」는 구현이 통과한다. 그러면 새 노드가 자리를
   * 못 받아 (0,0) 에 겹쳐 쌓인다 — 신고된 결함보다 나쁜 자리다.
   */
  test("🔴 기억에 없는 칸은 **갓 센 자리를 그대로** 받는다", () => {
    const first = applyProcedureAutoLayoutMemory(layoutOf(EDGES), new Map());

    const withNew = [...NODES, node("new", 8, "가짜 새 단계")];
    const freshWithNew = computeProcedureAutoLayout({ nodes: withNew, edges: EDGES });
    assert.ok(freshWithNew.has("new"), "표본 확인 — 자동 배치가 새 칸을 안 세우면 아래가 뜻을 잃는다");

    const second = applyProcedureAutoLayoutMemory(freshWithNew, first.remembered);
    assert.deepEqual(second.layout.get("new"), freshWithNew.get("new"), "처음 보는 칸은 갓 센 자리여야 한다");
    assert.notDeepEqual(second.layout.get("new"), { x: 0, y: 0 }, "(0,0) 이면 자동 배치를 안 탄 것이다");
    // 그 와중에 기존 여덟 칸은 여전히 제자리다.
    assert.deepEqual(movedBetween(first.layout, second.layout), []);
  });
});

describe("자동 배치 기억 — ④ 안 바뀌는 화면은 한 픽셀도 안 바뀐다", () => {
  /**
   * 읽기 전용 셋(절차 상세 · 실행 시작 노드 고르기 · 「전체 단계 보기」)은 노드도
   * 선도 안 바뀐다. 그 화면들이 **전과 글자 그대로 같다**는 근거가 이 둘이다.
   */
  test("🔵 기억이 비면 갓 센 값 **그대로** 돌려준다", () => {
    const fresh = layoutOf(EDGES);
    const applied = applyProcedureAutoLayoutMemory(fresh, new Map());
    assert.deepEqual([...applied.layout.entries()], [...fresh.entries()]);
  });

  test("🔵 같은 입력으로 몇 번을 다시 그려도 값이 안 바뀐다", () => {
    let memory: ProcedureAutoLayoutMemory = new Map();
    const fresh = layoutOf(EDGES);
    for (let i = 0; i < 3; i++) {
      const applied = applyProcedureAutoLayoutMemory(fresh, memory);
      assert.deepEqual([...applied.layout.entries()], [...fresh.entries()], `${i + 1}번째 렌더에서 값이 갈렸다`);
      memory = applied.remembered;
    }
  });
});

describe("자동 배치 기억 — ⑤ 기억 자체의 규칙", () => {
  test("🔴 이번에 안 들어온 칸은 기억에서 **지운다** — 기억이 끝없이 자라지 않는다", () => {
    const first = applyProcedureAutoLayoutMemory(layoutOf(EDGES), new Map());
    const remaining = NODES.filter((n) => n.id !== "tail");
    const second = applyProcedureAutoLayoutMemory(
      computeProcedureAutoLayout({ nodes: remaining, edges: EDGES_AFTER_DELETE }),
      first.remembered
    );
    assert.equal(second.remembered.size, remaining.length);
    assert.ok(!second.remembered.has("tail"), "사라진 칸이 기억에 남으면 같은 id 가 되살아날 때 옛 자리가 얹힌다");
  });

  test("🔴 돌려준 기억은 **그리는 지도와 다른 객체**다 — 한쪽을 고쳐도 다른 쪽이 안 바뀐다", () => {
    const applied = applyProcedureAutoLayoutMemory(layoutOf(EDGES), new Map());
    assert.notEqual(applied.remembered, applied.layout);
    applied.layout.set("c1", { x: -9999, y: -9999 });
    assert.notDeepEqual(applied.remembered.get("c1"), { x: -9999, y: -9999 });
  });

  /**
   * 🔴 **부르는 쪽의 렌더가 멈추는 근거가 이 한 줄이다.** 그림은 돌려받은 기억을
   * state 에 담고 그 state 를 보고 다시 부른다 — 안 바뀌었는데도 새 지도를 돌려주면
   * 담기–다시 그리기가 끝없이 돈다(ProcedureFlowGraph 의 setAutoLayoutMemory 주석).
   */
  test("🔴 칸이 안 늘고 안 줄었으면 **넘긴 기억을 그 객체 그대로** 돌려준다", () => {
    const first = applyProcedureAutoLayoutMemory(layoutOf(EDGES), new Map());
    // 선을 지워도 칸 수는 그대로다 → 기억도 그대로여야 한다.
    const second = applyProcedureAutoLayoutMemory(layoutOf(EDGES_AFTER_DELETE), first.remembered);
    assert.equal(second.remembered, first.remembered, "신원이 바뀌면 부르는 쪽이 영영 다시 그린다");
    // 그래도 그리는 자리는 제대로 나온다 — 신원을 지키느라 값을 포기하면 안 된다.
    // 🔵 **차례로 맞대면 안 된다** — 지도에 담기는 차례는 갓 센 쪽이 정하고, 선이
    //    끊기면 그 칸이 뿌리가 되어 앞으로 당겨진다(값은 그대로인데 차례만 바뀐다).
    assert.equal(second.layout.size, first.layout.size);
    assert.deepEqual(movedBetween(first.layout, second.layout), []);
  });

  test("🔴 칸이 **하나라도 늘거나 줄면** 새 기억을 돌려준다 — 그때는 담아야 한다", () => {
    const first = applyProcedureAutoLayoutMemory(layoutOf(EDGES), new Map());
    const withNew = [...NODES, node("new", 8, "가짜 새 단계")];
    const grown = applyProcedureAutoLayoutMemory(computeProcedureAutoLayout({ nodes: withNew, edges: EDGES }), first.remembered);
    assert.notEqual(grown.remembered, first.remembered);
    assert.equal(grown.remembered.size, withNew.length);

    const remaining = NODES.filter((n) => n.id !== "tail");
    const shrunk = applyProcedureAutoLayoutMemory(
      computeProcedureAutoLayout({ nodes: remaining, edges: EDGES_AFTER_DELETE }),
      first.remembered
    );
    assert.notEqual(shrunk.remembered, first.remembered);
    assert.equal(shrunk.remembered.size, remaining.length);
  });

  test("🔵 기억이 **갓 센 지도에 없는 칸**을 들고 있어도 그 칸이 되살아나지 않는다", () => {
    const fresh = layoutOf(EDGES);
    const stale = new Map([["사라진칸", { x: 1, y: 2 }]]);
    const applied = applyProcedureAutoLayoutMemory(fresh, stale);
    assert.ok(!applied.layout.has("사라진칸"));
    assert.equal(applied.layout.size, fresh.size);
  });
});
