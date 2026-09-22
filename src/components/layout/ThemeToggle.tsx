"use client";

import { useEffect, useSyncExternalStore } from "react";
import { SunIcon, MoonIcon, SystemThemeIcon } from "./FooterIcons";

type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "theme";

const options: { mode: ThemeMode; label: string; Icon: (props: { className?: string }) => React.JSX.Element }[] = [
  { mode: "light", label: "밝게", Icon: SunIcon },
  { mode: "dark", label: "어둡게", Icon: MoonIcon },
  { mode: "system", label: "시스템 설정", Icon: SystemThemeIcon },
];

const listeners = new Set<() => void>();

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

function getSnapshot(): ThemeMode {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isThemeMode(stored) ? stored : "system";
}

function getServerSnapshot(): ThemeMode {
  return "system";
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

function applyTheme(mode: ThemeMode) {
  const isDark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
}

function setMode(next: ThemeMode) {
  window.localStorage.setItem(STORAGE_KEY, next);
  applyTheme(next);
  listeners.forEach((listener) => listener());
}

type ThemeToggleProps = {
  /**
   * 아이콘만 있는 **가로 한 줄** — 지금 이것을 쓰는 곳은 머리말 오른쪽
   * 묶음(TopBar.tsx)이다. 글자 모양(밝게 · 어둡게 · 시스템 설정)은 ~190px 이라
   * 폰 한 줄에서 「포털」· 「로그아웃」· 종과 같이 서지 못한다.
   *
   * 🔴 2026-09-22 까지 이 모양은 **세로**였다(`flex-col`) — 접힌 사이드바의
   * 좁은 세로줄이 유일한 호출부였기 때문이다. 그 넷이 머리말로 올라오면서
   * (TopBar.tsx 의 2026-09-22 주석) 세로로 쌓을 자리가 없어졌다: 세로면
   * 8px 짜리 아이콘 셋이 96px 높이가 되어 56px 짜리 머리말을 깨뜨린다.
   *
   * 상태와 동작은 두 모양이 완전히 같다 — 바뀌는 것은 그리는 모습뿐이고,
   * 어느 쪽이든 고른 것은 `aria-pressed` 와 배경색으로, 각 단추가 무엇인지는
   * `title`/`aria-label` 로 알린다.
   */
  compact?: boolean;
};

export default function ThemeToggle({ compact = false }: ThemeToggleProps) {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    applyTheme(mode);
    if (mode !== "system") {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyTheme("system");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [mode]);

  return (
    <div
      role="group"
      aria-label="테마 선택"
      // compact 는 **가로 한 줄**이다(2026-09-22 이전에는 flex-col 이었다 —
      // 위 prop 주석). 테두리도 안쪽 여백도 두지 않는다: 머리말에서는 옆의
      // 「포털」· 「로그아웃」 단추가 이미 테두리를 갖고 있어, 여기에 테두리를
      // 한 겹 더 두면 세 덩이가 서로 다른 크기의 상자로 보인다.
      className={compact ? "flex items-center gap-1" : "flex items-center gap-1 rounded-md border border-zinc-200 p-1 dark:border-zinc-700"}
    >
      {options.map((option) => (
        <button
          key={option.mode}
          type="button"
          aria-pressed={mode === option.mode}
          title={option.label}
          aria-label={option.label}
          onClick={() => setMode(option.mode)}
          className={
            compact
              ? mode === option.mode
                ? "flex h-8 w-8 items-center justify-center rounded bg-primary-900 text-zinc-50 dark:bg-primary-50 dark:text-zinc-900"
                : "flex h-8 w-8 items-center justify-center rounded text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              : mode === option.mode
                ? "rounded px-2 py-1 text-xs font-medium bg-primary-900 text-zinc-50 dark:bg-primary-50 dark:text-zinc-900"
                : "rounded px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          }
        >
          {compact ? <option.Icon className="h-4 w-4" /> : option.label}
        </button>
      ))}
    </div>
  );
}
