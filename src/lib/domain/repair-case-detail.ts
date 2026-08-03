import { DEMO_REFERENCE_DATE } from "./demo-clock";
import {
  mockCustomers,
  mockEndUsers,
  mockProducts,
  mockRepairCases,
  mockUsers,
} from "./mock-data";
import { isRepairCaseOverdue, type RepairCase, type RepairStatus } from "./types";

export type RelatedRepairCase = {
  id: string;
  intakeNumber: string;
  receivedAt: string;
  status: RepairStatus;
  actualShipmentDate: string | null;
};

export type RepairCaseDetail = {
  repairCase: RepairCase;
  customerName: string;
  endUserName: string | null;
  modelName: string;
  lotNumber: string;
  serialNumber: string;
  engineerName: string | null;
  isOverdue: boolean;
  /**
   * 동일한 모의 제품 ID(productId)를 가지면서 접수일(receivedAt)이 현재
   * 건보다 이른 다른 접수 건만 포함한다(자기 자신 제외, 이후 접수 건 제외).
   * 접수일 내림차순(최신 과거 이력 먼저)으로 정렬한다. 실제 운영에서 확정될
   * "과거 수리 이력 비교" 매칭 로직이 아니라, 데모 목적의 단순 ID/날짜 비교
   * 조회임을 화면에 함께 표시한다.
   */
  relatedCases: RelatedRepairCase[];
};

export function buildRepairCaseDetail(
  id: string,
  referenceDate: Date = DEMO_REFERENCE_DATE
): RepairCaseDetail | null {
  const repairCase = mockRepairCases.find((candidate) => candidate.id === id);
  if (!repairCase) {
    return null;
  }

  const customer = mockCustomers.find((c) => c.id === repairCase.customerId);
  const endUser = repairCase.endUserId
    ? (mockEndUsers.find((e) => e.id === repairCase.endUserId) ?? null)
    : null;
  const product = mockProducts.find((p) => p.id === repairCase.productId);
  const engineer = repairCase.assignedEngineerId
    ? (mockUsers.find((u) => u.id === repairCase.assignedEngineerId) ?? null)
    : null;

  const relatedCases: RelatedRepairCase[] = mockRepairCases
    .filter(
      (c) =>
        c.productId === repairCase.productId &&
        c.id !== repairCase.id &&
        c.receivedAt < repairCase.receivedAt
    )
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .map((c) => ({
      id: c.id,
      intakeNumber: c.intakeNumber,
      receivedAt: c.receivedAt,
      status: c.status,
      actualShipmentDate: c.actualShipmentDate,
    }));

  return {
    repairCase,
    customerName: customer?.name ?? "-",
    endUserName: endUser?.name ?? null,
    modelName: product?.modelName ?? "-",
    lotNumber: product?.lotNumber ?? "-",
    serialNumber: product?.serialNumber ?? "-",
    engineerName: engineer?.name ?? null,
    isOverdue: isRepairCaseOverdue(repairCase, referenceDate),
    relatedCases,
  };
}
