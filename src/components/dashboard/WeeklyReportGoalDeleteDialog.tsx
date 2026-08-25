"use client";

import { useEffect, useRef } from "react";

/**
 * ============================================================================
 * 금주 목표 줄 삭제 확인창
 * ============================================================================
 * 이 앱의 확인창은 전부 native `<dialog>` + `showModal()` 이다(globals.css 의
 * dialog 주석 — 그 자리에서 Tailwind preflight 가 지운 `margin: auto` 를 되살려
 * 앱의 모든 확인창을 한 번에 가운데로 맞춘다). 브라우저 기본 `confirm()` 을 쓰면
 * 그 규칙 밖으로 나가고, 어두운 화면·모바일에서 이 앱의 다른 확인창과 전혀 다른
 * 물건이 뜬다. ClearDraftDialog 를 본보기로 삼았다.
 *
 * ── 지우기 전에 무엇이 사라지는지 그대로 보여 준다 ──────────────────────
 * 목표 줄은 휴지통 없이 바로 지워지고 복원할 길이 없다(mutations 헤더). 그래서
 * 확인 문구만 띄우는 대신 **지워질 줄 전체를 그대로** 적는다 — 상자에 비슷한
 * 줄이 여럿 있어서, "정말 지우시겠습니까?"만으로는 어느 줄을 지우는지 알 수 없다.
 *
 * ── 충돌은 여기서도 덮어쓰지 않는다 ─────────────────────────────────────
 * 그 사이 남이 문장을 고쳤으면 version 이 어긋나 서버가 CONFLICT 로 돌려준다.
 * 그때는 삭제 버튼을 지우고 '최신 정보 다시 불러오기' 하나만 남긴다 —
 * EditSectionActions 가 낡은 폼을 얼리는 것과 같은 규칙이다. 낡은 화면에서
 * 누른 삭제가 방금 바뀐 문장을 지우면 안 된다.
 * ============================================================================
 */
export default function WeeklyReportGoalDeleteDialog({
  isOpen,
  line,
  isSubmitting,
  errorMessage,
  isConflict,
  onConfirm,
  onCancel,
  onReloadAfterConflict,
}: {
  isOpen: boolean;
  /** 지워질 줄 전체 — `[INVENIA] D260706_...: 견적서 발행`. */
  line: string;
  isSubmitting: boolean;
  errorMessage: string | null;
  isConflict: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onReloadAfterConflict: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

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
      aria-labelledby="weekly-report-goal-delete-title"
      onCancel={(event) => {
        // Esc 로 닫는 길을 브라우저에 맡기지 않는다 — 부모의 열림 상태와
        // 엇갈리면 다음에 열 때 showModal 이 불리지 않는다.
        event.preventDefault();
        if (isSubmitting) return;
        onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="weekly-report-goal-delete-title" className="text-sm font-semibold">
        이 목표 줄을 지우시겠습니까?
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        휴지통이 없어 되돌릴 수 없습니다. 잘못 지웠다면 다시 적어야 합니다.
      </p>
      <p className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-xs break-all text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
        {line}
      </p>

      {errorMessage && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
        >
          {errorMessage}
        </p>
      )}

      {isConflict ? (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onReloadAfterConflict}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            최신 정보 다시 불러오기
          </button>
        </div>
      ) : (
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
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "지우는 중..." : "지우기"}
          </button>
        </div>
      )}
    </dialog>
  );
}
