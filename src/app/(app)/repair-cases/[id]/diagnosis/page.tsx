import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { listRepairCaseFlowcharts, getRepairCaseFlowchartPageContext } from "@/lib/db/queries/repair-case-flowcharts";
import { getWorkRecordHistoryForCase } from "@/lib/db/queries/repair-case-work-records";
import { buildWorkRecordFlowchart, WORK_RECORD_FLOWCHART_MAX_RECORDS } from "@/lib/domain/work-record-flowchart";
import { hasPermission } from "@/lib/auth/permission-resolver";
import CaseFlowchartListScreen from "@/components/repair-cases/flowchart/CaseFlowchartListScreen";

export const metadata: Metadata = {
  title: "진단 Flowchart | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * Phase 5C-6D — minimal list/create access point for case-owned diagnostic
 * flowcharts. Database-mode only (case-flowchart storage has no mock
 * equivalent) — a non-database read source shows a plain "지원되지 않음"
 * notice rather than attempting to resolve non-existent mock data.
 * canEdit is derived server-side from session role + repair-
 * case assignment/lock and passed down as a UX hint only — every mutation
 * the client calls independently re-verifies authority.
 *
 * 목록 맨 위의 「작업 기록 흐름도」 줄이 보이는지도 여기서 정한다. 목록 조각은
 * "use client" 라 DB 를 읽을 수 없으므로, 작업 기록을 읽어 실제로 그릴 칸이
 * 생기는지(buildWorkRecordFlowchart의 결과가 비지 않는지)까지 서버가 확인해
 * boolean 하나만 내려보낸다 — "기록이 몇 건 있다"가 아니라 "그릴 것이 있다"를
 * 판정해야 전부 무효 처리된 건에서 빈 화면으로 가는 링크가 뜨지 않는다.
 * 이 판정은 흐름도 목록을 보는 문턱과 같은 문턱 뒤에 있다(이 페이지에 도달한
 * 사람 = 저장된 흐름도 목록을 보는 사람) — 새 문턱을 만들지 않는다.
 */
export default async function CaseFlowchartListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (getAuthSource() !== "database") {
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
    (await hasPermission(session.role, "diagnosisFlowcharts.edit", "WRITE"));

  const [flowcharts, workRecords] = await Promise.all([
    listRepairCaseFlowcharts(id),
    getWorkRecordHistoryForCase(id, { limit: WORK_RECORD_FLOWCHART_MAX_RECORDS, offset: 0 }),
  ]);
  const hasWorkRecordFlowchart = buildWorkRecordFlowchart(workRecords.rows).nodes.length > 0;

  return (
    <CaseFlowchartListScreen repairCaseId={id} flowcharts={flowcharts} canEdit={canEdit} hasWorkRecordFlowchart={hasWorkRecordFlowchart} />
  );
}
