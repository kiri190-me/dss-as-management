import type { RepairCaseDetailTabVisibility } from "@/lib/auth/repair-case-detail-tab-permissions";
import { repairCaseDetailHrefs } from "@/lib/domain/repair-case-detail-tabs";

/**
 * ============================================================================
 * 탭 줄이 무엇을 어떤 차례로 그리는가 — 순수 함수 (2026-11-12)
 * ============================================================================
 * DetailTabs.tsx 에서 떼어 냈다. 그 조각은 `"use client"` 이고 `usePathname()` 을
 * 부르는데, 그 훅은 Next 앱 라우터가 올라간 뒤에만 돌아서 이 저장소의 node:test
 * 환경에서는 그려 볼 수 없다(`domain/repair-case-detail-tabs.ts` 머리말의 같은
 * 사정). 그래서 **그릴 목록을 만드는 부분만** 값으로 확인할 수 있게 빼 둔다 —
 * 「닫으면 그 탭만 빠지고 차례는 그대로인가」는 글자로 읽을 일이 아니라 값으로
 * 재야 하는 것이다.
 *
 * 🔴 **판정은 여기서 하지 않는다.** 이 함수는 이미 정해진 참/거짓을 받아 늘어놓을
 * 뿐이고, 누가 무엇을 볼 수 있는지는 서버(레이아웃)가 정한다
 * (`auth/repair-case-detail-tab-access.ts`). 화면이 내린 판정은 관문이 아니다.
 *
 * 🔴 **차례를 바꾸지 마라.** 2026-09-04 · 2026-10-12 에 사용자가 지정한 차례다 —
 * 가려진 탭만 빠지고 나머지는 자리를 그대로 지킨다.
 * ============================================================================
 */

export type RepairCaseDetailTab = {
  label: string;
  href: string;
};

export function buildRepairCaseDetailTabs(
  repairCaseId: string,
  visibility: RepairCaseDetailTabVisibility
): RepairCaseDetailTab[] {
  // 주소는 도메인 헬퍼가 만들고, 라벨과 순서만 여기(화면)에서 정한다.
  const hrefs = repairCaseDetailHrefs(repairCaseId);
  return [
    /**
     * 🔴 **[기본 정보]는 조건이 없다.** `visibility` 에 그 칸이 아예 없어서 조건을
     * 붙이려야 붙일 수 없다 — 2026-11-12 결정을 타입이 지킨다
     * (`auth/repair-case-detail-tab-permissions.ts` 머리말). 덕분에 여덟을 전부
     * 닫아도 이 목록이 빈 배열이 되는 일은 없다.
     */
    { label: "기본 정보", href: hrefs.root },
    ...(visibility.execution ? [{ label: "작업내용", href: hrefs.execution }] : []),
    ...(visibility.diagnosis ? [{ label: "진단 Flowchart", href: hrefs.diagnosis }] : []),
    ...(visibility.workHistory ? [{ label: "작업 이력", href: hrefs.workHistory }] : []),
    ...(visibility.files ? [{ label: "파일 관리", href: hrefs.files }] : []),
    ...(visibility.report ? [{ label: "보고서", href: hrefs.report }] : []),
    // 견적서 · 검수/승인이 뒤에 온다(2026-09-04 사용자 지정 차례).
    ...(visibility.quotes ? [{ label: "견적서", href: hrefs.quotes }] : []),
    // 🔴 **견적서 바로 오른쪽**이다(사용자 지정 2026-10-12). 견적서를 못 보는 세션에서는
    // 견적서가 빠진 그 자리에 선다 — 차례는 그대로이고 열쇠만 서로 다르다.
    ...(visibility.purchaseOrders ? [{ label: "발주서", href: hrefs.purchaseOrders }] : []),
    ...(visibility.approval ? [{ label: "검수/승인", href: hrefs.approval }] : []),
  ];
}
