"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { navItems } from "@/lib/navigation";
import type { Role } from "@/lib/domain/types";
import type { NotificationItem } from "@/lib/domain/notifications";
import TopBar from "./TopBar";
import Sidebar from "./Sidebar";

type AppShellProps = {
  children: React.ReactNode;
  // Required, not optional: (app)/layout.tsx — AppShell's only caller —
  // resolves and validates the acting user before ever rendering this
  // component, redirecting to /login otherwise. A shell without a known
  // user must never render, so the logout control can never be silently
  // hidden. `role` drives Sidebar's nav-item visibility filter only — a
  // UX convenience, never the enforcement boundary (every gated page
  // re-checks the same predicate server-side regardless of what this
  // shell renders).
  user: { name: string; roleLabel: string; role: Role };
  /** 통합 로그인(dss-auth) 앱 목록 주소. 데모 모드에서는 null이라 링크를 그리지 않는다. */
  portalUrl?: string | null;
  /**
   * 관리자가 설정한 접근 가능 영역(layout.tsx가 서버에서 풀어 넘긴다).
   * 사이드바에서 무엇을 감출지에만 쓴다 — 실제 차단은 각 페이지의
   * requireAreaAccess가 서버에서 한다.
   */
  /**
   * 관리자가 설정한 접근 가능 영역. **null 을 허용하지 않는다** — 메뉴 노출을
   * 정하는 유일한 값이라, 빠지면 전 메뉴가 열린다(Sidebar 주석 참조).
   */
  accessibleAreaKeys: readonly string[];
  /**
   * 개발자 모드 메뉴를 그릴지(layout.tsx가 서버에서 mayEnterDeveloperMode 로
   * 계산해 넘긴다). 위 accessibleAreaKeys 와 **다른 축이다** — 그 항목은
   * 역할별 접근 권한 설정에 존재하지 않으므로 저 목록에 담길 수 없다
   * (auth/developer-mode-gate.ts).
   *
   * **null 도 선택 인자도 허용하지 않는다.** 아래 두 Sidebar(데스크톱 <aside>,
   * 모바일 드로어)에 똑같이 넘겨야 하고, 한쪽을 빠뜨리면 폰에서만 관문이
   * 사라진다 — accessibleAreaKeys 가 정확히 그렇게 새던 자리다.
   */
  canEnterDeveloperMode: boolean;
  /**
   * 로그인한 사용자가 결재해야 할 A/S 건수(layout.tsx가 서버에서 계산해
   * 넘긴다). 사이드바 배지를 그릴지에만 쓴다 — 실제 결재 권한은 승인
   * 화면/서버 액션이 각자 다시 확인한다. 0이면 배지가 없다.
   */
  myPendingApprovalCount?: number;
  /**
   * 헤더 종 알림에 그릴 건별 목록(layout.tsx가 서버에서 계산해 넘긴다).
   * 위 배지 숫자와 **같은 한 번의 조회**에서 나온다 — 화면마다 같은 조회를 두
   * 번 돌리지 않기 위한 것이다(db/queries/notifications.ts 주석 참조).
   */
  notifications?: readonly NotificationItem[];
};

/**
 * 이 초점이 **키보드로 옮겨온 것**인지. 마우스로 눌러서 생긴 초점까지
 * 사이드바 펼침으로 치면, 메뉴 링크나 그룹 머리글을 클릭한 뒤 마우스를
 * 치워도 눌린 요소가 초점을 계속 쥐고 있어서 사이드바가 넓어진 채 그대로
 * 남는다. :focus-visible 은 브라우저가 이미 그 구분을 하고 있는 것을
 * 그대로 빌려 쓰는 것이다.
 *
 * 이 선택자를 모르는 엔진에서는 던지므로 false 로 떨어뜨린다 — 그래도
 * 키보드 접근은 남는다(<aside> 자신이 받는 초점은 이 판단을 거치지 않는다.
 * 호출부 주석 참조).
 */
function isKeyboardFocus(element: HTMLElement): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return false;
  }
}

