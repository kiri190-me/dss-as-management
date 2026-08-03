"use client";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

type PaginationProps = {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

export default function Pagination({
  page,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, totalCount);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-600 dark:text-zinc-400">
      <div className="flex items-center gap-2">
        <label htmlFor="repair-case-page-size" className="text-xs text-zinc-500 dark:text-zinc-500">
          페이지당 표시
        </label>
        <select
          id="repair-case-page-size"
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size}건
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-3">
        <span>
          전체 {totalCount}건 중 {rangeStart}-{rangeEnd}건
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="rounded-md border border-zinc-300 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700"
          >
            이전
          </button>
          <span className="px-1">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="rounded-md border border-zinc-300 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700"
          >
            다음
          </button>
        </div>
      </div>
    </div>
  );
}
