import Link from "next/link";
import PartDetailHeaderActions from "./PartDetailHeaderActions";
import PartBalanceGrid from "./PartBalanceGrid";
import TransactionHistoryList from "./TransactionHistoryList";
import type { RepairCaseOption } from "./ConsumeStockDialog";
import type { PartDetail, StockTransactionRow, ReturnableUseRow } from "@/lib/db/queries/inventory";
import type { Role } from "@/lib/domain/types";
import type { InventoryCapabilities } from "@/lib/auth/inventory-capabilities";

export default function InventoryPartDetailScreen({
  part,
  history,
  returnableByBalanceId,
  categorySuggestions,
  itemTypeSuggestions,
  repairCaseOptions,
  actingUser,
  capabilities,
}: {
  part: PartDetail;
  history: StockTransactionRow[];
  returnableByBalanceId: Record<string, ReturnableUseRow[]>;
  categorySuggestions: string[];
  itemTypeSuggestions: string[];
  repairCaseOptions: RepairCaseOption[];
  actingUser: { id: string; role: Role };
  capabilities: InventoryCapabilities;
}) {
  const totalQuantity = part.balances.reduce((sum, b) => sum + b.currentQuantity, 0);

  return (
    <div className="flex flex-col gap-4">
      <Link href="/inventory" className="text-xs text-blue-700 hover:underline dark:text-blue-400">
        ← 재고 관리로 돌아가기
      </Link>

      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{part.partName}</h1>
          {part.partSpec && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{part.partSpec}</p>}
        </div>
        <PartDetailHeaderActions part={part} categorySuggestions={categorySuggestions} itemTypeSuggestions={itemTypeSuggestions} capabilities={capabilities} />
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">교산 품번</dt>
            <dd className="text-zinc-900 dark:text-zinc-50">{part.kyosanPartNo ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">도번</dt>
            <dd className="text-zinc-900 dark:text-zinc-50">{part.drawingNo ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">분류</dt>
            <dd className="text-zinc-900 dark:text-zinc-50">{part.category ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">항목</dt>
            <dd className="text-zinc-900 dark:text-zinc-50">{part.itemType ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">총 재고</dt>
            <dd className="text-zinc-900 dark:text-zinc-50">{totalQuantity}</dd>
          </div>
        </dl>
        {part.notes && <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">비고: {part.notes}</p>}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">재고 보유 (소유 × 위치)</h2>
        <div className="mt-2">
          <PartBalanceGrid
            balances={part.balances}
            returnableByBalanceId={returnableByBalanceId}
            repairCaseOptions={repairCaseOptions}
            actingUserRole={actingUser.role}
            capabilities={capabilities}
          />
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">거래 이력</h2>
        <div className="mt-2">
          <TransactionHistoryList history={history} />
        </div>
      </div>
    </div>
  );
}
