import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { planStraightenEdgeOrder, type StraightenableEdge } from "./straighten-selection";
import { computeStraightenedConnectedNodePosition } from "./layout";

/**
 * ============================================================================
 * **고른 노드들 사이의 연결선을 한 번에 곧게** — 「무엇을, 어떤 차례로」
 * (2026-11-22, 조각 D1)
 * ============================================================================
 * 재는 것 넷, 전부 **오류 없이 틀린 답을 내는** 자리다:
 *  ① **한쪽만 고른 선은 뺀다** — 안 빼면 **안 고른 노드가 움직인다.** 화면에서는
 *     「왜 저게 움직였지」로 보이고, 그 노드가 화면 밖이면 아예 안 보인다.
 *  ② **차례가 앞선 노드부터**인가 — 거꾸로면 사슬이 한 줄이 안 된다. 아래 ③절이
 *     **진짜 좌표로** 그 차이를 보인다(차례만 비교하면 「왜 그 차례여야 하는가」가
 *     시험에 안 적힌다).
 *  ③ **되돌아가는 선이 섞였을 때** 멈추지도 버리지도 않는가.
 *  ④ **자기 자신을 가리키는 선**이 목록에 남지 않는가 — 남으면 「펼 선이 있다」로
 *     세어져 단추가 살아나고 [이전]이 한 번 헛돈다.
 *
 * 🔵 **표본이 비어 공짜로 통과하지 않게** 각 절이 먼저 「무엇을 재는 표본인가」를
 * 단언한다 — 이 모듈의 답은 전부 배열이라, 표본이 비면 `[]` 와 `[]` 가 같아서
 * 모든 단언이 통과한다.
 * ============================================================================
 */

type Edge = StraightenableEdge;

/** 선을 id 목록으로 — 차례가 뜻을 갖는 자리에서 쓴다. */
const ids = (edges: readonly Edge[]) => edges.map((e) => e.id);

const sel = (...nodeIds: string[]) => new Set(nodeIds);

describe("① 고른 것끼리의 선만 — 한쪽만 고른 선은 그대로 둔다", () => {
  /**
   * A→B→C 사슬에 **바깥으로 나가는 선**(A→D)과 **바깥에서 들어오는 선**(E→B),
   * 그리고 **양 끝 다 바깥인 선**(D→E)을 섞은 표본. 고르는 것은 A·B·C 다.
   */
  const EDGES: Edge[] = [
    { id: "ab", fromNodeId: "A", toNodeId: "B" },
    { id: "ad", fromNodeId: "A", toNodeId: "D" },
    { id: "eb", fromNodeId: "E", toNodeId: "B" },
    { id: "bc", fromNodeId: "B", toNodeId: "C" },
    { id: "de", fromNodeId: "D", toNodeId: "E" },
  ];

  test("🔵 표본 확인 — 선 다섯 가운데 양 끝이 다 고른 집합 안인 것은 둘뿐이다", () => {
    assert.equal(EDGES.length, 5);
    const picked = sel("A", "B", "C");
    const both = EDGES.filter((e) => picked.has(e.fromNodeId) && picked.has(e.toNodeId));
    assert.deepEqual(ids(both), ["ab", "bc"], "표본이 「한쪽만 고른 선」을 실제로 품고 있어야 아래 단언이 뜻을 가진다");
    const half = EDGES.filter((e) => picked.has(e.fromNodeId) !== picked.has(e.toNodeId));
    assert.deepEqual(ids(half), ["ad", "eb"], "나가는 선과 들어오는 선이 하나씩 있어야 양방향을 다 잰다");
  });

  test("🔴 한쪽만 고른 선(A→D · E→B)은 빠지고, 양 끝이 다 고른 둘만 남는다", () => {
    assert.deepEqual(ids(planStraightenEdgeOrder(EDGES, sel("A", "B", "C"))), ["ab", "bc"]);
  });

  test("🔴 양 끝이 다 바깥인 선(D→E)도 당연히 빠진다", () => {
    assert.equal(
      planStraightenEdgeOrder(EDGES, sel("A", "B", "C")).some((e) => e.id === "de"),
      false
    );
  });

  test("고른 것이 하나뿐이면 펼 선이 없다 — 제 자신으로 가는 선이 없는 한 언제나 빈 목록이다", () => {
    assert.deepEqual(planStraightenEdgeOrder(EDGES, sel("B")), []);
  });

  test("고른 둘이 서로 안 이어져 있으면 빈 목록이다 — 단추를 흐리게 하는 근거가 이 값이다", () => {
    assert.deepEqual(planStraightenEdgeOrder(EDGES, sel("A", "C")), [], "A→C 는 없다(A→B→C 로 돌아간다)");
  });

  test("아무것도 안 골랐으면 빈 목록, 선이 아예 없어도 빈 목록", () => {
    assert.deepEqual(planStraightenEdgeOrder(EDGES, sel()), []);
    assert.deepEqual(planStraightenEdgeOrder([], sel("A", "B", "C")), []);
  });

  test("받은 배열을 안 고친다 — 차례도 길이도 그대로다", () => {
    const before = ids(EDGES);
    planStraightenEdgeOrder(EDGES, sel("A", "B", "C"));
    assert.deepEqual(ids(EDGES), before);
  });

  test("돌려주는 것은 **받은 그 객체**다 — 부르는 쪽이 제 도메인 칸을 그대로 읽는다", () => {
    const plan = planStraightenEdgeOrder(EDGES, sel("A", "B", "C"));
    assert.equal(plan[0], EDGES[0], "복사본을 만들면 부르는 쪽이 갈래·경로점 같은 제 칸을 잃는다");
  });
});

