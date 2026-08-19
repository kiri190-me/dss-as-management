"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { holdPartRequestAction } from "@/lib/server/actions/inventory-part-requests";
import { generateClientUuid } from "@/lib/client-uuid";

/**
 * 보류 — 아직 끝나지 않은 요청에만 걸린다(서버가 다시 검사한다). 사유 필수.
 *
 * 사유를 반드시 받는 이유는 이 글이 요청을 올린 엔지니어에게 그대로 보이기
 * 때문이다. 접수 건 상세에서 "왜 멈춰 있는지"를 읽지 못하면, 같은 요청을 다시
 * 올리거나 담당자를 찾아다니게 된다. DB의 CHECK 제약도 빈 사유를 거부한다.
 */
export default function HoldPartRequestDialog({
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
      setErrorMessage("보류 사유를 입력해 주세요.");
      return;
    }
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = generateClientUuid();
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await holdPartRequestAction({ requestId, reason, idempotencyKey: idempotencyKeyRef.current });
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
      aria-labelledby="hold-part-request-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onClose();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="hold-part-request-dialog-title" className="text-sm font-semibold">
        요청 보류 — {intakeNumber}
      </h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        보류하는 동안에는 불출도 거절도 되지 않습니다. 다시 처리하려면 보류를 해제하세요.
      </p>
      <label className="mt-3 flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
        보류 사유 — 요청한 엔지니어에게 그대로 보입니다
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
          className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {isSubmitting ? "처리 중..." : "보류 확정"}
        </button>
      </div>
    </dialog>
  );
}
