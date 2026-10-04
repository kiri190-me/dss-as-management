import {
  WEEKLY_REPORT_STATUSES,
  classifyWeeklyReportStatus,
  type WeeklyReportStatus,
} from "./weekly-report";
import type { RepairStatus } from "./types";

/**
 * ============================================================================
 * 주간보고의 `현 상태` 를 바꾼다는 것은 — **단계를 옮긴다**는 뜻이다
 * ============================================================================
 * 상세표의 `현 상태` 칸은 저장되는 값이 아니다. 접수 건이 지금 서 있는 워크플로
 * 단계의 상태(workflow_steps.repair_status)에서 **계산되는** 값이고, 그 계산은
 * weekly-report.ts 의 classifyWeeklyReportStatus 하나가 한다. 그러니 사람이
 * 「출하 대기로 바꿔 줘」라고 말하면, 시스템이 할 수 있는 일은 **그 분류로
 * 계산되는 단계 중 하나로 옮기는 것**뿐이다.
 *
 * 그런데 한 분류에 단계가 여럿이고, 그 단계들이 **흩어져 있다.** 실측 —
 * PAID_MATCHER 의 단계 20개 중 '수리 중'(IN_REPAIR) 분류인 것:
 *
 *    6. 교산 지시 확인      ┐
 *    7. 지시 부품 교체·점검  ├ 앞쪽 덩어리
 *    8. 교산 후속 보고 발송  ┘
 *       … 9~14 는 다른 분류 …
 *   15. 수리 진행          ┐ 뒤쪽 덩어리
 *   16. 통전 검사          ┘
 *
 * '교산 회신 대기'도 4·5·9·10·11 로 흩어져 있다. 그래서 **어느 단계로 갈지
 * 정하는 규칙**이 필요하고, 그 규칙이 이 파일이다.
 *
 * ── 규칙: 지금 단계에서 가장 가까운 단계 ────────────────────────────────
 * 거리는 `|후보.step_order − 지금.step_order|` 다. 가장 작은 것으로 가고,
 * **거리가 같으면 order 가 큰 쪽**(진행 방향)으로 간다(사용자 결정 2026-10-04).
 * 앞뒤를 가리지 않으므로 **되돌리는 것도 된다** — 지금보다 앞 단계가 더 가까우면
 * 그쪽으로 간다.
 *
 * 왜 「가장 가까운」인가: 이 칸을 고치는 사람은 단계 20개를 보고 있는 것이 아니라
 * **분류 6칸**을 보고 있다. 어느 단계로 가야 하는지는 모르고, 알 필요도 없다.
 * 그때 「그 분류의 첫 단계」로 보내면 수리를 거의 끝낸 건이 교산 지시 확인으로
 * 되돌아가고, 「마지막 단계」로 보내면 아직 시작도 안 한 건이 통전 검사에 가 앉는다.
 * 가장 가까운 단계는 **지금 한 일을 가장 적게 뒤집는** 선택이다.
 *
 * ── 🔴 분류 판정을 여기서 새로 짜지 않는다 ───────────────────────────────
 * 후보가 그 분류인지는 **classifyWeeklyReportStatus 를 그대로 불러** 판정한다.
 * 여기에 상태→분류 표를 한 벌 더 적으면 언젠가 두 벌이 갈라지고, 그날 화면이
 * 말한 분류와 실제로 간 단계의 분류가 달라진다 — 그러면 사람이 '출하 대기'를
 * 골랐는데 표에는 '수리 중'이 적히고, 아무도 어느 쪽이 맞는지 말할 수 없다.
 *
 * ── 🔴 지금 단계는 후보에서 뺀다 ─────────────────────────────────────────
 * 빼지 않으면 거리 0 으로 자기 자신이 늘 이긴다. 그러면 「아무 일도 하지
 * 않는다」가 아니라 「같은 단계로 옮긴다」가 되어, 전이 쪽에서 '이미 해당
 * 단계입니다' 오류로 되돌아온다. 같은 분류 안에서 다른 단계로 옮기는 길은
 * 열려 있어야 하므로, 빼는 것은 **그 한 단계뿐**이다.
 *
 * 같은 단계인지는 **step_order 로 가른다.** 키가 아니라 순서로 비교해도 되는
 * 근거는 스키마에 있다 — `workflow_steps_version_order_unique` 가
 * (workflow_version_id, step_order) 에 걸려 있어, 한 워크플로 버전 안에서
 * 순서는 단계를 유일하게 가리킨다.
 *
 * ── 🔴 후보 목록은 부르는 쪽이 추린다 ────────────────────────────────────
 * 이 함수는 받은 목록 안에서만 고른다. 승인 게이트가 걸린 단계(출하 완료 등)를
 * 빼는 일은 **부르는 쪽**이 listManuallySelectableStepsFromRules 로 한다
 * (db/queries/workflow-rules.ts). 그 규칙을 여기 옮겨 적으면 단계 직접 변경과
 * 이 화면이 서로 다른 목록을 갖게 되고, 한쪽으로만 승인을 건너뛸 수 있게 된다.
 *
 * ── 순수 함수다 ─────────────────────────────────────────────────────────
 * DB 도 React 도 들어오지 않는다. src/lib/db/ 아래에 두지 않은 것은 일부러다 —
 * 이 저장소의 단위 시험은 DATABASE_URL 없이 돌도록 막혀 있고
 * (scripts/load-template-env.ts), DB 연결 모듈은 그 변수가 없으면 던진다.
 * 거기 두면 이 규칙에 시험을 붙일 방법이 없어진다.
 * ============================================================================
 */

