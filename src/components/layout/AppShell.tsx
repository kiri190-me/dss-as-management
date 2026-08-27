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
  accessibleAreaKeys: readonly string[] | null;
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

export default function AppShell({ children, user, accessibleAreaKeys, myPendingApprovalCount = 0, notifications = [], portalUrl = null }: AppShellProps) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Whole-sidebar narrow/icon-only mode — owned here (not inside Sidebar)
  // because the <aside>'s own width class must react to it too. Toggling
  // this never touches router state, so it can never change the current
  // route; it's also entirely separate from Sidebar's own per-group
  // collapsedGroupKeys state (see Sidebar.tsx's doc comment).
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

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
        <aside
          className={`hidden min-h-0 border-r border-zinc-200 transition-[width] duration-150 md:flex md:flex-col print:hidden dark:border-zinc-800 ${isSidebarCollapsed ? "md:w-14" : "md:w-52"}`}
        >
          <Sidebar activeHref={pathname} role={user.role} user={user} accessibleAreaKeys={accessibleAreaKeys} isCollapsed={isSidebarCollapsed} onToggleCollapsed={() => setIsSidebarCollapsed((prev) => !prev)} myPendingApprovalCount={myPendingApprovalCount} portalUrl={portalUrl} />
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
              <Sidebar
                activeHref={pathname}
                role={user.role}
                user={user}
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
