"use client";

import ThemeToggle from "./ThemeToggle";

type TopBarProps = {
  title: string;
  onMenuClick: () => void;
  user?: { name: string; roleLabel: string };
};

export default function TopBar({ title, onMenuClick, user }: TopBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-3">
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
      </div>
      <div className="flex items-center gap-3">
        {user && (
          <div className="hidden items-center gap-2 sm:flex">
            <span className="text-sm text-zinc-700 dark:text-zinc-300">
              {user.name}님 · {user.roleLabel}
            </span>
            <form action="/api/auth/logout" method="post">
              <button
                type="submit"
                className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                로그아웃
              </button>
            </form>
          </div>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}
