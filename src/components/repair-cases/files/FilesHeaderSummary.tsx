import { HoldBadge, SourceBadge, StatusBadge, WorkflowOverrideBadge } from "@/components/repair-cases/badges";
import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";

export default function FilesHeaderSummary({ resolved }: { resolved: EffectiveRepairCase }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {resolved.intakeNumber} · 파일 관리
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <WorkflowOverrideBadge hasOverride={resolved.hasWorkflowOverride} />
          <SourceBadge source={resolved.source} />
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">고객사</dt>
          <dd className="text-zinc-900 dark:text-zinc-50">{resolved.customerName}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">Model</dt>
          <dd className="text-zinc-900 dark:text-zinc-50">{resolved.modelName}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">현재 상태</dt>
          <dd className="mt-0.5 flex items-center gap-1">
            <StatusBadge status={resolved.effectiveStatus} />
            <HoldBadge isOnHold={resolved.holdState?.isOnHold ?? false} />
          </dd>
        </div>
      </dl>
    </div>
  );
}
