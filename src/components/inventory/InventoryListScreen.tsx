"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import PartCreateDialog from "./PartCreateDialog";
import type { PartListRow } from "@/lib/db/queries/inventory";
import { STOCK_OWNER_CODES, stockOwnerLabels } from "@/lib/domain/inventory-types";

/** Same string-typed local mirror of canCreateOrEditPart's logic used throughout the Phase 5A client components (e.g. ExecutionNodeCard.tsx) — the server auth module's Role-typed functions aren't meant to be cast from a plain session-derived string prop; this is a UX convenience only, the mutation layer re-checks independently regardless. */
function canCreateOrEditPart(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "INVENTORY_MANAGER";
}

/**
 * Excel-like 부품 재고 list — client-side search/filter over the full
 * server-fetched list (the real workbook audit found a small real catalog,
 * so a single round-trip + in-memory filter keeps this simple and instant,
 * matching the requested "Excel-like table" feel more directly than
 * per-keystroke server queries would).
 */
export default function InventoryListScreen({
  parts,
  categories,
  itemTypes,
  actingUserRole,
}: {
  parts: PartListRow[];
  categories: string[];
  itemTypes: string[];
  actingUserRole: string;
}) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return parts.filter((p) => {
      if (categoryFilter && p.category !== categoryFilter) return false;
      if (!term) return true;
      return (
        p.partName.toLowerCase().includes(term) ||
        (p.partSpec ?? "").toLowerCase().includes(term) ||
        (p.drawingNo ?? "").toLowerCase().includes(term) ||
        (p.kyosanPartNo ?? "").toLowerCase().includes(term)
      );
    });
  }, [parts, search, categoryFilter]);

  const canCreate = canCreateOrEditPart(actingUserRole);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">재고 관리</h1>
        {canCreate && (
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            새 부품 등록
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="품명 / 품명2 / 도번 / 교산 품번 검색"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-72 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        <select
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
          className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        >
          <option value="">전체 분류</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2">품명</th>
              <th className="px-3 py-2">품명2</th>
              <th className="px-3 py-2">교산 품번</th>
              <th className="px-3 py-2">도번</th>
              <th className="px-3 py-2">분류</th>
              <th className="px-3 py-2 text-right">총 재고</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500 dark:text-zinc-400">
                  검색 결과가 없습니다.
                </td>
              </tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.id} className="border-t border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
                  <td className="px-3 py-2">
                    <Link href={`/inventory/${p.id}`} className="text-blue-700 hover:underline dark:text-blue-400">
                      {p.partName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{p.partSpec ?? "-"}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{p.kyosanPartNo ?? "-"}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{p.drawingNo ?? "-"}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{p.category ?? "-"}</td>
                  <td className="px-3 py-2 text-right text-zinc-900 dark:text-zinc-50">{p.totalQuantity}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Reference only — every real owner bucket value, for the reader's context. */}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">소유 구분: {STOCK_OWNER_CODES.map((o) => stockOwnerLabels[o]).join(" · ")}</p>

      <PartCreateDialog isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} categorySuggestions={categories} itemTypeSuggestions={itemTypes} />
    </div>
  );
}
