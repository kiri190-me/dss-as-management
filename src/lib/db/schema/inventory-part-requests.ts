import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { repairCases } from "./repair-cases";
import { parts } from "./inventory";
import { stockOwnerEnum } from "./inventory-enums";
import { users } from "./users";

/**
 * Phase 5B-3 — Parts Request & Issue Workflow. AS_ENGINEER no longer
 * decrements stock directly; they submit a request (part + quantity against
 * their assigned repair case), and an inventory-privileged role later
 * confirms an actual issue, which is what creates the real stock_transactions
 * USE row(s) (see stockTransactions.requestItemId/requestIssueId in
 * ./inventory.ts). Request submission never reserves or deducts stock.
 */
export const inventoryPartRequestStatusEnum = pgEnum("inventory_part_request_status", [
  "PENDING",
  "PARTIALLY_ISSUED",
  "FULLY_ISSUED",
  "PARTIALLY_CLOSED",
  "REJECTED",
  "CANCELLED",
]);

export const inventoryPartRequestActionTypeEnum = pgEnum("inventory_part_request_action_type", [
  "SUBMITTED",
  "ISSUED",
  "REJECTED",
  "CANCELLED",
  "PARTIALLY_CLOSED",
]);

export const inventoryPartRequestIdempotencyOperationEnum = pgEnum("inventory_part_request_idempotency_operation", [
  "CREATE_REQUEST",
  "ISSUE",
  "CANCEL",
  "REJECT",
  "PARTIALLY_CLOSE",
]);

/**
 * Reused from schema/idempotency-keys.ts — same PROCESSING/SUCCEEDED/FAILED
 * shape, but under Phase 5B-3's atomic claim design (see
 * db/mutations/internal/inventory-request-idempotency.ts) PROCESSING is only
 * ever visible inside the owning transaction and FAILED is never durably
 * written (a failed attempt rolls back its own claim row entirely) — this
 * is a deliberately stronger guarantee than the existing repair-case
 * idempotency table, not a weaker one.
 */
import { idempotencyKeyStatusEnum } from "./idempotency-keys";

/**
 * Request header. Mutable only in the ways documented on each column below —
 * there is no "edit request" mutation. A wrong PENDING request is cancelled
 * and recreated, never edited (keeps the audit model simple, per plan).
 */
export const inventoryPartRequests = pgTable(
  "inventory_part_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable, ON DELETE SET NULL (repair-case permanent-delete schema
    // foundation checkpoint) — was NOT NULL + RESTRICT, which made a
    // repair_cases hard-delete impossible at the DB level. This row (and
    // its child items/issues/history rows, none of which reference
    // repair_cases directly and are therefore entirely unaffected by this
    // column going NULL) is inventory-accounting-relevant and must outlive
    // the case's own hard-delete. Existing rows are untouched by this —
    // only a future repair_cases hard-delete ever nulls it. Same proven
    // pattern as repair_case_flowchart_edit_history.flowchart_id
    // (migration 0026).
    repairCaseId: uuid("repair_case_id").references(() => repairCases.id, {
      onDelete: "set null",
    }),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // System-mutable only — every transition goes through a mutation in
    // db/mutations/inventory-part-requests.ts, never an ordinary UI edit.
    status: inventoryPartRequestStatusEnum("status").notNull().default("PENDING"),
    // Set once at creation, never edited afterward (no edit-request feature).
    note: text("note"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("inventory_part_requests_repair_case_id_idx").on(table.repairCaseId),
    index("inventory_part_requests_requested_by_user_id_idx").on(table.requestedByUserId),
    index("inventory_part_requests_status_idx").on(table.status),
  ]
);

/**
 * Request line — part-based (plan §4): the engineer requests a PART, never a
 * specific owner/location *bucket*. The inventory manager still picks the
 * concrete part_stock_balances row (owner + location) at issue time (see
 * stockTransactions) — `owner` below is a request-time ownership
 * *preference* only, a separate, coarser concept from that issue-time
 * bucket choice. At most one line per part per request (UNIQUE below) —
 * createPartRequest merges duplicate part selections in the cart before
 * insert.
 *
 * requestedQuantity/partId are immutable after insert. issuedQuantity is a
 * cached, system-maintained-only projection — never an ordinary UI edit
 * target — mirroring part_stock_balances.currentQuantity's relationship to
 * stock_transactions: the authoritative issued amount is always
 * reconstructable as SUM(-quantity_delta) over stock_transactions rows
 * linked to this item via request_item_id. No ordinary delete path exists.
 *
 * `owner` — Parts Request 소유구분 checkpoint. Nullable at the DB level and
 * deliberately never backfilled/defaulted: every request item that existed
 * before this column was added stays NULL forever (displayed as "미지정"),
 * a truthful "we don't know" rather than a guessed value. NOT NULL is
 * enforced only at the application/server-validation layer for newly
 * created request items (see repair-case-work-record precedent's
 * "never guess" convention) — never a DB-level constraint, so historical
 * rows remain valid without any migration-time UPDATE.
 */
