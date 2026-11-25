import type { RepairStatus } from "./types";
import { foldBlankToNull } from "./domestic-order-list";

/**
 * ============================================================================
 * PO발행일이 적히면 단계가 저절로 [수리 대기]로 — 순수 규칙 (2026-11-26)
 * ============================================================================
 * 2026-11-25 사용자 요구(개선요청, [전체 A/S 현황]): 「PO발행일이 기록되면 현재
 * 작업 상태를 자동으로 [수리 대기]로 바꿔 줘」.
 *
 * DB 도 서버도 여기서 만지지 않는다. 여기 있는 것은 **「옮기는가, 아니면 왜 안
 * 옮기는가」** 하나뿐이고, 실제로 옮기는 일은 db/mutations/po-issued-repair-
 * waiting.ts 가 한다. 참·거짓이 아니라 **까닭**을 돌려주는 것은 이 저장소의
 * 규약이다 — 안 옮긴 날 「왜 안 옮겼나」를 되짚을 수 있는 유일한 자리가 이
 * reason 이고, 아래 갈래 아홉 가운데 **여덟이 「아무 일도 안 일어남」**이라
 * 불리언 하나로 접으면 무엇이 막았는지 영영 알 수 없다.
 *
 * ── 🔴 「현재 작업 상태」는 저장된 칸이 아니다 ──────────────────────────
 * [전체 A/S 현황]의 상태 칸은 그 건이 **지금 서 있는 워크플로 단계**의
 * `workflow_steps.repair_status` 를 그대로 그린 것이다
 * (db/queries/repair-cases.ts 의 currentWorkflowStepRepairStatus ·
 * components/repair-cases/badges.tsx 의 StatusBadge). `repair_cases` 에는 상태
 * 칼럼이 아예 없다(그 스키마의 'The flat `status` … is also excluded').
 *
 * 🔴 **그러므로 「상태를 바꾼다」는 「단계를 옮긴다」와 같은 말이다.** 이 저장소가
 * 이미 그 문장을 적어 두었다 — domain/weekly-report-status-step.ts 머리말
 * (「사람이 「출하 대기로 바꿔 줘」라고 말하면, 시스템이 할 수 있는 일은 그 칸으로
 * 계산되는 단계 중 하나로 옮기는 것뿐이다」).
 *
 * ── 🔴 갈 단계는 **상태 칸으로 찾는다** — 키로도 찾을 수 있었지만 안 썼다 ──
 * 2026-11-26 운영 DB 조회: `repair_status = 'WAITING_REPAIR'` 인 단계가 실제로
 * 있고, 그 키는 `po_received` 다. 같은 날 사용자가 화면을 보고 **그 단계가 맞다**고
 * 확인했고(단계 줄 `12 PO 접수 완료` 옆에 「수리 대기」 배지), 「키로 찾아도 괜찮다」
 * 는 허락까지 주었다.
 *
 * 🔴 **그래도 상태로 간다.** 허락은 「키로 가라」가 아니라 「키도 된다」였고, 읽어 본
 * 결과 상태 쪽이 더 튼튼하다:
 *  · 키도 이름표도 **워크플로 편집기에서 사람이 바꾼다.** 같은 조회에서 그 단계의
 *    이름이 워크플로마다 이미 갈려 있었다 — 유상 Matcher 는 「수리 대기」, 유상
 *    Generator·Total Controller 는 「PO 접수 완료」다. **이름으로 판정했다면 그날
 *    절반이 조용히 빠졌을 것이다.** 키라고 안 바뀐다는 보장이 없다.
 *  · 🔵 **화면에는 둘 다 「수리 대기」로 뜬다** — 배지가 이름표가 아니라
 *    `repair_status` 를 그리기 때문이다(components/repair-cases/badges.tsx 의
 *    StatusBadge). 사용자가 가리킨 것이 바로 그 배지이므로, **사용자가 고른 것과
 *    코드가 보는 것이 같은 칸**이 된다.
 *  · 키를 **좁히는 데만** 쓰는 길(상태로 여럿이 걸릴 때 `po_received` 로 추리기)도
 *    있었지만 버렸다 — 그 가지는 잘해야 아래 「가장 가까운 것」과 같은 답을 내고,
 *    키가 바뀐 날에는 **더 나쁜 답**을 낸다. 가지를 늘려 얻는 것이 없다.
 *
 * 🔴 **거꾸로 가지도 마라 — 상태로 하나도 못 찾았을 때 키로 다시 찾지 않는다.**
 * 그때는 「이 워크플로엔 갈 단계가 없다」가 **정답**이고(무상 쪽이 그렇다), 키로
 * 주워 오면 상태가 다른 단계에 건을 앉히게 된다. 아래 NO_WAITING_REPAIR_STEP 이
 * 그 자리다.
 *
 * 상태는 코드가 쥔 값이고 키·이름은 사람이 쥔 값이다. 이 규율은 이웃
 * domain/shipment-waiting-auto-advance.ts 가 도착지를 상태로 짚는 것과 같다.
 *
 * ── 🔴 **그 단계가 없는 워크플로가 있다 — ✗ 가 아니라 무동작이다** ───────
 * 같은 조회에서 무상(WARRANTY_*)과 레거시 `MATCHER` 에는 그 상태의 단계가 **하나도
 * 없다**(그쪽은 같은 자리가 `parts_supply` / WAITING_PARTS_SUPPLY 다). 그러니
 * 「갈 곳이 없다」는 **정상 갈래**이고, 오류로 만들면 무상 건의 PO발행일 저장이
 * 통째로 거절된다. 아래 NO_WAITING_REPAIR_STEP 이 그 자리이고, 그 갈래를 **값으로
 * 재는 시험**이 반드시 있어야 한다 — 없으면 「무상 건에서 조용히 터지는」 자리가
 * 된다.
 *
 * ── 🔴 **앞으로만 간다 — 되돌리지 않는다** ──────────────────────────────
 * 이미 [수리 중]·[출하 대기]로 간 건을 [수리 대기]로 끌어내리면 사람이 한 일이
 * 거꾸로 간다. 그래서 **지금보다 order 가 큰** 후보만 보고, 그중 **가장 가까운**
 * 것으로 간다(가장 적게 뒤집는 선택 — weekly-report-status-step.ts 가 같은 까닭을
 * 길게 적어 두었다).
 *
 * 🔴 **그 파일의 pickNearestStepForWeeklyReportStatus 를 그대로 빌려 쓰지 않는
 * 까닭이 바로 이것이다 — 그 함수는 뒤로도 간다**(그 머리말의 「앞뒤를 가리지
 * 않으므로 되돌리는 것도 된다」). 그쪽은 **사람이 칸을 직접 골랐을 때**의 규칙이라
 * 옳고, 이쪽은 날짜 하나로 저절로 움직이는 자리라 옳지 않다. 둘은 이름이 비슷한
 * 다른 규칙이다. 합치지 마라.
 *
 * 🔴 차례를 재는 자가 `workflow_steps.step_order` 인 근거는 스키마에 있다 —
 * `workflow_steps_version_order_unique` 가 (workflow_version_id, step_order) 에
 * 걸려 있어 한 버전 안에서 순서가 단계를 유일하게 가리킨다.
 *
 * ── 🔴 **날짜를 지워도 되돌리지 않는다** (사용자 결정 2026-11-26) ────────
 * 두 까닭이다. (ㄱ) 지금 상태는 사람이 [단계 직접 변경]으로 옮긴 결과일 수 있고,
 * 날짜 한 칸이 그 판단을 덮으면 안 된다. (ㄴ) **되돌릴 자리를 알 길이 없다** —
 * 원래 어느 단계였는지는 이력을 거슬러야 하는데 그 사이 사람이 두 번 더 옮겼을
 * 수 있다. 모르면 안 건드리는 쪽만 거짓말을 안 한다.
 *
 * ── 🔴 **「이번 저장이 그 날짜를 바꿨는가」로 좁힌다** ───────────────────
 * 「저장 뒤에 PO발행일이 있는가」로 재면 **금액만 고친 저장도 단계를 흔든다** —
 * 사람이 일부러 되돌려 놓은 건이 비고 한 줄 고칠 때마다 다시 앞으로 간다. 그래서
 * 전·후를 받아 **달라졌을 때만** 움직인다. 같은 규율이 이웃에 이미 있다
 * (mutations/domestic-orders.ts 의 applyRepairCaseDueDateLink — 「묶기는 이 저장이
 * 날짜를 실제로 바꿨는가를 전·후로 가른다」).
 *
 * 🔵 그래서 **값 → 다른 값**(날짜 고치기)도 움직인다. 일부러다 — PO 쪽에서 적혀
 * 안 걸렸던 건이 A/S 에서 날짜를 고칠 때 비로소 걸리는 길이다.
 *
 * ── 🔴 **PO 시스템(dss-po)에서 적으면 안 걸린다 — 그렇게 정했다** ────────
 * 2026-11-26 사용자 결정: 「A/S에서 적을 때만」. `domestic_orders` 는 A/S 와 PO 가
 * **같은 DB 에서 함께 쓰는 표**이고(mutations/domestic-order-issue-dates.ts 머리말),
 * PO 쪽에도 같은 칸을 쓰는 저장이 있다. 그 통로는 다른 저장소라 이 훅이 닿지
 * 않는다.
 *
 * 🔴 **이것은 결함이 아니다. 고치려 들지 마라 — 야간 작업표를 짜지 마라.** 같은
 * 자리에서 한 번 판단이 갈렸던 적이 있다: domain/notifications.ts 의 사내 목표
 * 완료일 알림은 **일부러 쓰기 훅을 피하고 읽을 때 계산**했다(「적는 자리마다 훅을
 * 걸었다면 하나는 반드시 빠뜨렸을 것이다」). 이번 것이 훅인 까닭은 **상태가 읽을
 * 때 계산될 수 없는 값이기 때문**이고(단계를 실제로 옮겨야 한다), 그 대가로 PO 쪽
 * 통로를 못 덮는다는 것을 알고 고른 모양이다.
 *
 * ── 🔴 보류 중이거나 잠긴 건은 안 옮긴다 ────────────────────────────────
 * 보류(HOLD_STARTED)는 「지금 이 건을 움직이지 말라」는 표시이고 정규 전이도 그
 * 상태에서는 막힌다. 사람이 못 옮기는 자리를 시스템이 몰래 옮기면 보류라는 말이
 * 뜻을 잃는다. 출하 완료 잠금(is_locked)도 같다. 이웃
 * domain/shipment-waiting-auto-advance.ts 가 지킨 바로 그 선이다.
 * ============================================================================
 */

