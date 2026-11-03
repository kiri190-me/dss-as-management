import type { RepairStatus } from "./types";

/**
 * ============================================================================
 * 출하 승인이 **모두** 끝나면 단계가 저절로 [출하 대기]로 — 순수 규칙
 * ============================================================================
 * 2026-11-03 사용자 요구: 「출하 승인이 모두 끝나면 단계가 자동적으로 [출하 대기]로
 * 바뀌도록 해줘. (출하대기는 자동으로만 넘어가도록 해줘. [단계 직접 변경]에서
 * [출하대기]는 보이지 않도록 해줘.)」
 *
 * DB 도 서버도 여기서 만지지 않는다. 여기 있는 것은 **「옮기는가, 아니면 왜 안
 * 옮기는가」** 하나뿐이고, 실제로 옮기는 일은 db/mutations/shipment-waiting-auto-
 * advance.ts 가 한다. 이 저장소의 규약대로 **참·거짓이 아니라 까닭을 돌려준다** —
 * 화면도 서버도 이 판정을 다시 하지 않고, 안 옮긴 날 「왜 안 옮겼나」를 되짚을 수
 * 있는 유일한 자리가 이 reason 이다.
 *
 * ── 🔴 「모두 끝났다」는 무엇인가 ───────────────────────────────────────
 * 최종 출하 승인(FINAL_SHIPMENT)의 **사슬이 더 이어지지 않는 승인**이다. 결재선을
 * 타는 건은 한 단계가 승인될 때마다 다음 단계 요청 행이 새로 생기는데
 * (db/mutations/repair-case-approvals.ts 의 「사슬을 잇는다」), **그 다음 행이 생기지
 * 않은 승인**이 곧 마지막 승인이다. 결재선을 아예 타지 않는 건(대표·위임 방식)은
 * 승인 한 번이 곧 마지막이다.
 *
 * 🔴 **한 단계라도 반려되면 넘어가지 않는다.** 반려는 사슬을 끊고 처음부터 다시
 * 요청하게 만들므로, 여기서는 decision 이 APPROVED 가 아니면 그 자리에서 멈춘다.
 * 「남은 단계가 있는가」와 「반려인가」를 따로 세는 것이 중요하다 — 둘을 한 불리언
 * 으로 접으면 반려된 건이 「사슬이 안 이어졌으니 끝난 것」으로 읽힌다.
 *
 * ── 🔴 갈 단계는 **전이표가 정한다** — 글자로 박지 않는다 ────────────────
 * 「출하 대기」라는 단계 key 를 여기 적지 않는다. 워크플로마다 단계 구성이 다르고
 * (실측 2026-11-03: `waiting_shipment` 단계는 **매쳐 둘에만 있다** — 제너레이터·
 * 토탈컨트롤러 넷은 출하 승인 다음이 바로 출하 완료다), 편집기로 새 판을 발행하면
 * 그 구성이 또 바뀐다. 그래서 그 건의 워크플로 버전에서 **「도착 단계의 상태가
 * WAITING_SHIPMENT 인 정규 진행 전이」**를 찾아, 지금 서 있는 자리가 그 전이의
 * 출발점일 때만 그 길로 보낸다 — 사람이 [다음 단계] 를 눌렀을 때 가는 바로 그
 * 자리다. 전이표가 바뀌면 자동 전환도 함께 따라간다.
 * (db/mutations/workflow-transitions.ts 의 revertShipmentCompletion 이 「되돌아갈
 * 단계」를 찾을 때 쓰는 것과 같은 규율이다.)
 *
 * 🔴 **그래서 멀리 떨어진 단계에서는 뛰지 않는다.** 예를 들어 교산 출하 승인 대기에
 * 서 있는 건은 결재가 끝나도 그대로 둔다. 「승인이 끝났으니 어디에 있든 출하 대기로」
 * 로 적으면 수리도 안 끝난 건이 한 번에 출하 직전으로 뛴다 — 승인 기록만으로 단계를
 * 통째로 건너뛰게 하지 않는다는 것이 이 저장소가 승인 게이트에서 지켜 온 선이다.
 *
 * ── 🔴 보류 중이거나 잠긴 건은 안 옮긴다 ────────────────────────────────
 * 보류(HOLD_STARTED)는 「지금 이 건을 움직이지 말라」는 표시이고, 정규 전이도
 * 그 상태에서는 막힌다(local/workflow/permissions.ts 의 checkTransitionEligibility).
 * 사람이 못 옮기는 자리를 시스템이 몰래 옮기면 보류라는 말이 뜻을 잃는다.
 * 출하 완료 잠금(is_locked)도 같다 — 그 뒤로는 되돌리기 하나만 문이 열려 있다.
 *
 * ── 🔴 이미 [출하 대기]인 건은 아무 일도 하지 않는다 ────────────────────
 * 사용자 지시 그대로다. 아래에서 **지금 단계가 도착 단계와 같으면** 그 자리에서
 * 멈추고, 이력도 남기지 않는다. 지금 단계가 출발 단계가 아니라는 사실만으로도
 * 걸러지지만, 그 까닭을 따로 돌려줘야 「왜 안 움직였나」가 분명해진다.
 *
 * ── 왜 둘로 나눠 두었는가 ───────────────────────────────────────────────
 * 아래 checkShipmentApprovalChainCompleted 는 **접수 건을 한 줄도 읽기 전에** 부를
 * 수 있는 1차 관문이다. 결재 결정 대부분은 수리 검수 승인이거나 사슬 중간이라
 * 거기서 끝나고, 그때는 워크플로 규칙·보류 이력을 읽는 질의가 아예 일어나지
 * 않는다. 규칙은 여전히 한 벌이다 — decideShipmentWaitingAutoAdvance 가 제 안에서
 * 같은 함수를 부른다.
 * ============================================================================
 */

