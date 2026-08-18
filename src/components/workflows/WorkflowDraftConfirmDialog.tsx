"use client";

import { useEffect, useRef } from "react";

export type WorkflowDraftConfirmKind = "publish" | "discard";

/**
 * 초안 발행 / 폐기 확인 다이얼로그.
 *
 * 이 앱의 모든 확인 창과 같은 네이티브 <dialog>/showModal() 패턴을 쓴다
 * (RepairCaseRestoreDialog, HoldDialog, TransitionDialog 등 30여 곳). 처음에는
 * 브라우저 기본 confirm()을 썼는데, 그것만 생김새와 동작(다크 모드 무시, 위치,
 * 버튼 문구)이 앱의 다른 확인 창과 달라 도드라졌다.
 *
 * 두 조작을 한 컴포넌트로 묶은 것은 구조가 완전히 같고 문구와 확인 버튼 색만
 * 다르기 때문이다 — 파일을 나누면 같은 다이얼로그 뼈대가 두 벌이 된다.
 * 발행은 되돌리기가 번거로운 조작이라(현재 화면에 "이전 버전으로" 기능이 없다)
 * 무엇이 일어나는지 문구로 분명히 적는다.
 */
export default function WorkflowDraftConfirmDialog({
  isOpen,
  kind,
  versionNumber,
  isSubmitting,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  kind: WorkflowDraftConfirmKind;
  versionNumber: number;
  isSubmitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
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

  const isPublish = kind === "publish";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="workflow-draft-confirm-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="workflow-draft-confirm-title" className="text-sm font-semibold">
        {isPublish ? `초안 v${versionNumber}을(를) 발행하시겠습니까?` : `초안 v${versionNumber}을(를) 폐기하시겠습니까?`}
      </h2>

      {isPublish ? (
        <>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            발행하면 <strong>이후 접수되는 건부터</strong> 이 구성이 적용됩니다. 진행 중인 접수 건은 접수 당시
            버전을 그대로 따라가므로 영향을 받지 않습니다.
          </p>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            지금 발행본은 &ldquo;보관됨&rdquo;으로 내려갑니다. 되돌리려면 새 초안을 만들어 이전 내용으로 다시
            발행해야 합니다 — 한 번에 되돌리는 기능은 아직 없습니다.
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          편집한 내용이 모두 사라집니다. 현재 발행본과 진행 중인 접수 건에는 영향이 없습니다 — 초안은 발행
          전까지 어디에도 적용되지 않기 때문입니다.
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
          className={
            isPublish
              ? "rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50"
              : "rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          }
        >
          {isSubmitting ? (isPublish ? "발행 중..." : "폐기 중...") : isPublish ? "발행" : "폐기"}
        </button>
      </div>
    </dialog>
  );
}
