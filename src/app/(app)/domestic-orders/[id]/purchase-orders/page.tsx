import type { Metadata } from "next";
import { notFound } from "next/navigation";

import DomesticOrderDetailNotice from "@/components/domestic-orders/detail/DomesticOrderDetailNotice";
import DomesticOrderPurchaseOrderFolderSection from "@/components/domestic-orders/detail/DomesticOrderPurchaseOrderFolderSection";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { getDomesticOrderDetail } from "@/lib/db/queries/domestic-orders";
import {
  DOMESTIC_ORDER_PURCHASE_ORDER_ARCHIVE_NO_NUMBER_TEXT,
  resolveDomesticOrderPurchaseOrderArchiveLookup,
} from "@/lib/domain/domestic-order-purchase-order-archive";

/**
 * ============================================================================
 * /domestic-orders/{id}/purchase-orders — 「발주서」 탭 (2026-11-06)
 * ============================================================================
 * 사용자 결정 2026-11-06: 「[발주서]는 내자정리에 적힌 **[발주서 번호]**를 통해서
 * 발주서들을 찾도록 해줘(**수리건의 발주서 위치와 동일**하고 … **같은 발주서 번호를 가진
 * 폴더와 연결**시켜줘)」.
 *
 * 이 탭에 있는 것은 **공유폴더 구역 하나**다. 고객사가 우리에게 낸 발주서(내자)는 DB 에
 * 들어 있지 않고 사내 공유폴더에 발주 건 폴더로 쌓인다(`<연도>/<고객사>/<발주 건>`) —
 * 그 폴더 안을 보려고 탐색기를 따로 열던 일을 이 자리에서 대신한다. 수리 건 상세의 같은
 * 탭과 **같은 서류함**이고, 다른 것은 **무엇으로 찾는가** 하나다:
 *   · 수리 건 — 폴더 이름의 **마지막 두 마디**(L/N · S/N)
 *   · 기타건  — 폴더 이름의 **둘째 마디**(발주서번호). 🔴 기타건에는 L/N 도 S/N 도 없다.
 *
 * ── 🔴 번호가 없는 줄은 **조용한 빈 화면으로 두지 않는다** ────────────────
 * 번호가 비었거나 `-` 한 글자뿐이면 찾을 열쇠가 없다 — 그때는 구역 대신 **까닭을 적은 안내
 * 상자**를 세운다. 글자는 구역이 같은 상황에서 쓰는 것과 **한 벌**이다
 * (domain/domestic-order-purchase-order-archive.ts). 🔴 판정도 그 순수 함수 하나이고,
 * **통로가 같은 판정을 스스로 다시 한다**(화면이 감춘 것은 관문이 아니다).
 *
 * ── 🔴 열쇠는 `domesticOrders` READ 하나다 ───────────────────────────────
 * 수리 건 상세의 같은 탭도 이 열쇠를 쓴다(고객사가 우리에게 낸 발주서라 내자 영역이
 * 답한다 — 폴더 이름에 발주 금액이 들어 있다). 저쪽과 달리 **레이아웃이 이 탭을 가르지
 * 않는다** — 이 화면은 그 열쇠가 이미 입장권이라, 같은 열쇠를 한 번 더 물어 언제나 참인
 * 값을 프롭으로 나르면 「가르고 있다」는 착각만 남는다(DomesticOrderDetailTabs 의 그 프롭
 * 주석). 막는 일은 아래 한 줄이 제자리에서 한다.
 * 🔵 **견적서 열쇠(`quotes`)를 묻지 않는다** — 옆 「견적서」 탭이 둘을 묻는 것은 그쪽이
 * 견적서 자료를 내보내기 때문이다. 여기서 나가는 것은 발주서이고, 그 문은 하나다.
 *
 * ── 🔴 여기서 공유폴더를 읽지 않는다 ────────────────────────────────────
 * 이 파일은 서버 컴포넌트다. 탭이 뜰 때 공유폴더를 읽으면 **NAS 가 느리거나 꺼진 날 탭
 * 자체가 안 뜬다.** 읽기는 화면이 뜬 뒤 구역이 스스로 통로를 불러서 한다(옆 탭들과 같은
 * 규율). 🔴 구역에 넘기는 것은 **이 줄의 id** 하나이고, `label` 은 머리에 적는 글자일 뿐
 * 찾기에 쓰이지 않는다 — 번호는 서버가 그 줄에서 다시 꺼낸다.
 * ============================================================================
 */

export const metadata: Metadata = {
  title: "발주서 | 기타건 상세 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

export default async function DomesticOrderPurchaseOrdersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  await requireAreaAccessForCurrentUser("domesticOrders");

  // 없는 줄 · 휴지통에 든 줄의 탭 주소로 들어오면 404 다. 레이아웃이 이미 같은 판정을
  // 하지만 cache() 덕에 질의가 한 번 더 돌지 않고, 이 페이지만 따로 보더라도 "어떤 줄이
  // 있어야 한다"는 전제가 코드에 적혀 있게 된다.
  const row = await getDomesticOrderDetail(id);
  if (!row) notFound();

  // 🔴 번호는 **서버가 이 줄에서 꺼낸다**(순수 함수 한 벌). 화면이 정한 번호로 폴더를 찾게
  //    만들면 아무 번호나 넣어 남의 발주 건 폴더를 들여다볼 수 있다.
  const lookup = resolveDomesticOrderPurchaseOrderArchiveLookup(row);

  if (lookup.status === "no-po-number") {
    return (
      <DomesticOrderDetailNotice
        title="발주서"
        description={DOMESTIC_ORDER_PURCHASE_ORDER_ARCHIVE_NO_NUMBER_TEXT}
      />
    );
  }

  return (
    <DomesticOrderPurchaseOrderFolderSection domesticOrderId={row.id} label={lookup.purchaseOrderNumber} />
  );
}
