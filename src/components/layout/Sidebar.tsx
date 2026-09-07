"use client";

import { useState } from "react";
import Link from "next/link";
import { navItems, navGroups, childNavItems, filterNavItemsForAccess, type NavItem } from "@/lib/navigation";

import SidebarFooter from "./SidebarFooter";

type SidebarProps = {
  activeHref: string;
  user: { name: string; roleLabel: string };
  onNavigate?: () => void;
  /**
   * Whole-sidebar narrow/icon-only mode (distinct from per-group collapse
   * below). Omitted (mobile drawer) means "always expanded" — the mobile
   * drawer has no narrow/icon-only mode of its own.
   *
   * 🔴 **넘겼는지 여부 자체가** "여기는 hover 가 있는 데스크톱 <aside> 인가"를
   * 뜻한다(`supportsHoverExpand`). 좁은 모양이 존재하는 곳은 데스크톱뿐이라
   * 이 prop 을 넘기는 호출부도 데스크톱뿐이다 — 그래서 모바일 드로어에
   * 새 prop 을 더하지 않고 이 차이를 그대로 빌려 쓴다.
   */
  isCollapsed?: boolean;
  /**
   * ☰ 로 **고정 펼침**이 켜져 있는지. 하단 유틸의 *모양*과는 상관없고
   * (모양은 위 `isCollapsed` 를 그대로 따른다), SidebarFooter 의 ☰ 단추가
   * 뭐라고 적히는지 · `aria-expanded` 가 무엇인지만 정한다.
   *
   * 데스크톱에서만 `isCollapsed` 와 갈린다. 마우스를 올려 **머무름으로
   * 펼쳐진** 동안은 메뉴도 하단 유틸도 펼쳐 그리지만(`isCollapsed === false`)
   * 아직 ☰ 로 **고정**한 것은 아니라 이 값은 false 다. ☰ 는 바로 그 "고정"을
   * 뒤집는 단추이므로 그 말과 `aria-expanded` 가 가리켜야 하는 것은 고정
   * 여부다 — 자세한 근거는 SidebarFooter.tsx 의 파일 주석 참조.
   *
   * 기본값 true = "펼쳐져 고정됨". 이 prop 을 넘기지 않는 호출부(모바일
   * 드로어)는 늘 펼쳐져 있고 접는 개념이 없다.
   */
  isPinnedOpen?: boolean;
  /**
   * 관리자가 설정한 접근 가능 영역 — **메뉴 노출을 정하는 유일한 값이다.**
   *
   * 🔴 필수다. 예전에는 없으면 역할 기준으로 물러났는데, 역할 술어가 사라진
   * 지금 그 자리를 남겨 두면 **안 넘긴 호출부에서 전 메뉴가 열린다.** 실제로
   * 모바일 드로어가 안 넘기고 있었다(2026-08-31, AppShell 에서 고침).
   */
  accessibleAreaKeys: readonly string[];
  /**
   * 개발자 모드 항목을 그릴지 — **위 접근 권한과는 다른 축이다.**
   *
   * 그 항목은 PERMISSION_AREAS 에 없어서 accessibleAreaKeys 에 절대 담기지
   * 않는다(설정으로 열 수 없다는 뜻이다). 대신 서버가
   * mayEnterDeveloperMode 로 계산해 내려보낸다(auth/developer-mode-gate.ts).
   *
   * 🔴 필수다. accessibleAreaKeys 와 **똑같은 함정**이 있다 — 데스크톱만 넘기고
   * 모바일 드로어를 빠뜨리면 폰에서 아무나 이 메뉴를 본다(2026-08-31 에 실제로
   * 일어난 일). 빠뜨리면 컴파일이 실패하게 둔다.
   */
  canEnterDeveloperMode: boolean;
  /** 통합 로그인 앱 목록 주소. 데모 모드에서는 null이라 링크를 그리지 않는다. */
  portalUrl?: string | null;
  /** Omitted for the mobile drawer — SidebarFooter only renders its ☰ toggle row when this is provided (see SidebarFooter.tsx's doc comment). The footer itself (account/theme/logout) always renders regardless, for both desktop and mobile. */
  onToggleCollapsed?: () => void;
  /**
   * 로그인한 사용자가 결재해야 할 A/S 건수 — 서버가 세션에서 푼 사용자 id로
   * 계산해 내려준다(queries/repair-case-approvals-pending.ts). 0이면 배지를
   * 그리지 않는다: "0"이라고 적힌 배지는 할 일이 있는 것처럼 눈에 띄기만 한다.
   */
  myPendingApprovalCount?: number;
};