describe("② 차례는 앞선 노드부터 — 받은 차례가 거꾸로여도 바로잡는다", () => {
  /** 🔴 **일부러 거꾸로 적은** 사슬. 받은 차례를 그대로 쓰면 C→D 가 먼저 나온다. */
  const REVERSED: Edge[] = [
    { id: "cd", fromNodeId: "C", toNodeId: "D" },
    { id: "bc", fromNodeId: "B", toNodeId: "C" },
    { id: "ab", fromNodeId: "A", toNodeId: "B" },
  ];

  test("🔵 표본 확인 — 받은 차례가 실제로 거꾸로다(안 그러면 이 절이 아무것도 안 잰다)", () => {
    assert.deepEqual(ids(REVERSED), ["cd", "bc", "ab"]);
  });

  test("🔴 A→B · B→C · C→D 차례로 바로 선다", () => {
    assert.deepEqual(ids(planStraightenEdgeOrder(REVERSED, sel("A", "B", "C", "D"))), ["ab", "bc", "cd"]);
  });

  test("한 부모에서 갈라지는 선들은 **받은 차례**를 그대로 지킨다", () => {
    const edges: Edge[] = [
      { id: "a-c", fromNodeId: "A", toNodeId: "C" },
      { id: "a-b", fromNodeId: "A", toNodeId: "B" },
    ];
    assert.deepEqual(ids(planStraightenEdgeOrder(edges, sel("A", "B", "C"))), ["a-c", "a-b"], "같은 노드에서 나가는 선끼리는 서로 영향을 안 주므로 받은 차례가 곧 답이다");
  });

  test("뿌리가 둘이면 **먼저 나타난 뿌리**부터 — 같은 입력이면 늘 같은 답이다", () => {
    const edges: Edge[] = [
      { id: "x1", fromNodeId: "X", toNodeId: "Y" },
      { id: "p1", fromNodeId: "P", toNodeId: "Q" },
    ];
    assert.deepEqual(ids(planStraightenEdgeOrder(edges, sel("X", "Y", "P", "Q"))), ["x1", "p1"]);
    assert.deepEqual(ids(planStraightenEdgeOrder([edges[1], edges[0]], sel("X", "Y", "P", "Q"))), ["p1", "x1"]);
  });

  test("다이아몬드 — 합류점으로 가는 두 선이 **둘 다** 나오고, 제 부모보다 뒤에 선다", () => {
    const edges: Edge[] = [
      { id: "ab", fromNodeId: "A", toNodeId: "B" },
      { id: "ac", fromNodeId: "A", toNodeId: "C" },
      { id: "bd", fromNodeId: "B", toNodeId: "D" },
      { id: "cd", fromNodeId: "C", toNodeId: "D" },
    ];
    const order = ids(planStraightenEdgeOrder(edges, sel("A", "B", "C", "D")));
    assert.deepEqual(order, ["ab", "ac", "bd", "cd"]);
    // 🔵 D 는 두 번 맞춰진다 — 나중 것(cd)이 이긴다. 모듈 머리말의 「같은 칸이 두 번
    //    움직일 수 있다」가 이 값이다.
    assert.equal(order.filter((id) => id === "bd" || id === "cd").length, 2);
  });
});

