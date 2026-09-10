import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { actorHasAllowedRole } from "@/lib/auth/developer-promotion";
import { resolveInventoryCapabilities } from "@/lib/auth/inventory-capabilities";
import {
  getPartIssueRequestDetail,
  listExecutablePartIssueRequests,
  listPartIssueRequestsForPartRequest,
  listPartIssueRequestsPendingMyApproval,
} from "@/lib/db/queries/inventory-part-issue-requests";
import {
  getCurrentShipmentApprovalRoute,
  listShipmentApprovalRouteSteps,
} from "@/lib/db/queries/shipment-approval-routes";
import {
  isPartIssueApprovalRouteInForce,
  isPartIssueRequestAwaitingApproval,
  PART_ISSUE_APPROVAL_ROUTE_SCOPE,
} from "@/lib/domain/inventory-part-issue-rules";
import PartIssueApprovalScreen, {
  type PartIssueApprovalRequestView,
} from "@/components/inventory/PartIssueApprovalScreen";

export const metadata: Metadata = {
  title: "불출 승인 요청건 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * ============================================================================
 * [승인 요청건] 탭 — 자료를 모아 화면에 넘긴다
 * ============================================================================
 * 🔴 **좁히는 판정을 여기서 새로 적지 않는다.** 「내가 지금 결재해야 할 건」은
 * 조회 하나가 정하고(listPartIssueRequestsPendingMyApproval → 출하 승인과 같은
 * 지정 관문), 「실행할 수 있는 건」도 조회 하나가 정한다. 이 파일이 하는 일은
 * 그 목록에 화면이 그릴 살(항목·결재선 단계 이름·형제 신청 수)을 붙이는 것뿐이다.
 *
 * 🔴 **묶음을 보일지 말지만 여기서 정한다.** 「처리할 게 없다」와 「애초에 나와
 * 상관없다」는 다른 말이라 화면이 달라야 하는데, 그 판정은 DB 를 읽어야 알 수
 * 있으므로 클라이언트에 맡기지 않는다.
 * ============================================================================
 */
export default async function InventoryPartIssueApprovalsPage() {
  const session = await readSession();
  if (!session) redirect("/login");

  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  const capabilities = await resolveInventoryCapabilities(actingUser);
  /*
    실행은 두 갈래(요청 기반 · 직접 사용)이고 서버가 갈래마다 다른 것을 묻는다 —
    요청 기반은 부품 요청 처리, 직접 사용은 재고 이동이다. 둘 중 하나라도 열려
    있으면 실행할 것이 있을 수 있으므로 묶음을 보여 준다. 실제 차단은 실행
    mutation 이 갈래를 보고 다시 한다.
  */
  const showExecutionSection = capabilities.requestProcessing || capabilities.stock;

  const [pendingRows, executableRows, currentRoute] = await Promise.all([
    listPartIssueRequestsPendingMyApproval(actingUser.id),
    showExecutionSection ? listExecutablePartIssueRequests() : Promise.resolve([]),
    getCurrentShipmentApprovalRoute(PART_ISSUE_APPROVAL_ROUTE_SCOPE),
  ]);

  const details = (
    await Promise.all(
      [...pendingRows.map((row) => row.issueRequestId), ...executableRows.map((row) => row.issueRequestId)].map(
        (issueRequestId) => getPartIssueRequestDetail(issueRequestId)
      )
    )
  ).filter((detail) => detail !== null);

  /*
    🔴 결재선 단계 이름은 **그 신청이 타고 있는 판**으로 읽는다. 「현재 판」으로
    세면, 관리자가 절차를 바꾼 뒤 진행 중이던 신청이 「2/2단계」 대신 「2/4단계」로
    보여 아직 두 사람이 더 남은 것처럼 읽힌다. 판 id 는 결재 행에 적혀 있다.
  */
  const routeIdOf = (detail: (typeof details)[number]): string | null =>
    detail.approvals.length > 0 ? detail.approvals[detail.approvals.length - 1].routeId : null;
  const routeStepLists = await listShipmentApprovalRouteSteps(
    details.map(routeIdOf).filter((routeId) => routeId !== null)
  );

  // 같은 부품 요청에 결재 중인 **다른** 신청이 있는가. 신청은 재고를 예약하지
  // 않으므로 둘이 합쳐 남은 수량을 넘길 수 있고, 그때 뒤엣것이 실행에서 막힌다.
  const siblingCounts = new Map<string, number>();
  await Promise.all(
    details.map(async (detail) => {
      if (detail.partRequestId === null) return;
      const siblings = await listPartIssueRequestsForPartRequest(detail.partRequestId);
      siblingCounts.set(
        detail.id,
        siblings.filter(
          (sibling) =>
            sibling.issueRequestId !== detail.id && isPartIssueRequestAwaitingApproval(sibling.status)
        ).length
      );
    })
  );

  const viewById = new Map<string, PartIssueApprovalRequestView>(
    details.map((detail) => {
      const routeId = routeIdOf(detail);
      return [
        detail.id,
        {
          detail,
          routeSteps: routeStepLists.find((list) => list.routeId === routeId)?.steps ?? null,
          siblingPendingCount: siblingCounts.get(detail.id) ?? 0,
        },
      ];
    })
  );

  const toViews = (rows: { issueRequestId: string }[]): PartIssueApprovalRequestView[] =>
    rows.map((row) => viewById.get(row.issueRequestId)).filter((view) => view !== undefined);

  /*
    🔴 「애초에 결재자가 아닌 세션」에만 결재 묶음을 감춘다. 셋 중 하나면 보인다:
     · 지금 내 앞에 놓인 건이 있다 — 옛 판을 타는 건도 여기서 잡힌다.
     · 지금 쓰이는 「부품 불출」 판에 내가 올라가 있다 — 아직 내 차례가 아닐 뿐이다.
     · 최고관리자다 — 지정된 사람이 자리를 비웠을 때의 비상구이고, 그 판정은
       지정 관문이 안에서 쓰는 것과 **같은 함수**를 본다.
  */
  const standsOnCurrentRoute =
    isPartIssueApprovalRouteInForce(currentRoute) &&
    currentRoute.steps.some((step) => step.approverUserId === actingUser.id);
  const showApprovalSection =
    pendingRows.length > 0 || standsOnCurrentRoute || actorHasAllowedRole(actingUser, ["SUPER_ADMIN"]);

  return (
    <PartIssueApprovalScreen
      pending={toViews(pendingRows)}
      executable={toViews(executableRows)}
      showApprovalSection={showApprovalSection}
      showExecutionSection={showExecutionSection}
    />
  );
}
