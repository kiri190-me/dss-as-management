import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import DomesticOrderApprovalPanel from "@/components/domestic-orders/detail/DomesticOrderApprovalPanel";
import DomesticOrderDetailNotice from "@/components/domestic-orders/detail/DomesticOrderDetailNotice";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { canOpenDomesticOrderDetailTab } from "@/lib/auth/domestic-order-detail-tab-access";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { resolveActingApproverUserIds } from "@/lib/db/queries/approval-route-delegations";
import {
  getDomesticOrderApprovalHistory,
  getDomesticOrderApprovalUnits,
} from "@/lib/db/queries/domestic-order-approvals";
import { getDomesticOrderDetail } from "@/lib/db/queries/domestic-orders";
import {
  getCurrentShipmentApprovalRoute,
  listShipmentApprovalRouteSteps,
} from "@/lib/db/queries/shipment-approval-routes";
import {
  DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE,
  isDomesticOrderApprovalRouteInForce,
} from "@/lib/domain/domestic-order-approval-rules";

/**
 * ============================================================================
 * /domestic-orders/{id}/approval — 「승인」 탭 (2026-11-06)
 * ============================================================================
 * 기타건 = **내자 정리의 한 줄**이다. 그 줄의 **최종 출하 승인** 하나를 올리고 ·
 * 처리하고 · 되짚는다.
 *
 * 🔴 **승인 종류는 하나뿐이다.** 접수 건 상세의 「검수/승인」 탭에는 수리 검수 승인과
 * 최종 출하 승인이 나란히 서지만, 기타건에는 검수라는 단계가 없다.
 *
 * 🔴 **결재선 갈래가 따로다**(2026-11-06 사용자 결정 — 「[기타건 최종 출하승인]으로
 * 절차를 따로 만들자」). 흐름·위임·판정은 기존 승인 절차 그대로이고, 갈라진 것은
 * [사용자 관리] › [승인 절차] 탭에서 고르는 **용도 하나**뿐이다.
 *
 * ── 🔴 열쇠가 셋이지만 영역은 하나다 (2026-11-12 둘째에 둘에서 셋이 됐다) ──
 *  · `domesticOrders` 영역 READ — 이 화면에 들어올 수 있는가. 쪼갠 뒤로 그 뜻은
 *    「내자 잎 넷 중 하나라도 열려 있는가」다. 레이아웃이 같은 줄을 걸지만 여기서
 *    한 번 더 건다(형제 탭들과 같은 모양 — 감추는 것은 막은 것이 아니고, 주소를
 *    직접 치면 그대로 들어와진다).
 *  · `domesticOrders.approval` READ — **이 탭을 볼 수 있는가**(새로 생겼다). 위
 *    입장권보다 **좁다** — 그래서 들어온 사람 사이를 가른다. 2026-11-06 에 이 탭을
 *    가리지 못한 까닭은 그때 쓸 수 있는 열쇠가 입장권과 같은 글자뿐이었기 때문이다.
 *    🔴 **결재권이 아니다**(아래 셋째 줄과 다른 일이다).
 *  · `domesticOrders.edit` WRITE — **승인을 올릴 수 있는가.** 내자 줄을 고치는 그
 *    열쇠 그대로다(쪼개기 전에는 `domesticOrders` WRITE 였고, 사다리의 그 칸이
 *    잎으로 내려앉았을 뿐이라 **통과하는 역할이 한 명도 달라지지 않는다**).
 *    🔴 탭을 보는 열쇠와 **일부러 다르다** — 「승인 탭은 보는데 올리지는 못하는」
 *    지금 상태를 한 칸으로는 표현할 수 없다.
 * 🔴 **승인·반려에는 영역 열쇠를 걸지 않는다** — 결재선에 올라간 사람이 곧 그 단계의
 * 결재자라는 것이 이 기능의 설계이고, 서버 액션도 그렇게 판정한다
 * (actions/domestic-order-approvals.ts 머리말). 🔵 다만 이 **화면**은 위의 READ 로
 * 막혀 있으므로, 결재선에 세울 사람은 내자를 볼 수 있어야 한다. 접수 건 출하 승인도
 * 같은 모양이다(`repairCases` READ 가 있어야 그 화면이 열린다).
 *
 * ── 🔴 결재선 판이 하나도 없을 때 ───────────────────────────────────────
 * 새 갈래라 판이 0개로 시작한다. 그때 이 탭은 **조용하지 않다** — 단추 대신 「무엇이
 * 없고 어디서 만드는지」를 상자에 적는다(DomesticOrderApprovalPanel 의
 * `isRouteConfigured` 갈래). 글자는 서버가 거절하며 돌려주는 그 한 줄과 같은 상수다.
 *
 * ── 🔴 서버가 판정하고 화면은 그린다 ────────────────────────────────────
 * 상태(승인 완료 · 재승인 필요 …)를 여기서 계산하지 않는다. 조회가 도메인 함수 하나
 * (resolveApprovalState)로 정해 주고 화면은 그 답을 그대로 그린다 — 두 곳에서
 * 계산하면 화면은 「승인 완료」라는데 기록은 「낡았다」고 답하는 날이 온다.
 * ============================================================================
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

  // 세션이 없으면 위 가드가 이미 로그인으로 보냈다 — 방어적으로만 남겨 둔다.
  // 🔴 세션에 박혀 있는 role 이 아니라 **살아 있는 계정을 다시 읽는다**(강등된 계정이
  // 토큰 만료 전까지 예전 권한으로 결재하는 구멍을 막는다).
  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  /**
   * 🔴 **주소를 직접 쳐도 막힌다**(2026-11-12 둘째). 탭 줄이 이 탭을 감추는 것은 관문이
   * 아니다 — 관문은 여기다. 레이아웃과 **같은 창구·같은 열쇠**를 부른다
   * (`auth/domestic-order-detail-tab-access.ts`).
   *
   * 🔴 이것은 **결재권이 아니다.** 누가 승인·반려를 누를 수 있는가는 아래에서 읽는
   * 결재선·단계 위임이 정하고, 이 관문은 「이 화면에 들어올 수 있는가」만 답한다.
   * 그래서 기본값이 **지금 이 탭을 보던 사람 전부**다 — 결재를 못 누르는 사람도 지금
   * 이 탭을 보고 있고, 그 사람들을 좁히는 것은 이 조각의 일이 아니다.
   */
  if (!(await canOpenDomesticOrderDetailTab(actingUser, "approval"))) {
    return (
      <DomesticOrderDetailNotice
        title="승인"
        description="「승인」 탭을 볼 권한이 없습니다. 필요하면 관리자에게 요청해 주세요."
      />
    );
  }

  // 없는 줄 · 휴지통에 든 줄 · uuid 가 아닌 주소는 전부 여기서 404 다. 레이아웃이 이미
  // 같은 판정을 하지만 cache() 덕에 질의가 한 번 더 돌지 않고, 이 페이지만 따로
  // 보더라도 "어떤 줄이 있어야 한다"는 전제가 코드에 적혀 있게 된다.
  const row = await getDomesticOrderDetail(id);
  if (!row) notFound();

  // 서로를 모르는 조회들이라 나란히 보낸다.
  // 🔴 결재선 단계 위임도 여기서 읽어 내려보낸다 — 「지금 보고 있는 사람이 대신 누를
  // 수 있는 자리들」이다. 화면에 주는 것은 **힌트**이고, 실제 승인·반려는
  // decideDomesticOrderApproval 이 자기 트랜잭션 안에서 같은 목록을 다시 읽어
  // 판정한다(그래야 읽은 직후 되돌려진 위임으로 결재가 통과하지 않는다).
  const [progress, history, currentRoute, actingApproverUserIds, canRequestApproval] =
    await Promise.all([
      // 🔴 **회차마다 하나씩**(2026-11-08, 사용자 결정 12). 「줄 전체에서 가장 최근
      //    한 줄」을 돌려주는 getDomesticOrderApprovalProgress 와 다른 함수다 — 그쪽은
      //    포털에 결재 메일을 찌르는 자리의 것이고, 바꿔 쓰면 2차를 올렸는데 1차의
      //    결재자에게 메일이 간다(그 함수 머리말).
      getDomesticOrderApprovalUnits(row.id),
      getDomesticOrderApprovalHistory(row.id),
      getCurrentShipmentApprovalRoute(DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE),
      resolveActingApproverUserIds(actingUser.id, new Date()),
      // 🔴 **승인을 올릴 수 있는가** — 내자 줄을 고치는 그 열쇠다. 2026-11-12(둘째)에
      //    `domesticOrders` WRITE 에서 `domesticOrders.edit` WRITE 로 내려왔고, 통과하는
      //    역할은 한 명도 달라지지 않았다(사다리의 쓰기 칸이 그대로 잎이 됐다).
      //    🔴 서버 액션(actions/domestic-order-approvals.ts)과 **같은 열쇠**여야 한다 —
      //    갈리는 날 단추는 보이는데 눌리지 않는다.
      hasPermission(actingUser, "domesticOrders.edit", "WRITE"),
    ]);

  // 🔴 이력의 줄들이 가리키는 **판들**을 한 번에 읽는다. 「n/m단계」의 m 은 그 줄에
  // 적힌 판으로 세야 한다 — 관리자가 절차를 바꾸면 새 판이 얹히고 진행 중이던 건은
  // 옛 판을 끝까지 따라가므로, 현재 판으로 세면 다 끝난 옛 줄이 아직 사람이 더 남은
  // 것처럼 보인다. 가장 최근 줄은 이력의 첫 줄이므로 따로 더할 것이 없다.
  const approvalRouteSteps = await listShipmentApprovalRouteSteps(
    history.flatMap((record) => (record.routeId ? [record.routeId] : []))
  );

  return (
    <DomesticOrderApprovalPanel
      domesticOrderId={row.id}
      /* 줄을 이미 읽어 왔으므로 progress 가 null 일 수 없다(그 조회는 없는 줄·휴지통
         에만 null 이다). 그래도 기본값 하나를 둔다 — 경계를 넘는 값에 `!` 를 붙이지
         않는 것이 이 저장소의 관례다. 🔴 **빈 배열이 아니라 단위 하나**다: 단위가
         0개인 줄은 없고(domain 의 domesticOrderApprovalUnitCount), 빈 배열을 넘기면
         탭이 카드 없이 조용히 비어 고장으로 읽힌다. */
      units={
        progress?.units ?? [
          { rowOrder: 1, label: "", state: "NOT_REQUESTED" as const, latest: null },
        ]
      }
      history={history}
      routeSteps={approvalRouteSteps}
      /* 🔴 판이 없거나 단계가 0개면 서버가 요청을 ROUTE_NOT_CONFIGURED 로 거절한다.
         판정을 여기 새로 적지 않고 도메인 함수를 그대로 부른다. */
      isRouteConfigured={isDomesticOrderApprovalRouteInForce(currentRoute)}
      /* 아직 올리지 않았을 때 그림을 그릴 **지금 판**의 단계들. 그릴 것만 골라
         넘긴다 — 결재선 편집 화면이 쓰는 계정 상태(잠김 시각 · 역할)는 이 화면이
         보여 줄 것이 아니다. 🔴 `approverUserId` 는 그리지 않지만 **필요하다**:
         「이 단계가 요청자 본인이라 건너뛰는가」를 그 값으로 판정한다. */
      currentRouteSteps={(currentRoute?.steps ?? []).map((step) => ({
        stepOrder: step.stepOrder,
        approverUserId: step.approverUserId,
        approverName: step.approverName,
      }))}
      /* 지정 관문을 판정하는 데 필요한 만큼만. */
      actingUser={{
        id: actingUser.id,
        role: actingUser.role,
        isDeveloper: actingUser.isDeveloper,
      }}
      actingApproverUserIds={actingApproverUserIds}
      canRequestApproval={canRequestApproval}
    />
  );
}
