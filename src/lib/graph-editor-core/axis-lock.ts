/**
 * Generic graph-editor-core — pure axis-constrained-drag math. Domain-free:
 * operates only on {x,y} points, with no knowledge of repair cases,
 * procedure templates, or any consumer's persisted data model. Built for
 * the Case Flowchart graph's Shift+drag interaction (5C-6D follow-up); made
 * generic so the Procedure editor could adopt the same interaction later.
 *
 * 🔵 **그 「나중에」는 이미 왔다** — 5C-6D-1D 에서 ProcedureFlowGraph 도 이
 * 모듈을 그대로 쓴다(그 파일의 handleNodeDragStart/handleNodeDrag). 전에는
 * 여기 「절차 편집기에는 아직 안 붙였다」고 적혀 있었는데 붙은 뒤에도 그대로
 * 남아 있었다. 쓰는 곳은 지금 **둘**이다.
 *
 * Shift-state rule (deliberately the simpler of the two options considered):
 * whether a drag is axis-constrained at all is decided ONCE, from whether
 * Shift was held at the drag's own start — never re-evaluated mid-drag.
 * React Flow's onNodeDrag fires on every pointer-move frame, and toggling
 * "constrained-or-not" live (Shift held, then released, then re-held)
 * would require deciding what the constraint anchor even means at the
 * moment of each transition (does releasing Shift make the anchor for a
 * LATER re-constrain the drag's original start, or the position at the
 * moment Shift was re-pressed?) — every answer risks visible jitter/
 * snapping the instant the key state flips. Shift-at-start avoids that
 * whole class of edge case entirely and is trivially deterministic to both
 * implement and test.
 */

export type Point = { x: number; y: number };
export type DragAxis = "horizontal" | "vertical" | null;

/** Minimum accumulated movement (in flow-space units, either dimension) before an axis commits — below this, the drag is treated as not-yet-decided rather than snapping to whichever axis a 1px accidental nudge happened to favor. */
export const AXIS_LOCK_THRESHOLD = 4;

/**
 * Decides which axis a Shift-constrained drag should lock to, from the
 * TOTAL delta between the drag's start position and the current position.
 * Pure and stateless — returns `null` ("not yet committed") until the
 * accumulated movement in some direction crosses AXIS_LOCK_THRESHOLD.
 *
 * The caller is responsible for calling this only until it returns a
 * non-null axis, then holding onto that committed value for the rest of
 * the drag gesture: this function has no memory of its own and will
 * recompute a (possibly different) axis every time it's called — calling
 * it on every frame for the whole drag would itself reintroduce the exact
 * jitter this module exists to avoid.
 */
export function resolveDragAxis(start: Point, current: Point): DragAxis {
  const deltaX = current.x - start.x;
  const deltaY = current.y - start.y;
  if (Math.abs(deltaX) < AXIS_LOCK_THRESHOLD && Math.abs(deltaY) < AXIS_LOCK_THRESHOLD) return null;
  return Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical";
}

/**
 * Projects `current` onto the locked axis, anchored at `start` —
 * horizontal locks Y to start.y (only X moves), vertical locks X to
 * start.x (only Y moves), null (not yet committed / unconstrained) passes
 * `current` through unchanged. Always returns a NEW object; never mutates
 * either input.
 */
export function applyAxisLock(start: Point, current: Point, axis: DragAxis): Point {
  if (axis === "horizontal") return { x: current.x, y: start.y };
  if (axis === "vertical") return { x: start.x, y: current.y };
  return { x: current.x, y: current.y };
}

/** 한 번의 끌기로 **함께 움직이는** 칸 하나 — id 와 지금 자리. */
export type AxisLockMove = { nodeId: string; position: Point };

/**
 * 🔴 **여러 칸을 함께 끌 때의 축 잠금.** 칸 하나짜리 applyAxisLock 의 묶음판이다.
 *
 * 정한 것 둘(2026-11-21, 복수 선택 밑자락):
 *
 *  ① **축은 「끄는 칸」 하나로 정한다.** 이 함수는 이미 정해진 `axis` 를 받을
 *     뿐이고, 부르는 쪽이 `resolveDragAxis(끄는 칸의 시작, 끄는 칸의 지금)` 으로
 *     한 번만 정해 넘긴다. 칸마다 따로 정하면 — 셋이 같은 거리를 움직이므로
 *     보통은 같은 답이 나오지만 — **문턱(AXIS_LOCK_THRESHOLD)을 넘는 순간이
 *     칸마다 달라질 수 있어** 어떤 칸은 가로로, 어떤 칸은 세로로 묶이는 꼴이
 *     난다. 한 번의 손짓은 한 축이다.
 *
 *  ② **각 칸은 「제 시작 자리」를 받침으로 삼는다**(`startById`). 끄는 칸의 움직인
 *     거리를 그대로 다른 칸에 더하는 길도 있었지만, 잠긴 축의 좌표를 **그 칸이
 *     원래 있던 값으로 되돌리는** 이 방식이 뜻이 더 분명하다 — 「세로로 잠갔으면
 *     어떤 칸도 x 가 안 바뀐다」가 곧 정의가 된다. @xyflow/system 의 XYDrag 는
 *     함께 끄는 칸 전부에 **같은 포인터 거리**를 더하므로(각 칸의 `distance` 는
 *     끌기 시작에 한 번 정해지고 안 바뀐다) 평소에는 두 길의 답이 같고, 어느
 *     칸이 제 `extent` 에 걸려 덜 움직인 때만 갈린다. 그때는 ②가 맞다 —
 *     걸린 칸을 억지로 끌려가게 만들지 않는다.
 *
 * `startById` 에 시작 자리가 없는 칸은 **그대로 통과**시킨다(끌기 도중에
 * 생겨난 칸 따위). 축이 null 이면 전부 그대로다. 입력은 절대 안 바꾸고 늘
 * 새 배열·새 점을 돌려준다.
 */
export function applyAxisLockToMoves(
  moves: readonly AxisLockMove[],
  startById: ReadonlyMap<string, Point>,
  axis: DragAxis
): AxisLockMove[] {
  return moves.map((move) => {
    const start = startById.get(move.nodeId);
    if (!start) return { nodeId: move.nodeId, position: { x: move.position.x, y: move.position.y } };
    return { nodeId: move.nodeId, position: applyAxisLock(start, move.position, axis) };
  });
}
