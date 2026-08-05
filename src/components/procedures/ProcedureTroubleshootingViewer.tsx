import type { ProcedureTroubleshootingEntryRow } from "@/lib/db/queries/procedure-templates";

/**
 * Read-only viewer for a TROUBLESHOOTING-type node's symptom entries (the
 * imported form of (MB) 수리's 11-row symptom→check→replace matrix — Phase
 * 1 report §3). One card per symptom rather than a dense table: the
 * inspection/normal/NG fields are long free text, and a card layout keeps
 * each symptom's full "if this fails, do that" story readable in one
 * place instead of forcing a horizontal scroll.
 */
export default function ProcedureTroubleshootingViewer({ entries }: { entries: ProcedureTroubleshootingEntryRow[] }) {
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {entries.map((entry) => (
        <div key={entry.id} className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{entry.symptom}</h3>
            <span className="whitespace-nowrap text-[10px] text-zinc-400 dark:text-zinc-600">{entry.sourceCellRange}</span>
          </div>
          <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="font-medium text-zinc-500 dark:text-zinc-400">최초 점검 항목</dt>
              <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">{entry.inspectionAction ?? "-"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="font-medium text-zinc-500 dark:text-zinc-400">정상 진행 순서</dt>
              <dd className="mt-0.5 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{entry.normalNextAction ?? "-"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="font-medium text-red-600 dark:text-red-400">NG 시 조치</dt>
              <dd className="mt-0.5 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{entry.ngAction ?? "-"}</dd>
            </div>
            {entry.retryInstruction && (
              <div className="sm:col-span-2">
                <dt className="font-medium text-orange-600 dark:text-orange-400">재측정 안내</dt>
                <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">{entry.retryInstruction}</dd>
              </div>
            )}
          </dl>
        </div>
      ))}
    </div>
  );
}
