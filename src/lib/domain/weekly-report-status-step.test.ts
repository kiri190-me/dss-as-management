import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  isWeeklyReportStatus,
  pickNearestStepForWeeklyReportStatus,
  type WeeklyReportStatusStep,
} from "./weekly-report-status-step";

/**
 * ============================================================================
 * 주간보고 `현 상태` → 갈 단계 고르기
 * ============================================================================
 * 이 시험이 못 박는 것은 넷이다.
 *   1. **가장 가까운 단계**로 간다 — 뒤쪽·앞쪽 어디든.
 *   2. **거리가 같으면 앞(order 가 큰 쪽)**. 목록의 차례가 결과를 바꾸지 못한다.
 *   3. **지금 단계는 후보에서 빠진다** — 빼지 않으면 거리 0 으로 늘 이긴다.
 *   4. **받은 목록 밖으로는 가지 않는다** — 승인 게이트 단계를 뺀 목록을 주면
 *      그 단계를 고르지 않는다. 이 함수가 승인 절차의 우회로가 되지 않는 근거다.
 *
 * 단계 배치는 **실측값**을 쓴다(PAID_MATCHER 20단계 중 분류가 '수리 중'인 것이
 * 6·7·8 과 15·16 으로 갈려 있다). 지어낸 표로 재면 "흩어져 있다"는 이 일의
 * 전제 자체가 시험에서 사라진다.
 * ============================================================================
 */

/**
 * PAID_MATCHER 를 본뜬 단계 목록. 순서와 상태만 사실대로 두면 충분하다 —
 * 이 함수는 key·order·status 셋만 본다.
 *
 *    6·7·8   수리 중      (앞쪽 덩어리)
 *   10       PO 대기 중
 *   12       점검 중
 *   15·16    수리 중      (뒤쪽 덩어리)
 *   18       출하 대기
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
  test("1. 앞뒤에 같은 분류가 있으면 가까운 쪽으로 간다", () => {
    // 지금 13번. '수리 중'은 뒤로 8(거리 5) · 앞으로 15(거리 2) — 앞이 가깝다.
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
      { key: "ahead", order: 12, status: "REPAIR_COMPLETED" },
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
    // 지금 9번. '수리 중'은 뒤로 8(거리 1) · 앞으로 15(거리 6).
    const picked = pickNearestStepForWeeklyReportStatus(STEPS, 9, "IN_REPAIR");
    assert.equal(picked?.key, "kyosan_follow_up_sent");
    assert.equal(picked?.order, 8);
  });

  test("4. 지금 단계와 같은 분류를 골라도 지금 단계는 후보에서 빠진다", () => {
    // 지금 15번('수리 중')에서 다시 '수리 중'을 고른다. 15 가 빠지므로 16 이다
    // (16 은 거리 1, 8 은 거리 7).
    const picked = pickNearestStepForWeeklyReportStatus(STEPS, 15, "IN_REPAIR");
    assert.equal(picked?.order, 16);
    assert.notEqual(picked?.order, 15, "지금 단계를 그대로 돌려주면 전이가 '이미 해당 단계'로 막힌다");
  });

  test("5. 그 분류의 단계가 하나도 없으면 null", () => {
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
});

describe("isWeeklyReportStatus", () => {
  test("6칸만 통과한다", () => {
    assert.equal(isWeeklyReportStatus("SHIPMENT_WAITING"), true);
    assert.equal(isWeeklyReportStatus("IN_REPAIR"), true);
    // 접수 건의 상태(RepairStatus)는 분류 이름이 아니다 — 겹쳐 보이는 값이 있어
    // 더 위험하다. WAITING_SHIPMENT 는 상태이지 분류가 아니다.
    assert.equal(isWeeklyReportStatus("WAITING_SHIPMENT"), false);
    assert.equal(isWeeklyReportStatus("SHIPMENT_COMPLETED"), false);
    assert.equal(isWeeklyReportStatus(""), false);
    assert.equal(isWeeklyReportStatus(null), false);
    assert.equal(isWeeklyReportStatus(undefined), false);
    assert.equal(isWeeklyReportStatus(3), false);
  });
});
