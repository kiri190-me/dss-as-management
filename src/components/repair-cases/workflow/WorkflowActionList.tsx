export type WorkflowActionAvailability = { available: true } | { available: false; reason: string };

export type WorkflowActionItem = {
  key: string;
  label: string;
  availability: WorkflowActionAvailability;
  onClick: () => void;
  tone?: "default" | "danger" | "warning" | "success";
};

const toneClass: Record<NonNullable<WorkflowActionItem["tone"]>, string> = {
  default: "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800",
  danger: "border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950",
  warning:
    "border-amber-300 text-amber-800 hover:bg-amber-50 dark:border-amber-900 dark:text-amber-300 dark:hover:bg-amber-950",
  success:
    "border-green-300 text-green-700 hover:bg-green-50 dark:border-green-900 dark:text-green-400 dark:hover:bg-green-950",
};

export default function WorkflowActionList({ actions }: { actions: WorkflowActionItem[] }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">실행 가능한 작업</h2>
      <div className="mt-3 flex flex-col gap-2">
        {actions.map((action) => (
          <div key={action.key} className="flex flex-col gap-1">
            <button
              type="button"
              onClick={action.onClick}
              disabled={!action.availability.available}
              title={!action.availability.available ? action.availability.reason : undefined}
              className={`rounded-md border px-3 py-1.5 text-left text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${toneClass[action.tone ?? "default"]}`}
            >
              {action.label}
            </button>
            {!action.availability.available && (
              <p className="pl-1 text-xs text-zinc-500 dark:text-zinc-400">{action.availability.reason}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
