import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import PlaceholderPage from "@/components/layout/PlaceholderPage";
import PurchaseOrderFolderSection from "@/components/repair-cases/purchase-orders/PurchaseOrderFolderSection";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";

/**
 * ============================================================================
 * /repair-cases/{id}/purchase-orders — 「발주서」 탭 (2026-10-12)
 * ============================================================================
 * 사용자 요구 2026-10-12: 「수리 건 상세에 **발주서 탭**을 만들고, **견적서 탭 오른쪽**에
 * 둔다. 그 탭에서 **그 장비의 발주서 폴더**를 [공유폴더] 창으로 본다.」
 *
 * 이 탭에 있는 것은 **공유폴더 구역 하나**다. 고객사가 우리에게 낸 발주서(내자)는 DB 에
 * 들어 있지 않고 사내 공유폴더에 발주 건 폴더로 쌓인다 — 그 폴더 안을 보려고 탐색기를 따로
 * 열던 일을 이 자리에서 대신한다.
 *
 * ── 🔴 인가를 화면에 맡기지 않는다 ──────────────────────────────────────
 * 상위 레이아웃이 못 보는 사람에게 이 탭을 그리지 않지만 **감추는 것은 막은 것이 아니다** —
 * 주소를 직접 치면 그대로 들어와진다. 발주서에는 고객사가 우리에게 낸 금액이 들어 있어서,
 * 그 구멍은 곧 금액이 새는 구멍이다. 그래서 여기서 `domesticOrders` READ 를 **다시**
 * 확인한다(「견적서」 탭이 `quotes` READ 로 같은 일을 하는 것과 같은 모양).
 *  · 🔴 열쇠는 `domesticOrders` 다 — 새 영역을 만들지 않는다. 「발주서를 볼 수 있는가」는
 *    이미 그 하나가 답하고 있고(발주발행일 · 발주금액이 그 표의 칸이다), 두 번째 열쇠를
 *    만들면 관리자가 한쪽만 풀어 둔 상태가 생긴다. 통로도 **같은 글자**를 쓴다.
 *
 * ── 🔴 여기서 공유폴더를 읽지 않는다 ────────────────────────────────────
 * 이 파일은 서버 컴포넌트다. 탭이 뜰 때 공유폴더를 읽으면 **NAS 가 느리거나 꺼진 날 탭
 * 자체가 안 뜬다.** 읽기는 화면이 뜬 뒤 구역이 스스로 통로를 불러서 한다(「견적서」 탭 ·
 * 「보고서」 탭의 공유폴더 구역과 같은 규율).
 *
 * 🔴 **L/N · S/N 으로 미리 가르지 않는다.** 「견적서」 탭은 둘이 없으면 지난 견적서 구역을
 * 아예 그리지 않지만, 여기는 구역이 **하나뿐**이라 그렇게 하면 탭이 통째로 빈다. 둘이 없으면
 * 통로가 디스크를 보지 않고 `not-found` 로 답하고, 구역이 그 뜻을 한 줄로 적는다.
 * ============================================================================
 */

export const metadata: Metadata = {
  title: "발주서 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

export default async function RepairCasePurchaseOrdersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // 상위 (app) 레이아웃이 이미 세션을 확인했다. 형제 탭들과 같은 모양으로 한 번 더 본다.
  const session = await readSession();
  if (!session) {
    redirect("/login");
  }

  // 🔴 살아 있는 계정을 다시 읽어 판정한다 — 강등된 계정이 옛 토큰으로 금액을 들여다보지 못하게.
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  const canView = await hasPermission(actingUser, "domesticOrders", "READ");
  if (!canView) {
    return (
      <PlaceholderPage
        title="발주서"
        description="발주서를 볼 권한이 없습니다. 필요하면 관리자에게 요청해 주세요."
      />
    );
  }

  /**
   * 접수 건이 실제로 있는지는 `[id]/layout.tsx` 가 이미 본다. 그래도 한 번 더 부르는 까닭은
   * 구역에 넘길 id 가 **그 건의 것**이어야 하기 때문이다. 요청마다 캐시되므로(`cache()`)
   * 조회가 한 번 더 도는 것이 아니다.
   */
  const resolved = await resolveRepairCaseForServer(id);
  if (!resolved) notFound();

  return <PurchaseOrderFolderSection repairCaseId={resolved.id} />;
}
