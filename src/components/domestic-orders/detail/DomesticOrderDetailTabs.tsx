"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { DomesticOrderDetailTabVisibility } from "@/lib/auth/domestic-order-detail-tab-permissions";
import { resolveActiveTabHref } from "@/lib/domain/domestic-order-detail-tabs";
import { buildDomesticOrderDetailTabs } from "./domestic-order-detail-tabs-list";

/**
 * 「기타건 상세」의 탭 줄 — 기본정보 · 견적서 · 발주서 · 승인 (2026-11-06).
 *
 * 수리 건 상세의 탭 줄(components/repair-cases/detail/DetailTabs.tsx)과 **같은
 * 모양**이다. 생김새도 활성 판정도 그쪽에서 가져왔고, 활성 판정은 베끼지 않고
 * 그 함수를 그대로 부른다(resolveActiveTabHref — 「가장 긴 앞가지가 이긴다」.
 * 단순 `startsWith` 면 루트 탭이 모든 주소에서 켜진다).
 *
 * 🔴 **기본정보가 첫 탭**이다(사용자 결정 — 「기본정보를 첫화면으로 해줘」).
 */
type DomesticOrderDetailTabsProps = {
  id: string;
  /**
   * 어느 탭을 그릴까. **판정은 여기서 하지 않는다** — 이 조각은 클라이언트
   * 컴포넌트라 권한을 물어볼 수 없고, 물어볼 수 있더라도 화면이 내린 판정은
   * 관문이 아니다. 상위 레이아웃(서버)이 탭마다 정해진 열쇠를 보고 넘겨준다
   * (`auth/domestic-order-detail-tab-access.ts` · 열쇠 표는 그 옆 파일에 있다).
   *
   * 🔴 **감추는 것은 막은 것이 아니다.** 주소를 직접 치면 그대로 들어와지므로
   * 탭마다 제 page.tsx 가 **같은 열쇠로** 한 번 더 확인한다. 여기서 감추는
   * 까닭은 눌러도 "권한이 없습니다"만 나오는 탭을 내밀지 않기 위해서다.
   *
   * 기본값을 두지 않는다 — 넘기는 것을 잊으면 tsc 가 잡는다. 기본 false 로
   * 두면 조용히 안 보이고, 기본 true 로 두면 조용히 새어 나간다. 참/거짓 셋을
   * 각각 받지 않고 꾸러미 하나로 받는 것도 같은 판단이다: 탭이 늘 때 넘기는 쪽이
   * 한 칸을 빠뜨리면 그 역시 tsc 가 잡는다.
   *
   * 🔴 2026-11-12(둘째)에 `canViewQuotes: boolean` 하나에서 이 꾸러미로 바뀌었다.
   * 그전에는 [발주서]·[승인]에 **짝이 없었다** — 그 둘을 가릴 수 있는 열쇠가 이
   * 화면의 입장권(`domesticOrders`)뿐이었고, 같은 열쇠를 한 번 더 물어 봐야
   * 언제나 참이라 「가르고 있다」는 착각만 남았기 때문이다. 그날 그 메뉴가 잎
   * 넷으로 쪼개지면서 **입장권보다 좁은 열쇠**가 생겼고, 그래서 셋을 함께 받는다.
   *
   * 🔴 [기본정보]는 이 꾸러미에 **없다** — 가리지 않기로 한 탭이다(2026-11-12).
   */
  visibility: DomesticOrderDetailTabVisibility;
};

export default function DomesticOrderDetailTabs({ id, visibility }: DomesticOrderDetailTabsProps) {
  const pathname = usePathname();

  const tabs = buildDomesticOrderDetailTabs(id, visibility);
  const activeHref = resolveActiveTabHref(pathname, tabs.map((t) => t.href));

  return (
    <nav
      aria-label="기타건 상세 탐색"
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
