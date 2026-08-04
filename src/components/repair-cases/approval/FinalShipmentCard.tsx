"use client";

import { useState } from "react";
import ApprovalCard, { type ApprovalActionButton } from "./ApprovalCard";
import ApprovalActionDialog from "./ApprovalActionDialog";
import { actionErrorMessages, decideApproval, requestApproval } from "@/lib/domain/local/approval/actions";
import {
  getDisplayStatus,
  isRequestEligible,
  resolveShipmentAuthorization,
  type ActingUser,
} from "@/lib/domain/local/approval/transitions";
import { isDelegationValidAt, type LocalShipmentDelegation } from "@/lib/domain/local/approval/delegation-types";
import { FINAL_SHIPMENT_REPRESENTATIVE_USER_ID } from "@/lib/domain/local/approval/representative";
import type { LocalApprovalRecord } from "@/lib/domain/local/approval/approval-types";

type DialogState = "REQUEST" | "APPROVED" | "CHANGES_REQUESTED" | "REJECTED" | null;

const DIALOG_TITLES: Record<Exclude<DialogState, null>, string> = {
  REQUEST: "출하 승인 요청",
  APPROVED: "출하 승인",
  CHANGES_REQUESTED: "출하 보완 요청",
  REJECTED: "출하 반려",
};

function formatPeriod(startsAt: string, endsAt: string): string {
  const format = (iso: string) =>
    new Date(iso).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${format(startsAt)} ~ ${format(endsAt)}`;
}

export default function FinalShipmentCard({
  repairCaseId,
  record,
  actingUser,
  inspectionApproved,
  delegations,
}: {
  repairCaseId: string;
  record: LocalApprovalRecord | null;
  actingUser: ActingUser;
  inspectionApproved: boolean;
  delegations: LocalShipmentDelegation[];
}) {
  const [dialogState, setDialogState] = useState<DialogState>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const displayStatus = getDisplayStatus(record);
  const requestEligible = isRequestEligible(actingUser);
  const nowIso = new Date().toISOString();
  const shipmentAuth = resolveShipmentAuthorization(actingUser, delegations, nowIso);
  const activeDelegation = delegations.find(
    (d) => d.principalUserId === FINAL_SHIPMENT_REPRESENTATIVE_USER_ID && isDelegationValidAt(d, nowIso)
  );

  const actions: ApprovalActionButton[] = [];
  let disabledReason: string | null = null;
  let blockedNotice: string | null = null;

  if (displayStatus === "NOT_REQUESTED" || displayStatus === "CHANGES_REQUESTED" || displayStatus === "REJECTED") {
    if (!inspectionApproved) {
      blockedNotice = "수리 검수 승인이 완료된 후 최종 출하 승인을 요청할 수 있습니다.";
    } else if (requestEligible) {
      actions.push({
        key: "request",
        label: displayStatus === "NOT_REQUESTED" ? "출하 승인 요청" : "출하 재요청",
        onClick: () => setDialogState("REQUEST"),
      });
    } else {
      disabledReason = "최고관리자·관리자·A/S 엔지니어만 요청할 수 있는 데모 규칙입니다.";
    }
  } else if (displayStatus === "PENDING") {
    if (shipmentAuth.allowed) {
      actions.push(
        { key: "approve", label: "출하 승인", onClick: () => setDialogState("APPROVED") },
        { key: "changes", label: "출하 보완 요청", onClick: () => setDialogState("CHANGES_REQUESTED") },
        { key: "reject", label: "출하 반려", onClick: () => setDialogState("REJECTED"), tone: "danger" }
      );
    } else {
      disabledReason = "대표 또는 유효한 위임을 받은 사용자만 처리할 수 있습니다.";
    }
  } else if (displayStatus === "APPROVED") {
    disabledReason = "이미 승인 완료되어 이 데모 단계에서는 추가 처리를 할 수 없습니다.";
  }

  function handleConfirm(comment: string | null) {
    if (!dialogState) return;
    setIsSubmitting(true);
    const result =
      dialogState === "REQUEST"
        ? requestApproval({ repairCaseId, approvalType: "FINAL_SHIPMENT", actingUser })
        : decideApproval({
            repairCaseId,
            approvalType: "FINAL_SHIPMENT",
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
      dialogState === "REQUEST" ? "출하 승인을 요청했습니다." : `${DIALOG_TITLES[dialogState]}이 처리되었습니다.`
    );
    setDialogState(null);
  }

  const extra = (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-md bg-zinc-50 p-3 text-sm sm:grid-cols-2 dark:bg-zinc-800/60">
      <div>
        <dt className="text-xs text-zinc-500 dark:text-zinc-400">대표</dt>
        <dd className="text-zinc-900 dark:text-zinc-50">김도윤</dd>
      </div>
      <div>
        <dt className="text-xs text-zinc-500 dark:text-zinc-400">현재 활성 위임</dt>
        <dd className="text-zinc-900 dark:text-zinc-50">
          {activeDelegation
            ? `${activeDelegation.delegateNameSnapshot} (${formatPeriod(activeDelegation.startsAt, activeDelegation.endsAt)}) · 사유: ${activeDelegation.reason}`
            : "현재 활성 위임 없음"}
        </dd>
      </div>
    </dl>
  );

  return (
    <>
      <ApprovalCard
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
