/**
 * Generic graph-editor-core — **고른 노드들 사이의 연결선을 한 번에 곧게** 펼 때
 * 「무엇을, 어떤 차례로 펼지」만 정하는 순수 계산(2026-11-22, 조각 D1).
 *
 * 쓰는 분 요청(2026-11-21): 「[범위 선택]으로 여러 노드를 선택한 상태에서 연결선
 * 정렬을 할 수 있도록 하자.」 2026-11-22 에 뜻을 물어 **「고른 것끼리의 선을
 * 곧게」**로 정해졌다 — `A→B` 와 `B→C` 를 둘 다 고르면 둘 다 펴져 한 줄이 되고,
 * `A→D` 처럼 **한쪽만 고른 선은 그대로 둔다.**
 *
 * 🔵 **곧게 펴는 셈 자체는 여기 없다.** 그것은 layout.ts 의
 * `computeStraightenedConnectedNodePosition` 하나뿐이고(시작 노드 고정 · 도착
 * 노드만 · 더 많이 벌어진 축으로), 이 모듈은 **그 함수를 몇 번, 어떤 차례로
 * 부를지**만 답한다. 자리를 읽고 적용하는 것은 부르는 쪽(편집기 화면)의 일이다 —
 * 자리의 출처(그림이 올려보낸 화면 자리인가 저장된 값인가)는 편집기마다 다르고,
 * 2026-11-05 에 그것을 잘못 골라 노드가 화면 밖으로 날아간 적이 있다.
 *
 * 🔴 **왜 이 자리(graph-editor-core)인가** — 두 편집기(기술 작업 절차 · 진단
 * Flowchart)가 **같은 답**을 내야 하기 때문이다. 차례가 결과를 바꾸는 계산이라,
 * 화면마다 제 나름으로 적으면 「같은 노드를 골랐는데 두 화면이 서로 다르게 편다」가
 * 되고 그것은 오류가 안 난다. 도메인을 안 탄다: 절차·수리건·노드 종류·갈래 이름을
 * 하나도 모르고, `{id, fromNodeId, toNodeId}` 라는 최소 모양만 받는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **차례는 「앞선 노드부터」(위상 순서)** — 이것이 이 파일의 전부다.
 *
 * `A→B` 를 `B→C` 보다 **먼저** 적용해야 C 가 **옮겨진 B** 에 맞아 한 줄이 된다.
 * 거꾸로면 C 가 **옛 자리의 B** 에 맞은 뒤 B 가 움직여 버려, 눈으로 보면 가운데가
 * 꺾인 채로 남는다 — 단추를 한 번 더 눌러야 비로소 펴진다. 오류는 안 난다.
 *
 * 🔵 노드를 위상 정렬(Kahn)하고, 노드를 꺼낼 때 **그 노드에서 나가는 선들**을
 * 내놓는다. 그래서 어떤 선이든 **제 시작 노드가 이미 자리를 잡은 뒤**에 나온다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **되돌아가는 선이 있으면 차례를 못 정한다 — 그래도 버리지 않는다.**
 *
 * 진단 Flowchart 에는 「이전 단계로」 분기가 있어 **실제로 사이클이 생긴다**(절차
 * 쪽도 LOOP_BACK·RETRY 가 흔하다). 사이클 안의 선은 「누가 먼저」가 **정의되지
 * 않는다** — 어느 쪽을 먼저 펴든 다른 쪽이 어긋나기 때문이다.
 *
 * 그때 **멈추지도 버리지도 않는다.** 차례를 정할 수 있는 것을 먼저 내고, 남은
 * 것(사이클에 묶인 선)은 **받은 차례 그대로** 뒤에 붙인다. 까닭 둘:
 *  - **멈추면** 사이클이 하나만 있어도 멀쩡한 선 수십 개가 함께 안 펴진다. 사람은
 *    「단추가 고장 났다」로 읽는다.
 *  - **버리면** 되돌아가는 선만 영영 안 펴지는데, 화면에는 그 선도 똑같이 그려져
 *    있어서 「왜 이 선만 안 펴지지」가 된다.
 * 받은 차례를 그대로 쓰는 것은 **답이 늘 같게** 하려는 것이다(아무 차례나 쓰면
 * 같은 입력에 다른 그림이 나온다). 값으로 재어 둔다 — straighten-selection.test.ts ④절.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔵 **같은 칸이 두 번 움직일 수 있다.** 다이아몬드(`A→B` · `A→C` · `B→D` ·
 * `C→D`)를 통째로 고르면 D 는 `B→D` 로 한 번, `C→D` 로 또 한 번 맞춰져 **나중
 * 것이 이긴다.** 일부러 그대로 둔다 — 「단추로 한 번씩 눌렀을 때」와 결과가 같아야
 * 하고, 그쪽도 마지막에 누른 선이 이긴다. 이 함수가 「둘 중 하나를 고르는」 규칙을
 * 몰래 가지면 두 길의 답이 갈린다.
 */

