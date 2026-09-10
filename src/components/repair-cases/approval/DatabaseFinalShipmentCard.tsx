"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import DatabaseApprovalCard, { type DatabaseApprovalActionButton } from "./DatabaseApprovalCard";
import ApprovalActionDialog from "./ApprovalActionDialog";
import { UNSET_TARGET_SHIPMENT_DATE_TEXT } from "./approval-texts";
import { requestRepairCaseApprovalAction, decideRepairCaseApprovalAction } from "@/lib/server/actions/repair-case-approvals";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import { actorHasAllowedRole } from "@/lib/auth/developer-promotion";
import {
  approvalFollowsRoute,
  mayDecideAssignedApproval,
  standsInForAssignedApprover,
} from "@/lib/auth/approval-assignment";
import type { ApprovalRecordRow } from "@/lib/db/queries/repair-case-approvals";
import type { ShipmentApprovalRouteStepLabel } from "@/lib/db/queries/shipment-approval-routes";
import { isRouteStepSkippedForRequester } from "@/lib/domain/shipment-approval-route";
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

/** 진행 미리보기 한 칸의 모양 — 상자 색과 그 아래 글자를 함께 정한다. */
type RouteStepMark = { toneClass: string; stateLabel: string };

/**
 * 🔴 **색만으로 상태를 구분하지 않는다**(UI_GUIDELINE 7절) — 상자 색과 글자를
 * 한 자리에서 함께 정하는 이유가 그것이다. 따로 두면 한쪽만 늘어난다.
 *
 * 색 계열은 승인 배지(DatabaseApprovalStatusBadge)와 같게 맞춘다: 완료=성공색,
 * 지금 차례=강조색, 반려=위험색, 재승인 필요=경고색, 아직 안 온 단계=중립색.
 */
const DONE_MARK: RouteStepMark = {
  toneClass: "border-green-300 text-green-700 dark:border-green-900 dark:text-green-400",
  stateLabel: "완료",
};
const UPCOMING_MARK: RouteStepMark = {
  toneClass: "border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400",
  stateLabel: "대기",
};
/**
 * 🔴 요청자 본인이라 결재를 받지 않는 단계. **「완료」로 칠하면 거짓말이다** —
 * 아무도 승인하지 않았는데 승인된 것처럼 보인다.
 *
 * 색은 아직 안 온 단계와 같은 중립색이되 **테두리를 점선으로** 둔다. 색만으로
 * 구분하지 않는다는 원칙(위 참조) 위에 한 겹 더 얹는 것이다 — 아래 글자가 이미
 * 「건너뜀 · 요청자 본인」이라고 말하고, 점선은 그 칸이 이 사슬에서 자리를 차지
 * 하지 않는다는 것을 모양으로도 보여 준다.
 */
const SKIPPED_MARK: RouteStepMark = {
  toneClass: "border-dashed border-zinc-300 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500",
  stateLabel: "건너뜀 · 요청자 본인",
};

/**
 * 그 단계가 지금 어디쯤인가. 앞 단계는 이미 승인돼야 다음 요청 행이 생기므로
 * **지금 단계보다 앞이면 언제나 완료**다(진행 중인 건은 옛 판을 끝까지 따라가고,
 * 그 판의 단계 번호가 곧 여기 들어오는 값이다).
 *
 * 🔴 **건너뛴 단계는 예외다.** 요청자 본인 단계는 결재를 받지 않고 지나가므로,
 * 「앞이면 완료」에 그대로 걸리면 아무도 승인하지 않은 칸이 「완료」로 보인다.
 * 그래서 앞뒤를 가르기 **전에** 먼저 본다.
 *
 * 다만 **지금 단계 자신**은 건너뜀으로 칠하지 않는다. 이 규칙이 생기기 전에
 * 만들어진 행은 요청자 자신이 지정된 채 대기 중일 수 있는데, 그 칸을
 * 「건너뜀」이라고 하면 지금 실제로 열려 있는 차례를 부정하게 된다.
 *
 * 지금 단계 자신은 이 요청 행의 상태를 그대로 따른다 — 승인·반려가 끝난 칸이
 * 「지금 차례」라고 말하지 않게 하려는 것이다.
 */