/**
 * 승인 종류. 🔴 validation/repair-case-approval-input.ts 의
 * REPAIR_CASE_APPROVAL_TYPES 와 같은 값이지만 **여기 한 벌 적어 둔다** — 도메인 층이
 * 검증 층을 가져오지 않는 것이 이 저장소의 관례다(domain/shipment-approval-route.ts
 * 의 RouteStepAssignment 가 db 층 타입을 베껴 두는 것과 같은 자리). 값이 갈라지지
 * 않도록 이 파일의 시험이 둘을 맞대어 본다.
 */
export const SHIPMENT_WAITING_APPROVAL_TYPES = ["REPAIR_INSPECTION", "FINAL_SHIPMENT"] as const;
export type ShipmentWaitingApprovalType = (typeof SHIPMENT_WAITING_APPROVAL_TYPES)[number];

/** 최종 출하 승인 — 이 자동 전환을 여는 **단 하나의** 승인 종류. */
export const FINAL_SHIPMENT_APPROVAL_TYPE: ShipmentWaitingApprovalType = "FINAL_SHIPMENT";

/**
 * 「출하 대기」를 가리키는 단계 상태(workflow_steps.repair_status).
 *
 * 🔴 **이 값을 글자로 두 곳에 적지 않는다.** 같은 사실에 두 자리가 걸려 있다:
 *  · 여기 — 자동 전환이 **도착지**를 찾을 때
 *  · db/queries/workflow-rules.ts 의 listManuallySelectableStepsFromRules —
 *    [단계 직접 변경] 후보에서 **빼는** 자리
 * 둘은 한 결정의 앞뒤다(「자동으로만 닿는 단계로 만든다」). 한쪽만 고치면 사람이
 * 고를 수 없는데 시스템도 보내지 않는 단계가 생기거나, 그 반대가 된다.
 *
 * 단계 **key**(`waiting_shipment`)가 아니라 **상태**로 짚는 까닭은 머리말에 있다 —
 * key 와 이름은 워크플로 편집기로 바뀌지만 상태는 코드가 쥔 값이다.
 */
export const SHIPMENT_WAITING_REPAIR_STATUS: RepairStatus = "WAITING_SHIPMENT";

/**
 * 🔴 **사람이 고르는 길로 [출하 대기]에 닿으려 할 때 돌려주는 까닭**
 * (2026-11-03 사용자 요구: 「[실행 가능한 작업]에서도 [다음 단계로 진행]을 통해서
 * 출하대기로 넘어가지 못하도록 해줘」).
 *
 * 🔴 **조용히 막지 않는다.** 단추가 까닭 없이 꺼져 있으면 사람은 고장으로 읽고
 * 몇 번을 더 누른다. 화면(실행 가능한 작업 패널)과 서버(거절 응답)가 **같은
 * 문장**을 쓰도록 여기 한 벌만 둔다 — 두 곳에 적으면 화면과 서버가 다른 말을 한다.
 */
export const SHIPMENT_WAITING_AUTO_ONLY_MESSAGE =
  "[출하 대기]는 최종 출하 승인이 모두 끝나면 시스템이 자동으로 옮깁니다. 직접 넘길 수 없습니다.";

