import Link from "next/link";
import type { WorkRecordRow } from "@/lib/db/queries/repair-case-work-records";
import type { WorkflowHistoryEntry } from "@/lib/db/queries/workflow-history";
import DatabaseWorkflowHistoryList from "@/components/repair-cases/workflow/DatabaseWorkflowHistoryList";
import WorkRecordList from "@/components/repair-cases/work-records/WorkRecordList";

/**
 * Phase 5C-2 — DATABASE-sourced "작업 이력" tab: work records as the
 * primary content, workflow/status-change history (already built in
 * 5C-1's DatabaseWorkflowHistoryList) as a secondary collapsible
 * subsection below — not a unified timeline (the two have genuinely
 * different semantics; see the Phase 5C-2 plan's §11 rationale).
 *
 * Read-only: no invalidate action here. Invalidation lives only in the
 * 작업내용 tab's "최근 작업 기록" section (WorkRecordsSection) — duplicating
 * that dialog/mutation wiring into a second screen wasn't judged worth the
 * scope for this phase; this tab is for browsing full history, not acting
 * on it.
 */
export default function DatabaseWorkHistoryScreen({
  repairCaseId,
  records,
  total,
  page,
  pageSize,
  workflowHistory,
}: {
  repairCaseId: string;
  records: WorkRecordRow[];
  total: number;
  page: number;
  pageSize: number;
  workflowHistory: WorkflowHistoryEntry[];
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">작업 기록</h2>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">전체 {total}건</span>
        </div>
        <div className="mt-3">
          <WorkRecordList records={records} canInvalidate={false} emptyMessage="아직 작업 기록이 없습니다." />
        </div>

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-4 text-sm">
            {page > 1 ? (
              <Link
                href={`/repair-cases/${repairCaseId}/work-history?page=${page - 1}`}
                className="text-zinc-700 hover:underline dark:text-zinc-300"
              >
                이전
              </Link>
            ) : (
              <span className="text-zinc-300 dark:text-zinc-700">이전</span>
            )}
            <span className="text-zinc-500 dark:text-zinc-400">
              {page} / {totalPages}
            </span>
            {page < totalPages ? (
              <Link
                href={`/repair-cases/${repairCaseId}/work-history?page=${page + 1}`}
                className="text-zinc-700 hover:underline dark:text-zinc-300"
              >
                다음
              </Link>
            ) : (
              <span className="text-zinc-300 dark:text-zinc-700">다음</span>
            )}
          </div>
        )}
      </section>

      <details>
        <summary className="cursor-pointer text-sm font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50">
          워크플로 변경 이력
        </summary>
        <div className="mt-2">
          <DatabaseWorkflowHistoryList entries={workflowHistory} />
        </div>
      </details>
    </div>
  );
}
