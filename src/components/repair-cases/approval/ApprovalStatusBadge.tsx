import { approvalStatusLabels, type DisplayApprovalStatus } from "@/lib/domain/local/approval/approval-types";

const baseBadgeClass =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

const toneByStatus: Record<DisplayApprovalStatus, string> = {
  NOT_REQUESTED: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  PENDING: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
  APPROVED: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400",
  CHANGES_REQUESTED: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  REJECTED: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
};

export default function ApprovalStatusBadge({ status }: { status: DisplayApprovalStatus }) {
  return (
    <span className={`${baseBadgeClass} ${toneByStatus[status]}`}>{approvalStatusLabels[status]}</span>
  );
}