/**
 * 「[수리 대기]」를 가리키는 단계 상태(workflow_steps.repair_status).
 *
 * 🔴 **이 값을 글자로 두 곳에 적지 않는다.** 판정도 시험도 이 상수를 가져다 쓴다 —
 * 글자를 나눠 적으면 한쪽만 고쳐지는 날이 오고, 그날 증상은 「아무것도 안 일어남」
 * 이라 아무도 신고하지 않는다.
 *
 * 단계 **key**(실측상 `po_received`)가 아니라 **상태**로 짚는 까닭은 머리말에 있다.
 */
export const PO_ISSUED_TARGET_REPAIR_STATUS: RepairStatus = "WAITING_REPAIR";

/**
 * 이력에 남는 사유 문장.
 *
 * 🔴 **「시스템이 옮겼다」를 글로 남겨야 한다.** `status_change_histories.actor_user_id`
 * 는 NOT NULL 이라 비울 수 없어 **그 날짜를 적은 사람**이 들어가는데, 워크플로 이력
 * 화면의 「처리자」 칸에 그 이름이 서면 그 사람이 손으로 단계를 옮긴 것으로 읽힌다.
 * 이웃 mutations/shipment-waiting-auto-advance.ts 가 같은 까닭으로 같은 일을 한다.
 */
