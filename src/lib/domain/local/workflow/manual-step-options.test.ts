import assert from "node:assert/strict";
import { test } from "node:test";

import { workflowSteps } from "../../mock-data";
import { hasStepStatusMapping } from "./step-status-map";
import { TRANSITION_DEFINITIONS } from "./transition-definitions";
import { isManuallySelectableStep, listManuallySelectableSteps } from "./manual-step-options";

const WORKFLOW_TYPES = [...new Set(workflowSteps.map((s) => s.workflowType))];

test("승인 게이트가 걸린 단계는 어떤 워크플로에서도 후보에 없다", () => {
  for (const workflowType of WORKFLOW_TYPES) {
    const gated = new Set(
      TRANSITION_DEFINITIONS.filter(
        (d) => d.workflowType === workflowType && d.requiredApprovalType !== null
      ).map((d) => d.toStepKey)
    );
    const options = listManuallySelectableSteps(workflowType);
    for (const option of options) {
      assert.equal(
        gated.has(option.key),
        false,
        `${workflowType}: 승인 필요 단계 ${option.key}가 후보에 포함되면 승인 절차가 우회된다`
      );
    }
  }
});

test("출하 완료(shipment_completed)는 모든 워크플로에서 후보에서 빠진다", () => {
  // 위 규칙에서 자동으로 따라오는 결과지만, 가장 위험한 단일 케이스라
  // 별도로 못 박아 둔다 — 전이표에서 FINAL_SHIPMENT 게이트가 사라지는 변경이
  // 있어도 이 테스트가 먼저 실패해야 한다.
  for (const workflowType of WORKFLOW_TYPES) {
    const keys = listManuallySelectableSteps(workflowType).map((o) => o.key);
    assert.equal(keys.includes("shipment_completed"), false, `${workflowType}`);
  }
});

test("상태 매핑이 없는 단계는 후보에 없다 (읽기 시 UnmappedWorkflowStepError 방지)", () => {
  for (const workflowType of WORKFLOW_TYPES) {
    for (const option of listManuallySelectableSteps(workflowType)) {
      assert.equal(hasStepStatusMapping(workflowType, option.key), true, `${workflowType}/${option.key}`);
    }
  }
});

test("후보는 order 오름차순이고, 같은 워크플로의 실제 단계만 담는다", () => {
  for (const workflowType of WORKFLOW_TYPES) {
    const options = listManuallySelectableSteps(workflowType);
    const orders = options.map((o) => o.order);
    assert.deepEqual(orders, [...orders].sort((a, b) => a - b), `${workflowType}: 정렬`);

    const validKeys = new Set(
      workflowSteps.filter((s) => s.workflowType === workflowType).map((s) => s.key)
    );
    for (const option of options) {
      assert.equal(validKeys.has(option.key), true, `${workflowType}/${option.key}`);
    }
  }
});

test("모든 워크플로가 최소 한 개의 후보를 갖는다 (기능이 조용히 비어 버리지 않게)", () => {
  for (const workflowType of WORKFLOW_TYPES) {
    assert.ok(
      listManuallySelectableSteps(workflowType).length > 0,
      `${workflowType}: 후보가 하나도 없으면 드롭다운이 빈 채로 렌더된다`
    );
  }
});

test("isManuallySelectableStep은 목록과 정확히 같은 판정을 한다", () => {
  for (const workflowType of WORKFLOW_TYPES) {
    const keys = new Set(listManuallySelectableSteps(workflowType).map((o) => o.key));
    for (const step of workflowSteps.filter((s) => s.workflowType === workflowType)) {
      assert.equal(
        isManuallySelectableStep(workflowType, step.key),
        keys.has(step.key),
        `${workflowType}/${step.key}`
      );
    }
    assert.equal(isManuallySelectableStep(workflowType, "존재하지_않는_단계"), false);
  }
});
