"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { consumeStockAction } from "@/lib/server/actions/inventory";

export type RepairCaseOption = { id: string; intakeNumber: string; assignedEngineerId: string | null };

/**
 * 사용 (USE) dialog. AS_ENGINEER can never submit a destination-only USE in
 * Phase 5B-2 (plan §9) — the mode toggle still offers it for other roles,
 * but the server re-checks role/assignment/lock independently regardless
 * of what this dialog allows through, so hiding it here is a UX
 * convenience only, never the enforcement boundary.
 */
export default function ConsumeStockDialog({
  isOpen,
  onClose,
  partStockBalanceId,
  expectedVersion,
  repairCaseOptions,
  actingUserRole,
}: {
  isOpen: boolean;
  onClose: () => void;
  partStockBalanceId: string;
  expectedVersion: number;
  repairCaseOptions: RepairCaseOption[];
  actingUserRole: string;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const canUseDestinationOnly = actingUserRole !== "AS_ENGINEER";
  const [mode, setMode] = useState<"CASE" | "DESTINATION">("CASE");
  const [repairCaseId, setRepairCaseId] = useState("");
  const [destinationNote, setDestinationNote] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      setMode("CASE");
      setRepairCaseId(repairCaseOptions[0]?.id ?? "");
      setDestinationNote("");
      setQuantity("1");
      setReason("");
      setErrorMessage(null);
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen, repairCaseOptions]);

  async function handleSubmit() {
    const parsedQuantity = Number(quantity);
    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      setErrorMessage("수량은 1 이상의 정수여야 합니다.");
      return;
    }
    if (mode === "CASE" && !repairCaseId) {
      setErrorMessage("수리 건을 선택해 주세요.");
      return;
    }
    if (mode === "DESTINATION" && !destinationNote.trim()) {
      setErrorMessage("사용처를 입력해 주세요.");
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await consumeStockAction({
      partStockBalanceId,
      quantity: parsedQuantity,
      expectedVersion,
      repairCaseId: mode === "CASE" ? repairCaseId : null,
      destinationNote: mode === "DESTINATION" ? destinationNote : null,
      reason: reason || null,
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
      aria-labelledby="consume-stock-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onClose();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="consume-stock-dialog-title" className="text-sm font-semibold">
        사용
      </h2>

      {canUseDestinationOnly && (
        <div className="mt-3 flex gap-3 text-xs text-zinc-600 dark:text-zinc-300">
          <label className="flex items-center gap-1">
            <input type="radio" name="consume-mode" checked={mode === "CASE"} onChange={() => setMode("CASE")} />
            수리 건 연결
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="consume-mode" checked={mode === "DESTINATION"} onChange={() => setMode("DESTINATION")} />
            사용처 직접 입력
          </label>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2">
        {mode === "CASE" ? (
          <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            수리 건
            <select
              value={repairCaseId}
              onChange={(event) => setRepairCaseId(event.target.value)}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            >
              <option value="">선택하세요</option>
              {repairCaseOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.intakeNumber}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            사용처
            <input
              type="text"
              placeholder="예: 상해수리소"
              value={destinationNote}
              onChange={(event) => setDestinationNote(event.target.value)}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          수량
          <input
            type="number"
            min={1}
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
          {isSubmitting ? "처리 중..." : "사용"}
        </button>
      </div>
    </dialog>
  );
}