export const PO_ISSUED_REPAIR_WAITING_REASON =
  "PO발행일이 기록되어 시스템이 [수리 대기]로 옮겼습니다.";

/**
 * 이력에 붙는 표시. 🔴 이력을 읽는 쪽이 **사람이 옮긴 것과 가르는 열쇠**다 —
 * `action_type` 은 사람이 [단계 직접 변경]으로 옮긴 것과 **똑같이**
 * `STEP_SET_MANUALLY` 라, 이 한 칸이 유일한 구분이다. 글자를 비교하지 말고 이
 * 상수를 가져다 쓴다(이웃의 SHIPMENT_WAITING_AUTO_ADVANCE_METADATA 와 같은 관례).
 */
export const PO_ISSUED_REPAIR_WAITING_METADATA = {
  autoAdvancedOnPoIssuedDate: true,
} as const;

/**
 * 단계 한 줄에서 이 판정이 **실제로 보는 것만** 추린 모양.
 * db/queries/workflow-rules.ts 의 WorkflowRuleStep 이 이미 이 모양을 만족하므로
 * 그대로 넘길 수 있다(쓰지도 않는 id·label·isActive·category 를 시험이 매번
 * 지어내지 않아도 된다).
 */
export type PoIssuedRepairWaitingStep = {
  key: string;
  /** workflow_steps.step_order. 거리를 재는 자이자 단계를 가리키는 유일한 값이다. */
  order: number;
  /** workflow_steps.repair_status. 이 값 하나로 갈 단계를 가른다(머리말). */
  status: RepairStatus;
};

