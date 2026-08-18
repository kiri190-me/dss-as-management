"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { partiallyCloseRequestAction } from "@/lib/server/actions/inventory-part-requests";
import { generateClientUuid } from "@/lib/client-uuid";

/** 부분 불출 종료 — only ever offered for a PARTIALLY_ISSUED request with something already issued and something still remaining (server re-verifies independently); reason required. Request-lifecycle closure only, no purchasing/backorder implication. */
export default function PartiallyCloseRequestDialog({
  isOpen,
  onClose,
  requestId,
  intakeNumber,
}: {
  isOpen: boolean;
  onClose: () => void;
  requestId: string;
  intakeNumber: string;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      setReason("");
      setErrorMessage(null);
      idempotencyKeyRef.current = null;
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  async function handleSubmit() {
    if (!reason.trim()) {
      setErrorMessage("종료 사유를 입력해 주세요.");
      return;
    }
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = generateClientUuid();
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await partiallyCloseRequestAction({ requestId, reason, idempotencyKey: idempotencyKeyRef.current });
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
      aria-labelledby="partially-close-request-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onClose();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="partially-close-request-dialog-title" className="text-sm font-semibold">
        부분 불출 종료 — {intakeNumber}
      </h2>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        이미 불출된 수량은 그대로 유지되고, 남은 미불출 수량에 대한 요청만 종료됩니다. 이후 추가 불출은 불가능합니다.
      </p>
      <label className="mt-3 flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
        종료 사유
        <textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </label>
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
          {isSubmitting ? "처리 중..." : "종료 확정"}
        </button>
      </div>
    </dialog>
  );
}
