import { toKstYearMonth } from "./date-only";
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

/**
 * dateStr은 출하일("YYYY-MM-DD" 날짜 문자열)이고 reference는 실제 시각이다.
 * 두 값을 한국 기준 "YYYY-MM"으로 맞춰 비교한다 — getUTCMonth()로 비교하면
 * 매달 1일 한국시간 0~9시 사이(그 시각의 UTC는 아직 지난달)에 "금월"이
 * 지난달로 새어 나간다.
 */
function isSameYearMonth(dateStr: string, reference: Date): boolean {
  return dateStr.slice(0, 7) === toKstYearMonth(reference);
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
  referenceDate: Date = new Date()
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
