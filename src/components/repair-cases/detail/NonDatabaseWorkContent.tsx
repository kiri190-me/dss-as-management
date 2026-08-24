"use client";

import LoadingNotice from "@/components/domain/LoadingNotice";
import WorkflowControlPanel from "@/components/repair-cases/workflow/WorkflowControlPanel";
import WorkflowEventTimeline from "@/components/repair-cases/workflow/WorkflowEventTimeline";
import DatabaseModeOnlyNotice from "@/components/procedures/execution/DatabaseModeOnlyNotice";
import { type ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import { useEffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import { useWorkflowStore } from "@/lib/domain/local/workflow/use-workflow-data";
import { useApprovalStore } from "@/lib/domain/local/approval/use-approval-data";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";

/**
 * "작업내용"(/execution) 화면에서 DB가 아닌 소스로 해석된 접수 건을 그리는
 * 본문이다. 유일한 호출자는 execution/page.tsx의
 * `resolved.source !== "DATABASE"` 분기이며(REPAIR_CASE_READ_SOURCE=mock
 * 읽기 모드), 그 분기는 서버에서 resolveRepairCaseForServer로 이미 얻은
 * `resolved`를 그대로 넘겨준다 — 이 컴포넌트는 존재 확인을 다시 하지 않는다.
 * 소스별 차이는 useEffectiveRepairCase 어댑터가 흡수한다(RepairCaseDetailView
 * .tsx가 기본 정보에서 MOCK과 LOCAL_DEMO를 같은 방식으로 다루는 것과 동일).
 *
 * Phase 5A/5C-2 제약은 그대로다: procedure_case_executions와
 * repair_case_work_records는 둘 다 repair_cases.id에 실제 FK가 걸린 DB 전용
 * 테이블이라, 비-DB 소스에서는 모의 구현을 만들지 않고 DatabaseModeOnlyNotice
 * 만 보여 준다("작업 기록"은 featureLabel로 같은 컴포넌트를 재사용한다).
 *
 * 워크플로 전이 액션 목록(WorkflowControlPanel)은 Phase 5C-1에서 기본 정보
 * 화면에서 이곳으로 옮겨 왔다 — DB 모드 사용자가 같은 액션을 찾는 위치와
 * 맞추기 위해서다.
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
