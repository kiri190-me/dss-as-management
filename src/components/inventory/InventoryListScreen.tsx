"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import PartCreateDialog from "./PartCreateDialog";
import InventoryTabs from "./InventoryTabs";
import type { PartListRow } from "@/lib/db/queries/inventory";
import { STOCK_OWNER_CODES, stockOwnerLabels, type StockOwner } from "@/lib/domain/inventory-types";
import type { InventoryCapabilities } from "@/lib/auth/inventory-capabilities";

/* 역할 규칙의 로컬 사본이 여기 있었다. 서버가 설정까지 반영해 해석한 결과를
   capabilities로 내려보내므로 더는 필요 없다 — 사본이 남아 있으면 관리자가
   열어 준 권한이 버튼에는 반영되지 않는다. */


/**
 * Excel-like 부품 재고 list — client-side search/filter over the full
 * server-fetched list (the real workbook audit found a small real catalog,
 * so a single round-trip + in-memory filter keeps this simple and instant,
 * matching the requested "Excel-like table" feel more directly than
 * per-keystroke server queries would).
 */
export default function InventoryListScreen({
  parts,
  ownerAvailabilityByPartId,
  categories,
  itemTypes,
  capabilities,
}: {
  parts: PartListRow[];
  /** 소유구분별 재고 수량 checkpoint — grouped (part, owner) sum of part_stock_balances.current_quantity, same aggregate totalQuantity already uses. A missing (partId, owner) entry means 0, never "unknown". */
  ownerAvailabilityByPartId: Record<string, Partial<Record<StockOwner, number>>>;
  categories: string[];
  itemTypes: string[];
  capabilities: InventoryCapabilities;
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

  const canCreate = capabilities.parts;

  return (
    <div className="flex flex-col gap-4">
      {capabilities.requestProcessing && <InventoryTabs active="LIST" />}
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
              <th className="px-3 py-2 text-right">재고 수량</th>
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
                  <td className="px-3 py-2 text-right">
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-zinc-900 dark:text-zinc-50">총 {p.totalQuantity}</span>
                      <div className="flex flex-wrap justify-end gap-1">
                        {STOCK_OWNER_CODES.map((owner) => (
                          <span
                            key={owner}
                            className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                          >
                            {stockOwnerLabels[owner]} {ownerAvailabilityByPartId[p.id]?.[owner] ?? 0}
                          </span>
                        ))}
                      </div>
                    </div>
                  </td>
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
