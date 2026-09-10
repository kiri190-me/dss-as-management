import { Fragment } from "react";
import {
  PART_ISSUE_CANCELLED_BY_REQUESTER_LABEL,
  PART_ISSUE_REJECTED_BY_APPROVER_LABEL,
} from "./part-issue-approval-texts";
import { isPartIssueApprovalClosedByRequester } from "@/lib/domain/inventory-part-issue-rules";
import { isRouteStepSkippedForRequester } from "@/lib/domain/shipment-approval-route";
import type { PartIssueApprovalView } from "@/lib/db/queries/inventory-part-issue-requests";
import type { ShipmentApprovalRouteStepLabel } from "@/lib/db/queries/shipment-approval-routes";

/**
 * ============================================================================
 * 불출 신청 한 건의 **결재선 진행 + 이력**
 * ============================================================================
 * 🔴 **서버 액션을 물지 않는다.** 승인 요청건 화면(PartIssueApprovalScreen)은
 * 서버 액션을 직접 가져오는 클라이언트 컴포넌트라 그 사슬 끝의 `server-only`
 * 때문에 화면 시험에서 렌더할 수 없다. 그래서 「그려지는 모양」을 지켜야 하는
 * 부분만 여기로 떼어 낸다 — 이 파일은 시험이 실제로 렌더해서 확인한다.
 * (repair-cases/approval 쪽이 껍데기와 카드를 나눠 둔 것과 같은 이유·같은 방법.)
 *
 * 🔴 **모양은 최종 출하 승인 카드에서 가져온다**(DatabaseFinalShipmentCard) —
 * 「n/m단계 · 지금 차례: ○○○」 한 줄과, 상자 + ▶ + 상자 아래 「n단계 · 상태」.
 * 결재를 보는 사람이 출하와 불출에서 서로 다른 그림을 읽게 하지 않는다.
 * 그 파일을 **가져오지는 않는다**: 저쪽은 접수 건 승인 행(ApprovalRecordRow)에
 * 매여 있고 이쪽은 불출 결재 행이라, 공용 부품으로 묶으면 두 표의 칼럼이 한
 * 부품 안에서 섞인다. 같은 것은 배치뿐이다.
 *
 * 🔴 판정은 **아무것도 새로 적지 않는다** — 건너뛴 단계는 서버가 사슬을 이을 때
 * 보는 함수(isRouteStepSkippedForRequester), 「신청자가 취소함」은 순수 규칙
 * (isPartIssueApprovalClosedByRequester)이 답한다.
 * ============================================================================
 */

/** 진행 미리보기 한 칸의 모양 — 상자 색과 그 아래 글자를 함께 정한다. */
type RouteStepMark = { toneClass: string; stateLabel: string };

/**
 * 🔴 **색만으로 상태를 구분하지 않는다**(UI_GUIDELINE 7절) — 상자 색과 글자를
 * 한 자리에서 함께 정하는 이유가 그것이다. 따로 두면 한쪽만 늘어난다.
 * 색 계열은 출하 승인 카드와 같게 맞춘다.
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
 * 🔴 신청자 본인이라 결재를 받지 않는 단계. **「완료」로 칠하면 거짓말이다** —
 * 아무도 승인하지 않았는데 승인된 것처럼 보인다. 중립색 + 점선 + 글자 셋으로
 * 말한다.
 */
const SKIPPED_MARK: RouteStepMark = {
  toneClass: "border-dashed border-zinc-300 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500",
  stateLabel: "건너뜀 · 신청자 본인",
};
const CURRENT_MARK: RouteStepMark = {
  toneClass: "border-blue-300 text-blue-700 dark:border-blue-900 dark:text-blue-400",
  stateLabel: "지금 차례",
};
const REJECTED_MARK: RouteStepMark = {
  toneClass: "border-red-300 text-red-700 dark:border-red-900 dark:text-red-400",
  stateLabel: "반려",
};
/**
 * 🔴 신청자가 물러서 닫힌 칸. 반려와 **같은 색을 쓰지 않는다** — 표에는 둘 다
 * REJECTED 로 남지만 일어난 일이 다르고, 같은 붉은 칸으로 그리면 이력을 되짚는
 * 사람이 「누가 막았나」를 잘못 읽는다.
 */
const CANCELLED_MARK: RouteStepMark = {
  toneClass: "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300",
  stateLabel: "취소",
};

/**
 * 그 단계가 지금 어디쯤인가. 앞 단계는 이미 승인돼야 다음 행이 생기므로 **앞이면
 * 언제나 완료**다.
 *
 * 🔴 **건너뛴 단계는 예외라 먼저 본다.** 「앞이면 완료」에 그대로 걸리면 아무도
 * 승인하지 않은 칸이 「완료」로 보인다. 다만 **지금 단계 자신**은 건너뜀으로
 * 칠하지 않는다 — 실제로 열려 있는 차례를 부정하게 된다.
 */
function markForRouteStep(
  stepOrder: number,
  currentStepOrder: number,
  currentStatus: PartIssueApprovalView["status"],
  currentClosedByRequester: boolean,
  isSkippedStep: boolean
): RouteStepMark {
  if (isSkippedStep && stepOrder !== currentStepOrder) return SKIPPED_MARK;
  if (stepOrder < currentStepOrder) return DONE_MARK;
  if (stepOrder > currentStepOrder) return UPCOMING_MARK;
  if (currentStatus === "APPROVED") return DONE_MARK;
  if (currentStatus === "REJECTED") return currentClosedByRequester ? CANCELLED_MARK : REJECTED_MARK;
  return CURRENT_MARK;
}

