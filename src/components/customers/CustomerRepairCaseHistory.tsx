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
 * A/S 이력 section of /customers/[id] — reuses the existing
 * RepairCaseTable/RepairCaseCardList components as-is (same columns, same
 * 인수번호/상세 links) rather than building a second case-list UI, so this
 * view can never visually drift from 전체 A/S 현황's own list. No
 * filters/pagination here (this is already a pre-filtered, typically small
 * "cases for one customer" set, unlike the full list) — just the same
 * sortable columns, defaulting to 인수일 desc.
 *
 * ── 표와 카드가 동시에 보이던 고장 ──────────────────────────────────────
 * 이 주석에는 오래 "same `lg:` switch"라고 적혀 있었지만 **사실이 아니었다** —
 * 그런 클래스는 이 파일에도 RepairCaseTable/RepairCaseCardList 에도 없었고, 이
 * 화면만 두 컴포넌트를 나란히 뿌려 같은 목록이 표로 한 번, 카드로 한 번 보였다.
 * 이제 다른 목록들과 같이 ResponsiveList 로 감싼다 — 하나만 보이는 것도, 사용자가
 * 요청한 **표/카드 전환 단추**도 그 껍데기가 준다(새로 만들지 않는다).
 *
 * `listId` 는 이 목록만의 이름이어야 한다 — 형제 화면(제품 모델)의
 * `product-model-repair-cases` 와 겹치면 한쪽에서 고른 표/카드가 다른 화면까지
 * 따라간다(responsive-list.tsx 의 storageKeyOf).
 *
 * `stickyHeader` 는 넘기지 않는다(기본 꺼짐). 켜려면 부르는 쪽이 확정 높이를 가진
 * 세로 flex 상자여야 하는데 이 화면은 아니다 — responsive-list.tsx 헤더 참조.
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
    <ResponsiveList
      listId="customer-repair-cases"
      meta={<span className="mr-auto text-xs text-zinc-500 dark:text-zinc-400">{sortedRows.length}건</span>}
      measureKey={[sortedRows.length]}
      table={<RepairCaseTable rows={sortedRows} sort={sort} onSortChange={handleSortChange} />}
      cards={<RepairCaseCardList rows={sortedRows} />}
    />
  );
}
