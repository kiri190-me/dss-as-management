import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import DiagnosisFlowchartManagementScreen from "@/components/diagnosis-flowcharts/DiagnosisFlowchartManagementScreen";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { listRepairCaseFlowchartsForManagement, listDeletedRepairCaseFlowchartsForManagement } from "@/lib/db/queries/repair-case-flowcharts";
import { listRepairCasesForFlowchartCreateSelector } from "@/lib/db/queries/repair-cases";
import {
  canViewRepairCaseFlowcharts,
  canManageRepairCaseFlowchartsGlobally,
  canPermanentlyDeleteRepairCaseFlowchart,
} from "@/lib/auth/repair-case-flowchart-authorization";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";

export const metadata: Metadata = {
  title: "진단 Flowchart 관리 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * Checkpoint 2 — central, cross-case list of existing Case Diagnosis
 * Flowcharts (repair_case_flowcharts + nodes/edges/history are unchanged;
 * this page aggregates, it never creates a second storage system). Same
 * "database mode only" gate as the per-case diagnosis editor route
 * (/repair-cases/[id]/diagnosis/[flowchartId]) — case flowcharts have no
 * meaning under the mock/local read source. Reuses the existing
 * canViewRepairCaseFlowcharts policy unchanged (all 5 roles) for read
 * access.
 *
 * Checkpoint 3A adds create/delete: canManage is a server-derived UX hint
 * only (canManageRepairCaseFlowchartsGlobally — SUPER_ADMIN/ADMIN/
 * AS_ENGINEER, matching the same rule the per-case editor and every graph
 * mutation independently re-check) — SALES/INVENTORY_MANAGER never see the
 * controls, and every actual create/delete server action re-verifies
 * authorization (plus the target case's real lock state) itself regardless
 * of this hint. repairCaseOptions is the target-case selector's own
 * minimal-column list (listRepairCasesForFlowchartCreateSelector) — fetched
 * unconditionally so the JSX stays simple; the screen itself only renders
 * the create control at all when canManage is true.
 *
 * Checkpoint 3B adds the 휴지통 (trash) tab: trashRows is fetched
 * unconditionally for all 5 viewing roles (same small-dataset assumption as
 * rows/repairCaseOptions) — SALES/INVENTORY_MANAGER can see the trash list,
 * just not the restore control (screen-level canManage gate, re-verified
 * server-side by restoreRepairCaseFlowchartAction regardless).
 *
 * This checkpoint adds permanent delete: canPermanentlyDelete is a
 * separate, NARROWER server-derived hint (SUPER_ADMIN/ADMIN only, never
 * AS_ENGINEER — unlike canManage) — re-verified server-side by
 * permanentlyDeleteRepairCaseFlowchartAction regardless of this hint.
 */
export default async function DiagnosisFlowchartsPage() {
  // 역할별 접근 권한(사용자 관리 > 역할별 접근 권한)에서 이 메뉴가 꺼져 있으면
  // 주소를 직접 입력해도 들어올 수 없다 — 사이드바에서 감추는 것만으로는
  // 막은 것이 아니다.
  await requireAreaAccessForCurrentUser("diagnosisFlowcharts");

  if (getAuthSource() !== "database") {
    return <PlaceholderPage title="진단 Flowchart 관리" description="이 화면은 데이터베이스 저장 모드에서만 사용할 수 있습니다." />;
  }

  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  if (!canViewRepairCaseFlowcharts(actingUser.role)) {
    return <PlaceholderPage title="진단 Flowchart 관리" description="이 화면에 접근할 권한이 없습니다." />;
  }

  const canManage = canManageRepairCaseFlowchartsGlobally(actingUser.role);
  const canPermanentlyDelete = canPermanentlyDeleteRepairCaseFlowchart(actingUser.role);
  const [rows, trashRows, repairCaseOptions] = await Promise.all([
    listRepairCaseFlowchartsForManagement(),
    listDeletedRepairCaseFlowchartsForManagement(),
    canManage ? listRepairCasesForFlowchartCreateSelector() : Promise.resolve([]),
  ]);

  return (
    <DiagnosisFlowchartManagementScreen
      rows={rows}
      trashRows={trashRows}
      repairCaseOptions={repairCaseOptions}
      canManage={canManage}
      canPermanentlyDelete={canPermanentlyDelete}
    />
  );
}