describe("③ 🔴 **왜** 그 차례여야 하는가 — 진짜 좌표로 잰다", () => {
  /**
   * 🔴 차례만 비교하는 시험은 「A→B 가 B→C 보다 먼저」라고 적어 두고도 **그것이
   * 무엇을 바꾸는지**는 못 보인다. 여기서는 layout.ts 의 진짜 셈
   * (computeStraightenedConnectedNodePosition)을 **앞의 결과를 보며** 돌려,
   * 바른 차례면 한 줄이 되고 거꾸로면 안 된다는 것을 좌표로 보인다.
   *
   * 표본 — 세로로 늘어서되 x 가 제각각인 셋(폭·높이는 전부 다르다, 중심 정렬이
   * 왼쪽 모서리 정렬과 갈리게):
   *   A  x=0    y=0    120×60   → 중심 x 60
   *   B  x=40   y=200  200×60   → 중심 x 140
   *   C  x=-30  y=400  80×60    → 중심 x 10
   */
  const GEOMETRY: Record<string, { x: number; y: number; width: number; height: number }> = {
    A: { x: 0, y: 0, width: 120, height: 60 },
    B: { x: 40, y: 200, width: 200, height: 60 },
    C: { x: -30, y: 400, width: 80, height: 60 },
  };
  const centerX = (id: string, pos: { x: number; y: number }) => pos.x + GEOMETRY[id].width / 2;

  /** 선을 받은 차례대로 적용하며, **그때그때의 자리**를 읽는다(화면이 하는 그대로). */
  function applyInOrder(plan: readonly Edge[]) {
    const positions = new Map<string, { x: number; y: number }>(Object.entries(GEOMETRY).map(([id, g]) => [id, { x: g.x, y: g.y }]));
    for (const edge of plan) {
      const from = positions.get(edge.fromNodeId)!;
      const to = positions.get(edge.toNodeId)!;
      const result = computeStraightenedConnectedNodePosition(
        { ...from, width: GEOMETRY[edge.fromNodeId].width, height: GEOMETRY[edge.fromNodeId].height },
        { ...to, width: GEOMETRY[edge.toNodeId].width, height: GEOMETRY[edge.toNodeId].height }
      );
      positions.set(edge.toNodeId, result.position);
    }
    return positions;
  }

  const CHAIN: Edge[] = [
    { id: "bc", fromNodeId: "B", toNodeId: "C" },
    { id: "ab", fromNodeId: "A", toNodeId: "B" },
  ];

  test("🔵 표본 확인 — 손대기 전 중심 x 가 셋 다 다르다(이미 한 줄이면 아무것도 못 잰다)", () => {
    assert.deepEqual(
      ["A", "B", "C"].map((id) => centerX(id, GEOMETRY[id])),
      [60, 140, 10]
    );
  });

  test("🔴 바른 차례(A→B 먼저)면 셋의 중심 x 가 **전부 60** — 한 줄이 된다", () => {
    const positions = applyInOrder(planStraightenEdgeOrder(CHAIN, sel("A", "B", "C")));
    assert.deepEqual(
      ["A", "B", "C"].map((id) => centerX(id, positions.get(id)!)),
      [60, 60, 60]
    );
    // 🔵 세로(y)는 한 칸도 안 움직인다 — 세로로 더 벌어진 쌍이라 x 만 맞춘다.
    assert.deepEqual(
      ["A", "B", "C"].map((id) => positions.get(id)!.y),
      [0, 200, 400]
    );
  });

  test("🔴 받은 차례 그대로(B→C 먼저) 적용하면 **C 가 140 에 남아** 한 줄이 안 된다", () => {
    const positions = applyInOrder(CHAIN);
    assert.deepEqual(
      ["A", "B", "C"].map((id) => centerX(id, positions.get(id)!)),
      [60, 60, 140],
      "C 가 **옛 자리의 B**(중심 140)에 맞은 뒤 B 가 60 으로 옮겨 가 버린 모습이다 — 이것이 차례를 정하는 까닭이다"
    );
  });

  test("🔴 고른 노드만 움직인다 — 바깥 노드(D)는 자리도 목록도 그대로다", () => {
    const edges: Edge[] = [...CHAIN, { id: "bd", fromNodeId: "B", toNodeId: "D" }];
    const plan = planStraightenEdgeOrder(edges, sel("A", "B", "C"));
    const movedNodeIds = new Set(plan.map((e) => e.toNodeId));
    assert.deepEqual([...movedNodeIds].sort(), ["B", "C"], "움직이는 것은 **도착 노드**들이고, 전부 고른 집합 안이어야 한다");
    for (const edge of plan) {
      assert.ok(sel("A", "B", "C").has(edge.toNodeId), `${edge.id} 의 도착 노드가 고른 집합 밖이다`);
    }
  });
});

