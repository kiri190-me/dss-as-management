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
