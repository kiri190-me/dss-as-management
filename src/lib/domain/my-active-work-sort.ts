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
