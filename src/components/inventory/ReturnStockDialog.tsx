"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { returnStockAction } from "@/lib/server/actions/inventory";
import type { ReturnableUseRow } from "@/lib/db/queries/inventory";

/** 반환 (RETURN) — always reverses a specific prior USE (plan §6), so the dialog's primary field is picking which USE to reverse, not a bare quantity form. */
export default function ReturnStockDialog({
  isOpen,
  onClose,
  expectedVersion,
  returnableUses,
}: {
  isOpen: boolean;
  onClose: () => void;
  expectedVersion: number;
  returnableUses: ReturnableUseRow[];
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reversalOfId, setReversalOfId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      setReversalOfId(returnableUses[0]?.useTransactionId ?? "");
      setQuantity("1");
      setReason("");
      setErrorMessage(null);
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen, returnableUses]);

  const selected = returnableUses.find((u) => u.useTransactionId === reversalOfId);

  async function handleSubmit() {
    const parsedQuantity = Number(quantity);
    if (!reversalOfId) {
      setErrorMessage("반환할 사용 이력을 선택해 주세요.");
      return;
    }
    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      setErrorMessage("수량은 1 이상의 정수여야 합니다.");
      return;
    }
    if (selected && parsedQuantity > selected.returnableQuantity) {
      setErrorMessage(`반환 가능한 최대 수량은 ${selected.returnableQuantity}개입니다.`);
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await returnStockAction({ reversalOfId, quantity: parsedQuantity, expectedVersion, reason: reason || null });
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
      aria-labelledby="return-stock-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onClose();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="return-stock-dialog-title" className="text-sm font-semibold">
        반환
      </h2>

      {returnableUses.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">반환 가능한 사용 이력이 없습니다.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            반환 대상 (원본 사용 이력)
            <select
              value={reversalOfId}
              onChange={(event) => setReversalOfId(event.target.value)}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            >
              {returnableUses.map((u) => (
                <option key={u.useTransactionId} value={u.useTransactionId}>
                  {new Date(u.createdAt).toLocaleDateString("ko-KR")} · {u.repairCaseIntakeNumber ?? u.destinationNote ?? "-"} · 반환 가능 {u.returnableQuantity}개
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            수량 {selected ? `(최대 ${selected.returnableQuantity})` : ""}
            <input
              type="number"
              min={1}
              max={selected?.returnableQuantity}
              step={1}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            사유 (선택)
            <textarea
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </label>
        </div>
      )}

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
        {returnableUses.length > 0 && (
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {isSubmitting ? "처리 중..." : "반환"}
          </button>
        )}
      </div>
    </dialog>
  );
}
