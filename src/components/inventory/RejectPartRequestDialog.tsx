"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { rejectPartRequestAction } from "@/lib/server/actions/inventory-part-requests";

/** 거절 — only ever offered for a PENDING, zero-issued request (server re-verifies independently); reason required. */
export default function RejectPartRequestDialog({
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
      setErrorMessage("거절 사유를 입력해 주세요.");
      return;
    }
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await rejectPartRequestAction({ requestId, reason, idempotencyKey: idempotencyKeyRef.current });
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
      aria-labelledby="reject-part-request-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onClose();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="reject-part-request-dialog-title" className="text-sm font-semibold">
        요청 거절 — {intakeNumber}
      </h2>
      <label className="mt-3 flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
        거절 사유
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
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {isSubmitting ? "처리 중..." : "거절 확정"}
        </button>
      </div>
    </dialog>
  );
}
