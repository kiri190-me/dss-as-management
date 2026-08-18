import type { MyActiveWorkRow } from "@/lib/db/queries/repair-cases-mine";

/**
 * Phase 5C-3 default sort for "내 담당 제품": nearest internal shipment
 * target first, then older intake first, with a deterministic final
 * tie-break. Deliberately does not use priority — see the Phase 5C-3 audit
 * (§13): repair_cases has no real priority data for database-mode cases,
 * so sorting by it would silently degenerate into a no-op.
 *
 * 1. internalTargetShipmentDate ascending, nulls last (soonest target
 *    first; a case with no target date at all is not more urgent than one
 *    that has one).
 * 2. receivedAt ascending (older intake first) as the first tie-break.
 * 3. intakeNumber ascending as the final, always-deterministic tie-break —
 *    two rows never compare equal.
 */
export function sortMyActiveWorkRows(rows: MyActiveWorkRow[]): MyActiveWorkRow[] {
  return [...rows].sort((a, b) => {
    const targetCompare = compareNullableDateString(a.internalTargetShipmentDate, b.internalTargetShipmentDate);
    if (targetCompare !== 0) return targetCompare;

    const receivedCompare = a.receivedAt.localeCompare(b.receivedAt);
    if (receivedCompare !== 0) return receivedCompare;

    return a.intakeNumber.localeCompare(b.intakeNumber);
  });
}

function compareNullableDateString(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1; // nulls last
  if (b === null) return -1;
  return a.localeCompare(b);
}

/**
 * ============================================================================
 * 열 머리글 정렬 (2026-08-19 — 전체 A/S 현황과 같은 모양으로)
 * ============================================================================
 * 그쪽 목록은 머리글을 눌러 정렬할 수 있고, 이 화면은 그럴 수 없었다.
 *
 * "default"를 열 하나로 둔 것이 이 설계의 핵심이다. 위 sortMyActiveWorkRows의
 * 급한 순서(목표 출하일 가까운 순)는 이 화면이 처음부터 갖고 있던 기본값이고,
 * 정렬을 붙이면서 그것을 잃으면 화면의 성격이 바뀐다 — 담당자가 열자마자
 * "먼저 할 것"이 위에 있어야 한다. 그래서 아무 머리글도 누르지 않은 상태가
 * 곧 예전 동작이고, 머리글을 누르면 그때부터 그 열로 정렬한다.
 *
 * 우선순위 열은 없다(위 주석과 my-active-work-filter.ts 참조).
 * ============================================================================
 */
export type MyWorkSortColumn =
  | "default"
  | "intakeNumber"
  | "receivedAt"
  | "customerName"
  | "status"
  | "internalTargetShipmentDate"
  | "customerRequestedDueDate";

export type MyWorkSortState = { column: MyWorkSortColumn; direction: "asc" | "desc" };

export const DEFAULT_MY_WORK_SORT: MyWorkSortState = { column: "default", direction: "asc" };

export function sortMyActiveWorkRowsBy(rows: MyActiveWorkRow[], sort: MyWorkSortState): MyActiveWorkRow[] {
  if (sort.column === "default") return sortMyActiveWorkRows(rows);

  // 값이 같은 행끼리도 순서가 흔들리지 않도록 인수번호로 마지막 매듭을 짓는다.
  const withTieBreak = [...rows].sort((a, b) => {
    const primary = comparePrimary(a, b, sort.column);
    if (primary !== 0) return primary;
    return a.intakeNumber.localeCompare(b.intakeNumber);
  });

  // 널은 방향과 무관하게 늘 뒤에 둔다 — "값 없음"이 가장 급한 건으로 올라오면
  // 목록 맨 위가 정보 없는 행으로 채워진다.
  if (sort.direction === "desc") {
    const hasValue = withTieBreak.filter((row) => primaryValue(row, sort.column) !== null);
    const noValue = withTieBreak.filter((row) => primaryValue(row, sort.column) === null);
    return [...hasValue.reverse(), ...noValue];
  }
  return withTieBreak;
}

function primaryValue(row: MyActiveWorkRow, column: MyWorkSortColumn): string | null {
  switch (column) {
    case "intakeNumber":
      return row.intakeNumber;
    case "receivedAt":
      return row.receivedAt;
    case "customerName":
      return row.customerName;
    case "status":
      return row.status;
    case "internalTargetShipmentDate":
      return row.internalTargetShipmentDate;
    case "customerRequestedDueDate":
      return row.customerRequestedDueDate;
    default:
      return null;
  }
}

function comparePrimary(a: MyActiveWorkRow, b: MyActiveWorkRow, column: MyWorkSortColumn): number {
  const left = primaryValue(a, column);
  const right = primaryValue(b, column);
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.localeCompare(right);
}
