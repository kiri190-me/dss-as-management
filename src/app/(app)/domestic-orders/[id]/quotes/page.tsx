import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import DomesticOrderDetailNotice from "@/components/domestic-orders/detail/DomesticOrderDetailNotice";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getDomesticOrderDetail } from "@/lib/db/queries/domestic-orders";

/**
 * /domestic-orders/{id}/quotes — 「견적서」 탭 (2026-11-06).
 *
 * 🔴 **이 조각은 자리만 세운다.** 연결된 견적서를 실제로 보여 주는 일은 다음
 * 조각(3-ㄴ)이고, 그 아래 공유폴더 되짚기가 그 다음(3-ㄷ)이다. 빈 화면 대신 그
 * 사실을 한 줄로 적어 두는 까닭은 DomesticOrderDetailNotice 머리말에 있다 —
 * 눌러 보고 아무것도 없으면 사람은 탭이 깨졌다고 읽는다.
 *
 * ── 🔴 열쇠가 둘이다 ────────────────────────────────────────────────────
 *  · `domesticOrders` READ — 이 화면(기타건 상세)에 들어올 수 있는가. 레이아웃이
 *    같은 열쇠로 막지만 여기서 한 번 더 건다(형제 탭들과 같은 모양).
 *  · `quotes` READ — **견적서를 볼 수 있는가.** 견적서에는 우리가 고객사에 부른
 *    값이 통째로 있어서, 내자는 볼 수 있지만 견적서는 못 보는 사람에게 이 탭이
 *    열리면 그것이 곧 금액이 새는 구멍이다. 수리 건 상세의 같은 탭이 쓰는 열쇠
 *    그대로이고, 새 영역을 만들지 않는다.
 *
 * 🔴 **레이아웃이 탭을 감추는 것은 관문이 아니다** — 주소를 직접 치면 그대로
 * 들어와지므로 여기서 같은 판정을 다시 한다. 살아 있는 계정을 다시 읽는 것도 그쪽과
 * 같다(강등된 계정이 옛 토큰으로 금액을 들여다보지 못하게).
 */
export const metadata: Metadata = {
  title: "견적서 | 기타건 상세 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

export default async function DomesticOrderQuotesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  await requireAreaAccessForCurrentUser("domesticOrders");

  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  const canViewQuotes = await hasPermission(actingUser, "quotes", "READ");
  if (!canViewQuotes) {
    return (
      <DomesticOrderDetailNotice
        title="견적서"
        description="견적서를 볼 권한이 없습니다. 필요하면 관리자에게 요청해 주세요."
      />
    );
  }

  // 없는 줄 · 휴지통에 든 줄의 탭 주소로 들어오면 404 다. 레이아웃이 이미 같은
  // 판정을 하지만 cache() 덕에 질의가 한 번 더 돌지 않고, 이 페이지만 따로 보더라도
  // "어떤 줄이 있어야 한다"는 전제가 코드에 적혀 있게 된다.
  const row = await getDomesticOrderDetail(id);
  if (!row) notFound();

  return (
    <DomesticOrderDetailNotice
      title="견적서"
      description="이 줄에 연결된 견적서는 다음 조각에서 채웁니다."
    />
  );
}
