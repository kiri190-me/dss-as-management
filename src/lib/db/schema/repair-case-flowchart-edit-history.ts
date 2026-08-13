import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { repairCaseFlowcharts } from "./repair-case-flowcharts";
import { repairCaseFlowchartNodes } from "./repair-case-flowchart-nodes";
import { repairCaseFlowchartEdges } from "./repair-case-flowchart-edges";
import { users } from "./users";

/**
 * Phase 5C-6A — history foundation created ahead of 6B/6C/6D's actual
 * mutations, same precedent as procedure_template_edit_history's own
 * Phase 5C-5A foundation-before-CRUD sequencing: history must exist before
 * the first editable case-flowchart CRUD ships, so every CREATE_NODE/
 * CREATE_EDGE/SAVE_LAYOUT operation is auditable from its very first write.
 * Undo/Redo/Restore production mutations and UI are explicitly deferred to
 * 5C-6E — this checkpoint only lays the append-only foundation they will
 * read.
 *
 * Deliberately a separate table from procedure_template_edit_history, never
 * reused for convenience: this table's flowchart_id/node_id/edge_id FKs
 * point only at case-owned rows, keeping case-flowchart audit data fully
 * isolated from template audit data. Only the pure fold algorithm
 * (foldProcedureTemplateEditHistory's event-fold logic) is intended to be
 * reused in 5C-6E — never this table's storage.
 */
export const repairCaseFlowchartEditActionTypeEnum = pgEnum(
  "repair_case_flowchart_edit_action_type",
  [
    "CREATE_FLOWCHART",
    "UPDATE_FLOWCHART_METADATA",
    "SOFT_DELETE_FLOWCHART",
    "CREATE_NODE",
    "UPDATE_NODE",
    "CHANGE_NODE_TYPE",
    "DELETE_NODE",
    "CREATE_EDGE",
    "UPDATE_EDGE",
    "RETARGET_EDGE",
    "DELETE_EDGE",
    "SAVE_LAYOUT",
    "SAVE_EDGE_ROUTE",
  ]
);

/**
 * Same four-value set and same meaning as
 * procedure_template_edit_history_origin — 5C-6E's Undo/Redo/Restore fold
 * is intended to run the same event-fold algorithm against this table's
 * rows, so the origin vocabulary must match exactly.
 */
export const repairCaseFlowchartEditHistoryOriginEnum = pgEnum(
  "repair_case_flowchart_edit_history_origin",
  ["USER_EDIT", "UNDO", "REDO", "RESTORE"]
);

export const repairCaseFlowchartEditHistory = pgTable(
  "repair_case_flowchart_edit_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    flowchartId: uuid("flowchart_id")
      .notNull()
      .references(() => repairCaseFlowcharts.id, { onDelete: "restrict" }),
    actionType: repairCaseFlowchartEditActionTypeEnum("action_type").notNull(),
    // Null for flowchart-level actions (CREATE_FLOWCHART,
    // UPDATE_FLOWCHART_METADATA, SOFT_DELETE_FLOWCHART, SAVE_LAYOUT/
    // SAVE_EDGE_ROUTE touching multiple nodes/edges at once) — non-null for
    // a single node/edge-scoped action. Becomes NULL automatically
    // (onDelete: "set null") when the referenced node is later hard-deleted
    // — the row's own before_state/after_state JSON permanently preserves
    // that node's identity/state regardless, same proven pattern as
    // procedure_template_edit_history.node_id (migration 0017).
    nodeId: uuid("node_id").references(() => repairCaseFlowchartNodes.id, {
      onDelete: "set null",
    }),
    edgeId: uuid("edge_id").references(() => repairCaseFlowchartEdges.id, {
      onDelete: "set null",
    }),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    reason: text("reason"),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // One UUID per logical operation — every row one mutation call writes in
    // one transaction shares it. This is a brand-new, currently-empty
    // table, so unlike migration 0018's backfill for legacy rows, every row
    // here is written with a real change_group_id from day one — no
    // singleton-UUID backfill step is needed.
    changeGroupId: uuid("change_group_id").notNull(),
    // Sole ordering key — created_at is display-only, never used for
    // ordering (same rationale as procedure_template_edit_history: same-
    // transaction rows can tie on Postgres's transaction-scoped now()).
    // IDENTITY-generated, so it is allocation-ordered even within one
    // transaction. No ROW_NUMBER()-based backfill is needed (empty table at
    // creation time) — plain GENERATED ALWAYS AS IDENTITY from row one.
    sequenceNumber: bigint("sequence_number", { mode: "number" })
      .notNull()
      .generatedAlwaysAsIdentity(),
    // USER_EDIT/RESTORE are forward-reversible operations (pushed onto the
    // fold's appliedStack); UNDO/REDO reference exactly one prior forward
    // group via source_group_id. See the origin-consistency CHECK below.
    origin: repairCaseFlowchartEditHistoryOriginEnum("origin")
      .notNull()
      .default("USER_EDIT"),
    // Non-null iff origin IN (UNDO, REDO) — identifies the change_group_id
    // of the forward group (USER_EDIT or RESTORE) being reversed/reapplied.
    sourceGroupId: uuid("source_group_id"),
    // Non-null iff origin = RESTORE — identifies the change_group_id of the
    // historical group the user chose to restore to.
    restoreTargetGroupId: uuid("restore_target_group_id"),
  },
  (table) => [
    index("repair_case_flowchart_edit_history_flowchart_id_idx").on(table.flowchartId),
    index("repair_case_flowchart_edit_history_node_id_idx").on(table.nodeId),
    index("repair_case_flowchart_edit_history_edge_id_idx").on(table.edgeId),
    uniqueIndex("repair_case_flowchart_edit_history_sequence_number_unique").on(
      table.sequenceNumber
    ),
    index("repair_case_flowchart_edit_history_flowchart_sequence_idx").on(
      table.flowchartId,
      table.sequenceNumber
    ),
    // Exact same three-way invariant as
    // procedure_template_edit_history_origin_consistency (migration 0018):
    //   USER_EDIT  -> source_group_id IS NULL     AND restore_target_group_id IS NULL
    //   UNDO/REDO  -> source_group_id IS NOT NULL AND restore_target_group_id IS NULL
    //   RESTORE    -> source_group_id IS NULL     AND restore_target_group_id IS NOT NULL
    check(
      "repair_case_flowchart_edit_history_origin_consistency",
      sql`(${table.origin} = 'USER_EDIT' AND ${table.sourceGroupId} IS NULL AND ${table.restoreTargetGroupId} IS NULL)
        OR (${table.origin} IN ('UNDO', 'REDO') AND ${table.sourceGroupId} IS NOT NULL AND ${table.restoreTargetGroupId} IS NULL)
        OR (${table.origin} = 'RESTORE' AND ${table.sourceGroupId} IS NULL AND ${table.restoreTargetGroupId} IS NOT NULL)`
    ),
  ]
);
