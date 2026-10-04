import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  pickNearestStepForWeeklyReportStatus,
  type WeeklyReportStatusStep,
} from "./weekly-report-status-step";

/**
 * ============================================================================
 * 주간보고 `현 상태` → 갈 단계 고르기
 * ============================================================================
 * 이 시험이 못 박는 것은 다섯이다.
 *   1. **가장 가까운 단계**로 간다 — 뒤쪽·앞쪽 어디든.
 *   2. **거리가 같으면 앞(order 가 큰 쪽)**. 목록의 차례가 결과를 바꾸지 못한다.
 *   3. **지금 단계는 후보에서 빠진다** — 빼지 않으면 거리 0 으로 늘 이긴다.
 *   4. **받은 목록 밖으로는 가지 않는다** — 승인 게이트 단계를 뺀 목록을 주면
 *      그 단계를 고르지 않는다. 이 함수가 승인 절차의 우회로가 되지 않는 근거다.
 *   5. 🔴 **고른 칸과 간 단계의 칸이 같다** — 거르는 자는 화면이 보는
 *      classifyWeeklyReportRowStatus(7칸)이지 집계(6칸)가 아니다. 그래서
 *      '수리 중'을 고르면 REPAIR_COMPLETED 단계가 **빠지고**, '수리 완료'를
 *      고르면 그 단계로 간다(2026-10-04 사용자 요청으로 늘어난 칸).
 *
 * 🔴 아래 STEPS 는 **규칙을 재려고 지은 표본**이다 — 실측값이 아니다. 단계
 * 번호의 차례와 간격은 유상 Matcher(PAID_MATCHER)를 본떴지만, **어느 단계가 어느
 * 상태인지는 실제와 다르다.** 규칙(가장 가까운 단계 · 고른 칸과 간 단계의 칸이
 * 같다)이 드러나려면 '수리 완료'가 앞뒤로 흩어져 있어야 해서, REPAIR_COMPLETED
 * 를 8 과 16 에 일부러 나눠 놓았다.
 *
 * 실제로는(2026-10-04 개발 DB 조회) 그 8·16 이 둘 다 IN_REPAIR 이고, 워크플로를
 * 통틀어 REPAIR_COMPLETED 인 단계는 PAID_TOTAL_CONTROLLER 의 14번(step_1,
 * '수리 완료') 하나뿐이다 — '수리 완료'는 그날 새로 생긴 상태라 아직 워크플로에
 * 거의 안 붙어 있다. **이 표본을 실제 워크플로로 읽지 말 것.**
 * ============================================================================
 */

/**
 * PAID_MATCHER 의 차례를 본떠 지은 단계 목록 — 상태 배치는 규칙이 드러나도록
 * 지은 것이다(위 머리말). 이 함수는 key·order·status 셋만 본다.
 *
 *    6·7     수리 중      (앞쪽 덩어리)
 *    8       수리 완료
 *   10       PO 대기 중
 *   12       점검 중
 *   15       수리 중      (뒤쪽 덩어리)
 *   16       수리 완료
 *   18       출하 대기
 *
 * 🔴 이 표본에서 8 과 16 은 **'수리 중'이 아니다.** REPAIR_COMPLETED 는 집계에서
 * '수리 중' 숫자에 들어가지만(classifyWeeklyReportStatus), 고르개와 이 함수는
 * '수리 완료'로 본다.
 */
const STEPS: WeeklyReportStatusStep[] = [
  { key: "intake_inspection", order: 1, status: "WAITING_INTAKE_INSPECTION" },
  { key: "kyosan_instruction_confirmed", order: 6, status: "IN_REPAIR" },
  { key: "parts_replaced", order: 7, status: "IN_REPAIR" },
  { key: "kyosan_follow_up_sent", order: 8, status: "REPAIR_COMPLETED" },
  { key: "waiting_po", order: 10, status: "WAITING_PO" },
  { key: "intake_inspection_in_progress", order: 12, status: "INTAKE_INSPECTION_IN_PROGRESS" },
  { key: "repair_in_progress", order: 15, status: "IN_REPAIR" },
  { key: "power_test", order: 16, status: "REPAIR_COMPLETED" },
  { key: "waiting_shipment", order: 18, status: "WAITING_SHIPMENT" },
];

