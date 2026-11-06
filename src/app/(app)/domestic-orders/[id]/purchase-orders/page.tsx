import type { Metadata } from "next";
import { notFound } from "next/navigation";

import DomesticOrderDetailNotice from "@/components/domestic-orders/detail/DomesticOrderDetailNotice";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { getDomesticOrderDetail } from "@/lib/db/queries/domestic-orders";

/**
 * /domestic-orders/{id}/purchase-orders — 「발주서」 탭 (2026-11-06).
 *
 * 🔴 **이 조각은 자리만 세운다.** 내용은 뒤 조각에서 채운다 — 빈 화면 대신 그
 * 사실을 적어 두는 까닭은 DomesticOrderDetailNotice 머리말에 있다.
 *
 * 🔴 열쇠는 `domesticOrders` READ 하나다. 수리 건 상세의 같은 탭도 이 열쇠를 쓰는데
 * (고객사가 우리에게 낸 발주서라 내자 영역이 답한다), 저쪽과 달리 **레이아웃이
 * 탭을 가르지 않는다** — 이 화면은 그 열쇠가 이미 입장권이라, 같은 열쇠를 한 번 더
 * 물어 언제나 참인 값을 프롭으로 나르면 「가르고 있다」는 착각만 남는다. 막는 일은
 * 이 한 줄이 제자리에서 한다(DomesticOrderDetailTabs 의 그 프롭 주석).
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

  const row = await getDomesticOrderDetail(id);
  if (!row) notFound();

  return (
    <DomesticOrderDetailNotice
      title="발주서"
      description="이 줄의 발주서는 다음 조각에서 채웁니다."
    />
  );
}