export default function AppShell({ children, user, accessibleAreaKeys, canEnterDeveloperMode, myPendingApprovalCount = 0, notifications = [], portalUrl = null }: AppShellProps) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Whole-sidebar open/narrow mode — owned here (not inside Sidebar)
  // because the <aside>'s own width class must react to it too. Toggling
  // this never touches router state, so it can never change the current
  // route; it's also entirely separate from Sidebar's own per-group open
  // state (see Sidebar.tsx's doc comment).
  //
  // 예전에는 이것이 `isSidebarCollapsed`(기본값 false = 펼침) 하나였다. 이제
  // 기본값이 "접힘"으로 뒤집히면서 `collapsed`라는 이름은 읽는 사람을
  // 헷갈리게 하므로, **"펼침"을 참으로 읽는 이름**으로 바꾸고 서로 독립인
  // 두 가지로 갈랐다:
  //
  //  - isSidebarPinnedOpen — ☰ 로 켜 두는 사용자의 **명시적 선택**.
  //    기본값 false 라서 첫 화면은 접혀 있다.
  //  - isSidebarHovered / isSidebarFocused — 마우스가 올라와 있거나 초점이
  //    사이드바 안에 있는 동안만 참인 **머무름**. 개념은 하나("머무름
  //    펼침")지만 상태를 둘로 나눈 이유는, 하나로 합치면 마우스를 뗄 때
  //    (mouseleave) 키보드 초점으로 열어 둔 것까지 같이 닫히기 때문이다.
  //
  // 셋 중 하나라도 참이면(isSidebarOpen) 메뉴를 그리고 **자리 폭도 함께
  // 늘어난다** — 고정이든 머무름이든 본문이 그만큼 자연스럽게 줄어든다.
  // 한때 머무름으로 열린 판만 본문 위에 띄워 덮은 적이 있으나(출렁임을
  // 막으려던 것), 사용자가 실제 화면을 보고 **본문을 미는 쪽**을 골랐다.
  // 셋의 차이는 이제 "마우스를 떼면 되돌아가는가" 하나뿐이다.
  const [isSidebarPinnedOpen, setIsSidebarPinnedOpen] = useState(false);
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const [isSidebarFocused, setIsSidebarFocused] = useState(false);
  const isSidebarOpen = isSidebarPinnedOpen || isSidebarHovered || isSidebarFocused;

  const activeItem = navItems.find((item) => item.href === pathname);
  const title = activeItem?.label ?? "";

  return (
    // min-h-0 lets this root shrink to body's now-capped h-full height
    // instead of growing to fit its own content (the classic flex "min-
    // height:auto" gotcha) — the first link in the height chain that makes
    // <main>'s and the sidebar's own overflow-y-auto actually scroll
    // internally rather than inflating the whole page.
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="print:hidden">
        <TopBar title={title} onMenuClick={() => setMobileNavOpen(true)} notifications={notifications} />
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden print:overflow-visible">
        {/*
          자리를 차지하는 폭은 **펼쳐지면 늘 늘어난다**(isSidebarOpen) — ☰ 로
          고정했든 마우스를 올려 둔 동안이든 똑같이 md:w-52 가 되고, <main> 은
          그만큼 줄어든다. transition-[width] 가 걸려 있어 부드럽게 줄어들며,
          본문이 밀리는 것은 사용자가 화면을 보고 고른 **의도된 동작**이다.

          tabIndex={0} 은 **키보드로 메뉴에 닿기 위한 것**이다. 접힌 동안
          사이드바 안의 첫 초점 대상은 하단 유틸(테마/로그아웃/☰)이라,
          거기서 초점을 받아 펼쳐 봐야 새로 그려진 메뉴 링크들은 이미
          지나온 자리(DOM 상 앞)에 생긴다 — 앞으로 Tab 만 눌러서는 영영
          닿지 못한다. <aside> 자신을 초점 대상으로 만들면 순서가
          헤더 → <aside>(여기서 펼쳐짐) → 첫 메뉴 링크 → … 가 되어 앞으로
          Tab 만으로 메뉴에 닿는다. 접힌 동안 링크를 sr-only 로 DOM 에
          남겨 두는 방식은 쓰지 않았다(보이지 않는 링크로 초점이 빨려
          들어간다) — Sidebar 는 지금처럼 접혔을 때 아예 그리지 않는다.

          onBlur 는 relatedTarget 이 사이드바 밖일 때만 닫는다. 그러지 않으면
          <aside> → 첫 링크로 초점이 옮겨가는 순간 스스로 접혀 버린다.
        */}
        <aside
          tabIndex={0}
          aria-label="사이드바 메뉴"
          onMouseEnter={() => setIsSidebarHovered(true)}
          onMouseLeave={() => setIsSidebarHovered(false)}
          onFocus={(event) => {
            // <aside> 자신이 받은 초점은 무조건 편다 — Tab 으로 들어온 것이
            // 사실상 유일한 경로이고(빈 띠를 마우스로 직접 눌러도 펼쳐질
            // 뿐 해롭지 않다), 이 한 줄만으로 "Tab 으로 사이드바에 닿으면
            // 메뉴가 보인다"가 보장된다. 안쪽 컨트롤(하단 유틸 등)에 곧장
            // 초점이 오는 경우(본문에서 Shift+Tab)는 키보드 초점일 때만
            // 편다 — 마우스 클릭 초점까지 세면 판이 계속 남아 가린다.
            if (event.target === event.currentTarget || isKeyboardFocus(event.target)) {
              setIsSidebarFocused(true);
            }
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setIsSidebarFocused(false);
          }}
          className={`hidden min-h-0 border-r border-zinc-200 transition-[width] duration-150 motion-reduce:transition-none md:flex md:flex-col print:hidden dark:border-zinc-800 ${isSidebarOpen ? "md:w-52" : "md:w-14"}`}
        >
          <Sidebar
            activeHref={pathname}
            user={user}
            accessibleAreaKeys={accessibleAreaKeys}
            // 🔴 아래 모바일 드로어에도 **같은 값**을 넘긴다. 두 곳이 갈리면
            // 폰과 컴퓨터가 서로 다른 메뉴를 그린다(같은 파일 안의 두 호출부라
            // 여기서 갈리는 것을 막을 수 있는 것은 사람 눈뿐이다 —
            // developer-mode-gate 시험이 이 파일을 읽어 대조한다).
            canEnterDeveloperMode={canEnterDeveloperMode}
            // 메뉴와 하단 유틸의 **모양**은 둘 다 "지금 보이는가"를 따른다
            // — 머무름으로 펼쳐진 동안에도 하단이 넓은 모양이다.
            isCollapsed={!isSidebarOpen}
            // ☰ 의 말·aria-expanded 만 "고정인가"를 따른다. ☰ 는 마우스를
            // 사이드바로 가져가야 눌리므로 누를 때는 이미 머무름으로
            // 펼쳐져 있다 — 여기에 "보이는가"를 넘기면 단추가 늘
            // "사이드바 접기"라고 적힌 채 반대로 동작한다
            // (SidebarFooter.tsx 파일 주석 참조).
            isPinnedOpen={isSidebarPinnedOpen}
            onToggleCollapsed={() => setIsSidebarPinnedOpen((prev) => !prev)}
            myPendingApprovalCount={myPendingApprovalCount}
            portalUrl={portalUrl}
          />
        </aside>

        {mobileNavOpen && (
          <div className="fixed inset-0 z-40 flex md:hidden print:hidden">
            <button
              type="button"
              aria-label="메뉴 닫기"
              onClick={() => setMobileNavOpen(false)}
              className="absolute inset-0 bg-black/40"
            />
            {/*
              모바일 드로어는 화면 높이를 꽉 채우고 그 맨 아래에
              SidebarFooter(사용자 정보·테마·로그아웃)가 붙는다. 인셋 패딩이
              없으면 로그아웃 버튼이 홈 인디케이터/제스처 바에 겹쳐 눌리지
              않는다. 인셋이 없는 기기에서는 0이므로 기존과 동일하다.
            */}
            <aside className="relative z-50 flex min-h-0 w-64 flex-col border-r border-zinc-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-zinc-800 dark:bg-zinc-900">
              {/* 🔴 accessibleAreaKeys 를 여기에도 넘긴다. 빠뜨렸던 동안 모바일
                  드로어만 **역할별 접근 권한 설정을 통째로 무시**했다 —
                  관리자가 좁혀도 폰에서는 메뉴가 그대로 보였다(2026-08-31). */}
              {/* 🔴 canEnterDeveloperMode 도 데스크톱과 **같은 값**으로 여기에
                  넘긴다. 빠뜨리면 컴파일이 실패한다(필수 prop) — 위
                  accessibleAreaKeys 가 조용히 빠져 있었던 경험 때문에 그렇게
                  두었다. */}
              <Sidebar
                activeHref={pathname}
                user={user}
                accessibleAreaKeys={accessibleAreaKeys}
                canEnterDeveloperMode={canEnterDeveloperMode}
                onNavigate={() => setMobileNavOpen(false)}
                myPendingApprovalCount={myPendingApprovalCount}
                portalUrl={portalUrl}
              />
            </aside>
          </div>
        )}

        {/*
          하단 여백 — 모바일에서만 크게 준다. `p-6`의 24px는 데스크톱에서는
          충분하지만 폰에서는 마지막 행/버튼이 브라우저 하단 툴바와 홈
          인디케이터에 바로 맞닿아, 스크롤을 끝까지 내려도 손가락이 닿는
          자리에 여유가 전혀 없었다. 6rem은 툴바가 펼쳐진 상태에서도 마지막
          요소가 화면 중앙부에 남게 하는 값이고, 거기에 더한
          env(safe-area-inset-bottom)은 제스처 바가 있는 기기에서 그만큼 더
          띄운다(인셋이 없는 기기에서는 0이라 6rem 그대로).

          md 이상에서는 `md:pb-6`으로 기존 `p-6`과 완전히 동일하게 되돌린다 —
          데스크톱 레이아웃은 이 변경 전후가 픽셀 단위로 같다. `print:pb-0`은
          기존 `print:p-0`이 인쇄 시 패딩을 없애던 동작을 유지하기 위한
          것으로, 없으면 이 하단 패딩이 인쇄물 마지막 장에 빈 공간으로 남는다.
        */}
        <main className="min-h-0 flex-1 overflow-y-auto p-6 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-6 print:overflow-visible print:p-0 print:pb-0">{children}</main>
      </div>
    </div>
  );
}
