"use client";

import NotificationBell from "./NotificationBell";
import type { NotificationItem } from "@/lib/domain/notifications";
import { acknowledgeNotificationAction } from "@/lib/server/actions/notification-acknowledgements";

type TopBarProps = {
  title: string;
  onMenuClick: () => void;
  /**
   * 지금 로그인한 사람이 처리해야 할 일(layout.tsx가 서버에서 계산해 넘긴다).
   * 종 버튼은 0건이어도 남아 있고, 배지만 사라진다.
   */
  notifications?: readonly NotificationItem[];
  /**
   * 사내 시스템 오가기 목록(@dss/ui 의 ServiceMenuBar). AppShell이 만들어
   * 내려보내고, 이 머리말이 **제목과 알림종 사이**에 그린다.
   *
   * 조각이 아니라 **다 그려진 노드**를 받는 이유: 이 파일이 @dss/ui 도,
   * 목록을 어디서 구하는지도 몰라야 한다. 그리는 자리만 여기가 정한다
   * (아래 min-w-0 래퍼 — 그 한 겹이 이 머리말의 선을 지키는 장치다).
   * 목록이 비면 그 조각이 스스로 null 이라 래퍼만 남고 아무것도 안 보인다.
   */
  serviceMenu?: React.ReactNode;
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
 *
 * 🔴 그 선은 **서비스 메뉴바가 이 줄로 들어온 뒤에도 그대로다**(2026-09-18 —
 * 회색 띠가 한 층을 더 차지해 답답하다는 지적). 목록은 칸이 여럿 붙는
 * 물건이지만, 여기서 `min-w-0 flex-1` 로 감싸 두었기 때문에 **남는 자리만
 * 쓴다**: flex 기준 폭이 0 이라 햄버거·제목·종의 자리를 먼저 다 떼어 주고,
 * 그러고도 남은 폭 안에서 제 목록을 가로로 굴린다(@dss/ui 의
 * `.dss-menu__list { overflow-x: auto }`). 남는 자리가 0 이면 폭 0 이 될 뿐,
 * 어떤 경우에도 햄버거와 종을 밀어내지 못한다. 게다가 그 조각은 768px 밑에서
 * 이름을 감추고 아이콘만 보인다 — 폰에서 칸 하나가 아이콘 하나 폭이다.
 *
 * 🔴 그러고도 폰에서는 메뉴 칸이 잘려 보였다(사용자 폰 사진). 남는 자리를
 * 실제로 먹고 있던 것은 **시스템 이름 글자**라, 같은 768px 에서 그것도 눈에서만
 * 감춘다(아래 sr-only md:not-sr-only). 이것은 위 사고의 반대 방향이다 — 줄에서
 * 글자를 **빼는** 변경이라 「오른쪽은 아이콘 하나」라는 선을 더 헐겁게 만든다.
 */
export default function TopBar({ title, onMenuClick, notifications = [], serviceMenu = null }: TopBarProps) {
  return (
    // `h-14`가 `min-h-14`로 바뀐 것은 pt 인셋 때문이다: 고정 높이
    // (border-box)에 패딩을 더하면 높이는 그대로인 채 안쪽 내용만 눌린다.
    // 인셋 값이 0인 환경(데스크톱, 대부분의 세로 화면)에서는 min-h-14가
    // 기존 h-14와 정확히 같은 56px로 렌더된다. 인셋이 있는 경우
    // (viewport-fit=cover로 화면 전체를 쓰게 되면서 상태 표시줄/노치 밑까지
    // 뷰포트가 확장된 상태)에만 그만큼 헤더가 아래로 밀린다.
    //
    // 🔴 그 `pt-[env(safe-area-inset-top)]` 는 **이 머리말이 갖는다**. 한때
    // 맨 위에 서비스 메뉴바가 회색 띠로 앉으면서 AppShell 로 옮겨 갔었지만,
    // 그 띠가 이 줄 안으로 들어온 지금 맨 위 요소는 다시 이 <header> 다.
    // 노치 인셋은 **맨 위 요소 하나만** 갖는다 — 둘이 가지면 아이폰에서
    // 노치 높이만큼 두 번 밀린다(@dss/ui README 3절).
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
      {/*
        시스템 이름. 폰(<768px)에서는 **눈에서만** 감춘다.

        왜: 이 한 줄에 햄버거 · 이름 · 서비스 메뉴바 · 알림종이 함께 들어간다.
        폰(360px)에서 이름이 14px 글자로 ~165px, 앞뒤 gap-3 까지 ~177px 을
        가져가는데, 그러고 나면 `min-w-0 flex-1` 인 메뉴바 칸에 남는 폭이
        50px 남짓이라 아이콘 칸(하나 ~38px) 셋 중 둘째부터 잘려 보인다
        (2026-09-18 사용자 폰 사진). 이름을 빼면 그 자리가 메뉴바로 간다.

        🔴 `sr-only` 이지 `hidden` 이 아니다 — 마크업에 그대로 남아 화면
        낭독기는 여전히 "DSS A/S 관리 시스템" 을 읽는다. display:none 으로
        지우면 폰에서 이 머리말에 시스템을 알리는 글자가 한 톨도 없게 된다.
        메뉴바가 제 서비스 이름을 감추는 방식(@dss/ui 의 clip-path)과 같은
        결이고, 기준점도 **같은 768px**(Tailwind `md`)이다 — 어긋나면 그
        사이 폭에서 「이름은 없는데 메뉴는 글자」인 어정쩡한 상태가 생긴다.

        🔴 감춰도 어느 시스템인지 알 수 있다: 메뉴바에서 지금 서비스 칸이
        2px 밑줄로 남고(그 CSS 는 폰에서 이름만 감출 뿐 밑줄은 그대로다),
        본문 맨 위에는 화면 이름이 <h1 class="text-xl"> 로 크게 있다.

        `sr-only` 는 position:absolute 라 flex 항목에서 빠진다 — 폭뿐 아니라
        앞뒤 gap-3 까지 함께 사라지는 것이 그래서다.
      */}
      <span className="sr-only text-sm font-semibold text-zinc-900 md:not-sr-only dark:text-zinc-50">
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
      {/*
        사내 시스템 오가기 목록. 제목 다음, 알림종 앞 — 넓은 화면에서 통째로
        비어 있던 가운데 자리다.

        🔴 `min-w-0 flex-1` 두 낱말이 이 파일의 선을 지킨다(위 주석):
        `flex-1` 은 기준 폭 0 + 남는 자리 다 갖기라, 햄버거·제목·종이 제 폭을
        먼저 가져간 **뒤에 남은 만큼만** 차지한다. `min-w-0` 은 안의 목록이
        길어도 이 칸이 제 내용 폭까지 부풀지 못하게 막는다 — 그 둘이 없으면
        목록이 길어질 때 오른쪽 종부터 화면 밖으로 밀려난다.

        목록이 없을 때(포털 배포 전·데모 모드) 이 조각은 스스로 null 이라
        빈 <div> 만 남는다 — 종은 여전히 ml-auto 로 오른쪽 끝이고 화면은
        예전과 같다.
      */}
      <div className="min-w-0 flex-1">{serviceMenu}</div>
      {/* ml-auto는 NotificationBell 자신이 갖는다 — 여기 래퍼를 하나 더 두면
          펼침 패널의 기준(position: relative)이 두 겹이 된다. */}
      <NotificationBell items={notifications} acknowledge={acknowledgeNotificationAction} />
    </header>
  );
}