/**
 * 이력 한 줄의 이름. 🔴 **취소와 반려를 반드시 가른다** — 판정은 순수 규칙이
 * 하고 여기서는 이름만 고른다.
 */
export function approvalOutcomeLabel(approval: PartIssueApprovalView): string {
  if (approval.status === "REQUESTED") return "결재 대기";
  if (approval.status === "APPROVED") return "승인";
  return isPartIssueApprovalClosedByRequester(approval)
    ? PART_ISSUE_CANCELLED_BY_REQUESTER_LABEL
    : PART_ISSUE_REJECTED_BY_APPROVER_LABEL;
}

/** 목록에서 알아야 하는 것은 「언제쯤」이지 초 단위가 아니다(요청 관리와 같은 셈). */
export function formatPartIssueMoment(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function PartIssueApprovalTrail({
  approvals,
  routeSteps,
}: {
  /** 오래된 것부터 — 조회가 결재가 지나온 순서 그대로 준다. */
  approvals: PartIssueApprovalView[];
  /**
   * 🔴 「현재 판」이 아니라 **이 신청이 타고 있는 판**의 단계들이라야 한다 —
   * 서버가 결재 행의 routeId 로 읽어 내려보낸다. 현재 판을 세면 진행 중이던
   * 신청이 「2/2단계」 대신 「2/4단계」로 보인다. 판을 못 찾으면 `null` 이고,
   * 그때 미리보기는 그리지 않는다(앞자리만 적는다).
   */
  routeSteps: ShipmentApprovalRouteStepLabel[] | null;
}) {
  // 「지금」을 말하는 것은 **가장 마지막 행**이다. 사슬은 한 번에 한 줄만 열리고,
  // 끝난 신청에서는 그 줄이 마지막으로 일어난 일을 그대로 들고 있다.
  const current = approvals.length > 0 ? approvals[approvals.length - 1] : null;
  const currentStepOrder = current?.routeStepOrder ?? 0;
  const closedByRequester = current !== null && isPartIssueApprovalClosedByRequester(current);
  const totalSteps = routeSteps?.length ?? 0;

  /**
   * 「n/m단계 · 지금 차례: ○○○」. 뒷자리는 서버가 **이 신청의 판**을 세어 준
   * 값이고, 못 세었으면 앞자리만 적는다 — 「2/」 같은 반쪽짜리를 보여 주지 않는다.
   * 「지금 차례」는 **아직 대기 중일 때만** 적는다(끝난 칸이 남의 차례를 말하지
   * 않도록).
   */
  const progress =
    current && current.routeStepOrder !== null
      ? `결재선 ${current.routeStepOrder}${totalSteps > 0 ? `/${totalSteps}` : ""}단계${
          current.status === "REQUESTED"
            ? ` · 지금 차례: ${current.assignedApproverName ?? "확인할 수 없습니다"}`
            : ""
        }`
      : null;

  const previewSteps = (routeSteps ?? []).map((step) => ({
    ...step,
    ...markForRouteStep(
      step.stepOrder,
      currentStepOrder,
      current?.status ?? "REQUESTED",
      closedByRequester,
      // 🔴 「이 단계를 건너뛰는가」를 화면이 새로 적지 않는다 — 서버가 사슬을 이을
      // 때 보는 것과 같은 함수다.
      isRouteStepSkippedForRequester(step.approverUserId, current?.requestedByUserId ?? null)
    ),
  }));

  return (
    <div className="flex flex-col gap-2 break-keep">
      {progress && (
        <div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">결재선 진행</p>
          <p className="text-sm text-zinc-900 dark:text-zinc-50">{progress}</p>
        </div>
      )}

      {previewSteps.length > 0 && (
        /*
          🔴 가로로 길어지면 **이 상자 안에서만** 밀린다. 바깥이 밀리면 목록
          전체가 못 쓰게 된다. 모양은 출하 승인 카드의 미리보기 그대로다.
        */
        <div className="overflow-x-auto pb-1">
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
        </div>
      )}

      {approvals.length > 0 && (
        <details className="rounded-md border border-zinc-200 px-2 py-1 dark:border-zinc-800">
          <summary className="cursor-pointer text-xs text-zinc-500 dark:text-zinc-400">결재 이력</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {approvals.map((approval) => (
              <li key={approval.id} className="text-[11px] text-zinc-600 dark:text-zinc-300">
                <span className="font-medium text-zinc-800 dark:text-zinc-100">
                  {approval.routeStepOrder !== null ? `${approval.routeStepOrder}단계 · ` : ""}
                  {approvalOutcomeLabel(approval)}
                </span>
                {approval.assignedApproverName && <span> · 지정: {approval.assignedApproverName}</span>}
                {approval.decidedByName && <span> · 처리자: {approval.decidedByName}</span>}
                <span> · {formatPartIssueMoment(approval.decidedAt ?? approval.requestedAt)}</span>
                {approval.decisionReason && (
                  <span className="block text-zinc-500 dark:text-zinc-400">“{approval.decisionReason}”</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
