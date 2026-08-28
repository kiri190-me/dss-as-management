import { sql } from "drizzle-orm";
import {
  boolean,
  numeric,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { repairCases } from "./repair-cases";
import { procedureCaseExecutionNodes } from "./procedure-case-execution";
import { users } from "./users";
import { inventoryPartRequestItems, inventoryPartRequestIssues } from "./inventory-part-requests";
import { stockOwnerEnum } from "./inventory-enums";

export { stockOwnerEnum };

/**
 * Phase 5B-2 — core inventory ledger. Grounded in the Phase 5B-1 audit of
 * the real DSS inventory workbook: part identity has no reliable single
 * key (no unique constraint here, deliberately); stock ownership and
 * location are dimensions of a stock *bucket*, never part identity;
 * current stock is `sum of immutable stock_transactions`, never an
 * Excel-style before/after column; RECEIPT/USE/RETURN are the only
 * workbook-proven transaction types (no ADJUSTMENT/TRANSFER/
 * OWNER_TRANSFER/DISPOSAL/RECOVERY/PURCHASE_RECEIPT — none evidenced, all
 * deferred); RETURN always reverses a specific prior USE. stockOwnerEnum
 * itself now lives in ./inventory-enums.ts (re-exported here unchanged) —
 * see that file's doc comment for why.
 */
export const stockTransactionTypeEnum = pgEnum("stock_transaction_type", ["RECEIPT", "USE", "RETURN"]);

/**
 * Part master. Deliberately no `수식용 도번` (confirmed spreadsheet
 * formula plumbing, not a business field) and no unique constraint on any
 * field or combination — the workbook audit found no reliable identity
 * key (품명/품명2/교산 품번/도번 are all independently, inconsistently
 * populated), and inventing one now would misrepresent the real business
 * data. Duplicate prevention in Phase 5B-2 is UI-side search/autocomplete
 * only, not a DB constraint.
 */
export const parts = pgTable(
  "parts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partName: text("part_name").notNull(), // 품명
    partSpec: text("part_spec"), // 품명2 — closest thing to a real identifier, still free text
    kyosanPartNo: text("kyosan_part_no"), // 교산 품번
    drawingNo: text("drawing_no"), // 도번
    category: text("category"), // 분류 — RFG/MB/호환 observed, kept free text (not proven to need enforcement)
    itemType: text("item_type"), // 항목 — free text per approved decision, no enum
    notes: text("notes"), // 비고
    /**
     * 이 부품을 갈 때 드는 **작업비 금액**(원, VAT 별도). **수량과 무관하다** —
     * 몇 개를 갈든 품목당 한 번 붙는다(사용자 정정 2026-08-28).
     *
     * 견적서의 `2) 작업비` 는 고정 금액이 아니라 **이 값들의 합**이다
     * (사용자 확인 2026-08-28). 예전 OH 양식에 240만원이 상수로 박혀 있었지만
     * 그건 그 파일에 남아 있던 한 건의 값일 뿐 규칙이 아니었다.
     *
     * ── 🔴 NULL 과 0 은 다른 뜻이다 ──────────────────────────────────────
     *   · NULL = **정하지 않았다.** 견적서가 이 부품 몫의 작업비를 셈에 넣지
     *     못하고, 화면이 "작업비 미정"이라고 알린다.
     *   · 0    = **작업비가 없는 부품이다**(끼우기만 하면 되는 것). 셈에 0으로 들어간다.
     *
     * 0 으로 뭉개면 "정하지 않음"을 표현할 방법이 사라지고, 견적서가 작업비를
     * 실제보다 적게 부른다 — part_unit_prices 가 같은 구분을 두는 것과 같은 이유다.
     *
     * 소유구분별로 나누지 않는다. 단가는 누구 물건이냐에 따라 다르지만
     * (part_unit_prices), 갈아 끼우는 **손이 드는 시간은 같다.**
     *
     * numeric 인 이유는 이 저장소의 다른 금액들과 같다 — 십진 그대로 저장한다.
     */
    laborCost: numeric("labor_cost", { precision: 15, scale: 2 }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // Soft-delete four-column convention (DATABASE_DESIGN.md #8).
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "restrict" }),
    deleteReason: text("delete_reason"),
  },
  (table) => [
    index("parts_part_name_idx").on(table.partName),
    index("parts_drawing_no_idx").on(table.drawingNo),
    index("parts_kyosan_part_no_idx").on(table.kyosanPartNo),
    index("parts_not_deleted_idx").on(table.isDeleted).where(sql`is_deleted = false`),
  ]
);

/**
 * Part × owner × location stock bucket. `current_quantity` is a cached
 * projection — `stock_transactions` is the authoritative ledger (see the
 * mutation layer). Negative stock is structurally impossible: enforced
 * both by this CHECK and by every mutation's own application-level
 * INSUFFICIENT_STOCK rejection (no role bypass, ever — approved policy).
 */
export const partStockBalances = pgTable(
  "part_stock_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "restrict" }),
    owner: stockOwnerEnum("owner").notNull(),
    location: text("location").notNull(),
    currentQuantity: integer("current_quantity").notNull().default(0),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("part_stock_balances_quantity_not_negative", sql`${table.currentQuantity} >= 0`),
    uniqueIndex("part_stock_balances_part_owner_location_unique").on(table.partId, table.owner, table.location),
    index("part_stock_balances_part_id_idx").on(table.partId),
  ]
);

