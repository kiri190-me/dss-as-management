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
 *
 * ── 🔴 그 이튿날(2026-11-21) 두 번째 신고가 ⑥절을 더했다 ─────────────────────────────
 * 「연결선을 없앤 뒤 노드를 없애고 [이전]으로 되돌리니 엉뚱한 자리에 노드가 뜬다.」
 * 첫 판의 「이번에 안 들어온 칸은 기억에서 지운다」가 그 원인이었고, ⑤절의 단언 둘이
 * **그 틀린 규칙을 지키고 있었다** — 지우지 않고 뒤집었다(각 시험 위 주석에 까닭).
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

/**
 * 2026-11-21 두 번째 신고용 — **`c3 → done` 선**을 뺀 목록과 **`done` 노드**를 뺀 목록.
 * 신고된 차례가 「선을 지우고 → 그 선이 가리키던 노드를 지우고 → [이전]」이라
 * 지형이 셋 필요하다: 선이 있던 때 · 선만 없는 때 · 선도 노드도 없는 때.
 */
const EDGES_WITHOUT_DONE_LINK = EDGES.filter((e) => !(e.fromNodeId === "c3" && e.toNodeId === "done"));
const NODES_WITHOUT_DONE = NODES.filter((n) => n.id !== "done");

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
  /**
   * 🔴 **2026-11-21 에 이 단언이 뒤집혔다.** 전에는 「이번에 안 들어온 칸은 기억에서
   * **지운다** — 기억이 끝없이 자라지 않는다」였고, 메시지에는 「사라진 칸이 기억에
   * 남으면 같은 id 가 되살아날 때 옛 자리가 얹힌다」고 적혀 있었다. **옛 자리가
   * 얹히는 것이 바로 우리가 원하는 것**이었음이 두 번째 신고로 드러났다(⑥절) —
   * 지우면 되살아난 칸만 다른 지형에서 다시 세어져 날아간다.
   *
   * 🔵 그때 내세웠던 「무한 성장」은 값으로 따져 보니 걱정거리가 아니었다(칸당 약
   * 600바이트 · 화면이 닫히거나 절차가 바뀌면 통째로 비워짐 — 까닭은
   * applyProcedureAutoLayoutMemory 주석에). 시험을 지우지 않고 **뒤집어** 둔다.
   */
  test("🔴 이번에 안 들어온 칸은 기억에서 **안 지운다** — 돌아올 때 쓸 자리를 들고 있는다", () => {
    const first = applyProcedureAutoLayoutMemory(layoutOf(EDGES), new Map());
    const remaining = NODES.filter((n) => n.id !== "tail");
    const second = applyProcedureAutoLayoutMemory(
      computeProcedureAutoLayout({ nodes: remaining, edges: EDGES_AFTER_DELETE }),
      first.remembered
    );
    // 그림에서는 분명히 빠졌다 — 기억에 남는 것이 「안 지워진다」는 뜻은 아니다.
    assert.equal(second.layout.size, remaining.length);
    assert.ok(!second.layout.has("tail"));
    // 🔴 기억에는 **원래 자리 그대로** 남아 있다.
    assert.equal(second.remembered.size, NODES.length);
    assert.deepEqual(second.remembered.get("tail"), first.remembered.get("tail"), "되살아날 때 돌려줄 자리가 바로 이것이다");
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

  test("🔴 **처음 보는 칸이 하나라도 있으면** 새 기억을 돌려준다 — 그때는 담아야 한다", () => {
    const first = applyProcedureAutoLayoutMemory(layoutOf(EDGES), new Map());
    const withNew = [...NODES, node("new", 8, "가짜 새 단계")];
    const grown = applyProcedureAutoLayoutMemory(computeProcedureAutoLayout({ nodes: withNew, edges: EDGES }), first.remembered);
    assert.notEqual(grown.remembered, first.remembered);
    assert.equal(grown.remembered.size, withNew.length);
    // 넘어온 기억을 **제자리에서 고치면** 안 된다 — 부르는 쪽 state 가 조용히 바뀐다.
    assert.equal(first.remembered.size, NODES.length, "넘긴 기억이 함께 자랐다");
  });

  /**
   * 🔴 **잣대가 「수가 같은가」면 안 된다**(2026-11-21 두 번째 신고와 한 몸이다).
   * 기억이 이제 안 줄어들므로 노드를 하나 지우면 `기억 > 갓 센 지도` 가 **정상**이다.
   * 수를 맞대는 구현은 그 뒤로 「바뀌었다」를 영영 참으로 읽어, 고치려던 결함 대신
   * **끝없이 다시 그리기**를 얻는다(ProcedureFlowGraph 의 setAutoLayoutMemory 주석).
   */
  test("🔴 칸이 **줄기만 했으면** 기억은 그 객체 그대로 — 수가 달라져도 담을 것이 없다", () => {
    const first = applyProcedureAutoLayoutMemory(layoutOf(EDGES), new Map());
    const remaining = NODES.filter((n) => n.id !== "tail");
    const shrunk = applyProcedureAutoLayoutMemory(
      computeProcedureAutoLayout({ nodes: remaining, edges: EDGES_AFTER_DELETE }),
      first.remembered
    );
    assert.equal(shrunk.remembered, first.remembered, "신원이 바뀌면 부르는 쪽이 영영 다시 그린다");
    assert.notEqual(shrunk.remembered.size, shrunk.layout.size, "표본 확인 — 수가 실제로 갈려 있어야 이 시험이 뜻을 가진다");
  });

  test("🔵 기억이 **갓 센 지도에 없는 칸**을 들고 있어도 그 칸이 되살아나지 않는다", () => {
    const fresh = layoutOf(EDGES);
    const stale = new Map([["사라진칸", { x: 1, y: 2 }]]);
    const applied = applyProcedureAutoLayoutMemory(fresh, stale);
    assert.ok(!applied.layout.has("사라진칸"));
    assert.equal(applied.layout.size, fresh.size);
  });
});

