import type { WorkflowHistoryEntry } from "@/lib/db/queries/workflow-history";

const ACTION_LABELS: Record<WorkflowHistoryEntry["actionType"], string> = {
  STEP_ADVANCED: "다음 단계로 진행",
  STEP_RETURNED: "이전 단계로 되돌림",
  HOLD_STARTED: "보류 시작",
  HOLD_RELEASED: "보류 해제",
  SHIPMENT_COMPLETED: "출하 완료 처리",
};

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** DB-backed counterpart to WorkflowEventTimeline.tsx (local mode) — kept
 * as a separate component rather than a shared one so local mode's
 * LocalWorkflowEvent-specific shape (relatedApprovalRecordId, etc.) is
 * never touched by this task. */
export default function DatabaseWorkflowHistoryList({ entries }: { entries: WorkflowHistoryEntry[] }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">워크플로 이력</h2>

      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">아직 워크플로 관련 이력이 없습니다.</p>
      ) : (
        <ol className="mt-3 flex flex-col gap-2">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-md border border-zinc-100 p-3 text-sm dark:border-zinc-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-zinc-900 dark:text-zinc-50">{ACTION_LABELS[entry.actionType]}</span>
                <span className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                  {formatDateTime(entry.createdAt)}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">처리자: {entry.actorName}</p>
              {entry.fromStepKey !== entry.toStepKey && (
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                  {entry.fromStepLabel ?? entry.fromStepKey ?? "-"} → {entry.toStepLabel ?? entry.toStepKey ?? "-"}
                </p>
              )}
              {entry.reason && (
                <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">&ldquo;{entry.reason}&rdquo;</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
