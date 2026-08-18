import type { MyActiveWorkRow } from "@/lib/db/queries/repair-cases-mine";
import type { ExceptionStatus, RepairStatus } from "./types";

/**
 * "내 담당 제품"의 클라이언트 필터. 서버가 이미 로그인한 엔지니어 본인의
 * 미출하 건으로 좁혀 준 목록에만 적용된다(repair-cases-mine.ts).
 *
 * 검색 대상 필드는 브리프대로 인수번호/고객사/End-User/모델/S/N/L/N이다.
 *
 * ── 2026-08-19: 전체 A/S 현황과 같은 모양으로 ─────────────────────────────
 * 검색 하나만 있던 것을 그쪽 필터 카드와 같은 구성(검색 + 선택 항목 격자)으로
 * 맞추면서 제품 구분·고객사·예외 상태를 더했다. 셋 다 이 화면이 이미 열로
 * 보여 주던 값이라, 보이는 것을 그대로 좁힐 수 있게 된 것뿐이다.
 *
 * **우선순위는 넣지 않는다.** 전체 A/S 현황에는 있지만 DB 모드 접수 건에는
 * 실제 우선순위 데이터가 없어(Phase 5C-3 감사 §13) 언제나 빈 필터가 된다 —
 * 이 화면이 처음부터 우선순위를 한 글자도 보여 주지 않는 이유와 같다.
 * 납기 지연 필터도 뺐다: 이 화면에는 지연 여부를 판정하는 값이 없고(그쪽의
 * effectiveIsOverdue는 클라이언트 데모 레이어에서 온다), 대신 이 화면 고유의
 * 예외 상태가 같은 자리를 맡는다.
 */
export type MyWorkFilterState = {
  query: string;
  status: "ALL" | RepairStatus;
  /** productCategoryLabels로 만들어진 표시 문자열("Generator" 등)과 그대로 비교한다. */
  productCategory: "ALL" | string;
  customerId: "ALL" | string;
  /** "NONE"은 예외 상태가 없는 건만 — 정상 진행 중인 것만 훑을 때 쓴다. */
  exceptionStatus: "ALL" | "NONE" | ExceptionStatus;
};

export const DEFAULT_MY_WORK_FILTERS: MyWorkFilterState = {
  query: "",
  status: "ALL",
  productCategory: "ALL",
  customerId: "ALL",
  exceptionStatus: "ALL",
};

export function applyMyWorkFilters(rows: MyActiveWorkRow[], filters: MyWorkFilterState): MyActiveWorkRow[] {
  const query = filters.query.trim().toLowerCase();

  return rows.filter((row) => {
    if (filters.status !== "ALL" && row.status !== filters.status) return false;
    if (filters.productCategory !== "ALL" && row.productCategory !== filters.productCategory) return false;
    if (filters.customerId !== "ALL" && row.customerId !== filters.customerId) return false;
    if (filters.exceptionStatus === "NONE" && row.exceptionStatus !== null) return false;
    if (
      filters.exceptionStatus !== "ALL" &&
      filters.exceptionStatus !== "NONE" &&
      row.exceptionStatus !== filters.exceptionStatus
    ) {
      return false;
    }
    if (query && !matchesQuery(row, query)) return false;
    return true;
  });
}

/**
 * 선택 항목은 **지금 담당하고 있는 건에 실제로 있는 값**만 만든다. 전체 A/S
 * 현황은 고객사/워크플로 전체 목록을 그대로 늘어놓지만, 이 화면은 한 사람의
 * 담당 건이라 전체 목록을 두면 거의 모든 항목이 "고르면 0건"이 된다.
 */
export function collectMyWorkFilterOptions(rows: MyActiveWorkRow[]): {
  productCategories: string[];
  customers: { id: string; name: string }[];
  exceptionStatuses: ExceptionStatus[];
} {
  const productCategories = [...new Set(rows.map((row) => row.productCategory))].sort((a, b) => a.localeCompare(b));

  const customerById = new Map<string, string>();
  for (const row of rows) customerById.set(row.customerId, row.customerName);
  const customers = [...customerById.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const exceptionStatuses = [
    ...new Set(rows.map((row) => row.exceptionStatus).filter((value): value is ExceptionStatus => value !== null)),
  ].sort((a, b) => a.localeCompare(b));

  return { productCategories, customers, exceptionStatuses };
}

function matchesQuery(row: MyActiveWorkRow, query: string): boolean {
  const haystack = [row.intakeNumber, row.customerName, row.endUserName, row.modelName, row.serialNumber, row.lotNumber]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}
