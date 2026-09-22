"use client";

import NotificationBell from "./NotificationBell";
import ThemeToggle from "./ThemeToggle";
import type { NotificationItem } from "@/lib/domain/notifications";
import { acknowledgeNotificationAction } from "@/lib/server/actions/notification-acknowledgements";

type TopBarProps = {
  title: string;
  onMenuClick: () => void;
  /**
   * 지금 로그인한 사람. 머리말 오른쪽 묶음이 「이름님 · 역할」로 적는다
   * (2026-09-22 에 사이드바 맨 아래에서 이 줄로 옮겨 왔다 — 아래 파일 주석).
   *
   * 🔴 필수다. 이 값이 선택 인자가 되면 「로그아웃이 안 보이는 껍데기」가
   * 조용히 그려질 수 있다 — AppShell 이 user 를 필수로 받는 것과 같은 까닭이고
   * (그 파일의 prop 주석), 그래서 여기서도 물음표를 붙이지 않는다.
   */
  user: { name: string; roleLabel: string };
  /**
   * 통합 로그인(dss-auth) 앱 목록 주소. null 이면(데모 모드) 「통합 로그인으로」를
   * 아예 그리지 않는다 — 갈 곳이 없는 링크는 누르면 아무 일도 안 한다.
   *
   * 이 시스템 밖으로 나가는 주소라 next/link 가 아니라 평범한 <a> 다.
   */
  portalUrl?: string | null;
  /**
   * 지금 로그인한 사람이 처리해야 할 일(layout.tsx가 서버에서 계산해 넘긴다).
   * 종 버튼은 0건이어도 남아 있고, 배지만 사라진다.
   */
  notifications?: readonly NotificationItem[];
  /**
   * 포털이 모아 준 **다른 시스템들의** 알림(개선요청 · 계측기 · PO/내자 · 휴가).
   *
   * 🔴 값이 아니라 **약속**이다. 서버가 `await` 하지 않고 그대로 내려보내므로 이
   * 머리말은 포털을 기다리지 않는다 — 푸는 일과 그 까닭은 종 안에 있다
   * (NotificationBell.tsx 의 usePortalNotificationInbox). 여기는 지나 보내기만
   * 한다. 없으면(데모 모드 · 포털 계정에 이어지지 않은 사람) 종은 자기 알림만
   * 그린다.
   */
  portalInbox?: Promise<unknown>;
  /**
   * 사내 시스템 오가기 목록(@dss/ui 의 ServiceMenuBar). AppShell이 만들어
   * 내려보내고, 이 머리말이 **제목과 알림종 사이**에 그린다.
   *
   * 조각이 아니라 **다 그려진 노드**를 받는 이유: 이 파일이 @dss/ui 도,
   * 목록을 어디서 구하는지도 몰라야 한다. 그리는 자리만 여기가 정한다
   * (아래 shrink-0 래퍼 — 그 한 겹이 이 머리말의 선을 지키는 장치다).
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
 * 회색 띠가 한 층을 더 차지해 답답하다는 지적). 그 조각은 머리말 안에서
 * **드롭다운 단추 하나**다(@dss/ui 의 variant="inline"). 펼쳐지는 목록은 단추
 * 아래로 **떠서**(position:absolute) 그려지므로 이 줄의 폭을 한 톨도 먹지
 * 않는다 — 그래서 이 머리말이 메뉴에 내주는 폭은 **서비스가 셋이든 열이든
 * 단추 하나**(폰에서 아이콘만 ~57px, 넓은 화면은 아이콘+이름)이고, 위의
 * 「오른쪽에 놓이는 것은 아이콘 버튼 하나」라는 선이 그대로 산다.
 *
 * 🔴 그 조각이 처음 이 줄로 들어왔을 때는 **칸을 가로로 늘어놓는** 모습이었고,
 * 그때는 폰에서 자리가 모자라 시스템 이름까지 눈에서 감춰야 했다(사용자 폰
 * 사진 — 아이콘만 남겨도 셋째 칸이 잘렸다). 같은 날 그 조각이 드롭다운이
 * 되면서(@dss/ui 730780c) 감출 이유가 사라져 **이름을 되돌렸다** — 폰 360px
 * 기준 폭 계산은 아래 이름 <span> 주석에 적어 두었다.
 *
 * 🔴 이 줄에서 **줄어들 수 있는 것은 시스템 이름 하나뿐이다**: 햄버거 · 메뉴
 * 단추 · 알림종이 모두 shrink-0 이라, 폭이 모자랄 때 눌리는 것은 언제나
 * 글자고 그 글자는 truncate 로 … 가 될 뿐이다. 아이콘 버튼이 잘려 손가락에
 * 안 잡히는 위 사고는 이 구조에서 다시 생길 수 없다.
 *
 * ════════════════════════════════════════════════════════════════════════
 * 🔴 2026-09-22 — 그 글자 묶음이 **이 줄로 다시 올라왔다**
 * ════════════════════════════════════════════════════════════════════════
 * 위 두 단락이 「글자 묶음은 SidebarFooter 에만 둔다 · 오른쪽에 놓이는 것은
 * 아이콘 버튼 하나뿐이다 · user prop 은 이제 필요 없다」고 적어 두었다.
 * **그 세 줄은 오늘부터 사실이 아니다.** 사용자 지시로 「통합 로그인으로」·
 * 「로그아웃」· 테마 · 사용자 이름이 다른 시스템들(PO 3600 · 계측기 3200)과
 * 같은 자리 — 머리말 오른쪽 끝 — 으로 올라왔고, 사이드바 아래는 비웠다.
 *
 * 🔴 그런데 **위 사고의 원인은 「묶음이 여기 있었다」가 아니라 「wrap/shrink
 * 장치가 없었다」다.** 그 묶음을 그냥 되돌리면 같은 버그가 되돌아온다. 그래서
 * 이번에는 폭을 다루는 장치를 **넷** 함께 넣었다(계측기 AppHeader.tsx 185~235
 * 줄이 같은 처방을 쓴다):
 *
 *  ㉠ 머리말 자신이 `flex-wrap` 이다. 폰에서 한 줄에 다 들어가지 않으면
 *     **줄을 바꾼다** — 이것이 가로로 넘치지 않는 근본 장치다. nowrap 이면
 *     들어가지 않는 만큼 화면 밖으로 밀리고, 밀려난 것을 손가락으로 누를 수
 *     없다(그것이 정확히 위 사고였다).
 *  ㉡ 오른쪽 묶음은 폰에서 `w-full`(≥640px 에서 `sm:w-auto`)이라 **제 줄을
 *     통째로 갖는다.** 첫 줄에는 햄버거 · 시스템 이름 · 메뉴 단추만 남아
 *     이름이 잘리지 않는다.
 *  ㉢ 「통합 로그인으로」는 폰에서 **「포털」** 로만 보인다(`md:hidden` /
 *     `sr-only md:not-sr-only`). 🔴 **글자를 지운 것이 아니다** — 링크는
 *     그대로고 긴 이름이 sr-only 로 남아 낭독기는 여전히 온전한 말을 읽는다.
 *     🔴 **「로그아웃」은 줄이지 않는다**: 누르면 모든 시스템에서 나가므로 그
 *     말만은 온전해야 한다(계측기도 같은 선을 긋는다).
 *  ㉣ 테마는 `<ThemeToggle compact />`(아이콘 셋 · ~104px)다. 글자 모양
 *     (밝게 · 어둡게 · 시스템 설정)은 ~190px 이라 폰 한 줄(328px)에서 다른
 *     것들과 같이 서지 못하고 묶음이 제 안에서 또 줄을 바꾼다 — 머리말이 폰
 *     에서 **세 줄**이 된다. 고른 것은 `aria-pressed` 와 배경색으로, 각 단추가
 *     무엇인지는 `title`/`aria-label` 로 그대로 남는다.
 *
 * 🔴 **실제로 재서 확인했다**(2026-09-22, 크롬 · 이 저장소의 글꼴 그대로).
 * 폰 360px 에서 나온 값(좌우 px-4 32 → 속폭 328):
 *
 *   첫 줄  햄버거 36 + 이름 128 + 메뉴 단추 · gap 포함 → 오른쪽 끝 192
 *   둘째 줄 테마 104 + 「포털」 40 + 「로그아웃」 62 + 종 36
 *           + gap 8×3 = 266 ≤ 328   (62px 남는다. 사용자 이름은 폰에서 감춰져
 *                                    이 셈에 들어오지 않는다)
 *   머리말 높이 97px(두 줄) · 가로 넘침 0 · 종의 오른쪽 여백 16px
 *
 * 390 · 430px 도 같은 모습이고 남는 자리만 늘어난다. 한 줄로 돌아가는 폭은
 * **약 900px** 이고(768~880 구간은 두 줄이다 — 넘치지 않고 줄만 바뀐다),
 * 900px 이상에서는 머리말 높이가 예전과 똑같은 56px 이다.
 *
 * 재는 방법: 이 머리말의 마크업과 이 사이트의 스타일시트를 그대로 넣은
 * 360 · 390 · 430px 폭 iframe 에서 `header.scrollWidth === header.clientWidth`
 * (가로로 넘치지 않는다)와 `document.elementFromPoint(햄버거 가운데)` 가
 * 햄버거를 돌려주는지(덮인 것이 없다)를 봤다. 🔴 실제 폰 폭으로 창을 줄여
 * 손가락으로 눌러 본 것은 아니다 — 크롬 창은 그만큼 좁아지지 않고, 이 앱은
 * X-Frame-Options: DENY 라 살아 있는 페이지를 그대로 iframe 에 넣을 수 없다.
 * 이 줄에 무엇을 더 넣기 전에 같은 방법으로 다시 재라.
 *
 * 🔴 종은 **묶음 안의 마지막 형제**다(래퍼를 하나 더 두는 것이 아니다 —
 * NotificationBell.tsx 의 그 주석은 「종만 감싸는 <div>」를 말한다). 종이 제
 * `ml-auto` 로 그 줄의 오른쪽 끝에 서야 펼침 패널(폭 min(20rem, 100vw-2rem),
 * 종에 오른쪽 끝을 맞춰 왼쪽으로 펼친다)의 왼쪽이 화면 밖으로 잘리지 않는다.
 */
export default function TopBar({ title, onMenuClick, user, notifications = [], portalInbox, portalUrl = null, serviceMenu = null }: TopBarProps) {
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
    //
    // 🔴 2026-09-22: 그 인셋이 8px 을 더한 calc 로 바뀌었다(아래 className).
    // 까닭은 `flex-wrap` 이다 — 폰에서 줄이 둘이 되면 내용 높이가 min-h-14 를
    // 넘어가고, 그때 위아래 패딩이 0 이면 첫 줄이 화면 맨 위에, 둘째 줄이
    // 테두리에 **딱 붙는다**. `py-2` 를 따로 걸면 같은 padding-top 을 두 클래스가
    // 다투게 되고(어느 쪽이 이기는지는 Tailwind 가 CSS 를 찍는 차례에 달렸다),
    // 지면 아이폰에서 노치 인셋이 조용히 사라진다. 그래서 **한 클래스 안에서**
    // 8px 과 인셋을 더한다 — 인셋이 0인 기기에서는 정확히 8px 이라, 한 줄로
    // 그려지는 모든 화면은 8+36+8=52 < 56 으로 min-h-14 가 그대로 이긴다
    // (= 2026-09-22 이전과 픽셀 단위로 같은 높이다).
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-200 bg-white px-4 pt-[calc(0.5rem+env(safe-area-inset-top))] pb-2 dark:border-zinc-800 dark:bg-zinc-900">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="메뉴 열기"
        // shrink-0 — 이 줄에서 눌려도 되는 것은 시스템 이름 글자 하나뿐이다
        // (위 파일 주석). 이것이 없으면 좁은 폭에서 flex 가 w-9 를 깎아
        // 햄버거가 손가락에 안 잡히는 크기가 된다.
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-700 hover:bg-zinc-100 md:hidden dark:text-zinc-300 dark:hover:bg-zinc-800"
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
        시스템 이름. **폰에서도 보인다.**

        한때 여기에 `sr-only md:not-sr-only` 가 걸려 폰(<768px)에서는 눈에서만
        감췄다. 이유는 오직 자리였다 — 그때 서비스 메뉴바는 머리말 안에서도
        칸을 **가로로 늘어놓아**, 이름을 감추고 아이콘만 보여도 칸 하나가
        ~38px 씩 셋이면 123px 이었다. 이름 글자가 가져가는 폭 때문에 셋째 칸이
        잘려 보였다(2026-09-18 사용자 폰 사진).

        🔴 그 이유가 사라졌다. 같은 날 메뉴바가 드롭다운으로 바뀌면서
        (@dss/ui 730780c) 이 줄이 메뉴에 내주는 폭이 **단추 하나**가 되었다.
        폰 360px 에서 다시 세면:

          좌우 px-4 32 + 햄버거 36 + 이름 ~133 + 메뉴 단추 ~57 + 알림종 36
          + 항목 사이 gap-3 12 × 3 = 36        →  합 ~330px  (30px 남는다)

        (이름 ~133px = Geist 14px/600 의 "DSS A/S " ≈ 49px + 한글 6자 × 14px.
         메뉴 단추 ~57px = 좌우 padding 12×2 + 이모지 14~17 + gap 6 + 펼침
         삼각형 8 + margin 2. 폰은 pointer:coarse 라 @dss/ui 가 단추에 큰
         값(min-height 40 · padding 12)을 쓴다. 「/ 화면이름」은 여전히
         `hidden md:inline` 이라 폰에서는 이 셈에 들어오지 않는다.)

        🔴 그래도 `truncate` 를 함께 건다. 위 계산은 글꼴 폴백에 기대고 있고
        (한글은 Geist 에 없어 기기 글꼴로 떨어진다 — 기기마다 몇 px 씩 다르다),
        320px 짜리 화면도 아주 없지는 않다. 이 줄에서 shrink 가 허용된 항목은
        이것 하나뿐이라(햄버거·메뉴 단추·알림종은 전부 shrink-0), 폭이 모자라면
        **이름이 … 로 줄 뿐** 아이콘 버튼이 화면 밖으로 밀려나지 않는다.

        🔴 `hidden`(display:none)을 쓰지 않는 이유는 그대로다: 마크업에서
        지우면 화면 낭독기에서도 시스템 이름이 사라진다. 이제는 눈에서도
        감추지 않으므로 sr-only 조차 필요 없다.
      */}
      <span className="min-w-0 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
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

        🔴 `shrink-0` 한 낱말이다. 여기 한때 `min-w-0 flex-1` 이 있었는데 그것은
        **「가로로 늘어선 목록에 남는 자리를 다 준다」**는 장치였다: 기준 폭 0 +
        남는 자리 다 갖기 + 제 내용 폭까지 부풀지 않기. 그 조각이 드롭다운 단추
        하나가 된 지금(@dss/ui 730780c) 이 줄에서 자리를 다툴 목록이 없다 —
        남는 자리를 다 받아 봐야 단추가 그 칸 왼쪽에 붙을 뿐이고, 읽는 사람에게는
        「여기 늘어나는 무언가가 있다」는 틀린 신호만 남는다.

        `shrink-0` 은 그 반대를 말한다: 이 칸은 **단추 하나 폭**이고 어떤
        폭에서도 눌리지 않는다. 폭이 모자랄 때 줄어드는 것은 위 시스템 이름
        하나다. 남는 자리는 알림종의 ml-auto 가 먹으므로 종은 예전 그대로
        오른쪽 끝이다 — 넓은 화면의 배치는 달라지지 않는다.

        🔴 펼친 목록은 이 칸 **밖으로** 나온다: 단추 아래에 떠서 그려지고
        (position:absolute · z-index 50) 본문을 덮는다. 그래서 이 <header> 나 그
        조상에 `overflow: hidden` 이 있으면 목록이 잘려 아무것도 고를 수 없게
        된다 — 지금은 없다. AppShell 의 overflow-hidden 은 이 머리말의
        **형제**인 본문 줄에 걸려 있고, 바로 옆 알림종의 펼침 패널이 같은
        방식(absolute + z-index)으로 이미 잘 뜨고 있는 것이 그 증거다.
        이 줄에 overflow 나 transform 을 새로 걸 일이 있거든 그것부터 확인하라.

        목록이 없을 때(포털 배포 전·데모 모드) 이 조각은 스스로 null 이라
        빈 <div> 만 남는다 — 폭 0 이라 화면은 예전과 같다.
      */}
      <div className="shrink-0">{serviceMenu}</div>
      {/*
        🔴 오른쪽 묶음 — 사용자 · 테마 · 통합 로그인으로 · 로그아웃 · 알림종.
        2026-09-22 에 사이드바 맨 아래에서 이 자리로 올라왔다(다른 시스템들과
        같은 자리). 무엇이 폭을 지키는지는 위 파일 주석의 ㉠~㉣ 에 적었다.

        `ml-auto` 가 이 묶음을 줄의 오른쪽 끝으로 보낸다. 폰에서는 `w-full`
        이라 제 줄을 통째로 갖고(그때 ml-auto 는 남는 자리가 없어 아무 일도
        하지 않는다), ≥640px 에서 `sm:w-auto` 로 돌아가 오른쪽 끝에 붙는다.

        묶음 안쪽에도 `flex-wrap` 을 둔다 — 안전망이다. 위 셈(276 ≤ 328)은
        글꼴 폴백에 기대고 있어서(한글은 Geist 에 없어 기기 글꼴로 떨어진다)
        기기에 따라 몇 px 씩 다르고, 320px 짜리 화면도 아주 없지는 않다.
        모자라면 이 묶음이 제 안에서 줄을 바꿀 뿐 **가로로 넘치지 않는다.**
        `sm:justify-end` 는 그렇게 줄이 바뀌었을 때 둘째 줄도 오른쪽에
        붙이기 위한 것이고, 폰에서는 켜지 않는다 — 첫 줄(햄버거·이름)이
        왼쪽에서 시작하므로 이 줄도 왼쪽에서 시작해야 세로선이 맞는다
        (계측기에서 사용자가 폰 사진으로 지적한 그 자리).
      */}
      <div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
        {/*
          누구로 로그인했는지. 폰에서는 감춘다 — 이 줄에서 가장 덜 급한
          글자이고(다른 넷은 누르는 것이다), ~115px 을 되찾아 나머지가 한 줄에
          선다. `hidden`(display:none)이라 낭독기에서도 사라지지만, 같은 말이
          아래 단추들의 title 과 사이드바 메뉴의 내 정보 화면에 남는다.
          🔴 md(768px) 기준인 이유: 같은 폭에서 「통합 로그인으로」의 긴 이름도
          함께 켜진다 — 글자가 늘어나는 지점을 하나로 모아 두면 폭 계산이
          두 구간(폰 · 넓은 화면)으로 끝난다.
        */}
        <span
          title={`${user.name}님 · ${user.roleLabel}`}
          className="hidden max-w-[12rem] truncate text-xs text-zinc-600 md:inline dark:text-zinc-400"
        >
          {user.name}님 · {user.roleLabel}
        </span>
        {/*
          테마. 아이콘 셋(밝게 · 어둡게 · 시스템 설정)이고, 고른 것은
          `aria-pressed` 와 배경색으로 알린다 — 글자 모양은 ~190px 이라 폰
          한 줄에서 다른 것들과 같이 서지 못한다(위 파일 주석 ㉣).
        */}
        <ThemeToggle compact />
        {portalUrl && (
          <a
            href={portalUrl}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs whitespace-nowrap text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {/*
              폰에서는 「포털」만. 「통합 로그인으로」는 ~106px 이라 그대로 두면
              이 줄이 한 줄에 들어가지 않는다. 🔴 **없애는 것이 아니다**:
              링크는 그대로 있고 눌러서 갈 수 있으며, 긴 이름이 sr-only 로
              남아 낭독기는 여전히 「통합 로그인으로」를 읽는다(계측기
              AppHeader.tsx 의 같은 처방).
            */}
            <span className="md:hidden" aria-hidden="true">
              포털
            </span>
            <span className="sr-only md:not-sr-only">통합 로그인으로</span>
          </a>
        )}
        {/*
          🔴 로그아웃은 **<form> 의 POST** 다. 링크로 바꾸지 마라 — 까닭은
          @dss/ui 의 ServiceMenuBar.tsx:36 머리말과 이 저장소의
          api/auth/logout/route.ts 에 적혀 있다(GET 으로 열 수 있는 로그아웃은
          남의 페이지에 심은 <img> 로도 눌린다).

          🔴 그리고 이 말은 **짧게 줄이지 않는다.** 누르면 통합 로그인까지
          포함해 모든 시스템에서 나가므로 그 말만은 온전해야 한다.
        */}
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs whitespace-nowrap text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            로그아웃
          </button>
        </form>
        {/*
          🔴 종은 이 묶음의 **마지막 형제**다 — 종만 감싸는 래퍼를 두지
          않는다(그러면 펼침 패널의 기준이 두 겹이 된다. NotificationBell.tsx
          의 그 주석). `ml-auto shrink-0` 은 종 자신이 갖고 있어서, 폰에서
          `w-full` 인 이 줄의 오른쪽 끝에 종이 선다 — 패널이 종에 오른쪽 끝을
          맞춰 왼쪽으로 펼쳐지므로(폭 min(20rem, 100vw-2rem)) 종이 줄 가운데에
          앉으면 패널 왼쪽이 화면 밖으로 잘린다.
        */}
        <NotificationBell items={notifications} acknowledge={acknowledgeNotificationAction} portalInbox={portalInbox} />
      </div>
    </header>
  );
}
