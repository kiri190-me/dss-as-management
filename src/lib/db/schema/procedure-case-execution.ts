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
import { procedureTemplates } from "./procedure-templates";
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
    repairCaseId: uuid("repair_case_id")
      .notNull()
      .references(() => repairCases.id, { onDelete: "restrict" }),
    procedureTemplateId: uuid("procedure_template_id")
      .notNull()
      .references(() => procedureTemplates.id, { onDelete: "restrict" }),
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
    // "One active execution per case" in Phase 5A is simply "one non-deleted
    // row" — there is no status column to additionally filter on.
    uniqueIndex("procedure_case_executions_one_active_per_case")
      .on(table.repairCaseId)
      .where(sql`is_deleted = false`),
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
