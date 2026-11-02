import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildProcedureExecutionMinimap,
  MINIMAP_BACKWARD_STEPS,
  MINIMAP_FORWARD_STEPS,
  MINIMAP_MAX_STEPS_PER_LEVEL,
  type MinimapEdge,
  type MinimapLevel,
  type ProcedureExecutionMinimap,
} from "./procedure-execution-minimap";
import type { ProcedureBranchType } from "./procedure-template-types";

/**
 * 작은 흐름 그림이 **어느 걸음을 고르는가**와, 🔴 **언제 안 그리는가**.
 *
 * 🔵 표본이 비어 공짜로 통과하지 않게 「무엇을 재는가」를 먼저 못 박는다 —
 * 걸음 수 상수가 몇인지, 실측 표본의 간선이 실제로 몇 개인지.
 *
 * 🔴 고리가 있는 절차가 실제로 있다(「재측정」이 앞으로 되돌아간다). 고리
 * 시험이 깨지면 그 자리에서 **시험이 안 끝난다** — 무한 반복은 실패가 아니라
 * 멈춤으로 나타난다.
 */

type TestNode = { id: string; procedureTemplateNodeId: string | null; orderIndex: number; title: string };

/** 1..count 번 노드. 실행 행 id 는 e·템플릿 노드 id 는 t 로 갈라 둔다 — 둘을 뒤바꿔 써도 시험이 통과하는 일이 없게. */
function makeNodes(count: number): TestNode[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `e${i + 1}`,
    procedureTemplateNodeId: `t${i + 1}`,
    orderIndex: i + 1,
    title: `작업 ${i + 1}`,
  }));
}

function edge(from: number | string, to: number | string, branchType: ProcedureBranchType = "DEFAULT", branchLabel: string | null = null): MinimapEdge {
  const fromNodeId = typeof from === "number" ? `t${from}` : from;
  const toNodeId = typeof to === "number" ? `t${to}` : to;
  return { id: `edge:${fromNodeId}->${toNodeId}`, fromNodeId, toNodeId, branchType, branchLabel };
}

/** 곧은 길 1 → 2 → … → count. */
function chainEdges(count: number): MinimapEdge[] {
  return Array.from({ length: count - 1 }, (_, i) => edge(i + 1, i + 2));
}

function levelNumbers(levels: readonly MinimapLevel<TestNode>[]): number[][] {
  return levels.map((level) => level.steps.map((step) => step.node.orderIndex));
}

function expectGraph(minimap: ProcedureExecutionMinimap<TestNode>) {
  assert.equal(minimap.kind, "GRAPH", `그림이 나와야 하는데 ${minimap.kind} 였다`);
  if (minimap.kind !== "GRAPH") throw new Error("unreachable");
  return minimap;
}

function build(nodes: TestNode[], edges: MinimapEdge[], currentOrderIndex: number | null) {
  return buildProcedureExecutionMinimap({
    nodes,
    edges,
    current: currentOrderIndex === null ? null : (nodes.find((n) => n.orderIndex === currentOrderIndex) ?? null),
  });
}

describe("🔵 먼저 — 이 시험이 무엇을 재는지", () => {
  test("걸음 수 상수가 작은 값이다 — 커지면 띠가 화면을 밀어낸다", () => {
    assert.equal(MINIMAP_BACKWARD_STEPS, 2);
    assert.equal(MINIMAP_FORWARD_STEPS, 3);
    assert.equal(MINIMAP_MAX_STEPS_PER_LEVEL, 4);
  });

  test("표본 확인 — 곧은 길 표본이 실제로 이어져 있다", () => {
    const edges = chainEdges(10);
    assert.equal(edges.length, 9, "간선이 없으면 아래 시험들이 전부 「안 그린다」로 공짜 통과한다");
    assert.deepEqual(
      edges.map((e) => `${e.fromNodeId}->${e.toNodeId}`).slice(0, 3),
      ["t1->t2", "t2->t3", "t3->t4"]
    );
  });
});

