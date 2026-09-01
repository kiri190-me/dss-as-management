"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { WorkRecordRow } from "@/lib/db/queries/repair-case-work-records";
import type { InvalidateWorkRecordActionResult } from "@/lib/validation/repair-case-work-record-input";
import type { WorkflowHistoryEntry } from "@/lib/db/queries/workflow-history";
import DatabaseWorkflowHistoryList from "@/components/repair-cases/workflow/DatabaseWorkflowHistoryList";
import WorkRecordList from "@/components/repair-cases/work-records/WorkRecordList";
import InvalidateWorkRecordDialog from "@/components/repair-cases/work-records/InvalidateWorkRecordDialog";

/**
 * Phase 5C-2 — DATABASE-sourced "작업 이력" tab: work records as the
 * primary content, workflow/status-change history (already built in
 * 5C-1's DatabaseWorkflowHistoryList) as a secondary collapsible
 * subsection below — not a unified timeline (the two have genuinely
 * different semantics; see the Phase 5C-2 plan's §11 rationale).
 *
 * Invalidation now lives here, and only here. It used to sit in the
 * 작업내용 tab's "최근 작업 기록" section (WorkRecordsSection); that section was
 * removed on request, so the dialog/mutation wiring moved to this screen —
 * a better fit anyway, because this tab lists *every* record rather than
 * the latest five. The server action and mutation are unchanged: only the
 * button moved. The action itself re-checks authorization on the server;
 * `canInvalidate` here decides only whether the button is offered, and the
 * page computes it with exactly the permission the 작업내용 tab used
 * (repairCases.workRecords / MANAGE).
 *
 * The invalidate action is injected as a prop rather than imported here so
 * this screen stays a plain renderable component (the page owns the
 * server-action import, as it owns the permission check).
 */
export default function DatabaseWorkHistoryScreen({
  repairCaseId,
  records,
  total,
  page,
  pageSize,
  workflowHistory,
  canInvalidate,
  invalidateAction,
}: {
  repairCaseId: string;
  records: WorkRecordRow[];
  total: number;
  page: number;
  pageSize: number;
  workflowHistory: WorkflowHistoryEntry[];
  canInvalidate: boolean;
  invalidateAction: (input: { workRecordId: string; reason: string }) => Promise<InvalidateWorkRecordActionResult>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const router = useRouter();
  const [invalidateTargetId, setInvalidateTargetId] = useState<string | null>(null);
  const [isSubmittingInvalidate, setIsSubmittingInvalidate] = useState(false);
  const [invalidateError, setInvalidateError] = useState<string | null>(null);

  async function handleInvalidateConfirm(reason: string) {
    if (!invalidateTargetId || isSubmittingInvalidate) return;
    setIsSubmittingInvalidate(true);
    setInvalidateError(null);
    const result = await invalidateAction({ workRecordId: invalidateTargetId, reason });
    setIsSubmittingInvalidate(false);
    if (!result.ok) {
      setInvalidateError(result.message);
      return;
    }
    setInvalidateTargetId(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">작업 기록</h2>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">전체 {total}건</span>
        </div>
        {invalidateError && (
          <p className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
            {invalidateError}
          </p>
        )}
        <div className="mt-3">
          <WorkRecordList
            records={records}
            canInvalidate={canInvalidate}
            onInvalidate={canInvalidate ? (id) => setInvalidateTargetId(id) : undefined}
            emptyMessage="아직 작업 기록이 없습니다."
          />
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

      {canInvalidate && (
        <InvalidateWorkRecordDialog
          isOpen={invalidateTargetId !== null}
          isSubmitting={isSubmittingInvalidate}
          onConfirm={(reason) => void handleInvalidateConfirm(reason)}
          onCancel={() => setInvalidateTargetId(null)}
        />
      )}
    </div>
  );
}
