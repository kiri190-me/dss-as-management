import { notFound } from "next/navigation";

import PlaceholderPage from "@/components/layout/PlaceholderPage";
import DomesticOrderDetailHeader from "@/components/domestic-orders/detail/DomesticOrderDetailHeader";
import DomesticOrderDetailTabs from "@/components/domestic-orders/detail/DomesticOrderDetailTabs";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { getDomesticOrderDetail } from "@/lib/db/queries/domestic-orders";

/**
 * ============================================================================
 * /domestic-orders/{id} — 「기타건 상세」의 껍데기 (2026-11-06)
 * ============================================================================
 * 기타건 = **내자 정리의 한 줄**이고, 목록의 [형식] 칸을 누르면 여기로 온다. 그
 * 링크는 **수리 건이 붙지 않은 줄에만** 서지만(domain/domestic-order-detail-link.ts),
 * 🔴 **이 주소는 그것으로 막지 않는다.** 까닭 둘:
 *  · 지금 기타건인 줄에 나중에 수리 건을 이어 붙이면, 그 순간 북마크·뒤로가기가
 *    전부 404 가 된다 — 사람이 한 일(연결)이 과거의 주소를 죽이는 셈이다.
 *  · 「기타건인가」는 **지금 이 줄의 상태**이지 이 주소가 가리키는 대상이 아니다.
 *    주소는 `domestic_orders` 의 한 줄을 가리킨다.
 * 규칙 ①(한 줄에 서로 다른 곳으로 가는 링크를 둘 두지 않는다)을 지키는 자리는
 * **목록의 링크**이지 이 주소가 아니다.
 *
 * ── 🔴 머리 카드는 탭 줄보다 **위** ─────────────────────────────────────
 * 어느 탭을 눌러도 같은 카드가 그대로 남는다 — 수리 건 상세가 2026-10-06 에 같은
 * 모양으로 옮겨 간 그대로다. 그래서 그 줄을 읽는 일이 페이지가 아니라 여기다.
 *
 * ── 🔴 인가 ─────────────────────────────────────────────────────────────
 * 내자 정리를 볼 수 있는 사람이 기타건 상세를 본다 — 열쇠는 `domesticOrders`
 * READ 하나이고, 새 영역을 만들지 않는다. **다만 여기서 막는 것은 관문의 전부가
 * 아니다**: 레이아웃이 막아도 각 탭 페이지가 **스스로 다시** 확인한다. 감추는 것은
 * 막은 것이 아니고, 이 표에는 거래 금액과 입금 여부가 들어 있다.
 * ============================================================================
 */

export const dynamic = "force-dynamic";

export default async function DomesticOrderDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // 목록 화면(domestic-orders/page.tsx)과 **같은 한 줄**이다. 사이드바에서 감추는
  // 것은 막은 것이 아니라서, 주소를 직접 친 요청 앞에 이것이 먼저 선다.
  await requireAreaAccessForCurrentUser("domesticOrders");

  // 목록과 같은 갈래다 — 이 화면의 자료는 전부 데이터베이스에 있고, mock 소스에는
  // 내자 정리라는 표 자체가 없다.
  if (getAuthSource() !== "database") {
    return (
      <PlaceholderPage
        title="기타건 상세"
        description="이 화면은 데이터베이스 저장 모드에서만 사용할 수 있습니다."
      />
    );
  }

  // 없는 줄 · 휴지통에 든 줄 · uuid 가 아닌 주소는 전부 여기서 404 다. DB 가 진짜로
  // 터지면 이 함수가 던지고, 그것은 notFound() 가 아니라 오류 화면으로 올라간다 —
  // "없는 줄"과 "못 읽은 줄"을 같은 화면으로 보여 주면 안 된다.
  const row = await getDomesticOrderDetail(id);
  if (!row) notFound();

  /**
   * 「견적서」 탭을 그릴지 정한다. 견적서에는 우리가 고객사에 부른 값이 통째로
   * 있어서, 견적서를 못 보는 사람이 이 탭으로 금액을 들여다볼 수 있으면 그것은
   * 인가 구멍이다.
   *
   * 판정 방법은 수리 건 상세가 같은 탭에 쓰는 것과 **똑같다** — 살아 있는 계정을
   * 다시 읽고(강등된 계정이 옛 토큰으로 다니지 못하게), `quotes` 영역의 READ 를
   * 묻는다. 새 영역 열쇠를 만들지 않는다.
   *
   * 🔴 이것은 **탭을 그릴지 말지**일 뿐 관문이 아니다 — `[id]/quotes/page.tsx` 가
   * 같은 판정을 한 번 더 한다.
   *
   * 세션이 없으면 위 가드가 이미 로그인으로 보냈다 — 여기서는 못 보는 것으로만
   * 취급한다(수리 건 상세 레이아웃과 같은 방어적 처리).
   */
  const session = await readSession();
  const actingUser = session ? await resolveActingUserForSession(session) : null;
  const canViewQuotes = actingUser !== null && (await hasPermission(actingUser, "quotes", "READ"));

  return (
    <div className="flex flex-col gap-4">
      <DomesticOrderDetailHeader row={row} />
      <DomesticOrderDetailTabs id={id} canViewQuotes={canViewQuotes} />
      {children}
    </div>
  );
}
