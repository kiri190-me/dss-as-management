import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  isManuallySelectableStepInRules,
  listManuallySelectableStepsFromRules,
  type WorkflowRules,
} from "./workflow-rules";
import type { WorkflowRuleStep } from "@/lib/domain/workflow-rules-view";
import type { TransitionDefinition } from "@/lib/domain/local/workflow/transition-definitions";

/**
 * ============================================================================
 * [단계 직접 변경] 후보에서 **[출하 대기]가 빠진다** (2026-11-03)
 * ============================================================================
 * 사용자 요구: 「출하대기는 자동으로만 넘어가도록 해줘. [단계 직접 변경]에서
 * [출하대기]는 보이지 않도록 해줘.」
 *
 * 🔴 이 목록 하나가 **세 자리**를 동시에 정한다 — 작업내용 탭의 고르개
 * (ManualStepSetPanel), 그 서버 재검증(isManuallySelectableStepInRules →
 * transitionWorkflow 의 STEP_SET_MANUALLY 분기), 그리고 주간보고 상세표의
 * `현 상태` 고르개(mutations/weekly-report-status.ts). 화면에서만 빼고 서버를
 * 열어 두면 손으로 만든 요청이 그대로 통과한다.
 *
 * 🔴 **빼는 것은 「들어가는 길」뿐이다.** 이 목록은 「어디로 갈 수 있는가」이고
 * 「어디에서 갈 수 있는가」가 아니다 — 출하 대기에 서 있는 건이 다른 단계로
 * 나가는 길은 그대로 열려 있어야 한다. 아래 마지막 시험이 그것을 값으로 못 박는다.
 *
 * 🔴 **기존 규칙(승인 게이트 제외)이 약해지지 않았는지도 함께 잰다.** 새 규칙을
 * 더하면서 옛 규칙을 흘리면, 그 사고는 「출하 완료로 바로 점프할 수 있다」로
 * 나타난다 — 조용하지 않지만 이미 늦은 종류의 사고다.
 *
 * `server-only` 가 붙은 모듈이라 이 시험은 unit 목록에 적는다(그 목록만
 * `--conditions=react-server` 로 돈다 — scripts/test-lists/unit.txt 머리말).
 * ============================================================================
 */

function step(
  key: string,
  order: number,
  status: WorkflowRuleStep["status"]
): WorkflowRuleStep {
  return { id: `step-${key}`, key, label: key, order, isActive: true, status, category: null };
}

function transition(
  actionCode: TransitionDefinition["actionCode"],
  fromStepKey: string,
  toStepKey: string,
  toStatus: WorkflowRuleStep["status"],
  requiredApprovalType: TransitionDefinition["requiredApprovalType"] = null
): TransitionDefinition {
  return {
    id: `t-${actionCode}-${fromStepKey}`,
    workflowType: "PAID_MATCHER",
    actionCode,
    fromStepKey,
    toStepKey,
    toStatus,
    direction: actionCode === "STEP_ADVANCED" ? "FORWARD" : "TERMINAL",
    allowedRoles: ["SUPER_ADMIN"],
    requiresAssignedEngineer: false,
    requiresReason: false,
    requiredApprovalType,
  };
}

/**
 * 실측(2026-11-03)의 PAID_MATCHER 꼬리를 그대로 옮긴 표본 — 승인 게이트가 걸린
 * 단계 둘(교산 출하 승인 대기 · 출하 완료)과 출하 대기가 한 자리에 모여 있어야
 * 「무엇이 왜 빠지는가」가 섞이지 않고 갈린다.
 */