/**
 * 고를 수 있는 단계 하나. db/queries/workflow-rules.ts 의 WorkflowRuleStep 에서
 * 이 판정이 **실제로 보는 것만** 추려 적은 모양이다 — 그 타입을 그대로 받으면
 * 시험이 쓰지도 않는 id·label·isActive·category 를 매번 지어내야 한다.
 * WorkflowRuleStep 은 이 셋을 모두 가지고 있어 그대로 넘길 수 있다.
 */
export type WeeklyReportStatusStep = {
  key: string;
  /** workflow_steps.step_order. 거리를 재는 자이자, 단계를 가리키는 유일한 값이다. */
  order: number;
  /** workflow_steps.repair_status. 이 값이 분류를 정한다. */
  status: RepairStatus;
};

/**
 * 클라이언트가 보낸 값이 실제로 6칸 중 하나인가. 서버 액션의 입력 형식 검증용이다.
 *
 * 목록을 여기 베껴 적지 않고 WEEKLY_REPORT_STATUSES 를 그대로 읽는다 — 칸이
 * 늘거나 줄면 이 검사도 함께 따라가야 한다.
 */
export function isWeeklyReportStatus(value: unknown): value is WeeklyReportStatus {
  return typeof value === "string" && (WEEKLY_REPORT_STATUSES as readonly string[]).includes(value);
}

/**
 * 가고 싶은 분류로 가려면 **어느 단계로 옮겨야 하는가**. 그런 단계가 하나도
 * 없으면 null 이다 — 아무 단계나 지어내지 않는다.
 *
 * @param steps 고를 수 있는 단계 전부(승인 게이트 단계는 부르는 쪽이 이미 뺐다)
 * @param currentStepOrder 지금 서 있는 단계의 step_order
 * @param target 가고 싶은 주간보고 분류
 */
export function pickNearestStepForWeeklyReportStatus(
  steps: readonly WeeklyReportStatusStep[],
  currentStepOrder: number,
  target: WeeklyReportStatus
): WeeklyReportStatusStep | null {
  let best: WeeklyReportStatusStep | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const step of steps) {
    // 지금 단계는 후보가 아니다(파일 헤더). 순서가 곧 단계라서 이 비교로 족하다.
    if (step.order === currentStepOrder) continue;
    // 🔴 분류 판정은 빌려 쓴다 — 여기서 다시 짜지 않는다(파일 헤더).
    if (classifyWeeklyReportStatus({ status: step.status, currentWorkflowStepKey: step.key }) !== target) {
      continue;
    }

    const distance = Math.abs(step.order - currentStepOrder);
    if (distance < bestDistance) {
      best = step;
      bestDistance = distance;
      continue;
    }
    // 거리가 같으면 **앞(order 가 큰 쪽)** 이다. 되돌리기보다 진행을 고른다는
    // 뜻이고, 목록의 차례에 결과가 휘둘리지 않게 하는 못이기도 하다.
    if (distance === bestDistance && best !== null && step.order > best.order) {
      best = step;
    }
  }

  return best;
}
