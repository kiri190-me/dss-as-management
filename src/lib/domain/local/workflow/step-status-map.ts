import type { RepairStatus, WorkflowType } from "../../types";

/**
 * ============================================================================
 * Stage E-1 데모 전용 설정 — 단계 → 상태 매핑
 * ============================================================================
 * mock-data.ts의 workflowSteps(45개 단계, 3개 워크플로)에는 어떤 단계가 어떤
 * RepairStatus에 해당하는지를 알려주는 기존 코드/스키마가 전혀 없다
 * (workflow-progress.ts 주석 참고: "currentWorkflowStepKey는 RepairStatus로부터
 * 역산하지 않는다"). 이 파일은 그 공백을 메우기 위해 Stage E-1이 새로 도입하는
 * 데모 전용 매핑표이며, 실제 운영 업무 규칙이 아니다.
 *
 * 각 항목은 아래 두 출처 중 하나로 얻어졌다:
 *   - CONFIRMED: mock-data.ts의 실제 시드 레코드(mockRepairCases) 또는
 *     mockWorkHistories의 STATUS_CHANGE 이력에 정확히 일치하는 (workflowType,
 *     stepKey, status) 조합이 존재함 — 근거 레코드를 주석에 남긴다.
 *   - INFERRED: 그런 시드 레코드가 없어 라벨/PROJECT_REQUIREMENTS.md 워크플로
 *     서술을 근거로 사람이 판단한 값이다. 확정된 운영 업무 규칙이 아니라
 *     Stage E-1 데모 설정값이며, 틀렸다면 이 파일만 고치면 된다.
 *
 * 런타임에는 어떤 함수도 라벨 문자열이나 순서로부터 상태를 추론하지 않는다 —
 * 오직 이 표를 조회할 뿐이다(getStepStatus). 이 표에 없는 (workflowType, key)
 * 조합은 항상 안전하게 실패한다(undefined 반환, 호출부가 검증 실패로 처리).
 * ============================================================================
 */

type StepStatusEntry = { key: string; status: RepairStatus };

const MATCHER_STEP_STATUS: readonly StepStatusEntry[] = [
  { key: "product_intake", status: "WAITING_INTAKE_INSPECTION" }, // INFERRED
  { key: "intake_inspection", status: "WAITING_INTAKE_INSPECTION" }, // CONFIRMED: rc-010
  { key: "kyosan_contact_report_sent", status: "WAITING_KYOSAN_REPLY" }, // INFERRED
  { key: "waiting_kyosan_reply", status: "WAITING_KYOSAN_REPLY" }, // CONFIRMED: rc-012(WARRANTY, same key)
  { key: "kyosan_instruction_confirmed", status: "IN_REPAIR" }, // INFERRED
  { key: "instructed_parts_replacement_or_check", status: "IN_REPAIR" }, // INFERRED
  { key: "kyosan_followup_report_sent", status: "IN_REPAIR" }, // INFERRED
  { key: "waiting_kyosan_reply_followup", status: "WAITING_KYOSAN_REPLY" }, // CONFIRMED: rc-013
  { key: "quote_drafted_per_kyosan_instruction", status: "WAITING_KYOSAN_REPLY" }, // INFERRED
  { key: "customer_quote_sent", status: "WAITING_KYOSAN_REPLY" }, // CONFIRMED(pattern): wh-019/020
  { key: "waiting_po", status: "WAITING_PO" }, // CONFIRMED: rc-014/015(PAID_GENERATOR, same key)
  { key: "po_received", status: "WAITING_PO" }, // INFERRED
  { key: "parts_supply", status: "WAITING_PARTS_SUPPLY" }, // CONFIRMED: rc-008/009(same key)
  { key: "repair_in_progress", status: "IN_REPAIR" }, // CONFIRMED: rc-007, rc-016
  { key: "power_on_test", status: "IN_REPAIR" }, // INFERRED
  { key: "waiting_kyosan_shipment_approval", status: "WAITING_SHIPMENT_APPROVAL" }, // CONFIRMED: rc-005/017(same key)
  { key: "shipment_approved", status: "WAITING_SHIPMENT_APPROVAL" }, // CONFIRMED(pattern): wh-023
  { key: "waiting_shipment", status: "WAITING_SHIPMENT" }, // CONFIRMED: rc-004, rc-018
  { key: "shipment_completed", status: "SHIPMENT_COMPLETED" }, // CONFIRMED: rc-001
];

