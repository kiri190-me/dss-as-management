import { sql } from "drizzle-orm";
import {
  boolean,
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
import { procedureTemplates, procedureTemplateCategoryEnum } from "./procedure-templates";
import { procedureTemplateNodes } from "./procedure-template-nodes";
import { procedureTemplateEdges } from "./procedure-template-edges";
import { users } from "./users";

/**
 * Phase 5A — repair-case procedure execution. Binds one repair case to one
 * exact, immutable PUBLISHED procedure_templates.id and lets an engineer
 * execute its nodes. See the Phase 5A plan for the full design rationale;
 * key points reflected in this schema:
 *
 *  - Reference-based binding only: procedure_case_executions.procedure_template_id
 *    and procedure_case_execution_nodes.procedure_template_node_id point at
 *    the exact immutable template/node rows — never copied content (no
 *    title/instructions/edges/checklist/troubleshooting duplication).
 *  - Deliberately trimmed enums: no FAILED/IMPOSSIBLE/CANCELLED node status,
 *    no EXECUTION_COMPLETED/EXECUTION_ABANDONED/NODE_FAILED/NODE_IMPOSSIBLE/
 *    NODE_CANCELLED action type, no reviewer/approval columns — all
 *    deferred until their exact behavior is approved in a later migration.
 *  - No execution-level status column: Phase 5A has no execution-completion
 *    or abandonment mutation, so `completed_at` stays a plain nullable
 *    column (always null in 5A) instead of adding a speculative enum.
 */
export const procedureCaseExecutionNodeStatusEnum = pgEnum("procedure_case_execution_node_status", [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "SKIPPED",
  "BLOCKED",
]);

/**
 * NODE_MEMO_UPDATED is the one action type beyond the originally-approved
 * set — the direct, non-speculative mechanism satisfying the work-memo
 * audit requirement (every memo change must be attributable and
 * reconstructable) — see the Phase 5A plan §9.
 */
export const procedureCaseExecutionActionTypeEnum = pgEnum("procedure_case_execution_action_type", [
  "EXECUTION_STARTED",
  "NODE_ADDED",
  "NODE_STARTED",
  "NODE_COMPLETED",
  "NODE_SKIPPED",
  "NODE_BLOCKED",
  "NODE_REOPENED",
  "NODE_MEMO_UPDATED",
]);

export const procedureCaseExecutions = pgTable(
  "procedure_case_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable, ON DELETE SET NULL (repair-case permanent-delete schema
    // foundation checkpoint) — was NOT NULL + RESTRICT, which made a
    // repair_cases hard-delete impossible at the DB level. This row (and
    // its child procedure_case_execution_nodes/procedure_case_execution_history
    // rows, neither of which reference repair_cases directly and are
    // therefore entirely unaffected by this column going NULL) represents
    // actual repair work performed and must outlive the case's own hard-
    // delete. Existing rows are untouched by this — only a future
    // repair_cases hard-delete ever nulls it. Multiple NULLs never collide
    // with the partial unique index below (Postgres unique indexes treat
    // every NULL as distinct). Same proven pattern as
    // repair_case_flowchart_edit_history.flowchart_id (migration 0026).
    repairCaseId: uuid("repair_case_id").references(() => repairCases.id, {
      onDelete: "set null",
    }),
    procedureTemplateId: uuid("procedure_template_id")
      .notNull()
      .references(() => procedureTemplates.id, { onDelete: "restrict" }),
    // Phase 5C-5A — immutable snapshot of the bound template's category,
    // captured once at insert time by the mutation layer (never accepted
    // from the client, never independently chosen — always derived from
    // the live procedure_templates row the same transaction just locked
    // and verified PUBLISHED). Safe to snapshot permanently because a
    // template's category can never change after creation (no
    // conversion/switching UI exists or is planned — see
    // procedureTemplateCategoryEnum's own doc comment) and because a
    // PUBLISHED template's row is otherwise immutable already. This column
    // exists purely so the uniqueness index below can be category-aware
    // without a cross-table subquery, which Postgres partial unique
    // indexes cannot express.
    templateCategory: procedureTemplateCategoryEnum("template_category").notNull(),
    startedBy: uuid("started_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    // Nullable, unused/always-null in Phase 5A — no execution-level
    // completion mutation exists yet. Kept as a plain column-add so a later
    // phase can start writing it without another migration for this table.
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // Optimistic concurrency token for the execution row itself (distinct
    // from each execution-node row's own version), same convention as
    // repair_cases.version.
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
    // Phase 5C-5A — "one active execution per case" now applies only to
    // FULL_SERVICE (matching Phase 5A's original behavior exactly, since
    // every template that could ever be executed before this phase was
    // FULL_SERVICE-equivalent). TECHNICAL_TASK deliberately allows
    // multiple concurrent non-deleted rows per case — see
    // procedureTemplateCategoryEnum's own doc comment. Same partial-unique-
    // index technique DATABASE_DESIGN.md §7 already documents for
    // workflow_versions' "one active PUBLISHED version per template" rule
    // — not a new pattern.
    uniqueIndex("procedure_case_executions_one_active_full_service_per_case")
      .on(table.repairCaseId)
      .where(sql`is_deleted = false and template_category = 'FULL_SERVICE'`),
    // Defense-in-depth: startProcedureExecution already unconditionally
    // rejects any is_reference_only template before this table is ever
    // written to (TEMPLATE_NOT_EXECUTABLE), and the CHECK on
    // procedure_templates ties REFERENCE to is_reference_only=true, so a
    // REFERENCE row can never legitimately reach this insert — this CHECK
    // costs nothing and closes the gap permanently at the DB level too, in
    // case a future code path ever forgets the application-layer check.
    check("procedure_case_executions_no_reference_execution", sql`template_category <> 'REFERENCE'`),
    index("procedure_case_executions_repair_case_id_idx").on(table.repairCaseId),
    index("procedure_case_executions_procedure_template_id_idx").on(table.procedureTemplateId),
  ]
);

export const procedureCaseExecutionNodes = pgTable(
  "procedure_case_execution_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    executionId: uuid("execution_id")
      .notNull()
      .references(() => procedureCaseExecutions.id, { onDelete: "restrict" }),
    // Null means a case-specific extra task (no template counterpart) —
    // see extra_task_title/extra_task_instructions below.
    procedureTemplateNodeId: uuid("procedure_template_node_id").references(() => procedureTemplateNodes.id, {
      onDelete: "restrict",
    }),
    extraTaskTitle: text("extra_task_title"),
    extraTaskInstructions: text("extra_task_instructions"),
    status: procedureCaseExecutionNodeStatusEnum("status").notNull().default("PENDING"),
    // DECISION nodes only — the edge the engineer chose when completing
    // this node. Must belong to the same template and originate from this
    // node (enforced at the mutation layer, same app-level-only-constraint
    // convention used throughout this codebase for cross-table rules).
    selectedOutgoingEdgeId: uuid("selected_outgoing_edge_id").references(() => procedureTemplateEdges.id, {
      onDelete: "restrict",
    }),
    // Node-specific assignment override — null means "use the case's
    // assigned engineer" (coalesce at read time, never copied). The only
    // Phase 5A write path is a self-claim on start.
    assignedEngineerId: uuid("assigned_engineer_id").references(() => users.id, { onDelete: "restrict" }),
    startedBy: uuid("started_by").references(() => users.id, { onDelete: "restrict" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => users.id, { onDelete: "restrict" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // Mutated only via updateExecutionNodeMemo, which also writes a
    // NODE_MEMO_UPDATED history row in the same transaction — this column
    // alone is not the audit trail, procedure_case_execution_history is.
    workMemo: text("work_memo"),
    lastActionReason: text("last_action_reason"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "procedure_case_execution_nodes_extra_task_needs_title",
      sql`${table.procedureTemplateNodeId} is not null or ${table.extraTaskTitle} is not null`
    ),
    uniqueIndex("procedure_case_execution_nodes_one_per_template_node")
      .on(table.executionId, table.procedureTemplateNodeId)
      .where(sql`procedure_template_node_id is not null`),
    index("procedure_case_execution_nodes_execution_id_idx").on(table.executionId),
    index("procedure_case_execution_nodes_status_idx").on(table.executionId, table.status),
  ]
);

export const procedureCaseExecutionHistory = pgTable(
  "procedure_case_execution_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    executionId: uuid("execution_id")
      .notNull()
      .references(() => procedureCaseExecutions.id, { onDelete: "restrict" }),
    // Null for execution-level actions (EXECUTION_STARTED) — non-null for a
    // single node-scoped action.
    executionNodeId: uuid("execution_node_id").references(() => procedureCaseExecutionNodes.id, {
      onDelete: "restrict",
    }),
    actionType: procedureCaseExecutionActionTypeEnum("action_type").notNull(),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    reason: text("reason"),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("procedure_case_execution_history_execution_id_idx").on(table.executionId),
    index("procedure_case_execution_history_execution_node_id_idx").on(table.executionNodeId),
  ]
);
