"use client";

import { useState } from "react";
import Link from "next/link";
import { navItems, navGroups, childNavItems, filterNavItemsForAccess, type NavItem } from "@/lib/navigation";
import type { Role } from "@/lib/domain/types";
import SidebarFooter from "./SidebarFooter";

type SidebarProps = {
  activeHref: string;
  role: Role;
  user: { name: string; roleLabel: string };
  onNavigate?: () => void;
  /** Whole-sidebar narrow/icon-only mode (distinct from per-group collapse below). Omitted (mobile drawer) means "always expanded" — the mobile drawer has no narrow/icon-only mode of its own. */
  isCollapsed?: boolean;
  /**
   * 하단 유틸 영역(SidebarFooter)만 좁은 모양으로 그릴지. 기본값은
   * `isCollapsed` 와 같아서, 이 prop 을 넘기지 않는 호출부(모바일 드로어)는
   * 예전과 완전히 동일하게 동작한다.
   *
   * 데스크톱에서만 둘이 갈린다. 마우스를 올려 **떠서 덮는** 동안은 메뉴를
   * 펼쳐 그리지만(`isCollapsed === false`) 아직 ☰ 로 **고정**한 것은 아니다.
   * SidebarFooter 의 ☰ 는 바로 그 "고정"을 뒤집는 단추이므로 라벨과
   * `aria-expanded` 가 가리켜야 하는 것은 고정 여부다 — 그래서 footer 에는
   * 고정 여부를 따로 넘긴다. 이 둘을 하나로 합치면, 마우스를 올린 동안 ☰ 가
   * "사이드바 접기"라고 적힌 채로 눌리면 오히려 펼쳐 고정되는 모순이 생긴다
   * (☰ 는 마우스로 다가가야 눌리므로 그 상태가 오히려 기본이 된다).
   */
  isFooterCollapsed?: boolean;
  /** 관리자가 설정한 접근 가능 영역. null이면 역할 기준만으로 거른다(navigation.ts 참조). */
  accessibleAreaKeys?: readonly string[] | null;
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
 *  - `collapsedGroupKeys` (per-group, local state) — which GROUPS show
 *    their children at all when the sidebar itself is expanded. Starts
 *    empty (every group open by default), driven only by this set, never
 *    re-derived from `activeHref`.
 *  - `isCollapsed` (whole-sidebar, owned by AppShell — a prop here, not
 *    local state, since it also drives the <aside>'s own width). While
 *    true, this checkpoint hides the ENTIRE nav area outright (no items,
 *    no group headers, not even glyphs) — only SidebarFooter's toggle
 *    control and account/theme/logout controls remain visible. Collapsing
 *    never touches `collapsedGroupKeys`: re-expanding the sidebar shows
 *    every group's header/chevron reflecting whatever that set already
 *    held, unchanged the entire time the sidebar was narrow.
 *
 * AppShell 은 이제 `isCollapsed` 를 "☰ 고정 펼침 OR 마우스/초점 머무름"의
 * 부정으로 계산해 넘긴다. 이 파일에서 달라지는 것은 없다 — 여기서는 여전히
 * "지금 메뉴를 그릴지"만 뜻한다. 갈라진 것은 `isFooterCollapsed` 뿐이고
 * (그 prop 의 주석 참조), `collapsedGroupKeys` 는 여기에 전혀 엮이지 않는다.
 *
 * Both persist across client-side navigation within this component's
 * mounted lifetime (AppShell/Sidebar don't remount on route change) —
 * reset only on a full page load, no localStorage (not required yet).
 */
export default function Sidebar({ activeHref, role, user, onNavigate, isCollapsed = false, isFooterCollapsed = isCollapsed, onToggleCollapsed, accessibleAreaKeys = null, myPendingApprovalCount = 0, portalUrl = null }: SidebarProps) {
  const visibleItems = filterNavItemsForAccess(navItems, role, accessibleAreaKeys);
  const visibleByKey = new Map(visibleItems.map((item) => [item.key, item]));
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<string>>(new Set());

  const dashboardItem = visibleByKey.get(DASHBOARD_KEY);
  // 대시보드의 하위메뉴 — 볼 수 있는 것만 남긴다(권한 필터를 거친 목록에서 고른다).
  const dashboardChildren = childNavItems(visibleItems, DASHBOARD_KEY);

  function toggleGroup(key: string) {
    setCollapsedGroupKeys((prev) => {
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
        {!isCollapsed && (
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

              const isExpanded = !collapsedGroupKeys.has(group.key);

              return (
                <div key={group.key} className="mt-3 flex flex-col gap-0.5 border-t border-zinc-100 pt-2 first:mt-1 first:border-0 first:pt-0 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    aria-expanded={isExpanded}
                    className="flex items-center justify-between rounded-md bg-zinc-50 px-3 py-2 text-xs font-bold tracking-wide text-zinc-600 uppercase hover:bg-zinc-100 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    <span>{group.label}</span>
                    <span className={`text-zinc-400 transition-transform dark:text-zinc-500 ${isExpanded ? "rotate-90" : ""}`} aria-hidden="true">
                      ▸
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="ml-3 flex flex-col gap-0.5 border-l border-zinc-200 py-1 pl-2 dark:border-zinc-800">{groupItems.map(renderItem)}</div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </nav>

      <SidebarFooter user={user} isCollapsed={isFooterCollapsed} onToggleCollapsed={onToggleCollapsed} portalUrl={portalUrl} />
    </div>
  );
}
