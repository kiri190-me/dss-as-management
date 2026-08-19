import {
  BILLING_TYPE_CODES,
  PRIORITY_CODES,
  PRODUCT_CATEGORY_OPTIONS,
  REPAIR_STATUS_CODES,
  type BillingType,
  type Priority,
  type RepairStatus,
} from "./types";
import type { EffectiveRepairCase } from "./local/workflow/effective-repair-case";

/**
 * ── 워크플로 유형 대신 제품군 + 유·무상 ─────────────────────────────────
 * 예전에는 workflowType 하나로 걸렀다. 그런데 그 값은 제품군과 유·무상을
 * 붙여 놓은 것이라("유상 Generator"), 제품군만 보고 싶은 사람도 유·무상별로
 * 두 번 골라야 했고 반대도 마찬가지였다. 게다가 유·무상은 migration 0021로
 * workflowType과 무관한 독립 컬럼이 되었으므로(types.ts의 BILLING_TYPE_CODES
 * 주석) 둘을 한 값으로 묶어 두는 것 자체가 더는 맞지 않는다.
 *
 * 그래서 둘로 나눴다. 표현력은 오히려 늘었다 — 예전의 "유상 Generator"는
 * 제품군 Generator + 유상으로 그대로 되고, 예전에는 못 하던 "유상인 것 전부"와
 * "Generator 전부"가 새로 된다. workflowType으로 들어오는 딥링크는 대시보드를
 * 포함해 한 군데도 없어서(2026-08-19 확인) 끊어질 링크도 없다.
 */
export type Filters = {
  query: string;
  status: "ALL" | RepairStatus;
  /** productCategoryLabels가 만든 표시 문구("Generator" 등)와 그대로 비교한다. */
  productCategory: "ALL" | string;
  /** "NONE"은 유·무상이 아직 정해지지 않은 건만 — 표에 "-"로 나오는 그것이다. */
  billingType: "ALL" | "NONE" | BillingType;
  customerId: "ALL" | string;
  priority: "ALL" | Priority;
  overdueOnly: boolean;
  /** "YYYY-MM" 형식. 유효하지 않으면 null로 취급한다. */
  shipmentMonth: string | null;
};

export const DEFAULT_FILTERS: Filters = {
  query: "",
  status: "ALL",
  productCategory: "ALL",
  billingType: "ALL",
  customerId: "ALL",
  priority: "ALL",
  overdueOnly: false,
  shipmentMonth: null,
};

const SHIPMENT_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidShipmentMonth(value: string | null | undefined): value is string {
  return typeof value === "string" && SHIPMENT_MONTH_PATTERN.test(value);
}

export function formatShipmentMonthLabel(month: string): string {
  const [year, monthPart] = month.split("-");
  return `${year}년 ${Number(monthPart)}월`;
}

/**
 * URLSearchParams로부터 초기 필터 상태를 만든다. 값이 허용된 코드 목록과
 * 일치하지 않으면 안전하게 기본값("ALL"/false/null)으로 무시한다 —
 * 서명 없는 쿼리스트링을 그대로 신뢰하지 않는다.
 */
export function parseInitialFilters(searchParams: URLSearchParams): Filters {
  const status = searchParams.get("status");
  const productCategory = searchParams.get("productCategory");
  const billingType = searchParams.get("billingType");
  const customerId = searchParams.get("customerId");
  const priority = searchParams.get("priority");
  const overdue = searchParams.get("overdue");
  const shipmentMonth = searchParams.get("shipmentMonth");

  return {
    query: "",
    status:
      status && (REPAIR_STATUS_CODES as readonly string[]).includes(status)
        ? (status as RepairStatus)
        : "ALL",
    productCategory:
      productCategory && PRODUCT_CATEGORY_OPTIONS.includes(productCategory) ? productCategory : "ALL",
    billingType:
      billingType === "NONE" || (billingType && (BILLING_TYPE_CODES as readonly string[]).includes(billingType))
        ? (billingType as "NONE" | BillingType)
        : "ALL",
    customerId: customerId ?? "ALL",
    priority:
      priority && (PRIORITY_CODES as readonly string[]).includes(priority)
        ? (priority as Priority)
        : "ALL",
    overdueOnly: overdue === "1" || overdue === "true",
    shipmentMonth: isValidShipmentMonth(shipmentMonth) ? shipmentMonth : null,
  };
}

