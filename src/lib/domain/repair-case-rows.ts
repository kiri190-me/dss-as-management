import { DEMO_REFERENCE_DATE } from "./demo-clock";
import {
  isRepairCaseOverdue,
  paidOrWarrantyLabels,
  productCategoryLabels,
  type Customer,
  type EndUser,
  type Priority,
  type Product,
  type RepairCase,
  type RepairStatus,
  type User,
  type WorkflowType,
} from "./types";

/**
 * 전체 A/S 현황 표에 표시하기 위해 여러 모의 데이터 배열을 조인한
 * 평탄화된 행 타입이다. 필터링에는 원본 코드값(workflowType/customerId 등)을,
 * 표시에는 파생 라벨(productCategory/paidOrWarranty 등)을 함께 들고 있다.
 */
export type RepairCaseRow = {
  id: string;
  intakeNumber: string;
  receivedAt: string;
  workflowType: WorkflowType;
  productCategory: string;
  paidOrWarranty: string;
  modelName: string;
  lotNumber: string;
  serialNumber: string;
  customerId: string;
  customerName: string;
  endUserName: string | null;
  status: RepairStatus;
  priority: Priority;
  assignedEngineerId: string | null;
  engineerName: string | null;
  customerRequestedDueDate: string | null;
  internalTargetShipmentDate: string | null;
  actualShipmentDate: string | null;
  isOverdue: boolean;
};

export function buildRepairCaseRows(
  cases: RepairCase[],
  customers: Customer[],
  endUsers: EndUser[],
  products: Product[],
  users: User[],
  referenceDate: Date = DEMO_REFERENCE_DATE
): RepairCaseRow[] {
  return cases.map((repairCase) => {
    const customer = customers.find((c) => c.id === repairCase.customerId);
    const endUser = repairCase.endUserId
      ? endUsers.find((e) => e.id === repairCase.endUserId)
      : undefined;
    const product = products.find((p) => p.id === repairCase.productId);
    const engineer = repairCase.assignedEngineerId
      ? users.find((u) => u.id === repairCase.assignedEngineerId)
      : undefined;

    return {
      id: repairCase.id,
      intakeNumber: repairCase.intakeNumber,
      receivedAt: repairCase.receivedAt,
      workflowType: repairCase.workflowType,
      productCategory: productCategoryLabels[repairCase.workflowType],
      paidOrWarranty: paidOrWarrantyLabels[repairCase.workflowType],
      modelName: product?.modelName ?? "-",
      lotNumber: product?.lotNumber ?? "-",
      serialNumber: product?.serialNumber ?? "-",
      customerId: repairCase.customerId,
      customerName: customer?.name ?? "-",
      endUserName: endUser?.name ?? null,
      status: repairCase.status,
      priority: repairCase.priority,
      assignedEngineerId: repairCase.assignedEngineerId,
      engineerName: engineer?.name ?? null,
      customerRequestedDueDate: repairCase.customerRequestedDueDate,
      internalTargetShipmentDate: repairCase.internalTargetShipmentDate,
      actualShipmentDate: repairCase.actualShipmentDate,
      isOverdue: isRepairCaseOverdue(repairCase, referenceDate),
    };
  });
}
