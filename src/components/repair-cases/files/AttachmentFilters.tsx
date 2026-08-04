"use client";

import { ATTACHMENT_CATEGORY_CODES, attachmentCategoryLabels } from "@/lib/domain/local/attachments/attachment-types";
import type { AttachmentFilters as AttachmentFiltersState } from "@/lib/domain/local/attachments/filters";

const selectClass =
  "w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
const labelClass = "text-xs text-zinc-500 dark:text-zinc-400";

type UploaderOption = { id: string; name: string };

type AttachmentFiltersProps = {
  filters: AttachmentFiltersState;
  extensions: string[];
  uploaders: UploaderOption[];
  onQueryChange: (value: string) => void;
  onCategoryChange: (value: AttachmentFiltersState["category"]) => void;
  onExtensionChange: (value: AttachmentFiltersState["extension"]) => void;
  onUploaderChange: (value: AttachmentFiltersState["uploaderId"]) => void;
  onIncludeDeletedChange: (value: boolean) => void;
  onReset: () => void;
};

export default function AttachmentFilters({
  filters,
  extensions,
  uploaders,
  onQueryChange,
  onCategoryChange,
  onExtensionChange,
  onUploaderChange,
  onIncludeDeletedChange,
  onReset,
}: AttachmentFiltersProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-col gap-1">
        <label htmlFor="attachment-search" className={labelClass}>
          파일명 검색
        </label>
        <input
          id="attachment-search"
          type="text"
          value={filters.query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="표시 이름 또는 원본 파일명 검색"
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="attachment-category" className={labelClass}>
            분류
          </label>
          <select
            id="attachment-category"
            className={selectClass}
            value={filters.category}
            onChange={(event) => onCategoryChange(event.target.value as AttachmentFiltersState["category"])}
          >
            <option value="ALL">전체</option>
            {ATTACHMENT_CATEGORY_CODES.map((category) => (
              <option key={category} value={category}>
                {attachmentCategoryLabels[category]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="attachment-extension" className={labelClass}>
            확장자
          </label>
          <select
            id="attachment-extension"
            className={selectClass}
            value={filters.extension}
            onChange={(event) => onExtensionChange(event.target.value)}
          >
            <option value="ALL">전체</option>
            {extensions.map((extension) => (
              <option key={extension} value={extension}>
                .{extension}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="attachment-uploader" className={labelClass}>
            업로더
          </label>
          <select
            id="attachment-uploader"
            className={selectClass}
            value={filters.uploaderId}
            onChange={(event) => onUploaderChange(event.target.value)}
          >
            <option value="ALL">전체</option>
            {uploaders.map((uploader) => (
              <option key={uploader.id} value={uploader.id}>
                {uploader.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={filters.includeDeleted}
            onChange={(event) => onIncludeDeletedChange(event.target.checked)}
          />
          삭제된 항목 포함
        </label>

        <button
          type="button"
          onClick={onReset}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          필터 초기화
        </button>
      </div>
    </div>
  );
}