describe("④ 🔴 되돌아가는 선 — 멈추지도 버리지도 않는다", () => {
  test("🔵 표본 확인 — A→B→C→A 는 들어오는 선이 없는 노드가 하나도 없다(차례를 못 정하는 모양)", () => {
    const edges: Edge[] = [
      { id: "ab", fromNodeId: "A", toNodeId: "B" },
      { id: "bc", fromNodeId: "B", toNodeId: "C" },
      { id: "ca", fromNodeId: "C", toNodeId: "A" },
    ];
    const indegree = new Map<string, number>();
    for (const e of edges) indegree.set(e.toNodeId, (indegree.get(e.toNodeId) ?? 0) + 1);
    assert.deepEqual([...indegree.values()], [1, 1, 1]);
  });

  test("🔴 온전한 고리(A→B→C→A)는 **셋 다** 받은 차례 그대로 나온다 — 하나도 안 버린다", () => {
    const edges: Edge[] = [
      { id: "ab", fromNodeId: "A", toNodeId: "B" },
      { id: "bc", fromNodeId: "B", toNodeId: "C" },
      { id: "ca", fromNodeId: "C", toNodeId: "A" },
    ];
    assert.deepEqual(ids(planStraightenEdgeOrder(edges, sel("A", "B", "C"))), ["ab", "bc", "ca"]);
  });

  test("🔴 고리 차례를 바꿔 넣으면 답도 그 차례다 — 「받은 차례 그대로」가 말 그대로다", () => {
    const edges: Edge[] = [
      { id: "ca", fromNodeId: "C", toNodeId: "A" },
      { id: "ab", fromNodeId: "A", toNodeId: "B" },
      { id: "bc", fromNodeId: "B", toNodeId: "C" },
    ];
    assert.deepEqual(ids(planStraightenEdgeOrder(edges, sel("A", "B", "C"))), ["ca", "ab", "bc"]);
  });

  test("🔴 멀쩡한 앞머리가 섞이면 **그것이 먼저** 바로 선 차례로, 고리는 뒤에 받은 차례로", () => {
    /** Z→A 로 들어온 뒤 A→B→C→A 로 도는 모양 — 「이전 단계로」 분기가 실제로 이렇다. */
    const edges: Edge[] = [
      { id: "bc", fromNodeId: "B", toNodeId: "C" },
      { id: "ca", fromNodeId: "C", toNodeId: "A" },
      { id: "za", fromNodeId: "Z", toNodeId: "A" },
      { id: "ab", fromNodeId: "A", toNodeId: "B" },
    ];
    assert.deepEqual(
      ids(planStraightenEdgeOrder(edges, sel("Z", "A", "B", "C"))),
      ["za", "bc", "ca", "ab"],
      "za 만 차례를 정할 수 있다(Z 에 들어오는 선이 없다). 나머지 셋은 고리라 받은 차례(bc · ca · ab) 그대로 뒤에 붙는다"
    );
  });

  test("🔴 되돌아가는 선 하나(B↔C)가 섞여도 앞머리 A→B 는 제대로 먼저 선다", () => {
    const edges: Edge[] = [
      { id: "ab", fromNodeId: "A", toNodeId: "B" },
      { id: "bc", fromNodeId: "B", toNodeId: "C" },
      { id: "cb", fromNodeId: "C", toNodeId: "B" },
    ];
    assert.deepEqual(ids(planStraightenEdgeOrder(edges, sel("A", "B", "C"))), ["ab", "bc", "cb"]);
  });

  test("🔴 고리가 섞여도 **선을 하나도 안 잃는다** — 들어온 개수와 나간 개수가 같다", () => {
    const edges: Edge[] = [
      { id: "ab", fromNodeId: "A", toNodeId: "B" },
      { id: "bc", fromNodeId: "B", toNodeId: "C" },
      { id: "ca", fromNodeId: "C", toNodeId: "A" },
      { id: "cd", fromNodeId: "C", toNodeId: "D" },
    ];
    const plan = planStraightenEdgeOrder(edges, sel("A", "B", "C", "D"));
    assert.equal(plan.length, 4);
    assert.deepEqual([...ids(plan)].sort(), ["ab", "bc", "ca", "cd"]);
  });
});

