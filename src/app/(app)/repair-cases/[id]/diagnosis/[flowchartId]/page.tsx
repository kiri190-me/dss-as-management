import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { getRepairCaseFlowchartPageContext } from "@/lib/db/queries/repair-case-flowcharts";
import { getRepairCaseFlowchartGraph } from "@/lib/db/queries/repair-case-flowchart-graph";
import { hasPermission, roleOnlyActor } from "@/lib/auth/permission-resolver";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { canOpenRepairCaseDetailTab } from "@/lib/auth/repair-case-detail-tab-access";
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

  if (getAuthSource() !== "database") {
    return <p className="p-6 text-sm text-zinc-500 dark:text-zinc-400">진단 Flowchart는 데이터베이스 저장 모드에서만 사용할 수 있습니다.</p>;
  }

  const resolved = await resolveRepairCaseForServer(id);
  if (!resolved) notFound();

  const session = await readSession();

  /**
   * 🔴 **「진단 Flowchart」 탭에 못 들어가는 사람은 여기도 못 들어온다**(2026-11-12).
   * 이 주소는 그 탭의 자식이라, 탭만 막고 자식을 두면 흐름도 주소를 직접 쳐서 그대로
   * 들어와진다 — 가린 것이 아니다. 레이아웃·탭 화면과 **같은 창구·같은 열쇠**를
   * 부른다(`auth/repair-case-detail-tab-access.ts` → `diagnosisFlowcharts.view`).
   *
   * 🔴 **그래프 조회보다 위**다 — 막을 사람의 자료를 읽을 까닭이 없다.
   * 아래 `canEdit`(`diagnosisFlowcharts.edit`)는 **그대로 둔다**: 들어오는 열쇠와
   * 고치는 열쇠는 같은 메뉴의 다른 잎이다.
   */
  const actingUser = session ? await resolveActingUserForSession(session) : null;
  if (!(await canOpenRepairCaseDetailTab(actingUser, "diagnosis"))) notFound();

  const graph = await getRepairCaseFlowchartGraph({ repairCaseId: id, flowchartId });
  if (!graph) notFound();

  const pageContext = await getRepairCaseFlowchartPageContext(id);
  const canEdit =
    !!session &&
    session.approvalStatus === "APPROVED" &&
    !!pageContext &&
    // 이 화면은 살아 있는 행위자(ActingUser)를 손에 들고 있지 않다 — 세션 토큰의
    // role/approvalStatus만 본다. 그래서 개발자 승격이 여기까지 닿지 않는다
    // (roleOnlyActor = 승격 없음). 닫히는 쪽으로 실패하는 선택이다: 개발자가
    // 이 단추를 못 볼 뿐, 남에게 권한이 새지는 않는다. 고치려면 세 화면을
    // resolveActingUserForSession 으로 옮겨야 하고, 그것은 이 조각의 범위가 아니다.
    (await hasPermission(roleOnlyActor(session.role), "diagnosisFlowcharts.edit", "WRITE"));

  return <CaseFlowchartEditorScreen repairCaseId={id} flowchart={graph.flowchart} nodes={graph.nodes} edges={graph.edges} canEdit={canEdit} />;
}
