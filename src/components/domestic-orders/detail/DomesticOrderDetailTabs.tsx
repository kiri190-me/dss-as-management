"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  domesticOrderDetailHrefs,
  resolveActiveTabHref,
} from "@/lib/domain/domestic-order-detail-tabs";

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
   * 「견적서」 탭을 그릴까. **판정은 여기서 하지 않는다** — 이 조각은 클라이언트
   * 컴포넌트라 권한을 물어볼 수 없고, 물어볼 수 있더라도 화면이 내린 판정은
   * 관문이 아니다. 상위 레이아웃(서버)이 `quotes` 영역의 READ 를 보고 넘겨준다 —
   * 수리 건 상세가 같은 탭을 같은 열쇠로 가르는 것 그대로다.
   *
   * 🔴 **감추는 것은 막은 것이 아니다.** 주소를 직접 치면 그대로 들어와지므로
   * `/domestic-orders/{id}/quotes` 페이지가 스스로 다시 확인한다. 여기서 감추는
   * 까닭은 눌러도 "권한이 없습니다"만 나오는 탭을 내밀지 않기 위해서다.
   *
   * 기본값을 두지 않는다 — 넘기는 것을 잊으면 tsc 가 잡는다. 기본 false 로
   * 두면 조용히 안 보이고, 기본 true 로 두면 조용히 새어 나간다.
   *
   * 🔵 **발주서 · 승인에는 짝이 없다.** 수리 건 쪽에서 발주서 탭을 가르던 열쇠는
   * `domesticOrders` 였는데, 이 화면은 그 열쇠가 **이미 입장권**이다(레이아웃이
   * requireAreaAccessForCurrentUser("domesticOrders") 로 막는다). 같은 열쇠를 한
   * 번 더 물어 언제나 참인 값을 프롭으로 나르면 「가르고 있다」는 착각만 남는다.
   * 막는 일은 각 페이지가 제자리에서 한다.
   */
  canViewQuotes: boolean;
};

export default function DomesticOrderDetailTabs({ id, canViewQuotes }: DomesticOrderDetailTabsProps) {
  const pathname = usePathname();

  // 주소는 도메인 헬퍼가 만들고, 라벨과 순서만 여기(화면)에서 정한다.
  const hrefs = domesticOrderDetailHrefs(id);
  const tabs = [
    { label: "기본정보", href: hrefs.root },
    ...(canViewQuotes ? [{ label: "견적서", href: hrefs.quotes }] : []),
    { label: "발주서", href: hrefs.purchaseOrders },
    { label: "승인", href: hrefs.approval },
  ];

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