function matcherRules(): WorkflowRules {
  const steps = [
    step("intake_inspection", 2, "WAITING_INTAKE_INSPECTION"),
    step("power_on_test", 15, "IN_REPAIR"),
    step("waiting_kyosan_shipment_approval", 16, "WAITING_SHIPMENT_APPROVAL"),
    step("shipment_approved", 17, "WAITING_SHIPMENT_APPROVAL"),
    step("waiting_shipment", 18, "WAITING_SHIPMENT"),
    step("shipment_completed", 19, "SHIPMENT_COMPLETED"),
  ];
  return {
    workflowVersionId: "version-1",
    workflowType: "PAID_MATCHER",
    steps,
    stepByKey: new Map(steps.map((s) => [s.key, s])),
    transitions: [
      transition(
        "STEP_ADVANCED",
        "power_on_test",
        "waiting_kyosan_shipment_approval",
        "WAITING_SHIPMENT_APPROVAL",
        "REPAIR_INSPECTION"
      ),
      transition(
        "STEP_ADVANCED",
        "waiting_kyosan_shipment_approval",
        "shipment_approved",
        "WAITING_SHIPMENT_APPROVAL"
      ),
      transition("STEP_ADVANCED", "shipment_approved", "waiting_shipment", "WAITING_SHIPMENT"),
      transition(
        "SHIPMENT_COMPLETED",
        "waiting_shipment",
        "shipment_completed",
        "SHIPMENT_COMPLETED",
        "FINAL_SHIPMENT"
      ),
    ],
  };
}

describe("listManuallySelectableStepsFromRules", () => {
  test("표본 점검 — 표본에 출하 대기와 승인 게이트 단계가 실제로 들어 있다", () => {
    const keys = matcherRules().steps.map((s) => s.key);
    for (const key of ["waiting_shipment", "waiting_kyosan_shipment_approval", "shipment_completed"]) {
      assert.ok(keys.includes(key), `표본에 ${key} 가 없다 — 아래 시험이 빈 표본을 잰다`);
    }
  });

  test("🔴 [출하 대기]가 후보에서 빠진다", () => {
    const keys = listManuallySelectableStepsFromRules(matcherRules()).map((s) => s.key);
    assert.ok(!keys.includes("waiting_shipment"), `출하 대기가 아직 고를 수 있다: ${keys.join(", ")}`);
  });

  test("🔴 단계 key 가 아니라 **상태**로 뺀다 — 편집기에서 이름을 바꿔도 따라간다", () => {
    const rules = matcherRules();
    const renamed = rules.steps.map((s) =>
      s.key === "waiting_shipment" ? { ...s, key: "step_18", label: "나가기 전 대기" } : s
    );
    const keys = listManuallySelectableStepsFromRules({
      ...rules,
      steps: renamed,
      stepByKey: new Map(renamed.map((s) => [s.key, s])),
    }).map((s) => s.key);
    assert.ok(!keys.includes("step_18"), `이름을 바꾸자 다시 고를 수 있게 됐다: ${keys.join(", ")}`);
  });

  test("🔴 승인 게이트 제외가 약해지지 않았다", () => {
    const keys = listManuallySelectableStepsFromRules(matcherRules()).map((s) => s.key);
    assert.ok(!keys.includes("shipment_completed"), "출하 완료로 바로 점프할 수 있다");
    assert.ok(
      !keys.includes("waiting_kyosan_shipment_approval"),
      "검수 승인을 건너뛴 단계에 앉을 수 있다"
    );
  });

  test("나머지 단계는 그대로 남는다 — 통째로 비우지 않았다", () => {
    const keys = listManuallySelectableStepsFromRules(matcherRules()).map((s) => s.key);
    assert.deepEqual(keys, ["intake_inspection", "power_on_test", "shipment_approved"]);
  });

  test("🔴 서버 재검증도 같은 답을 한다 — 화면에서만 빼지 않았다", () => {
    const rules = matcherRules();
    assert.equal(isManuallySelectableStepInRules(rules, "waiting_shipment"), false);
    assert.equal(isManuallySelectableStepInRules(rules, "shipment_approved"), true);
  });

  test("🔴 나가는 길은 막지 않는다 — 출하 대기에 서 있어도 고를 자리가 남는다", () => {
    const rules = matcherRules();
    const options = listManuallySelectableStepsFromRules(rules);
    // 이 목록은 **도착지**만 추린다. 출발이 어디인지는 보지 않으므로, 출하 대기에
    // 선 건도 아래 셋 가운데 아무 곳으로나 빠져나올 수 있다.
    assert.ok(options.length > 0, "출하 대기에서 빠져나갈 후보가 하나도 없다 — 건이 갇힌다");
    assert.ok(
      options.every((option) => option.key !== "waiting_shipment"),
      "빠져나갈 후보에 제자리가 끼어 있다"
    );
  });
});
