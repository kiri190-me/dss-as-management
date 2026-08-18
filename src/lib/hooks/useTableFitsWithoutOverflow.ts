"use client";

import { useEffect, useLayoutEffect, useState, type DependencyList, type RefObject } from "react";

// useLayoutEffect on the client (measures before paint, no flicker); plain
// useEffect during SSR (useLayoutEffect is a no-op there and logs a
// harmless-but-noisy React warning if used directly in a component that's
// also server-rendered, which every "use client" page still is on first
// load).
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Real overflow detection for a table/card switch — container-based, not a
 * fixed viewport breakpoint. `wrapperRef` must be attached to the actual
 * element the <table> renders inside (kept mounted, real DOM, real layout);
 * `fits` is true exactly when that wrapper's content does NOT overflow its
 * own box (`scrollWidth <= clientWidth`), i.e. the table would render with
 * no horizontal scrollbar at the wrapper's current width. Re-measures on
 * two independent triggers, both needed:
 *  - ResizeObserver on the wrapper — catches the wrapper's OWN box-width
 *    changes (window resize, sidebar collapse/expand, browser zoom). This
 *    fires regardless of whether the wrapper is currently shown in normal
 *    flow or kept off-screen (see the caller's `fits`-driven className) —
 *    both cases size the wrapper to the same real container width, so
 *    measurement stays accurate even while the table isn't the visible
 *    choice, which is what lets the layout switch back to table once
 *    enough width returns.
 *  - `deps` — catches CONTENT-driven width changes (row count/content from
 *    filtering or pagination, optional columns appearing/disappearing per
 *    role) that don't necessarily change the wrapper's own box size and
 *    therefore would never fire ResizeObserver on their own.
 * Defaults to `fits: true` (table) so server-rendered HTML and the first
 * client paint agree — useIsomorphicLayoutEffect corrects it synchronously
 * before the browser paints if the real measurement disagrees, so there is
 * no flash of the wrong layout on mount, and no flicker on resize since
 * ResizeObserver callbacks are batched before the next paint.
 *
 * Shared by any table/card-list pair that needs a real-overflow-triggered
 * switch instead of a fixed `md:` breakpoint — first used by the diagnosis
 * flowcharts management screen, reused as-is (not generalized further) by
 * the main repair-case list.
 */
export function useTableFitsWithoutOverflow(wrapperRef: RefObject<HTMLDivElement | null>, deps: DependencyList): boolean {
  const [fits, setFits] = useState(true);

  useIsomorphicLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    function measure() {
      if (!wrapper) return;
      setFits(wrapper.scrollWidth <= wrapper.clientWidth);
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrapper);
    return () => observer.disconnect();
    // deps deliberately drives re-measurement on content-width changes (see doc comment); wrapperRef itself is a stable ref object.
  }, deps);

  return fits;
}
