import { notFound } from "next/navigation";

import PlaceholderPage from "@/components/layout/PlaceholderPage";
import DomesticOrderDetailHeader from "@/components/domestic-orders/detail/DomesticOrderDetailHeader";
import DomesticOrderDetailTabs from "@/components/domestic-orders/detail/DomesticOrderDetailTabs";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { resolveDomesticOrderDetailTabVisibility } from "@/lib/auth/domestic-order-detail-tab-access";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { getDomesticOrderApprovalUnits } from "@/lib/db/queries/domestic-order-approvals";
import { getDomesticOrderDetail } from "@/lib/db/queries/domestic-orders";
import { isFinalShipmentApproved } from "@/lib/domain/final-shipment-approval-badge";
import { resolveMiscCaseStatus } from "@/lib/domain/misc-case-status";

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
 *
 * 🔴 **그 한 줄의 뜻이 2026-11-12(둘째)에 또렷해졌다.** 그날 `domesticOrders` 가
 * 잎 넷(조회 · 수정 · 삭제·복원 · 승인)으로 쪼개졌고, 메뉴 수준은 **잎들의
 * 최대값**이다(permission-features.ts 의 areaLevelFromLeaves). 그러니 아래 가드가
 * 묻는 것은 정확히 「**넷 중 하나라도 열려 있는가**」이고, 그것이 이 화면의 입장권이다.
 * 🔵 탭마다의 열쇠는 그보다 **좁다** — 그래서 들어온 사람 사이를 가를 수 있다.
 * 🔵 역할별 기본값으로는 넷이 함께 열리고 함께 닫히므로, 설정을 아무도 건드리지
 * 않은 상태에서 이 줄의 동작은 쪼개기 전과 한 글자도 다르지 않다.
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
   * 어느 탭을 그릴지 정한다(2026-11-12 둘째 — 그 전에는 「견적서」 하나뿐이었다).
   *
   * 판정 방법은 각 탭의 화면이 쓰는 것과 **똑같다** — 살아 있는 계정을 다시 읽고
   * (강등된 계정이 옛 토큰으로 금액을 들여다보지 못하게), 탭마다 정해진 열쇠의
   * READ 를 묻는다. 🔴 **열쇠를 여기 적지 않는다** — 어느 탭이 어느 잎을 보는지는
   * `auth/domestic-order-detail-tab-permissions.ts` 한 곳에만 있다. 탭 줄과 각
   * 페이지가 서로 다른 열쇠를 보게 되는 날 증상은 「탭은 없는데 주소로는
   * 들어와진다」이고, 그것은 아무 오류도 내지 않는다.
   *
   * 🔴 이것은 **탭을 그릴지 말지**일 뿐 관문이 아니다. 주소를 직접 치면 그대로
   * 들어와지므로 탭마다 제 page.tsx 가 같은 창구로 한 번 더 판정한다.
   *
   * 🔵 **위 입장 가드보다 좁은 열쇠들이다.** 입장은 메뉴 수준(= 내자 잎 넷의
   * 최대값)이고 탭은 그중 하나씩을 본다 — 그래서 조회만 닫힌 사람은 들어오기는
   * 하고 [발주서]만 못 본다. 2026-11-06 에 이 가름이 서지 않았던 까닭은 그때
   * `domesticOrders` 에 잎이 없어 **입장권과 탭 열쇠가 같은 글자**였기 때문이다.
   *
   * 🔴 [기본정보] 탭은 이 꾸러미에 없다 — 가리지 않기로 한 탭이고, 셋을 전부
   * 닫아도 그 하나는 남는다(그래서 「탭이 하나도 없는 사람」이 생기지 않는다).
   *
   * 세션이 없으면 위 가드가 이미 로그인으로 보냈다 — 여기서는 못 보는 것으로만
   * 취급한다(수리 건 상세 레이아웃과 같은 방어적 처리).
   *
   * 🔵 열쇠가 셋이어도 **질의는 요청당 한 번**이다(permission-resolver 의 cache()).
   */
  const session = await readSession();
  const actingUser = session ? await resolveActingUserForSession(session) : null;
  const tabVisibility = await resolveDomesticOrderDetailTabVisibility(actingUser);

  /**
   * 🔴 머리 카드의 **상태 배지**(2026-11-06 사용자 요구 — 「출하 승인 대기」/「출하
   * 대기」가 상세의 헤드와 기타건 현황 목록 **둘 다**에 떠야 한다).
   *
   * 🔵 **질의가 한 벌 더 돌지 않는다.** `getDomesticOrderApprovalUnits` 는 cache()
   * 라, [승인] 탭이 같은 요청 안에서 다시 물어도 이 결과를 그대로 쓴다(그 함수 주석).
   * 승인 기록이 한 줄도 없으면 `state` 가 NOT_REQUESTED 이고, 그때 배지는 「진행 중」
   * 이다 — 접는 규칙은 목록과 **같은 함수** 하나가 갖는다.
   *
   * 🔴 **회차마다 선 승인을 하나로 접은 값**이다(2026-11-08). 1차만 승인되고 2차가
   * 아직이면 이 줄은 아직 「출하 대기」가 아니다 — 접는 규칙은 목록 배지·완료 관문과
   * 같은 함수 하나가 갖는다(foldDomesticOrderApprovalStates).
   */
  const approval = await getDomesticOrderApprovalUnits(id);
  const status = resolveMiscCaseStatus({
    completedAt: row.completedAt,
    approvalState: approval?.state ?? null,
  });

  /**
   * 🔴 머리 카드의 **[최종 출하 승인 완료]** 배지(2026-11-08 사용자 요구).
   *
   * 🔵 **질의가 늘지 않는다** — 바로 위 상태 배지와 **같은 조회 하나**의 결과를
   * 다시 읽는다. 값을 둘로 나누는 까닭은 상태 배지가 완료된 줄에서 「완료」로
   * 덮이기 때문이다(그 머리 카드의 주석).
   *
   * 🔴 **회차 전부가 승인됐을 때만** 참이다 — `approval.state` 가 이미 접힌 값이다
   * (foldDomesticOrderApprovalStates). 판정은 도메인 하나가 한다: `STALE` 에는 안
   * 붙는다(domain/final-shipment-approval-badge.ts).
   */
  const finalShipmentApproved = isFinalShipmentApproved(approval?.state ?? null);

  return (
    <div className="flex flex-col gap-4">
      <DomesticOrderDetailHeader
        row={row}
        status={status}
        finalShipmentApproved={finalShipmentApproved}
      />
      <DomesticOrderDetailTabs id={id} visibility={tabVisibility} />
      {children}
    </div>
  );
}
