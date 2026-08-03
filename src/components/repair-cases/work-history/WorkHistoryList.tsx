"use client";

import { useMemo, useState } from "react";
import type { WorkHistoryRow } from "@/lib/domain/work-history-rows";
import WorkHistoryEntryCard from "./WorkHistoryEntryCard";

type SortDirection = "newest" | "oldest";

export default function WorkHistoryList({ entries }: { entries: WorkHistoryRow[] }) {
  const [direction, setDirection] = useState<SortDirection>("newest");

  const sorted = useMemo(() => {
    const copy = [...entries].sort((a, b) => a.workedAt.localeCompare(b.workedAt));
    return direction === "newest" ? copy.reverse() : copy;
  }, [entries, direction]);

  return (
    <div className="flex flex-col gap-4">
      <div
        role="group"
        aria-label="정렬"
        className="flex items-center gap-1 self-start rounded-md border border-zinc-200 p-1 dark:border-zinc-700"
      >
        <button
          type="button"
          aria-pressed={direction === "newest"}
          onClick={() => setDirection("newest")}
          className={
            direction === "newest"
              ? "rounded px-2 py-1 text-xs font-medium bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
              : "rounded px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          }
        >
          최신순
        </button>
        <button
          type="button"
          aria-pressed={direction === "oldest"}
          onClick={() => setDirection("oldest")}
          className={
            direction === "oldest"
              ? "rounded px-2 py-1 text-xs font-medium bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
              : "rounded px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          }
        >
          오래된순
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          등록된 작업 이력이 없습니다.
        </div>
      ) : (
        <ol className="flex flex-col gap-3">
          {sorted.map((entry) => (
            <WorkHistoryEntryCard key={entry.id} entry={entry} />
          ))}
        </ol>
      )}
    </div>
  );
}
