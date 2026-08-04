import { computeWorkflowProgress } from "@/lib/domain/workflow-progress";
import { workflowSteps } from "@/lib/domain/mock-data";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";

const stateLabels = {
  completed: "완료",
  current: "현재 단계",
  future: "예정",
} as const;

const stateClasses = {
  completed: "border-green-300 bg-green-50 dark:border-green-900 dark:bg-green-950",
  current: "border-zinc-900 bg-zinc-50 dark:border-zinc-50 dark:bg-zinc-800",
  future: "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900",
} as const;

export default function WorkflowProgress({ resolved }: { resolved: ResolvedRepairCase }) {
  const result = computeWorkflowProgress(
    resolved.workflowType,
    resolved.currentWorkflowStepKey,
    workflowSteps
  );

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">워크플로 진행</h2>

      {!result.valid && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {result.warning}
        </p>
      )}

      <ol className="mt-3 flex flex-col gap-2">
        {result.steps.map((step) => {
          const state = "state" in step ? step.state : null;
          return (
            <li
              key={step.key}
              className={`flex items-center justify-between gap-2 rounded-md border p-2 text-sm ${
                state ? stateClasses[state] : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
              }`}
            >
              <span className="text-zinc-900 dark:text-zinc-50">
                {step.order}. {step.label}
              </span>
              {state && (
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  {stateLabels[state]}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
