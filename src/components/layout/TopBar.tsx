"use client";

import NotificationBell from "./NotificationBell";
import type { NotificationItem } from "@/lib/domain/notifications";

type TopBarProps = {
  title: string;
  onMenuClick: () => void;
  /**
   * 지금 로그인한 사람이 처리해야 할 일(layout.tsx가 서버에서 계산해 넘긴다).
   * 종 버튼은 0건이어도 남아 있고, 배지만 사라진다.
   */
  notifications?: readonly NotificationItem[];
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
 *
 * 그 뒤 오른쪽에 다시 들어온 것은 **아이콘 버튼 하나(NotificationBell)**뿐이다.
 * 위 사고를 되풀이하지 않기 위한 선: 오른쪽에 놓이는 것은 햄버거와 같은
 * h-9 w-9 하나를 넘지 않고, 글자 묶음(사용자명/역할/버튼 라벨)은 여전히
 * SidebarFooter에만 둔다. 폰(360px)에서 햄버거 36 + 제목 + 종 36 + 좌우
 * 여백이라 넘칠 여지가 없고, 종의 펼침 패널은 자기 폭을 뷰포트 안으로 제한한다
 * (NotificationBell.tsx 주석 참조).
 */
export default function TopBar({ title, onMenuClick, notifications = [] }: TopBarProps) {
  return (
    // `h-14`가 `min-h-14`로 바뀐 것은 뒤의 pt 인셋 때문이다: 고정 높이
    // (border-box)에 패딩을 더하면 높이는 그대로인 채 안쪽 내용만 눌린다.
    // 인셋 값이 0인 환경(데스크톱, 대부분의 세로 화면)에서는 min-h-14가
    // 기존 h-14와 정확히 같은 56px로 렌더된다. 인셋이 있는 경우
    // (viewport-fit=cover로 화면 전체를 쓰게 되면서 상태 표시줄/노치 밑까지
    // 뷰포트가 확장된 상태)에만 그만큼 헤더가 아래로 밀린다.
    <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-4 pt-[env(safe-area-inset-top)] dark:border-zinc-800 dark:bg-zinc-900">
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
      {/* ml-auto는 NotificationBell 자신이 갖는다 — 여기 래퍼를 하나 더 두면
          펼침 패널의 기준(position: relative)이 두 겹이 된다. */}
      <NotificationBell items={notifications} />
    </header>
  );
}
