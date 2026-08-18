import {
  doublePrecision,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { repairCaseFlowcharts } from "./repair-case-flowcharts";

/**
 * Phase 5C-6A — closed node-type set for manually-authored case flowcharts.
 * Deliberately narrower than procedure_template_node_type: CHECKLIST/
 * TROUBLESHOOTING are container types whose real content lives in
 * procedure_checklist_sections/procedure_troubleshooting_entries, which have
 * no case-flowchart analog (a case flowchart is never imported and has no
 * child-content authoring path for those types). This is an independently
 * owned Postgres enum — never the same type object as
 * procedure_template_node_type, even though the value set mirrors
 * MANUAL_TECHNICAL_NODE_TYPE_CODES.
 */
export const repairCaseFlowchartNodeTypeEnum = pgEnum(
  "repair_case_flowchart_node_type",
  ["START", "TASK", "INSPECTION", "DECISION", "CORRECTIVE_ACTION", "DOCUMENT_REFERENCE", "END"]
);

/**
 * flowchart_id + a UNIQUE(flowchart_id, id) constraint below exist so
 * repair_case_flowchart_edges can composite-FK against (flowchart_id, id)
 * instead of id alone — see repair-case-flowchart-edges.ts's own doc
 * comment for why (cross-flowchart edge references must be rejected by the
 * database itself, not only by application-level checks).
 *
 * Hard-deleted only (no soft-delete columns here) — an individual node
 * delete is a real DELETE, always preceded by its own
 * repair_case_flowchart_edit_history row (same insert-history-then-delete
 * ordering the procedure-template editor already uses). Whole-flowchart
 * removal is a soft delete at the parent table instead; see
 * repair-case-flowcharts.ts.
 *
 * No sourceWorksheet/sourceShapeId/sourceCellRange, no sortOrder, no
 * separate user-position-override columns: unlike procedure_template_nodes,
 * a case flowchart is never Excel-imported and never version-cloned, so
 * there is no "source-imported position" to preserve separately from a
 * "reviewer override" — position_x/position_y is the one and only
 * authoritative placement, always written by the editor's save action.
 */
export const repairCaseFlowchartNodes = pgTable(
  "repair_case_flowchart_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    flowchartId: uuid("flowchart_id")
      .notNull()
      .references(() => repairCaseFlowcharts.id, { onDelete: "cascade" }),
    nodeType: repairCaseFlowchartNodeTypeEnum("node_type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    instructions: text("instructions"),
    positionX: doublePrecision("position_x").notNull().default(0),
    positionY: doublePrecision("position_y").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("repair_case_flowchart_nodes_flowchart_id_idx").on(table.flowchartId),
    uniqueIndex("repair_case_flowchart_nodes_flowchart_id_id_unique").on(
      table.flowchartId,
      table.id
    ),
  ]
);
