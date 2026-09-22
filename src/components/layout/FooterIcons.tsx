type IconProps = { className?: string };

const STROKE_PROPS = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/**
 * Small hand-authored inline SVG icons — same convention as
 * procedures/visual/ProcedureNodeIcons.tsx (this project has no icon
 * library dependency installed, and 4 glyphs doesn't justify adding one).
 * All use `currentColor` so they inherit whatever text color the
 * surrounding button sets (active/inactive state, light/dark theme — both
 * handled by the caller, never here).
 *
 * 🔴 부르는 곳은 2026-09-22 에 바뀌었다. 해·달·화면 셋은 ThemeToggle 이
 * 쓰고(그 조각은 이제 사이드바가 아니라 **머리말 오른쪽**에 앉는다 —
 * TopBar.tsx), LogoutIcon 은 지금 **부르는 곳이 없다**: 사이드바 맨 아래의
 * 아이콘만 있던 로그아웃 단추가 사라지고, 머리말에서는 「로그아웃」이라는
 * 말을 온전히 적기 때문이다(그 말만은 줄이지 않는다는 선 — TopBar.tsx).
 * 지우지 않고 남겨 둔다: 좁은 자리에 로그아웃을 다시 놓을 일이 생기면
 * 그때 쓸 것이고, 없애는 판단은 사용자의 몫이다.
 */

export function SunIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE_PROPS} aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.5M12 19v2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2.5 12H5M19 12h2.5M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
    </svg>
  );
}

export function MoonIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE_PROPS} aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

export function SystemThemeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE_PROPS} aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="12" rx="1.5" />
      <path d="M8 19.5h8M12 16.5v3" />
    </svg>
  );
}

export function LogoutIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE_PROPS} aria-hidden="true">
      <path d="M14.5 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3" />
      <path d="M10 8.5l4 3.5-4 3.5" />
      <path d="M14 12H3.5" />
    </svg>
  );
}
