import type { Metadata } from "next";
import { notFound } from "next/navigation";

import DomesticOrderDetailNotice from "@/components/domestic-orders/detail/DomesticOrderDetailNotice";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { getDomesticOrderDetail } from "@/lib/db/queries/domestic-orders";

/**
 * /domestic-orders/{id}/approval — 「승인」 탭 (2026-11-06).
 *
 * 🔴 **이 조각은 자리만 세운다.** 내용은 뒤 조각에서 채운다 — 빈 화면 대신 그
 * 사실을 적어 두는 까닭은 DomesticOrderDetailNotice 머리말에 있다.
 *
 * 🔴 열쇠는 `domesticOrders` READ 하나다. 수리 건 상세의 「검수/승인」 탭도 따로
 * 가르지 않고 늘 그려지고, 여기도 같다 — 다만 **그리는 것과 막는 것은 다르므로**
 * 이 한 줄이 제자리에 있어야 한다(주소를 직접 치면 그대로 들어와진다).
 */
export const metadata: Metadata = {
  title: "승인 | 기타건 상세 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

export default async function DomesticOrderApprovalPage({
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
      title="승인"
      description="이 줄의 승인은 다음 조각에서 채웁니다."
    />
  );
}