/**
 * ============================================================================
 * 🔴 ⑥ **선을 지우고 → 노드를 지우고 → [이전]** (2026-11-21 두 번째 신고)
 * ============================================================================
 * 쓰는 분이 밟은 차례 그대로다: 「`작업 → 완료` 선을 지우고(자리 그대로 ✅), `완료`
 * 노드를 지우고, [이전]을 누르니 **완료 노드가 오른쪽 아래 엉뚱한 자리**에 뜬다.」
 *
 * 🔴 **까닭은 첫 규칙의 괄호 한 줄이 틀렸기 때문**이다. 2026-11-20 첫 판은 「이번에
 * 안 들어온 칸은 기억에서 지운다 — 되돌리면 **선도 함께 돌아오니** 갓 센 값이 곧
 * 원래 값이다」라고 적었다. 선을 **먼저** 지우고 노드를 지우면 그 전제가 깨진다:
 * [이전]은 바로 앞 한 칸만 되돌리므로 **노드만 돌아오고 선은 아직 안 돌아온다.**
 * 그러면 그 칸은 「선 없는 지형」에서 갓 세어지고 둘레는 「선 있던 시절」에 얼어
 * 있어, **두 지형이 섞여** 그 칸 하나만 날아간다.
 *
 * 아래 ⑥-가 가 그 값을 못 박는다(고치기 전 규칙으로 돌리면 `done` 이 가로로 +300).
 * ============================================================================
 */

/**
 * 🔴 **고치기 전 규칙**(2026-11-20 첫 판)을 그대로 흉내 낸 것. 진짜 함수가 아니다 —
 * 「이번에 안 들어온 칸은 기억에서 지운다」 한 줄만 다르다. 이것이 있어야 ⑥-가 의
 * 「틀린 자리」가 **지금 코드에서도 값으로** 남고, 다음 사람이 「정말 깨졌었나」를
 * 다시 재현하지 않아도 된다.
 */
function applyMemoryTheOldWay(
  fresh: ReadonlyMap<string, { x: number; y: number }>,
  remembered: ProcedureAutoLayoutMemory
): { layout: Map<string, { x: number; y: number }>; remembered: ProcedureAutoLayoutMemory } {
  const layout = new Map<string, { x: number; y: number }>();
  for (const [id, position] of fresh) layout.set(id, remembered.get(id) ?? position);
  return { layout, remembered: new Map(layout) };
}

