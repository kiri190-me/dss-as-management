import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { isLocalId } from "@/lib/domain/local/local-types";
import { resolveAllRepairCases } from "@/lib/domain/local/resolved-repair-case";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import { findProductHistoryMatches } from "@/lib/domain/local/product-history-match";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import { getIntakeReferenceData } from "@/lib/db/queries/repair-case-references";
import { getPartList } from "@/lib/db/queries/inventory";
import { getRequestCaseContext, getOwnPartRequestsForCase } from "@/lib/db/queries/inventory-part-requests";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import RepairCaseDetailView from "@/components/repair-cases/detail/RepairCaseDetailView";
import LocalRepairCaseDetailContent from "@/components/repair-cases/detail/LocalRepairCaseDetailContent";

export const metadata: Metadata = {
  title: "A/S 상세 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

export default async function RepairCaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Section editing과 PartRequestSection이 처리 주체(actingUser)를 필요로
  // 하므로 approval/files 페이지와 동일한 기존 readSession 패턴을 그대로
  // 재사용한다(워크플로 제어 액션 자체는 Phase 5C-1부터 execution/page.tsx로
  // 이동했다).
  const session = await readSession();
  if (!session) {
    redirect("/login");
  }

  const actingUser: ActingUser | null = await resolveActingUserForSession(session);

  if (isLocalId(id)) {
    return <LocalRepairCaseDetailContent id={id} actingUser={actingUser} />;
  }

  const resolved = await resolveRepairCaseForServer(id);

  // 이 지점에 도달했다면 상위 layout.tsx가 이미 존재를 확인했으므로 resolved는
  // 항상 존재해야 한다(같은 요청 내에서는 cache()로 동일한 결과를 재사용한다).
  // 방어적으로만 남겨둔다.
  if (!resolved) {
    notFound();
  }

  // 서버 컴포넌트이므로 로컬 데이터에 접근할 수 없다 — mock 전용 병합 목록으로
  // 과거 이력을 조회한다(mock-to-mock은 productId로 매칭되므로 결과는 기존과
  // 동일하다). DATABASE 소스 건은 정규화 3필드(Model+L/N+S/N) 비교로 대체
  // 매칭된다(product-history-match.ts의 기존 폴백 경로, 이 배치에서 변경하지
  // 않음).
  const related = findProductHistoryMatches(resolveAllRepairCases([]), resolved);

  // Section editing only ever targets a DATABASE-sourced row (the update
  // Server Action itself independently re-checks both this and the write-
  // source flag) — only fetch the real customer/End-User/engineer option
  // lists when both conditions actually hold, same gating IntakeForm's
  // create path already uses.
  const writeSource = getRepairCaseWriteSource();
  const isDatabaseBacked = resolved.source === "DATABASE" && writeSource === "database";
  const referenceData = isDatabaseBacked ? await getIntakeReferenceData() : null;

  // Phase 5B-3 부품 요청 section — AS_ENGINEER only, DATABASE-backed cases
  // only (the request tables have no local/mock equivalent). Fetched here
  // (not inside the section itself) so an unauthorized/ineligible role
  // never even receives the query results — a UX convenience only, the
  // mutation layer re-checks assignment/lock independently regardless.
  const partRequestData =
    isDatabaseBacked && actingUser?.role === "AS_ENGINEER"
      ? {
          caseContext: await getRequestCaseContext(resolved.id),
          availableParts: await getPartList(),
          ownRequests: await getOwnPartRequestsForCase(resolved.id, actingUser.id),
        }
      : null;

  return (
    <RepairCaseDetailView
      resolved={resolved}
      related={related}
      actingUser={actingUser}
      referenceData={referenceData}
      partRequestData={partRequestData}
    />
  );
}