function matchesQuery(row: EffectiveRepairCase, query: string): boolean {
  const haystack = [
    row.intakeNumber,
    row.customerName,
    row.endUserName,
    row.modelName,
    row.serialNumber,
    row.engineerName,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function matchesShipmentMonth(row: EffectiveRepairCase, month: string): boolean {
  if (row.effectiveStatus !== "SHIPMENT_COMPLETED" || !row.effectiveActualShipmentDate) {
    return false;
  }
  return row.effectiveActualShipmentDate.slice(0, 7) === month;
}

/**
 * Stage E-1부터는 원본 status/isOverdue/actualShipmentDate가 아니라
 * effectiveStatus/effectiveIsOverdue/effectiveActualShipmentDate로 필터링한다
 * — 워크플로 재정의가 있으면 그 결과가, 없으면 원본과 동일한 값이 반영된다.
 */
export function applyFilters(rows: EffectiveRepairCase[], filters: Filters): EffectiveRepairCase[] {
  const query = filters.query.trim().toLowerCase();

  return rows.filter((row) => {
    if (filters.status !== "ALL" && row.effectiveStatus !== filters.status) return false;
    if (filters.productCategory !== "ALL" && row.productCategory !== filters.productCategory) return false;
    // 유·무상이 안 정해진 건(billingType === null)은 "미지정"을 고를 때만 남는다.
    // 어느 한쪽으로 추측해 넣지 않는다 — 표에도 "-"로 그대로 적는 값이다.
    if (filters.billingType === "NONE" && row.billingType !== null) return false;
    if (filters.billingType !== "ALL" && filters.billingType !== "NONE" && row.billingType !== filters.billingType) {
      return false;
    }
    if (filters.customerId !== "ALL" && row.customerId !== filters.customerId) return false;
    if (filters.priority !== "ALL" && row.priority !== filters.priority) return false;
    if (filters.overdueOnly && !row.effectiveIsOverdue) return false;
    if (filters.shipmentMonth && !matchesShipmentMonth(row, filters.shipmentMonth)) return false;
    if (query && !matchesQuery(row, query)) return false;
    return true;
  });
}

export type SortColumn =
  | "intakeNumber"
  | "receivedAt"
  | "customerName"
  | "status"
  | "priority"
  | "customerRequestedDueDate";

export type SortDirection = "asc" | "desc";

export type SortState = {
  column: SortColumn;
  direction: SortDirection;
};

function compareNullableString(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a.localeCompare(b);
}

export function sortRows(rows: EffectiveRepairCase[], sort: SortState): EffectiveRepairCase[] {
  const sorted = [...rows].sort((a, b) => {
    switch (sort.column) {
      case "intakeNumber":
        return a.intakeNumber.localeCompare(b.intakeNumber);
      case "receivedAt":
        return a.receivedAt.localeCompare(b.receivedAt);
      case "customerName":
        return a.customerName.localeCompare(b.customerName);
      case "status":
        return REPAIR_STATUS_CODES.indexOf(a.effectiveStatus) - REPAIR_STATUS_CODES.indexOf(b.effectiveStatus);
      case "priority":
        return PRIORITY_CODES.indexOf(a.priority) - PRIORITY_CODES.indexOf(b.priority);
      case "customerRequestedDueDate":
        return compareNullableString(a.customerRequestedDueDate, b.customerRequestedDueDate);
      default:
        return 0;
    }
  });

  return sort.direction === "asc" ? sorted : sorted.reverse();
}

export type PaginationState = {
  page: number;
  pageSize: number;
};

export function paginate<T>(rows: T[], pagination: PaginationState): T[] {
  const start = (pagination.page - 1) * pagination.pageSize;
  return rows.slice(start, start + pagination.pageSize);
}
