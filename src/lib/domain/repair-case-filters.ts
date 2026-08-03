import {
  PRIORITY_CODES,
  REPAIR_STATUS_CODES,
  WORKFLOW_TYPE_CODES,
  type Priority,
  type RepairStatus,
  type WorkflowType,
} from "./types";
import type { RepairCaseRow } from "./repair-case-rows";

export type Filters = {
  query: string;
  status: "ALL" | RepairStatus;
  workflowType: "ALL" | WorkflowType;
  customerId: "ALL" | string;
  priority: "ALL" | Priority;
  overdueOnly: boolean;
  /** "YYYY-MM" 형식. 유효하지 않으면 null로 취급한다. */
  shipmentMonth: string | null;
};

export const DEFAULT_FILTERS: Filters = {
  query: "",
  status: "ALL",
  workflowType: "ALL",
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
  const workflowType = searchParams.get("workflowType");
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
    workflowType:
      workflowType && (WORKFLOW_TYPE_CODES as readonly string[]).includes(workflowType)
        ? (workflowType as WorkflowType)
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

function matchesQuery(row: RepairCaseRow, query: string): boolean {
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

function matchesShipmentMonth(row: RepairCaseRow, month: string): boolean {
  if (row.status !== "SHIPMENT_COMPLETED" || !row.actualShipmentDate) {
    return false;
  }
  return row.actualShipmentDate.slice(0, 7) === month;
}

export function applyFilters(rows: RepairCaseRow[], filters: Filters): RepairCaseRow[] {
  const query = filters.query.trim().toLowerCase();

  return rows.filter((row) => {
    if (filters.status !== "ALL" && row.status !== filters.status) return false;
    if (filters.workflowType !== "ALL" && row.workflowType !== filters.workflowType) return false;
    if (filters.customerId !== "ALL" && row.customerId !== filters.customerId) return false;
    if (filters.priority !== "ALL" && row.priority !== filters.priority) return false;
    if (filters.overdueOnly && !row.isOverdue) return false;
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

export function sortRows(rows: RepairCaseRow[], sort: SortState): RepairCaseRow[] {
  const sorted = [...rows].sort((a, b) => {
    switch (sort.column) {
      case "intakeNumber":
        return a.intakeNumber.localeCompare(b.intakeNumber);
      case "receivedAt":
        return a.receivedAt.localeCompare(b.receivedAt);
      case "customerName":
        return a.customerName.localeCompare(b.customerName);
      case "status":
        return REPAIR_STATUS_CODES.indexOf(a.status) - REPAIR_STATUS_CODES.indexOf(b.status);
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
