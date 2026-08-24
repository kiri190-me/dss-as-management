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

/**
 * 접수 건 상세 화면의 주소들. 이름으로 꺼내 쓴다(`.approval`).
 *
 * 지금 이 주소들을 가리키는 곳이 셋이다 — 상세 화면의 탭 줄(DetailTabs),
 * 출하 체크리스트의 "승인 화면에서 처리" 링크(ShipmentApprovalChecklist),
 * 그리고 헤더 종 알림의 결재 요청 항목(notifications.ts). 셋이 **같은 곳**을
 * 가리켜야 하는데 문자열을 각자 적어 두면, 라우트 폴더 이름을 바꿀 때 하나를
 * 빠뜨려도 tsc도 테스트도 아무 말을 하지 않고 그 링크 하나만 조용히 404가
 * 된다. 그래서 한 곳에서만 만든다.
 *
 * 반환 타입을 명시해 두는 것도 같은 이유다 — 호출부의 `.aproval` 같은 오타가
 * 화면에서가 아니라 tsc에서 걸리게 한다.
 *
 * 키는 `src/app/(app)/repair-cases/[id]/` 아래의 실제 라우트와 1:1이다
 * (루트 page.tsx + 하위 6개). 라벨은 여기 두지 않는다 — 무엇이라 부를지는
 * 화면의 관심사다.
 */
export type RepairCaseDetailHrefs = {
  /** 루트(기본 정보). 나머지 여섯의 문자열 접두사이기도 하다. */
  root: string;
  execution: string;
  diagnosis: string;
  workHistory: string;
  files: string;
  approval: string;
  report: string;
};

export function repairCaseDetailHrefs(repairCaseId: string): RepairCaseDetailHrefs {
  const root = `/repair-cases/${repairCaseId}`;
  return {
    root,
    execution: `${root}/execution`,
    diagnosis: `${root}/diagnosis`,
    workHistory: `${root}/work-history`,
    files: `${root}/files`,
    approval: `${root}/approval`,
    report: `${root}/report`,
  };
}