describe("⑤ 자기 자신을 가리키는 선 · 같은 쌍을 잇는 선 여럿", () => {
  test("🔴 자기 자신을 가리키는 선은 빠진다 — 남으면 [이전]이 한 번 헛돈다", () => {
    const edges: Edge[] = [
      { id: "aa", fromNodeId: "A", toNodeId: "A" },
      { id: "ab", fromNodeId: "A", toNodeId: "B" },
    ];
    assert.deepEqual(ids(planStraightenEdgeOrder(edges, sel("A", "B"))), ["ab"]);
  });

  test("🔴 자기 자신을 가리키는 선 하나만 고르면 **빈 목록** — 단추가 살아나면 안 된다", () => {
    assert.deepEqual(planStraightenEdgeOrder([{ id: "aa", fromNodeId: "A", toNodeId: "A" }], sel("A")), []);
  });

  test("🔵 자기 자신을 가리키는 선은 차례 셈에도 안 낀다 — 그것 때문에 사슬이 고리로 읽히지 않는다", () => {
    const edges: Edge[] = [
      { id: "bb", fromNodeId: "B", toNodeId: "B" },
      { id: "bc", fromNodeId: "B", toNodeId: "C" },
      { id: "ab", fromNodeId: "A", toNodeId: "B" },
    ];
    assert.deepEqual(ids(planStraightenEdgeOrder(edges, sel("A", "B", "C"))), ["ab", "bc"]);
  });

  test("🔵 같은 두 노드를 잇는 선이 둘이면 둘 다 남고, 차례도 받은 그대로다", () => {
    const edges: Edge[] = [
      { id: "ab1", fromNodeId: "A", toNodeId: "B" },
      { id: "ab2", fromNodeId: "A", toNodeId: "B" },
      { id: "bc", fromNodeId: "B", toNodeId: "C" },
    ];
    assert.deepEqual(ids(planStraightenEdgeOrder(edges, sel("A", "B", "C"))), ["ab1", "ab2", "bc"], "B 의 차수가 2 라, 둘 다 적용된 뒤에야 B→C 가 나온다");
  });
});