describe("🔴 안 그리는 경우", () => {
  test("절차 전체에 간선이 0 — 띠를 통째로 안 그린다", () => {
    const minimap = build(makeNodes(5), [], 1);
    assert.deepEqual(minimap, { kind: "HIDDEN", reason: "NO_LINKED_STEPS_AT_ALL" });
  });

  test("🔴 간선은 있는데 **양끝이 다 칸이 되는** 선이 없으면 역시 통째로 안 그린다", () => {
    // 실측한 절차의 간선 8개 가운데 하나는 START 에서 나가는 선이다. START 는
    // 사람이 할 일 목록에 아예 없으므로(getExecutionDetail 이 뺀다) 그 선으로는
    // 칸을 둘 만들 수 없다. 원본 간선 수로 「그릴 수 있다」를 판정하면 여기서
    // 빈 그림이 선다.
    const edges = [edge("t-start", 1), edge(2, "t-reference")];
    assert.equal(edges.length, 2, "표본 확인 — 간선 자체는 있다");
    assert.deepEqual(build(makeNodes(3), edges, 1), { kind: "HIDDEN", reason: "NO_LINKED_STEPS_AT_ALL" });
  });

  test("지금 할 일이 없으면(다 끝났거나 전부 차단됨) 통째로 안 그린다", () => {
    assert.deepEqual(build(makeNodes(5), chainEdges(5), null), { kind: "HIDDEN", reason: "NO_CURRENT_TASK" });
  });

  test("🔴 지금 노드에 선이 하나도 안 붙었으면 — 점 하나 대신 **한 줄**", () => {
    // 실측: 22장 가운데 14장이 이 경우다.
    const minimap = build(makeNodes(5), [edge(1, 2)], 4);
    assert.deepEqual(minimap, { kind: "NOTE", reason: "CURRENT_HAS_NO_LINKED_STEP" });
  });

  test("지금 노드가 사례별 추가 작업이면 까닭이 다르다 — 그래프에 자리 자체가 없다", () => {
    const nodes = makeNodes(3);
    const extra: TestNode = { id: "e99", procedureTemplateNodeId: null, orderIndex: 4, title: "추가 작업" };
    const minimap = buildProcedureExecutionMinimap({ nodes: [...nodes, extra], edges: chainEdges(3), current: extra });
    assert.deepEqual(minimap, { kind: "NOTE", reason: "CURRENT_IS_EXTRA_TASK" });
  });

  test("선이 한 쪽에만 붙어 있으면 그린다 — 한 줄로 떨어뜨리지 않는다", () => {
    const onlyIncoming = expectGraph(build(makeNodes(3), [edge(1, 2)], 2));
    assert.deepEqual(levelNumbers(onlyIncoming.backward), [[1]]);
    assert.deepEqual(levelNumbers(onlyIncoming.forward), []);

    const onlyOutgoing = expectGraph(build(makeNodes(3), [edge(1, 2)], 1));
    assert.deepEqual(levelNumbers(onlyOutgoing.backward), []);
    assert.deepEqual(levelNumbers(onlyOutgoing.forward), [[2]]);
  });
});