/**
 * 이 전이가 **[출하 대기]로 들어가는 정규 진행**인가.
 *
 * 🔴 한 물음이 두 자리에서 반대 방향으로 쓰인다 — 그래서 함수가 하나다:
 *  · **시스템**은 이 전이를 찾아 그리로 **보낸다**(아래 findShipmentWaitingAdvanceTransition).
 *  · **사람**은 이 전이를 타지 **못한다** — 화면의 [다음 단계로 진행] 과 서버의
 *    전이 처리가 둘 다 여기서 막는다(SHIPMENT_WAITING_AUTO_ONLY_MESSAGE).
 * 두 벌로 적으면 「시스템이 가는 길」과 「사람이 막히는 길」이 어긋나는 날이 오고,
 * 그날 그 단계는 아무도 못 가는 자리가 된다.
 *
 * 🔴 막는 것은 **들어가는 길 하나**다. 출하 대기에서 **나가는** 전이
 * (되돌리기 · 출하 완료)는 여기에 걸리지 않는다 — fromStepKey 가 아니라
 * **도착 상태**로만 판정하기 때문이다. 잘못 넘어간 건이 영영 갇히면 안 된다.
 *
 * 🔴 **출하 완료 되돌리기(revertShipmentCompletion)도 이 검사를 지나지 않는다.**
 * 그쪽은 전이표에서 SHIPMENT_COMPLETED 전이의 from 으로 되돌아가는 별도 경로이고
 * (actionCode 가 STEP_ADVANCED 가 아니다), 거기까지 막으면 출하 완료된 매쳐 건의
 * [완료 해제] 가 통째로 죽는다.
 */
export function isAdvanceIntoShipmentWaiting(
  actionCode: string,
  toStatus: RepairStatus | null
): boolean {
  return actionCode === "STEP_ADVANCED" && toStatus === SHIPMENT_WAITING_REPAIR_STATUS;
}

/**
 * 방금 내려진 결재 하나. 접수 건을 읽지 않아도 알 수 있는 것만 담는다.
 */
export type ShipmentApprovalOutcome = {
  approvalType: string;
  decision: "APPROVED" | "REJECTED";
  /**
   * 이 승인으로 **다음 단계 요청 행이 새로 열렸는가.** 열렸으면 결재선이 아직
   * 남은 것이다. 결재선을 타지 않는 건은 언제나 false 다.
   */
  hasNextRouteStep: boolean;
};

/** 그 건이 지금 어떤 상태인가 — 전이표까지 포함해, 옮길 수 있는지 재는 재료 전부. */
export type ShipmentWaitingCaseState = {
  /** 출하 완료 뒤 잠긴 건인가(repair_cases.is_locked). */
  isCaseLocked: boolean;
  /** 지금 보류 중인가(status_change_histories 의 최신 HOLD_STARTED/RELEASED). */
  isOnHold: boolean;
  /** 지금 서 있는 단계의 key. */
  currentStepKey: string;
  /** 그 건의 워크플로 버전이 가진 전이 전부. */
  transitions: readonly ShipmentWaitingTransition[];
};

/**
 * 전이 한 줄에서 이 판정이 **실제로 보는 것만** 추린 모양. db/queries/workflow-rules.ts
 * 의 TransitionDefinition 이 이 모양을 이미 만족하므로 그대로 넘길 수 있다.
 */
export type ShipmentWaitingTransition = {
  actionCode: string;
  fromStepKey: string;
  toStepKey: string;
  toStatus: RepairStatus;
};

export type ShipmentWaitingAutoAdvanceSkipReason =
  /** 수리 검수 승인이다 — 이 자동 전환은 최종 출하 승인에만 걸린다. */
  | "NOT_FINAL_SHIPMENT"
  /** 반려됐다. 사슬이 끊겼으므로 넘어가지 않는다. */
  | "NOT_APPROVED"
  /** 결재선에 아직 결재할 단계가 남아 있다 — 「모두」 끝난 것이 아니다. */
  | "ROUTE_HAS_NEXT_STEP"
  /** 출하 완료 뒤 잠긴 건이다. */
  | "CASE_LOCKED"
  /** 보류 중이다. */
  | "ON_HOLD"
  /** 이 워크플로에는 [출하 대기]로 가는 정규 진행 전이가 없다(제너레이터·토탈컨트롤러). */
  | "NO_SHIPMENT_WAITING_STEP"
  /** 이미 [출하 대기]다 — 건드리지 않는다. */
  | "ALREADY_SHIPMENT_WAITING"
  /** 지금 서 있는 자리가 그 길의 출발점이 아니다. */
  | "NOT_AT_PRECEDING_STEP";

