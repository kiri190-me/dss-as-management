import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { getPartRequestsForManager, getIssuableBalancesForParts } from "@/lib/db/queries/inventory-part-requests";
import { getCurrentShipmentApprovalRoute } from "@/lib/db/queries/shipment-approval-routes";
import {
  listInProgressPartIssueStatusesByPartRequest,
  partRequestIssueLockFor,
  type PartRequestIssueLock,
} from "@/lib/db/queries/inventory-part-issue-requests";
import {
  isPartIssueApprovalRouteInForce,
  PART_ISSUE_APPROVAL_ROUTE_SCOPE,
} from "@/lib/domain/inventory-part-issue-rules";
import PartRequestManagerScreen from "@/components/inventory/PartRequestManagerScreen";

export const metadata: Metadata = {
  title: "부품 요청 관리 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

export default async function InventoryPartRequestsPage() {
  const session = await readSession();
  if (!session) redirect("/login");

  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  // Server-side gate — SALES and AS_ENGINEER never reach this screen
  // (AS_ENGINEER manages their own requests from the repair-case page
  // instead); this is not merely nav-hiding, since a hidden nav link is a
  // UX convenience only and every mutation this screen triggers re-checks
  // authorization independently regardless.
  if (!(await hasPermission(actingUser, "inventory.requestProcessing", "MANAGE"))) {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
        이 화면에 접근할 권한이 없습니다.
      </p>
    );
  }

  const requests = await getPartRequestsForManager();
  const allPartIds = [...new Set(requests.flatMap((r) => r.items.map((i) => i.partId)))];
  const balancesByPartId = await getIssuableBalancesForParts(allPartIds);

  /*
    🔴 「부품 불출」 승인 절차가 지금 쓰이고 있는가 — 서버가 [불출]에 문을 달 때
    보는 **그 판정**이다(domain/inventory-part-issue-rules.ts 의
    isPartIssueApprovalRouteInForce, mutation 도 같은 함수를 부른다). 화면이 다시
    판정하면 「단추는 보이는데 누르면 거절」이나 그 반대가 되고, 후자는 화면에
    아무 표시도 남기지 않아 더 나쁘다.

    판을 읽는 것은 여기서 한다 — 클라이언트가 DB 를 읽게 두지 않는다.
    판이 없거나 단계가 0개면 거짓이고, 그때 이 화면은 지금까지와 한 글자도
    다르지 않다.
  */
  const partIssueApprovalRequired = isPartIssueApprovalRouteInForce(
    await getCurrentShipmentApprovalRoute(PART_ISSUE_APPROVAL_ROUTE_SCOPE)
  );

  /*
    🔴 아직 끝나지 않은 불출 신청이 있는 요청은 [불출] 자리를 잠근다(사용자 요청
    2026-09-11) — 신청을 올린 뒤에도 단추가 그대로면 같은 요청을 또 올릴 수 있다.
    살아 있는 신청은 조회 한 번으로 읽고, 「승인 대기인가 · 실행 대기인가」 판정은
    partRequestIssueLockFor 한 곳에서 한다. 잠긴 요청만 담는다.

    위의 절차 켜짐 판정과는 **따로 간다.** 절차를 꺼도 이미 올라간 신청은 살아
    있어 결재·실행될 수 있고, 그 사이 [불출]로 한 번 더 내보내면 같은 부품이 두 번
    나간다.
  */
  const inProgressIssueStatuses = await listInProgressPartIssueStatusesByPartRequest(
    requests.map((request) => request.id)
  );
  const partIssueLocksByRequestId: Record<string, PartRequestIssueLock> = {};
  for (const [partRequestId, statuses] of inProgressIssueStatuses) {
    const lock = partRequestIssueLockFor(statuses);
    if (lock !== null) partIssueLocksByRequestId[partRequestId] = lock;
  }

  return (
    <PartRequestManagerScreen
      requests={requests}
      balancesByPartId={Object.fromEntries(balancesByPartId)}
      partIssueApprovalRequired={partIssueApprovalRequired}
      partIssueLocksByRequestId={partIssueLocksByRequestId}
    />
  );
}
