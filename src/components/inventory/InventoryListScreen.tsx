"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import PartCreateDialog from "./PartCreateDialog";
import InventoryTabs from "./InventoryTabs";
import type { PartListRow } from "@/lib/db/queries/inventory";
import { STOCK_OWNER_CODES, stockOwnerLabels, type StockOwner } from "@/lib/domain/inventory-types";
import type { InventoryCapabilities } from "@/lib/auth/inventory-capabilities";
import { LIST_CARD_GRID, ResponsiveList } from "@/components/common/responsive-list";

/* 역할 규칙의 로컬 사본이 여기 있었다. 서버가 설정까지 반영해 해석한 결과를
   capabilities로 내려보내므로 더는 필요 없다 — 사본이 남아 있으면 관리자가
   열어 준 권한이 버튼에는 반영되지 않는다. */

type OwnerAvailability = Record<string, Partial<Record<StockOwner, number>>>;

/**
 * Excel-like 부품 재고 list — client-side search/filter over the full
 * server-fetched list (the real workbook audit found a small real catalog,
 * so a single round-trip + in-memory filter keeps this simple and instant,
 * matching the requested "Excel-like table" feel more directly than
 * per-keystroke server queries would).
 *
 * ── 보기 방식이 둘인 이유 ───────────────────────────────────────────────
 * 표에서는 소유 구분 네 칸이 마지막 열 하나에 작은 배지로 우겨넣어져 있어서,
 * "교산 재고가 몇 개인가"를 보려면 눈을 가늘게 떠야 했다. 카드에서는 각 구분에
 * 자기 자리를 준다.
 *
 * 그래도 표를 남긴 것은, 부품이 수백 개로 늘면 카드가 세로로 길어져 훑기가
 * 어려워지기 때문이다. 둘 중 무엇이 맞는지는 그날 무엇을 찾느냐에 달렸다.
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
  ownerAvailabilityByPartId: OwnerAvailability;
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

      <div className="flex flex-wrap items-center gap-2">
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

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 px-3 py-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          검색 결과가 없습니다.
        </p>
      ) : (
        <ResponsiveList
          listId="inventory-parts"
          meta={
            <span className="mr-auto text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
              {filtered.length}건
            </span>
          }
          table={<PartTable parts={filtered} ownerAvailabilityByPartId={ownerAvailabilityByPartId} />}
          cards={
            <ul className={LIST_CARD_GRID}>
              {filtered.map((part) => (
                <PartCard key={part.id} part={part} availability={ownerAvailabilityByPartId[part.id]} />
              ))}
            </ul>
          }
        />
      )}

      <PartCreateDialog isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} categorySuggestions={categories} itemTypeSuggestions={itemTypes} />
    </div>
  );
}

/** 부품 한 장. 표의 여섯 열이 그대로 들어가되, 수량이 말에 묻히지 않게 아래로 내려온다. */
function PartCard({
  part,
  availability,
}: {
  part: PartListRow;
  availability: Partial<Record<StockOwner, number>> | undefined;
}) {
  const isEmpty = part.totalQuantity === 0;

  return (
    <li className="flex flex-col rounded-lg border border-zinc-200 bg-white focus-within:ring-2 focus-within:ring-blue-500 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700">
      <div className="flex flex-col gap-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/inventory/${part.id}`}
            className="font-medium text-blue-700 hover:underline dark:text-blue-400"
          >
            {part.partName}
          </Link>
          {part.category && (
            <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {part.category}
            </span>
          )}
        </div>

        {part.partSpec && (
          <p className="text-xs text-zinc-600 dark:text-zinc-300">{part.partSpec}</p>
        )}

        <dl className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          <div className="flex gap-1">
            <dt>교산</dt>
            <dd className="tabular-nums text-zinc-600 dark:text-zinc-300">{part.kyosanPartNo ?? "-"}</dd>
          </div>
          <div className="flex gap-1">
            <dt>도번</dt>
            <dd className="tabular-nums text-zinc-600 dark:text-zinc-300">{part.drawingNo ?? "-"}</dd>
          </div>
        </dl>
      </div>

      {/* 수량 구역 — 이 화면을 고친 이유가 여기다. */}
      <div className="mt-auto border-t border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">총 재고</span>
          <span
            className={`text-xl font-semibold tabular-nums ${
              isEmpty ? "text-zinc-400 dark:text-zinc-500" : "text-zinc-900 dark:text-zinc-50"
            }`}
          >
            {part.totalQuantity}
          </span>
        </div>

        <dl className="mt-2 grid grid-cols-2 gap-1">
          {STOCK_OWNER_CODES.map((owner) => {
            const quantity = availability?.[owner] ?? 0;
            const isZero = quantity === 0;
            return (
              <div
                key={owner}
                className={`flex items-baseline justify-between rounded px-2 py-1 ${
                  isZero ? "bg-zinc-50 dark:bg-zinc-900" : "bg-zinc-100 dark:bg-zinc-800"
                }`}
              >
                <dt
                  className={`text-[11px] ${
                    isZero ? "text-zinc-400 dark:text-zinc-500" : "text-zinc-600 dark:text-zinc-300"
                  }`}
                >
                  {stockOwnerLabels[owner]}
                </dt>
                {/* 0을 흐리게 두는 것이 핵심이다 — 재고가 있는 구분만 눈에 들어온다. */}
                <dd
                  className={`text-sm tabular-nums ${
                    isZero
                      ? "text-zinc-400 dark:text-zinc-600"
                      : "font-medium text-zinc-900 dark:text-zinc-50"
                  }`}
                >
                  {quantity}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </li>
  );
}

/**
 * 부품이 많을 때 훑는 용도.
 *
 * ── 소유 구분에 열을 하나씩 준다 ────────────────────────────────────────
 * 전에는 네 구분이 마지막 열 하나에 작은 배지로 들어가 있었다. 그러면 "교산
 * 재고가 있는 부품만 보자"처럼 한 구분을 세로로 훑는 일이 불가능하다 — 값이
 * 줄마다 다른 가로 위치에 있기 때문이다. 표에서 그 일을 할 수 있게 하는 것은
 * 열뿐이라, 구분마다 열을 준다.
 *
 * 머리글을 두 줄로 묶어 네 열이 한 덩어리임을 보인다. 그 덕에 화면 아래 있던
 * 범례도 없앴다 — 열 이름이 곧 범례다.
 */
function PartTable({
  parts,
  ownerAvailabilityByPartId,
}: {
  parts: PartListRow[];
  ownerAvailabilityByPartId: OwnerAvailability;
}) {
  return (
      <table className="w-full min-w-[56rem] text-sm">
        <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          <tr>
            <th scope="col" rowSpan={2} className="px-3 py-2 align-bottom">품명</th>
            <th scope="col" rowSpan={2} className="px-3 py-2 align-bottom">품명2</th>
            <th scope="col" rowSpan={2} className="px-3 py-2 align-bottom">교산 품번</th>
            <th scope="col" rowSpan={2} className="px-3 py-2 align-bottom">도번</th>
            <th scope="col" rowSpan={2} className="px-3 py-2 align-bottom">분류</th>
            <th
              scope="colgroup"
              colSpan={STOCK_OWNER_CODES.length}
              className="border-l border-zinc-200 px-3 pt-2 pb-0.5 text-center dark:border-zinc-800"
            >
              소유 구분
            </th>
            <th
              scope="col"
              rowSpan={2}
              className="border-l border-zinc-200 px-3 py-2 text-right align-bottom dark:border-zinc-800"
            >
              총 재고
            </th>
          </tr>
          <tr>
            {STOCK_OWNER_CODES.map((owner, index) => (
              <th
                key={owner}
                scope="col"
                className={`px-3 pb-2 text-right font-normal ${
                  index === 0 ? "border-l border-zinc-200 dark:border-zinc-800" : ""
                }`}
              >
                {stockOwnerLabels[owner]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {parts.map((p) => (
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

              {STOCK_OWNER_CODES.map((owner, index) => {
                const quantity = ownerAvailabilityByPartId[p.id]?.[owner] ?? 0;
                // 0을 흐리게 두는 것은 카드와 같은 이유다 — 재고가 있는 칸만
                // 눈에 들어와야 열을 세로로 훑는 것이 빨라진다.
                return (
                  <td
                    key={owner}
                    className={`px-3 py-2 text-right tabular-nums ${
                      index === 0 ? "border-l border-zinc-200 dark:border-zinc-800" : ""
                    } ${
                      quantity === 0
                        ? "text-zinc-300 dark:text-zinc-600"
                        : "text-zinc-900 dark:text-zinc-50"
                    }`}
                  >
                    {quantity}
                  </td>
                );
              })}

              <td
                className={`border-l border-zinc-200 px-3 py-2 text-right font-semibold tabular-nums dark:border-zinc-800 ${
                  p.totalQuantity === 0
                    ? "text-zinc-400 dark:text-zinc-500"
                    : "text-zinc-900 dark:text-zinc-50"
                }`}
              >
                {p.totalQuantity}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
  );
}
