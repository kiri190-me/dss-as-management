import { DEMO_REFERENCE_DATE } from "./demo-clock";
import type { RepairStatus } from "./types";
import type { EffectiveRepairCase } from "./local/workflow/effective-repair-case";

export type DashboardSummary = {
  currentIntakeCount: number;
  waitingIntakeInspection: number;
  waitingKyosanReply: number;
  waitingPo: number;
  waitingPartsSupply: number;
  inRepair: number;
  waitingShipmentApproval: number;
  waitingShipment: number;
  completedThisMonth: number;
  overdueCount: number;
};

function isSameYearMonth(dateStr: string, reference: Date): boolean {
  const date = new Date(dateStr);
  return (
    date.getUTCFullYear() === reference.getUTCFullYear() &&
    date.getUTCMonth() === reference.getUTCMonth()
  );
}

/**
 * 대시보드의 10개 카드는 전부 이 함수를 통해 EffectiveRepairCase[](mock +
 * 로컬 데모 병합 + Stage E-1 워크플로 재정의 적용 완료)로부터 계산되며,
 * 어떤 카드 수치도 별도로 하드코딩하지 않는다. status/actualShipmentDate/
 * isOverdue(원본 필드)가 아니라 effectiveStatus/effectiveActualShipmentDate/
 * effectiveIsOverdue만 읽는다 — 워크플로 재정의가 있으면 그 결과를,
 * 없으면 원본과 동일한 값을 그대로 받는다(useEffectiveRepairCases 참고).
 */
export function computeDashboardSummary(
  cases: EffectiveRepairCase[],
  referenceDate: Date = DEMO_REFERENCE_DATE
): DashboardSummary {
  const countByStatus = (status: RepairStatus) =>
    cases.filter((c) => c.effectiveStatus === status).length;

  return {
    currentIntakeCount: cases.filter((c) => c.effectiveStatus !== "SHIPMENT_COMPLETED").length,
    waitingIntakeInspection: countByStatus("WAITING_INTAKE_INSPECTION"),
    waitingKyosanReply: countByStatus("WAITING_KYOSAN_REPLY"),
    waitingPo: countByStatus("WAITING_PO"),
    waitingPartsSupply: countByStatus("WAITING_PARTS_SUPPLY"),
    inRepair: countByStatus("IN_REPAIR"),
    waitingShipmentApproval: countByStatus("WAITING_SHIPMENT_APPROVAL"),
    waitingShipment: countByStatus("WAITING_SHIPMENT"),
    completedThisMonth: cases.filter(
      (c) =>
        c.effectiveStatus === "SHIPMENT_COMPLETED" &&
        c.effectiveActualShipmentDate !== null &&
        isSameYearMonth(c.effectiveActualShipmentDate, referenceDate)
    ).length,
    overdueCount: cases.filter((c) => c.effectiveIsOverdue).length,
  };
}