const DASHBOARD_KEY = "dashboard";
const REPAIR_CASES_KEY = "repairCases";
/** 배지를 누르면 그 건들만 걸러진 목록으로 간다 — 필터 파싱은 repair-case-filters.ts. */
const MY_PENDING_APPROVAL_HREF = "/repair-cases?myApproval=1";

/**
 * ============================================================================
 * 하위메뉴가 펼쳐지고 닫히는 속도 — **고치려면 이 한 줄만 고친다**
 * ============================================================================
 * 예전에는 `{isExpanded && …}` 로 붙였다 뗐다 해서 아무 움직임이 없었다.
 * 툭 하고 나타나는 것이 "너무 빠르다"로 느껴져 부드럽게 바꾼 것이다.
 *
 * 200ms 를 고른 이유: 사이드바 폭 전환이 150ms 인데(AppShell.tsx) 그보다
 * 눈에 띄게 느리되, 그룹을 마우스로 훑을 때 끈적하지 않은 선이다. 머무름
 * 만으로도 펼쳐지므로 300ms 를 넘기면 커서를 옆으로 옮기는 동안 메뉴가
 * 계속 따라 열려 어지럽다.
 *
 * ▸ 화살표도 같은 값을 쓴다 — 따로 두면 화살표가 먼저 돌고 메뉴가 나중에
 * 따라오는 것이 보인다.
 * ============================================================================
 */
const SUBMENU_TRANSITION = "duration-200 ease-out motion-reduce:transition-none";

function navLinkClassName(isActive: boolean): string {
  return isActive
    ? "rounded-md border-l-2 border-zinc-900 bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 dark:border-zinc-50 dark:bg-zinc-800 dark:text-zinc-50"
    : "rounded-md border-l-2 border-transparent px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50";
}

/**
 * Checkpoint 2A (grouped sidebar) + refinement passes. 대시보드 renders
 * standalone (never inside a group, per the approved IA), now with its own
 * 하위메뉴 indented directly beneath it (NavItem.parentKey — 주간보고,
 * 2026-08-25). 하위메뉴는 그룹이 아니다: 접었다 펴는 구획을 만들지 않고 부모
 * 링크 바로 아래에 한 단 들여쓴 링크로만 그린다 — 대시보드가 단독으로 서 있는
 * 모양은 그대로 두면서 "이 화면에 딸린 화면"이라는 관계만 보이게 하는 방법이다.
 * Every other item is partitioned into navigation.ts's navGroups. Role-based
 * visibility is still decided ONLY by filterNavItemsForAccess (unchanged) —
 * the submenu is filtered through that same list, never a second gate; grouping is a
 * pure display concern layered on top, never a second gate: a group whose
 * every child is filtered out for this role renders nothing at all (no
 * empty header).
 *
 * Two INDEPENDENT collapse concepts live in this file, deliberately never
 * merged into one state:
 *  - per-group open state (local state) — which GROUPS show their children
 *    at all when the sidebar itself is expanded, driven only by this
 *    component's own state, never re-derived from `activeHref`. 사이드바
 *    자신과 **같은 규칙**으로 둘로 갈라져 있다: 눌러서 펼쳐 둔
 *    `expandedGroupKeys`(명시적 선택)와 지금 마우스가 올라와 있는
 *    `hoveredGroupKey`(머무름). 둘 중 하나라도 참이면 그 그룹이 펼쳐진다.
 *    🔴 기본은 **전부 접힘**이다 — 예전 `collapsedGroupKeys`(= 접힌 것들을
 *    담고 빈 집합으로 시작)에서 **담는 뜻을 뒤집어** "펼쳐 둔 것들"을 담게
 *    바꾼 결과다. 단, hover 가 없는 모바일 드로어만은 전 그룹을 담아
 *    시작한다(아래 `supportsHoverExpand` 참조).
 *  - `isCollapsed` (whole-sidebar, owned by AppShell — a prop here, not
 *    local state, since it also drives the <aside>'s own width). While
 *    true, this checkpoint hides the ENTIRE nav area outright (no items,
 *    no group headers, not even glyphs) — only SidebarFooter's toggle
 *    control and account/theme/logout controls remain visible. Collapsing
 *    never touches the per-group state: re-expanding the sidebar shows
 *    every group's header/chevron reflecting whatever that state already
 *    held, unchanged the entire time the sidebar was narrow.
 *
 * AppShell 은 이제 `isCollapsed` 를 "☰ 고정 펼침 OR 마우스/초점 머무름"의
 * 부정으로 계산해 넘긴다. 이 파일에서 달라지는 것은 없다 — 여기서는 여전히
 * "지금 메뉴를 그릴지"만 뜻하고, **하단 유틸의 모양도 같은 값을 따른다**
 * (메뉴가 보이면 하단도 넓게). 따로 갈라 넘기는 것은 `isPinnedOpen` 뿐인데
 * 그것은 모양이 아니라 ☰ 의 말만 정한다(그 prop 의 주석 참조). 그룹별
 * 상태는 여기에 전혀 엮이지 않는다 — 규칙만 닮았을 뿐 서로 다른 상태다.
 *
 * Both persist across client-side navigation within this component's
 * mounted lifetime (AppShell/Sidebar don't remount on route change) —
 * reset only on a full page load, no localStorage (not required yet).
 */
