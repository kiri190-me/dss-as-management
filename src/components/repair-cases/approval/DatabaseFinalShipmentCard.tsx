"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DatabaseApprovalCard, { type DatabaseApprovalActionButton } from "./DatabaseApprovalCard";
import ApprovalActionDialog from "./ApprovalActionDialog";
import { requestRepairCaseApprovalAction, decideRepairCaseApprovalAction } from "@/lib/server/actions/repair-case-approvals";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import { actorHasAllowedRole } from "@/lib/auth/developer-promotion";
import type { ApprovalRecordRow } from "@/lib/db/queries/repair-case-approvals";
import type { ShipmentDecideAuthorization } from "@/lib/db/queries/shipment-delegations";
import type { DatabaseDisplayApprovalStatus } from "./DatabaseApprovalStatusBadge";
import { resolveApprovalState } from "@/lib/domain/local/workflow/shipment-approval-checklist";

const REQUEST_ELIGIBLE_ROLES = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const;

type DialogState = "REQUEST" | "APPROVED" | "REJECTED" | null;

const DIALOG_TITLES: Record<Exclude<DialogState, null>, string> = {
  REQUEST: "출하 승인 요청",
  APPROVED: "출하 승인",
  REJECTED: "출하 반려",
};

/**
 * 검수 카드와 같은 이유로 도메인 함수 하나만 쓴다 — record.status만 보면
 * 무효가 된 승인이 "승인 완료"로 보이고, 그 상태에는 재요청 버튼이 없어
 * 화면에서 빠져나갈 길이 없었다.
 */
function displayStatusOf(record: ApprovalRecordRow | null, currentVersion: number): DatabaseDisplayApprovalStatus {
  const state = resolveApprovalState(record, currentVersion);
  return state === "PENDING" ? "REQUESTED" : state;
}

/**
 * Database-mode counterpart to FinalShipmentCard.tsx. Supports both direct
 * representative approval and delegated approval — decideAuthorization is
 * resolved server-side (resolveShipmentDecideAuthorization, repair-cases/
 * [id]/approval/page.tsx) since it isn't part of the shared ActingUser
 * shape and requires a DB read the client must never be trusted with. This
 * is a UI hint only: decideRepairCaseApproval() (the mutation) always
 * independently re-derives and re-verifies the same authorization itself.
 */
export default function DatabaseFinalShipmentCard({
  repairCaseId,
  record,
  actingUser,
  decideAuthorization,
  inspectionApproved,
  currentVersion,
}: {
  repairCaseId: string;
  record: ApprovalRecordRow | null;
  actingUser: ActingUser;
  decideAuthorization: ShipmentDecideAuthorization;
  /**
   * 수리 검수 승인이 **지금 version 기준으로** 유효한가. 서버의 요청 사전
   * 조건과 같은 기준이라야 한다 — 예전에는 status만 봐서, 무효가 된 검수
   * 승인을 유효한 것으로 보고 요청 버튼을 열었다가 서버에서 거절당했다.
   */
  inspectionApproved: boolean;
  /** 지금 접수 건의 version — 이 값과 다른 승인은 서버가 무효로 본다. */
  currentVersion: number;
}) {
  const router = useRouter();
  const [dialogState, setDialogState] = useState<DialogState>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const displayStatus = displayStatusOf(record, currentVersion);
  const requestEligible = actorHasAllowedRole(actingUser, REQUEST_ELIGIBLE_ROLES);

  const actions: DatabaseApprovalActionButton[] = [];
  let disabledReason: string | null = null;
  let blockedNotice: string | null = null;

  // STALE도 다시 요청해야 하는 상태다 — 서버는 이미 재요청을 받아 준다
  // (대기 중인 요청이 있을 때만 막는다). 막고 있던 것은 화면뿐이었다.
  if (displayStatus === "NOT_REQUESTED" || displayStatus === "REJECTED" || displayStatus === "STALE") {
    if (!inspectionApproved) {
      blockedNotice =
        displayStatus === "STALE"
          ? "승인 이후 접수 건이 변경되어(단계 진행 포함) 이 출하 승인은 무효입니다. 수리 검수 승인부터 다시 받아야 합니다."
          : "수리 검수 승인이 완료된 후 최종 출하 승인을 요청할 수 있습니다.";
    } else if (requestEligible) {
      actions.push({
        key: "request",
        label: displayStatus === "NOT_REQUESTED" ? "출하 승인 요청" : "출하 재요청",
        onClick: () => setDialogState("REQUEST"),
      });
      if (displayStatus === "STALE") {
        blockedNotice = "승인 이후 접수 건이 변경되어(단계 진행 포함) 이 승인은 더 이상 유효하지 않습니다. 다시 요청해 주세요.";
      }
    } else {
      disabledReason = "최고관리자·관리자·A/S 엔지니어만 요청할 수 있습니다.";
    }
  } else if (displayStatus === "REQUESTED") {
    if (decideAuthorization.allowed) {
      actions.push(
        { key: "approve", label: "출하 승인", onClick: () => setDialogState("APPROVED") },
        { key: "reject", label: "출하 반려", onClick: () => setDialogState("REJECTED"), tone: "danger" }
      );
    } else {
      disabledReason = "대표로 지정된 계정 또는 유효한 위임을 받은 대리 승인자만 처리할 수 있습니다.";
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
          {decideAuthorization.allowed && decideAuthorization.mode === "DIRECT"
            ? "대표로 지정된 계정입니다."
            : decideAuthorization.allowed && decideAuthorization.mode === "DELEGATED"
              ? `${decideAuthorization.representativeName}의 위임을 받아 처리할 수 있습니다.`
              : "대표로 지정된 계정도, 유효한 위임을 받은 대리 승인자도 아닙니다."}
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
