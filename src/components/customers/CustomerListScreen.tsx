"use client";

import { useMemo, useState } from "react";
import { LIST_CARD_GRID, ResponsiveList } from "@/components/common/responsive-list";
import Link from "next/link";
import type { CustomerListRow } from "@/lib/db/queries/customers";
import { rankSimilarNames } from "@/lib/domain/entity-name-match";

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

/**
 * /customers list. Search reuses rankSimilarNames (entity-name-match.ts) —
 * the exact same normalized substring/prefix ranking the intake form's
 * customer combobox already uses, so "고객사 검색" behaves the way users
 * already expect from A/S 접수/편집's own customer field, not a second,
 * different matching rule.
 *
 * Responsive table/card switch follows the current 전체 A/S 현황 convention
 * — an intentional `lg:` breakpoint (not overflow-measured): this list is
 * only 5 columns and never needs the compact-column treatment RepairCaseTable
 * required, but the same threshold keeps every list screen in the app
 * switching to cards at the same point.
 */
export default function CustomerListScreen({ rows }: { rows: CustomerListRow[] }) {
  const [query, setQuery] = useState("");

  const filteredRows = useMemo(() => rankSimilarNames(query, rows), [query, rows]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">고객사 관리</h1>
      </div>

      <label className="flex flex-col gap-1 text-xs">
        <span className="sr-only">고객사 검색</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="고객사명 검색"
          className="w-full max-w-md rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      <p aria-live="polite" className="text-sm text-zinc-600 dark:text-zinc-400">
        조건에 맞는 고객사 {filteredRows.length}건
      </p>

      {filteredRows.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          {rows.length === 0 ? "등록된 고객사가 없습니다." : "검색 조건에 맞는 고객사가 없습니다."}
        </div>
      ) : (
        <ResponsiveList
          listId="customers"
          table={
            <div className="overflow-x-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-white text-left text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                  <th className="px-3 py-2">고객사명</th>
                  <th className="px-3 py-2">End-User 수</th>
                  <th className="px-3 py-2">A/S 접수 건수</th>
                  <th className="px-3 py-2">등록일</th>
                  <th className="px-3 py-2">상세</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
                  >
                    <td className="px-3 py-2 font-medium whitespace-nowrap text-zinc-900 dark:text-zinc-50">
                      {row.name}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{row.endUserCount}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{row.repairCaseCount}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(row.createdAt)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link
                        href={`/customers/${row.id}`}
                        className="text-sm text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
                      >
                        상세
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          }
          cards={
            <div className={LIST_CARD_GRID}>
            {filteredRows.map((row) => (
              <Link
                key={row.id}
                href={`/customers/${row.id}`}
                className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/60"
              >
                <span className="font-semibold text-zinc-900 dark:text-zinc-50">{row.name}</span>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-500">End-User 수</dt>
                    <dd>{row.endUserCount}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-500">A/S 접수 건수</dt>
                    <dd>{row.repairCaseCount}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-500">등록일</dt>
                    <dd>{formatDate(row.createdAt)}</dd>
                  </div>
                </dl>
              </Link>
            ))}
            </div>
          }
        />
      )}
    </div>
  );
}
