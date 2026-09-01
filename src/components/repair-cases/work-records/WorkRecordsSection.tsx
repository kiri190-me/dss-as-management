import WorkRecordForm from "./WorkRecordForm";

/**
 * "작업 기록" — the 작업내용 tab's new-record form (section 3).
 *
 * Phase 5C-2 originally paired the form with a "최근 작업 기록" list (and the
 * invalidate dialog/mutation wiring that went with it) in this one composed
 * component. That second section was removed from this tab on request: the
 * 작업내용 tab is for *doing* work, and reading past records belongs to the
 * 작업 이력 tab, which shows all of them rather than the latest five.
 *
 * Invalidation moved with it — it now lives in DatabaseWorkHistoryScreen
 * (작업 이력 tab), which is the only place it is offered. Nothing about the
 * invalidate server action or mutation changed; only where the button is.
 *
 * What is left here needs no client state, so this is a plain server
 * component wrapping the client form (WorkRecordForm keeps its own
 * "use client"). The file name is kept as-is deliberately.
 */
export default function WorkRecordsSection({
  repairCaseId,
  currentStepLabel,
  currentStepOrder,
  inProgressNodes,
  createDisabledReason,
}: {
  repairCaseId: string;
  currentStepLabel: string;
  currentStepOrder: number | null;
  inProgressNodes: { id: string; title: string }[];
  createDisabledReason: string | null;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">작업 기록</h2>
      <div className="mt-3">
        <WorkRecordForm
          repairCaseId={repairCaseId}
          currentStepLabel={currentStepLabel}
          currentStepOrder={currentStepOrder}
          inProgressNodes={inProgressNodes}
          disabledReason={createDisabledReason}
        />
      </div>
    </section>
  );
}
