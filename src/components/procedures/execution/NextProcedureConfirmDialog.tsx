"use client";

import { useEffect, useRef } from "react";

/**
 * ============================================================================
 * [종료]를 완료할 때 **한 번 묻는 창** (2026-11-04, 줄기 B ④ 조각 ④)
 * ============================================================================
 * 사용자 결정(2026-11-04): 「넘어가는 순간 한 번 물어보도록 해줘.」
 *
 * ── 🔴 이 저장소가 방금 확인창을 걷어냈는데 왜 여기엔 두는가 ───────────
 * 줄기 B ② 가 편집기의 확인창들을 걷어냈고, 그 기준은 **「되돌릴 수 있으면
 * 묻지 않는다」**였다. 여기는 그 기준의 반대쪽이다 — 누르면 **다른 절차의
 * 실행이 생긴다.** 실행 행은 작업 기록이 붙는 자리이고, 잘못 열었다고 해서
 * 없던 일로 되돌리는 길이 간단하지 않다. 그래서 기준을 어긴 것이 아니라
 * 기준대로 둔 것이다.
 *
 * ── 🔴 선택이 셋인 까닭 ─────────────────────────────────────────────────
 * [취소]만 두면 「완료는 하고 싶은데 지금은 안 이어가고 싶다」는 사람이 갈 곳이
 * 없다. 그 사람은 [취소]를 누르고 나서 이어가기가 **아예 없는 줄** 알게 된다.
 *  · [완료하고 이어서 시작] — 묻는 까닭 그 자체.
 *  · [완료만 하기] — 이 절차의 마지막 단계는 끝내되 이어가지는 않는다.
 *  · [취소] — 아무것도 안 한다.
 *
 * 🔵 어느 쪽을 골라도 **지금 절차는 끝나지 않는다**(사용자 결정: 「안 끝난 채로
 * 두자」). 끝내기는 사람이 따로 누르는 별개의 조작 그대로다. 창이 그 사실을
 * 글로 적는다 — 안 적으면 「완료」를 절차 종료로 읽는다.
 * ============================================================================
 */
export default function NextProcedureConfirmDialog({
  isOpen,
  nodeTitle,
  nextProcedureName,
  nextProcedureVersion,
  isSubmitting,
  onCompleteAndStart,
  onCompleteOnly,
  onCancel,
}: {
  isOpen: boolean;
  nodeTitle: string;
  nextProcedureName: string;
  nextProcedureVersion: number;
  isSubmitting: boolean;
  onCompleteAndStart: () => void;
  onCompleteOnly: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    else if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="next-procedure-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="next-procedure-dialog-title" className="text-sm font-semibold">
        다음 절차로 이어가기
      </h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        &ldquo;{nodeTitle}&rdquo; 단계를 완료합니다.
      </p>
      <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
        이 절차는{" "}
        <span className="font-medium">
          {nextProcedureName} (v{nextProcedureVersion})
        </span>
        (으)로 이어지도록 지정되어 있습니다. 이어서 시작하면 이 접수 건에 그 절차의 실행이 새로 열립니다.
      </p>
      {/*
        🔴 이 한 줄이 없으면 「완료」를 **절차 종료**로 읽는다. 사용자 결정대로
        지금 절차는 안 끝난 채로 남고, 끝내기는 따로 누르는 조작이다.
      */}
      <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
        지금 절차는 <span className="font-medium">끝나지 않습니다</span> — 남은 단계가 있으면 그대로 남고, 절차를 끝내는
        것은 별도로 누르셔야 합니다.
      </p>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
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
          onClick={onCompleteOnly}
          disabled={isSubmitting}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          완료만 하기
        </button>
        <button
          type="button"
          onClick={onCompleteAndStart}
          disabled={isSubmitting}
          className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900"
        >
          {isSubmitting ? "처리 중..." : "완료하고 이어서 시작"}
        </button>
      </div>
    </dialog>
  );
}
