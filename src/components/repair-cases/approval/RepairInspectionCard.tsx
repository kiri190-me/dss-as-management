"use client";

import { useState } from "react";
import ApprovalCard, { type ApprovalActionButton } from "./ApprovalCard";
import ApprovalActionDialog from "./ApprovalActionDialog";
import { actionErrorMessages, decideApproval, requestApproval } from "@/lib/domain/local/approval/actions";
import {
  getDisplayStatus,
  isInspectionDecideEligible,
  isRequestEligible,
  type ActingUser,
} from "@/lib/domain/local/approval/transitions";
import type { LocalApprovalRecord } from "@/lib/domain/local/approval/approval-types";

type DialogState = "REQUEST" | "APPROVED" | "CHANGES_REQUESTED" | "REJECTED" | null;

const DIALOG_TITLES: Record<Exclude<DialogState, null>, string> = {
  REQUEST: "검수 승인 요청",
  APPROVED: "검수 승인",
  CHANGES_REQUESTED: "검수 보완 요청",
  REJECTED: "검수 반려",
};

export default function RepairInspectionCard({
  repairCaseId,
  record,
  actingUser,
}: {
  repairCaseId: string;
  record: LocalApprovalRecord | null;
  actingUser: ActingUser;
}) {
  const [dialogState, setDialogState] = useState<DialogState>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const displayStatus = getDisplayStatus(record);
  const requestEligible = isRequestEligible(actingUser);
  const decideEligible = isInspectionDecideEligible(actingUser);

  const actions: ApprovalActionButton[] = [];
  let disabledReason: string | null = null;

  if (displayStatus === "NOT_REQUESTED" || displayStatus === "CHANGES_REQUESTED" || displayStatus === "REJECTED") {
    if (requestEligible) {
      actions.push({
        key: "request",
        label: displayStatus === "NOT_REQUESTED" ? "검수 승인 요청" : "재요청",
        onClick: () => setDialogState("REQUEST"),
      });
    } else {
      disabledReason = "최고관리자·관리자·A/S 엔지니어만 요청할 수 있는 데모 규칙입니다.";
    }
  } else if (displayStatus === "PENDING") {
    if (decideEligible) {
      actions.push(
        { key: "approve", label: "검수 승인", onClick: () => setDialogState("APPROVED") },
        { key: "changes", label: "보완 요청", onClick: () => setDialogState("CHANGES_REQUESTED") },
        { key: "reject", label: "반려", onClick: () => setDialogState("REJECTED"), tone: "danger" }
      );
    } else {
      disabledReason = "최고관리자·관리자·A/S 엔지니어만 처리할 수 있는 데모 규칙입니다.";
    }
  } else if (displayStatus === "APPROVED") {
    disabledReason = "이미 승인 완료되어 이 데모 단계에서는 추가 처리를 할 수 없습니다.";
  }

  function handleConfirm(comment: string | null) {
    if (!dialogState) return;
    setIsSubmitting(true);
    const result =
      dialogState === "REQUEST"
        ? requestApproval({ repairCaseId, approvalType: "REPAIR_INSPECTION", actingUser })
        : decideApproval({
            repairCaseId,
            approvalType: "REPAIR_INSPECTION",
            decision: dialogState,
            comment,
            actingUser,
          });
    setIsSubmitting(false);
    if (!result.ok) {
      setStatusMessage(actionErrorMessages[result.reason]);
      return;
    }
    setStatusMessage(
      dialogState === "REQUEST" ? "검수 승인을 요청했습니다." : `검수 ${DIALOG_TITLES[dialogState]}이 처리되었습니다.`
    );
    setDialogState(null);
  }

  return (
    <>
      <ApprovalCard
        title="수리 검수 승인"
        record={record}
        displayStatus={displayStatus}
        actions={actions}
        disabledReason={disabledReason}
      />
      <p role="status" aria-live="polite" className="sr-only">
        {statusMessage ?? ""}
      </p>
      {statusMessage && !dialogState && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{statusMessage}</p>
      )}
      <ApprovalActionDialog
        isOpen={dialogState !== null}
        title={dialogState ? DIALOG_TITLES[dialogState] : ""}
        requireComment={dialogState === "CHANGES_REQUESTED" || dialogState === "REJECTED"}
        isSubmitting={isSubmitting}
        onConfirm={handleConfirm}
        onCancel={() => setDialogState(null)}
      />
    </>
  );
}
