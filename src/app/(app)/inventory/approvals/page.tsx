import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { actorHasAllowedRole } from "@/lib/auth/developer-promotion";
import { hasAreaAccess } from "@/lib/auth/area-guard";
import { resolveInventoryCapabilities } from "@/lib/auth/inventory-capabilities";
import {
  getPartIssueRequestDetail,
  listExecutablePartIssueRequests,
  listPartIssueRequestsForPartRequest,
  listPartIssueRequestsInProgress,
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
 * 지정 관문), 「실행할 수 있는 건」과 「진행 중인 신청」도 각각 조회 하나가
 * 정한다. 이 파일이 하는 일은 그 목록에 화면이 그릴 살(항목·결재선 단계 이름·
 * 형제 신청 수·내 신청인가)을 붙이는 것뿐이다.
 *
 * 🔴 **묶음을 보일지 말지만 여기서 정한다.** 「처리할 게 없다」와 「애초에 나와
 * 상관없다」는 다른 말이라 화면이 달라야 하는데, 그 판정은 DB 를 읽어야 알 수
 * 있으므로 클라이언트에 맡기지 않는다.
 *
 * 🔴 **이 페이지 입구에는 메뉴 권한 문을 달지 않는다.** 결재선 승인자 중에는 재고
 * 메뉴 권한이 없는 역할(예: 영업)이 있을 수 있고, 입구를 막으면 그 사람은 자기
 * 차례인 결재를 하러 들어오지 못한다. 메뉴 권한은 그것이 필요한 묶음
 * (「진행 중인 신청」) 하나에만 건다.
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

  /*
    「진행 중인 신청」은 누가 올렸든 결재 중·실행 대기인 신청을 읽기 전용으로 보여
    준다 — 신청을 올린 사람이 자기 신청이 어디까지 왔는지 볼 곳이 여기뿐이다.
    (위 [실행할 건]에 이미 떠 있는 것은 뺀다 — 아래 visibleProgressRows 참조.)
    🔴 보는 사람은 **재고 목록(/inventory)에 들어올 수 있는 사람 전원**이고, 기준도
    그 페이지의 입구와 같다(승인된 계정 + 재고 메뉴 READ). 신청자 본인으로 좁히지
    않는다(사용자 결정 2026-09-11). 거짓이면 조회 자체를 부르지 않는다.
  */
  const showProgressSection =
    actingUser.approvalStatus === "APPROVED" && (await hasAreaAccess("inventory", actingUser));

  const [pendingRows, executableRows, progressRows, currentRoute] = await Promise.all([
    listPartIssueRequestsPendingMyApproval(actingUser.id),
    showExecutionSection ? listExecutablePartIssueRequests() : Promise.resolve([]),
    showProgressSection ? listPartIssueRequestsInProgress() : Promise.resolve([]),
    getCurrentShipmentApprovalRoute(PART_ISSUE_APPROVAL_ROUTE_SCOPE),
  ]);

  /*
    🔴 [실행할 건]이 **보이는 세션에서만**, 거기 이미 떠 있는 신청을 「진행 중인
    신청」에서 뺀다 — 같은 카드가 두 번 보이지 않게(사용자 요청 2026-09-11).
     · 빼는 기준은 상태 글자가 아니라 **실행할 건 목록에 실제로 들어간 id** 다.
       두 목록을 읽는 사이에 승인이 난 건은 실행할 건에 없으므로 진행 쪽에 남는다
       — 어느 쪽에서도 사라지지 않는다.
     · 실행 묶음이 안 보이는 세션(재고 실행 권한 없음)에서는 빼지 않는다. 그 사람
       에게서 승인 완료 건을 빼면 신청이 사라져 보이고, 그것이 이 묶음이 고치려던
       문제다.
     · 조회(listPartIssueRequestsInProgress)는 사람·권한으로 거르지 않는다 — 거르는
       것은 여기, 페이지의 몫이다.
  */
  const progressExcludesExecutable = showExecutionSection;
  const executableIds = new Set(executableRows.map((row) => row.issueRequestId));
  const visibleProgressRows = progressExcludesExecutable
    ? progressRows.filter((row) => !executableIds.has(row.issueRequestId))
    : progressRows;

  // 같은 신청이 여러 묶음에 겹쳐 나올 수 있다(내가 결재할 건이면서 진행 중인 건).
  // 상세는 신청마다 한 번만 읽는다.
  const issueRequestIds = [
    ...new Set([...pendingRows, ...executableRows, ...progressRows].map((row) => row.issueRequestId)),
  ];
  const details = (
    await Promise.all(issueRequestIds.map((issueRequestId) => getPartIssueRequestDetail(issueRequestId)))
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
          // 「내 신청」 판정은 서버가 한다 — 화면은 세션을 모른다.
          isMine: detail.requestedByUserId === actingUser.id,
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
      inProgress={toViews(visibleProgressRows)}
      showApprovalSection={showApprovalSection}
      showExecutionSection={showExecutionSection}
      showProgressSection={showProgressSection}
      progressExcludesExecutable={progressExcludesExecutable}
    />
  );
}
