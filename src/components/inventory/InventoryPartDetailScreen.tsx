import Link from "next/link";
import PartDetailHeaderActions from "./PartDetailHeaderActions";
import PartMinimumQuantitySection from "./PartMinimumQuantitySection";
import TransactionHistoryList from "./TransactionHistoryList";
import type { RepairCaseOption } from "./ConsumeStockDialog";
import type { PartDetail, StockTransactionRow, ReturnableUseRow } from "@/lib/db/queries/inventory";
import type { PartMinimumQuantityRow } from "@/lib/db/queries/part-minimum-quantities";
import { buildPartOwnerStockRows } from "@/lib/domain/part-owner-stock-rows";
import type { Role } from "@/lib/domain/types";
import type { InventoryCapabilities } from "@/lib/auth/inventory-capabilities";

export default function InventoryPartDetailScreen({
  part,
  history,
  minimumQuantities,
  unitPrice,
  returnableByBalanceId,
  categorySuggestions,
  itemTypeSuggestions,
  repairCaseOptions,
  actingUser,
  capabilities,
  partIssueApprovalRequired,
}: {
  part: PartDetail;
  history: StockTransactionRow[];
  /** 정해진 것만 온다 — 없는 소유자는 "정하지 않음"이다(0 이 아니다). */
  minimumQuantities: PartMinimumQuantityRow[];
  /**
   * 이 부품의 단가. **부품마다 하나다** — 소유구분별이 아니다(2026-09-17 사용자
   * 정정, schema/part-unit-prices.ts 머리말). null 이면 "정하지 않음"이고
   * "0"(무상)과 다르다.
   */
  unitPrice: string | null;
  returnableByBalanceId: Record<string, ReturnableUseRow[]>;
  categorySuggestions: string[];
  itemTypeSuggestions: string[];
  repairCaseOptions: RepairCaseOption[];
  actingUser: { id: string; role: Role };
  capabilities: InventoryCapabilities;
  /**
   * 「부품 불출」 승인 절차가 지금 쓰이고 있는가. 잔량 표의 [사용] 단추가
   * [불출 승인 요청]으로 갈리는 데만 쓴다 — 판정은 서버가 하고(page.tsx) 이
   * 화면은 지나가는 자리다.
   */
  partIssueApprovalRequired: boolean;
}) {
  const totalQuantity = part.balances.reduce((sum, b) => sum + b.currentQuantity, 0);

  // 표는 하나다 — 「재고 보유」와 「단가 · 한계수량」을 합쳤다(2026-09-17 사용자 요청).
  // 넷을 모두 줄로 만들고, 소유자별 지금 수량 = 그 소유자의 **위치를 모두 합한**
  // 값이다. 부족 조회가 DB에서 쓰는 것과 같은 셈법이라, 화면의 숫자와 알림의
  // 숫자가 갈라지지 않는다. 그 두 규칙은 순수 함수 하나에 있다
  // (domain/part-owner-stock-rows.ts).
  // 🔴 단가는 여기 없다. 소유구분 축이 아니라 부품마다 하나여서 표 밖으로
  // 나갔다(2026-09-17 사용자 정정).
  const minimumByOwner = new Map(minimumQuantities.map((row) => [row.owner, row.minimumQuantity]));
  const ownerStockRows = buildPartOwnerStockRows(part.balances, minimumByOwner);

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

      <PartMinimumQuantitySection
        partId={part.id}
        rows={ownerStockRows}
        unitPrice={unitPrice}
        // 부품 정보를 고칠 수 있는 사람과 같은 판정이다(inventory.parts WRITE).
        canEdit={capabilities.parts}
        returnableByBalanceId={returnableByBalanceId}
        repairCaseOptions={repairCaseOptions}
        actingUserRole={actingUser.role}
        capabilities={capabilities}
        partIssueApprovalRequired={partIssueApprovalRequired}
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