describe("몇 걸음까지 모으는가", () => {
  test("🔴 지난 쪽 2걸음 · 다음 쪽 3걸음을 넘지 않는다 — 길이 더 길어도", () => {
    const minimap = expectGraph(build(makeNodes(10), chainEdges(10), 5));
    assert.deepEqual(levelNumbers(minimap.backward), [[4], [3]], "지난 쪽은 **가까운 것부터** 쌓인다");
    assert.deepEqual(levelNumbers(minimap.forward), [[6], [7], [8]]);
    assert.ok(minimap.backward.length <= MINIMAP_BACKWARD_STEPS);
    assert.ok(minimap.forward.length <= MINIMAP_FORWARD_STEPS);
    assert.equal(minimap.current.orderIndex, 5);
  });

  test("길이 짧으면 있는 만큼만 — 없는 걸음을 빈 칸으로 채우지 않는다", () => {
    const minimap = expectGraph(build(makeNodes(3), chainEdges(3), 2));
    assert.deepEqual(levelNumbers(minimap.backward), [[1]]);
    assert.deepEqual(levelNumbers(minimap.forward), [[3]]);
  });

  test("실행 행이 없는 노드(START·참고 문서)는 칸이 되지 않고, 거기서 걸음이 끊긴다", () => {
    const nodes = makeNodes(3);
    const edges = [edge("t-start", 1), edge(1, 2), edge(2, "t-reference"), edge(2, 3)];
    const minimap = expectGraph(build(nodes, edges, 2));
    assert.deepEqual(levelNumbers(minimap.backward), [[1]], "START 는 칸이 아니므로 1번이 끝이다");
    assert.deepEqual(levelNumbers(minimap.forward), [[3]], "참고 문서로 가는 선은 칸을 만들지 않는다");
  });
});

describe("🔴 판단 노드 — 갈래가 여럿이면 함께 나온다", () => {
  test("나가는 갈래 둘이 **한 걸음에 나란히** 선다", () => {
    const nodes = makeNodes(5);
    const edges = [edge(1, 2), edge(2, 4, "NORMAL", "정상"), edge(2, 3, "NG", "NG")];
    const minimap = expectGraph(build(nodes, edges, 2));
    assert.deepEqual(levelNumbers(minimap.forward), [[4, 3]]);
    assert.equal(minimap.forward[0].steps.length, 2);
  });

  test("🔴 갈래 차례는 **간선 차례 그대로** — 번호순으로 다시 세우지 않는다", () => {
    // 조회가 간선을 sort_order 로 정렬해 내려준다. 여기서 다시 세우면 띠의
    // 「정상 / NG」와 바로 아래 갈래 단추의 「정상 / NG」가 자리를 바꾼다.
    const nodes = makeNodes(9);
    const edges = [edge(1, 9, "NORMAL", "정상"), edge(1, 3, "NG", "NG")];
    const minimap = expectGraph(build(nodes, edges, 1));
    assert.deepEqual(levelNumbers(minimap.forward), [[9, 3]], "9 가 3 보다 먼저 와야 한다(간선 차례)");
  });

  test("갈래 이름과 간선 식별자가 칸마다 실려 온다 — 화살표에 적을 재료", () => {
    const nodes = makeNodes(4);
    const edges = [edge(1, 3, "NORMAL", "정상"), edge(1, 4, "RETRY", null)];
    const minimap = expectGraph(build(nodes, edges, 1));
    assert.deepEqual(
      minimap.forward[0].steps.map((s) => s.via),
      [
        { edgeId: "edge:t1->t3", branchType: "NORMAL", branchLabel: "정상" },
        { edgeId: "edge:t1->t4", branchType: "RETRY", branchLabel: null },
      ]
    );
  });

  test("🔴 갈래가 벌어지면 **거기서 멈춘다** — 갈래마다 한 걸음까지만", () => {
    const nodes = makeNodes(6);
    const edges = [edge(1, 2), edge(2, 3), edge(2, 4), edge(3, 5), edge(4, 6)];
    const minimap = expectGraph(build(nodes, edges, 1));
    assert.deepEqual(levelNumbers(minimap.forward), [[2], [3, 4]], "3걸음까지 갈 수 있어도 갈래에서 끊는다");
    const drawn = minimap.forward.flatMap((l) => l.steps.map((s) => s.node.orderIndex));
    assert.ok(!drawn.includes(5) && !drawn.includes(6), "갈래 너머는 그리지 않는다 — 걸음마다 칸이 곱해진다");
  });

  test("들어오는 선이 여럿 모이는 자리도 함께 보여 준다 — 어디서 왔는지가 갈려 있다", () => {
    const nodes = makeNodes(5);
    const edges = [edge(2, 5), edge(3, 5), edge(4, 5)];
    const minimap = expectGraph(build(nodes, edges, 5));
    assert.deepEqual(levelNumbers(minimap.backward), [[2, 3, 4]]);
  });

  test("한 걸음에 세울 칸에는 뚜껑이 있다 — 넘치는 수를 세어 돌려준다", () => {
    const nodes = makeNodes(8);
    const edges = [edge(1, 2), edge(1, 3), edge(1, 4), edge(1, 5), edge(1, 6), edge(1, 7)];
    const minimap = expectGraph(build(nodes, edges, 1));
    assert.equal(minimap.forward.length, 1);
    assert.equal(minimap.forward[0].steps.length, MINIMAP_MAX_STEPS_PER_LEVEL);
    assert.equal(minimap.forward[0].omittedCount, 2, "6개 중 4개만 그리고 2개는 수로 알린다");
    assert.deepEqual(levelNumbers(minimap.forward), [[2, 3, 4, 5]]);
  });

  test("뚜껑에 안 닿으면 넘친 수는 0 이다 — 「외 0」이 화면에 뜨면 안 된다", () => {
    const minimap = expectGraph(build(makeNodes(4), [edge(1, 2), edge(1, 3)], 1));
    assert.equal(minimap.forward[0].omittedCount, 0);
  });
});

