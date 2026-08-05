"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DatabaseApprovalCard, { type DatabaseApprovalActionButton } from "./DatabaseApprovalCard";
import ApprovalActionDialog from "./ApprovalActionDialog";
import { requestRepairCaseApprovalAction, decideRepairCaseApprovalAction } from "@/lib/server/actions/repair-case-approvals";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import type { ApprovalRecordRow } from "@/lib/db/queries/repair-case-approvals";
import type { DatabaseDisplayApprovalStatus } from "./DatabaseApprovalStatusBadge";

const REQUEST_ELIGIBLE_ROLES = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const;
const DECIDE_ELIGIBLE_ROLES = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const;

type DialogState = "REQUEST" | "APPROVED" | "REJECTED" | null;

const DIALOG_TITLES: Record<Exclude<DialogState, null>, string> = {
  REQUEST: "검수 승인 요청",
  APPROVED: "검수 승인",
  REJECTED: "검수 반려",
};

function displayStatusOf(record: ApprovalRecordRow | null): DatabaseDisplayApprovalStatus {
  return record?.status ?? "NOT_REQUESTED";
}

/**
 * Database-mode counterpart to RepairInspectionCard.tsx — same UI shape and
 * dialog flow, backed by Server Actions instead of a localStorage action
 * module. router.refresh() after every successful action re-fetches the
 * server-rendered approval state, same pattern DatabaseWorkflowControlPanel
 * already uses.
 */
export default function DatabaseRepairInspectionCard({
  repairCaseId,
  record,
  actingUser,
}: {
  repairCaseId: string;
  record: ApprovalRecordRow | null;
  actingUser: ActingUser;
}) {
  const router = useRouter();
  const [dialogState, setDialogState] = useState<DialogState>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const displayStatus = displayStatusOf(record);
  const requestEligible = (REQUEST_ELIGIBLE_ROLES as readonly string[]).includes(actingUser.role);
  const decideEligible = (DECIDE_ELIGIBLE_ROLES as readonly string[]).includes(actingUser.role);

  const actions: DatabaseApprovalActionButton[] = [];
  let disabledReason: string | null = null;

  if (displayStatus === "NOT_REQUESTED" || displayStatus === "REJECTED") {
    if (requestEligible) {
      actions.push({
        key: "request",
        label: displayStatus === "NOT_REQUESTED" ? "검수 승인 요청" : "재요청",
        onClick: () => setDialogState("REQUEST"),
      });
    } else {
      disabledReason = "최고관리자·관리자·A/S 엔지니어만 요청할 수 있습니다.";
    }
  } else if (displayStatus === "REQUESTED") {
    if (decideEligible) {
      actions.push(
        { key: "approve", label: "검수 승인", onClick: () => setDialogState("APPROVED") },
        { key: "reject", label: "반려", onClick: () => setDialogState("REJECTED"), tone: "danger" }
      );
    } else {
      disabledReason = "최고관리자·관리자·A/S 엔지니어만 처리할 수 있습니다.";
    }
  } else if (displayStatus === "APPROVED") {
    disabledReason = "이미 승인 완료되어 추가 처리를 할 수 없습니다.";
  }

  async function handleConfirm(comment: string | null) {
    if (!dialogState || isSubmitting) return;
    setIsSubmitting(true);
    const result =
      dialogState === "REQUEST"
        ? await requestRepairCaseApprovalAction({ repairCaseId, approvalType: "REPAIR_INSPECTION", reason: comment })
        : await decideRepairCaseApprovalAction({
            repairCaseId,
            approvalType: "REPAIR_INSPECTION",
            decision: dialogState,
            reason: comment,
          });
    setIsSubmitting(false);
    if (!result.ok) {
      setStatusMessage(result.message);
      return;
    }
    setStatusMessage(dialogState === "REQUEST" ? "검수 승인을 요청했습니다." : `검수 ${DIALOG_TITLES[dialogState]}이 처리되었습니다.`);
    setDialogState(null);
    router.refresh();
  }

  return (
    <>
      <DatabaseApprovalCard
        title="수리 검수 승인"
        record={record}
        displayStatus={displayStatus}
        actions={actions}
        disabledReason={disabledReason}
      />
      <p role="status" aria-live="polite" className="sr-only">
        {statusMessage ?? ""}
      </p>
      {statusMessage && !dialogState && <p className="text-xs text-zinc-500 dark:text-zinc-400">{statusMessage}</p>}
      <ApprovalActionDialog
        isOpen={dialogState !== null}
        title={dialogState ? DIALOG_TITLES[dialogState] : ""}
        requireComment={dialogState === "REJECTED"}
        isSubmitting={isSubmitting}
        onConfirm={(comment) => void handleConfirm(comment)}
        onCancel={() => setDialogState(null)}
      />
    </>
  );
}
