/**
 * Generic graph-editor-core — pointer-capture safety helpers. Domain-free:
 * no knowledge of procedure templates, nodes, or edges, just the DOM
 * Pointer Events contract every custom-drag handle in this codebase's
 * graph canvas relies on (see ProcedureFlowGraph.tsx's waypoint-handle
 * drag, the one caller today).
 */

/** The minimal surface this module depends on — real DOM elements satisfy it as-is; tests can pass a plain mock without needing jsdom or any DOM environment at all. */
export type PointerCaptureTarget = {
  hasPointerCapture(pointerId: number): boolean;
  releasePointerCapture(pointerId: number): void;
};

/**
 * Releases a pointer capture safely — never throws, and never calls
 * `releasePointerCapture` for a pointerId this element doesn't actually
 * hold (some browsers throw for that; a stray event with no matching
 * capture must be a silent no-op, not an uncaught exception that could
 * abort whatever React event-handling was mid-flight).
 *
 * Callers MUST wire this to both `onPointerUp` AND `onPointerCancel` — a
 * drag interrupted any way other than a clean pointerup (Alt+Tab, a
 * system/browser dialog stealing focus, a right-click context menu,
 * losing touch/pen contact) fires `pointercancel` instead. Releasing only
 * on `onPointerUp` (the bug this module fixes — see ProcedureFlowGraph.tsx's
 * own doc comment on its call site) leaves the pointer captured
 * indefinitely: every subsequent pointer event keeps routing to (and
 * being cursor-styled by) the stale captured element instead of whatever
 * is actually under the OS pointer — which can make the cursor appear to
 * vanish anywhere on the page, not just over the original element.
 */
export function releasePointerCaptureSafely(el: PointerCaptureTarget, pointerId: number): void {
  try {
    if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
  } catch {
    // Already released, or was never actually captured — nothing to clean up.
  }
}

/** The minimal window/document surface createCaptureBlurGuard depends on — real globals satisfy it as-is; tests can pass plain mocks without jsdom. */
export type BlurWindowLike = {
  addEventListener(type: "blur", listener: () => void): void;
  removeEventListener(type: "blur", listener: () => void): void;
};
export type VisibilityDocumentLike = {
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
  visibilityState: string;
};

/**
 * Second cursor-disappearing gap (round 2) — releasePointerCaptureSafely
 * wired to onPointerUp/onPointerCancel still isn't enough on its own.
 * Pointer capture is defined to be independent of window focus: Alt+Tab, a
 * system/browser dialog stealing focus, or switching to another
 * application does NOT itself release capture or fire pointercancel (nor
 * lostpointercapture) — the captured element keeps redirecting every
 * pointer event (and, in practice, the rendered cursor) to itself across
 * the whole page until a real pointerup eventually arrives, which may
 * never happen if the mouse button was released while a different window
 * had OS focus. This guard proactively releases whatever pointer capture
 * it's currently tracking the moment the window blurs or the tab becomes
 * hidden, instead of waiting for an event that may never come.
 *
 * Usage: call `track(el, pointerId)` right after `setPointerCapture`;
 * call `untrack()` on every normal release path (pointerup/pointercancel/
 * lostpointercapture). `dispose()` removes the window/document listeners
 * (call from a cleanup function, e.g. a React effect's return).
 */
export function createCaptureBlurGuard(win: BlurWindowLike, doc: VisibilityDocumentLike) {
  let current: { el: PointerCaptureTarget; pointerId: number } | null = null;

  function releaseIfCaptured() {
    if (!current) return;
    releasePointerCaptureSafely(current.el, current.pointerId);
    current = null;
  }

  function handleVisibilityChange() {
    if (doc.visibilityState === "hidden") releaseIfCaptured();
  }

  win.addEventListener("blur", releaseIfCaptured);
  doc.addEventListener("visibilitychange", handleVisibilityChange);

  return {
    track(el: PointerCaptureTarget, pointerId: number) {
      current = { el, pointerId };
    },
    untrack() {
      current = null;
    },
    dispose() {
      win.removeEventListener("blur", releaseIfCaptured);
      doc.removeEventListener("visibilitychange", handleVisibilityChange);
    },
  };
}
