"use client";

import { useEffect, useRef, useState } from "react";
import { DOMESTIC_ORDER_APPROVAL_REASON_REQUIRED_MESSAGE } from "./domestic-order-approval-texts";

/**
 * ============================================================================
 * 기타건 승인 확인 창 — 올리기 · 승인 · 반려
 * ============================================================================
 * components/quotes/QuoteApprovalDialog 와 같은 방식이다: 네이티브 `<dialog>` 의
 * showModal/close 로 포커스 가두기와 Escape 취소를 얻는다(별도 창 라이브러리를 쓰지
 * 않는 것이 이 저장소의 관례다).
 *
 * ── 그 창들을 그대로 쓰지 않고 따로 둔 이유 ─────────────────────────────
 * 접수 건 승인 창(repair-cases/approval/ApprovalActionDialog)은 수리 건 승인의 두
 * 가지를 함께 짊어지고 있다 — 「누구에게 보낼까요」 고르는 자리와 사내 목표 완료일
 * 한 줄이다. 기타건에는 **둘 다 없다**: 받을 사람은 결재선이 정하고(요청 경로가
 * 1단계 승인자를 스스로 지정한다), 출하일은 내자 줄의 개념이 아니다. 견적서 창은
 * 같은 모양이지만 그 탭의 말(`quote-…`)과 id 를 달고 있어, 가져다 쓰면 기타건 화면의
 * 오류 문구가 「견적서」라고 말하게 된다. 견적서 창이 접수 건 창을 베껴 따로 선 것과
 * **같은 판단**이다(그 파일 머리말).
 *
 * 🔴 이 창은 **아무것도 저장하지 않는다.** 서버 액션을 부르는 것은 부모
 * (DomesticOrderApprovalPanel)이고, 여기는 사람이 적은 말을 돌려줄 뿐이다. 그래서
 * 이 파일은 `server-only` 사슬을 물지 않고, 화면 시험이 그대로 렌더해 본다.
 *
 * ── 🔴 **회차 드롭다운** (2026-11-08, 사용자 결정 12) ───────────────────
 * 사용자 요구 원문: 「납기요청일이 한번이면 괜찮지만 **복수로 있다면 출하승인요청을 할
 * 때, 드롭다운으로 어느 납기 요청일에 관한 출하승인 요청인지 선택**하도록」.
 *
 * 🔴 **고를 것이 하나뿐이면 드롭다운을 그리지 않는다.** 선택지가 하나인 고르개는
 * 고르는 일이 아니라 **읽고 지나가야 하는 줄**이고, 기타건 대부분이 회차 하나다
 * (개발 DB 실측 2026-11-08 — 살아 있는 기타건 15건 중 13건이 0행 또는 1행). 그 줄에서
 * 어제와 똑같이 보여야 한다는 것이 이 조각의 완료 기준이다.
 *
 * 🔴 **고른 값을 창이 쥔다** — 부모가 아니라 여기다. 부모가 쥐면 창을 닫았다 다시 열
 * 때 지난 선택이 남고, 그 선택은 **사유 칸처럼 눈에 보이지 않는다**(사유는 비우는 것이
 * 보이지만 고르개는 그대로 서 있다). 창을 열 때마다 부모가 준 기본값으로 되돌린다.
 * ============================================================================
 */

/** 드롭다운 한 줄. 글자는 domain/domestic-order-due-date-label.ts 가 만든 그 한 줄이다. */
export type DomesticOrderApprovalDialogRowOption = {
  /** 1부터. `display_order` · `due_date_row_order` 와 같은 번호다. */
  rowOrder: number;
  label: string;
};

