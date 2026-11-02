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
import { pickCurrentTaskNode } from "@/lib/domain/procedure-execution-focus";
import {
  buildWorkRecordProcedureLink,
  type WorkRecordProcedureLink,
} from "@/lib/domain/procedure-execution-work-record-link";
import { workRecordRequiresOwnAssignment } from "@/lib/auth/repair-case-work-record-authorization";
import { actorMay } from "@/lib/auth/developer-promotion";
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
  // 작업 기록을 붙일 절차 항목들과, 처음 골라져 있을 것. 빈 실행에서는 둘 다
  // 비어 있고, 그때 폼은 드롭다운 자체를 안 그린다.
  let procedureLink: WorkRecordProcedureLink = { options: [], defaultNodeId: null };
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
    // 🔵 끝낸 실행에서는 **불러올 수 있는 절차 목록도 함께** 읽는다 — 끝낸 뒤
    // 화면에 「+ 기술 절차 불러오기」가 다시 서기 때문이다. 아직 도는 실행에서는
    // 그 카드가 안 서므로 목록을 읽지 않는다(쓰지도 않을 조회를 매번 하지 않게).
    const [executionDetail, history, relatedHistory, templateOptions] = await Promise.all([
      getExecutionDetail(activeExecution.id),
      getExecutionHistory(activeExecution.id),
      resolved.productId
        ? getRelatedRepairHistory(resolved.id, resolved.productId)
        : Promise.resolve({ sameProduct: [], sameModelReference: [] }),
      activeExecution.completedAt ? getExecutableTemplateOptions() : Promise.resolve([]),
    ]);
    procedureScreen = (
      <ProcedureExecutionScreen
        repairCaseId={resolved.id}
        actingUser={actingUser}
        activeExecution={activeExecution}
        templateOptions={templateOptions}
        executionDetail={executionDetail}
        history={history}
        relatedHistory={relatedHistory}
      />
    );
    // 🔴 「지금 할 일」을 여기서 다시 고르지 않는다 — 실행 화면이 쓰는 것과
    // **같은 함수**(pickCurrentTaskNode)로, **같은 인자**로 고른다. 두 벌로
    // 두면 큰 카드에는 7번이 서 있는데 작업 기록은 8번에 붙는 날이 온다.
    //
    // 🔵 마친 실행에서는 고르는 것이 없다 → 기본값이 「연결 안 함」이 된다.
    // 붙일 항목 목록 자체는 그대로 남으므로, 마친 뒤에 적는 기록도 손으로
    // 골라 붙일 수 있다.
    if (executionDetail) {
      const currentTaskNode = pickCurrentTaskNode(executionDetail.nodes, {
        isExecutionFinished: executionDetail.completedAt !== null,
      });
      procedureLink = buildWorkRecordProcedureLink({
        nodes: executionDetail.nodes,
        currentTaskNodeId: currentTaskNode?.id ?? null,
      });
    }
  }

  const isAssignedToCase = resolved.assignedEngineerId === actingUser.id;
  // ⚠️ 서버(db/mutations/repair-case-work-records.ts)가 **같은 판정**을 한다 —
  // 한쪽만 승격하면 「보이는데 저장은 거절」 또는 「안 보이는데 서버는 허용」이
  // 된다. 승격은 「담당을 요구하는가」라는 역할 축에만 더하고, 배정 사실
  // (isAssignedToCase)은 그대로 둔다.
  const canCreate =
    actorMay(actingUser, (role) => !workRecordRequiresOwnAssignment(role) || isAssignedToCase) &&
    (await hasPermission(actingUser, "repairCases.workRecords", "WRITE"));
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
        procedureNodeOptions={procedureLink.options}
        defaultProcedureNodeId={procedureLink.defaultNodeId}
        createDisabledReason={createDisabledReason}
      />

      {procedureScreen}
    </div>
  );
}