/** 펼 수 있는 선 하나의 최소 모양. 🔵 도메인 타입을 안 탄다 — 갈래·꼬리표·경로점은 여기서 뜻이 없다. */
export type StraightenableEdge = { id: string; fromNodeId: string; toNodeId: string };

/**
 * 고른 노드들 **사이에 있는** 선을, **적용할 차례대로** 돌려준다.
 *
 * 🔴 **양 끝이 모두 고른 집합 안에 있는 선만** 고른다. 한쪽만 고른 선은 뺀다 —
 * 그것을 펴면 **안 고른 노드가 움직인다.** 쓰는 분이 정한 것은 「움직이는 것은
 * 고른 노드뿐」이다.
 *
 * 🔵 **자기 자신을 가리키는 선(`from === to`)은 뺀다.** 펴 봐야 제 중심에 제가
 * 맞으므로 **한 픽셀도 안 움직이는데**, 목록에 남으면 「펼 선이 있다」로 세어져
 * 단추가 살아나고 [이전]이 한 번 헛돈다(아무것도 안 바뀐 되돌리기 칸이 생긴다).
 *
 * 🔵 **같은 두 노드를 잇는 선이 여럿**이면 전부 남는다. 둘째부터는 이미 맞은
 * 자리에 다시 맞추는 것이라 결과가 안 바뀐다(위 머리말의 「두 번 움직인다」와 같은
 * 뜻이다 — 겹쳐도 틀린 답이 되지 않는다).
 *
 * 받은 배열을 고치지 않는다. 돌려주는 것은 **받은 그 객체들**이라, 부르는 쪽이 제
 * 도메인 타입(갈래·경로점 따위)을 그대로 읽을 수 있다.
 */
export function planStraightenEdgeOrder<E extends StraightenableEdge>(edges: readonly E[], selectedNodeIds: ReadonlySet<string>): E[] {
  // ① 고른 것끼리의 선만 남긴다. 받은 차례를 그대로 지킨다 — 아래 두 자리(차례를
  //    못 정한 나머지 · 같은 노드에서 나가는 선들)가 이 차례를 그대로 물려받는다.
  const inner = edges.filter((e) => e.fromNodeId !== e.toNodeId && selectedNodeIds.has(e.fromNodeId) && selectedNodeIds.has(e.toNodeId));
  if (inner.length === 0) return [];

  // ② 위상 정렬(Kahn)의 밑자락. 🔵 `nodeOrder` 는 **처음 나타난 차례**다 — 들어오는
  //    선이 없는 노드가 여럿일 때 누구부터 꺼낼지가 여기서 정해지고, 그래야 같은
  //    입력이면 늘 같은 답이 나온다(Map/Set 의 순회 차례에 기대지 않는다).
  const outgoingIndexes = new Map<string, number[]>();
  const indegree = new Map<string, number>();
  const nodeOrder: string[] = [];
  function noteNode(id: string) {
    if (indegree.has(id)) return;
    indegree.set(id, 0);
    nodeOrder.push(id);
  }
  inner.forEach((e, index) => {
    noteNode(e.fromNodeId);
    noteNode(e.toNodeId);
    const outgoing = outgoingIndexes.get(e.fromNodeId);
    if (outgoing) outgoing.push(index);
    else outgoingIndexes.set(e.fromNodeId, [index]);
    indegree.set(e.toNodeId, indegree.get(e.toNodeId)! + 1);
  });

  // ③ 들어오는 선이 없는 노드부터 꺼내며, 꺼낸 노드에서 **나가는 선**을 내놓는다.
  //    🔴 선을 내놓는 시점이 「그 선의 시작 노드가 이미 다 맞춰진 뒤」임을 이 차례가
  //    보장한다. 한 노드가 큐에 두 번 들어가는 일은 없다 — 차수가 **정확히 0 이
  //    되는 순간**에만 넣고, 처음부터 0 인 노드는 아무도 줄여 주지 않는다.
  const queue = nodeOrder.filter((id) => indegree.get(id) === 0);
  const ordered: E[] = [];
  const emitted: boolean[] = new Array(inner.length).fill(false);
  for (let qi = 0; qi < queue.length; qi += 1) {
    for (const index of outgoingIndexes.get(queue[qi]) ?? []) {
      const edge = inner[index];
      ordered.push(edge);
      emitted[index] = true;
      const left = indegree.get(edge.toNodeId)! - 1;
      indegree.set(edge.toNodeId, left);
      if (left === 0) queue.push(edge.toNodeId);
    }
  }

  // ④ 사이클에 묶여 차례를 못 정한 선들 — **받은 차례 그대로** 뒤에 붙인다(머리말).
  if (ordered.length < inner.length) {
    inner.forEach((edge, index) => {
      if (!emitted[index]) ordered.push(edge);
    });
  }
  return ordered;
}
