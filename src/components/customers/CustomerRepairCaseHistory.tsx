"use client";

import { useMemo, useState } from "react";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import { applyWorkflowOverride } from "@/lib/domain/local/workflow/effective-repair-case";
import { sortRows, type SortColumn, type SortState } from "@/lib/domain/repair-case-filters";
import RepairCaseTable from "@/components/repair-cases/RepairCaseTable";
import RepairCaseCardList from "@/components/repair-cases/RepairCaseCardList";

const DEFAULT_SORT: SortState = { column: "receivedAt", direction: "desc" };

/**
 * A/S 이력 section of /customers/[id] — reuses the existing
 * RepairCaseTable/RepairCaseCardList components as-is (same `lg:` table/card
 * switch, same columns, same 인수번호/상세 links) rather than building a
 * second case-list UI, so this view can never visually drift from 전체 A/S
 * 현황's own list. No filters/pagination here (this is already a
 * pre-filtered, typically small "cases for one customer" set, unlike the
 * full list) — just the same sortable columns, defaulting to 인수일 desc.
 *
 * `resolved` comes straight from the server (listRepairCasesByCustomerId,
 * DATABASE source only — this whole feature only exists in database mode),
 * never through the local workflow-override hook (useEffectiveRepairCasesFromBase)
 * that /repair-cases and /repair-cases/mine use for MOCK/LOCAL_DEMO rows.
 * applyWorkflowOverride(resolved, undefined) is the same pure "no override"
 * branch that hook already falls back to for every DATABASE-source row —
 * calling it directly here just skips the local-storage-reading machinery
 * this server-fetched, always-DATABASE-source list has no use for.
 */
export default function CustomerRepairCaseHistory({ resolved }: { resolved: ResolvedRepairCase[] }) {
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);

  const effectiveRows = useMemo(() => resolved.map((r) => applyWorkflowOverride(r, undefined)), [resolved]);
  const sortedRows = useMemo(() => sortRows(effectiveRows, sort), [effectiveRows, sort]);

  function handleSortChange(column: SortColumn) {
    setSort((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { column, direction: "asc" }
    );
  }

  if (resolved.length === 0) {
    return (
      <p className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        이 고객사와 연결된 A/S 접수 건이 없습니다.
      </p>
    );
  }

  return (
    <>
      <RepairCaseTable rows={sortedRows} sort={sort} onSortChange={handleSortChange} />
      <RepairCaseCardList rows={sortedRows} />
    </>
  );
}
