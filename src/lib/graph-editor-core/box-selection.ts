/**
 * Generic graph-editor-core — 점선 네모(박스)로 노드를 고르는 **순수 계산**.
 * 도메인을 안 탄다: 수리건 Flowchart·절차 템플릿·저장 모델을 하나도 모르고,
 * `{id, x, y, width, height}` 라는 최소 모양만 받는다. 두 편집기(절차 ·
 * 진단 Flowchart)가 같은 답을 내야 해서 이 자리에 둔다 — 화면 쪽에 셈을
 * 복제하면 「시험은 통과하는데 두 화면이 서로 다르게 고르는」 자리가 생긴다.
 *
 * ────────────────────────────────────────────────────────────────────
 * 🔴 **「사각형에 들었다」의 뜻 — 닿기만 해도 든 것으로 센다(겹침 넓이 > 0).**
 *
 * 고를 수 있었던 것은 둘이다:
 *   ① 닿으면      — 사각형과 조금이라도 겹치면 고른다.
 *   ② 완전히 들어오면 — 노드가 통째로 사각형 안에 있어야 고른다.
 *
 * ①을 골랐다. 까닭 셋:
 *   - 쓰는 분이 댄 본보기가 **동영상 편집 프로그램**이고, 그림·편집 도구는
 *     대개 ① 쪽이다. ②는 「분명히 네모 안에 들어왔는데 왜 안 골라지지」가 된다.
 *   - 이 그림의 칸은 **크다**(ProcedureNodeChip, 글이 길면 더 커진다). ②면
 *     칸 하나를 고르려고 그 칸보다 큰 네모를 그려야 하고, 화면을 많이 줄여
 *     보는 중(minZoom 0.02)이면 그릴 자리가 아예 없다.
 *   - 칸이 화면 밖으로 반쯤 나가 있으면 ②로는 **영영 못 고른다.**
 *
 * 🔴 **겹침 넓이가 0 보다 커야 한다 — 변끼리 딱 맞닿기만 한 것은 안 고른다.**
 * 이것은 멋을 부린 것이 아니라 **React Flow 제 셈과 똑같이 맞춘 것**이다:
 * @xyflow/system 의 `getNodesInside(…, partially = true, …)` 가
 * `getOverlappingArea(...) > 0` 으로 가른다(v0.0.79 에서 값으로 확인).
 * 나중에 React Flow 제 선택 상자를 쓰게 되더라도 **두 길이 같은 답**을 내야
 * 하기 때문이다.
 *
 * 🔴 그런데 React Flow 의 `selectionMode` **기본값은 `SelectionMode.Full`**
 * (= ② 완전히 들어오면)이다(@xyflow/react v12.11.2 의 `ReactFlow` 기본 인자에서
 * 확인). 즉 **React Flow 제 선택 상자를 그냥 켜면 이 모듈과 답이 갈린다.**
 * 그것을 쓰는 쪽은 `selectionMode={SelectionMode.Partial}` 을 함께 넘겨야 한다.
 * ────────────────────────────────────────────────────────────────────
 *
 * 🔵 **노드 크기는 여기서 안 재고 받는다.** 크기를 정하는 규칙은 이미 한 곳에
 * 있다 — `graph-editor-core/layout.ts` 의 `resolveEffectiveNodeDimensions`
 * (React Flow 가 **실제로 잰 값** 우선, 없으면 `computeNodeDimensions` 추정값).
 * 두 편집기가 각자 `resolveNodeDimensions(n)` 이라는 이름으로 그것을 이미
 * 쓰고 있으므로, 이 모듈이 크기를 또 추정하면 **같은 칸의 크기가 두 벌**이
 * 되어 「그려진 것과 골라지는 것이 다른」 결함이 난다.
 */

type Point = { x: number; y: number };

/** 왼쪽 위 모서리 + 폭/높이로 정규화된 네모. 폭·높이는 절대 음수가 아니다. */
export type SelectionBox = { x: number; y: number; width: number; height: number };

/** 골라질 수 있는 칸 하나의 기하. `layout.ts` 의 `ConnectedNodeGeometry` 와 같은 모양에 id 를 더한 것이다. */
export type BoxSelectableNode = { id: string; x: number; y: number; width: number; height: number };

/**
 * 끈 두 점을 네모로 만든다 — **어느 방향으로 끌든 같은 네모**가 나온다.
 * (오른쪽 아래로 끄는 것만 생각하고 `end - start` 를 그대로 쓰면 왼쪽/위로
 * 끌 때 폭이 음수가 되고, 그러면 아래 겹침 셈이 조용히 늘 0 이 되어 **아무것도
 * 안 골라진다** — 오류는 안 난다.)
 */
