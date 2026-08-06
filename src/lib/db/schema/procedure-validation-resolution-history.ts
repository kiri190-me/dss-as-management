import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { procedureTemplates } from "./procedure-templates";
import { procedureTemplateNodes } from "./procedure-template-nodes";
import { procedureTemplateEdges, procedureBranchTypeEnum } from "./procedure-template-edges";
import { procedureTemplateValidationIssues } from "./procedure-template-validation-issues";
import { users } from "./users";

/**
 * Closed set of what a review action on a validation issue can be
 * (Phase 3A). ADD_EDGE/BIND_SOURCE/BIND_TARGET/RETARGET_EDGE/RELABEL_EDGE
 * are the graph-changing outcomes (BIND_SOURCE/BIND_TARGET record which
 * single endpoint was missing and got bound; ADD_EDGE records that both
 * endpoints were missing and the reviewer supplied both; RETARGET_EDGE/
 * RELABEL_EDGE are reserved for a future issue type — e.g.
 * AMBIGUOUS_LABEL_EDGE_MATCH — where an edge already exists and only its
 * target/label changes). MARK_NO_CHANGE/DEFER are the two
 * no-graph-change outcomes. REOPEN and ROLLBACK_EDGE are always two
 * separate history rows for one logical "undo" — reopening never deletes
 * an edge by itself (see reopenValidationIssue/rollbackValidationIssueEdge
 * in the mutation layer).
 */
export const procedureValidationResolutionActionTypeEnum = pgEnum("procedure_validation_resolution_action_type", [
  "ADD_EDGE",
  "BIND_SOURCE",
  "BIND_TARGET",
  "RETARGET_EDGE",
  "RELABEL_EDGE",
  "MARK_NO_CHANGE",
  "DEFER",
  "REOPEN",
  "ROLLBACK_EDGE",
]);

/**
 * Append-only audit trail for procedure_template_validation_issues review
 * actions (Phase 3A) — never updated or deleted, only inserted. A reopen
 * followed by a rollback is always two rows, never one, so the sequence of
 * what actually happened is fully reconstructable.
 *
 * affected_edge_id uses onDelete:"set null" (not "restrict", unlike every
 * other edge/node reference in this schema) — a ROLLBACK_EDGE action
 * deletes the edge it refers to, and history must survive that deletion.
 * The full edge detail (branch type, label, endpoints) already lives in
 * before_state/after_state, so losing the live pointer while keeping the
 * historical record is the intended behavior, not data loss.
 */
export const procedureValidationResolutionHistory = pgTable(
  "procedure_validation_resolution_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    validationIssueId: uuid("validation_issue_id")
      .notNull()
      .references(() => procedureTemplateValidationIssues.id, { onDelete: "restrict" }),
    procedureTemplateId: uuid("procedure_template_id")
      .notNull()
      .references(() => procedureTemplates.id, { onDelete: "restrict" }),
    actionType: procedureValidationResolutionActionTypeEnum("action_type").notNull(),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    selectedNodeId: uuid("selected_node_id").references(() => procedureTemplateNodes.id, {
      onDelete: "restrict",
    }),
    affectedEdgeId: uuid("affected_edge_id").references(() => procedureTemplateEdges.id, {
      onDelete: "set null",
    }),
    branchType: procedureBranchTypeEnum("branch_type"),
    note: text("note"),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("procedure_validation_resolution_history_issue_id_idx").on(table.validationIssueId),
    index("procedure_validation_resolution_history_template_id_idx").on(table.procedureTemplateId),
  ]
);
