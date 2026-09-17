"use client";

import { useState, type ReactNode } from "react";
import ConsumeStockDialog, { type RepairCaseOption } from "./ConsumeStockDialog";
import ReturnStockDialog from "./ReturnStockDialog";
import { PART_ISSUE_REQUEST_BUTTON_LABEL } from "./part-issue-approval-texts";
import type { ReturnableUseRow } from "@/lib/db/queries/inventory";
import { stockOwnerLabels, type StockOwner } from "@/lib/domain/inventory-types";
import type { PartOwnerStockRowOf } from "@/lib/domain/part-owner-stock-rows";
import type { InventoryCapabilities } from "@/lib/auth/inventory-capabilities";
import type { Role } from "@/lib/domain/types";

/**
 * ============================================================================
 * 소유 구분별 재고 · 한계수량 — **한 표**다 (2026-09-17 사용자 요청)
 * ============================================================================
 * 예전에는 표가 둘이었다. 「재고 보유 (소유 × 위치)」가 재고 행마다 한 줄,
 * 「단가 · 한계수량」이 소유구분마다 한 줄. 같은 소유 구분을 두 번 읽어야 해서
 * 합쳤다. 칸은 `소유 구분 / 위치 / 현재 수량 / 한계수량 / (부족) / (동작)`.
 *
 * ── 🔴 줄은 소유구분 넷 고정이다 ────────────────────────────────────────
 * 재고 행이 하나도 없는 소유구분도 줄로 그린다. part_stock_balances 는 입고가
 * 있어야 행이 생기므로, 재고가 있는 것만 그리면 "아직 우리 것이 없다"는
 * 소유구분에 한계수량을 걸 자리 자체가 사라진다.
 *
 * ── 🔴 현재 수량은 그 소유의 **위치를 모두 합한** 값이다 ────────────────
 * 위치별로 줄을 쪼개지 않는다. 쪼개면 ⑴ 한계수량이 위치마다 있는 것처럼 보이고
 * ⑵ 부족 배지의 뜻이 깨지며 ⑶ 부족 조회가 DB 에서 쓰는 셈법(소유별 합계)과
 * 갈라져 화면의 숫자와 종 알림의 숫자가 다른 말을 한다.
 * 줄 만들기는 순수 함수 하나에 모여 있다(domain/part-owner-stock-rows.ts).
 *
 * 위치가 여럿이면 「위치」 칸에 **나열**하고, 동작 칸도 그 위치마다 한 줄씩
 * 그린다 — 사용·반환은 재고 행(위치) 하나를 집어 부르는 조작이라 합칠 수 없다.
 * (지금 개발 DB 의 82개 (부품 × 소유) 조합은 모두 위치가 하나다. 다만
 * part_stock_balances 의 유일 제약이 `(part_id, owner, location)` 이라 여럿이
 * 생길 수 있고, 그때 조용히 틀리지 않게 이렇게 그린다.)
 *
 * ── 단가는 이 표 밖이다 ─────────────────────────────────────────────────
 * 소유구분 축이 아니라 부품마다 하나여서 표 위로 나갔다(2026-09-17 사용자 정정,
 * PartMinimumQuantitySection.tsx 머리말). 표 안에 두면 넷 중 한 줄에만 걸리는
 * 값처럼 보인다.
 *
 * ── 한계수량 칸은 폼이 그린다 ───────────────────────────────────────────
 * 이 표는 한계수량 칸의 **자리**만 내준다(renderMinimumQuantityCell). 입력 상태와
 * 저장 단추는 감싸는 폼(PartMinimumQuantitySection)이 통째로 들고 있어야 저장이
 * 한 단추 · 한 트랜잭션으로 남는다.
 *
 * 두 거래 창은 일부러 표 **밖에** 한 벌만 그린다 — 네이티브 <dialog> 는
 * <tr>/<tbody> 의 자식으로 올 수 없어서, 창 상태를 여기로 끌어올렸다.
 * ============================================================================
 */

type SelectedAction = { balanceId: string; action: "CONSUME" | "RETURN" } | null;

/** 이 표가 그리는 한 줄 = 소유구분 하나. 재고 행(위치)은 그 안에 담긴다. */
export type PartOwnerStockRowView = PartOwnerStockRowOf<{
  id: string;
  owner: StockOwner;
  location: string;
  currentQuantity: number;
  version: number;
}>;

