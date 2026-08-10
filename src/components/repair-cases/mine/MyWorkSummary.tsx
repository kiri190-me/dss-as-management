/**
 * Phase 5C-3 — v1 summary is deliberately minimal: 현재 담당 건수 only. No
 * urgent/high priority counts (repair_cases has no real priority data for
 * database-mode cases — see the Phase 5C-3 audit) and no overdue count
 * (would need a new semantic decision this phase doesn't make).
 */
export default function MyWorkSummary({ count }: { count: number }) {
  return (
    <div className="inline-flex items-baseline gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <span className="text-xs text-zinc-500 dark:text-zinc-400">현재 담당 건수</span>
      <span className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{count}건</span>
    </div>
  );
}
