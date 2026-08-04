import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { mockUsers } from "@/lib/domain/mock-data";
import { isLocalId } from "@/lib/domain/local/local-types";
import { resolveAllRepairCases, resolveMockRepairCaseById } from "@/lib/domain/local/resolved-repair-case";
import { findProductHistoryMatches } from "@/lib/domain/local/product-history-match";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import RepairCaseDetailView from "@/components/repair-cases/detail/RepairCaseDetailView";
import LocalRepairCaseDetailContent from "@/components/repair-cases/detail/LocalRepairCaseDetailContent";

export const metadata: Metadata = {
  title: "A/S 상세 | DSS A/S 관리 시스템",
};

export default async function RepairCaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Stage E-1 워크플로 제어판이 처리 주체(actingUser)를 필요로 하므로
  // approval/files 페이지와 동일한 기존 readSession 패턴을 그대로 재사용한다.
  const session = await readSession();
  if (!session) {
    redirect("/login");
  }

  const currentMockUser = mockUsers.find((u) => u.id === session.userId);
  const actingUser: ActingUser | null = currentMockUser
    ? {
        id: currentMockUser.id,
        name: currentMockUser.name,
        role: currentMockUser.role,
        approvalStatus: currentMockUser.approvalStatus,
      }
    : null;

  if (isLocalId(id)) {
    return <LocalRepairCaseDetailContent id={id} actingUser={actingUser} />;
  }

  const resolved = resolveMockRepairCaseById(id);

  // 이 지점에 도달했다면 상위 layout.tsx가 이미 존재를 확인했으므로 resolved는
  // 항상 존재해야 한다. 방어적으로만 남겨둔다.
  if (!resolved) {
    notFound();
  }

  // 서버 컴포넌트이므로 로컬 데이터에 접근할 수 없다 — mock 전용 병합 목록으로
  // 과거 이력을 조회한다(mock-to-mock은 productId로 매칭되므로 결과는 기존과
  // 동일하다).
  const related = findProductHistoryMatches(resolveAllRepairCases([]), resolved);

  return <RepairCaseDetailView resolved={resolved} related={related} actingUser={actingUser} />;
}