/** 이번 저장이 그 줄의 PO발행일을 어떻게 바꿨는가 — 전·후 한 쌍. */
export type PoIssuedDateChange = {
  /** 저장 **전**에 적혀 있던 값. 줄을 새로 만드는 길에서는 null 이다. */
  previousOrderIssuedDate: string | null;
  /** 저장 **후**의 값. 지웠으면 null. */
  nextOrderIssuedDate: string | null;
};

/** 그 건이 지금 어떤 상태인가 — 옮길 수 있는지 재는 재료 전부. */
export type PoIssuedRepairWaitingCaseState = {
  /** 출하 완료 뒤 잠긴 건인가(repair_cases.is_locked). */
  isCaseLocked: boolean;
  /** 지금 보류 중인가(status_change_histories 의 최신 HOLD_STARTED/RELEASED). */
  isOnHold: boolean;
  /** 지금 서 있는 단계의 step_order. */
  currentStepOrder: number;
  /**
   * 지금 서 있는 단계의 상태. 🔴 **null 일 수 있다** — `repair_status` 가 비어 있는
   * 단계는 loadWorkflowRules 가 `steps` 에서 걸러 내므로, 그런 자리에 선 건은 아래
   * 목록에서 제 자신을 못 찾는다. 그 건도 앞으로 갈 수는 있어야 하므로 「이미
   * 수리 대기인가」만 이 칸으로 따로 묻는다(weekly-report-status.ts 가 분류 안 된
   * 건도 고칠 수 있게 둔 것과 같은 배려다).
   */
  currentStepStatus: RepairStatus | null;
  /** 그 건의 워크플로 버전이 가진 단계 전부. 🔴 **그 건이 지금 쓰는 버전**의 것이어야 한다. */
  steps: readonly PoIssuedRepairWaitingStep[];
};

export type PoIssuedRepairWaitingSkipReason =
  /** 이번 저장이 PO발행일을 안 바꿨다(다른 칸만 고친 저장). */
  | "DATE_UNCHANGED"
  /** 날짜를 지웠다 — 되돌리지 않는다(머리말). */
  | "DATE_CLEARED"
  /** 이 내자 줄에 수리 건이 안 붙어 있다(기타건). 옮길 대상이 없다. */
  | "NOT_LINKED"
  /** 그 수리 건이 없거나 휴지통에 있다. */
  | "CASE_NOT_FOUND"
  /** 출하 완료 뒤 잠긴 건이다. */
  | "CASE_LOCKED"
  /** 보류 중이다. */
  | "ON_HOLD"
  /** 🔴 이 워크플로에 그 상태인 단계가 하나도 없다(무상 · 레거시 MATCHER). 정상 갈래다. */
  | "NO_WAITING_REPAIR_STEP"
  /** 이미 [수리 대기]다 — 건드리지 않는다(version 도 이력도 안 늘린다). */
  | "ALREADY_WAITING_REPAIR"
  /** 이미 그 뒤 단계로 갔다 — 되돌리지 않는다. */
  | "ALREADY_PAST";

export type PoIssuedRepairWaitingDecision =
  | { move: true; toStepKey: string; toStepOrder: number }
  | { move: false; reason: PoIssuedRepairWaitingSkipReason };

export type PoIssuedDateRecorded =
  | { recorded: true }
  | {
      recorded: false;
      reason: Extract<PoIssuedRepairWaitingSkipReason, "DATE_UNCHANGED" | "DATE_CLEARED">;
    };

/**
 * 「이번 저장이 PO발행일을 **적었는가**」 — 접수 건을 한 줄도 읽기 전에 답하는
 * 1차 관문.
 *
 * 저장 대부분은 금액·비고처럼 다른 칸을 고치는 일이라 여기서 끝나고, 그때는
 * 수리 건·워크플로를 읽는 질의가 **아예 일어나지 않는다.** 규칙은 여전히 한 벌이다
 * — 아래 decidePoIssuedRepairWaiting 이 제 안에서 이 함수를 부른다.
 *
 * 🔴 **공백을 접은 뒤에 견준다.** `order_issued_date` 는 `date` 칼럼이라 공백이
 * 들어올 수 없지만, 접고 비교해야 `"" → null` 같은 저장이 「바뀜」으로 읽히지
 * 않는다. 접는 함수는 내자 목록·납기 역전이 쓰는 그것 하나다(foldBlankToNull).
 */
export function checkPoIssuedDateRecorded(change: PoIssuedDateChange): PoIssuedDateRecorded {
  const previous = foldBlankToNull(change.previousOrderIssuedDate);
  const next = foldBlankToNull(change.nextOrderIssuedDate);
  if (previous === next) return { recorded: false, reason: "DATE_UNCHANGED" };
  // 🔴 「지웠다」가 「안 바뀜」보다 **뒤**다. 둘 다 아무 일도 안 일어나지만 까닭이
  //    다르고, 순서를 뒤집으면 지운 저장이 전부 DATE_UNCHANGED 로 보고된다.
  if (next === null) return { recorded: false, reason: "DATE_CLEARED" };
  return { recorded: true };
}

