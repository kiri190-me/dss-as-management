import { HoldBadge, SourceBadge, StatusBadge, WorkflowOverrideBadge } from "@/components/repair-cases/badges";
import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";

/**
 * 이 헤더만 EffectiveRepairCase(Stage E-1 유효 상태)를 읽는다 — 타임라인
 * 항목들은 전부 과거 시점 값만 사용하며 이 컴포넌트가 보여주는 "현재" 상태를
 * 절대 대체하지 않는다.
 */
export default function ActivityHeaderSummary({ resolved }: { resolved: EffectiveRepairCase }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {resolved.intakeNumber} · 작업 이력
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
        아래 타임라인의 각 항목은 발생 당시의 과거 기록입니다. 위 현재 수리 상태로 대체되지 않습니다.
      </p>
    </div>
  );
}
