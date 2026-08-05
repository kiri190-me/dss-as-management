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

type DialogState = "REQUEST" | "APPROVED" | "REJECTED" | null;

const DIALOG_TITLES: Record<Exclude<DialogState, null>, string> = {
  REQUEST: "출하 승인 요청",
  APPROVED: "출하 승인",
  REJECTED: "출하 반려",
};

function displayStatusOf(record: ApprovalRecordRow | null): DatabaseDisplayApprovalStatus {
  return record?.status ?? "NOT_REQUESTED";
}

/**
 * Database-mode counterpart to FinalShipmentCard.tsx. No delegation UI —
 * database mode only supports the representative deciding directly (see
 * users.is_shipment_representative and the Phase-1 report's flagged
 * architectural decision); `isRepresentative` is resolved server-side
 * (repair-cases/[id]/approval/page.tsx) since it isn't part of the shared
 * ActingUser shape.
 */
export default function DatabaseFinalShipmentCard({
  repairCaseId,
  record,
  actingUser,
  isRepresentative,
  inspectionApproved,
}: {
  repairCaseId: string;
  record: ApprovalRecordRow | null;
  actingUser: ActingUser;
  isRepresentative: boolean;
  inspectionApproved: boolean;
}) {
  const router = useRouter();
  const [dialogState, setDialogState] = useState<DialogState>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const displayStatus = displayStatusOf(record);
  const requestEligible = (REQUEST_ELIGIBLE_ROLES as readonly string[]).includes(actingUser.role);

  const actions: DatabaseApprovalActionButton[] = [];
  let disabledReason: string | null = null;
  let blockedNotice: string | null = null;

  if (displayStatus === "NOT_REQUESTED" || displayStatus === "REJECTED") {
    if (!inspectionApproved) {
      blockedNotice = "수리 검수 승인이 완료된 후 최종 출하 승인을 요청할 수 있습니다.";
    } else if (requestEligible) {
      actions.push({
        key: "request",
        label: displayStatus === "NOT_REQUESTED" ? "출하 승인 요청" : "출하 재요청",
        onClick: () => setDialogState("REQUEST"),
      });
    } else {
      disabledReason = "최고관리자·관리자·A/S 엔지니어만 요청할 수 있습니다.";
    }
  } else if (displayStatus === "REQUESTED") {
    if (isRepresentative) {
      actions.push(
        { key: "approve", label: "출하 승인", onClick: () => setDialogState("APPROVED") },
        { key: "reject", label: "출하 반려", onClick: () => setDialogState("REJECTED"), tone: "danger" }
      );
    } else {
      disabledReason = "대표로 지정된 계정만 처리할 수 있습니다.";
    }
  } else if (displayStatus === "APPROVED") {
    disabledReason = "이미 승인 완료되어 추가 처리를 할 수 없습니다.";
  }

  async function handleConfirm(comment: string | null) {
    if (!dialogState || isSubmitting) return;
    setIsSubmitting(true);
    const result =
      dialogState === "REQUEST"
        ? await requestRepairCaseApprovalAction({ repairCaseId, approvalType: "FINAL_SHIPMENT", reason: comment })
        : await decideRepairCaseApprovalAction({
            repairCaseId,
            approvalType: "FINAL_SHIPMENT",
            decision: dialogState,
            reason: comment,
          });
    setIsSubmitting(false);
    if (!result.ok) {
      setStatusMessage(result.message);
      return;
    }
    setStatusMessage(dialogState === "REQUEST" ? "출하 승인을 요청했습니다." : `${DIALOG_TITLES[dialogState]}이 처리되었습니다.`);
    setDialogState(null);
    router.refresh();
  }

  const extra = (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-md bg-zinc-50 p-3 text-sm sm:grid-cols-2 dark:bg-zinc-800/60">
      <div>
        <dt className="text-xs text-zinc-500 dark:text-zinc-400">처리 자격</dt>
        <dd className="text-zinc-900 dark:text-zinc-50">
          {isRepresentative ? "대표로 지정된 계정입니다." : "대표로 지정된 계정이 아닙니다."}
        </dd>
      </div>
    </dl>
  );

  return (
    <>
      <DatabaseApprovalCard
        title="최종 출하 승인"
        record={record}
        displayStatus={displayStatus}
        extra={extra}
        blockedNotice={blockedNotice}
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
