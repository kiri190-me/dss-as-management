import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { procedureTemplates } from "./procedure-templates";
import { procedureTemplateNodes } from "./procedure-template-nodes";
import { procedureTemplateEdges } from "./procedure-template-edges";
import { procedureTemplateValidationIssues } from "./procedure-template-validation-issues";
import { users } from "./users";

/**
 * Phase 4A — general procedure-template edit history. Kept deliberately
 * separate from procedure_validation_resolution_history (Phase 3A): that
 * table is scoped to "a review action taken against one specific
 * validation issue" (bind/retarget/defer/reopen), while this one is the
 * general append-only audit trail for every controlled-editor mutation
 * (node property edits, node type changes, node moves, edge edits/
 * retargets/creation, layout saves, template-level validate runs) —
 * overloading the narrower table would have muddied both its meaning and
 * its queries.
 *
 * Append-only: every editor mutation in src/lib/db/mutations/
 * procedure-template-editor.ts inserts exactly one row here inside the
 * same transaction as the actual node/edge write, and nothing in this
 * codebase ever updates or deletes a row afterward.
 */
export const procedureTemplateEditActionTypeEnum = pgEnum("procedure_template_edit_action_type", [
  "CREATE_DRAFT_VERSION",
  "UPDATE_NODE",
  "CHANGE_NODE_TYPE",
  "MOVE_NODE",
  "UPDATE_EDGE",
  "RETARGET_EDGE",
  "CREATE_EDGE",
  "SAVE_LAYOUT",
  "DISCARD_DRAFT_CHANGES",
  "VALIDATE_TEMPLATE",
]);

export const procedureTemplateEditHistory = pgTable(
  "procedure_template_edit_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    procedureTemplateId: uuid("procedure_template_id")
      .notNull()
      .references(() => procedureTemplates.id, { onDelete: "restrict" }),
    actionType: procedureTemplateEditActionTypeEnum("action_type").notNull(),
    // Null for template-level actions (CREATE_DRAFT_VERSION, SAVE_LAYOUT
    // touching multiple nodes at once, VALIDATE_TEMPLATE) — non-null for a
    // single node/edge-scoped action.
    nodeId: uuid("node_id").references(() => procedureTemplateNodes.id, { onDelete: "restrict" }),
    edgeId: uuid("edge_id").references(() => procedureTemplateEdges.id, { onDelete: "restrict" }),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    // Required at the mutation-layer for CHANGE_NODE_TYPE and
    // RETARGET_EDGE (enforced in code, same convention as every other
    // app-level-only constraint in this schema) — optional for everything
    // else (e.g. an ordinary title/description edit).
    reason: text("reason"),
    // Set when this edit was made while resolving/investigating a specific
    // validation issue, so the editor audit trail and Phase 3A's
    // resolution history can be cross-referenced without merging the two
    // tables.
    relatedValidationIssueId: uuid("related_validation_issue_id").references(
      () => procedureTemplateValidationIssues.id,
      { onDelete: "restrict" }
    ),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("procedure_template_edit_history_template_id_idx").on(table.procedureTemplateId),
    index("procedure_template_edit_history_node_id_idx").on(table.nodeId),
    index("procedure_template_edit_history_edge_id_idx").on(table.edgeId),
  ]
);