function markForRouteStep(
  stepOrder: number,
  currentStepOrder: number,
  displayStatus: DatabaseDisplayApprovalStatus,
  isSkippedStep: boolean
): RouteStepMark {
  if (isSkippedStep && stepOrder !== currentStepOrder) return SKIPPED_MARK;
  if (stepOrder < currentStepOrder) return DONE_MARK;
  if (stepOrder > currentStepOrder) return UPCOMING_MARK;
  if (displayStatus === "APPROVED") return DONE_MARK;
  if (displayStatus === "REJECTED") {
    return {
      toneClass: "border-red-300 text-red-700 dark:border-red-900 dark:text-red-400",
      stateLabel: "반려",
    };
  }
  if (displayStatus === "STALE") {
    return {
      toneClass: "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400",
      stateLabel: "재승인 필요",
    };
  }
  return {
    toneClass: "border-blue-300 text-blue-700 dark:border-blue-900 dark:text-blue-400",
    stateLabel: "지금 차례",
  };
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
  routeSteps,
  internalTargetShipmentDate,
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
   * 이 요청이 타고 있는 결재선 **판의 단계들**(순서 + 승인자 이름). 결재선을
   * 타지 않으면 `null`이고, 그때 진행 표시도 미리보기도 그리지 않는다.
   *
   * 🔴 「현재 판」이 아니라 **이 요청 행에 적힌 판**이라야 한다 — 서버(page.tsx)가
   * record.routeId 로 읽어 내려보낸다. 진행 중인 건은 옛 판을 끝까지 따라가므로,
   * 현재 판을 세면 「2/2단계」가 「2/4단계」로 보인다.
   *
   * 🔴 배열이다(Map 이 아니다) — 서버 컴포넌트 경계를 넘어야 하기 때문이다.
   */
  routeSteps: ShipmentApprovalRouteStepLabel[] | null;
  /**
   * 사내 목표 출하일 — **읽기 전용**으로 두 자리에 보여 준다: 카드의 회색 상자와
   * 확인 창. 창에만 있으면 창을 열어야 보이는데, 「열어 볼까」를 정하는 것이 바로
   * 그 날짜다. 요청하는 사람과 결재하는 사람이 같은 카드·같은 창을 쓰므로 양쪽이
   * 같은 날짜를 보고 판단한다.
   *
   * 🔴 여기서 **고치지 않는다.** 이 값의 편집 경로는 「접수 정보 편집」
   * 하나뿐이다(IntakeInfoEditForm.tsx 머리말). 아직 정해지지 않았으면 `null`
   * 이고, 그때 그 사실과 어디서 입력하는지를 대신 말한다 — 그 문구는 카드도 창도
   * **같은 상수 한 곳**에서 부른다(approval-texts.ts 의
   * UNSET_TARGET_SHIPMENT_DATE_TEXT).
   */
  internalTargetShipmentDate: string | null;
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
  // 지정된 사람이 따로 있는데 내가 그 자리에 서 있는가. 「그래도 되는가」는 위
  // 지정 관문이 이미 답했다 — 이것은 **모양**만 묻는 판정이고, 이력의 「지정자
  // 대신 처리」 배지가 같은 함수를 본다.
  const standingInForAssignee = standsInForAssignedApprover(
    record?.assignedApproverUserId ?? null,
    actingUser.id
  );
  // 「2/3단계」의 뒷자리. 서버가 **이 행에 적힌 판**으로 읽어 준 단계 수다.
  const routeTotalSteps = routeSteps?.length ?? 0;

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
      // 🔴 비상구를 **누르기 전에** 말한다. 지정 관문이 열렸는데 지정된 사람이
      // 따로 있다는 것은, 지금 보고 있는 사람이 최고관리자 권한으로 남의 단계에
      // 서 있다는 뜻이다(그 길이 mayDecideAssignedApproval 의 유일한 예외다).
      //
      // 🔴 이 안내를 disabledReason 으로 내보내면 **아무 데도 보이지 않는다** —
      // 껍데기(DatabaseApprovalCard)는 그 문구를 단추가 하나도 없을 때만 그리는데,
      // 여기는 단추가 **있는** 자리다. 그래서 단추와 함께 그려지는 blockedNotice
      // 로 낸다.
      //
      // 결재선을 타지 않는 출하 요청은 지정이 언제나 NULL 이라 여기서 언제나
      // 거짓이다 — 예전 화면에 없던 문구가 끼어들지 않는다.
      if (standingInForAssignee) {
        blockedNotice = `지금 차례는 ${
          record?.assignedApproverName ?? "다른 승인자"
        } 님입니다. 최고관리자 권한으로 대신 처리합니다.`;
      }
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

  /**
   * 진행 미리보기를 그릴 단계들 — 이름과 함께 **그 칸의 상태**까지 미리 정해
   * 둔다. 결재선을 타지 않거나 판을 못 찾았으면 빈 배열이고, 그때는 미리보기
   * 자체를 그리지 않는다.
   *
   * 상태를 여기서 정하는 이유는 아래 JSX 안에 `return` 을 두지 않기 위해서다 —
   * 화면 배치 시험(approval-screen-layout.test.tsx)이 이 파일의 `return (` 위치로
   * 카드 안팎을 가른다.
   */
  const previewSteps = (followsRoute ? (routeSteps ?? []) : []).map((step) => ({
    ...step,
    ...markForRouteStep(
      step.stepOrder,
      record?.routeStepOrder ?? 0,
      displayStatus,
      // 🔴 「이 단계를 건너뛰는가」를 카드가 새로 적지 않는다 — 서버가 사슬을
      // 이을 때 보는 것과 **같은 함수**다. 두 곳에 적으면 화면은 「완료」라는데
      // 서버는 건너뛴(= 아무도 결재하지 않은) 칸이 되는 날이 온다.
      //
      // 서버에서 더 가져올 자료는 없다: 요청자도 단계 승인자도 카드가 이미 받아
      // 들고 있다.
      isRouteStepSkippedForRequester(step.approverUserId, record?.requestedByUserId ?? null)
    ),
  }));

  const extra = (
    /*
      🔴 `break-keep`(word-break: keep-all)을 **상자에** 건다. word-break 는 물려받는
      속성이라 한 자리에 걸면 안의 문장이 모두 어절 경계에서만 접힌다 — 한글은 기본
      규칙으로 어절 중간에서 잘려서, 좁은 칸에서 「…유효한 위임 / 을 받은…」처럼
      끊겼다. 인쇄용 양식도 같은 이유로 같은 속성을 쓴다(ServiceReportPrintView).

      ⚠️ 「어떤 폭에서도 무조건 한 줄」이 목표가 아니다. 창을 좁히면 접혀야 한다 —
      whitespace-nowrap 으로 밀어 넣으면 글자가 상자 밖으로 넘친다. 아래 미리보기의
      이름 상자만 예외이고, 거기는 넘치는 만큼 **그 상자 안에서** 가로로 밀린다.
    */
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 break-keep rounded-md bg-zinc-50 p-3 text-sm sm:grid-cols-2 dark:bg-zinc-800/60">
      {/*
        판단에 쓰는 맥락이라 「처리 자격 / 결재선 진행」과 같은 상자에 둔다 —
        출하 승인은 「언제까지 내보내야 하는가」를 보고 하는 일이고, 그 날짜가
        창을 열어야만 보이면 판단이 한 번 더 끊긴다.

        🔴 여기서도 **읽기 전용**이다 — 입력칸도 고르는 자리도 만들지 않는다.
        (여기에 그 태그 이름을 글자로도 적지 않는다: 화면 배치 시험이 이 상자의
        원본에서 그 두 태그를 찾아 막으므로, 주석에 적으면 시험이 걸린다.)
        값을 고치는 자리는 「접수 정보 편집」 하나뿐이다(IntakeInfoEditForm.tsx
        머리말). 카드는 접수 건을 고치지 않는다.
      */}
      <div className="sm:col-span-2">
        <dt className="text-xs text-zinc-500 dark:text-zinc-400">사내 목표 출하일</dt>
        <dd
          className={
            internalTargetShipmentDate ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-500 dark:text-zinc-400"
          }
        >
          {internalTargetShipmentDate ?? UNSET_TARGET_SHIPMENT_DATE_TEXT}
        </dd>
      </div>
      {/*
        🔴 이 칸은 카드 폭을 **다 쓴다**(미리보기가 이미 쓰는 방식과 같다). 카드
        자신이 2열 격자의 한 칸이라, 이 안에서 또 반으로 쪼개면 한 줄에 들어갈
        문장이 두세 줄로 접힌다 — 사용자가 본 「위임 / 을」이 그것이었다.
      */}
      <div className="sm:col-span-2">
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
      {previewSteps.length > 0 && (
        <div className="sm:col-span-2">
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">결재선</dt>
          {/*
            모양은 관리자 화면(users/ShipmentApprovalRouteSection)의 미리보기를
            그대로 따른다 — 상자들 사이에 ▶, 상자 아래 「n단계」. 그래프 라이브러리는
            쓰지 않는다: 일렬이라 상자와 화살표 글자로 충분하다.

            🔴 가로로 길어지면 **이 상자 안에서만** 밀린다(overflow-x-auto). 카드
            바깥이 밀리면 옆 카드까지 못 쓰게 된다.

            🔴 공용 부품으로 뽑지 않는다 — 저쪽은 편집 중인 id 배열 + 자격 경고이고
            이쪽은 확정된 이름 + 진행 상태다. 같아 보이는 것은 배치뿐이다.
          */}
          <dd className="mt-2 overflow-x-auto pb-1">
            <div className="flex min-w-max items-start gap-2">
              {previewSteps.map((step, index) => (
                <Fragment key={step.stepOrder}>
                  {index > 0 && (
                    <span aria-hidden className="self-center text-sm text-zinc-400 dark:text-zinc-500">
                      ▶
                    </span>
                  )}
                  <div className="flex flex-col items-center gap-1">
                    <span className={`whitespace-nowrap rounded-md border px-3 py-2 text-xs ${step.toneClass}`}>
                      {step.approverName}
                    </span>
                    <span className="whitespace-nowrap text-[11px] text-zinc-400 dark:text-zinc-500">
                      {step.stepOrder}단계 · {step.stateLabel}
                    </span>
                  </div>
                </Fragment>
              ))}
            </div>
          </dd>
        </div>
      )}
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
        // 요청·승인·반려 셋 다 같은 창이라, 넘기는 것만으로 세 경우에 다 나온다.
        // 검수 카드는 이 프롭을 주지 않으므로 그쪽 창은 지금과 똑같다.
        internalTargetShipmentDate={internalTargetShipmentDate}
        onConfirm={(comment) => void handleConfirm(comment)}
        onCancel={() => setDialogState(null)}
      />
    </>
  );
}
