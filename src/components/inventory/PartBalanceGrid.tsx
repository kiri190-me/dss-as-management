"use client";

import { useState } from "react";
import ConsumeStockDialog, { type RepairCaseOption } from "./ConsumeStockDialog";
import ReturnStockDialog from "./ReturnStockDialog";
import type { PartBalanceRow, ReturnableUseRow } from "@/lib/db/queries/inventory";
import { stockOwnerLabels } from "@/lib/domain/inventory-types";
import type { InventoryCapabilities } from "@/lib/auth/inventory-capabilities";
import type { Role } from "@/lib/domain/types";

type SelectedAction = { balanceId: string; action: "CONSUME" | "RETURN" } | null;

/**
 * Balance table + the two per-bucket transaction dialogs. Deliberately a
 * single shared dialog pair rendered once, outside the <table> — a native
 * <dialog> cannot be a valid child of <tr>/<tbody>, so dialog state is
 * lifted here instead of living inside each row.
 */
export default function PartBalanceGrid({
  balances,
  returnableByBalanceId,
  repairCaseOptions,
  actingUserRole,
  capabilities,
}: {
  balances: PartBalanceRow[];
  returnableByBalanceId: Record<string, ReturnableUseRow[]>;
  repairCaseOptions: RepairCaseOption[];
  /** ConsumeStockDialog의 '소비처 전용' 규칙에만 쓰인다 — 권한 판정용이 아니다. */
  actingUserRole: Role;
  capabilities: InventoryCapabilities;
}) {
  const [selected, setSelected] = useState<SelectedAction>(null);

  const selectedBalance = selected ? balances.find((b) => b.id === selected.balanceId) : null;
  const selectedReturnables = selected ? (returnableByBalanceId[selected.balanceId] ?? []) : [];
  // 사용과 반품은 같은 노드(inventory.stock)가 지배한다 — 지금 정책에서도 두
  // 조작의 역할 집합이 같았고, 하위 기능 트리는 그 사실을 그대로 옮겼다.
  const showUseButton = capabilities.stock;
  const showReturnButton = capabilities.stock;

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2">소유 구분</th>
              <th className="px-3 py-2">위치</th>
              <th className="px-3 py-2 text-right">현재 수량</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {balances.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-500 dark:text-zinc-400">
                  아직 입고된 재고가 없습니다.
                </td>
              </tr>
            ) : (
              balances.map((balance) => {
                const returnableCount = returnableByBalanceId[balance.id]?.length ?? 0;
                return (
                  <tr key={balance.id} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="px-3 py-2">{stockOwnerLabels[balance.owner]}</td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{balance.location}</td>
                    <td className="px-3 py-2 text-right text-zinc-900 dark:text-zinc-50">{balance.currentQuantity}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        {showUseButton && (
                          <button
                            type="button"
                            onClick={() => setSelected({ balanceId: balance.id, action: "CONSUME" })}
                            className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                          >
                            사용
                          </button>
                        )}
                        {showReturnButton && (
                          <button
                            type="button"
                            onClick={() => setSelected({ balanceId: balance.id, action: "RETURN" })}
                            disabled={returnableCount === 0}
                            className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                          >
                            반환
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {selectedBalance && (
        <>
          <ConsumeStockDialog
            isOpen={selected?.action === "CONSUME"}
            onClose={() => setSelected(null)}
            partStockBalanceId={selectedBalance.id}
            expectedVersion={selectedBalance.version}
            repairCaseOptions={repairCaseOptions}
            actingUserRole={actingUserRole}
          />
          <ReturnStockDialog
            isOpen={selected?.action === "RETURN"}
            onClose={() => setSelected(null)}
            expectedVersion={selectedBalance.version}
            returnableUses={selectedReturnables}
          />
        </>
      )}
    </>
  );
}
