import type { WorkRecordRow } from "@/lib/db/queries/repair-case-work-records";

const badgeClass =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";

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

export default function WorkRecordItem({
  record,
  canInvalidate,
  onInvalidateClick,
}: {
  record: WorkRecordRow;
  canInvalidate: boolean;
  onInvalidateClick?: () => void;
}) {
  return (
    <li className="rounded-md border border-zinc-100 p-3 text-sm dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-zinc-900 dark:text-zinc-50">{record.authorName}</span>
          {record.workflowStepLabel && <span className={badgeClass}>{record.workflowStepLabel}</span>}
          {record.procedureNodeTitle && <span className={badgeClass}>{record.procedureNodeTitle}</span>}
          {record.isInvalidated && (
            <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-red-700 dark:bg-red-950 dark:text-red-400">
              무효
            </span>
          )}
        </div>
        <span className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">{formatDateTime(record.createdAt)}</span>
      </div>

      <p className={`mt-2 whitespace-pre-wrap text-sm ${record.isInvalidated ? "text-zinc-400 line-through dark:text-zinc-600" : "text-zinc-900 dark:text-zinc-50"}`}>
        {record.memo}
      </p>

      {record.isInvalidated && (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          무효 처리: {record.invalidatedByName} · {record.invalidatedAt && formatDateTime(record.invalidatedAt)}
          <br />
          사유: {record.invalidationReason}
        </p>
      )}

      {!record.isInvalidated && canInvalidate && onInvalidateClick && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={onInvalidateClick}
            className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
          >
            무효 처리
          </button>
        </div>
      )}
    </li>
  );
}
