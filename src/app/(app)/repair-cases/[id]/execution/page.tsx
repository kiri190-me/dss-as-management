import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { isLocalId } from "@/lib/domain/local/local-types";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import LocalRepairCaseExecutionContent, {
  NonDatabaseWorkContent,
} from "@/components/repair-cases/detail/LocalRepairCaseExecutionContent";
import DatabaseWorkflowControlPanel from "@/components/repair-cases/workflow/DatabaseWorkflowControlPanel";
import DatabaseWorkflowHistoryList from "@/components/repair-cases/workflow/DatabaseWorkflowHistoryList";
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
import { getRecentWorkRecordsForCase, getWorkRecordCaseContext } from "@/lib/db/queries/repair-case-work-records";
import { canCreateWorkRecord, canInvalidateWorkRecord } from "@/lib/auth/repair-case-work-record-authorization";
import { workflowSteps } from "@/lib/domain/mock-data";

export const metadata: Metadata = {
  title: "작업내용 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * Phase 5C-1 — "작업내용" tab (URL unchanged: /repair-cases/[id]/execution,
 * see DetailTabs.tsx for the visible-label-only rename). This screen now
 * owns both the workflow-transition action list (moved off 기본 정보 —
 * DatabaseWorkflowControlPanel / local WorkflowControlPanel, plus the
 * workflowHistory/holdState/currentApprovals fetch that used to live in
 * [id]/page.tsx) and the existing Phase 5A procedure-execution UI.
 *
 * The procedure-execution feature itself remains database-mode only (see
 * ProcedureExecutionScreen/DatabaseModeOnlyNotice) — that Phase 5A
 * constraint is unchanged by this restructuring.
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

  if (isLocalId(id)) {
    return <LocalRepairCaseExecutionContent id={id} actingUser={actingUser} />;
  }

  const resolved = await resolveRepairCaseForServer(id);
  if (!resolved) {
    notFound();
  }

  if (resolved.source !== "DATABASE") {
    return <NonDatabaseWorkContent resolved={resolved} actingUser={actingUser} />;
  }

  if (!actingUser) {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
        현재 로그인한 사용자 정보를 확인할 수 없습니다.
      </p>
    );
  }

  const [workflowHistory, currentApprovals, activeExecution, recentWorkRecords, workRecordCaseContext] = await Promise.all([
    getWorkflowHistoryForCase(resolved.id),
    getCurrentApprovalsForCase(resolved.id),
    getActiveExecutionForCase(resolved.id),
    getRecentWorkRecordsForCase(resolved.id, 5),
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
  const canCreate = canCreateWorkRecord(actingUser.role, { isAssignedToCase, isCaseLocked });
  const canInvalidate = canInvalidateWorkRecord(actingUser.role, { isCaseLocked });
  const createDisabledReason = isCaseLocked
    ? "잠금된 접수 건입니다. 이 작업을 수행할 수 없습니다."
    : !canCreate
      ? "담당 엔지니어 또는 관리자만 작업 기록을 작성할 수 있습니다."
      : null;
  const currentStep = workflowSteps.find((s) => s.workflowType === resolved.workflowType && s.key === resolved.currentWorkflowStepKey);

  return (
    <div className="flex flex-col gap-4">
      <DatabaseWorkflowControlPanel
        resolved={resolved}
        actingUser={actingUser}
        holdState={holdState}
        currentApprovals={currentApprovals}
        isCaseLocked={isCaseLocked}
      />

      <WorkRecordsSection
        repairCaseId={resolved.id}
        currentStepLabel={currentStep?.label ?? resolved.currentWorkflowStepKey}
        currentStepOrder={currentStep?.order ?? null}
        inProgressNodes={inProgressNodes}
        createDisabledReason={createDisabledReason}
        canInvalidate={canInvalidate}
        recentRecords={recentWorkRecords}
      />

      {procedureScreen}

      <details>
        <summary className="cursor-pointer text-sm font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50">
          워크플로 변경 이력
        </summary>
        <div className="mt-2">
          <DatabaseWorkflowHistoryList entries={workflowHistory} />
        </div>
      </details>
    </div>
  );
}