export default function Sidebar({ activeHref, user, onNavigate, isCollapsed, isPinnedOpen = true, onToggleCollapsed, accessibleAreaKeys, canEnterDeveloperMode, myPendingApprovalCount = 0, portalUrl = null }: SidebarProps) {
  const visibleItems = filterNavItemsForAccess(navItems, accessibleAreaKeys, canEnterDeveloperMode);
  const visibleByKey = new Map(visibleItems.map((item) => [item.key, item]));
  /** 좁은 모양으로 그릴지. prop 을 넘기지 않는 모바일 드로어는 늘 넓다. */
  const isNarrow = isCollapsed ?? false;
  /**
   * 그룹을 마우스로 펼칠 수 있는가 = 여기가 데스크톱 <aside> 인가.
   * 🔴 폰에는 hover 가 없어서, 모바일 드로어까지 접힌 채 시작하면 메뉴를
   * 펼칠 방법이 머리글을 하나하나 누르는 것뿐이 된다. 그래서 접힌 채 시작하는
   * 것도, 마우스 핸들러를 다는 것도 **데스크톱에서만** 한다(터치는 탭에도
   * mouseenter 를 흘려서, 핸들러를 달아 두면 머리글을 눌러 접는 동작이
   * 머무름에 곧바로 되펼쳐져 먹히지 않는다).
   */
  const supportsHoverExpand = isCollapsed !== undefined;
  /**
   * 눌러서 **펼쳐 둔** 그룹들. 이름 그대로 "펼쳐 둔 것들"만 담으므로
   * 데스크톱은 빈 집합 = **전부 접힘**으로 시작하고, hover 가 없는 모바일
   * 드로어만 전 그룹을 담아 **전부 펼침**으로 시작한다(파일 주석 참조).
   */
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(() =>
    supportsHoverExpand ? new Set<string>() : new Set(navGroups.map((group) => group.key)),
  );
  /** 지금 마우스가 올라와 있는 그룹. 커서는 하나뿐이라 집합이 아니라 하나다. */
  const [hoveredGroupKey, setHoveredGroupKey] = useState<string | null>(null);

  const dashboardItem = visibleByKey.get(DASHBOARD_KEY);
  // 대시보드의 하위메뉴 — 볼 수 있는 것만 남긴다(권한 필터를 거친 목록에서 고른다).
  const dashboardChildren = childNavItems(visibleItems, DASHBOARD_KEY);

  /** 머리글을 누르면 "펼쳐 둠"을 뒤집는다 — 켜 두면 마우스를 떼도 남는다. */
  function toggleGroup(key: string) {
    setExpandedGroupKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function renderItem(item: NavItem) {
    const isActive = item.href === activeHref;
    const link = (
      <Link href={item.href} onClick={onNavigate} aria-current={isActive ? "page" : undefined} className={`${navLinkClassName(isActive)} min-w-0 flex-1`}>
        {item.label}
      </Link>
    );

    // 배지는 메뉴 링크 **옆의 별도 링크**다. 목적지가 다르기 때문에(메뉴는
    // 전체 목록, 배지는 걸러진 목록) 하나의 <a> 안에 넣을 수 없다.
    const showBadge = item.key === REPAIR_CASES_KEY && myPendingApprovalCount > 0;

    return (
      <div key={item.href} className="flex items-center gap-1">
        {link}
        {showBadge && (
          <Link
            href={MY_PENDING_APPROVAL_HREF}
            onClick={onNavigate}
            title="내게 온 결재 요청만 보기"
            aria-label={`내게 온 결재 요청 ${myPendingApprovalCount}건 보기`}
            className="shrink-0 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white tabular-nums hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500"
          >
            {myPendingApprovalCount}
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
        {!isNarrow && (
          <>
            {dashboardItem && renderItem(dashboardItem)}
            {/* 대시보드에 딸린 화면들. 부모가 보이지 않는 사람에게는 하위메뉴도
                그리지 않는다 — 부모 없이 떠 있는 들여쓴 링크는 어디에 딸린
                것인지 알 수 없다. 각 항목의 표시 여부는 여전히
                filterNavItemsForAccess 가 정한다(visibleByKey 에 없으면 없다). */}
            {dashboardItem && dashboardChildren.length > 0 && (
              <div className="ml-3 flex flex-col gap-0.5 border-l border-zinc-200 py-0.5 pl-2 dark:border-zinc-800">
                {dashboardChildren.map(renderItem)}
              </div>
            )}

            {navGroups.map((group) => {
              const groupItems = group.itemKeys.map((key) => visibleByKey.get(key)).filter((item): item is NavItem => !!item);
              if (groupItems.length === 0) return null;

              // 눌러서 펼쳐 뒀거나(고정) 지금 마우스가 올라와 있으면(머무름)
              // 펼친다 — 사이드바 자신과 같은 규칙이다. aria-expanded 와 ▸
              // 회전은 둘의 합, 곧 **지금 실제로 펼쳐져 있는지**를 가리킨다.
              const isExpanded = expandedGroupKeys.has(group.key) || hoveredGroupKey === group.key;

              return (
                <div
                  key={group.key}
                  onMouseEnter={supportsHoverExpand ? () => setHoveredGroupKey(group.key) : undefined}
                  // 떠날 때는 "내가 마지막에 들어온 그룹일 때만" 지운다 —
                  // 옆 그룹의 mouseenter 가 먼저 오면 그것을 덮어쓰게 된다.
                  onMouseLeave={supportsHoverExpand ? () => setHoveredGroupKey((prev) => (prev === group.key ? null : prev)) : undefined}
                  /* gap 을 여기서 빼고 아래 애니메이션 칸 안으로 옮겼다 — 하위메뉴가 접혀
                     있어도 DOM 에 남으므로, gap 을 여기 두면 **접힌 그룹마다 2px 씩
                     늘어난다.** 안으로 옮기면 높이와 함께 접혀 예전과 같아진다. */
                  className="mt-3 flex flex-col border-t border-zinc-100 pt-2 first:mt-1 first:border-0 first:pt-0 dark:border-zinc-800"
                >
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    aria-expanded={isExpanded}
                    className="flex items-center justify-between rounded-md bg-zinc-50 px-3 py-2 text-xs font-bold tracking-wide text-zinc-600 uppercase hover:bg-zinc-100 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    <span>{group.label}</span>
                    <span className={`text-zinc-400 transition-transform ${SUBMENU_TRANSITION} dark:text-zinc-500 ${isExpanded ? "rotate-90" : ""}`} aria-hidden="true">
                      ▸
                    </span>
                  </button>
                  {/*
                   * 접혀 있어도 **DOM 에는 남겨 둔다** — 붙였다 떼면 전환할
                   * 것이 없어 움직임이 생기지 않는다. 대신 두 가지를 챙긴다:
                   *
                   *  행 높이 0fr → 1fr    그룹마다 항목 수가 달라도 높이를
                   *                       재지 않아도 된다. max-height 에 큰
                   *                       값을 박는 방식은 그룹마다 속도가
                   *                       달라 보인다(빈 공간을 지나는 시간이
                   *                       항목 수에 따라 다르므로).
                   *  inert + aria-hidden  🔴 붙였다 떼던 때는 공짜로 되던 것.
                   *                       남겨 두면 **안 보이는 링크에 Tab 이
                   *                       걸리고 스크린리더가 읽는다.**
                   */}
                  <div
                    className={`grid transition-[grid-template-rows,opacity] ${SUBMENU_TRANSITION} ${
                      isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                    }`}
                    inert={!isExpanded}
                    aria-hidden={!isExpanded}
                  >
                    {/* 높이가 0fr 인 동안 내용이 삐져나오지 않게 가둔다 —
                        이 칸이 없으면 접힌 그룹의 글자가 그대로 겹쳐 보인다. */}
                    <div className="overflow-hidden pt-0.5">
                      <div className="ml-3 flex flex-col gap-0.5 border-l border-zinc-200 py-1 pl-2 dark:border-zinc-800">
                        {groupItems.map(renderItem)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </nav>

      {/* 하단 유틸의 모양은 메뉴와 같은 값(isNarrow)을 따르고, ☰ 의 말만
          고정 여부(isPinnedOpen)를 따른다 — 두 prop 의 주석 참조. */}
      <SidebarFooter user={user} isCompact={isNarrow} isPinnedOpen={isPinnedOpen} onToggleCollapsed={onToggleCollapsed} portalUrl={portalUrl} />
    </div>
  );
}