export default function PartBalanceGrid({
  rows,
  returnableByBalanceId,
  repairCaseOptions,
  actingUserRole,
  capabilities,
  partIssueApprovalRequired,
  renderMinimumQuantityCell,
}: {
  /** 🔴 소유구분 넷이 모두 들어 있어야 한다 — buildPartOwnerStockRows 가 보장한다. */
  rows: PartOwnerStockRowView[];
  returnableByBalanceId: Record<string, ReturnableUseRow[]>;
  repairCaseOptions: RepairCaseOption[];
  /** ConsumeStockDialog의 '소비처 전용' 규칙에만 쓰인다 — 권한 판정용이 아니다. */
  actingUserRole: Role;
  capabilities: InventoryCapabilities;
  /**
   * 🔴 「부품 불출」 승인 절차가 지금 쓰이고 있는가 — **서버가 문을 다는 데 쓰는
   * 그 판정**을 서버 컴포넌트가 계산해 내려보낸 값이다(inventory/[id]/page.tsx).
   * 참이면 [사용]은 그 자리에서 재고를 빼지 않으므로 이름부터 달라진다.
   * 화면이 다시 판정하지 않는다(두 벌이 되면 단추와 서버가 갈라진다).
   */
  partIssueApprovalRequired: boolean;
  /** 한계수량 칸의 속 — 폼이 그린다(입력칸 또는 읽기 전용 숫자 + 오류 문장). */
  renderMinimumQuantityCell: (owner: StockOwner) => ReactNode;
}) {
  const [selected, setSelected] = useState<SelectedAction>(null);

  const balances = rows.flatMap((row) => row.balances);
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
              <th className="px-3 py-2 text-right">한계수량</th>
              <th className="px-3 py-2" />
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              // 부족 표시는 **저장된** 한계수량으로 판단한다 — 아직 저장하지 않은
              // 숫자로 표시하면 화면이 실제로 걸려 있는 알림과 다른 말을 한다.
              const isShort = row.minimumQuantity !== null && row.currentQuantity < row.minimumQuantity;
              // 위치가 하나뿐이면 동작 칸에 위치를 적지 않는다 — 옆 칸에 이미 있다.
              const showLocationTag = row.balances.length > 1;

              return (
                <tr key={row.owner} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="px-3 py-2 text-zinc-900 dark:text-zinc-50">{stockOwnerLabels[row.owner]}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">
                    {row.balances.length === 0 ? (
                      "-"
                    ) : (
                      <div className="flex flex-col gap-1">
                        {row.balances.map((balance) => (
                          <span key={balance.id} className="leading-6">
                            {balance.location}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      isShort ? "font-semibold text-red-700 dark:text-red-300" : "text-zinc-900 dark:text-zinc-50"
                    }`}
                  >
                    {row.currentQuantity}
                  </td>
                  <td className="px-3 py-2 text-right align-top">{renderMinimumQuantityCell(row.owner)}</td>
                  <td className="px-3 py-2">
                    {isShort && (
                      <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                        부족
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col items-end gap-1">
                      {row.balances.map((balance) => {
                        const returnableCount = returnableByBalanceId[balance.id]?.length ?? 0;
                        return (
                          <div key={balance.id} className="flex items-center justify-end gap-2">
                            {showLocationTag && (
                              <span className="text-xs text-zinc-500 dark:text-zinc-400">{balance.location}</span>
                            )}
                            {showUseButton && (
                              <button
                                type="button"
                                onClick={() => setSelected({ balanceId: balance.id, action: "CONSUME" })}
                                className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                              >
                                {partIssueApprovalRequired ? PART_ISSUE_REQUEST_BUTTON_LABEL : "사용"}
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
                        );
                      })}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {balances.length === 0 && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          아직 입고된 재고가 없습니다. 재고가 없는 소유 구분에도 한계수량은 미리 걸어 둘 수 있습니다.
        </p>
      )}

      {selectedBalance && (
        <>
          <ConsumeStockDialog
            isOpen={selected?.action === "CONSUME"}
            onClose={() => setSelected(null)}
            partStockBalanceId={selectedBalance.id}
            expectedVersion={selectedBalance.version}
            repairCaseOptions={repairCaseOptions}
            actingUserRole={actingUserRole}
            approvalRequired={partIssueApprovalRequired}
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
