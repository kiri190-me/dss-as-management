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
  /** Icon-only buttons stacked vertically — for the collapsed sidebar footer, where a horizontal 3-label group doesn't fit. Same mode state/logic either way, only the rendering changes. */
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
      className={compact ? "flex flex-col items-center gap-1" : "flex items-center gap-1 rounded-md border border-zinc-200 p-1 dark:border-zinc-700"}
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
                ? "flex h-8 w-8 items-center justify-center rounded bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                : "flex h-8 w-8 items-center justify-center rounded text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              : mode === option.mode
                ? "rounded px-2 py-1 text-xs font-medium bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                : "rounded px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          }
        >
          {compact ? <option.Icon className="h-4 w-4" /> : option.label}
        </button>
      ))}
    </div>
  );
}
