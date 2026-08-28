"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { rejectRequestAction } from "@/lib/server/actions/customer-portal-requests";

/**
 * 수리 의뢰 반려 — 사유를 받는다.
 *
 * 부품 요청 거절(RejectPartRequestDialog)과 같은 모양을 그대로 쓴다. 처음에는
 * window.prompt 로 만들었는데, 그건 브라우저가 그리는 상자라 이 앱의 다른
 * 대화상자와 생김새도 동작도 다르다 — 어두운 화면에서 혼자 밝게 뜨고, 글자
 * 수 제한도 오류 문구도 그 안에서 보여줄 수 없다.
 *
 * <dialog showModal()>을 쓰는 이유는 이 저장소의 다른 대화상자와 같다:
 * 포커스 가둠·Escape 닫기·바깥 어둡게가 브라우저에서 공짜로 온다.
 *
 * ── 사유를 필수로 두는 이유 ─────────────────────────────────────────────
 * 고객은 자기가 보낸 의뢰가 어떻게 됐는지 볼 수 없다(반려는 고객 화면에
 * 나가지 않는다). 사내에 이유가 없으면 나중에 "그런 의뢰 받은 적 없다"가
 * 되어 아무도 설명할 수 없다.
 */
export default function RejectRequestDialog({
  isOpen,
  onClose,
  requestId,
  customerName,
  productModelName,
  onDone,
}: {
  isOpen: boolean;
  onClose: () => void;
  requestId: string;
  customerName: string;
  productModelName: string;
  /** 성공했을 때 목록 화면이 알림 줄을 띄우도록. */
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      // 열 때마다 비운다 — 앞서 다른 의뢰를 반려하려다 만 글이 남아 있으면
      // 엉뚱한 건에 그 사유가 붙는다.
      setReason("");
      setErrorMessage(null);
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  async function handleSubmit() {
    if (!reason.trim()) {
      setErrorMessage("반려 사유를 적어 주세요.");
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await rejectRequestAction({ requestId, reason: reason.trim() });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    onClose();
    onDone(result.message);
    router.refresh();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="reject-request-dialog-title"
      onCancel={(event) => {
        // 저장 중에는 Escape 로 닫지 않는다 — 서버는 이미 처리를 시작했는데
        // 화면만 사라지면 사람이 결과를 모른다.
        event.preventDefault();
        if (!isSubmitting) onClose();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="reject-request-dialog-title" className="text-sm font-semibold">
        수리 의뢰 반려 — {customerName} · {productModelName}
      </h2>
      <p className="mt-1.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        지우지 않고 사유와 함께 남깁니다. 고객 화면에는 나가지 않고 사내 기록으로만 남습니다.
      </p>
      <label className="mt-3 flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
        반려 사유
        <textarea
          rows={3}
          value={reason}
          maxLength={1000}
          onChange={(e) => setReason(e.target.value)}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </label>
      {errorMessage && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{errorMessage}</p>
      )}
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
          {isSubmitting ? "처리 중..." : "반려 확정"}
        </button>
      </div>
    </dialog>
  );
}
