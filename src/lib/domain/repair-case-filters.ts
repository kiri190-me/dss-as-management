import {
  BILLING_TYPE_CODES,
  PRIORITY_CODES,
  PRODUCT_CATEGORY_OPTIONS,
  REPAIR_STATUS_CODES,
  type BillingType,
  type Customer,
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
  /**
   * 내게 결재 요청이 들어온 건만 보기. 다른 조건과 달리 **행 자체에는 판정
   * 근거가 없다** — "내게 온 결재 요청"은 워크플로 전이의 승인 요건 + 아직
   * 결정되지 않은 결재 요청 기록 + 로그인한 사용자의 결재 권한으로 서버가
   * 계산하는 값이라(queries/repair-case-approvals-pending.ts), 화면은 서버가
   * 내려준 접수 건 id 집합과 대조만 한다. 그 집합이 없으면(mock 모드 등) 이
   * 조건은 아무것도 남기지 않는다 — 근거 없이 전부 통과시키면 "내게 온 결재
   * 요청"이라는 이름이 거짓이 된다.
   */
  myPendingApprovalOnly: boolean;
  /**
   * 장기 PO 미발행 건만 보기 — 견적서를 낸 지 두 달이 지나도록 발주가 나지
   * 않은 건이다(domain/long-pending-po.ts 가 규칙의 유일한 자리).
   *
   * myPendingApprovalOnly 와 같은 종류의 조건이다: **행 자체에는 판정 근거가
   * 없다.** 견적일·발주일은 접수 건이 아니라 그 건에 붙은 내자 줄(여럿일 수
   * 있다)에 있고, "오늘"도 서버가 정하는 한국 날짜라(화면이 new Date() 로
   * 만들면 서버가 그린 것과 어긋난다) 화면은 서버가 내려준 접수 건 id 집합과
   * 대조만 한다. 그 집합이 없으면(mock 모드 등) 이 조건은 아무것도 남기지
   * 않는다 — 근거 없이 전부 통과시키면 필터 이름이 거짓이 된다.
   */
  longPendingPoOnly: boolean;
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
  myPendingApprovalOnly: false,
  longPendingPoOnly: false,
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
  // 사이드바 배지가 거는 딥링크(/repair-cases?myApproval=1)가 들어오는 자리다.
  const myApproval = searchParams.get("myApproval");
  const longPendingPo = searchParams.get("longPendingPo");

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
    myPendingApprovalOnly: myApproval === "1" || myApproval === "true",
    longPendingPoOnly: longPendingPo === "1" || longPendingPo === "true",
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
export function applyFilters(
  rows: EffectiveRepairCase[],
  filters: Filters,
  /**
   * 서버가 계산해 내려준 "내게 결재 요청이 들어온" 접수 건 id 집합
   * (queries/repair-case-approvals-pending.ts). 없으면 undefined —
   * myPendingApprovalOnly가 켜져 있어도 아무 행도 남기지 않는다.
   */
  myPendingApprovalCaseIds?: ReadonlySet<string>,
  /**
   * 서버가 계산해 내려준 "장기 PO 미발행" 접수 건 id 집합
   * (queries/long-pending-po.ts). 없으면 undefined —
   * longPendingPoOnly가 켜져 있어도 아무 행도 남기지 않는다.
   */
  longPendingPoCaseIds?: ReadonlySet<string>
): EffectiveRepairCase[] {
  const query = filters.query.trim().toLowerCase();

  return rows.filter((row) => {
    if (filters.myPendingApprovalOnly && !myPendingApprovalCaseIds?.has(row.id)) return false;
    if (filters.longPendingPoOnly && !longPendingPoCaseIds?.has(row.id)) return false;
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

/**
 * 고객사 필터의 선택지를 **지금 이 화면에 올라와 있는 접수 건에서** 뽑는다.
 *
 * 예전에는 mock-data.ts의 mockCustomers(데모 7곳)를 그대로 넘겼다. 실제 DB에는
 * 고객사가 그보다 훨씬 많아서, 목록에는 멀쩡히 보이는 접수 건의 고객사를 필터에서는
 * 고를 수 없었다. 목록과 별개인 고객사 명단을 들고 있는 한 언젠가는 다시 어긋난다 —
 * 그래서 내 담당 제품 화면(my-active-work-filter.ts의 collectMyWorkFilterOptions)과
 * 같은 결로, 목록 자체에서 뽑아 "목록에 있으면 필터에도 있다"를 구조로 보장한다.
 *
 * 넘길 배열은 **필터를 걸기 전의 전체 목록**이어야 한다. 거른 뒤(또는 페이지를 나눈
 * 뒤)의 배열에서 뽑으면 고객사를 하나 고르는 순간 나머지가 선택지에서 사라져
 * 되돌아갈 수 없고, 검색어를 함께 걸면 지금 골라 둔 고객사마저 사라진다. 전체
 * 목록에서 뽑으면 선택지가 필터 상태와 무관해지므로 그 두 문제가 아예 생기지 않는다.
 *
 * 반환 타입이 Customer인 것은 RepairCaseFilters의 customers prop에 맞춘 것이다.
 * 접수 건 행에는 고객사 연락처가 없으므로(행의 contact*는 그 **접수 건**의 연락
 * 담당자이지 고객사 마스터가 아니다) 연락처 세 칸은 빈 문자열로 둔다 — 필터
 * <select>는 id와 name만 읽는다. 여기서 나온 객체를 연락처 용도로 쓰면 안 된다.
 *
 * 빈 값 규칙:
 * - customerId가 비어 있는 행은 건너뛴다. <option value="">는 "고르지 않음"과
 *   구분되지 않고, applyFilters가 ===로 맞출 값도 되지 못한다. 타입상으로는
 *   customerId가 반드시 있는 string이지만, 이 함수는 화면에 실제로 떠 있는 값을
 *   그대로 받으므로 방어한다.
 * - 이름이 비어 있으면 id를 대신 적는다. 그 행을 버리지 않는 이유는, 그 고객사의
 *   접수 건이 목록에는 그대로 보이기 때문이다 — 필터에서만 빠지면 방금 고친 이
 *   고장(목록 ≠ 필터)이 그대로 되풀이된다. 이름 없는 한 줄이라도 있어야 고르고
 *   되돌릴 수 있다.
 */
export function collectCustomerFilterOptions(rows: EffectiveRepairCase[]): Customer[] {
  const nameById = new Map<string, string>();

  for (const row of rows) {
    const id = row.customerId.trim();
    if (!id) continue;
    const name = row.customerName.trim();
    // 같은 고객사가 여러 행에 나오면 이름이 적혀 있는 쪽을 남긴다.
    if (name) nameById.set(id, name);
    else if (!nameById.has(id)) nameById.set(id, id);
  }

  return [...nameById.entries()]
    .map(([id, name]) => ({ id, name, contactName: "", contactEmail: "", contactPhone: "" }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
