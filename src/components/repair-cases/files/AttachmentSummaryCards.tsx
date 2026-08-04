import { attachmentCategoryLabels } from "@/lib/domain/local/attachments/attachment-types";
import type { AttachmentSummary } from "@/lib/domain/local/attachments/filters";
import { formatFileSizeKorean } from "@/lib/domain/local/attachments/format";

export default function AttachmentSummaryCards({ summary }: { summary: AttachmentSummary }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">활성 파일 수</p>
        <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{summary.activeCount}건</p>
      </div>
      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">활성 파일 총 용량(메타데이터 기준)</p>
        <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          {formatFileSizeKorean(summary.activeSizeBytes)}
        </p>
      </div>
      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">삭제된 파일 수</p>
        <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{summary.deletedCount}건</p>
      </div>

      {summary.categoryDistribution.length > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 sm:col-span-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">분류별 분포(활성 파일 기준)</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {summary.categoryDistribution.map(({ category, count }) => (
              <span
                key={category}
                className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {attachmentCategoryLabels[category]} {count}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
