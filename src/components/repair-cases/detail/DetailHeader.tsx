import DemoReferenceNotice from "@/components/domain/DemoReferenceNotice";
import { OverdueBadge, PriorityBadge, StatusBadge } from "@/components/repair-cases/badges";
import { workflowTypeLabels } from "@/lib/domain/types";
import type { RepairCaseDetail } from "@/lib/domain/repair-case-detail";

export default function DetailHeader({ detail }: { detail: RepairCaseDetail }) {
  const { repairCase, engineerName, isOverdue } = detail;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {repairCase.intakeNumber}
        </h1>
        <DemoReferenceNotice />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={repairCase.status} />
        <PriorityBadge priority={repairCase.priority} />
        <OverdueBadge isOverdue={isOverdue} />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">워크플로 유형</dt>
          <dd className="text-zinc-900 dark:text-zinc-50">
            {workflowTypeLabels[repairCase.workflowType]}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">담당 엔지니어</dt>
          <dd className="text-zinc-900 dark:text-zinc-50">{engineerName ?? "미배정"}</dd>
        </div>
      </dl>
    </div>
  );
}
