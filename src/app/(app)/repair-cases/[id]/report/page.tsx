import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { mockUsers } from "@/lib/domain/mock-data";
import { isLocalId } from "@/lib/domain/local/local-types";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import ReportScreen from "@/components/repair-cases/report/ReportScreen";
import LocalReportContent from "@/components/repair-cases/report/LocalReportContent";

export const metadata: Metadata = {
  title: "보고서 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

export default async function RepairCaseReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // approval/files/work-history page.tsx와 동일한 기존 인증 로직(readSession)을
  // 그대로 재사용한다. 상위 (app) 레이아웃이 이미 세션을 확인했으므로 여기
  // 도달했다면 정상적으로는 항상 세션이 존재하지만, 방어적으로 한 번 더
  // 확인한다. 이 스테이지는 새 쓰기 동작을 추가하지 않는다 — 보고서 생성자
  // 표시용으로만 최소 검증된 사용자 정보를 클라이언트에 넘긴다.
  const session = await readSession();
  if (!session) {
    redirect("/login");
  }

  const currentMockUser = mockUsers.find((u) => u.id === session.userId);
  // 클라이언트에는 최소한의 검증된 정보만 넘긴다(id/name/role/approvalStatus).
  // 세션 쿠키 자체나 원본 세션 payload를 내려보내지 않는다.
  const generatedByUser: ActingUser | null = currentMockUser
    ? {
        id: currentMockUser.id,
        name: currentMockUser.name,
        role: currentMockUser.role,
        approvalStatus: currentMockUser.approvalStatus,
      }
    : null;

  if (isLocalId(id)) {
    return <LocalReportContent repairCaseId={id} generatedByUser={generatedByUser} />;
  }

  const resolved = await resolveRepairCaseForServer(id);
  // 이 지점에 도달했다면 상위 layout.tsx가 이미 존재를 확인했으므로 resolved는
  // 항상 존재해야 한다. 방어적으로만 남겨둔다(실제 HTTP 404를 그대로 보존한다).
  if (!resolved) {
    notFound();
  }

  return <ReportScreen resolved={resolved} generatedByUser={generatedByUser} />;
}
