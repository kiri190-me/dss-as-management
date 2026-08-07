import type { ExecutionHistoryRow } from "@/lib/db/queries/procedure-case-execution";
import { procedureCaseExecutionActionTypeLabels } from "@/lib/domain/procedure-case-execution-types";

/** Newest-first, append-only history — same read-only presentation convention as DatabaseWorkflowHistoryList. */
export default function ExecutionHistoryTimeline({ history }: { history: ExecutionHistoryRow[] }) {
  if (history.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">실행 이력이 없습니다.</p>;
  }

  return (
    <ol className="flex flex-col gap-2">
      {history.map((row) => (
        <li key={row.id} className="rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-800">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-zinc-800 dark:text-zinc-200">
              {procedureCaseExecutionActionTypeLabels[row.actionType]}
            </span>
            <span className="text-zinc-500 dark:text-zinc-400">{new Date(row.createdAt).toLocaleString("ko-KR")}</span>
          </div>
          <div className="mt-1 text-zinc-500 dark:text-zinc-400">{row.actorName}</div>
          {row.reason && <div className="mt-1 text-zinc-600 dark:text-zinc-300">사유: {row.reason}</div>}
        </li>
      ))}
    </ol>
  );
}
