import { HoldBadge, SourceBadge, StatusBadge, WorkflowOverrideBadge } from "@/components/repair-cases/badges";
import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";

export default function ApprovalHeaderSummary({ resolved }: { resolved: EffectiveRepairCase }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {resolved.intakeNumber} · 검수/승인
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <WorkflowOverrideBadge hasOverride={resolved.hasWorkflowOverride} />
          <SourceBadge source={resolved.source} />
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">현재 수리 상태</dt>
          <dd className="mt-0.5 flex items-center gap-1">
            <StatusBadge status={resolved.effectiveStatus} />
            <HoldBadge isOnHold={resolved.holdState?.isOnHold ?? false} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">담당 엔지니어</dt>
          <dd className="text-zinc-900 dark:text-zinc-50">{resolved.engineerName ?? "미배정"}</dd>
        </div>
      </dl>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        이 로컬 데모에서는 승인 처리가 워크플로 상태(현재 수리 상태)를 자동으로 변경하지 않습니다. 워크플로
        상태는 A/S 상세 화면의 워크플로 제어판에서만 변경할 수 있습니다.
      </p>
    </div>
  );
}
