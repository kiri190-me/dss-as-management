import { sql } from "drizzle-orm";
import { bigint, check, index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
 * retargets/creation, layout saves, manual edge-route saves, template-
 * level validate runs) —
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
  // Phase 4B — batched manual edge-route (waypoint) save, kept distinct
  // from SAVE_LAYOUT (node positions) so the two concerns never conflate
  // in the audit trail, same convention as every other action type here.
  "SAVE_EDGE_ROUTE",
  "DISCARD_DRAFT_CHANGES",
  "VALIDATE_TEMPLATE",
  // Phase 5C-5A — schema/enum foundation only for Phase 5C-5B's node/edge
  // CRUD (add node, delete node, delete edge). No mutation function writes
  // these yet; adding the enum values now so the eventual 5C-5B mutations
  // need no further migration, and so this file's type derivation
  // (procedure-template-editor.ts's EditActionType) is already complete.
  "CREATE_NODE",
  "DELETE_NODE",
  "DELETE_EDGE",
  // Phase 5C-5C — technical-template rename (procedure-templates.ts's
  // renameTechnicalProcedureTemplate). Only {name} in before/after; template
  // code stays immutable. Template-level (node_id/edge_id both null), same
  // as VALIDATE_TEMPLATE/CREATE_DRAFT_VERSION.
  "UPDATE_TEMPLATE_METADATA",
]);

/**
 * Phase 5C-5C — Undo/Redo/Restore foundation. Distinguishes who/what
 * produced a history row so the client-authoritative-free event fold
 * (see procedure-template-editor mutation module, once implemented) can
 * reconstruct appliedStack/redoStack purely by replaying origin +
 * source_group_id/restore_target_group_id in sequence_number order —
 * never from a mutable persisted cursor.
 */
export const procedureTemplateEditHistoryOriginEnum = pgEnum("procedure_template_edit_history_origin", [
  "USER_EDIT",
  "UNDO",
  "REDO",
  "RESTORE",
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
    // single node/edge-scoped action. Phase 5C-5B: also becomes null
    // automatically (onDelete:"set null") when the referenced node/edge is
    // later hard-deleted by deleteProcedureTemplateNode/
    // deleteProcedureTemplateEdge — same precedent as
    // procedure_validation_resolution_history.affected_edge_id: the full
    // identity of what was deleted already lives in before_state, so losing
    // the live pointer while keeping the historical row is intended
    // behavior, not data loss. No application code ever UPDATEs an existing
    // history row's node_id/edge_id — this is a DB-level referential action
    // only.
    nodeId: uuid("node_id").references(() => procedureTemplateNodes.id, { onDelete: "set null" }),
    edgeId: uuid("edge_id").references(() => procedureTemplateEdges.id, { onDelete: "set null" }),
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
    // Phase 5C-5C — one UUID per logical operation; every row written by the
    // same insertEditHistory call site inside one transaction shares it.
    // NOT NULL from day one: legacy rows are backfilled with their own
    // singleton UUID by migration 0018 (no historical compound grouping is
    // reconstructed — acceptable because FULL_SERVICE history stays
    // read-only display and is never fed through the Undo/Redo/Restore fold).
    changeGroupId: uuid("change_group_id").notNull(),
    // Sole ordering key — created_at is display-only (Postgres now() is
    // transaction-scoped, so same-transaction compound-group rows can tie on
    // created_at; this column is IDENTITY-generated and therefore
    // allocation-ordered even within one transaction). Backfilled
    // deterministically by migration 0018 via
    // ROW_NUMBER() OVER (ORDER BY created_at, id), then converted to
    // GENERATED ALWAYS AS IDENTITY for all future inserts.
    sequenceNumber: bigint("sequence_number", { mode: "number" }).notNull().generatedAlwaysAsIdentity(),
    // USER_EDIT/RESTORE are forward-reversible operations (pushed onto the
    // fold's appliedStack); UNDO/REDO reference exactly one prior forward
    // group via source_group_id. See the origin-consistency CHECK below.
    origin: procedureTemplateEditHistoryOriginEnum("origin").notNull().default("USER_EDIT"),
    // Non-null iff origin IN (UNDO, REDO) — identifies the change_group_id of
    // the forward group (USER_EDIT or RESTORE) being reversed/reapplied.
    sourceGroupId: uuid("source_group_id"),
    // Non-null iff origin = RESTORE — identifies the change_group_id of the
    // historical group the user chose to restore to. Every row in one
    // RESTORE group carries the same value.
    restoreTargetGroupId: uuid("restore_target_group_id"),
  },
  (table) => [
    index("procedure_template_edit_history_template_id_idx").on(table.procedureTemplateId),
    index("procedure_template_edit_history_node_id_idx").on(table.nodeId),
    index("procedure_template_edit_history_edge_id_idx").on(table.edgeId),
    uniqueIndex("procedure_template_edit_history_sequence_number_unique").on(table.sequenceNumber),
    index("procedure_template_edit_history_template_sequence_idx").on(
      table.procedureTemplateId,
      table.sequenceNumber
    ),
    check(
      "procedure_template_edit_history_origin_consistency",
      sql`(${table.origin} = 'USER_EDIT' AND ${table.sourceGroupId} IS NULL AND ${table.restoreTargetGroupId} IS NULL)
        OR (${table.origin} IN ('UNDO', 'REDO') AND ${table.sourceGroupId} IS NOT NULL AND ${table.restoreTargetGroupId} IS NULL)
        OR (${table.origin} = 'RESTORE' AND ${table.sourceGroupId} IS NULL AND ${table.restoreTargetGroupId} IS NOT NULL)`
    ),
  ]
);
