"use client";

import type { LocalAttachmentMetadata } from "@/lib/domain/local/attachments/attachment-types";
import { formatAttachmentDateTime, formatFileSizeKorean } from "@/lib/domain/local/attachments/format";
import { CategoryBadge, DeletedStatusBadge, MalwareScanStatusBadge, PreviewStatusBadge } from "./badges";
import type { AttachmentRowActions } from "./types";

const actionButtonClass =
  "rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

type AttachmentCardListProps = {
  records: LocalAttachmentMetadata[];
} & AttachmentRowActions;

export default function AttachmentCardList({
  records,
  onRename,
  onEditDescription,
  onPreview,
  onDownload,
  onDelete,
  onRestore,
}: AttachmentCardListProps) {
  return (
    <div className="flex flex-col gap-3 md:hidden">
      {records.map((record) => (
        <div
          key={record.id}
          className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold break-all text-zinc-900 dark:text-zinc-50">{record.displayName}</p>
              {record.displayName !== record.originalFileName && (
                <p className="mt-0.5 text-xs break-all text-zinc-500 dark:text-zinc-400">
                  원본: {record.originalFileName}
                </p>
              )}
            </div>
            <DeletedStatusBadge isDeleted={record.isDeleted} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <CategoryBadge category={record.category} />
            <PreviewStatusBadge status={record.previewStatus} />
            <MalwareScanStatusBadge status={record.malwareScanStatus} />
          </div>

          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">확장자 / 크기</dt>
              <dd>
                .{record.fileExtension} / {formatFileSizeKorean(record.fileSizeBytes)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">업로더</dt>
              <dd>{record.uploadedByNameSnapshot}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">업로드 일시</dt>
              <dd>{formatAttachmentDateTime(record.uploadedAt)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">설명</dt>
              <dd className="break-words">{record.description ?? "-"}</dd>
            </div>
            {record.isDeleted && record.deletionReason && (
              <div className="col-span-2">
                <dt className="text-xs text-zinc-500 dark:text-zinc-500">삭제 사유</dt>
                <dd className="break-words">{record.deletionReason}</dd>
              </div>
            )}
          </dl>

          <div className="flex flex-wrap gap-1.5 pt-1">
            {record.isDeleted ? (
              <button type="button" className={actionButtonClass} onClick={() => onRestore(record)}>
                복원
              </button>
            ) : (
              <>
                <button type="button" className={actionButtonClass} onClick={() => onRename(record)}>
                  이름 변경
                </button>
                <button type="button" className={actionButtonClass} onClick={() => onEditDescription(record)}>
                  설명 수정
                </button>
                <button type="button" className={actionButtonClass} onClick={() => onPreview(record)}>
                  미리보기
                </button>
                <button type="button" className={actionButtonClass} onClick={() => onDownload(record)}>
                  다운로드
                </button>
                <button
                  type="button"
                  className={`${actionButtonClass} border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950`}
                  onClick={() => onDelete(record)}
                >
                  삭제
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
