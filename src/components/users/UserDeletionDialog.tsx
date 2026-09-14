"use client";

import { useEffect, useState } from "react";
import {
  deleteUserAccountAction,
  getUserDeletionPreviewAction,
  type DeleteUserAccountActionResult,
} from "@/lib/server/actions/user-deletion";
import { UserDeletionDialogView, type UserDeletionDialogPhase } from "./UserDeletionParts";
import {
  EMPTY_USER_DELETION_FORM,
  USER_DELETION_CONFLICT_NOTICE,
  USER_DELETION_UNEXPECTED_FAILURE,
  buildUserDeletionActionInput,
  checkUserDeletionSubmit,
  retainSuccessorSelection,
  type UserDeletionFormState,
} from "./user-deletion-dialog-text";

/**
 * ============================================================================
 * 계정 삭제 확인 창 — 미리보기를 부르고, 고르고, 삭제를 보낸다
 * ============================================================================
 * 부르는 쪽(RepresentativeListSection)이 대상이 있을 때만 붙인다 — 붙으면 열리고
 * (showModal), 떨어지면 닫힌다.
 *
 *  - 붙자마자 미리보기 액션을 부른다. 실패(FORBIDDEN 등)는 서버 문구를 창 안에 보인다.
 *  - [삭제] → 삭제 액션. expectedVersion 은 미리보기의 target.version 이다.
 *    · 성공: onDeleted — 부르는 쪽이 창을 떼고 안내한 뒤 router.refresh() 한다
 *      (서버 액션은 revalidatePath 를 부르지 않는다).
 *    · CONFLICT: 안내하고 미리보기를 다시 부른다. 고른 값은 새 후보에 있으면 지키고,
 *      사유는 그대로 둔다.
 *    · 그 밖의 실패: 서버 문구를 그대로 보이고 창은 열어 둔다.
 *
 * 🔴 이름 · 사유를 console 에 싣지 않는다. 이메일은 이 창에 싣지 않는다(미리보기도
 * 싣지 않는다).
 * ============================================================================
 */
export default function UserDeletionDialog({
  targetUserId,
  targetName,
  onDeleted,
  onClose,
}: {
  targetUserId: string;
  targetName: string;
  onDeleted: (deletedName: string) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<UserDeletionDialogPhase>({ kind: "loading" });
  // 미리보기를 다시 부르고 싶을 때 올린다(CONFLICT). 불러오는 중 표시는 올리는 쪽이 건다.
  const [loadKey, setLoadKey] = useState(0);
  const [form, setForm] = useState<UserDeletionFormState>(EMPTY_USER_DELETION_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getUserDeletionPreviewAction({ targetUserId }).then(
      (result) => {
        if (cancelled) return;
        if (!result.ok) {
          setPhase({ kind: "failed", message: result.message });
          return;
        }
        setForm((previous) => ({
          ...previous,
          approvalSuccessorId: retainSuccessorSelection(
            previous.approvalSuccessorId,
            result.candidates.approvalSuccessors
          ),
          engineerSuccessorId: retainSuccessorSelection(
            previous.engineerSuccessorId,
            result.candidates.engineerSuccessors
          ),
        }));
        setPhase({ kind: "ready", preview: result });
      },
      () => {
        if (!cancelled) setPhase({ kind: "failed", message: USER_DELETION_UNEXPECTED_FAILURE });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [targetUserId, loadKey]);

  async function confirm() {
    if (phase.kind !== "ready" || isSubmitting) return;
    const preview = phase.preview;
    if (!checkUserDeletionSubmit(preview, form).enabled) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    setNoticeMessage(null);
    let result: DeleteUserAccountActionResult;
    try {
      result = await deleteUserAccountAction(buildUserDeletionActionInput(preview, form));
    } catch {
      setIsSubmitting(false);
      setErrorMessage(USER_DELETION_UNEXPECTED_FAILURE);
      return;
    }
    setIsSubmitting(false);

    if (result.ok) {
      onDeleted(preview.target.name);
      return;
    }
    if (result.code === "CONFLICT") {
      setNoticeMessage(USER_DELETION_CONFLICT_NOTICE);
      setPhase({ kind: "loading" });
      setLoadKey((key) => key + 1);
      return;
    }
    setErrorMessage(result.message);
  }

  return (
    <UserDeletionDialogView
      targetName={targetName}
      phase={phase}
      form={form}
      isSubmitting={isSubmitting}
      errorMessage={errorMessage}
      noticeMessage={noticeMessage}
      onApprovalSuccessorChange={(id) => setForm((previous) => ({ ...previous, approvalSuccessorId: id }))}
      onEngineerSuccessorChange={(id) => setForm((previous) => ({ ...previous, engineerSuccessorId: id }))}
      onReasonChange={(reason) => setForm((previous) => ({ ...previous, reason }))}
      onConfirm={() => void confirm()}
      onCancel={() => {
        if (!isSubmitting) onClose();
      }}
    />
  );
}
