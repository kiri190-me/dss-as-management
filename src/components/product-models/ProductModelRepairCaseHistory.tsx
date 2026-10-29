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
 *
 * ── 🔴 **비었을 때 할 말은 부르는 쪽이 안다** (2026-10-29 사용자 결정) ────
 * 이 목록이 년/월로 걸리게 되면서(ProductModelHistoryBreakdown 의 기간 드롭다운)
 * **빈 까닭이 둘**이 되었다: ㉠ 이 모델에 접수 건이 아예 없다 · ㉡ 고른 기간에 인수된
 * 건이 없다. 여기서는 그 둘을 가릴 수 없다 — 넘어오는 것은 **이미 걸러진 배열**이고
 * 기간이 무엇인지 모른다. 그래서 글자를 받는다.
 * 🔵 **안 넘기면 예전 글자 그대로다**(㉠). 기본값을 둔 까닭이 그것이고, 이 화면에서
 *    기간을 안 걸었을 때 한 글자도 안 바뀌어야 한다는 뜻이다.
 */

/** 기간을 안 걸었을 때, 곧 **이 모델에 접수 건이 아예 없을 때**의 글자. */
const NO_REPAIR_CASES_MESSAGE = "이 모델과 연결된 A/S 접수 건이 없습니다.";

export default function ProductModelRepairCaseHistory({
  resolved,
  emptyMessage = NO_REPAIR_CASES_MESSAGE,
}: {
  resolved: ResolvedRepairCase[];
  /**
   * 🔴 **기간으로 걸러 비었을 때** 부르는 쪽이 넘기는 글자(위 머리말 ㉡). 안 넘기면
   * 예전 글자다 — 「연결된 건이 없다」는 말은 기간 때문에 빈 날에는 **거짓말**이 된다.
   */
  emptyMessage?: string;
}) {
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
        {emptyMessage}
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
