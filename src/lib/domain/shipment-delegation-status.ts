/**
 * Read-only, UI-facing lifecycle label — never stored (see
 * shipment-approval-delegations.ts's schema comment on why EXPIRED is never
 * persisted). "SCHEDULED" is this codebase's own addition beyond
 * ACTIVE/EXPIRED/REVOKED, needed because a not-yet-started ACTIVE row is
 * neither currently approvable nor "expired" — the admin UI needs to tell
 * those apart.
 *
 * Deliberately has no "server-only" import and no DB dependency (unlike
 * src/lib/db/queries/shipment-delegations.ts) so client components can call
 * it directly without pulling the postgres client into the browser bundle.
 */
export type ShipmentDelegationDisplayStatus = "ACTIVE" | "SCHEDULED" | "EXPIRED" | "REVOKED";

export function deriveDelegationDisplayStatus(
  row: { status: "ACTIVE" | "REVOKED"; startsAt: string; endsAt: string },
  nowMs: number = Date.now()
): ShipmentDelegationDisplayStatus {
  if (row.status === "REVOKED") return "REVOKED";
  const starts = new Date(row.startsAt).getTime();
  const ends = new Date(row.endsAt).getTime();
  if (nowMs < starts) return "SCHEDULED";
  if (nowMs > ends) return "EXPIRED";
  return "ACTIVE";
}