describe("🔴 고리 — 「재측정」이 앞으로 되돌아간다", () => {
  test("세 노드 고리에서 끝난다(무한 반복하면 이 시험은 실패가 아니라 **안 끝난다**)", () => {
    const nodes = makeNodes(3);
    const edges = [edge(1, 2), edge(2, 3), edge(3, 1)];
    const minimap = expectGraph(build(nodes, edges, 2));
    assert.deepEqual(levelNumbers(minimap.forward), [[3], [1]], "한 바퀴 돌아 1번까지 가고 2번에서 막힌다");
    assert.deepEqual(levelNumbers(minimap.backward), [[1], [3]]);
  });

  test("🔴 한 방향 안에서 같은 칸이 두 번 나오지 않는다", () => {
    const nodes = makeNodes(2);
    // 서로 되돌아가는 가장 짧은 고리 — 걸음 수만으로 막으면 여기서 되풀이된다.
    const edges = [edge(1, 2), edge(2, 1)];
    const minimap = expectGraph(build(nodes, edges, 1));
    for (const [name, levels] of [["다음", minimap.forward], ["지난", minimap.backward]] as const) {
      const drawn = levels.flatMap((l) => l.steps.map((s) => s.node.id));
      assert.deepEqual([...new Set(drawn)], drawn, `${name} 쪽에 같은 칸이 두 번 있다`);
    }
  });

  test("🔴 지금 자리로 되돌아오는 고리에서도 「지금」 칸이 띠 안에 두 번 생기지 않는다", () => {
    const nodes = makeNodes(3);
    const edges = [edge(1, 2), edge(2, 3), edge(3, 1)];
    const minimap = expectGraph(build(nodes, edges, 1));
    const drawn = [...minimap.forward, ...minimap.backward].flatMap((l) => l.steps.map((s) => s.node.id));
    assert.ok(!drawn.includes(minimap.current.id), "지금 자리는 가운데 한 칸뿐이다");
  });

  test("🔴 같은 노드가 **양쪽에** 나오는 것은 맞다 — 왔던 곳이자 돌아갈 곳이다", () => {
    const nodes = makeNodes(2);
    const minimap = expectGraph(build(nodes, [edge(1, 2), edge(2, 1)], 2));
    assert.deepEqual(levelNumbers(minimap.backward), [[1]]);
    assert.deepEqual(levelNumbers(minimap.forward), [[1]], "방향마다 따로 기억하지 않으면 고리가 화면에서 사라진다");
  });
});

