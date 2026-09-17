"use client";

import { useEffect, useRef } from "react";
import { useUiText } from "@/components/providers/UiTextProvider";
import { USER_DELETION_REASON_MAX_LENGTH } from "@/lib/validation/user-deletion-input";
import {
  USER_DELETION_PORTAL_NOTICE,
  checkUserDeletionSubmit,
  describeUserDeletionBlocker,
  describeUserDeletionImpact,
  mayShowUserDeletionButton,
  type ReadyUserDeletionPreview,
  type UserDeletionFormState,
} from "./user-deletion-dialog-text";

/**
 * ============================================================================
 * 계정 삭제 — 그리기만 하는 조각
 * ============================================================================
 * 서버 액션을 부르는 쪽(UserDeletionDialog.tsx)과 나눠 둔다. 이 파일은 서버 모듈을
 * 값으로 부르지 않으므로 test:components 에서 그대로 그려 볼 수 있다
 * (UserDeletionParts.test.tsx).
 * ============================================================================
 */

const DANGER_ROW_BUTTON_CLASS =
  "rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950";

const SELECT_CLASS =
  "mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50";

/**
 * 목록 줄의 [계정 삭제]. 서버 페이지가 계산해 준 값이 참이고 자기 자신의 줄이 아닐 때만
 * 그린다 — 그 밖에는 아무것도 그리지 않는다(잠긴 단추로 두면 「왜 못 누르나」만 늘어난다).
 */
export function UserDeletionRowButton({
  canDeleteUserAccounts,
  actingUserId,
  userId,
  disabled,
  onRequestDelete,
}: {
  canDeleteUserAccounts: boolean;
  actingUserId: string;
  userId: string;
  disabled: boolean;
  onRequestDelete: () => void;
}) {
  if (!mayShowUserDeletionButton({ canDeleteUserAccounts, actingUserId, rowUserId: userId })) return null;
  return (
    <button type="button" disabled={disabled} onClick={onRequestDelete} className={DANGER_ROW_BUTTON_CLASS}>
      계정 삭제
    </button>
  );
}

export type UserDeletionDialogPhase =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; preview: ReadyUserDeletionPreview };

/** 붙을 때 showModal, 떨어질 때 close — 부르는 쪽이 대상이 있을 때만 붙인다. */
function useShowModalOnMount() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);
  return dialogRef;
}

/**
 * 확인 창. 이 앱의 확인 창은 전부 native `<dialog>` + `showModal()` 이다
 * Esc 는 브라우저에 맡기지 않는다 — onCancel 에서 막고 부모 상태로 닫는다. 보내는
 * 중에는 Esc 로도 닫히지 않는다.
 */
export function UserDeletionDialogView({
  targetName,
  phase,
  form,
  isSubmitting,
  errorMessage,
  noticeMessage,
  onApprovalSuccessorChange,
  onEngineerSuccessorChange,
  onReasonChange,
  onConfirm,
  onCancel,
}: {
  /** 미리보기가 오기 전 제목에 쓸 이름 — 목록 줄의 이름. */
  targetName: string;
  phase: UserDeletionDialogPhase;
  form: UserDeletionFormState;
  isSubmitting: boolean;
  errorMessage: string | null;
  noticeMessage: string | null;
  onApprovalSuccessorChange: (id: string) => void;
  onEngineerSuccessorChange: (id: string) => void;
  onReasonChange: (reason: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useShowModalOnMount();
  const titleName = phase.kind === "ready" ? phase.preview.target.name : targetName;
  const check = phase.kind === "ready" ? checkUserDeletionSubmit(phase.preview, form) : null;
  const confirmDisabled = isSubmitting || check === null || !check.enabled;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="user-deletion-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (isSubmitting) return;
        onCancel();
      }}
      className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="user-deletion-dialog-title" className="text-sm font-semibold">
        {`${titleName} 님의 계정을 삭제합니다`}
      </h2>
      <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
        {USER_DELETION_PORTAL_NOTICE}
      </p>

      {noticeMessage ? (
        <p
          role="status"
          className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        >
          {noticeMessage}
        </p>
      ) : null}

      {phase.kind === "loading" ? (
        <p role="status" className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
          불러오는 중...
        </p>
      ) : phase.kind === "failed" ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
        >
          {phase.message}
        </p>
      ) : (
        <UserDeletionPreviewBody
          preview={phase.preview}
          form={form}
          isSubmitting={isSubmitting}
          onApprovalSuccessorChange={onApprovalSuccessorChange}
          onEngineerSuccessorChange={onEngineerSuccessorChange}
          onReasonChange={onReasonChange}
        />
      )}

      {errorMessage ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
        >
          {errorMessage}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {check && !check.enabled && !isSubmitting ? (
          <span className="mr-auto text-xs text-zinc-500 dark:text-zinc-400">{check.reason}</span>
        ) : null}
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
          data-role="user-deletion-confirm"
          onClick={onConfirm}
          disabled={confirmDisabled}
          aria-busy={isSubmitting}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? "삭제하는 중..." : "삭제"}
        </button>
      </div>
    </dialog>
  );
}

