"use client";

import { useMemo, useState } from "react";
import { LIST_CARD_GRID, ResponsiveList } from "@/components/common/responsive-list";
import Link from "next/link";
import type { ProductModelListRow } from "@/lib/db/queries/product-models";

const KIND_LABELS: Record<string, string> = {
  GENERATOR: "Generator",
  MATCHER: "Matcher",
  TOTAL_CONTROLLER: "Total Controller (T/C)",
};

function kindLabel(kind: string | null): string {
  return kind ? (KIND_LABELS[kind] ?? kind) : "미지정";
}

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

/**
 * /product-models list — now sourced from the real product_models master
 * table (migration 0030), not a raw products.model_name grouping. Every
 * count still follows product_model_id linkage (see product-models.ts).
 * Search stays a plain, case-sensitive substring match on modelName —
 * unchanged from before, since normalized search still isn't part of the
 * approved scope for this screen.
 *
 * Responsive table/card switch follows the same intentional `lg:`
 * breakpoint convention as every other list screen in the app.
 */
export default function ProductModelListScreen({ rows }: { rows: ProductModelListRow[] }) {
  const [query, setQuery] = useState("");

  const filteredRows = useMemo(() => {
    if (!query) return rows;
    return rows.filter((row) => row.modelName.includes(query));
  }, [query, rows]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">제품 모델 관리</h1>
      </div>

      <label className="flex flex-col gap-1 text-xs">
        <span className="sr-only">모델명 검색</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="모델명 검색"
          className="w-full max-w-md rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      <p aria-live="polite" className="text-sm text-zinc-600 dark:text-zinc-400">
        조건에 맞는 모델 {filteredRows.length}건
      </p>

      {filteredRows.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          {rows.length === 0 ? "등록된 제품 모델이 없습니다." : "검색 조건에 맞는 모델이 없습니다."}
        </div>
      ) : (
        <ResponsiveList
          listId="product-models"
          table={
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-white text-left text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                  <th className="px-3 py-2">모델명</th>
                  <th className="px-3 py-2">제품 종류</th>
                  <th className="px-3 py-2">제조사</th>
                  <th className="px-3 py-2">등록 장비 수</th>
                  <th className="px-3 py-2">A/S 접수 건수</th>
                  <th className="px-3 py-2">최근 입고일</th>
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
                      {row.modelName}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{kindLabel(row.kind)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{row.manufacturer ?? "-"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{row.unitCount}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{row.repairCaseCount}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(row.lastReceivedAt)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link
                        href={`/product-models/${row.id}`}
                        className="text-sm text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
                      >
                        상세
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

          }
          cards={
            <div className={LIST_CARD_GRID}>
            {filteredRows.map((row) => (
              <Link
                key={row.id}
                href={`/product-models/${row.id}`}
                className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/60"
              >
                <span className="font-semibold text-zinc-900 dark:text-zinc-50">{row.modelName}</span>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-500">제품 종류</dt>
                    <dd>{kindLabel(row.kind)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-500">제조사</dt>
                    <dd>{row.manufacturer ?? "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-500">등록 장비 수</dt>
                    <dd>{row.unitCount}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-500">A/S 접수 건수</dt>
                    <dd>{row.repairCaseCount}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-500">최근 입고일</dt>
                    <dd>{formatDate(row.lastReceivedAt)}</dd>
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
