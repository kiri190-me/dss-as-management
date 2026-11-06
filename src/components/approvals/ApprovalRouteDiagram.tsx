import { Fragment } from "react";

/**
 * 이 그림이 받는 승인 상태 — 승인 배지의 다섯 값 그대로다.
 *
 * 🔴 **값을 여기 베껴 적지 않는다.** repair-cases/approval/DatabaseApprovalStatusBadge
 * 가 그 목록의 주인이고, 그 배지와 이 그림은 **같은 카드 안에서 같은 사슬을 말한다** —
 * 어휘가 갈라지면 머리의 배지와 아래 그림이 서로 다른 상태를 가리킨다.
 *
 * 🔵 공용 자리에서 접수 건 폴더를 가리키는 것이 어색해 보이지만, 그 파일의 이름이
 * 옛 쓰임새의 흔적일 뿐이다(표 이름 `shipment_approval_routes` 와 같은 사정). 타입만
 * 가져오므로 컴파일 뒤에는 아무 연결도 남지 않는다.
 */
import type { DatabaseDisplayApprovalStatus } from "@/components/repair-cases/approval/DatabaseApprovalStatusBadge";

/**
 * ============================================================================
 * 결재선 그림 — 「누구를 거쳐 어디까지 왔나」 (공용)
 * ============================================================================
 * 상자들을 ▶ 로 잇고, 상자 아래에 「N단계 · 상태」를 적는다. 관리자 화면
 * (users/ShipmentApprovalRouteSection)의 미리보기와 같은 모양이고, 그래프
 * 라이브러리를 쓰지 않는다 — 일렬이라 상자와 화살표 글자로 충분하다.
 *
 * ── 🔴 왜 공용으로 뽑았는가 (2026-11-06) ────────────────────────────────
 * 원래 이 그림은 접수 건의 최종 출하 승인 카드(repair-cases/approval/
 * DatabaseFinalShipmentCard.tsx) 안에만 있었다. **기타건 최종 출하 승인**이 같은
 * 그림을 써야 해서 이리로 옮겼다(사용자 지정 — 「결재선이 그림으로 나타나고」).
 *
 * 🔴 **베껴서 두 벌을 만들지 않는다.** 이 그림이 지키는 규칙은 배치가 아니라
 * **색과 글자의 짝**이다(아래 markForRouteStep). 두 벌이 되면 한쪽만 고쳐지는 날
 * 같은 사슬이 두 화면에서 다른 상태로 보인다 — 그리고 그 어긋남은 두 화면을
 * 나란히 놓고 보기 전에는 드러나지 않는다.
 *
 * 🔵 **옮기면서 그리는 것은 한 글자도 바꾸지 않았다.** 접수 건 카드의 화면은
 * 그대로다 — 그 사실은 approval-screen-layout.test.tsx 가 글자로 못 박는다.
 *
 * 🔴 **그림만 공용이고 「회색 상자」는 각자다.** 상자 안의 다른 줄들(접수 건의
 * 「사내 목표 완료일」·「처리 자격」)은 그 화면에만 있는 값이라 그 카드가 그린다 —
 * 기타건에는 사내 목표 완료일에 **대응하는 값이 없다**(2026-11-06 사용자 확인:
 * 「없으니까 빼도 돼」). 여기로 끌어올리면 쓰지 않을 프롭을 계속 끼고 다니게 되고,
 * 언젠가 그 자리를 억지로 채우는 코드가 생긴다.
 * ============================================================================
 */

/** 진행 미리보기 한 칸의 모양 — 상자 색과 그 아래 글자를 함께 정한다. */
export type RouteStepMark = { toneClass: string; stateLabel: string };

/**
 * 🔴 **색만으로 상태를 구분하지 않는다**(UI_GUIDELINE 7절) — 상자 색과 글자를
 * 한 자리에서 함께 정하는 이유가 그것이다. 따로 두면 한쪽만 늘어난다.
 *
 * 색 계열은 승인 배지(DatabaseApprovalStatusBadge)와 같게 맞춘다: 완료=성공색,
 * 지금 차례=강조색, 반려=위험색, 재승인 필요=경고색, 아직 안 온 단계=중립색.
 */
export const DONE_MARK: RouteStepMark = {
  toneClass: "border-green-300 text-green-700 dark:border-green-900 dark:text-green-400",
  stateLabel: "완료",
};
export const UPCOMING_MARK: RouteStepMark = {
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
export const SKIPPED_MARK: RouteStepMark = { toneClass: "border-dashed border-zinc-300 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500", stateLabel: "건너뜀 · 요청자 본인", };

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
export function markForRouteStep(
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

/** 그림 한 칸 — 누구이고 몇 번째이며 어떤 상태인가. */
export type ApprovalRouteDiagramStep = RouteStepMark & {
  /** 1부터. */
  stepOrder: number;
  approverName: string;
};

/**
 * 🔴 **회색 상자(`<dl>`)의 한 칸으로 들어간다** — 부르는 쪽이 `<dl>` 을 그리고
 * 여기는 그 안의 `sm:col-span-2` 칸 하나를 돌려준다. 카드 폭을 다 쓰는 것은
 * 미리보기가 원래 그러던 방식 그대로다.
 *
 * 🔴 **단계가 0개면 부르는 쪽이 아예 그리지 않는다.** 여기서 빈 배열을 받아
 * 머리만 그리면 「결재선」이라는 이름표 아래 아무것도 없는 칸이 선다.
 */
export default function ApprovalRouteDiagram({
  steps,
}: {
  steps: readonly ApprovalRouteDiagramStep[];
}) {
  return (
    <div className="sm:col-span-2">
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">결재선</dt>
      {/*
        모양은 관리자 화면(users/ShipmentApprovalRouteSection)의 미리보기를
        그대로 따른다 — 상자들 사이에 ▶, 상자 아래 「n단계」. 그래프 라이브러리는
        쓰지 않는다: 일렬이라 상자와 화살표 글자로 충분하다.

        🔴 가로로 길어지면 **이 상자 안에서만** 밀린다(overflow-x-auto). 카드
        바깥이 밀리면 옆 카드까지 못 쓰게 된다.

        🔴 관리자 화면의 미리보기와 공용 부품으로 묶지 않는다 — 저쪽은 편집 중인
        id 배열 + 자격 경고이고 이쪽은 확정된 이름 + 진행 상태다. 같아 보이는 것은
        배치뿐이다.
      */}
      <dd className="mt-2 overflow-x-auto pb-1">
        <div className="flex min-w-max items-start gap-2">
          {steps.map((step, index) => (
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
  );
}
