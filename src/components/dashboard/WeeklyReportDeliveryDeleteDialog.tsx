"use client";

import { useEffect, useRef } from "react";

/**
 * ============================================================================
 * 납입 예정 줄 삭제 확인창
 * ============================================================================
 * WeeklyReportGoalDeleteDialog 와 **나란한 파일이고 모양도 같다.** 그쪽을 그대로
 * 쓰지 못한 이유는 두 가지이고, 둘 다 소품으로는 넘길 수 없는 값이다:
 *
 *   1. 제목이 `이 목표 줄을 지우시겠습니까?` 로 박혀 있다. 납입 예정 줄을 지우며
 *      "목표 줄"이라고 묻는 확인창은, 두 상자가 한 화면에 같이 있는 만큼 정말로
 *      다른 줄을 지우는 것으로 읽힌다.
 *   2. `aria-labelledby` 가 가리키는 id 도 박혀 있다. 두 상자가 한 화면에 있으면
 *      **같은 id 를 가진 요소가 문서에 둘** 생기고, 화면 낭독기가 어느 확인창의
 *      제목을 읽을지 정해지지 않는다.
 *
 * 그 파일을 고쳐 둘을 합치는 길도 있었지만 고르지 않았다 — 금주 목표 쪽은 이미
 * 승인·검증이 끝난 자리이고, 확인창 하나를 일반화하자고 그 자리를 다시 여는 것은
 * 이 작업의 범위 밖이다. 대신 이 파일이 그쪽의 규칙을 **그대로** 따른다:
 *
 * ── native `<dialog>` + showModal() ─────────────────────────────────────
 * 이 앱의 확인창은 전부 그렇다(globals.css 의 dialog 주석 — Tailwind preflight 가
 * 지운 `margin: auto` 를 그 자리에서 되살려 앱의 모든 확인창을 한 번에 가운데로
 * 맞춘다). 브라우저 기본 `confirm()` 을 쓰면 그 규칙 밖으로 나가고, 어두운 화면 ·
 * 모바일에서 이 앱의 다른 확인창과 전혀 다른 물건이 뜬다.
 *
 * ── 지우기 전에 어느 줄인지 그대로 보여 준다 ────────────────────────────
 * 이 줄도 휴지통 없이 바로 지워진다(mutations/weekly-report-deliveries.ts).
 * 표에 비슷한 줄이 여럿이라 "정말 지우시겠습니까?"만으로는 어느 건을 지우는지
 * 알 수 없어, 그 줄이 가리키는 수리 건을 한 줄로 적는다.
 *
 * ── 충돌은 여기서도 덮어쓰지 않는다 ─────────────────────────────────────
 * 그 사이 남이 비고를 고쳤으면 version 이 어긋나 서버가 CONFLICT 로 돌려준다.
 * 그때는 삭제 버튼을 지우고 '최신 정보 다시 불러오기' 하나만 남긴다 —
 * EditSectionActions 가 낡은 폼을 얼리는 것과 같은 규칙이다.
 * ============================================================================
 */
export default function WeeklyReportDeliveryDeleteDialog({
  isOpen,
  line,
  note,
  isSubmitting,
  errorMessage,
  isConflict,
  onConfirm,
  onCancel,
  onReloadAfterConflict,
}: {
  isOpen: boolean;
  /** 지워질 줄이 가리키는 수리 건 — `[INVENIA] D260706_RFK300FH-AD1_2111171`. */
  line: string;
  /** 적어 둔 비고. 대부분 비어 있어서, 있을 때만 한 줄 더 그린다. */
  note: string | null;
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
      aria-labelledby="weekly-report-delivery-delete-title"
      onCancel={(event) => {
        // Esc 로 닫는 길을 브라우저에 맡기지 않는다 — 부모의 열림 상태와
        // 엇갈리면 다음에 열 때 showModal 이 불리지 않는다.
        event.preventDefault();
        if (isSubmitting) return;
        onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="weekly-report-delivery-delete-title" className="text-sm font-semibold">
        이 납입 예정 줄을 지우시겠습니까?
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        휴지통이 없어 되돌릴 수 없습니다. 잘못 지웠다면 그 건을 다시 골라 넣어야 합니다. 수리 건
        자체는 지워지지 않고, 이번 주 목록에서만 빠집니다.
      </p>
      <p className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-xs break-all text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
        {line}
      </p>
      {/* 비고는 사람이 적어 둔 유일한 값이라, 있으면 그것까지 보여 주고 지운다. */}
      {note !== null && note.trim() !== "" && (
        <p className="mt-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-xs whitespace-pre-line text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
          비고: {note}
        </p>
      )}

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