describe("pickNearestStepForWeeklyReportStatus", () => {
  test("1. 앞뒤에 같은 칸이 있으면 가까운 쪽으로 간다", () => {
    // 지금 13번. '수리 중'은 뒤로 7(거리 6) · 앞으로 15(거리 2) — 앞이 가깝다.
    const picked = pickNearestStepForWeeklyReportStatus(STEPS, 13, "IN_REPAIR");
    assert.equal(picked?.key, "repair_in_progress");
    assert.equal(picked?.order, 15);
  });

  test("2. 거리가 같으면 앞(order 가 큰 쪽)으로 간다", () => {
    // 뒤 8 · 앞 12 에 '수리 중'이 하나씩 있고 지금은 10 — 거리가 둘 다 2다.
    // (위 STEPS 로는 정수 자리에서 동점이 나오지 않아 이 시험만 따로 짠다.)
    const tie: WeeklyReportStatusStep[] = [
      { key: "behind", order: 8, status: "IN_REPAIR" },
      { key: "here", order: 10, status: "WAITING_PO" },
      { key: "ahead", order: 12, status: "IN_REPAIR" },
    ];
    assert.equal(
      pickNearestStepForWeeklyReportStatus(tie, 10, "IN_REPAIR")?.key,
      "ahead",
      "거리가 같으면 진행 방향(order 가 큰 쪽)"
    );
    // 목록의 차례가 결과를 바꾸지 못한다 — 뒤집어 넣어도 같은 답이다.
    assert.equal(
      pickNearestStepForWeeklyReportStatus([...tie].reverse(), 10, "IN_REPAIR")?.key,
      "ahead"
    );
  });

  test("3. 뒤로도 간다 — 앞보다 뒤가 가까우면 되돌린다", () => {
    // 지금 9번. '수리 중'은 뒤로 7(거리 2) · 앞으로 15(거리 6).
    // (8 은 바로 뒤에 있지만 '수리 완료'라 후보가 아니다 — 아래 8번 시험.)
    const picked = pickNearestStepForWeeklyReportStatus(STEPS, 9, "IN_REPAIR");
    assert.equal(picked?.key, "parts_replaced");
    assert.equal(picked?.order, 7);
  });

  test("4. 지금 단계와 같은 칸을 골라도 지금 단계는 후보에서 빠진다", () => {
    // 지금 15번('수리 중')에서 다시 '수리 중'을 고른다. 15 가 빠지고 16 은
    // '수리 완료'라 후보가 아니므로 7 이다(7 은 거리 8, 6 은 거리 9).
    const picked = pickNearestStepForWeeklyReportStatus(STEPS, 15, "IN_REPAIR");
    assert.equal(picked?.order, 7);
    assert.notEqual(picked?.order, 15, "지금 단계를 그대로 돌려주면 전이가 '이미 해당 단계'로 막힌다");
  });

  test("5. 그 칸의 단계가 하나도 없으면 null", () => {
    // 이 목록에는 '수리 대기'(WAITING_PARTS_SUPPLY · WAITING_REPAIR)가 없다.
    assert.equal(pickNearestStepForWeeklyReportStatus(STEPS, 10, "REPAIR_WAITING"), null);
  });

  test("5-1. 후보가 지금 단계 하나뿐이면 null — 빼고 나면 남는 것이 없다", () => {
    const onlySelf: WeeklyReportStatusStep[] = [
      { key: "waiting_shipment", order: 18, status: "WAITING_SHIPMENT" },
    ];
    assert.equal(pickNearestStepForWeeklyReportStatus(onlySelf, 18, "SHIPMENT_WAITING"), null);
  });

  test("6. 승인 게이트 단계가 빠진 목록을 받으면 그것을 고르지 않는다", () => {
    // 승인이 걸린 '출하 승인 대기'(order 19)는 부르는 쪽
    // (listManuallySelectableStepsFromRules)이 이미 뺀다. 그 목록으로 '출하 대기'를
    // 고르면 19 가 더 가까워도 18 이 나와야 한다.
    const gated: WeeklyReportStatusStep = {
      key: "waiting_shipment_approval",
      order: 19,
      status: "WAITING_SHIPMENT_APPROVAL",
    };
    assert.equal(
      pickNearestStepForWeeklyReportStatus([...STEPS, gated], 20, "SHIPMENT_WAITING")?.order,
      19,
      "표본 점검: 목록에 들어 있으면 19 가 가장 가깝다"
    );
    assert.equal(
      pickNearestStepForWeeklyReportStatus(STEPS, 20, "SHIPMENT_WAITING")?.order,
      18,
      "빠진 목록을 받으면 그 단계로는 가지 않는다"
    );
  });

  test("7. 분류 안 된 자리에서도 고를 수 있다 — 지금 상태를 보지 않는다", () => {
    // 지금 단계의 상태가 무엇이든(분류 안 됨 포함) 이 함수는 order 만 본다.
    assert.equal(pickNearestStepForWeeklyReportStatus(STEPS, 17, "SHIPMENT_WAITING")?.order, 18);
  });

  test("8. 🔴 '수리 중'을 고르면 수리 완료 단계로 가지 않는다", () => {
    // 지금 17번. **거리만 보면 16(거리 1)이 가장 가깝지만** 그 단계는
    // REPAIR_COMPLETED 라 '수리 중'이 아니다 — 15(거리 2)로 가야 한다.
    //
    // 이 자리가 이번 변경의 핵심이다. 거르는 자를 집계(classifyWeeklyReport-
    // Status)로 두면 16 과 15 가 똑같이 '수리 중'으로 계산되어 16 이 이기고,
    // 사람은 '수리 중'을 골랐는데 표에는 '수리 완료'가 적힌다.
    const picked = pickNearestStepForWeeklyReportStatus(STEPS, 17, "IN_REPAIR");
    assert.equal(picked?.order, 15, "'수리 중'은 IN_REPAIR 상태인 단계만 후보다");
    assert.equal(picked?.key, "repair_in_progress");
    assert.notEqual(picked?.order, 16, "16 은 '수리 완료'다 — 더 가까워도 가면 안 된다");
  });

  test("9. '수리 완료'를 고르면 REPAIR_COMPLETED 단계로 간다", () => {
    // 같은 자리(17)에서 '수리 완료'를 고르면 이번에는 16 이다.
    const picked = pickNearestStepForWeeklyReportStatus(STEPS, 17, "REPAIR_COMPLETED");
    assert.equal(picked?.order, 16);
    assert.equal(picked?.key, "power_test");
    assert.equal(picked?.status, "REPAIR_COMPLETED", "간 단계의 상태가 실제로 수리 완료다");

    // 흩어져 있는 쪽도 본다 — 13 에서는 앞의 16(거리 3)이 뒤의 8(거리 5)보다 가깝다.
    assert.equal(pickNearestStepForWeeklyReportStatus(STEPS, 13, "REPAIR_COMPLETED")?.order, 16);
    // 9 에서는 바로 뒤의 8(거리 1)이 이긴다 — 되돌리는 길도 그대로 열려 있다.
    assert.equal(pickNearestStepForWeeklyReportStatus(STEPS, 9, "REPAIR_COMPLETED")?.order, 8);
  });

  test("10. 수리 완료 단계가 없는 워크플로에서 '수리 완료'를 고르면 null — 아무 데나 보내지 않는다", () => {
    const withoutRepairCompleted = STEPS.filter((step) => step.status !== "REPAIR_COMPLETED");
    assert.equal(
      pickNearestStepForWeeklyReportStatus(withoutRepairCompleted, 13, "REPAIR_COMPLETED"),
      null,
      "갈 곳이 없으면 부르는 쪽이 '해당하는 단계가 없습니다'로 말한다"
    );
    // 같은 목록에서 '수리 중'은 여전히 간다 — 없어진 것은 수리 완료 쪽뿐이다.
    assert.equal(
      pickNearestStepForWeeklyReportStatus(withoutRepairCompleted, 13, "IN_REPAIR")?.order,
      15
    );
  });
});
