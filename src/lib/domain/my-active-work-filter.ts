import type { MyActiveWorkRow } from "@/lib/db/queries/repair-cases-mine";
import type { RepairStatus } from "./types";

/**
 * Phase 5C-3 — client-side filtering for My Active Work, applied only
 * after the server has already restricted rows to the authenticated
 * engineer's own non-shipment-completed cases (see repair-cases-mine.ts).
 * Search fields match the approved brief exactly: intake number, customer,
 * End-User, model, S/N, L/N — no engineer/priority/exception/date fields.
 *
 * Type/default live here (domain layer), not in the UI component, matching
 * the established repair-case-filters.ts convention (Filters/DEFAULT_
 * FILTERS owned by domain, consumed by RepairCaseFilters.tsx).
 */
export type MyWorkFilterState = {
  query: string;
  status: "ALL" | RepairStatus;
};

export const DEFAULT_MY_WORK_FILTERS: MyWorkFilterState = { query: "", status: "ALL" };

export function applyMyWorkFilters(rows: MyActiveWorkRow[], filters: MyWorkFilterState): MyActiveWorkRow[] {
  const query = filters.query.trim().toLowerCase();

  return rows.filter((row) => {
    if (filters.status !== "ALL" && row.status !== filters.status) return false;
    if (query && !matchesQuery(row, query)) return false;
    return true;
  });
}

function matchesQuery(row: MyActiveWorkRow, query: string): boolean {
  const haystack = [row.intakeNumber, row.customerName, row.endUserName, row.modelName, row.serialNumber, row.lotNumber]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}
