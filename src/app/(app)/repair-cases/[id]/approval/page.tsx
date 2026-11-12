import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { canOpenRepairCaseDetailTab } from "@/lib/auth/repair-case-detail-tab-access";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import DatabaseApprovalScreen from "@/components/repair-cases/approval/DatabaseApprovalScreen";
import {
  getCurrentApprovalsForCase,
  getApprovalHistoryForCase,
  listInspectionApproverCandidates,
} from "@/lib/db/queries/repair-case-approvals";
import { resolveShipmentDecideAuthorization } from "@/lib/db/queries/shipment-delegations";
import { resolveActingApproverUserIds } from "@/lib/db/queries/approval-route-delegations";
import { listShipmentApprovalRouteSteps } from "@/lib/db/queries/shipment-approval-routes";
import { roleLabels, type Role } from "@/lib/domain/types";

export const metadata: Metadata = {
  title: "검수/승인 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

export default async function RepairCaseApprovalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // 기존 인증 로직(readSession)을 그대로 재사용한다 — 새 검증 로직을 만들지
  // 않는다. 상위 (app) 레이아웃이 이미 세션을 확인했으므로 여기 도달했다면
  // 정상적으로는 항상 세션이 존재하지만, 방어적으로 한 번 더 확인한다.
  const session = await readSession();
  if (!session) {
    redirect("/login");
  }

  // 클라이언트에는 최소한의 검증된 정보만 넘긴다(id/name/role/approvalStatus).
  // 세션 쿠키 자체나 원본 세션 payload를 내려보내지 않는다.
  const actingUser: ActingUser | null = await resolveActingUserForSession(session);

  const resolved = await resolveRepairCaseForServer(id);
  // 이 지점에 도달했다면 상위 layout.tsx가 이미 존재를 확인했으므로 resolved는
  // 항상 존재해야 한다. 방어적으로만 남겨둔다.
  if (!resolved) {
    notFound();
  }

  /**
   * 🔴 **주소를 직접 쳐도 막힌다**(2026-11-12). 탭 줄이 이 탭을 감추는 것은 관문이
   * 아니다 — 관문은 여기다. 레이아웃과 **같은 창구·같은 열쇠**를 부른다
   * (`auth/repair-case-detail-tab-access.ts`).
   *
   * 🔴 이것은 **결재권이 아니다.** 누가 승인·반려를 누를 수 있는가는 아래에서 읽는
   * 결재선·출하 위임이 정하고, 이 관문은 「이 화면에 들어올 수 있는가」만 답한다.
   * 그래서 기본값이 다섯 역할 전부 열림이다 — 결재를 못 누르는 사람도 지금 이 탭을
   * 보고 있고(종 알림도 여기를 가리킨다), 그 사람들을 좁히는 것은 이 조각의 일이
   * 아니다(2026-11-12 사용자 결정).
   */
  if (!(await canOpenRepairCaseDetailTab(actingUser, "approval"))) {
    return (
      <PlaceholderPage
        title="검수/승인"
        description="「검수/승인」 탭을 볼 권한이 없습니다. 필요하면 관리자에게 요청해 주세요."
      />
    );
  }

  // 읽기 소스에서 mock이 사라진 뒤로 모든 수리 건은 항상 DATABASE로 해석되므로
  // 검수/승인 화면은 DB 판 한 벌만 그린다(데모판 분기는 제거했다).
  // 「누구에게 보낼까요」 후보도 여기서 계산해 내려보낸다 — 자격 판정(역할
  // 목록 + 개발자 승격 + 계정 상태)은 요청을 실제로 받는 mutation과 **같은
  // 목록·같은 함수**를 써야 하고, 그것은 서버에만 있다. 클라이언트가 사용자
  // 표를 읽어 스스로 거르게 두면 두 판정이 갈라진다(decideAuthorization을
  // 서버에서 계산해 내려보내는 것과 같은 이유다).
  //
  // 결재선 단계 위임도 여기서 읽어 내려보낸다 — 「지금 보고 있는 사람이 대신
  // 누를 수 있는 자리들」이다. 🔴 화면에 주는 것은 **힌트**이고, 실제 승인·반려는
  // decideRepairCaseApproval 이 자기 트랜잭션 안에서 같은 목록을 다시 읽어
  // 판정한다(그래야 읽은 직후 되돌려진 위임으로 결재가 통과하지 않는다).
  // 로그인 사용자를 못 읽었으면 빈 배열이다 — 그때는 화면이 단추를 아예 그리지
  // 않는다(DatabaseApprovalScreen 의 첫 갈래).
  const [
    currentApprovals,
    history,
    decideAuthorization,
    inspectionAssignees,
    actingApproverUserIds,
    canRequestApproval,
  ] = await Promise.all([
    getCurrentApprovalsForCase(resolved.id),
    getApprovalHistoryForCase(resolved.id),
    actingUser ? resolveShipmentDecideAuthorization(actingUser.id) : Promise.resolve({ allowed: false as const }),
    listInspectionApproverCandidates(),
    actingUser
      ? resolveActingApproverUserIds(actingUser.id, new Date())
      : Promise.resolve([] as readonly string[]),
    // 🔴 **승인을 올릴 수 있는가** — 2026-11-12(셋째)부터 [역할별 접근 권한]의
    //    `repairCases.approval` **쓰기**가 정한다. 그 전까지 두 카드가 각자 역할 셋을
    //    리터럴로 들고 판정했다(그래서 같은 목록이 세 벌이었다). 기타건 상세가 이미
    //    쓰는 모양 그대로다 — 서버가 계산해 내려주고 화면은 받기만 한다.
    //    🔴 요청을 실제로 받는 mutation(requestRepairCaseApproval)과 **같은 열쇠**여야
    //    한다. 갈리는 날 「단추는 보이는데 눌러도 거절」이 되고, 그 반대는 아무 표시도
    //    남기지 않아 더 나쁘다.
    //    🔵 **탭에 들어오는 문턱(위 canOpenRepairCaseDetailTab)은 읽기다.** 요청을 못
    //    하는 사람도 이 화면은 본다 — 결재 알림 종이 여기를 가리키고, 결재만 하는
    //    사람도 여기서 누른다.
    actingUser
      ? hasPermission(actingUser, "repairCases.approval", "WRITE")
      : Promise.resolve(false),
  ]);

  // 결재선을 그리는 데 필요한 단계들. 🔴 「현재 판」이 아니라 **각 줄에 적힌
  // 판**으로 읽는다 — 진행 중인 건은 관리자가 절차를 바꿔도 옛 판을 끝까지
  // 따라가므로, 현재 판으로 세면 「2/2단계」가 「2/4단계」로 보인다. 이력에는
  // 서로 다른 판을 탄 줄이 섞여 있어서, 지금 요청 행과 이력의 모든 행이 가리키는
  // 판을 한 번에 모아 **질의 한 번**으로 읽는다(줄마다 읽으면 N+1 이 된다).
  //
  // 서버에서 읽어 내려보내는 것은 decideAuthorization 과 같은 이유다
  // (클라이언트가 DB 를 읽게 두지 않는다).
  const shipmentRecord = currentApprovals.find((a) => a.approvalType === "FINAL_SHIPMENT")?.latest ?? null;
  const routeIds = [shipmentRecord, ...history]
    .map((row) => row?.routeId ?? null)
    .filter((routeId): routeId is string => routeId !== null);
  // 🔴 Map 이 아니라 배열이다 — 이 값은 클라이언트 컴포넌트(승인 카드)까지
  // 내려가는데 Map 은 그 경계를 넘지 못한다.
  const routeSteps = await listShipmentApprovalRouteSteps(routeIds);

  return (
    <DatabaseApprovalScreen
      resolved={resolved}
      actingUser={actingUser}
      currentApprovals={currentApprovals}
      history={history}
      decideAuthorization={decideAuthorization}
      routeSteps={routeSteps}
      actingApproverUserIds={actingApproverUserIds}
      canRequestApproval={canRequestApproval}
      // 역할 이름표는 화면에 보여 줄 **값**이라 승격하지 않는다 — 개발자
      // 표시가 켜져 있어도 그 사람의 역할은 그대로다(developer-promotion.ts).
      inspectionAssigneeCandidates={inspectionAssignees.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        roleLabel: roleLabels[candidate.role as Role],
      }))}
    />
  );
}
