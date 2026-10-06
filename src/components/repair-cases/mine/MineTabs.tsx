"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { resolveActiveTabHref } from "@/lib/domain/repair-case-detail-tabs";

/**
 * 「내 담당 제품」 메뉴 안의 두 화면을 가르는 탭.
 *
 * 🔴 **주소로 가르는 탭이다**(클라이언트 상태가 아니다) — 두 화면이 서버에서
 * 서로 다른 것을 조회하기 때문이다. 상태로 가르면 들어올 때 양쪽을 다 조회하게
 * 되고, 새로고침하면 보던 쪽이 아니라 늘 첫 번째 탭으로 돌아간다.
 *
 * 생김새·접근성 처리는 수리 건 상세의 DetailTabs 를 그대로 따랐다(같은 클래스,
 * 같은 aria-current, 같은 overflow-x-auto). 그 컴포넌트를 그대로 쓰지 않은 것은
 * 그쪽이 수리 건 id 와 견적서 권한을 받는 전용 조각이라, 여기서 쓰려면 그 인자를
 * 가짜로 만들어 넘겨야 하기 때문이다. 공유하는 것은 **지금 어느 탭인가**를 푸는
 * 순수 함수(resolveActiveTabHref) 하나다 — `/repair-cases/mine` 이
 * `/repair-cases/mine/work-records` 의 접두사라, 단순 startsWith 로는 두 탭이
 * 동시에 켜진다. 그 함정을 이미 푼 함수가 저기 있다.
 */

/** 두 화면의 주소. 한 곳에서만 짓는다 — 탭과 라우트 폴더가 어긋나면 조용히 404 가 된다. */
export const MY_WORK_TAB_HREFS = {
  activeWork: "/repair-cases/mine",
  workRecords: "/repair-cases/mine/work-records",
} as const;

const TABS = [
  { label: "진행 중인 담당 건", href: MY_WORK_TAB_HREFS.activeWork },
  { label: "내 작업기록", href: MY_WORK_TAB_HREFS.workRecords },
];

export default function MineTabs() {
  const pathname = usePathname();
  const activeHref = resolveActiveTabHref(pathname ?? "", TABS.map((t) => t.href));

  return (
    <nav
      aria-label="내 담당 제품 탐색"
      className="flex gap-1 overflow-x-auto border-b border-zinc-200 print:hidden dark:border-zinc-800"
    >
      {TABS.map((tab) => {
        const isActive = tab.href === activeHref;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={
              isActive
                ? "whitespace-nowrap border-b-2 border-zinc-900 px-3 py-2 text-sm font-medium text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
                : "whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
