import {
  attachmentCategoryLabels,
  malwareScanStatusLabels,
  previewStatusLabels,
  type AttachmentCategory,
  type LocalMalwareScanStatus,
  type PreviewStatus,
} from "@/lib/domain/local/attachments/attachment-types";

const baseBadgeClass =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

export function CategoryBadge({ category }: { category: AttachmentCategory }) {
  return (
    <span className={`${baseBadgeClass} bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300`}>
      {attachmentCategoryLabels[category]}
    </span>
  );
}

export function PreviewStatusBadge({ status }: { status: PreviewStatus }) {
  const tone =
    status === "READY"
      ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400"
      : status === "FAILED"
        ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400"
        : status === "PENDING"
          ? "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
          : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return <span className={`${baseBadgeClass} ${tone}`}>{previewStatusLabels[status]}</span>;
}

export function MalwareScanStatusBadge({ status }: { status: LocalMalwareScanStatus }) {
  const tone =
    status === "CLEAN"
      ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400"
      : status === "BLOCKED" || status === "ERROR"
        ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400"
        : status === "PENDING"
          ? "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
          : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return <span className={`${baseBadgeClass} ${tone}`}>{malwareScanStatusLabels[status]}</span>;
}

export function DeletedStatusBadge({ isDeleted }: { isDeleted: boolean }) {
  if (!isDeleted) {
    return (
      <span className="text-xs text-zinc-500 dark:text-zinc-400">정상</span>
    );
  }
  return (
    <span className={`${baseBadgeClass} bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400`}>
      삭제됨
    </span>
  );
}
