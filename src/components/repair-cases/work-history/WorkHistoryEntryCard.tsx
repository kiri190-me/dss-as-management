import { StatusBadge } from "@/components/repair-cases/badges";
import { formatWorkedAt } from "@/lib/domain/demo-clock";
import { workHistoryTypeLabels } from "@/lib/domain/types";
import type { WorkHistoryRow } from "@/lib/domain/work-history-rows";

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) {
    return null;
  }
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-sm text-zinc-900 dark:text-zinc-50">{value}</dd>
    </div>
  );
}

export default function WorkHistoryEntryCard({ entry }: { entry: WorkHistoryRow }) {
  const isStatusChange = entry.workType === "STATUS_CHANGE";

  return (
    <li
      className={`rounded-lg border p-4 ${
        isStatusChange
          ? "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950"
          : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {formatWorkedAt(entry.workedAt)}
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {entry.engineerName} · {workHistoryTypeLabels[entry.workType]}
          {isStatusChange ? " (상태 변경 항목)" : ""}
        </span>
      </div>

      <p className="mt-2 text-sm text-zinc-900 dark:text-zinc-50">{entry.description}</p>

      {isStatusChange && entry.previousStatus && entry.newStatus && (
        <div className="mt-2 flex items-center gap-2 text-sm">
          <StatusBadge status={entry.previousStatus} />
          <span className="text-zinc-500 dark:text-zinc-400">→</span>
          <StatusBadge status={entry.newStatus} />
        </div>
      )}

      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
        <Field label="증상" value={entry.symptom} />
        <Field label="추정 원인" value={entry.suspectedCause} />
        <Field label="조치 내용" value={entry.actionTaken} />
        <Field label="사용 부품" value={entry.partsUsed} />
        <Field label="다음 조치" value={entry.nextAction} />
      </dl>
    </li>
  );
}
