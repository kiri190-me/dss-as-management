import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import DatabaseWorkflowControlPanel from "@/components/repair-cases/workflow/DatabaseWorkflowControlPanel";
import ManualStepSetPanel from "@/components/repair-cases/workflow/ManualStepSetPanel";
import ProcedureExecutionScreen from "@/components/procedures/execution/ProcedureExecutionScreen";
import WorkRecordsSection from "@/components/repair-cases/work-records/WorkRecordsSection";
import { deriveCurrentHoldState, getWorkflowHistoryForCase } from "@/lib/db/queries/workflow-history";
import { getCurrentApprovalsForCase } from "@/lib/db/queries/repair-case-approvals";
import {
  getActiveExecutionForCase,
  getExecutionDetail,
  getExecutionHistory,
  getExecutableTemplateOptions,
  getRelatedRepairHistory,
} from "@/lib/db/queries/procedure-case-execution";
import { getWorkRecordCaseContext } from "@/lib/db/queries/repair-case-work-records";
import { workRecordRequiresOwnAssignment } from "@/lib/auth/repair-case-work-record-authorization";
import { hasPermission } from "@/lib/auth/permission-resolver";
import {
  listManuallySelectableStepsFromRules,
  loadWorkflowRulesForCase,
  toWorkflowRulesDto,
} from "@/lib/db/queries/workflow-rules";
import { db } from "@/lib/db/client";

export const metadata: Metadata = {
  title: "작업내용 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * Phase 5C-1 — "작업내용" tab (URL unchanged: /repair-cases/[id]/execution,
 * see DetailTabs.tsx for the visible-label-only rename). This screen owns
 * both the workflow-transition action list (moved off 기본 정보 —
 * DatabaseWorkflowControlPanel, plus the workflowHistory/holdState/
 * currentApprovals fetch that used to live in [id]/page.tsx) and the
 * existing Phase 5A procedure-execution UI.
 *
 * resolveRepairCaseForServer only ever yields a DATABASE-sourced case (or
 * null) — the demo read sources are gone — so this screen has a single
 * body, no source branch.
 */