describe("실측한 절차 모양 — 노드 22 · 사람이 할 일끼리 잇는 선 7", () => {
  /**
   * 「원복 검사 및 개선 작업 (3상 입력)」의 실제 그래프 모양이다(2026-11-02
   * 실측, 제목은 일반화). 노드 23개 가운데 START 가 빠져 22장이고, 간선 8개
   * 가운데 하나가 START 에서 나가므로 **칸을 둘 만드는 선은 7개**다.
   */
  const nodes = makeNodes(22);
  const edges = [
    edge("t-start", 1),
    edge(3, 12, "NORMAL", "정상"),
    edge(1, 2),
    edge(2, 3, "NORMAL", "정상"),
    edge(8, 6),
    edge(3, 8),
    edge(9, 7),
    edge(8, 9),
  ];

  test("🔵 표본 확인 — 선이 8개이고 그중 하나는 START 에서 나간다", () => {
    assert.equal(nodes.length, 22);
    assert.equal(edges.length, 8);
    assert.equal(edges.filter((e) => e.fromNodeId === "t-start").length, 1);
  });

  test("🔴 22장 가운데 14장은 선이 안 붙어 「한 줄」로 떨어지고, 8장만 그림이 선다", () => {
    const drawn = nodes.filter((n) => build(nodes, edges, n.orderIndex).kind === "GRAPH");
    const noted = nodes.filter((n) => build(nodes, edges, n.orderIndex).kind === "NOTE");
    assert.deepEqual(
      drawn.map((n) => n.orderIndex),
      [1, 2, 3, 6, 7, 8, 9, 12]
    );
    assert.equal(noted.length, 14);
  });

  test("판단 자리(3번)에서는 지난 2걸음과 갈래 둘이 함께 선다", () => {
    const minimap = expectGraph(build(nodes, edges, 3));
    assert.deepEqual(levelNumbers(minimap.backward), [[2], [1]]);
    assert.deepEqual(levelNumbers(minimap.forward), [[12, 8]]);
  });

  test("되돌아가는 선이 있는 자리(8번)도 갈래 둘로 보인다 — 번호가 뒤로 가는 쪽이 섞여 있다", () => {
    const minimap = expectGraph(build(nodes, edges, 8));
    assert.deepEqual(levelNumbers(minimap.backward), [[3], [2]]);
    assert.deepEqual(levelNumbers(minimap.forward), [[6, 9]], "6번은 번호가 뒤로 가는 선이다");
  });

  test("첫 칸(1번)은 지난 쪽이 비고 다음 쪽만 선다 — START 가 칸이 아니기 때문", () => {
    const minimap = expectGraph(build(nodes, edges, 1));
    assert.deepEqual(levelNumbers(minimap.backward), []);
    assert.deepEqual(levelNumbers(minimap.forward), [[2], [3], [12, 8]], "세 걸음째에서 갈래가 벌어지고 거기서 끝난다");
  });
});

describe("규약", () => {
  test("원본 배열을 건드리지 않는다", () => {
    const nodes = makeNodes(5);
    const edges = chainEdges(5);
    const nodesBefore = nodes.map((n) => n.id);
    const edgesBefore = edges.map((e) => e.id);
    build(nodes, edges, 3);
    assert.deepEqual(
      nodes.map((n) => n.id),
      nodesBefore
    );
    assert.deepEqual(
      edges.map((e) => e.id),
      edgesBefore
    );
  });

  test("같은 입력이면 같은 그림 — 새로고침마다 띠가 바뀌면 안 된다", () => {
    const nodes = makeNodes(6);
    const edges = [edge(1, 2), edge(2, 3), edge(2, 4), edge(5, 2), edge(6, 2)];
    assert.deepEqual(build(nodes, edges, 2), build(nodes, edges, 2));
  });
});
