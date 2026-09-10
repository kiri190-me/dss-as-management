"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DatabaseApprovalCard, { type DatabaseApprovalActionButton } from "./DatabaseApprovalCard";
import ApprovalActionDialog, { type ApprovalAssigneeOption } from "./ApprovalActionDialog";
import { requestRepairCaseApprovalAction, decideRepairCaseApprovalAction } from "@/lib/server/actions/repair-case-approvals";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import { actorHasAllowedRole } from "@/lib/auth/developer-promotion";
import { mayDecideAssignedApproval, standsInForAssignedApprover } from "@/lib/auth/approval-assignment";
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
  assigneeCandidates,
}: {
  repairCaseId: string;
  record: ApprovalRecordRow | null;
  actingUser: ActingUser;
  /** 지금 접수 건의 version — 이 값과 다른 승인은 서버가 무효로 본다. */
  currentVersion: number;
  /**
   * 「누구에게 보낼까요」 후보 — 지금 검수 승인을 처리할 수 있는 사람들이다.
   * 서버에서 계산해 내려온다(page.tsx). 지정은 선택이라 비어 있어도 요청은
   * 그대로 된다.
   */
  assigneeCandidates: ApprovalAssigneeOption[];
}) {
  const router = useRouter();
  const [dialogState, setDialogState] = useState<DialogState>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const displayStatus = displayStatusOf(record, currentVersion);
  const requestEligible = actorHasAllowedRole(actingUser, REQUEST_ELIGIBLE_ROLES);
  const decideEligible = actorHasAllowedRole(actingUser, DECIDE_ELIGIBLE_ROLES);
  // 자격(위)을 통과한 **뒤** 보는 관문이다. 서버가 실제로 강제하는 것과 같은
  // 함수를 부른다 — 여기서 따로 계산하면 「단추는 보이는데 누르면 거절」이나
  // 그 반대가 된다. 지정이 없으면(null) 언제나 참이라 지금까지와 같다.
  const assignedGateOpen = mayDecideAssignedApproval(record?.assignedApproverUserId ?? null, actingUser);
  // 지정된 사람이 따로 있는데 내가 그 자리에 서 있는가. 「그래도 되는가」는 위
  // 지정 관문이 이미 답했다 — 이것은 **모양**만 묻는 판정이고, 이력의 「지정자
  // 대신 처리」 배지와 출하 카드의 안내가 같은 함수를 본다.
  const standingInForAssignee = standsInForAssignedApprover(
    record?.assignedApproverUserId ?? null,
    actingUser.id
  );

  const actions: DatabaseApprovalActionButton[] = [];
  let disabledReason: string | null = null;
  let blockedNotice: string | null = null;

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
    if (!decideEligible) {
      disabledReason = "최고관리자·관리자·A/S 엔지니어만 처리할 수 있습니다.";
    } else if (!assignedGateOpen) {
      // 자격은 있는데 이 요청이 남에게 지정돼 있는 경우. 단추를 감추기만 하면
      // 사람은 왜 못 누르는지 모른다 — 누구에게 갔는지 이름을 적는다.
      disabledReason = record?.assignedApproverName
        ? `이 요청은 ${record.assignedApproverName} 님에게 지정되어 있습니다.`
        : "이 요청은 지정된 승인자만 처리할 수 있습니다.";
    } else {
      // 🔴 비상구를 **누르기 전에** 말한다. 지정 관문이 열렸는데 지정된 사람이
      // 따로 있다는 것은, 지금 보고 있는 사람이 최고관리자 권한으로 남의 자리에
      // 서 있다는 뜻이다(그 길이 mayDecideAssignedApproval 의 유일한 예외다).
      //
      // 🔴 이 안내를 disabledReason 으로 내보내면 **아무 데도 보이지 않는다** —
      // 껍데기(DatabaseApprovalCard)는 그 문구를 단추가 하나도 없을 때만 그리는데,
      // 여기는 단추가 **있는** 자리다. 그래서 단추와 함께 그려지는 blockedNotice
      // 로 낸다. 문구는 출하 카드와 글자 그대로 같다 — 같은 상황에 두 가지 말이
      // 생기면 안 된다.
      //
      // 지정이 없으면(NULL) 판정이 언제나 거짓이라, 이 칸이 생기기 전 화면에
      // 없던 문구가 끼어들지 않는다.
      if (standingInForAssignee) {
        blockedNotice = `지금 차례는 ${
          record?.assignedApproverName ?? "다른 승인자"
        } 님입니다. 최고관리자 권한으로 대신 처리합니다.`;
      }
      actions.push(
        { key: "approve", label: "검수 승인", onClick: () => setDialogState("APPROVED") },
        { key: "reject", label: "반려", onClick: () => setDialogState("REJECTED"), tone: "danger" }
      );
    }
  } else if (displayStatus === "APPROVED") {
    disabledReason = "이미 승인 완료되어 추가 처리를 할 수 없습니다.";
  }

  async function handleConfirm(comment: string | null, assignedApproverUserId: string | null) {
    if (!dialogState || isSubmitting) return;
    setIsSubmitting(true);
    const result =
      dialogState === "REQUEST"
        ? await requestRepairCaseApprovalAction({
            repairCaseId,
            approvalType: "REPAIR_INSPECTION",
            reason: comment,
            assignedApproverUserId,
          })
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
        blockedNotice={blockedNotice}
        actions={actions}
        disabledReason={disabledReason}
        // 확인 창이 떠 있는 동안에는 보이지 않는다 — 창 뒤에서 지난 결과가
        // 새 결과처럼 읽히지 않게 하려는 것이다(원래 동작 그대로).
        statusMessage={dialogState ? null : statusMessage}
      />
      {/*
        읽어 주기 통로. 값이 없을 때도 빈 문자열로 **항상 DOM 에 남아 있어야**
        내용이 바뀔 때 읽힌다. 절대배치(sr-only)라 격자 칸을 먹지 않는다.
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {statusMessage ?? ""}
      </p>
      <ApprovalActionDialog
        isOpen={dialogState !== null}
        title={dialogState ? DIALOG_TITLES[dialogState] : ""}
        requireComment={dialogState === "REJECTED"}
        isSubmitting={isSubmitting}
        // 고르는 자리는 **요청일 때만** 나온다 — 같은 창을 승인·반려에도
        // 쓰는데, 그때는 지정할 것이 없다(이미 정해진 요청을 처리할 뿐이다).
        assigneeOptions={dialogState === "REQUEST" ? assigneeCandidates : undefined}
        onConfirm={(comment, assignedApproverUserId) => void handleConfirm(comment, assignedApproverUserId)}
        onCancel={() => setDialogState(null)}
      />
    </>
  );
}
