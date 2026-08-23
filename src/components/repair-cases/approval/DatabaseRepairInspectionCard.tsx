"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DatabaseApprovalCard, { type DatabaseApprovalActionButton } from "./DatabaseApprovalCard";
import ApprovalActionDialog from "./ApprovalActionDialog";
import { requestRepairCaseApprovalAction, decideRepairCaseApprovalAction } from "@/lib/server/actions/repair-case-approvals";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import type { ApprovalRecordRow } from "@/lib/db/queries/repair-case-approvals";
import type { DatabaseDisplayApprovalStatus } from "./DatabaseApprovalStatusBadge";
import { resolveApprovalState } from "@/lib/domain/local/workflow/shipment-approval-checklist";

const REQUEST_ELIGIBLE_ROLES = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const;
const DECIDE_ELIGIBLE_ROLES = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const;

type DialogState = "REQUEST" | "APPROVED" | "REJECTED" | null;

const DIALOG_TITLES: Record<Exclude<DialogState, null>, string> = {
  REQUEST: "검수 승인 요청",
  APPROVED: "검수 승인",
  REJECTED: "검수 반려",
};

/**
 * 상태 판정은 도메인 함수 하나만 쓴다 — 전에는 여기서 record.status만 봤고,
 * 그래서 version이 바뀌어 서버가 무효로 보는 승인도 "승인 완료"로 보였다.
 * 그 상태에서는 재요청 버튼이 없어 화면에서 빠져나갈 길이 없었다.
 */
function displayStatusOf(record: ApprovalRecordRow | null, currentVersion: number): DatabaseDisplayApprovalStatus {
  const state = resolveApprovalState(record, currentVersion);
  return state === "PENDING" ? "REQUESTED" : state;
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
  currentVersion,
}: {
  repairCaseId: string;
  record: ApprovalRecordRow | null;
  actingUser: ActingUser;
  /** 지금 접수 건의 version — 이 값과 다른 승인은 서버가 무효로 본다. */
  currentVersion: number;
}) {
  const router = useRouter();
  const [dialogState, setDialogState] = useState<DialogState>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const displayStatus = displayStatusOf(record, currentVersion);
  const requestEligible = (REQUEST_ELIGIBLE_ROLES as readonly string[]).includes(actingUser.role);
  const decideEligible = (DECIDE_ELIGIBLE_ROLES as readonly string[]).includes(actingUser.role);

  const actions: DatabaseApprovalActionButton[] = [];
  let disabledReason: string | null = null;

  // STALE도 요청을 다시 열어야 하는 상태다. 서버는 이미 재요청을 받아 준다
  // (대기 중인 요청이 있을 때만 막는다) — 막고 있던 것은 화면뿐이었다.
  if (displayStatus === "NOT_REQUESTED" || displayStatus === "REJECTED" || displayStatus === "STALE") {
    if (requestEligible) {
      actions.push({
        key: "request",
        label: displayStatus === "NOT_REQUESTED" ? "검수 승인 요청" : "재요청",
        onClick: () => setDialogState("REQUEST"),
      });
      if (displayStatus === "STALE") {
        disabledReason = "승인 이후 접수 건이 변경되어(단계 진행 포함) 이 승인은 더 이상 유효하지 않습니다. 다시 요청해 주세요.";
      }
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
