import { priorityLabels, repairStatusLabels, type Priority, type RepairStatus } from "@/lib/domain/types";

const baseBadgeClass =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

export function StatusBadge({ status }: { status: RepairStatus }) {
  const tone =
    status === "SHIPMENT_COMPLETED"
      ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400"
      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return <span className={`${baseBadgeClass} ${tone}`}>{repairStatusLabels[status]}</span>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const tone =
    priority === "URGENT"
      ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400"
      : priority === "HIGH"
        ? "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return <span className={`${baseBadgeClass} ${tone}`}>{priorityLabels[priority]}</span>;
}

export function SourceBadge({ source }: { source: "MOCK" | "LOCAL_DEMO" }) {
  if (source !== "LOCAL_DEMO") {
    return null;
  }
  return (
    <span
      className={`${baseBadgeClass} bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400`}
    >
      로컬 데모 데이터
    </span>
  );
}

export function OverdueBadge({ isOverdue }: { isOverdue: boolean }) {
  if (!isOverdue) {
    return <span className="text-xs text-zinc-500 dark:text-zinc-400">정상</span>;
  }
  return (
    <span
      className={`${baseBadgeClass} bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400`}
    >
      납기 지연
    </span>
  );
}