export function selectionBoxFromPoints(start: Point, end: Point): SelectionBox {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

/**
 * 화면에 **그리는** 네모 — 그림 바탕(pane) 왼쪽 위를 0,0 으로 삼은 px 자리.
 *
 * 🔴 **고르는 네모와 반드시 같은 두 점에서 나와야 한다.** 끈 두 점은 화면
 * 좌표(clientX/clientY)로 들어오고, 고르기는 그 둘을 그림 좌표로 옮긴 뒤
 * 위 `selectionBoxFromPoints` 로 네모를 만든다. **그리기만 따로 셈을 적으면**
 * 「눈에 보이는 네모와 실제로 골라진 칸이 다른」 결함이 나고, 그것은 오류가
 * 안 나서 눈으로만 잡힌다. 그래서 이 함수도 같은 `selectionBoxFromPoints` 를
 * 거친다 — 방향 정규화(어느 쪽으로 끌든 같은 네모)가 한 벌만 있게 한다.
 *
 * 🔵 `paneOrigin` 은 그림 바탕 요소의 화면 왼쪽 위(`getBoundingClientRect()` 의
 * left/top)다. 그 요소 **안에** 절대 자리로 얹을 것이라 그만큼만 빼면 된다.
 * 🔵 **확대/축소 배율은 여기 안 들어간다** — 들어온 두 점도, 내놓는 값도 둘 다
 * 화면 px 이다. 배율이 끼어드는 곳은 화면 좌표 → 그림 좌표로 옮기는 쪽
 * (`screenToFlowPosition`) 하나뿐이고, 그 셈은 그림 바탕이 제가 한다.
 */
export type SelectionOverlayRect = { left: number; top: number; width: number; height: number };

export function selectionOverlayRect(start: Point, end: Point, paneOrigin: Point): SelectionOverlayRect {
  const box = selectionBoxFromPoints(start, end);
  return { left: box.x - paneOrigin.x, top: box.y - paneOrigin.y, width: box.width, height: box.height };
}

/**
 * 고른 칸 집합에서 하나를 **넣거나 뺀다** — 이미 있으면 빼고, 없으면 넣는다.
 *
 * 🔵 점선 네모 모드에서 **칸을 누르는 것**이 곧 이 조작이다(보조키를 안 쓴다 —
 * 이 저장소는 Shift 를 축 잠금 드래그에 이미 쓰고 있어서, 모드로 가르고 보조키는
 * 비워 뒀다).
 * 🔴 **새 집합을 돌려준다** — 받은 것을 고쳐서 돌려주면 React 가 「같은 것」으로
 * 보고 다시 안 그린다(그러면 눌렀는데 화면이 그대로다).
 */
export function toggleNodeInSelection(selectedIds: ReadonlySet<string>, nodeId: string): Set<string> {
  const next = new Set(selectedIds);
  if (!next.delete(nodeId)) next.add(nodeId);
  return next;
}

/**
 * 두 네모가 겹치는 넓이. 안 겹치면 0, 변끼리만 맞닿아도 0 이다.
 * (@xyflow/system 의 `getRectsOverlappingArea` 와 같은 셈 — 거기 맞춰 두는
 * 까닭은 이 파일 머리 주석에 있다.)
 */
export function selectionBoxOverlapArea(a: SelectionBox, b: SelectionBox): number {
  const overlapWidth = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const overlapHeight = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return overlapWidth * overlapHeight;
}

/**
 * 네모에 **닿은** 칸들의 id 집합. 차례는 뜻이 없다(Set).
 *
 * 🔵 폭이나 높이가 0(또는 음수·NaN)인 칸은 **절대 안 골라진다** — 겹침 넓이가
 * 0 이기 때문이다. 아직 React Flow 가 크기를 안 잰 칸이 그런 값으로 들어올 수
 * 있는데, 그 칸을 「점 하나」로 쳐서 골라 버리면 화면에 안 보이는 것이 함께
 * 끌려간다. 안 고르는 쪽이 안전하다.
 * 🔵 **점 하나짜리 네모(끌지 않고 누르기만 한 것)도 아무것도 안 고른다** —
 * 넓이가 0 이다. 누르기로 고르는 길은 네모가 아니라 칸을 직접 누르는 길이다.
 */
export function findNodeIdsInSelectionBox(box: SelectionBox, nodes: readonly BoxSelectableNode[]): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (selectionBoxOverlapArea(box, { x: node.x, y: node.y, width: node.width, height: node.height }) > 0) ids.add(node.id);
  }
  return ids;
}
