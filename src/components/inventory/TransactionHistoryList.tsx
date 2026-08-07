import type { StockTransactionRow } from "@/lib/db/queries/inventory";
import { stockOwnerLabels, stockTransactionTypeLabels } from "@/lib/domain/inventory-types";

/** Newest-first, append-only history — same read-only presentation convention as ExecutionHistoryTimeline (Phase 5A). */
export default function TransactionHistoryList({ history }: { history: StockTransactionRow[] }) {
  if (history.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">거래 이력이 없습니다.</p>;
  }

  return (
    <ol className="flex flex-col gap-2">
      {history.map((row) => (
        <li key={row.id} className="rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-800">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-zinc-800 dark:text-zinc-200">
              {stockTransactionTypeLabels[row.transactionType]} {row.quantityDelta > 0 ? "+" : ""}
              {row.quantityDelta}
            </span>
            <span className="text-zinc-500 dark:text-zinc-400">{new Date(row.createdAt).toLocaleString("ko-KR")}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-zinc-500 dark:text-zinc-400">
            <span>
              {stockOwnerLabels[row.owner]} / {row.location}
            </span>
            <span>담당: {row.actorName}</span>
            <span>변경 후: {row.resultingQuantity}</span>
            {row.repairCaseIntakeNumber && <span>수리 건: {row.repairCaseIntakeNumber}</span>}
            {row.destinationNote && <span>사용처: {row.destinationNote}</span>}
          </div>
          {row.reason && <div className="mt-1 text-zinc-600 dark:text-zinc-300">사유: {row.reason}</div>}
        </li>
      ))}
    </ol>
  );
}
