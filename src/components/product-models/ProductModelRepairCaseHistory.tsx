"use client";

import { useMemo, useState } from "react";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import { applyWorkflowOverride } from "@/lib/domain/local/workflow/effective-repair-case";
import { sortRows, type SortColumn, type SortState } from "@/lib/domain/repair-case-filters";
import RepairCaseTable from "@/components/repair-cases/RepairCaseTable";
import RepairCaseCardList from "@/components/repair-cases/RepairCaseCardList";

const DEFAULT_SORT: SortState = { column: "receivedAt", direction: "desc" };

/**
 * A/S 이력 section of /product-models/[id] — same shape as
 * CustomerRepairCaseHistory (Customer Management), kept as its own small
 * component rather than a cross-domain import so this feature doesn't reach
 * into components/customers for a generically-named concept: reuses
 * RepairCaseTable/RepairCaseCardList as-is (same `lg:` switch, same
 * columns, same 인수번호/상세 links), no filters/pagination (already a
 * pre-filtered "cases for one product_model_id" set).
 *
 * `resolved` comes straight from the server (listRepairCasesByProductModelId
 * — scoped by the real FK, never by model_name string — DATABASE source
 * only), converted via applyWorkflowOverride(resolved, undefined) — the
 * same pure "no override" branch every DATABASE-source row already
 * resolves to, skipping the local-storage-reading machinery this
 * server-fetched list has no use for.
 *
 * Each row's own 제품 cell (inside RepairCaseTable) still shows that case's
 * own productCategory (Matcher/Generator, derived from its workflowType) —
 * a distinct, per-case/workflow-derived fact that intentionally never
 * feeds back into product_models.kind (see ProductModelDetailScreen's own
 * doc comment and the canonicalization audit).
 */
export default function ProductModelRepairCaseHistory({ resolved }: { resolved: ResolvedRepairCase[] }) {
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
        이 모델과 연결된 A/S 접수 건이 없습니다.
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