const PAID_GENERATOR_STEP_STATUS: readonly StepStatusEntry[] = [
  { key: "product_intake", status: "WAITING_INTAKE_INSPECTION" }, // INFERRED
  { key: "intake_inspection", status: "WAITING_INTAKE_INSPECTION" }, // CONFIRMED: rc-011
  { key: "parts_supply", status: "WAITING_PARTS_SUPPLY" }, // CONFIRMED: rc-008(same key)
  { key: "repair_or_defective_parts_replacement", status: "IN_REPAIR" }, // CONFIRMED: rc-006(same key)
  { key: "power_on_test", status: "IN_REPAIR" }, // INFERRED
  { key: "kyosan_contact_report_sent", status: "WAITING_KYOSAN_REPLY" }, // INFERRED
  { key: "waiting_kyosan_reply", status: "WAITING_KYOSAN_REPLY" }, // CONFIRMED: rc-012(same key)
  { key: "quote_drafted_per_kyosan_instruction", status: "WAITING_KYOSAN_REPLY" }, // INFERRED
  { key: "customer_quote_sent", status: "WAITING_KYOSAN_REPLY" }, // CONFIRMED: wh-019/020(rc-014/015)
  { key: "waiting_po", status: "WAITING_PO" }, // CONFIRMED: rc-014, rc-015
  { key: "po_received", status: "WAITING_PO" }, // INFERRED
  { key: "final_power_on_test_decision", status: "IN_REPAIR" }, // INFERRED (두 번째 IN_REPAIR 구간)
  { key: "final_power_on_test", status: "IN_REPAIR" }, // INFERRED
  { key: "waiting_kyosan_shipment_approval", status: "WAITING_SHIPMENT_APPROVAL" }, // CONFIRMED: rc-005, rc-017
  { key: "shipment_approved", status: "WAITING_SHIPMENT_APPROVAL" }, // CONFIRMED(pattern): wh-022
  { key: "shipment_completed", status: "SHIPMENT_COMPLETED" }, // CONFIRMED: rc-002
];

const WARRANTY_GENERATOR_STEP_STATUS: readonly StepStatusEntry[] = [
  { key: "product_intake", status: "WAITING_INTAKE_INSPECTION" }, // INFERRED
  { key: "intake_inspection", status: "WAITING_INTAKE_INSPECTION" }, // INFERRED (다른 두 워크플로와 대칭)
  { key: "parts_supply", status: "WAITING_PARTS_SUPPLY" }, // CONFIRMED: rc-009(same key)
  { key: "kyosan_contact_report_sent", status: "WAITING_KYOSAN_REPLY" }, // INFERRED
  { key: "waiting_kyosan_reply", status: "WAITING_KYOSAN_REPLY" }, // CONFIRMED: rc-012
  { key: "repair_or_defective_parts_replacement", status: "IN_REPAIR" }, // CONFIRMED: rc-006(same key)
  { key: "power_on_test", status: "IN_REPAIR" }, // INFERRED
  { key: "waiting_kyosan_shipment_approval", status: "WAITING_SHIPMENT_APPROVAL" }, // INFERRED (대칭)
  { key: "shipment_approved", status: "WAITING_SHIPMENT_APPROVAL" }, // INFERRED (wh-022/023 패턴과 대칭)
  { key: "shipment_completed", status: "SHIPMENT_COMPLETED" }, // CONFIRMED: rc-003
];

const STEP_STATUS_BY_WORKFLOW: Record<WorkflowType, readonly StepStatusEntry[]> = {
  MATCHER: MATCHER_STEP_STATUS,
  PAID_GENERATOR: PAID_GENERATOR_STEP_STATUS,
  WARRANTY_GENERATOR: WARRANTY_GENERATOR_STEP_STATUS,
};

const LOOKUP: Record<string, RepairStatus> = {};
for (const [workflowType, entries] of Object.entries(STEP_STATUS_BY_WORKFLOW)) {
  for (const entry of entries) {
    LOOKUP[`${workflowType}::${entry.key}`] = entry.status;
  }
}

/** 표에 없는 (workflowType, stepKey) 조합은 undefined를 반환한다(추측하지 않는다). */
export function getStepStatus(workflowType: WorkflowType, stepKey: string): RepairStatus | undefined {
  return LOOKUP[`${workflowType}::${stepKey}`];
}

export function hasStepStatusMapping(workflowType: WorkflowType, stepKey: string): boolean {
  return `${workflowType}::${stepKey}` in LOOKUP;
}
