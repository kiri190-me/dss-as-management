"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { RepairCaseDetailTabVisibility } from "@/lib/auth/repair-case-detail-tab-permissions";
import { resolveActiveTabHref } from "@/lib/domain/repair-case-detail-tabs";
import { buildRepairCaseDetailTabs } from "./detail-tabs-list";

type DetailTabsProps = {
  id: string;
  /**
   * 어느 탭을 그릴까. **판정은 여기서 하지 않는다** — 이 조각은 클라이언트
   * 컴포넌트라 권한을 물어볼 수 없고, 물어볼 수 있더라도 화면이 내린 판정은
   * 관문이 아니다. 상위 레이아웃(서버)이 탭마다 정해진 열쇠를 보고 넘겨준다
   * (`auth/repair-case-detail-tab-access.ts` · 열쇠 표는 그 옆 파일에 있다).
   *
   * 🔴 **감추는 것은 막은 것이 아니다.** 주소를 직접 치면 그대로 들어와지므로
   * 탭마다 제 page.tsx 가 **같은 열쇠로** 한 번 더 확인한다. 여기서 감추는
   * 까닭은 눌러도 "권한이 없습니다"만 나오는 탭을 내밀지 않기 위해서다.
   *
   * 기본값을 두지 않는다 — 넘기는 것을 잊으면 tsc 가 잡는다. 기본 false 로
   * 두면 조용히 안 보이고, 기본 true 로 두면 조용히 새어 나간다. 참/거짓 여덟을
   * 각각 받지 않고 꾸러미 하나로 받는 것도 같은 판단이다: 탭이 늘 때 넘기는 쪽이
   * 한 칸을 빠뜨리면 그 역시 tsc 가 잡는다.
   *
   * 🔴 [기본 정보]는 이 꾸러미에 **없다** — 가리지 않기로 한 탭이다(2026-11-12).
   */
  visibility: RepairCaseDetailTabVisibility;
};

export default function DetailTabs({ id, visibility }: DetailTabsProps) {
  const pathname = usePathname();

  const tabs = buildRepairCaseDetailTabs(id, visibility);
  const activeHref = resolveActiveTabHref(pathname, tabs.map((t) => t.href));

  return (
    <nav
      aria-label="A/S 상세 탐색"
      className="flex gap-1 overflow-x-auto border-b border-zinc-200 print:hidden dark:border-zinc-800"
    >
      {tabs.map((tab) => {
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
