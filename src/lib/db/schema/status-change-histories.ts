import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { repairCases } from "./repair-cases";
import { users } from "./users";
import { workflowSteps, workflowVersions } from "./workflow";

/**
 * Named to match DATABASE_DESIGN.md #2/#6 ("repair_cases 1:N
 * status_change_histories", `from_step_id`/`to_step_id` → `workflow_steps.
 * id`, `changed_by` → `users.id`) rather than this task's suggested
 * "workflow_step_actions" — the project's own design doc already reserves
 * this table name for exactly this purpose. Field set is the richer one
 * this task needs (action_type/metadata alongside the documented from/to
 * step + actor + reason), which the doc's "개요" (overview) list doesn't
 * preclude.
 *
 * Reuses the exact 5 action codes already defined and battle-tested in the
 * local-demo layer (workflow-types.ts's ACTION_CODES) rather than inventing
 * a parallel vocabulary — HOLD_STARTED/HOLD_RELEASED rows never change
 * from_step_id/to_step_id (both point at the unchanged current step); the
 * other three always do.
 *
 * Immutable/append-only: no soft-delete columns, no update path anywhere in
 * the mutation layer. `metadata` is reserved for future use (e.g. richer
 * shipment-completion detail) — deliberately never populated with contact/
 * customer PII (see repair_cases' own contact-snapshot PII warning).
 */
export const statusChangeActionTypeEnum = pgEnum("status_change_action_type", [
  "STEP_ADVANCED",
  "STEP_RETURNED",
  "HOLD_STARTED",
  "HOLD_RELEASED",
  "SHIPMENT_COMPLETED",
  "LEGACY_IMPORT_STATE_SET",
]);

export const statusChangeHistories = pgTable(
  "status_change_histories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable, ON DELETE SET NULL (repair-case permanent-delete schema
    // foundation checkpoint) — was NOT NULL + RESTRICT, which made a
    // repair_cases hard-delete impossible at the DB level. This table is
    // immutable/append-only workflow history that must outlive the case's
    // own hard-delete; the row's own action_type/from_step_id/to_step_id/
    // metadata permanently preserve what happened regardless of this column
    // going NULL. Existing rows are untouched by this — only a future
    // repair_cases hard-delete ever nulls it. Same proven pattern as
    // repair_case_flowchart_edit_history.flowchart_id (migration 0026).
    repairCaseId: uuid("repair_case_id").references(() => repairCases.id, {
      onDelete: "set null",
    }),
    workflowVersionId: uuid("workflow_version_id")
      .notNull()
      .references(() => workflowVersions.id, { onDelete: "restrict" }),
    fromStepId: uuid("from_step_id").references(() => workflowSteps.id, {
      onDelete: "restrict",
    }),
    toStepId: uuid("to_step_id").references(() => workflowSteps.id, {
      onDelete: "restrict",
    }),
    actionType: statusChangeActionTypeEnum("action_type").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reason: text("reason"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("status_change_histories_repair_case_id_created_at_idx").on(
      table.repairCaseId,
      table.createdAt
    ),
    index("status_change_histories_actor_user_id_idx").on(table.actorUserId),
  ]
);
