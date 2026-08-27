"use client";

import ThemeToggle from "./ThemeToggle";
import { LogoutIcon } from "./FooterIcons";

type SidebarFooterProps = {
  user: { name: string; roleLabel: string };
  isCollapsed: boolean;
  /** Omitted for the mobile drawer (which has no collapse concept of its own — it's already always "expanded" and closes via its own backdrop/close button) — the ☰ toggle row only renders when this is provided. */
  onToggleCollapsed?: () => void;
  /**
   * 통합 로그인 앱 목록 주소. null이면(데모 모드) 링크를 아예 그리지 않는다.
   *
   * 이 시스템 밖으로 나가는 링크라 next/link가 아니라 평범한 <a>다.
   */
  portalUrl?: string | null;
};

/** First character of a label — kept for the user avatar badge only (unchanged from the prior pass); logout/theme now use FooterIcons.tsx's real icons instead of this same convention. */
function glyph(label: string): string {
  return label.trim().charAt(0) || "?";
}

/**
 * Bottom utility area of BOTH the desktop <aside> and the mobile drawer
 * (Sidebar.tsx now mounts this unconditionally). Houses what used to live
 * in TopBar's top-right corner (user/role, 로그아웃, ThemeToggle's
 * 밝게/어둡게/시스템 설정) plus, on desktop only, the sidebar's own
 * expand/collapse control (`onToggleCollapsed` omitted on mobile — see
 * this prop's own doc comment). TopBar no longer renders that cluster at
 * all (removed, not just hidden) — this is now the SINGLE place those
 * controls live, at every viewport width, never duplicated.
 *
 * Mobile-bug note: TopBar's old `md:hidden` right-side cluster (this exact
 * content) measured ~386px on its own, alongside a ~208px left cluster
 * (hamburger + app title) — a combined ~594px minimum that never fit a
 * real phone viewport (typically 360-430px) and had no wrap/shrink
 * handling, so the header silently overflowed horizontally on every real
 * mobile device. That overflow is what made the hamburger menu (and so
 * every drawer link, including A/S 접수) unreliable to reach on mobile.
 * Removing the cluster from TopBar (this checkpoint) fixes that at the
 * root — TopBar's header is now just the hamburger + title, comfortably
 * under any real phone's width.
 *
 * Collapsed mode (desktop-narrow only — mobile drawer is never collapsed)
 * keeps every control present (this file's own compact padding,
 * ThemeToggle's own `compact` mode using FooterIcons.tsx, and
 * `title`/`aria-label` throughout) — nothing is hidden outright, per the
 * "keep the bottom utility area usable" requirement; only the
 * presentation shrinks to fit the narrow column. Expanded mode (desktop
 * expanded AND mobile drawer, identical rendering) centers the theme
 * control group (`justify-center` wrapper) with 로그아웃 directly below
 * it.
 */
export default function SidebarFooter({ user, isCollapsed, onToggleCollapsed, portalUrl = null }: SidebarFooterProps) {
  return (
    <div className={`flex flex-col gap-2 border-t border-zinc-200 dark:border-zinc-800 ${isCollapsed ? "p-2" : "p-3"}`}>
      {isCollapsed ? (
        <div className="flex flex-col items-center gap-2">
          <span
            title={`${user.name}님 · ${user.roleLabel}`}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
          >
            {glyph(user.name)}
          </span>
          <ThemeToggle compact />
          {portalUrl && (
            <a
              href={portalUrl}
              title="통합 로그인으로"
              aria-label="통합 로그인으로"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <span aria-hidden="true" className="text-sm">
                ⌂
              </span>
            </a>
          )}
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              title="로그아웃"
              aria-label="로그아웃"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <LogoutIcon className="h-4 w-4" />
            </button>
          </form>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="truncate text-sm text-zinc-700 dark:text-zinc-300" title={`${user.name}님 · ${user.roleLabel}`}>
            {user.name}님 · {user.roleLabel}
          </p>
          <div className="flex justify-center">
            <ThemeToggle />
          </div>
          {portalUrl && (
            <a
              href={portalUrl}
              className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-center text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              통합 로그인으로
            </a>
          )}
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              로그아웃
            </button>
          </form>
        </div>
      )}

      {onToggleCollapsed && (
        <button
          type="button"
          onClick={onToggleCollapsed}
          title={isCollapsed ? "사이드바 펼치기" : "사이드바 접기"}
          aria-label={isCollapsed ? "사이드바 펼치기" : "사이드바 접기"}
          aria-expanded={!isCollapsed}
          className={`flex items-center rounded-md px-2 py-1.5 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800 ${isCollapsed ? "justify-center" : "gap-2"}`}
        >
          <span aria-hidden="true">☰</span>
          {!isCollapsed && <span className="text-xs">사이드바 접기</span>}
        </button>
      )}
    </div>
  );
}
