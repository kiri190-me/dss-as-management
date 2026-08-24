"use client";

import { useState } from "react";
import Link from "next/link";
import { navItems, navGroups, filterNavItemsForAccess, type NavItem } from "@/lib/navigation";
import type { Role } from "@/lib/domain/types";
import SidebarFooter from "./SidebarFooter";

type SidebarProps = {
  activeHref: string;
  role: Role;
  user: { name: string; roleLabel: string };
  onNavigate?: () => void;
  /** Whole-sidebar narrow/icon-only mode (distinct from per-group collapse below). Omitted (mobile drawer) means "always expanded" — the mobile drawer has no narrow/icon-only mode of its own. */
  isCollapsed?: boolean;
  /** 관리자가 설정한 접근 가능 영역. null이면 역할 기준만으로 거른다(navigation.ts 참조). */
  accessibleAreaKeys?: readonly string[] | null;
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
 * standalone (never inside a group, per the approved IA); every other item
 * is partitioned into navigation.ts's navGroups. Role-based visibility is
 * still decided ONLY by filterNavItemsForAccess (unchanged) — grouping is a
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
 * Both persist across client-side navigation within this component's
 * mounted lifetime (AppShell/Sidebar don't remount on route change) —
 * reset only on a full page load, no localStorage (not required yet).
 */
export default function Sidebar({ activeHref, role, user, onNavigate, isCollapsed = false, onToggleCollapsed, accessibleAreaKeys = null, myPendingApprovalCount = 0 }: SidebarProps) {
  const visibleItems = filterNavItemsForAccess(navItems, role, accessibleAreaKeys);
  const visibleByKey = new Map(visibleItems.map((item) => [item.key, item]));
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<string>>(new Set());

  const dashboardItem = visibleByKey.get(DASHBOARD_KEY);

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

      <SidebarFooter user={user} isCollapsed={isCollapsed} onToggleCollapsed={onToggleCollapsed} />
    </div>
  );
}
