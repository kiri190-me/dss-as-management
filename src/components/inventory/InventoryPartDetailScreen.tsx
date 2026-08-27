import Link from "next/link";
import PartDetailHeaderActions from "./PartDetailHeaderActions";
import PartBalanceGrid from "./PartBalanceGrid";
import PartMinimumQuantitySection from "./PartMinimumQuantitySection";
import TransactionHistoryList from "./TransactionHistoryList";
import type { RepairCaseOption } from "./ConsumeStockDialog";
import type { PartDetail, StockTransactionRow, ReturnableUseRow } from "@/lib/db/queries/inventory";
import type { PartMinimumQuantityRow } from "@/lib/db/queries/part-minimum-quantities";
import { STOCK_OWNER_CODES, type StockOwner } from "@/lib/domain/inventory-types";
import type { Role } from "@/lib/domain/types";
import type { InventoryCapabilities } from "@/lib/auth/inventory-capabilities";

export default function InventoryPartDetailScreen({
  part,
  history,
  minimumQuantities,
  returnableByBalanceId,
  categorySuggestions,
  itemTypeSuggestions,
  repairCaseOptions,
  actingUser,
  capabilities,
}: {
  part: PartDetail;
  history: StockTransactionRow[];
  /** 정해진 것만 온다 — 없는 소유자는 "정하지 않음"이다(0 이 아니다). */
  minimumQuantities: PartMinimumQuantityRow[];
  returnableByBalanceId: Record<string, ReturnableUseRow[]>;
  categorySuggestions: string[];
  itemTypeSuggestions: string[];
  repairCaseOptions: RepairCaseOption[];
  actingUser: { id: string; role: Role };
  capabilities: InventoryCapabilities;
}) {
  const totalQuantity = part.balances.reduce((sum, b) => sum + b.currentQuantity, 0);

  // 소유자별 지금 수량 = 그 소유자의 **위치를 모두 합한** 값. 부족 조회가 DB에서
  // 쓰는 것과 같은 셈법이라, 화면의 숫자와 알림의 숫자가 갈라지지 않는다.
  const quantityByOwner = new Map<StockOwner, number>();
  for (const balance of part.balances) {
    quantityByOwner.set(balance.owner, (quantityByOwner.get(balance.owner) ?? 0) + balance.currentQuantity);
  }
  const minimumByOwner = new Map(minimumQuantities.map((row) => [row.owner, row.minimumQuantity]));
  // 넷을 모두 줄로 만든다 — 재고 행이 없는 소유자에도 한계수량을 걸 수 있어야 한다.
  const minimumQuantityRows = STOCK_OWNER_CODES.map((owner) => ({
    owner,
    currentQuantity: quantityByOwner.get(owner) ?? 0,
    minimumQuantity: minimumByOwner.get(owner) ?? null,
  }));

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

      <PartMinimumQuantitySection
        partId={part.id}
        rows={minimumQuantityRows}
        // 부품 정보를 고칠 수 있는 사람과 같은 판정이다(inventory.parts WRITE).
        canEdit={capabilities.parts}
      />

      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">거래 이력</h2>
        <div className="mt-2">
          <TransactionHistoryList history={history} />
        </div>
      </div>
    </div>
  );
}
