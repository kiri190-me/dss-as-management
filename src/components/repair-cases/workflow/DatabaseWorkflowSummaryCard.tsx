import { HoldBadge, StatusBadge } from "@/components/repair-cases/badges";
import { workflowTypeLabels } from "@/lib/domain/types";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import type { CurrentHoldState } from "@/lib/db/queries/workflow-history";

export default function DatabaseWorkflowSummaryCard({
  resolved,
  stepLabel,
  stepOrder,
  responsibleRoleLabel,
  holdState,
}: {
  resolved: ResolvedRepairCase;
  stepLabel: string;
  stepOrder: number | null;
  responsibleRoleLabel: string;
  holdState: CurrentHoldState;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">워크플로 제어</h2>
        <div className="flex flex-wrap items-center gap-2">
          <HoldBadge isOnHold={holdState.isOnHold} />
          <StatusBadge status={resolved.status} />
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">워크플로 유형</dt>
          <dd className="text-zinc-900 dark:text-zinc-50">{workflowTypeLabels[resolved.workflowType]}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">현재 단계</dt>
          <dd className="text-zinc-900 dark:text-zinc-50">
            {stepOrder !== null ? `${stepOrder}. ` : ""}
            {stepLabel}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">담당 역할</dt>
          <dd className="text-zinc-900 dark:text-zinc-50">{responsibleRoleLabel}</dd>
        </div>
      </dl>

      {holdState.isOnHold && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          보류 사유: {holdState.reason} (시작: {holdState.startedByName})
        </p>
      )}

      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        이 워크플로 상태는 데이터베이스에 저장되며, 서버에서 권한과 전이 규칙을 재검증합니다.
      </p>
    </section>
  );
}
