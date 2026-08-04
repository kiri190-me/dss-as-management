import DemoReferenceNotice from "@/components/domain/DemoReferenceNotice";
import { OverdueBadge, PriorityBadge, SourceBadge, StatusBadge } from "@/components/repair-cases/badges";
import { workflowTypeLabels } from "@/lib/domain/types";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";

export default function DetailHeader({ resolved }: { resolved: ResolvedRepairCase }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {resolved.intakeNumber}
        </h1>
        <DemoReferenceNotice />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={resolved.status} />
        <PriorityBadge priority={resolved.priority} />
        <OverdueBadge isOverdue={resolved.isOverdue} />
        <SourceBadge source={resolved.source} />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">워크플로 유형</dt>
          <dd className="text-zinc-900 dark:text-zinc-50">
            {workflowTypeLabels[resolved.workflowType]}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">담당 엔지니어</dt>
          <dd className="text-zinc-900 dark:text-zinc-50">{resolved.engineerName ?? "미배정"}</dd>
        </div>
      </dl>
    </div>
  );
}
