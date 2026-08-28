"use client";

import ThemeToggle from "./ThemeToggle";
import { LogoutIcon } from "./FooterIcons";

type SidebarFooterProps = {
  user: { name: string; roleLabel: string };
  /**
   * **모양만** 정한다 — 좁은 아이콘 세로줄로 그릴지(true), 넓은 모양으로
   * 그릴지(false). "지금 사이드바가 눈에 보이는가"를 따르므로, 마우스
   * 머무름으로 펼쳐진 동안에도 false(= 넓은 모양)다. ☰ 옆 글자를 **그릴지
   * 말지**도 이 값이 정한다(내용은 isPinnedOpen 이 정한다).
   *
   * ☰ 의 말과는 무관하다. 왜 갈랐는지는 아래 파일 주석 참조.
   */
  isCompact: boolean;
  /**
   * ☰ 가 실제로 뒤집는 것 — **고정 펼침(pin)이 지금 켜져 있는가**. ☰ 의
   * 라벨 · title · aria-expanded · 옆 글자의 **내용**만 이 값을 본다(글자를
   * 그릴지 말지는 isCompact 다). 모양과 갈린 이유는 아래 파일 주석 참조.
   *
   * 기본값 true = "펼쳐져 고정된 상태". 이 prop 을 넘기지 않는 호출부(모바일
   * 드로어)는 늘 펼쳐져 있고 접는 개념이 없으므로 그쪽이 맞는 기본값이다 —
   * false 로 두면 폰에서 ☰ 의 말이 뒤집힌다.
   */
  isPinnedOpen?: boolean;
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
 * Compact mode (desktop-narrow only — mobile drawer is never compact)
 * keeps every control present (this file's own compact padding,
 * ThemeToggle's own `compact` mode using FooterIcons.tsx, and
 * `title`/`aria-label` throughout) — nothing is hidden outright, per the
 * "keep the bottom utility area usable" requirement; only the
 * presentation shrinks to fit the narrow column. Wide mode (desktop
 * expanded AND mobile drawer, identical rendering) centers the theme
 * control group (`justify-center` wrapper) with 로그아웃 directly below
 * it.
 *
 * ── 값이 **둘**인 이유 (`isCompact` vs `isPinnedOpen`) ─────────────────
 * 한때 이 둘은 `isCollapsed` 하나였다. 서로 다른 질문이라 갈랐다. 다시
 * 합치지 마라 — 합치면 아래 둘 중 하나가 반드시 깨진다.
 *
 *  - `isCompact` = "지금 사이드바가 눈에 안 보이는가" → **모양**을 정한다
 *    (패딩, 좁은 세로줄 대 넓은 목록, ☰ 행의 정렬, ☰ 옆 글자의 유무).
 *    사이드바는 마우스를 올리거나 초점이 들어오면 폭이 늘어 펼쳐지는데,
 *    그때 메뉴는 넓게 그려지므로 하단 유틸도 같이 넓어야 한다. 안 그러면
 *    펼쳐진 사이드바의 아래쪽만 아이콘 세로줄로 남는다.
 *
 *  - `isPinnedOpen` = "☰ 로 **고정 펼침**이 켜져 있는가" → ☰ 의 **말**을
 *    정한다(라벨 · title · aria-expanded · 옆 글자의 **내용**). 단추의 말은
 *    그 단추가 실제로 뒤집는 것을 가리켜야 하는데, ☰ 가 뒤집는 것은
 *    "보이는가"가 아니라 "고정인가"다.
 *
 * 왜 ☰ 만 고정 여부를 따르는가: ☰ 를 누르려면 마우스를 사이드바로
 * 가져가야 하고, 그 순간 이미 머무름으로 펼쳐져 있다. 여기에 "지금
 * 보이는가"(= isCompact)를 넘기면 ☰ 가 늘 `사이드바 접기` 라고 적힌 채로
 * 눌리고, 눌리면 오히려 펼쳐 고정되어 본문이 오른쪽으로 밀린다 — 적힌
 * 말과 정반대로 움직인다. aria-expanded 도 같은 이유로 고정 여부를 따른다.
 */
export default function SidebarFooter({ user, isCompact, isPinnedOpen = true, onToggleCollapsed, portalUrl = null }: SidebarFooterProps) {
  return (
    <div className={`flex flex-col gap-2 border-t border-zinc-200 dark:border-zinc-800 ${isCompact ? "p-2" : "p-3"}`}>
      {isCompact ? (
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
          title={isPinnedOpen ? "사이드바 접기" : "사이드바 펼치기"}
          aria-label={isPinnedOpen ? "사이드바 접기" : "사이드바 펼치기"}
          aria-expanded={isPinnedOpen}
          className={`flex items-center rounded-md px-2 py-1.5 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800 ${isCompact ? "justify-center" : "gap-2"}`}
        >
          <span aria-hidden="true">☰</span>
          {/* 글자의 **존재**는 모양(isCompact)을, 글자의 **내용**은 고정
              여부(isPinnedOpen)를 따른다. 존재까지 고정 여부를 따르게 하면
              머무름으로 펼친 동안 이 줄만 글자 없이 아이콘 하나로 남아,
              글자가 있는 테마·로그아웃 줄 옆에서 거기만 휑하다. */}
          {!isCompact && <span className="text-xs">{isPinnedOpen ? "사이드바 접기" : "사이드바 펼치기"}</span>}
        </button>
      )}
    </div>
  );
}