describe("자동 배치 기억 — ⑥ 선을 지우고 노드를 지운 뒤 [이전]", () => {
  /**
   * 🔵 **표본이 이빨을 가졌는지 먼저 센다.** 「되살아난 칸이 제자리다」는 애초에
   * 갓 센 값이 같으면 공짜로 통과한다 — 선이 빠진 지형에서 `done` 의 자리가 정말
   * 달라지는지부터 값으로 봐 둔다.
   */
  test("🔵 표본 확인 — 선이 빠지면 `done` 의 **갓 센 자리**가 가로로 한 칸(+300) 옮겨간다", () => {
    const before = layoutOf(EDGES).get("done");
    const after = layoutOf(EDGES_WITHOUT_DONE_LINK).get("done");
    assert.ok(before && after, "표본에 done 이 없으면 아래가 전부 뜻을 잃는다");
    assert.notDeepEqual(after, before, "두 지형에서 자리가 같으면 이 시험은 아무것도 안 잰다");
    assert.equal(after.x - before.x, 300, `갓 센 값이 ${before.x} → ${after.x} 로 움직인다`);
    assert.equal(after.y - before.y, 0);
  });

  test("🔴 **고치기 전 규칙이면 틀린다** — 되살아난 `완료` 가 오른쪽으로 한 칸 날아간다", () => {
    const first = applyMemoryTheOldWay(layoutOf(EDGES), new Map());
    const edgeGone = applyMemoryTheOldWay(layoutOf(EDGES_WITHOUT_DONE_LINK), first.remembered);
    const nodeGone = applyMemoryTheOldWay(
      computeProcedureAutoLayout({ nodes: NODES_WITHOUT_DONE, edges: EDGES_WITHOUT_DONE_LINK }),
      edgeGone.remembered
    );
    assert.ok(!nodeGone.remembered.has("done"), "옛 규칙은 사라진 칸을 기억에서 지운다 — 그것이 결함의 씨앗이다");
    const undone = applyMemoryTheOldWay(layoutOf(EDGES_WITHOUT_DONE_LINK), nodeGone.remembered);

    const moved = movedBetween(first.layout, undone.layout);
    assert.deepEqual(
      moved,
      [{ id: "done", dx: 300, dy: 0 }],
      `신고된 결함이 이 값이다(되살아난 칸만 날아간다): ${JSON.stringify(moved)}`
    );
  });

  test("🔴 **지금 규칙이면 제자리** — 선을 지우고 노드를 지운 뒤 되살려도 원래 자리다", () => {
    // ① 처음 그린다.
    const first = applyProcedureAutoLayoutMemory(layoutOf(EDGES), new Map());
    const originalDone = first.layout.get("done");
    assert.ok(originalDone, "표본 확인 — done 이 없으면 아래가 뜻을 잃는다");

    // ② `c3 → done` 선을 지운다 → 앞 커밋이 고친 것: 자리가 그대로다.
    const edgeGone = applyProcedureAutoLayoutMemory(layoutOf(EDGES_WITHOUT_DONE_LINK), first.remembered);
    assert.deepEqual(movedBetween(first.layout, edgeGone.layout), [], "앞 커밋이 고친 것이 깨졌다 — 선만 지워도 튄다");

    // ③ `done` 노드를 지운다 → 그림에서 사라진다.
    const nodeGone = applyProcedureAutoLayoutMemory(
      computeProcedureAutoLayout({ nodes: NODES_WITHOUT_DONE, edges: EDGES_WITHOUT_DONE_LINK }),
      edgeGone.remembered
    );
    assert.ok(!nodeGone.layout.has("done"), "지운 칸이 그림에 남으면 아래가 뜻을 잃는다");

    // ④ [이전] — 🔴 **노드만** 돌아온다(선은 한 칸 더 되돌려야 돌아온다).
    const undone = applyProcedureAutoLayoutMemory(layoutOf(EDGES_WITHOUT_DONE_LINK), nodeGone.remembered);
    assert.deepEqual(undone.layout.get("done"), originalDone, "되살아난 칸이 원래 자리가 아니다 — 신고된 결함 그대로다");
    assert.deepEqual(movedBetween(first.layout, undone.layout), [], "되살아난 칸 말고도 움직인 칸이 있다");
  });

  test("🔴 **선까지 한 칸 더 되돌려도** 제자리 — 두 번째 [이전]에서 다시 안 튄다", () => {
    const first = applyProcedureAutoLayoutMemory(layoutOf(EDGES), new Map());
    const edgeGone = applyProcedureAutoLayoutMemory(layoutOf(EDGES_WITHOUT_DONE_LINK), first.remembered);
    const nodeGone = applyProcedureAutoLayoutMemory(
      computeProcedureAutoLayout({ nodes: NODES_WITHOUT_DONE, edges: EDGES_WITHOUT_DONE_LINK }),
      edgeGone.remembered
    );
    const undoneOnce = applyProcedureAutoLayoutMemory(layoutOf(EDGES_WITHOUT_DONE_LINK), nodeGone.remembered);
    const undoneTwice = applyProcedureAutoLayoutMemory(layoutOf(EDGES), undoneOnce.remembered);
    assert.deepEqual(movedBetween(first.layout, undoneTwice.layout), []);
  });

  /**
   * 🔴 **되살아난 칸이 「기억이 이겨서」 제자리인지**를 갈라 둔다. 이 묶음이 없으면
   * 「갓 센 값이 어쩌다 같았다」와 구별이 안 된다 — ⑥-가 가 +300 을 못 박고 있지만,
   * 거기는 옛 규칙을 흉내 낸 가짜 함수라 진짜 함수 쪽에서도 한 번 더 본다.
   */
  test("🔵 되살아난 칸의 자리는 **갓 센 값과 분명히 다르다**", () => {
    const first = applyProcedureAutoLayoutMemory(layoutOf(EDGES), new Map());
    const edgeGone = applyProcedureAutoLayoutMemory(layoutOf(EDGES_WITHOUT_DONE_LINK), first.remembered);
    const nodeGone = applyProcedureAutoLayoutMemory(
      computeProcedureAutoLayout({ nodes: NODES_WITHOUT_DONE, edges: EDGES_WITHOUT_DONE_LINK }),
      edgeGone.remembered
    );
    const fresh = layoutOf(EDGES_WITHOUT_DONE_LINK);
    const undone = applyProcedureAutoLayoutMemory(fresh, nodeGone.remembered);
    assert.notDeepEqual(undone.layout.get("done"), fresh.get("done"), "갓 센 값과 같으면 기억이 아무 일도 안 한 것이다");
  });

  /**
   * 🔴 **그 와중에도 처음 보는 칸은 갓 센 자리**여야 한다. 「지워진 칸을 기억한다」가
   * 「기억에 있는 칸은 무조건 되살린다」로 번지면, 삭제했다 만든 **다른** 노드가
   * 자동 배치를 못 받는다.
   */
  test("🔴 지운 칸을 기억해도 — **처음 보는 칸**은 여전히 갓 센 자리를 받는다", () => {
    const first = applyProcedureAutoLayoutMemory(layoutOf(EDGES), new Map());
    const nodeGone = applyProcedureAutoLayoutMemory(
      computeProcedureAutoLayout({ nodes: NODES_WITHOUT_DONE, edges: EDGES_WITHOUT_DONE_LINK }),
      first.remembered
    );
    const withNew = [...NODES_WITHOUT_DONE, node("tmp:node:9", 9, "가짜 새 단계")];
    const freshWithNew = computeProcedureAutoLayout({ nodes: withNew, edges: EDGES_WITHOUT_DONE_LINK });
    const applied = applyProcedureAutoLayoutMemory(freshWithNew, nodeGone.remembered);
    assert.deepEqual(applied.layout.get("tmp:node:9"), freshWithNew.get("tmp:node:9"));
    // 지워진 `done` 은 기억에만 있고 **그림에는 안 돌아온다**.
    assert.ok(!applied.layout.has("done"));
    assert.ok(applied.remembered.has("done"));
  });
});
