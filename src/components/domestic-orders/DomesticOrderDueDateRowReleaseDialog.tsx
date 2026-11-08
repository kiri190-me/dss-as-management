"use client";

import { useEffect, useId, useRef } from "react";

/**
 * ============================================================================
 * 내자 정리 **회차 [N차 해제]** 확인 창 (2026-11-08)
 * ============================================================================
 * 🔴 **한 번의 클릭으로 회차 완료가 풀리지 않게 한다.** 사용자가 말한 것은 줄 단위
 * [완료 해제]였지만(「정말 해제하실꺼냐고 물어봐줘」), 재서 보니 회차 해제도 **같은
 * 성격의 조작**이라 같이 묻는 쪽이 맞다:
 *
 *  · 🔴 **마지막 회차를 풀면 줄의 완료까지 함께 풀린다**(저장 경로가 한다 —
 *    mutations/domestic-orders.ts 의 setDomesticOrderDueDateRowCompletion). 즉 그
 *    한 번의 클릭이 **줄 단위 [완료 해제]와 같은 일**을 한다. 묻지 않을 까닭이 없다.
 *  · 🔴 **2026-11-08 부터 해제가 잠금을 푸는 조작이 되었다** — 완료된 회차는 그
 *    회차의 납기요청일·비고·납품일·납품자를 잠그므로(domain/domestic-order-completion-
 *    lock.ts), [N차 해제]는 「표시를 지우는 것」이 아니라 **잠긴 값을 여는 것**이다.
 *
 * ── 🔴 줄 단위 창과 **글이 다르다** ────────────────────────────────────
 * 줄 단위 창(DomesticOrderCompletionReleaseDialog)은 **수리 건의 출하 완료까지
 * 되돌린다**고 말한다. 회차별 완료는 **기타건 전용**이라(저장 경로가 그것을 강제한다)
 * 되돌릴 수리 건이 애초에 없다 — 그 창을 그대로 띄우면 **일어나지 않을 일을
 * 경고**하게 되고, 그런 경고는 다음부터 안 읽힌다. 그래서 파일을 따로 두었다.
 *
 * ── 🔴 **납품일은 지워지지 않는다**고 말한다 ───────────────────────────
 * 회차 [완료 처리]가 그 회차의 납품일에 오늘을 찍지만, [완료 해제]는 그 날짜를
 * **지우지 않는다** — 고장이 아니라 정한 모양이다(그 mutation 머리말). 창이 그 말을
 * 하지 않으면 사람은 「해제하면 되돌아가겠지」로 읽고, 남은 납품일을 나중에 발견한다.
 *
 * ── 생김새는 줄 단위 창과 **한 글자도 다르지 않다** ────────────────────
 * 네이티브 `<dialog>` + `showModal()`, 같은 색·같은 단추 배치, 창은 **자기 상태를
 * 갖지 않고** 열림 여부·전송 중을 전부 부모가 소유한다. 🔴 브라우저 기본
 * `confirm()` 도 `showSavePopup` 도 아니다 — 저장 팝업은 **성공 전용**이고 0.5초 뒤
 * 저절로 닫힌다(읽고 고르는 창이 저절로 닫히면 안 된다).
 *
 * 🔴 이 창은 목록의 `<td>` 안에서 그리지 않는다 — 부모가 화면 위쪽에서 그린다. 칸
 * 안에서 태어나면 칸의 정렬 CSS(nowrap · text-right 등)를 물려받아 글이 한쪽으로
 * 쏠린다(줄 단위 창이 그 자리에 있는 것과 같은 까닭).
 * ============================================================================
 */
export default function DomesticOrderDueDateRowReleaseDialog({
  isOpen,
  rowOrder,
  label,
  releasesLine,
  isSubmitting,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  /** 몇 번째 회차인가(1부터). 단추 글자와 같은 번호다. */
  rowOrder: number;
  /** 「1차 · 납기 2026-01-20 (1차분)」 — 지어내지 않고 그 한 줄을 그대로 받는다. */
  label: string;
  /**
   * 🔴 이 해제로 **줄의 완료까지 함께 풀리는가.** 지금 모든 회차가 완료라서 줄도
   * 완료인 상태였다면 참이다 — 그때만 그 사실을 말한다. 일어나지 않을 일을 경고하면
   * 다음부터 그 경고를 안 읽는다(줄 단위 창의 그 판단 그대로다).
   */
  releasesLine: boolean;
  isSubmitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Esc 로 닫는 것도 취소 콜백을 거치게 한다 — 전송 중에는 아무 일도
        // 일어나지 않아야 하고, 부모의 상태와 창의 열림 여부가 갈라지면 안 된다.
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="m-auto w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-left text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id={titleId} className="text-sm font-semibold">
        {rowOrder}차의 완료를 풀까요?
      </h2>

      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        이 회차의 납기요청일·비고·납품일·납품자가{" "}
        <strong className="font-medium text-zinc-800 dark:text-zinc-200">다시 고칠 수 있게</strong>
        됩니다.
      </p>
      {releasesLine && (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          지금은 모든 회차가 완료라{" "}
          <strong className="font-medium text-zinc-800 dark:text-zinc-200">
            이 줄의 완료 표시도 함께 풀립니다
          </strong>
          .
        </p>
      )}
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        이미 적힌 납품일은 지워지지 않습니다. 지우려면 `납품일` 칸에서 직접 지워 주세요.
      </p>
      <p className="mt-3 rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        {label}
      </p>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          취소
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? "해제 중..." : `${rowOrder}차 해제`}
        </button>
      </div>
    </dialog>
  );
}