/**
 * 갈 단계 — 지금보다 **앞에 있는** [수리 대기] 단계 가운데 **가장 가까운** 것.
 * 없으면 null 이다.
 *
 * 🔴 `step.order <= currentStepOrder` 를 전부 버리는 이 한 줄이 **「되돌리지
 * 않는다」의 전부**다(머리말). 같은 자리의 이웃 함수
 * (pickNearestStepForWeeklyReportStatus)에는 이 줄이 없다 — 그쪽은 사람이 고른
 * 것이라 뒤로도 가야 맞다.
 *
 * 🔵 후보가 여럿일 수 있다(한 워크플로에 같은 상태의 단계를 여럿 둘 수 있다).
 * 가장 가까운 하나를 고르는 것이 「지금 한 일을 가장 적게 뒤집는」 선택이다.
 * 🔵 그때 단계 키(`po_received`)로 추려도 된다는 허락이 있었지만 쓰지 않았다 —
 * 까닭은 파일 머리말에 있다(가지를 늘려 얻는 것이 없다).
 */
export function pickPoIssuedRepairWaitingStep(
  steps: readonly PoIssuedRepairWaitingStep[],
  currentStepOrder: number
): PoIssuedRepairWaitingStep | null {
  let best: PoIssuedRepairWaitingStep | null = null;
  for (const step of steps) {
    if (step.status !== PO_ISSUED_TARGET_REPAIR_STATUS) continue;
    // 🔴 앞으로만. 지금 자리(=)도 뺀다 — 같은 단계로 옮기는 일은 없다.
    if (step.order <= currentStepOrder) continue;
    if (best === null || step.order < best.order) best = step;
  }
  return best;
}

/**
 * 이 저장 하나로 단계를 [수리 대기]로 옮기는가 — 옮긴다면 어디로, 옮기지 않는다면
 * **왜**.
 */
export function decidePoIssuedRepairWaiting(
  input: PoIssuedDateChange & PoIssuedRepairWaitingCaseState
): PoIssuedRepairWaitingDecision {
  const recorded = checkPoIssuedDateRecorded(input);
  if (!recorded.recorded) return { move: false, reason: recorded.reason };

  // 🔴 잠금·보류를 단계 목록보다 **먼저** 본다. 뒤로 돌리면 「이 워크플로엔 그
  //    단계가 없다」가 먼저 나와, 정작 막은 까닭이 잠금이었다는 사실이 가려진다
  //    (이웃 decideShipmentWaitingAutoAdvance 가 같은 차례를 쓰는 그 까닭).
  if (input.isCaseLocked) return { move: false, reason: "CASE_LOCKED" };
  if (input.isOnHold) return { move: false, reason: "ON_HOLD" };

  // 🔴 「그 단계가 아예 없다」와 「있는데 전부 뒤에 있다」를 **갈라서** 센다. 하나로
  //    접으면 무상 건(단계 없음)과 이미 수리 중인 건(지나옴)이 같은 까닭으로
  //    보고되어, 둘 중 어느 쪽이 안 도는지 영영 알 수 없다.
  const hasTargetStep = input.steps.some(
    (step) => step.status === PO_ISSUED_TARGET_REPAIR_STATUS
  );
  if (!hasTargetStep) return { move: false, reason: "NO_WAITING_REPAIR_STEP" };

  // 🔴 「이미 그 단계」를 아래 pick 보다 먼저 묻는다. pick 이 지금 자리를 빼므로
  //    여기 없어도 멈추기는 하지만, 그때 까닭이 ALREADY_PAST 로 나와 **거짓말이
  //    된다**(지나온 적이 없다). 그리고 같은 상태의 단계가 앞에 하나 더 있는
  //    워크플로에서는 아예 **또 옮겨 버린다** — 사용자 요구(「이미 [수리 대기]면
  //    아무 일도 안 일어나야」)가 그 자리에서 깨진다.
  if (input.currentStepStatus === PO_ISSUED_TARGET_REPAIR_STATUS) {
    return { move: false, reason: "ALREADY_WAITING_REPAIR" };
  }

  const target = pickPoIssuedRepairWaitingStep(input.steps, input.currentStepOrder);
  if (!target) return { move: false, reason: "ALREADY_PAST" };

  return { move: true, toStepKey: target.key, toStepOrder: target.order };
}
