import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { isLocalId } from "@/lib/domain/local/local-types";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import ApprovalScreen from "@/components/repair-cases/approval/ApprovalScreen";
import DatabaseApprovalScreen from "@/components/repair-cases/approval/DatabaseApprovalScreen";
import LocalApprovalContent from "@/components/repair-cases/approval/LocalApprovalContent";
import { getCurrentApprovalsForCase, getApprovalHistoryForCase } from "@/lib/db/queries/repair-case-approvals";
import { isUserShipmentRepresentative } from "@/lib/db/queries/users";

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

  if (isLocalId(id)) {
    return <LocalApprovalContent id={id} actingUser={actingUser} />;
  }

  const resolved = await resolveRepairCaseForServer(id);
  // 이 지점에 도달했다면 상위 layout.tsx가 이미 존재를 확인했으므로 resolved는
  // 항상 존재해야 한다. 방어적으로만 남겨둔다.
  if (!resolved) {
    notFound();
  }

  if (resolved.source === "DATABASE") {
    const [currentApprovals, history, isRepresentative] = await Promise.all([
      getCurrentApprovalsForCase(resolved.id),
      getApprovalHistoryForCase(resolved.id),
      actingUser ? isUserShipmentRepresentative(actingUser.id) : Promise.resolve(false),
    ]);
    return (
      <DatabaseApprovalScreen
        resolved={resolved}
        actingUser={actingUser}
        currentApprovals={currentApprovals}
        history={history}
        isRepresentative={isRepresentative}
      />
    );
  }

  return <ApprovalScreen resolved={resolved} actingUser={actingUser} />;
}
