"use client";

import { useEffect, useId, useRef } from "react";

/**
 * ============================================================================
 * 내자 정리 [완료 해제] 확인 창 (2026-10-18)
 * ============================================================================
 * 🔴 **한 번의 클릭으로 완료 해제가 되지 않게 한다** — 사용자 요청이다. 해제는
 * 이제 그 줄에 붙은 수리 건의 **출하 완료까지 되돌리는** 조작이라(서비스:
 * server/services/release-domestic-order.ts), 모르고 누르면 다른 화면의 자료가
 * 함께 움직인다.
 *
 * ── 왜 이 생김새인가 ───────────────────────────────────────────────────
 * 이 저장소의 확인 창 모양을 그대로 따른다(master-data-trash-dialogs.tsx) —
 * 네이티브 `<dialog>` + `showModal()`, 같은 색·같은 단추 배치, 창은 **자기
 * 상태를 갖지 않고** 열림 여부·전송 중을 전부 부모가 소유한다.
 *
 * 🔴 브라우저 기본 `confirm()` 을 쓰지 않는다. 페이지를 통째로 멈춰 세우고
 * 글꼴도 말투도 이 앱의 것이 아니다(NoticePopup 머리말과 같은 판단).
 * 🔴 `showSavePopup` 도 아니다 — 그것은 **성공 전용**이고 0.5초 뒤 저절로
 * 닫힌다. 읽고 고르는 창이 저절로 닫히면 안 된다.
 *
 * 🔴 이 창은 목록의 `<td>` 안에서 그리지 않는다 — 부모가 화면 위쪽에서 그린다.
 * 칸 안에서 태어나면 칸의 정렬 CSS(nowrap · text-right 등)를 물려받아 글이 한쪽
 * 으로 쏠린다(DomesticOrderListScreen 의 NoticePopup 이 같은 이유로 그 자리에
 * 있다).
 *
 * ── 수리 건이 붙었는지에 따라 문장이 갈린다 ────────────────────────────
 * 🔵 **창은 언제나 뜬다**(붙었든 아니든). 다만 붙은 줄에서는 「수리 건도 함께
 * 되돌아간다」를 분명히 말하고, 붙지 않은 줄에서는 「이 줄만 풀린다」고 말한다 —
 * 일어나지 않을 일을 경고하면 다음부터 그 경고를 안 읽는다.
 *
 * ⚠️ 「실제로 출하 완료 상태인가」는 **서버가 정한다**(workflow_steps.
 * repair_status). 화면은 연결 여부까지만 알므로 "출하 완료 상태이면"이라고
 * 적는다. 출하 완료가 아니었으면 수리 건은 그대로 두고 이 줄만 풀린다.
 * ============================================================================
 */
export default function DomesticOrderCompletionReleaseDialog({
  isOpen,
  intakeNumber,
  hasLinkedRepairCase,
  isSubmitting,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  /** 연결된 수리 건의 인수번호(없으면 null). 사람이 줄을 알아보는 단서다. */
  intakeNumber: string | null;
  hasLinkedRepairCase: boolean;
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
        이 줄의 완료 표시를 풀까요?
      </h2>

      {hasLinkedRepairCase ? (
        <>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            연결된 수리 건이 출하 완료 상태이면{" "}
            <strong className="font-medium text-zinc-800 dark:text-zinc-200">
              그 출하 완료도 함께 되돌립니다
            </strong>
            . 수리 건의 단계가 출하 완료 직전으로 돌아가고, 실제 출하일이 지워집니다.
          </p>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            되돌린 건을 다시 출하 완료로 넘기려면 수리 검수 승인부터 다시 받아야 합니다.
          </p>
          <p className="mt-3 rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            연결된 수리 건: {intakeNumber ?? "인수번호 없음"}
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          이 줄에는 연결된 수리 건이 없어 내자 정리의 완료 표시만 풀립니다.
        </p>
      )}

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
          {isSubmitting ? "해제 중..." : "완료 해제"}
        </button>
      </div>
    </dialog>
  );
}