export type ShipmentWaitingAutoAdvanceDecision =
  | { move: true; fromStepKey: string; toStepKey: string }
  | { move: false; reason: ShipmentWaitingAutoAdvanceSkipReason };

export type ShipmentApprovalChainCompletion =
  | { completed: true }
  | { completed: false; reason: Extract<
      ShipmentWaitingAutoAdvanceSkipReason,
      "NOT_FINAL_SHIPMENT" | "NOT_APPROVED" | "ROUTE_HAS_NEXT_STEP"
    > };

/**
 * 「출하 승인이 **모두** 끝났는가」 — 결재 쪽만 보는 1차 관문.
 *
 * 접수 건을 한 줄도 읽지 않고 답할 수 있어서 따로 내보낸다(파일 머리말). 아래
 * decideShipmentWaitingAutoAdvance 가 제 안에서 이 함수를 부르므로 규칙은 한 벌이다.
 */
export function checkShipmentApprovalChainCompleted(
  outcome: ShipmentApprovalOutcome
): ShipmentApprovalChainCompletion {
  if (outcome.approvalType !== FINAL_SHIPMENT_APPROVAL_TYPE) {
    return { completed: false, reason: "NOT_FINAL_SHIPMENT" };
  }
  if (outcome.decision !== "APPROVED") {
    return { completed: false, reason: "NOT_APPROVED" };
  }
  if (outcome.hasNextRouteStep) {
    return { completed: false, reason: "ROUTE_HAS_NEXT_STEP" };
  }
  return { completed: true };
}

/**
 * 그 건의 워크플로에서 **[출하 대기]로 가는 정규 진행 전이**. 없으면 null.
 *
 * 🔴 「정규 진행(STEP_ADVANCED)」만 본다. 되돌리기로 들어오는 길
 * (waiting_shipment ← ...)이나 출하 완료 전이를 집으면 엉뚱한 자리로 보낸다.
 *
 * 둘 이상이면 **첫 줄**을 쓴다. 한 워크플로 버전에서 (동작, 출발단계) 가 유일하므로
 * 도착이 같은 진행 전이가 여럿일 수는 있지만(출발이 다르면), 실측 구성에서는 하나다.
 * 여럿일 때 지금 서 있는 자리가 맞는지는 바로 아래에서 다시 가리므로 안전하다.
 */
export function findShipmentWaitingAdvanceTransition(
  transitions: readonly ShipmentWaitingTransition[]
): ShipmentWaitingTransition | null {
  return (
    transitions.find((transition) =>
      isAdvanceIntoShipmentWaiting(transition.actionCode, transition.toStatus)
    ) ?? null
  );
}

/**
 * 지금 이 결재 하나로 단계를 [출하 대기]로 옮기는가 — 옮긴다면 어디서 어디로,
 * 옮기지 않는다면 **왜**.
 */
export function decideShipmentWaitingAutoAdvance(
  input: ShipmentApprovalOutcome & ShipmentWaitingCaseState
): ShipmentWaitingAutoAdvanceDecision {
  const chain = checkShipmentApprovalChainCompleted(input);
  if (!chain.completed) return { move: false, reason: chain.reason };

  // 🔴 잠금·보류를 전이표보다 먼저 본다. 뒤로 돌리면 「이 워크플로엔 출하 대기가
  // 없다」가 먼저 나와, 정작 막은 까닭이 잠금이었다는 사실이 가려진다.
  if (input.isCaseLocked) return { move: false, reason: "CASE_LOCKED" };
  if (input.isOnHold) return { move: false, reason: "ON_HOLD" };

  const advance = findShipmentWaitingAdvanceTransition(input.transitions);
  if (!advance) return { move: false, reason: "NO_SHIPMENT_WAITING_STEP" };

  if (input.currentStepKey === advance.toStepKey) {
    return { move: false, reason: "ALREADY_SHIPMENT_WAITING" };
  }
  if (input.currentStepKey !== advance.fromStepKey) {
    return { move: false, reason: "NOT_AT_PRECEDING_STEP" };
  }

  return { move: true, fromStepKey: advance.fromStepKey, toStepKey: advance.toStepKey };
}
