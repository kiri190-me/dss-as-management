import type { Role, WorkflowType } from "../../types";

/**
 * ============================================================================
 * Stage E-1 데모 전용 설정 — 단계 분류(카테고리)
 * ============================================================================
 * "AS_ENGINEER는 기술 단계만, SALES는 영업/교산 응답 단계만, INVENTORY_MANAGER는
 * 부품/출하 단계만" 규칙을 시행하기 위해 각 단계를 아래 3개 범주 중 하나로
 * 분류한다. 이 분류 역시 기존 스키마에 존재하지 않는 Stage E-1 신규 데모
 * 설정값이다(운영 업무 규칙 확정이 아님). 정방향 진행(STEP_ADVANCED)과 보류
 * 시작/해제(HOLD_STARTED/HOLD_RELEASED) 모두 "현재(from) 단계"의 카테고리로
 * 비관리자 역할 자격을 판정한다 — 순서(order) 연산이 아니라 이 표를 조회한다.
 *
 * product_intake는 어떤 시드 데이터에서도 currentWorkflowStepKey로 쓰이지
 * 않으며(신규 접수는 항상 intake_inspection에서 시작 — submit-intake.ts
 * resolveIntakeInspectionStepKey 참고) 전이 그래프상 도달 불가능한 단계이므로
 * 이 표와 transition-definitions.ts 양쪽 모두에서 의도적으로 제외한다.
 * shipment_completed는 종료 상태이며 SHIPMENT_COMPLETED 전용 액션으로만
 * 도달하므로(정방향 이동 대상이 아님) 이 표에도 포함하지 않는다.
 * ============================================================================
 */

export const STEP_CATEGORY_CODES = ["TECHNICAL", "BUSINESS", "PARTS_SHIPMENT"] as const;
export type StepCategory = (typeof STEP_CATEGORY_CODES)[number];

const CATEGORY_ROLE: Record<StepCategory, Role> = {
  TECHNICAL: "AS_ENGINEER",
  BUSINESS: "SALES",
  PARTS_SHIPMENT: "INVENTORY_MANAGER",
};

type CategoryEntry = { key: string; category: StepCategory };


const PAID_GENERATOR_CATEGORIES: readonly CategoryEntry[] = [
  { key: "intake_inspection", category: "TECHNICAL" },
  { key: "parts_supply", category: "PARTS_SHIPMENT" },
  { key: "repair_or_defective_parts_replacement", category: "TECHNICAL" },
  { key: "power_on_test", category: "TECHNICAL" },
  { key: "kyosan_contact_report_sent", category: "TECHNICAL" },
  { key: "waiting_kyosan_reply", category: "BUSINESS" },
  { key: "quote_drafted_per_kyosan_instruction", category: "BUSINESS" },
  { key: "customer_quote_sent", category: "BUSINESS" },
  { key: "waiting_po", category: "BUSINESS" },
  { key: "po_received", category: "BUSINESS" },
  { key: "final_power_on_test_decision", category: "TECHNICAL" },
  { key: "final_power_on_test", category: "TECHNICAL" },
  { key: "waiting_kyosan_shipment_approval", category: "PARTS_SHIPMENT" },
  { key: "shipment_approved", category: "PARTS_SHIPMENT" },
];

const WARRANTY_GENERATOR_CATEGORIES: readonly CategoryEntry[] = [
  { key: "intake_inspection", category: "TECHNICAL" },
  { key: "parts_supply", category: "PARTS_SHIPMENT" },
  { key: "kyosan_contact_report_sent", category: "TECHNICAL" },
  { key: "waiting_kyosan_reply", category: "BUSINESS" },
  { key: "repair_or_defective_parts_replacement", category: "TECHNICAL" },
  { key: "power_on_test", category: "TECHNICAL" },
  { key: "waiting_kyosan_shipment_approval", category: "PARTS_SHIPMENT" },
  { key: "shipment_approved", category: "PARTS_SHIPMENT" },
];


const PAID_MATCHER_CATEGORIES: readonly CategoryEntry[] = [
  { key: "intake_inspection", category: "TECHNICAL" },
  { key: "kyosan_contact_report_sent", category: "TECHNICAL" },
  { key: "waiting_kyosan_reply", category: "BUSINESS" },
  { key: "kyosan_instruction_confirmed", category: "TECHNICAL" },
  { key: "instructed_parts_replacement_or_check", category: "TECHNICAL" },
  { key: "kyosan_followup_report_sent", category: "TECHNICAL" },
  { key: "waiting_kyosan_reply_followup", category: "BUSINESS" },
  { key: "quote_drafted_per_kyosan_instruction", category: "BUSINESS" },
  { key: "customer_quote_sent", category: "BUSINESS" },
  { key: "waiting_po", category: "BUSINESS" },
  { key: "po_received", category: "BUSINESS" },
  { key: "parts_supply", category: "PARTS_SHIPMENT" },
  { key: "repair_in_progress", category: "TECHNICAL" },
  { key: "power_on_test", category: "TECHNICAL" },
  { key: "waiting_kyosan_shipment_approval", category: "PARTS_SHIPMENT" },
  { key: "shipment_approved", category: "PARTS_SHIPMENT" },
  { key: "waiting_shipment", category: "PARTS_SHIPMENT" },
];

