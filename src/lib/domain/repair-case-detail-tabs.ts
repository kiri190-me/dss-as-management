/**
 * Pure tab-active-matching logic for DetailTabs.tsx — extracted so it's
 * unit-testable without next/navigation's usePathname (which requires a
 * mounted Next.js App Router context and cannot run under this repo's
 * plain node:test harness).
 *
 * Longest-prefix match, not a blanket startsWith: "기본 정보"'s own href
 * (the case root, e.g. `/repair-cases/{id}`) is a PREFIX of every other
 * tab's href, so a naive `pathname.startsWith(tab.href)` check would match
 * — and appear active — on every tab's route. Whichever tab's href is the
 * most specific (longest) match against the current pathname wins, so a
 * tab with a nested child route (e.g. 진단 Flowchart's
 * `/diagnosis/[flowchartId]`) still highlights correctly without breaking
 * any sibling tab, including the root tab.
 */
export function resolveActiveTabHref(pathname: string, hrefs: readonly string[]): string | undefined {
  return hrefs
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
}
