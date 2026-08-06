import { procedureValidationResolutionActionTypeLabels } from "@/lib/domain/procedure-template-types";
import type { ValidationResolutionHistoryRow } from "@/lib/db/queries/procedure-validation-resolutions";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Read-only, append-only audit trail (Phase 3A) — newest first. Every row
 * here is an insert-only procedure_validation_resolution_history record;
 * this component never offers to edit or delete one.
 */
export default function ResolutionHistoryPanel({ history }: { history: ValidationResolutionHistoryRow[] }) {
  if (history.length === 0) {
    return (
      <p className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        아직 처리 이력이 없습니다.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-2">
      {history.map((row) => (
        <li key={row.id} className="rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {procedureValidationResolutionActionTypeLabels[row.actionType] ?? row.actionType}
            </span>
            <span className="text-xs text-zinc-400 dark:text-zinc-600">
              {row.actorName} · {formatDate(row.createdAt)}
            </span>
          </div>
          {row.note && <p className="mt-2 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{row.note}</p>}
          {row.branchType && (
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-600">분기 유형: {row.branchType}</p>
          )}
          {row.affectedEdgeId && (
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-600">영향받은 분기 ID: {row.affectedEdgeId}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
