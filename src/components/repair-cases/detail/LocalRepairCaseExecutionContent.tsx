"use client";

import LoadingNotice from "@/components/domain/LoadingNotice";
import RepairCaseNotFound from "@/components/repair-cases/detail/RepairCaseNotFound";
import WorkflowControlPanel from "@/components/repair-cases/workflow/WorkflowControlPanel";
import WorkflowEventTimeline from "@/components/repair-cases/workflow/WorkflowEventTimeline";
import DatabaseModeOnlyNotice from "@/components/procedures/execution/DatabaseModeOnlyNotice";
import { useLocalRepairCases } from "@/lib/domain/local/use-local-repair-cases";
import { resolveRepairCaseById, type ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import { useEffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import { useWorkflowStore } from "@/lib/domain/local/workflow/use-workflow-data";
import { useApprovalStore } from "@/lib/domain/local/approval/use-approval-data";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";

/**
 * Phase 5C-1 — local/mock counterpart of the "작업내용" (/execution) screen,
 * mirroring the existing LocalRepairCaseDetailContent -> RepairCaseDetailView
 * split (existence gate here, effective-case computation in the inner
 * component, same as that pair does for 기본 정보).
 *
 * Local ids never reach procedure_case_executions (DB-only, Phase 5A —
 * unchanged: the "기술 절차" subsection still just shows
 * DatabaseModeOnlyNotice, no mock execution implementation is invented
 * here). The workflow-transition action list (WorkflowControlPanel, local
 * mode) previously lived on 기본 정보 and would otherwise be stranded with
 * nowhere to render once removed from there — this screen is its new home,
 * matching where DB-mode users now find the same actions.
 *
 * Phase 5C-2: repair_case_work_records has a real FK to repair_cases.id,
 * same DB-only limitation as procedure_case_executions — local/mock cases
 * show the same DatabaseModeOnlyNotice (reused with featureLabel="작업 기록")
 * instead of a mock work-record system.
 */
export default function LocalRepairCaseExecutionContent({
  id,
  actingUser,
}: {
  id: string;
  actingUser: ActingUser | null;
}) {
  const { cases: localCases, isHydrated } = useLocalRepairCases();

  if (!isHydrated) {
    return <LoadingNotice />;
  }

  const resolved = resolveRepairCaseById(id, localCases);
  if (!resolved) {
    return <RepairCaseNotFound />;
  }

  return <NonDatabaseWorkContent resolved={resolved} actingUser={actingUser} />;
}

/**
 * Shared by both non-database sources: the local- id branch above (which
 * resolves `resolved` from localStorage after a hydration gate) and
 * execution/page.tsx's MOCK-source branch (which already has `resolved`
 * from resolveRepairCaseForServer server-side and can skip straight here,
 * exactly mirroring how RepairCaseDetailView.tsx already treats MOCK and
 * LOCAL_DEMO identically on 기본 정보 via the same useEffectiveRepairCase
 * adapter).
 */
export function NonDatabaseWorkContent({
  resolved,
  actingUser,
}: {
  resolved: ResolvedRepairCase;
  actingUser: ActingUser | null;
}) {
  const { effective, isHydrated } = useEffectiveRepairCase(resolved);
  const workflowStore = useWorkflowStore();
  const approvalStore = useApprovalStore();

  if (!isHydrated || !effective) {
    return <LoadingNotice />;
  }

  const caseEvents = workflowStore.events.filter((e) => e.repairCaseId === effective.id);

  return (
    <div className="flex flex-col gap-4">
      <WorkflowControlPanel effective={effective} actingUser={actingUser} />

      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">작업 기록</h2>
        <div className="mt-2">
          <DatabaseModeOnlyNotice featureLabel="작업 기록" />
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">기술 절차</h2>
        <div className="mt-2">
          <DatabaseModeOnlyNotice />
        </div>
      </div>

      <details>
        <summary className="cursor-pointer text-sm font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50">
          워크플로 변경 이력
        </summary>
        <div className="mt-2">
          <WorkflowEventTimeline events={caseEvents} approvalRecords={approvalStore.records} />
        </div>
      </details>
    </div>
  );
}
