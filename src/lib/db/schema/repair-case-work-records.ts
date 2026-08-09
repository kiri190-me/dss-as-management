import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { repairCases } from "./repair-cases";
import { users } from "./users";
import { workflowSteps } from "./workflow";
import { procedureCaseExecutionNodes } from "./procedure-case-execution";

/**
 * Phase 5C-2 — durable, append-oriented per-case work history ("작업 기록"),
 * distinct from procedure_case_execution_nodes.work_memo (the per-node,
 * overwritable "작업 메모" that Phase 5A already owns — never touched,
 * never backfilled, never synchronized with this table).
 *
 * Normally immutable after creation: there is no update mutation for
 * memo/author/created_at anywhere in the mutation layer, ever. The only
 * mutation beyond insert is a one-way, at-most-once invalidation
 * (invalidated_at/invalidated_by/invalidation_reason) — see
 * db/mutations/repair-case-work-records.ts's invalidateWorkRecord, which
 * guards with `WHERE invalidated_at IS NULL` so a record can never be
 * invalidated twice or have its reason silently overwritten. Deliberately
 * NOT a separate append-only event table (contrast status_change_histories/
 * procedure_case_execution_history, which log genuinely repeatable
 * transitions) — invalidation here is a single one-way fact about one row,
 * fully captured by three columns on the row itself.
 *
 * related_workflow_step_id captures the actual workflow_steps.id active at
 * creation time (never inferred later from the case's current step, which
 * may have moved on) — nullable only for schema-level future-proofing;
 * repair_cases.current_workflow_step_id is NOT NULL/FK-enforced, so in
 * practice this is always populated for every row created against today's
 * schema.
 *
 * client_request_id is the idempotency guard for double-submit protection
 * (see the mutation's INSERT ... ON CONFLICT DO NOTHING + compare-on-conflict
 * design) — deliberately not a separate idempotency-keys table, since this
 * is a single-shape, single-insert operation.
 */
export const repairCaseWorkRecords = pgTable(
  "repair_case_work_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repairCaseId: uuid("repair_case_id")
      .notNull()
      .references(() => repairCases.id, { onDelete: "restrict" }),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    memo: text("memo").notNull(),
    relatedWorkflowStepId: uuid("related_workflow_step_id").references(() => workflowSteps.id, {
      onDelete: "restrict",
    }),
    relatedProcedureExecutionNodeId: uuid("related_procedure_execution_node_id").references(
      () => procedureCaseExecutionNodes.id,
      { onDelete: "restrict" }
    ),
    // Client-minted UUID, one per compose attempt — see mutation module doc
    // comment for the full idempotency design.
    clientRequestId: uuid("client_request_id"),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    invalidatedBy: uuid("invalidated_by").references(() => users.id, { onDelete: "restrict" }),
    invalidationReason: text("invalidation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("repair_case_work_records_memo_not_blank", sql`btrim(${table.memo}) <> ''`),
    // Exactly two valid states — never a partial invalidation. An explicit
    // OR of two fully-specified states (not a weaker chained-null-equality
    // check), so e.g. "reason set but invalidated_at NULL" is impossible.
    check(
      "repair_case_work_records_invalidation_all_or_nothing",
      sql`(${table.invalidatedAt} IS NULL AND ${table.invalidatedBy} IS NULL AND ${table.invalidationReason} IS NULL)
        OR (${table.invalidatedAt} IS NOT NULL AND ${table.invalidatedBy} IS NOT NULL AND ${table.invalidationReason} IS NOT NULL AND btrim(${table.invalidationReason}) <> '')`
    ),
    // Idempotency guard — see module doc comment. Partial so a NULL
    // client_request_id (never actually sent by the create mutation, but
    // schema-permitted) never collides with another NULL.
    uniqueIndex("repair_case_work_records_repair_case_client_request_unique")
      .on(table.repairCaseId, table.clientRequestId)
      .where(sql`client_request_id is not null`),
    // The one real query pattern: recent-N / paginated-full-history for one
    // case, newest first.
    index("repair_case_work_records_repair_case_id_created_at_idx").on(table.repairCaseId, table.createdAt),
    index("repair_case_work_records_author_user_id_idx").on(table.authorUserId),
    // Partial: supports "was this node referenced by a work record" lookups
    // cheaply; most rows have this NULL (plain memo, no node context).
    index("repair_case_work_records_procedure_execution_node_id_idx")
      .on(table.relatedProcedureExecutionNodeId)
      .where(sql`related_procedure_execution_node_id is not null`),
    // No index on related_workflow_step_id (no query filters by step) or on
    // invalidation state (the UI always reads the full per-case list and
    // renders invalidation inline — no filtered "valid only" query exists
    // in this phase) — avoiding speculative indexes.
  ]
);
