import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocalId } from "@/lib/domain/local/local-types";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { listRepairCaseFlowcharts, getRepairCaseFlowchartPageContext } from "@/lib/db/queries/repair-case-flowcharts";
import { canMutateRepairCaseFlowchart } from "@/lib/auth/repair-case-flowchart-authorization";
import CaseFlowchartListScreen from "@/components/repair-cases/flowchart/CaseFlowchartListScreen";

export const metadata: Metadata = {
  title: "진단 Flowchart | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * Phase 5C-6D — minimal list/create access point for case-owned diagnostic
 * flowcharts. Database-mode only (case-flowchart storage has no mock/local
 * equivalent) — a local- id or a non-database read source shows a plain
 * "지원되지 않음" notice rather than attempting to resolve non-existent
 * mock data. canEdit is derived server-side from session role + repair-
 * case assignment/lock and passed down as a UX hint only — every mutation
 * the client calls independently re-verifies authority.
 */
export default async function CaseFlowchartListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (isLocalId(id) || getAuthSource() !== "database") {
    return <p className="p-6 text-sm text-zinc-500 dark:text-zinc-400">진단 Flowchart는 데이터베이스 저장 모드에서만 사용할 수 있습니다.</p>;
  }

  const resolved = await resolveRepairCaseForServer(id);
  if (!resolved) notFound();

  const session = await readSession();
  const pageContext = await getRepairCaseFlowchartPageContext(id);
  const canEdit =
    !!session &&
    session.approvalStatus === "APPROVED" &&
    !!pageContext &&
    canMutateRepairCaseFlowchart(session.role, { isCaseLocked: pageContext.isLocked });

  const flowcharts = await listRepairCaseFlowcharts(id);

  return <CaseFlowchartListScreen repairCaseId={id} flowcharts={flowcharts} canEdit={canEdit} />;
}