export const inventoryPartRequestItems = pgTable(
  "inventory_part_request_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => inventoryPartRequests.id, { onDelete: "restrict" }),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "restrict" }),
    requestedQuantity: integer("requested_quantity").notNull(),
    issuedQuantity: integer("issued_quantity").notNull().default(0),
    owner: stockOwnerEnum("owner"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("inventory_part_request_items_requested_quantity_positive", sql`${table.requestedQuantity} > 0`),
    check("inventory_part_request_items_issued_quantity_not_negative", sql`${table.issuedQuantity} >= 0`),
    check("inventory_part_request_items_issued_not_over_requested", sql`${table.issuedQuantity} <= ${table.requestedQuantity}`),
    uniqueIndex("inventory_part_request_items_request_part_unique").on(table.requestId, table.partId),
    index("inventory_part_request_items_part_id_idx").on(table.partId),
  ]
);

/**
 * One row per confirmed physical issue action (plan: "one manager
 * confirmation = one issue event"). Fully append-only — never
 * updated/deleted. A single issue event may span multiple request items and
 * multiple resulting stock_transactions USE rows (one per item×bucket
 * touched); those USE rows are the line-level record (they already carry
 * the concrete balance, quantity_delta, resulting_quantity) — no separate
 * issue-line table is added.
 */
export const inventoryPartRequestIssues = pgTable(
  "inventory_part_request_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => inventoryPartRequests.id, { onDelete: "restrict" }),
    issuedByUserId: uuid("issued_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("inventory_part_request_issues_request_id_idx").on(table.requestId),
    index("inventory_part_request_issues_created_at_idx").on(table.createdAt),
  ]
);

/**
 * Append-only lifecycle audit trail — separate from stock_transactions
 * (movement ledger) and from inventory_part_request_issues (physical-issue
 * grouping): this table records *why the request's status changed*, not
 * *what physically moved*. Every ISSUED row must reference the issue event
 * it narrates; no other action type may.
 */
export const inventoryPartRequestHistory = pgTable(
  "inventory_part_request_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => inventoryPartRequests.id, { onDelete: "restrict" }),
    requestIssueId: uuid("request_issue_id").references(() => inventoryPartRequestIssues.id, { onDelete: "restrict" }),
    actionType: inventoryPartRequestActionTypeEnum("action_type").notNull(),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    // Required (app + DB CHECK) for REJECTED/CANCELLED/PARTIALLY_CLOSED;
    // normally null for SUBMITTED/ISSUED (not DB-forbidden there, just
    // never set by application code).
    reason: text("reason"),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "inventory_part_request_history_issue_linkage_consistent",
      sql`(${table.actionType} = 'ISSUED') = (${table.requestIssueId} IS NOT NULL)`
    ),
    check(
      "inventory_part_request_history_reason_required_for_terminal_actions",
      sql`${table.actionType} NOT IN ('REJECTED', 'CANCELLED', 'PARTIALLY_CLOSED') OR (${table.reason} IS NOT NULL AND btrim(${table.reason}) <> '')`
    ),
    index("inventory_part_request_history_request_id_idx").on(table.requestId),
    index("inventory_part_request_history_created_at_idx").on(table.createdAt),
  ]
);

/**
 * Phase 5B-3's own idempotency table — deliberately separate from
 * repair_case_idempotency_keys (schema/idempotency-keys.ts), which is not
 * touched by this phase. Covers all 5 request-workflow mutations via
 * operationType. Under the atomic claim design (internal/
 * inventory-request-idempotency.ts) a row only ever durably exists as
 * SUCCEEDED (or not at all) — see that module's doc comment.
 */
export const inventoryPartRequestIdempotencyKeys = pgTable(
  "inventory_part_request_idempotency_keys",
  {
    idempotencyKey: uuid("idempotency_key").primaryKey(),
    requesterUserId: uuid("requester_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    operationType: inventoryPartRequestIdempotencyOperationEnum("operation_type").notNull(),
    status: idempotencyKeyStatusEnum("status").notNull().default("PROCESSING"),
    requestFingerprint: text("request_fingerprint").notNull(),
    requestId: uuid("request_id").references(() => inventoryPartRequests.id, { onDelete: "restrict" }),
    responseSnapshot: jsonb("response_snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("inventory_part_request_idempotency_keys_requester_user_id_idx").on(table.requesterUserId),
    index("inventory_part_request_idempotency_keys_expires_at_idx").on(table.expiresAt),
    check(
      "inventory_part_request_idempotency_keys_succeeded_has_request",
      sql`${table.status} <> 'SUCCEEDED' OR (${table.requestId} IS NOT NULL AND ${table.responseSnapshot} IS NOT NULL)`
    ),
  ]
);
