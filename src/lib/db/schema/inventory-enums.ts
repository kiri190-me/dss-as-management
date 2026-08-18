import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Shared with both inventory.ts (part_stock_balances.owner) and
 * inventory-part-requests.ts (inventory_part_request_items.owner — Parts
 * Request 소유구분 checkpoint) — kept in its own dependency-free file so
 * neither of those two files' existing circular import (inventory.ts needs
 * inventory-part-requests.ts's tables for stock_transactions' deferred FK
 * thunks; inventory-part-requests.ts now also needs this enum directly,
 * non-deferred) triggers a module-evaluation-order TDZ error. Grounded in
 * the Phase 5B-1 workbook audit: exactly 4 real ownership values — see
 * inventory.ts's own doc comment for the full rationale. Never add values
 * speculatively.
 */
export const stockOwnerEnum = pgEnum("stock_owner", ["DSS", "KYOSAN", "SERVICE_SPARE", "TEST"]);
