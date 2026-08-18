"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { issuePartRequestAction } from "@/lib/server/actions/inventory-part-requests";
import type { ManagerPartRequestRow, IssuableBalanceRow } from "@/lib/db/queries/inventory-part-requests";
import { stockOwnerLabels, stockOwnerLabelOrUnspecified } from "@/lib/domain/inventory-types";

type AllocationRow = { key: string; requestItemId: string; partStockBalanceId: string; quantity: string };

/**
 * 불출 dialog — one manager confirmation = one issue event (plan). Supports
 * split-bucket issue: each request item can have one or more allocation
 * rows, each drawing from a different concrete owner/location balance. The
 * server re-validates everything live under lock (remaining quantity,
 * physical stock, case lock, request status) regardless of what this
 * dialog shows — availability shown here is only as current as the last
 * page load.
 */
export default function IssuePartRequestDialog({
  isOpen,
  onClose,
  request,
  balancesByPartId,
}: {
  isOpen: boolean;
  onClose: () => void;
  request: ManagerPartRequestRow;
  balancesByPartId: Map<string, IssuableBalanceRow[]>;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<AllocationRow[]>([]);
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  const remainingItems = request.items.filter((item) => item.requestedQuantity - item.issuedQuantity > 0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      const initialRows: AllocationRow[] = remainingItems.map((item) => {
        const remaining = item.requestedQuantity - item.issuedQuantity;
        const balances = balancesByPartId.get(item.partId) ?? [];
        const firstBalance = balances[0];
        const defaultQuantity = firstBalance ? Math.min(remaining, firstBalance.currentQuantity) : 0;
        return {
          key: `${item.id}-0`,
          requestItemId: item.id,
          partStockBalanceId: firstBalance?.id ?? "",
          quantity: defaultQuantity > 0 ? String(defaultQuantity) : "",
        };
      });
      setRows(initialRows);
      setNote("");
      setErrorMessage(null);
      idempotencyKeyRef.current = null;
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function addRow(requestItemId: string) {
    setRows((prev) => [...prev, { key: `${requestItemId}-${prev.length}`, requestItemId, partStockBalanceId: "", quantity: "" }]);
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  function updateRow(key: string, patch: Partial<AllocationRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function getOrCreateIdempotencyKey(): string {
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();
    return idempotencyKeyRef.current;
  }

  async function handleSubmit() {
    const allocations: { requestItemId: string; partStockBalanceId: string; quantity: number }[] = [];
    for (const row of rows) {
      const quantity = Number(row.quantity);
      if (!row.quantity) continue; // an untouched/blank row is simply not included this round
      if (!row.partStockBalanceId) {
        setErrorMessage("불출할 재고 버킷을 선택해 주세요.");
        return;
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        setErrorMessage("불출 수량은 1 이상의 정수여야 합니다.");
        return;
      }
      allocations.push({ requestItemId: row.requestItemId, partStockBalanceId: row.partStockBalanceId, quantity });
    }
    if (allocations.length === 0) {
      setErrorMessage("불출할 항목을 1개 이상 입력해 주세요.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await issuePartRequestAction({
      requestId: request.id,
      allocations,
      note: note || null,
      idempotencyKey: getOrCreateIdempotencyKey(),
    });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="issue-part-request-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onClose();
      }}
      className="w-full max-w-2xl rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="issue-part-request-dialog-title" className="text-sm font-semibold">
        불출 — {request.intakeNumber}
      </h2>

      <div className="mt-3 flex flex-col gap-3">
        {remainingItems.map((item) => {
          const balances = balancesByPartId.get(item.partId) ?? [];
          const itemRows = rows.filter((r) => r.requestItemId === item.id);
          const remaining = item.requestedQuantity - item.issuedQuantity;
          return (
            <div key={item.id} className="rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{item.partName}</span>
                <span className="text-zinc-500 dark:text-zinc-400">
                  요청 {item.requestedQuantity} / 불출 {item.issuedQuantity} / 남음 {remaining} · 요청 소유구분: {stockOwnerLabelOrUnspecified(item.owner)}
                </span>
              </div>
              <div className="mt-2 flex flex-col gap-1">
                {itemRows.map((row) => (
                  <div key={row.key} className="flex items-center gap-2">
                    <select
                      value={row.partStockBalanceId}
                      onChange={(e) => updateRow(row.key, { partStockBalanceId: e.target.value })}
                      className="flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <option value="">버킷 선택</option>
                      {balances.map((b) => (
                        <option key={b.id} value={b.id}>
                          {stockOwnerLabels[b.owner]} / {b.location} (현재 {b.currentQuantity}개)
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      placeholder="수량"
                      value={row.quantity}
                      onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                      className="w-20 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <button type="button" onClick={() => removeRow(row.key)} className="text-zinc-400 hover:text-red-600">
                      삭제
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => addRow(item.id)} className="self-start text-xs text-blue-700 hover:underline dark:text-blue-400">
                  + 버킷 추가 (분할 불출)
                </button>
              </div>
            </div>
          );
        })}

        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          불출 메모 (선택)
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </label>
      </div>

      {errorMessage && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          취소
        </button>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={isSubmitting}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {isSubmitting ? "처리 중..." : "불출 확정"}
        </button>
      </div>
    </dialog>
  );
}