function UserDeletionPreviewBody({
  preview,
  form,
  isSubmitting,
  onApprovalSuccessorChange,
  onEngineerSuccessorChange,
  onReasonChange,
}: {
  preview: ReadyUserDeletionPreview;
  form: UserDeletionFormState;
  isSubmitting: boolean;
  onApprovalSuccessorChange: (id: string) => void;
  onEngineerSuccessorChange: (id: string) => void;
  onReasonChange: (reason: string) => void;
}) {
  const uiText = useUiText();
  const impactText = describeUserDeletionImpact(preview.impact);
  const { approvalSuccessors, engineerSuccessors } = preview.candidates;
  const reasonCount = form.reason.length;
  const reasonOver = form.reason.trim().length > USER_DELETION_REASON_MAX_LENGTH;

  return (
    <>
      <div className="mt-3">
        <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">삭제하면</h3>
        {impactText.changes.length > 0 ? (
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-zinc-800 dark:text-zinc-200">
            {impactText.changes.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">넘기거나 바꿀 일이 없습니다.</p>
        )}
        {impactText.keeps.length > 0 ? (
          <ul className="mt-2 space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            {impactText.keeps.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {preview.blockers.length > 0 ? (
        <div
          role="alert"
          className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
        >
          <p className="font-semibold">지금은 삭제할 수 없습니다.</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {preview.blockers.map((blocker, index) => {
              const { subject, message } = describeUserDeletionBlocker(blocker);
              return (
                <li key={`${blocker.code}-${index}`}>
                  <span className="font-medium">{subject}</span>
                  {` — ${message}`}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {preview.requires.approvalSuccessor ? (
        <div className="mt-3">
          <label
            htmlFor="user-deletion-approval-successor"
            className="text-xs font-semibold text-zinc-700 dark:text-zinc-300"
          >
            결재 이어받을 사람
          </label>
          <select
            id="user-deletion-approval-successor"
            value={form.approvalSuccessorId}
            disabled={isSubmitting || approvalSuccessors.length === 0}
            onChange={(event) => onApprovalSuccessorChange(event.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">골라 주세요</option>
            {approvalSuccessors.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {`${candidate.name} (${uiText.role[candidate.role] ?? candidate.role})`}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            {approvalSuccessors.length === 0
              ? "결재를 이어받을 수 있는 사람이 없습니다."
              : preview.requires.approvalSuccessorMustInspect
                ? "수리 검수 결재도 넘겨받으므로 검수 결재를 할 수 있는 사람만 목록에 있습니다."
                : "결재선 자리 · 대기 결재 · 마지막 출하 대표를 이어받습니다."}
          </p>
        </div>
      ) : null}

      {preview.requires.engineerSuccessor ? (
        <div className="mt-3">
          <label
            htmlFor="user-deletion-engineer-successor"
            className="text-xs font-semibold text-zinc-700 dark:text-zinc-300"
          >
            담당 이어받을 사람
          </label>
          <select
            id="user-deletion-engineer-successor"
            value={form.engineerSuccessorId}
            disabled={isSubmitting || engineerSuccessors.length === 0}
            onChange={(event) => onEngineerSuccessorChange(event.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">골라 주세요</option>
            {engineerSuccessors.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            {engineerSuccessors.length === 0
              ? "담당을 이어받을 수 있는 사람이 없습니다."
              : "담당 중인 접수 건을 이어받습니다."}
          </p>
        </div>
      ) : null}

      <div className="mt-3">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor="user-deletion-reason" className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            삭제 사유 (필수)
          </label>
          <span
            id="user-deletion-reason-count"
            className={`text-xs tabular-nums ${reasonOver ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"}`}
          >
            {`${reasonCount} / ${USER_DELETION_REASON_MAX_LENGTH}`}
          </span>
        </div>
        <textarea
          id="user-deletion-reason"
          value={form.reason}
          maxLength={USER_DELETION_REASON_MAX_LENGTH}
          rows={3}
          disabled={isSubmitting}
          aria-describedby="user-deletion-reason-count"
          onChange={(event) => onReasonChange(event.target.value)}
          className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
        />
      </div>
    </>
  );
}
