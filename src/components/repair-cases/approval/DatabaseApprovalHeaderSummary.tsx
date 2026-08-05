import { SourceBadge, StatusBadge } from "@/components/repair-cases/badges";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";

/**
 * Database-mode counterpart to ApprovalHeaderSummary.tsx. Uses
 * ResolvedRepairCase directly rather than EffectiveRepairCase — DB-sourced
 * cases have no local workflow-override simulation to merge (see
 * RepairCaseDetailView.tsx's header comment on that being a LOCAL_DEMO-only
 * concept).
 */
export default function DatabaseApprovalHeaderSummary({ resolved }: { resolved: ResolvedRepairCase }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {resolved.intakeNumber} · 검수/승인
        </h1>
        <SourceBadge source={resolved.source} />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">현재 수리 상태</dt>
          <dd className="mt-0.5">
            <StatusBadge status={resolved.status} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">담당 엔지니어</dt>
          <dd className="text-zinc-900 dark:text-zinc-50">{resolved.engineerName ?? "미배정"}</dd>
        </div>
      </dl>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        이 승인 기록은 데이터베이스에 저장되며, 서버에서 권한과 요청 상태를 재검증합니다.
      </p>
    </div>
  );
}