export default function DomesticOrderApprovalDialog({
  isOpen,
  title,
  /**
   * 🔴 반려일 때 참이다. 서버도 같은 이유로 거절하므로(사유 없는 반려는
   * VALIDATION_ERROR) 여기서 막는 것은 **편의**이지 관문이 아니다 — 창을 빠져나가도
   * 서버가 다시 본다.
   */
  requireReason,
  isSubmitting,
  rowOptions,
  defaultRowOrder,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  title: string;
  requireReason: boolean;
  isSubmitting: boolean;
  /**
   * 🔴 **고를 수 있는 회차들**(2026-11-08). 🔵 **길이가 1이면 드롭다운을 그리지
   * 않는다**(머리말) — 그래도 목록은 받는다: 그래야 부모가 「하나뿐이다」를 여기서
   * 한 번만 판정하게 되고, 화면 시험이 두 경우를 같은 길로 잴 수 있다.
   *
   * 🔵 **승인·반려 창에서는 빈 목록**이다. 그 둘은 이미 열려 있는 요청을 처리하는
   * 것이라 고를 것이 없다 — 어느 회차인지는 카드가 이미 말하고 있다.
   */
  rowOptions: readonly DomesticOrderApprovalDialogRowOption[];
  /** 창을 열 때 골라 둘 회차. 부모가 **누른 카드의 회차**를 준다. */
  defaultRowOrder: number;
  /**
   * 사람이 적은 말과 고른 회차. 사유가 비었으면 `null` 을 넘긴다(서버가 「적지 않음」
   * 으로 받는다).
   */
  onConfirm: (reason: string | null, dueDateRowOrder: number) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [rowOrder, setRowOrder] = useState(defaultRowOrder);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      // 열 때마다 비운다 — 지난 요청에 적은 말이 다음 결정에 묻어가면 안 된다.
      setReason("");
      setError(null);
      // 🔴 고른 회차도 되돌린다 — 머리말의 「고른 값을 창이 쥔다」.
      setRowOrder(defaultRowOrder);
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen, defaultRowOrder]);

  // 🔴 고르개를 그리는 것은 **둘 이상일 때만**이다(머리말). 하나뿐인 줄에서는
  //    2026-11-07 의 창과 한 글자도 다르지 않아야 한다.
  const showRowPicker = rowOptions.length > 1;

  function handleConfirm() {
    const trimmed = reason.trim();
    if (requireReason && !trimmed) {
      setError(DOMESTIC_ORDER_APPROVAL_REASON_REQUIRED_MESSAGE);
      textareaRef.current?.focus();
      return;
    }
    onConfirm(trimmed || null, rowOrder);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="domestic-order-approval-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="domestic-order-approval-dialog-title" className="text-sm font-semibold">
        {title}
      </h2>

      {/*
        🔴 **회차 고르개** — 둘 이상일 때만 선다(사용자 결정 12). 사유 칸 **위**에
        두는 것은 차례가 곧 뜻이기 때문이다: 먼저 「무엇에 대한 요청인가」를 정하고,
        그다음에 「무슨 말을 붙일까」를 적는다.
      */}
      {showRowPicker && (
        <div className="mt-3 flex flex-col gap-1">
          <label
            htmlFor="domestic-order-approval-due-date-row"
            className="text-xs text-zinc-500 dark:text-zinc-400"
          >
            납기요청일 회차 *
          </label>
          <select
            id="domestic-order-approval-due-date-row"
            value={rowOrder}
            disabled={isSubmitting}
            onChange={(event) => setRowOrder(Number(event.target.value))}
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            {rowOptions.map((option) => (
              <option key={option.rowOrder} value={option.rowOrder}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-1">
        <label
          htmlFor="domestic-order-approval-reason"
          className="text-xs text-zinc-500 dark:text-zinc-400"
        >
          사유{requireReason ? " *" : " (선택)"}
        </label>
        <textarea
          id="domestic-order-approval-reason"
          ref={textareaRef}
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "domestic-order-approval-reason-error" : undefined}
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        {error && (
          <p
            id="domestic-order-approval-reason-error"
            className="text-xs text-red-600 dark:text-red-400"
          >
            {error}
          </p>
        )}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          취소
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isSubmitting}
          className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200"
        >
          {isSubmitting ? "처리 중..." : "확인"}
        </button>
      </div>
    </dialog>
  );
}
