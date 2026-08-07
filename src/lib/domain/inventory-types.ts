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
] as const;
export type InventoryPartRequestStatus = (typeof INVENTORY_PART_REQUEST_STATUS_CODES)[number];
export const inventoryPartRequestStatusLabels: Record<InventoryPartRequestStatus, string> = {
  PENDING: "요청 대기",
  PARTIALLY_ISSUED: "일부 불출",
  FULLY_ISSUED: "불출 완료",
  PARTIALLY_CLOSED: "부분 불출 종료",
  REJECTED: "거절",
  CANCELLED: "취소",
};

export const INVENTORY_PART_REQUEST_TERMINAL_STATUSES: readonly InventoryPartRequestStatus[] = [
  "FULLY_ISSUED",
  "PARTIALLY_CLOSED",
  "REJECTED",
  "CANCELLED",
];

export const INVENTORY_PART_REQUEST_ACTION_TYPE_CODES = ["SUBMITTED", "ISSUED", "REJECTED", "CANCELLED", "PARTIALLY_CLOSED"] as const;
export type InventoryPartRequestActionType = (typeof INVENTORY_PART_REQUEST_ACTION_TYPE_CODES)[number];
export const inventoryPartRequestActionTypeLabels: Record<InventoryPartRequestActionType, string> = {
  SUBMITTED: "요청 제출",
  ISSUED: "불출",
  REJECTED: "거절",
  CANCELLED: "취소",
  PARTIALLY_CLOSED: "부분 불출 종료",
};

export const INVENTORY_PART_REQUEST_IDEMPOTENCY_OPERATION_CODES = [
  "CREATE_REQUEST",
  "ISSUE",
  "CANCEL",
  "REJECT",
  "PARTIALLY_CLOSE",
] as const;
export type InventoryPartRequestIdempotencyOperation = (typeof INVENTORY_PART_REQUEST_IDEMPOTENCY_OPERATION_CODES)[number];
