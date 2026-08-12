import { test } from "node:test";
import assert from "node:assert/strict";
import { releasePointerCaptureSafely, createCaptureBlurGuard, type PointerCaptureTarget, type BlurWindowLike, type VisibilityDocumentLike } from "./pointer";

/**
 * Phase 5C-5B — regression coverage for the cursor-disappearing bugfix.
 * The actual browser symptom (a genuinely stuck OS pointer icon) isn't
 * meaningfully unit-testable — it requires a real DOM/pointer-events
 * environment this repo's Node test runner doesn't provide (jsdom does not
 * implement setPointerCapture/hasPointerCapture/releasePointerCapture at
 * all) — so this instead locks down the exact safety contract the fix
 * depends on: release only when actually captured, and never throw,
 * against a plain mock object (no DOM/jsdom needed).
 */

function makeMockTarget(overrides: Partial<PointerCaptureTarget> = {}): PointerCaptureTarget & { releaseCalls: number[] } {
  const releaseCalls: number[] = [];
  return {
    hasPointerCapture: () => true,
    releasePointerCapture: (pointerId: number) => {
      releaseCalls.push(pointerId);
    },
    ...overrides,
    releaseCalls,
  };
}

test("releasePointerCaptureSafely: calls releasePointerCapture when the element actually holds the capture", () => {
  const target = makeMockTarget({ hasPointerCapture: () => true });
  releasePointerCaptureSafely(target, 42);
  assert.deepEqual(target.releaseCalls, [42]);
});

test("releasePointerCaptureSafely: does nothing when the element never held the capture — a stray pointercancel is a silent no-op", () => {
  const target = makeMockTarget({ hasPointerCapture: () => false });
  releasePointerCaptureSafely(target, 1);
  assert.deepEqual(target.releaseCalls, []);
});

test("releasePointerCaptureSafely: never throws even if hasPointerCapture itself throws", () => {
  const target = makeMockTarget({
    hasPointerCapture: () => {
      throw new Error("simulated browser quirk");
    },
  });
  assert.doesNotThrow(() => releasePointerCaptureSafely(target, 7));
});

test("releasePointerCaptureSafely: never throws even if releasePointerCapture itself throws (e.g. already released by the browser)", () => {
  const target = makeMockTarget({
    hasPointerCapture: () => true,
    releasePointerCapture: () => {
      throw new Error("InvalidStateError: pointer already released");
    },
  });
  assert.doesNotThrow(() => releasePointerCaptureSafely(target, 3));
});

test("releasePointerCaptureSafely: is idempotent — calling it twice for the same pointerId only releases once", () => {
  let captured = true;
  const target: PointerCaptureTarget = {
    hasPointerCapture: () => captured,
    releasePointerCapture: () => {
      captured = false;
    },
  };
  releasePointerCaptureSafely(target, 5); // onPointerUp
  releasePointerCaptureSafely(target, 5); // a redundant onPointerCancel for the same gesture
  assert.equal(captured, false);
});

/**
 * Round-2 cursor-disappearing gap — pointer capture persists across a
 * window blur (Alt+Tab, a dialog, switching apps) since capture is defined
 * independent of focus. These tests use plain mock window/document objects
 * (no jsdom) to drive createCaptureBlurGuard's own logic in isolation from
 * any real DOM/focus behavior.
 */
function makeMockWindow(): BlurWindowLike & { fireBlur(): void } {
  const listeners = new Set<() => void>();
  return {
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    fireBlur() {
      for (const l of listeners) l();
    },
  };
}

function makeMockDocument(): VisibilityDocumentLike & { fireVisibilityChange(state: string): void } {
  const listeners = new Set<() => void>();
  let visibilityState = "visible";
  return {
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    get visibilityState() {
      return visibilityState;
    },
    fireVisibilityChange(state: string) {
      visibilityState = state;
      for (const l of listeners) l();
    },
  };
}

test("createCaptureBlurGuard: releases the tracked capture on window blur", () => {
  const win = makeMockWindow();
  const doc = makeMockDocument();
  const releaseCalls: number[] = [];
  const target: PointerCaptureTarget = { hasPointerCapture: () => true, releasePointerCapture: (id) => releaseCalls.push(id) };
  const guard = createCaptureBlurGuard(win, doc);

  guard.track(target, 9);
  win.fireBlur();

  assert.deepEqual(releaseCalls, [9]);
});

test("createCaptureBlurGuard: releases the tracked capture when the tab becomes hidden", () => {
  const win = makeMockWindow();
  const doc = makeMockDocument();
  const releaseCalls: number[] = [];
  const target: PointerCaptureTarget = { hasPointerCapture: () => true, releasePointerCapture: (id) => releaseCalls.push(id) };
  const guard = createCaptureBlurGuard(win, doc);

  guard.track(target, 3);
  doc.fireVisibilityChange("hidden");

  assert.deepEqual(releaseCalls, [3]);
});

test("createCaptureBlurGuard: a blur with nothing tracked is a silent no-op", () => {
  const win = makeMockWindow();
  const doc = makeMockDocument();
  const guard = createCaptureBlurGuard(win, doc);
  assert.doesNotThrow(() => win.fireBlur());
  guard.untrack(); // never tracked — still safe
});

test("createCaptureBlurGuard: untrack() before a blur prevents a stale release (the normal pointerup/pointercancel/lostpointercapture path)", () => {
  const win = makeMockWindow();
  const doc = makeMockDocument();
  const releaseCalls: number[] = [];
  const target: PointerCaptureTarget = { hasPointerCapture: () => true, releasePointerCapture: (id) => releaseCalls.push(id) };
  const guard = createCaptureBlurGuard(win, doc);

  guard.track(target, 1);
  guard.untrack();
  win.fireBlur();

  assert.deepEqual(releaseCalls, []);
});

test("createCaptureBlurGuard: dispose() removes the window/document listeners — a later blur/visibilitychange no longer releases anything", () => {
  const win = makeMockWindow();
  const doc = makeMockDocument();
  const releaseCalls: number[] = [];
  const target: PointerCaptureTarget = { hasPointerCapture: () => true, releasePointerCapture: (id) => releaseCalls.push(id) };
  const guard = createCaptureBlurGuard(win, doc);

  guard.track(target, 7);
  guard.dispose();
  win.fireBlur();
  doc.fireVisibilityChange("hidden");

  assert.deepEqual(releaseCalls, []);
});

test("createCaptureBlurGuard: tracking a new capture after a release replaces, never accumulates, the tracked target", () => {
  const win = makeMockWindow();
  const doc = makeMockDocument();
  const releaseCalls: Array<{ id: number }> = [];
  const targetA: PointerCaptureTarget = { hasPointerCapture: () => true, releasePointerCapture: (id) => releaseCalls.push({ id }) };
  const targetB: PointerCaptureTarget = { hasPointerCapture: () => true, releasePointerCapture: (id) => releaseCalls.push({ id }) };
  const guard = createCaptureBlurGuard(win, doc);

  guard.track(targetA, 1);
  guard.untrack();
  guard.track(targetB, 2);
  win.fireBlur();

  assert.deepEqual(releaseCalls, [{ id: 2 }]);
});
