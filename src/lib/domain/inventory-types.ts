/**
 * Client-safe mirror of the inventory Postgres enums
 * (src/lib/db/schema/inventory.ts) — same convention as
 * PROCEDURE_NODE_TYPE_CODES in procedure-template-types.ts /
 * PROCEDURE_CASE_EXECUTION_NODE_STATUS_CODES in
 * procedure-case-execution-types.ts. Grounded in the Phase 5B-1 workbook
 * audit: exactly 4 real ownership values and 3 workbook-proven transaction
 * types — no ADJUSTMENT/TRANSFER/OWNER_TRANSFER/DISPOSAL/RECOVERY/
 * PURCHASE_RECEIPT, none of which appeared as an evidenced pattern in the
 * real workbook. Do not add speculatively.
 */

export const STOCK_OWNER_CODES = ["DSS", "KYOSAN", "SERVICE_SPARE", "TEST"] as const;
export type StockOwner = (typeof STOCK_OWNER_CODES)[number];
export const stockOwnerLabels: Record<StockOwner, string> = {
  DSS: "DSS",
  KYOSAN: "교산",
  SERVICE_SPARE: "보수부재",
  TEST: "TEST용",
};

/**
 * Parts Request 소유구분 checkpoint — inventory_part_request_items.owner is
 * nullable (migration 0024) and deliberately never backfilled: every
 * request item created before this checkpoint stays NULL forever. Every
 * display surface must use this helper (never stockOwnerLabels[owner]
 * directly on a possibly-null value) so "미지정" is the single canonical
 * rendering of that historical NULL, never a guessed owner.
 */
export function stockOwnerLabelOrUnspecified(owner: StockOwner | null): string {
  return owner ? stockOwnerLabels[owner] : "미지정";
}

/**
 * Parts Request 소유구분-scoped availability checkpoint — looks up a single
 * (partId, owner) cell out of the per-part-per-owner availability map (see
 * getPartOwnerAvailability's doc comment for how that map is built: SUM of
 * part_stock_balances.current_quantity across every location bucket for
 * that exact part+owner pair, the same aggregate already used everywhere
 * else, just grouped one level finer).
 *
 * Returns null when no owner is selected yet — callers must render a
 * neutral prompt in that case, never an all-owner total. Returns 0 (never
 * null) when an owner IS selected but no balance row exists for that
 * (partId, owner) pair — a real, displayable "nothing here" answer, not an
 * "unknown" state.
 */
export function ownerScopedAvailability(
  byPartId: Record<string, Partial<Record<StockOwner, number>>>,
  partId: string,
  owner: StockOwner | ""
): number | null {
  if (!owner) return null;
  return byPartId[partId]?.[owner] ?? 0;
}

/**
 * Pure reshape of a flat (partId, owner, quantity) row list — as returned by
 * getPartOwnerAvailability — into a lookup map. Kept here (framework-free,
 * no "server-only") rather than in the query module itself so it stays
 * unit-testable in the fast suite; shared by every caller (Parts Request
 * creation form, 재고관리 list) so the grouping logic exists exactly once.
 * A missing (partId, owner) key means 0, never "unknown".
 */
export function groupPartOwnerAvailability(
  rows: { partId: string; owner: StockOwner; quantity: number }[]
): Record<string, Partial<Record<StockOwner, number>>> {
  const byPartId: Record<string, Partial<Record<StockOwner, number>>> = {};
  for (const row of rows) {
    (byPartId[row.partId] ??= {})[row.owner] = row.quantity;
  }
  return byPartId;
}

export const STOCK_TRANSACTION_TYPE_CODES = ["RECEIPT", "USE", "RETURN"] as const;
export type StockTransactionType = (typeof STOCK_TRANSACTION_TYPE_CODES)[number];
export const stockTransactionTypeLabels: Record<StockTransactionType, string> = {
  RECEIPT: "입고",
  USE: "사용",
  RETURN: "반환",
};

/**
 * Phase 5B-3 — Parts Request & Issue Workflow. Client-safe mirror of
 * src/lib/db/schema/inventory-part-requests.ts's enums. Exactly the 6
 * approved statuses (no purchasing/backorder, no item-level reject) — see
 * inventory-part-request-rules.ts for the transition function.
 */
export const INVENTORY_PART_REQUEST_STATUS_CODES = [
  "PENDING",
  "PARTIALLY_ISSUED",
  "FULLY_ISSUED",
  "PARTIALLY_CLOSED",
  "REJECTED",
  "CANCELLED",
  // 보류(2026-08-19 승인) — 종료 상태가 아니다. 관리자가 "지금은 처리하지
  // 않는다"고 표시해 둔 중간 상태이고, 해제하면 보류 직전 상태로 돌아간다.
  "ON_HOLD",
] as const;
export type InventoryPartRequestStatus = (typeof INVENTORY_PART_REQUEST_STATUS_CODES)[number];
export const inventoryPartRequestStatusLabels: Record<InventoryPartRequestStatus, string> = {
  PENDING: "요청 대기",
  PARTIALLY_ISSUED: "일부 불출",
  FULLY_ISSUED: "불출 완료",
  PARTIALLY_CLOSED: "부분 불출 종료",
  REJECTED: "거절",
  CANCELLED: "취소",
  ON_HOLD: "보류",
};

export const INVENTORY_PART_REQUEST_TERMINAL_STATUSES: readonly InventoryPartRequestStatus[] = [
  "FULLY_ISSUED",
  "PARTIALLY_CLOSED",
  "REJECTED",
  "CANCELLED",
];

export const INVENTORY_PART_REQUEST_ACTION_TYPE_CODES = [
  "SUBMITTED",
  "ISSUED",
  "REJECTED",
  "CANCELLED",
  "PARTIALLY_CLOSED",
  "HELD",
  "HOLD_RELEASED",
] as const;
export type InventoryPartRequestActionType = (typeof INVENTORY_PART_REQUEST_ACTION_TYPE_CODES)[number];
export const inventoryPartRequestActionTypeLabels: Record<InventoryPartRequestActionType, string> = {
  SUBMITTED: "요청 제출",
  ISSUED: "불출",
  REJECTED: "거절",
  CANCELLED: "취소",
  PARTIALLY_CLOSED: "부분 불출 종료",
  HELD: "보류",
  HOLD_RELEASED: "보류 해제",
};

export const INVENTORY_PART_REQUEST_IDEMPOTENCY_OPERATION_CODES = [
  "CREATE_REQUEST",
  "ISSUE",
  "CANCEL",
  "REJECT",
  "PARTIALLY_CLOSE",
  "HOLD",
  "RELEASE_HOLD",
] as const;
export type InventoryPartRequestIdempotencyOperation = (typeof INVENTORY_PART_REQUEST_IDEMPOTENCY_OPERATION_CODES)[number];
