import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocalId } from "@/lib/domain/local/local-types";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { getRepairCaseFlowchartPageContext } from "@/lib/db/queries/repair-case-flowcharts";
import { getRepairCaseFlowchartGraph } from "@/lib/db/queries/repair-case-flowchart-graph";
import { hasPermission } from "@/lib/auth/permission-resolver";
import CaseFlowchartEditorScreen from "@/components/repair-cases/flowchart/CaseFlowchartEditorScreen";

export const metadata: Metadata = {
  title: "진단 Flowchart 편집 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * Phase 5C-6D — direct case-flowchart graph editor route
 * (/repair-cases/[id]/diagnosis/[flowchartId]), for development/manual
 * verification. NOT yet the final Repair Case tab integration (no
 * DetailTabs nav entry) — see the 6D plan's own §12. Uses the existing
 * 6C getRepairCaseFlowchartGraph query and the 6B page-context query
 * exclusively; canEdit is a server-derived UX hint only, never trusted by
 * the mutation layer.
 */
export default async function CaseFlowchartEditorPage({ params }: { params: Promise<{ id: string; flowchartId: string }> }) {
  const { id, flowchartId } = await params;

  if (isLocalId(id) || getAuthSource() !== "database") {
    return <p className="p-6 text-sm text-zinc-500 dark:text-zinc-400">진단 Flowchart는 데이터베이스 저장 모드에서만 사용할 수 있습니다.</p>;
  }

  const resolved = await resolveRepairCaseForServer(id);
  if (!resolved) notFound();

  const graph = await getRepairCaseFlowchartGraph({ repairCaseId: id, flowchartId });
  if (!graph) notFound();

  const session = await readSession();
  const pageContext = await getRepairCaseFlowchartPageContext(id);
  const canEdit =
    !!session &&
    session.approvalStatus === "APPROVED" &&
    !!pageContext &&
    (await hasPermission(session.role, "diagnosisFlowcharts.edit", "WRITE"));

  return <CaseFlowchartEditorScreen repairCaseId={id} flowchart={graph.flowchart} nodes={graph.nodes} edges={graph.edges} canEdit={canEdit} />;
}