export default async function RepairCaseExecutionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await readSession();
  if (!session) {
    redirect("/login");
  }

  const actingUser: ActingUser | null = await resolveActingUserForSession(session);

  const resolved = await resolveRepairCaseForServer(id);
  if (!resolved) {
    notFound();
  }

  if (!actingUser) {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
        현재 로그인한 사용자 정보를 확인할 수 없습니다.
      </p>
    );
  }

  // workflowHistory는 화면에 그리지 않는다(워크플로 변경 이력 구역은 이 탭에서
  // 없앴고, 작업 이력 탭이 그린다) — 여기서는 아래 deriveCurrentHoldState의
  // 입력으로만 쓴다. 그 결과(holdState)는 패널 둘이 함께 본다.
  const [workflowHistory, currentApprovals, activeExecution, workRecordCaseContext] = await Promise.all([
    getWorkflowHistoryForCase(resolved.id),
    getCurrentApprovalsForCase(resolved.id),
    getActiveExecutionForCase(resolved.id),
    getWorkRecordCaseContext(resolved.id),
  ]);
  const holdState = deriveCurrentHoldState(workflowHistory);
  const isCaseLocked = workRecordCaseContext?.isLocked ?? true;

  let procedureScreen: React.ReactNode;
  let inProgressNodes: { id: string; title: string }[] = [];
  if (!activeExecution) {
    const templateOptions = await getExecutableTemplateOptions();
    procedureScreen = (
      <ProcedureExecutionScreen
        repairCaseId={resolved.id}
        actingUser={actingUser}
        activeExecution={null}
        templateOptions={templateOptions}
        executionDetail={null}
        history={[]}
        relatedHistory={{ sameProduct: [], sameModelReference: [] }}
      />
    );
  } else {
    const [executionDetail, history, relatedHistory] = await Promise.all([
      getExecutionDetail(activeExecution.id),
      getExecutionHistory(activeExecution.id),
      resolved.productId
        ? getRelatedRepairHistory(resolved.id, resolved.productId)
        : Promise.resolve({ sameProduct: [], sameModelReference: [] }),
    ]);
    procedureScreen = (
      <ProcedureExecutionScreen
        repairCaseId={resolved.id}
        actingUser={actingUser}
        activeExecution={activeExecution}
        templateOptions={[]}
        executionDetail={executionDetail}
        history={history}
        relatedHistory={relatedHistory}
      />
    );
    inProgressNodes = executionDetail
      ? executionDetail.nodes.filter((n) => n.status === "IN_PROGRESS").map((n) => ({ id: n.id, title: n.title }))
      : [];
  }

  const isAssignedToCase = resolved.assignedEngineerId === actingUser.id;
  const canCreate =
    (!workRecordRequiresOwnAssignment(actingUser.role) || isAssignedToCase) &&
    (await hasPermission(actingUser.role, "repairCases.workRecords", "WRITE"));
  // 무효화 권한 판정은 이 화면에 없다 — 무효화가 작업 이력 탭으로 옮겨 갔고,
  // 같은 판정을 work-history/page.tsx가 그대로 한다.
  void isCaseLocked;
  // Shipment-lock removal policy: isCaseLocked is still fed into
  // DatabaseWorkflowControlPanel below (workflow-transition gating is
  // unchanged, a separate concern from work-record editing — see this
  // checkpoint's audit report), but no longer determines this message,
  // since canCreateWorkRecord itself no longer factors in lock state.
  const createDisabledReason = !canCreate ? "담당 엔지니어 또는 관리자만 작업 기록을 작성할 수 있습니다." : null;
  /**
   * Phase 2d: 이 화면의 워크플로 관련 표시는 전부 DB에서 읽은 규칙을 쓴다.
   * 예전에는 mock-data의 단계 표와 manual-step-options.ts(TS, 지금은 삭제됨)를
   * 봤는데, 서버 판정이 DB로 옮겨간 뒤에도 화면만 옛 표를 보면 "버튼은 눌리는데
   * 서버가 거부한다"가 된다 — 유·무상 작업에서 실제로 겪은 증상이다.
   */
  const workflowRules = await loadWorkflowRulesForCase(db, resolved.id);
  if (!workflowRules) notFound();
  const currentStep = workflowRules.steps.find((s) => s.key === resolved.currentWorkflowStepKey);
  // 단계 직접 변경 후보. 승인 게이트가 걸린 단계는 여기서 이미 빠진다 —
  // 서버(mutation)도 같은 함수로 다시 검증하므로 이 목록은 표시용이다.
  const manualStepOptions = listManuallySelectableStepsFromRules(workflowRules);

  return (
    <div className="flex flex-col gap-4">
      <DatabaseWorkflowControlPanel
        resolved={resolved}
        actingUser={actingUser}
        holdState={holdState}
        currentApprovals={currentApprovals}
        isCaseLocked={isCaseLocked}
        rules={toWorkflowRulesDto(workflowRules)}
      />

      {/* 실행 가능 작업(위)은 그대로 두고, 규칙을 우회하는 직접 변경은 별도
          섹션으로 분리해 나란히 놓는다 — 두 경로가 화면에서 섞이면 안 된다는
          요구(2026-08-18)에 따른 배치다. */}
      <ManualStepSetPanel
        repairCaseId={resolved.id}
        version={resolved.version}
        currentStepKey={resolved.currentWorkflowStepKey}
        options={manualStepOptions}
        actingUser={actingUser}
        assignedEngineerId={resolved.assignedEngineerId}
        holdState={{
          isOnHold: holdState.isOnHold,
          reason: holdState.reason,
          startedByUserId: holdState.startedByUserId,
          startedByNameSnapshot: holdState.startedByName,
          startedAt: holdState.startedAt,
        }}
        isCaseLocked={isCaseLocked}
      />

      <WorkRecordsSection
        repairCaseId={resolved.id}
        currentStepLabel={currentStep?.label ?? resolved.currentWorkflowStepKey}
        currentStepOrder={currentStep?.order ?? null}
        inProgressNodes={inProgressNodes}
        createDisabledReason={createDisabledReason}
      />

      {procedureScreen}
    </div>
  );
}
