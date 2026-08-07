import Link from "next/link";
import type { RelatedRepairHistory, RelatedRepairHistoryRow } from "@/lib/db/queries/procedure-case-execution";

function RowList({ rows }: { rows: RelatedRepairHistoryRow[] }) {
  if (rows.length === 0) return <p className="text-xs text-zinc-500 dark:text-zinc-400">해당 이력이 없습니다.</p>;
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((row) => (
        <li key={row.id}>
          <Link href={`/repair-cases/${row.id}`} className="text-xs text-blue-700 hover:underline dark:text-blue-400">
            {row.intakeNumber} — {row.receivedAt}
            {row.actualShipmentDate ? ` (출하: ${row.actualShipmentDate})` : ""}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Plan §12 — conservative tiered product-history matching. The two buckets
 * are kept visually and structurally separate: "동일 제품 이력" (exact
 * serial match — the same physical unit) is never merged with "동일 모델
 * 참고 이력" (model matches only), so a reader can never mistake a
 * different physical unit of the same model for repeat-repair history on
 * this exact product.
 */
export default function RelatedRepairHistoryPanel({ relatedHistory }: { relatedHistory: RelatedRepairHistory }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">동일 제품 이력</h3>
        <div className="mt-1">
          <RowList rows={relatedHistory.sameProduct} />
        </div>
      </div>
      <div>
        <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">동일 모델 참고 이력</h3>
        <div className="mt-1">
          <RowList rows={relatedHistory.sameModelReference} />
        </div>
      </div>
    </div>
  );
}
