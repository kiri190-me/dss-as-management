import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { repairCases } from "./repair-cases";
import { users } from "./users";
import { workflowSteps } from "./workflow";
import { procedureCaseExecutionNodes } from "./procedure-case-execution";

/**
 * Author-selected, explicit classification for the automatic 고장 및 서비스
 * 정보 summary derivation (인수점검 결과/현재 진단·조치 요약/다음 예정 작업)
 * — never inferred from memo text or related_workflow_step_id. GENERAL is
 * the safe default for both ordinary notes and every pre-existing row (see
 * record_kind's column-level DEFAULT below — no backfill UPDATE is ever
 * run; historical rows become GENERAL purely through that default).
 */
export const repairCaseWorkRecordKindEnum = pgEnum("repair_case_work_record_kind", [
  "GENERAL",
  "INTAKE_INSPECTION_RESULT",
  "DIAGNOSIS_REPAIR_SUMMARY",
  "NEXT_PLANNED_ACTION",
]);

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
    // Nullable, ON DELETE SET NULL (repair-case permanent-delete schema
    // foundation checkpoint) — was NOT NULL + RESTRICT, which made a
    // repair_cases hard-delete impossible at the DB level. Engineer work-
    // history/memo log that must outlive the case's own hard-delete; the
    // row's own memo/recordKind/workflowStepId permanently preserve what
    // was recorded regardless of this column going NULL. Existing rows are
    // untouched by this — only a future repair_cases hard-delete ever nulls
    // it. Same proven pattern as
    // repair_case_flowchart_edit_history.flowchart_id (migration 0026).
    repairCaseId: uuid("repair_case_id").references(() => repairCases.id, {
      onDelete: "set null",
    }),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    memo: text("memo").notNull(),
    // Immutable once set, same as every other column on this row — there is
    // no update mutation for record_kind, ever (see module doc comment).
    recordKind: repairCaseWorkRecordKindEnum("record_kind").notNull().default("GENERAL"),
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
    // Serves "latest non-invalidated record of a given kind for this case"
    // — the derived-summary read pattern (인수점검 결과/진단·조치 요약/다음
    // 예정 작업). Partial on invalidated_at IS NULL, same convention as the
    // procedure-execution-node index below.
    index("repair_case_work_records_repair_case_id_record_kind_created_at_idx")
      .on(table.repairCaseId, table.recordKind, table.createdAt)
      .where(sql`invalidated_at is null`),
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
