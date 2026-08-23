/**
 * 승인 상태 배지.
 *
 * STALE("재승인 필요")이 다섯 번째 상태로 추가됐다 — 결재는 받았지만 그 뒤
 * 접수 건 version이 바뀌어(내용 수정뿐 아니라 **단계 진행**으로도 올라간다)
 * 서버가 더 이상 유효한 승인으로 보지 않는 상태다. 전에는 이것도 "승인 완료"로
 * 보였고, 그래서 화면과 서버가 서로 다른 말을 했다.
 */
export type DatabaseDisplayApprovalStatus = "NOT_REQUESTED" | "REQUESTED" | "APPROVED" | "REJECTED" | "STALE";

const baseBadgeClass =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

const toneByStatus: Record<DatabaseDisplayApprovalStatus, string> = {
  NOT_REQUESTED: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  REQUESTED: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
  APPROVED: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400",
  REJECTED: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
  STALE: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

const labelByStatus: Record<DatabaseDisplayApprovalStatus, string> = {
  NOT_REQUESTED: "요청 전",
  REQUESTED: "승인 대기",
  APPROVED: "승인 완료",
  REJECTED: "반려",
  STALE: "재승인 필요",
};

export default function DatabaseApprovalStatusBadge({ status }: { status: DatabaseDisplayApprovalStatus }) {
  return <span className={`${baseBadgeClass} ${toneByStatus[status]}`}>{labelByStatus[status]}</span>;
}
