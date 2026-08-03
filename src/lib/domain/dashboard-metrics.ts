import { DEMO_REFERENCE_DATE } from "./demo-clock";
import {
  isRepairCaseOverdue,
  type RepairCase,
} from "./types";

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
 * 대시보드의 10개 카드는 전부 이 함수를 통해 mockRepairCases로부터
 * 계산되며, 어떤 카드 수치도 별도로 하드코딩하지 않는다.
 */
export function computeDashboardSummary(
  cases: RepairCase[],
  referenceDate: Date = DEMO_REFERENCE_DATE
): DashboardSummary {
  const countByStatus = (status: RepairCase["status"]) =>
    cases.filter((c) => c.status === status).length;

  return {
    currentIntakeCount: cases.filter((c) => c.status !== "SHIPMENT_COMPLETED").length,
    waitingIntakeInspection: countByStatus("WAITING_INTAKE_INSPECTION"),
    waitingKyosanReply: countByStatus("WAITING_KYOSAN_REPLY"),
    waitingPo: countByStatus("WAITING_PO"),
    waitingPartsSupply: countByStatus("WAITING_PARTS_SUPPLY"),
    inRepair: countByStatus("IN_REPAIR"),
    waitingShipmentApproval: countByStatus("WAITING_SHIPMENT_APPROVAL"),
    waitingShipment: countByStatus("WAITING_SHIPMENT"),
    completedThisMonth: cases.filter(
      (c) =>
        c.status === "SHIPMENT_COMPLETED" &&
        c.actualShipmentDate !== null &&
        isSameYearMonth(c.actualShipmentDate, referenceDate)
    ).length,
    overdueCount: cases.filter((c) => isRepairCaseOverdue(c, referenceDate)).length,
  };
}