/**
 * Append-only stock ledger — the real source of truth (plan §4). Every
 * mutation locks the owning `part_stock_balances` row (`FOR UPDATE`) and
 * writes exactly one row here in the same transaction as the balance
 * update; nothing in this codebase ever updates or deletes a row
 * afterward (no `updated_at`, same convention as
 * `procedure_case_execution_history`).
 */
export const stockTransactions = pgTable(
  "stock_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partStockBalanceId: uuid("part_stock_balance_id")
      .notNull()
      .references(() => partStockBalances.id, { onDelete: "restrict" }),
    transactionType: stockTransactionTypeEnum("transaction_type").notNull(),
    // Signed: +qty for RECEIPT/RETURN, -qty for USE — enforced by the sign CHECK below.
    quantityDelta: integer("quantity_delta").notNull(),
    // Snapshot at write time — audit/debug only, never authoritative (the
    // live cached balance and the SUM of this ledger are the two sources
    // of truth; this column is neither).
    resultingQuantity: integer("resulting_quantity").notNull(),
    // USE only — nullable FK, never duplicates the intake number (always
    // join through repair_cases.intake_number for display). ON DELETE SET
    // NULL (repair-case permanent-delete schema foundation checkpoint) —
    // was already nullable but RESTRICT, which made a repair_cases hard-
    // delete impossible at the DB level. This is the accounting-critical
    // stock ledger and must outlive the case's own hard-delete.
    // IMPORTANT (not handled by this migration): the
    // stock_transactions_use_has_destination CHECK below requires
    // repair_case_id IS NOT NULL OR destination_note IS NOT NULL for every
    // USE row — a future repair-case hard-delete MUST backfill
    // destination_note on this case's USE rows (case-linked, PII-free, e.g.
    // the intake number) in the same transaction before triggering this
    // SET NULL, or that later UPDATE will violate the CHECK and abort the
    // whole purge. Existing rows are untouched by this schema change alone
    // — only a future repair_cases hard-delete ever nulls this column.
    repairCaseId: uuid("repair_case_id").references(() => repairCases.id, { onDelete: "set null" }),
    // USE only — free-text fallback for the real "상해수리소"-style
    // destinations the workbook audit found (not every USE ties to a
    // repair case).
    destinationNote: text("destination_note"),
    // USE only — set when the USE was launched from a procedure-execution
    // task context. Serves as an AS_ENGINEER authorization input (its
    // effective assignee can satisfy the "assigned" check even when the
    // case itself isn't assigned to them — see inventory-authorization.ts)
    // and is kept for reverse-traceability (part → transaction → repair
    // case/procedure task).
    procedureExecutionNodeId: uuid("procedure_execution_node_id").references(() => procedureCaseExecutionNodes.id, {
      onDelete: "restrict",
    }),
    // RETURN only — a RETURN always reverses a specific prior USE (plan
    // §6); there is no standalone "credit" RETURN in Phase 5B-2 (a
    // delivery correction with no prior USE is just an ordinary RECEIPT).
    reversalOfId: uuid("reversal_of_id").references((): AnyPgColumn => stockTransactions.id, { onDelete: "restrict" }),
    // Phase 5B-3 — set together (both or neither, enforced below) only on a
    // USE row produced by a confirmed parts-request issue action; never set
    // on a direct/destination-only USE, and never on RECEIPT/RETURN. A
    // RETURN reversing a request-originated USE does NOT carry these
    // columns itself — it's still traceable via reversalOfId -> the
    // original USE row -> these two columns (see inventory-part-requests.ts
    // schema comment and the mutation layer's RETURN-interaction notes).
    requestItemId: uuid("request_item_id").references(() => inventoryPartRequestItems.id, { onDelete: "restrict" }),
    requestIssueId: uuid("request_issue_id").references(() => inventoryPartRequestIssues.id, { onDelete: "restrict" }),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "stock_transactions_delta_sign_matches_type",
      sql`(${table.transactionType} = 'USE' AND ${table.quantityDelta} < 0) OR (${table.transactionType} IN ('RECEIPT', 'RETURN') AND ${table.quantityDelta} > 0)`
    ),
    check(
      "stock_transactions_reversal_only_on_return",
      sql`${table.reversalOfId} IS NULL OR ${table.transactionType} = 'RETURN'`
    ),
    check(
      "stock_transactions_use_has_destination",
      sql`${table.transactionType} <> 'USE' OR ${table.repairCaseId} IS NOT NULL OR ${table.destinationNote} IS NOT NULL`
    ),
    check(
      "stock_transactions_execution_node_only_on_use",
      sql`${table.procedureExecutionNodeId} IS NULL OR ${table.transactionType} = 'USE'`
    ),
    check(
      "stock_transactions_request_item_only_on_use",
      sql`${table.requestItemId} IS NULL OR ${table.transactionType} = 'USE'`
    ),
    check(
      "stock_transactions_request_issue_only_on_use",
      sql`${table.requestIssueId} IS NULL OR ${table.transactionType} = 'USE'`
    ),
    check(
      "stock_transactions_request_linkage_consistent",
      sql`(${table.requestItemId} IS NULL) = (${table.requestIssueId} IS NULL)`
    ),
    index("stock_transactions_balance_id_idx").on(table.partStockBalanceId),
    index("stock_transactions_repair_case_id_idx").on(table.repairCaseId),
    index("stock_transactions_execution_node_id_idx").on(table.procedureExecutionNodeId),
    index("stock_transactions_reversal_of_id_idx").on(table.reversalOfId),
    index("stock_transactions_created_at_idx").on(table.createdAt),
    index("stock_transactions_request_item_id_idx").on(table.requestItemId),
    index("stock_transactions_request_issue_id_idx").on(table.requestIssueId),
  ]
);
