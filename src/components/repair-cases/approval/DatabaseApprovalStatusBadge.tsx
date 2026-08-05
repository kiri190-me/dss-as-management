export type DatabaseDisplayApprovalStatus = "NOT_REQUESTED" | "REQUESTED" | "APPROVED" | "REJECTED";

const baseBadgeClass =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

const toneByStatus: Record<DatabaseDisplayApprovalStatus, string> = {
  NOT_REQUESTED: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  REQUESTED: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
  APPROVED: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400",
  REJECTED: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
};

const labelByStatus: Record<DatabaseDisplayApprovalStatus, string> = {
  NOT_REQUESTED: "요청 전",
  REQUESTED: "승인 대기",
  APPROVED: "승인 완료",
  REJECTED: "반려",
};

export default function DatabaseApprovalStatusBadge({ status }: { status: DatabaseDisplayApprovalStatus }) {
  return <span className={`${baseBadgeClass} ${toneByStatus[status]}`}>{labelByStatus[status]}</span>;
}
