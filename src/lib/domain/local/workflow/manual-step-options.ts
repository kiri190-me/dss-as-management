import { workflowSteps } from "../../mock-data";
import type { RepairStatus, WorkflowType } from "../../types";
import { getStepStatus, hasStepStatusMapping } from "./step-status-map";
import { TRANSITION_DEFINITIONS } from "./transition-definitions";

export type ManualStepOption = {
  key: string;
  label: string;
  order: number;
  status: RepairStatus;
};

/**
 * ============================================================================
 * 작업내용 탭의 "현재 단계 직접 변경" 드롭다운에 실을 후보 목록
 * ============================================================================
 * 이 목록은 정규 전이표(transition-definitions.ts)를 우회하는 경로의 입력
 * 범위를 정한다. 우회를 허용하더라도 "어디로든" 갈 수 있으면 안 되므로,
 * 아래 두 부류를 제외한다.
 *
 * 1. 승인 게이트가 걸린 단계 (2026-08-18 사용자 결정)
 *    정규 전이 중 requiredApprovalType이 설정된 행의 toStepKey — 현재
 *    shipment_completed(FINAL_SHIPMENT)와 waiting_kyosan_shipment_approval
 *    (REPAIR_INSPECTION)이 해당한다. 이 단계들을 드롭다운으로 열어두면 최종
 *    출하 승인·수리 검수 승인을 건너뛰고 도달할 수 있게 되어 승인 절차가
 *    사실상 무력화된다. 정규 경로(승인 → 실행 가능 작업)로만 도달해야 한다.
 *    특정 워크플로에서 승인 요건이 바뀌면 이 목록도 자동으로 따라간다 —
 *    제외할 단계 키를 따로 하드코딩하지 않고 전이표에서 매번 산출하기 때문이다.
 *
 * 2. step-status-map.ts에 매핑이 없는 단계
 *    RepairStatus는 저장값이 아니라 현재 단계에서 파생된다
 *    (mappers/repair-status.ts). 매핑이 없는 단계로 옮기면 그 접수 건은 이후
 *    목록/대시보드에서 읽을 때마다 UnmappedWorkflowStepError로 실패한다 —
 *    즉 화면에서 사라지는 것이 아니라 화면 전체가 깨진다. 애초에 고를 수
 *    없게 막는 것이 유일하게 안전한 처리다.
 *
 * 현재 단계 자신은 제외하지 않는다 — 호출부(UI)가 "현재 값"으로 표시해야
 * 하고, 같은 단계를 다시 고르는 것은 mutation이 별도로 거부한다.
 * ============================================================================
 */
export function listManuallySelectableSteps(workflowType: WorkflowType): ManualStepOption[] {
  const approvalGatedStepKeys = new Set(
    TRANSITION_DEFINITIONS.filter(
      (d) => d.workflowType === workflowType && d.requiredApprovalType !== null
    ).map((d) => d.toStepKey)
  );

  return workflowSteps
    .filter((step) => step.workflowType === workflowType)
    .filter((step) => !approvalGatedStepKeys.has(step.key))
    .filter((step) => hasStepStatusMapping(workflowType, step.key))
    .map((step) => ({
      key: step.key,
      label: step.label,
      order: step.order,
      // Safe: hasStepStatusMapping 위에서 확인했다.
      status: getStepStatus(workflowType, step.key) as RepairStatus,
    }))
    .sort((a, b) => a.order - b.order);
}

/**
 * mutation이 클라이언트가 보낸 단계 키를 신뢰하지 않고 다시 검증할 때 쓰는
 * 술어다. UI가 무엇을 렌더했든 서버는 이 함수로 같은 규칙을 재평가한다 —
 * 목록 산출과 검증이 서로 다른 규칙을 갖게 되는 상황을 막기 위해 위 함수를
 * 그대로 재사용한다.
 */
export function isManuallySelectableStep(workflowType: WorkflowType, stepKey: string): boolean {
  return listManuallySelectableSteps(workflowType).some((option) => option.key === stepKey);
}
