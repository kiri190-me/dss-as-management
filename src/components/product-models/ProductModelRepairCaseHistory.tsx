"use client";

import { useMemo, useState } from "react";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import { applyWorkflowOverride } from "@/lib/domain/local/workflow/effective-repair-case";
import { sortRows, type SortColumn, type SortState } from "@/lib/domain/repair-case-filters";
import RepairCaseTable from "@/components/repair-cases/RepairCaseTable";
import RepairCaseCardList from "@/components/repair-cases/RepairCaseCardList";
import { ResponsiveList } from "@/components/common/responsive-list";

const DEFAULT_SORT: SortState = { column: "receivedAt", direction: "desc" };

/**
 * A/S 이력 section of /product-models/[id] — same shape as
 * CustomerRepairCaseHistory (Customer Management), kept as its own small
 * component rather than a cross-domain import so this feature doesn't reach
 * into components/customers for a generically-named concept: reuses
 * RepairCaseTable/RepairCaseCardList as-is (same columns, same 인수번호/상세
 * links), no filters/pagination (already a pre-filtered "cases for one
 * product_model_id" set).
 *
 * ── 표와 카드가 동시에 보이던 고장 ──────────────────────────────────────
 * 이 주석에는 오래 "same `lg:` switch"라고 적혀 있었지만 **사실이 아니었다** —
 * 그런 클래스는 이 파일에도 RepairCaseTable/RepairCaseCardList 에도 없었고, 이
 * 화면만 두 컴포넌트를 나란히 뿌려 같은 목록이 표로 한 번, 카드로 한 번 보였다.
 * 이제 다른 목록들과 같이 ResponsiveList 로 감싼다 — 하나만 보이는 것도, 사용자가
 * 요청한 **표/카드 전환 단추**도 그 껍데기가 준다(새로 만들지 않는다).
 *
 * `stickyHeader` 는 넘기지 않는다(기본 꺼짐). 켜려면 부르는 쪽이 확정 높이를 가진
 * 세로 flex 상자여야 하는데 이 화면은 아니다 — responsive-list.tsx 헤더 참조.
 *
 * 같은 고장이 CustomerRepairCaseHistory 에도 남아 있다. 이번 범위가 아니다.
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
    <ResponsiveList
      listId="product-model-repair-cases"
      meta={<span className="mr-auto text-xs text-zinc-500 dark:text-zinc-400">{sortedRows.length}건</span>}
      measureKey={[sortedRows.length]}
      table={<RepairCaseTable rows={sortedRows} sort={sort} onSortChange={handleSortChange} />}
      cards={<RepairCaseCardList rows={sortedRows} />}
    />
  );
}
