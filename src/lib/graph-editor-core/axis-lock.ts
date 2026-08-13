/**
 * Generic graph-editor-core — pure axis-constrained-drag math. Domain-free:
 * operates only on {x,y} points, with no knowledge of repair cases,
 * procedure templates, or any consumer's persisted data model. Built for
 * the Case Flowchart graph's Shift+drag interaction (5C-6D follow-up); made
 * generic now since the Procedure editor could plausibly adopt the same
 * interaction later, but is NOT wired up there in this checkpoint — that is
 * an explicit decision for the later 5C-6D-1 standardization checkpoint,
 * not assumed here.
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
