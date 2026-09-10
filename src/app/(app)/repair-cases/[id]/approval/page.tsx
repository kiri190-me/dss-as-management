import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import DatabaseApprovalScreen from "@/components/repair-cases/approval/DatabaseApprovalScreen";
import {
  getCurrentApprovalsForCase,
  getApprovalHistoryForCase,
  listInspectionApproverCandidates,
} from "@/lib/db/queries/repair-case-approvals";
import { resolveShipmentDecideAuthorization } from "@/lib/db/queries/shipment-delegations";
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

  // 읽기 소스에서 mock이 사라진 뒤로 모든 수리 건은 항상 DATABASE로 해석되므로
  // 검수/승인 화면은 DB 판 한 벌만 그린다(데모판 분기는 제거했다).
  // 「누구에게 보낼까요」 후보도 여기서 계산해 내려보낸다 — 자격 판정(역할
  // 목록 + 개발자 승격 + 계정 상태)은 요청을 실제로 받는 mutation과 **같은
  // 목록·같은 함수**를 써야 하고, 그것은 서버에만 있다. 클라이언트가 사용자
  // 표를 읽어 스스로 거르게 두면 두 판정이 갈라진다(decideAuthorization을
  // 서버에서 계산해 내려보내는 것과 같은 이유다).
  const [currentApprovals, history, decideAuthorization, inspectionAssignees] = await Promise.all([
    getCurrentApprovalsForCase(resolved.id),
    getApprovalHistoryForCase(resolved.id),
    actingUser ? resolveShipmentDecideAuthorization(actingUser.id) : Promise.resolve({ allowed: false as const }),
    listInspectionApproverCandidates(),
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
