"use client";

type TopBarProps = {
  title: string;
  onMenuClick: () => void;
};

/**
 * Mobile UX/fix checkpoint — this header used to also render a right-side
 * cluster (user/role, 로그아웃, ThemeToggle), scoped to `md:hidden`. That
 * cluster measured ~386px on its own next to this left cluster's ~208px —
 * a combined ~594px minimum, with no wrap/shrink handling, that never fit
 * a real phone viewport (typically 360-430px). The header silently
 * overflowed horizontally on every real mobile device, which is what made
 * the hamburger button (and so every drawer link, including A/S 접수)
 * unreliable to reach on mobile. That cluster now lives exclusively in
 * SidebarFooter.tsx, rendered inside the mobile drawer (opened by this
 * component's own hamburger button below) — removing it here, rather than
 * just hiding it, is the actual fix: this header is now only ever the
 * hamburger + app title, comfortably under any real phone's width, with
 * no `user` prop needed anymore.
 */
export default function TopBar({ title, onMenuClick }: TopBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-900">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="메뉴 열기"
        className="flex h-9 w-9 items-center justify-center rounded-md text-zinc-700 hover:bg-zinc-100 md:hidden dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="18" x2="20" y2="18" />
        </svg>
      </button>
      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        DSS A/S 관리 시스템
      </span>
      {title && (
        <>
          <span className="hidden text-sm text-zinc-400 md:inline dark:text-zinc-500">
            /
          </span>
          <span className="hidden text-sm text-zinc-600 md:inline dark:text-zinc-400">
            {title}
          </span>
        </>
      )}
    </header>
  );
}