const WARRANTY_MATCHER_CATEGORIES: readonly CategoryEntry[] = [
  { key: "intake_inspection", category: "TECHNICAL" },
  { key: "kyosan_contact_report_sent", category: "TECHNICAL" },
  { key: "waiting_kyosan_reply", category: "BUSINESS" },
  { key: "kyosan_instruction_confirmed", category: "TECHNICAL" },
  { key: "instructed_parts_replacement_or_check", category: "TECHNICAL" },
  { key: "kyosan_followup_report_sent", category: "TECHNICAL" },
  { key: "waiting_kyosan_reply_followup", category: "BUSINESS" },
  { key: "quote_drafted_per_kyosan_instruction", category: "BUSINESS" },
  { key: "customer_quote_sent", category: "BUSINESS" },
  { key: "waiting_po", category: "BUSINESS" },
  { key: "po_received", category: "BUSINESS" },
  { key: "parts_supply", category: "PARTS_SHIPMENT" },
  { key: "repair_in_progress", category: "TECHNICAL" },
  { key: "power_on_test", category: "TECHNICAL" },
  { key: "waiting_kyosan_shipment_approval", category: "PARTS_SHIPMENT" },
  { key: "shipment_approved", category: "PARTS_SHIPMENT" },
  { key: "waiting_shipment", category: "PARTS_SHIPMENT" },
];

const PAID_TOTAL_CONTROLLER_CATEGORIES: readonly CategoryEntry[] = [
  { key: "intake_inspection", category: "TECHNICAL" },
  { key: "parts_supply", category: "PARTS_SHIPMENT" },
  { key: "repair_or_defective_parts_replacement", category: "TECHNICAL" },
  { key: "power_on_test", category: "TECHNICAL" },
  { key: "kyosan_contact_report_sent", category: "TECHNICAL" },
  { key: "waiting_kyosan_reply", category: "BUSINESS" },
  { key: "quote_drafted_per_kyosan_instruction", category: "BUSINESS" },
  { key: "customer_quote_sent", category: "BUSINESS" },
  { key: "waiting_po", category: "BUSINESS" },
  { key: "po_received", category: "BUSINESS" },
  { key: "final_power_on_test_decision", category: "TECHNICAL" },
  { key: "final_power_on_test", category: "TECHNICAL" },
  { key: "waiting_kyosan_shipment_approval", category: "PARTS_SHIPMENT" },
  { key: "shipment_approved", category: "PARTS_SHIPMENT" },
];

const WARRANTY_TOTAL_CONTROLLER_CATEGORIES: readonly CategoryEntry[] = [
  { key: "intake_inspection", category: "TECHNICAL" },
  { key: "parts_supply", category: "PARTS_SHIPMENT" },
  { key: "kyosan_contact_report_sent", category: "TECHNICAL" },
  { key: "waiting_kyosan_reply", category: "BUSINESS" },
  { key: "repair_or_defective_parts_replacement", category: "TECHNICAL" },
  { key: "power_on_test", category: "TECHNICAL" },
  { key: "waiting_kyosan_shipment_approval", category: "PARTS_SHIPMENT" },
  { key: "shipment_approved", category: "PARTS_SHIPMENT" },
];

const CATEGORY_BY_WORKFLOW: Record<WorkflowType, readonly CategoryEntry[]> = {
  PAID_MATCHER: PAID_MATCHER_CATEGORIES,
  WARRANTY_MATCHER: WARRANTY_MATCHER_CATEGORIES,
  PAID_GENERATOR: PAID_GENERATOR_CATEGORIES,
  WARRANTY_GENERATOR: WARRANTY_GENERATOR_CATEGORIES,
  PAID_TOTAL_CONTROLLER: PAID_TOTAL_CONTROLLER_CATEGORIES,
  WARRANTY_TOTAL_CONTROLLER: WARRANTY_TOTAL_CONTROLLER_CATEGORIES,
  PENDING_MATCHER: [{ key: "intake_inspection", category: "TECHNICAL" }],
  PENDING_GENERATOR: [{ key: "intake_inspection", category: "TECHNICAL" }],
  PENDING_TOTAL_CONTROLLER: [{ key: "intake_inspection", category: "TECHNICAL" }],
};

const LOOKUP: Record<string, StepCategory> = {};
for (const [workflowType, entries] of Object.entries(CATEGORY_BY_WORKFLOW)) {
  for (const entry of entries) {
    LOOKUP[`${workflowType}::${entry.key}`] = entry.category;
  }
}

/** 분류표에 없는 단계(product_intake, shipment_completed 등)는 undefined다. */
export function getStepCategory(workflowType: WorkflowType, stepKey: string): StepCategory | undefined {
  return LOOKUP[`${workflowType}::${stepKey}`];
}

/** 해당 카테고리에서 비관리자 역할 중 자격이 있는 단일 역할을 반환한다. */
export function roleForCategory(category: StepCategory): Role {
  return CATEGORY_ROLE[category];
}
