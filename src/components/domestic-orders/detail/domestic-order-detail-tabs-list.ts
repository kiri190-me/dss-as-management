import type { DomesticOrderDetailTabVisibility } from "@/lib/auth/domestic-order-detail-tab-permissions";
import { domesticOrderDetailHrefs } from "@/lib/domain/domestic-order-detail-tabs";

/**
 * ============================================================================
 * 탭 줄이 무엇을 어떤 차례로 그리는가 — 순수 함수 (2026-11-12, 같은 날 둘째)
 * ============================================================================
 * DomesticOrderDetailTabs.tsx 에서 떼어 냈다. 그 조각은 `"use client"` 이고
 * `usePathname()` 을 부르는데, 그 훅은 Next 앱 라우터가 올라간 뒤에만 돌아서 이
 * 저장소의 node:test 환경에서는 그려 볼 수 없다. 그래서 **그릴 목록을 만드는
 * 부분만** 값으로 확인할 수 있게 빼 둔다 — 「닫으면 그 탭만 빠지고 차례는 그대로인가」
 * 는 글자로 읽을 일이 아니라 값으로 재야 하는 것이다.
 * (수리 건 상세의 `detail-tabs-list.ts` 와 같은 까닭·같은 모양이다.)
 *
 * 🔴 **판정은 여기서 하지 않는다.** 이 함수는 이미 정해진 참/거짓을 받아 늘어놓을
 * 뿐이고, 누가 무엇을 볼 수 있는지는 서버(레이아웃)가 정한다
 * (`auth/domestic-order-detail-tab-access.ts`). 화면이 내린 판정은 관문이 아니다.
 *
 * 🔴 **차례를 바꾸지 마라.** 기본정보 · 견적서 · 발주서 · 승인 — 2026-11-06 에
 * 사용자가 지정한 차례다(「기본정보를 첫화면으로 해줘」). 가려진 탭만 빠지고
 * 나머지는 자리를 그대로 지킨다.
 * ============================================================================
 */

export type DomesticOrderDetailTab = {
  label: string;
  href: string;
};

export function buildDomesticOrderDetailTabs(
  domesticOrderId: string,
  visibility: DomesticOrderDetailTabVisibility
): DomesticOrderDetailTab[] {
  // 주소는 도메인 헬퍼가 만들고, 라벨과 순서만 여기(화면)에서 정한다.
  const hrefs = domesticOrderDetailHrefs(domesticOrderId);
  return [
    /**
     * 🔴 **[기본정보]는 조건이 없다.** `visibility` 에 그 칸이 아예 없어서 조건을
     * 붙이려야 붙일 수 없다 — 2026-11-12 결정을 타입이 지킨다
     * (`auth/domestic-order-detail-tab-permissions.ts` 머리말). 덕분에 셋을 전부
     * 닫아도 이 목록이 빈 배열이 되는 일은 없다.
     */
    { label: "기본정보", href: hrefs.root },
    ...(visibility.quotes ? [{ label: "견적서", href: hrefs.quotes }] : []),
    ...(visibility.purchaseOrders ? [{ label: "발주서", href: hrefs.purchaseOrders }] : []),
    ...(visibility.approval ? [{ label: "승인", href: hrefs.approval }] : []),
  ];
}
