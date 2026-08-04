"use client";

import type { LocalAttachmentMetadata } from "@/lib/domain/local/attachments/attachment-types";
import { formatAttachmentDateTime, formatFileSizeKorean } from "@/lib/domain/local/attachments/format";
import { CategoryBadge, DeletedStatusBadge, MalwareScanStatusBadge, PreviewStatusBadge } from "./badges";
import type { AttachmentRowActions } from "./types";

const thBaseClass =
  "border-b border-zinc-200 bg-white px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400";
const tdBaseClass = "px-3 py-2 align-top";
const actionButtonClass =
  "rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

type AttachmentTableProps = {
  records: LocalAttachmentMetadata[];
} & AttachmentRowActions;

export default function AttachmentTable({
  records,
  onRename,
  onEditDescription,
  onPreview,
  onDownload,
  onDelete,
  onRestore,
}: AttachmentTableProps) {
  return (
    <div className="hidden overflow-x-auto rounded-lg border border-zinc-200 md:block dark:border-zinc-800">
      <table className="w-full min-w-[1200px] border-collapse text-sm">
        <caption className="sr-only">첨부파일 메타데이터 목록</caption>
        <thead>
          <tr>
            <th scope="col" className={thBaseClass}>파일명</th>
            <th scope="col" className={thBaseClass}>분류</th>
            <th scope="col" className={thBaseClass}>확장자</th>
            <th scope="col" className={thBaseClass}>크기</th>
            <th scope="col" className={thBaseClass}>업로더</th>
            <th scope="col" className={thBaseClass}>업로드 일시</th>
            <th scope="col" className={thBaseClass}>미리보기 상태</th>
            <th scope="col" className={thBaseClass}>악성코드 검사 상태</th>
            <th scope="col" className={thBaseClass}>삭제 상태</th>
            <th scope="col" className={thBaseClass}>설명</th>
            <th scope="col" className={thBaseClass}>작업</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr
              key={record.id}
              className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
            >
              <td className={`${tdBaseClass} max-w-[220px]`}>
                <p className="font-medium break-all text-zinc-900 dark:text-zinc-50">{record.displayName}</p>
                {record.displayName !== record.originalFileName && (
                  <p className="mt-0.5 text-xs break-all text-zinc-500 dark:text-zinc-400">
                    원본: {record.originalFileName}
                  </p>
                )}
              </td>
              <td className={tdBaseClass}>
                <CategoryBadge category={record.category} />
              </td>
              <td className={`${tdBaseClass} whitespace-nowrap`}>.{record.fileExtension}</td>
              <td className={`${tdBaseClass} whitespace-nowrap`}>{formatFileSizeKorean(record.fileSizeBytes)}</td>
              <td className={`${tdBaseClass} whitespace-nowrap`}>{record.uploadedByNameSnapshot}</td>
              <td className={`${tdBaseClass} whitespace-nowrap`}>{formatAttachmentDateTime(record.uploadedAt)}</td>
              <td className={tdBaseClass}>
                <PreviewStatusBadge status={record.previewStatus} />
              </td>
              <td className={tdBaseClass}>
                <MalwareScanStatusBadge status={record.malwareScanStatus} />
              </td>
              <td className={tdBaseClass}>
                <DeletedStatusBadge isDeleted={record.isDeleted} />
                {record.isDeleted && record.deletionReason && (
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">사유: {record.deletionReason}</p>
                )}
              </td>
              <td className={`${tdBaseClass} max-w-[200px] break-words text-zinc-600 dark:text-zinc-400`}>
                {record.description ?? "-"}
              </td>
              <td className={`${tdBaseClass} whitespace-nowrap`}>
                <div className="flex flex-wrap gap-1.5">
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
