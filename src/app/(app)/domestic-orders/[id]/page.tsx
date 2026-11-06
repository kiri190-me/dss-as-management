import type { Metadata } from "next";
import { notFound } from "next/navigation";

import DomesticOrderBasicInfoView from "@/components/domestic-orders/detail/DomesticOrderBasicInfoView";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { getDomesticOrderDetail } from "@/lib/db/queries/domestic-orders";

/**
 * /domestic-orders/{id} — 「기타건 상세」의 **기본정보 탭**이자 **첫 화면**
 * (2026-11-06 사용자 결정: 「기본정보를 첫화면으로 해줘」).
 *
 * 탭 줄의 첫 칸이면서 주소로는 루트다 — 수리 건 상세의 「기본 정보」와 같은 모양이고,
 * 그래서 나머지 탭의 주소가 전부 이 주소의 접두사가 된다(활성 판정이 가장 긴
 * 앞가지로 고르는 까닭 — domain/domestic-order-detail-tabs.ts).
 *
 * 🔴 **가드를 여기서 한 번 더 건다.** 레이아웃이 이미 같은 열쇠로 막지만, 감추는
 * 것은 막은 것이 아니고 — 이 표에는 거래 금액과 입금 여부가 있다. 이 저장소가
 * 메뉴 페이지마다 가드 한 줄을 적어 두는 까닭도 같다(auth/area-guard.ts 머리말:
 * grep 한 번으로 어느 화면이 무엇을 요구하는지 다 보이게).
 *
 * 🔵 `getDomesticOrderDetail` 은 `cache()` 라, 레이아웃이 머리 카드를 그리려고 읽은
 * 그 결과를 이 요청 안에서 그대로 쓴다 — 질의가 한 번 더 도는 것이 아니다.
 */
export const metadata: Metadata = {
  title: "기타건 상세 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

export default async function DomesticOrderBasicInfoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  await requireAreaAccessForCurrentUser("domesticOrders");

  const row = await getDomesticOrderDetail(id);
  if (!row) notFound();

  return <DomesticOrderBasicInfoView row={row} />;
}
