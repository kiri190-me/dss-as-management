"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DatabaseApprovalCard, { type DatabaseApprovalActionButton } from "./DatabaseApprovalCard";
import ApprovalActionDialog from "./ApprovalActionDialog";
import { requestRepairCaseApprovalAction, decideRepairCaseApprovalAction } from "@/lib/server/actions/repair-case-approvals";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import { actorHasAllowedRole } from "@/lib/auth/developer-promotion";
import { approvalFollowsRoute, mayDecideAssignedApproval } from "@/lib/auth/approval-assignment";
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
  routeTotalSteps,
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
  /**
   * 이 요청이 타고 있는 결재선 **판의 전체 단계 수**. 결재선을 타지 않으면
   * `null`이고, 그때 진행 표시는 그리지 않는다.
   *
   * 🔴 「현재 판」이 아니라 **이 요청 행에 적힌 판**을 센 값이라야 한다 —
   * 서버(page.tsx)가 record.routeId 로 읽어 내려보낸다. 진행 중인 건은 옛 판을
   * 끝까지 따라가므로, 현재 판을 세면 「2/2단계」가 「2/4단계」로 보인다.
   */
  routeTotalSteps: number | null;
}) {
  const router = useRouter();
  const [dialogState, setDialogState] = useState<DialogState>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const displayStatus = displayStatusOf(record, currentVersion);
  const requestEligible = actorHasAllowedRole(actingUser, REQUEST_ELIGIBLE_ROLES);
  // 이 요청이 결재선을 타는가 — 서버가 실제로 판정하는 것과 **같은 함수**를
  // 부른다. 참이면 절차가 「출하 대표」를 대신하므로 대표·위임을 보지 않는다.
  const followsRoute = record !== null && approvalFollowsRoute(record);
  // 지정 관문. 결재선을 타지 않는 출하 요청은 지정이 언제나 NULL 이라 늘
  // 열려 있어 동작이 바뀌지 않는다 — 그래도 두 축을 함께 적어 둔다.
  const assignedGateOpen = mayDecideAssignedApproval(record?.assignedApproverUserId ?? null, actingUser);

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
    if (!followsRoute && !decideAuthorization.allowed) {
      // 결재선을 타지 않는 요청 — 예전 그대로 대표·위임만 처리한다.
      disabledReason = "대표로 지정된 계정 또는 유효한 위임을 받은 대리 승인자만 처리할 수 있습니다.";
    } else if (!assignedGateOpen) {
      // 자격은 있는데 지금 내 차례가 아닌 경우. 단추를 감추기만 하면 사람은 왜
      // 못 누르는지 모른다 — 누구 차례인지 이름을 적는다(검수 카드와 같은 문구).
      disabledReason = record?.assignedApproverName
        ? `이 요청은 ${record.assignedApproverName} 님에게 지정되어 있습니다.`
        : "이 요청은 지정된 승인자만 처리할 수 있습니다.";
    } else {
      actions.push(
        { key: "approve", label: "출하 승인", onClick: () => setDialogState("APPROVED") },
        { key: "reject", label: "출하 반려", onClick: () => setDialogState("REJECTED"), tone: "danger" }
      );
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

  /**
   * 결재선을 타는 요청에서는 이 칸이 「처리 자격」(대표·위임) 대신 **진행
   * 상황**을 말한다 — 절차가 대표를 대신하므로 대표 여부는 이 요청에 아무
   * 의미가 없고, 사람이 알고 싶은 것은 「몇 단계까지 왔고 지금 누구 차례인가」다.
   *
   * 뒷자리(전체 단계 수)는 서버가 **이 행에 적힌 판**을 세어 내려보낸 값이다.
   * 못 세었으면 앞자리만 적는다 — 「2/」처럼 반쪽짜리를 보여 주지 않는다.
   *
   * 「지금 차례」는 **아직 대기 중일 때만** 적는다. 이미 처리된 단계에 그대로
   * 두면 승인·반려가 끝난 칸이 「지금 ○○○ 차례」라고 말하게 된다.
   */
  const routeProgress =
    followsRoute && record?.routeStepOrder !== null && record?.routeStepOrder !== undefined
      ? `결재선 ${record.routeStepOrder}${routeTotalSteps && routeTotalSteps > 0 ? `/${routeTotalSteps}` : ""}단계${
          displayStatus === "REQUESTED"
            ? ` · 지금 차례: ${record.assignedApproverName ?? "확인할 수 없습니다"}`
            : ""
        }`
      : null;

  const extra = (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-md bg-zinc-50 p-3 text-sm sm:grid-cols-2 dark:bg-zinc-800/60">
      <div>
        <dt className="text-xs text-zinc-500 dark:text-zinc-400">{routeProgress ? "결재선 진행" : "처리 자격"}</dt>
        <dd className="text-zinc-900 dark:text-zinc-50">
          {routeProgress ??
            (decideAuthorization.allowed && decideAuthorization.mode === "DIRECT"
              ? "대표로 지정된 계정입니다."
              : decideAuthorization.allowed && decideAuthorization.mode === "DELEGATED"
                ? `${decideAuthorization.representativeName}의 위임을 받아 처리할 수 있습니다.`
                : "대표로 지정된 계정도, 유효한 위임을 받은 대리 승인자도 아닙니다.")}
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
        onConfirm={(comment) => void handleConfirm(comment)}
        onCancel={() => setDialogState(null)}
      />
    </>
  );
}
