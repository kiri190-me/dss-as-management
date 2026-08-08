import { HoldBadge } from "@/components/repair-cases/badges";

/**
 * Phase 5C-1 — compact replacement for the removed "워크플로 제어" card
 * (WorkflowSummaryCard.tsx / DatabaseWorkflowSummaryCard.tsx, both deleted).
 * Deliberately shows only what's needed to read the action list below it —
 * current step and hold state — not workflow type, approval statuses, or
 * override badges (those disappeared from the UI along with the big card,
 * per the restructuring's intent; per-action reasons already surface any
 * approval-gating detail in WorkflowActionList itself).
 */
export default function WorkflowStageStatus({
  stepLabel,
  stepOrder,
  responsibleRoleLabel,
  isOnHold,
  holdReason,
  holdStartedByName,
}: {
  stepLabel: string;
  stepOrder: number | null;
  responsibleRoleLabel: string;
  isOnHold: boolean;
  holdReason?: string | null;
  holdStartedByName?: string | null;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">현재 작업 상태</h2>
        <HoldBadge isOnHold={isOnHold} />
      </div>
      <p className="mt-2 text-sm text-zinc-900 dark:text-zinc-50">
        {stepOrder !== null ? `${stepOrder}. ` : ""}
        {stepLabel}
        <span className="text-zinc-500 dark:text-zinc-400"> · 담당: {responsibleRoleLabel}</span>
      </p>
      {isOnHold && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          보류 사유: {holdReason} (시작: {holdStartedByName})
        </p>
      )}
    </section>
  );
}
