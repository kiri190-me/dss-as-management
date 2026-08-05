import { index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { procedureTemplateNodes } from "./procedure-template-nodes";

/**
 * Symptom-indexed troubleshooting matrices (e.g. (MB) 수리 — 11 independent
 * symptom rows, each its own short check→replace→retest sequence built from
 * literal "↓" text arrows and "N.G." cell text rather than drawing objects
 * — Phase 1 report §3) import as one TROUBLESHOOTING-type
 * procedure_template_node, with each symptom row becoming one row here.
 */
export const procedureTroubleshootingEntries = pgTable(
  "procedure_troubleshooting_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => procedureTemplateNodes.id, { onDelete: "restrict" }),
    symptom: text("symptom").notNull(),
    inspectionAction: text("inspection_action"),
    normalNextAction: text("normal_next_action"),
    ngAction: text("ng_action"),
    retryInstruction: text("retry_instruction"),
    sortOrder: integer("sort_order").notNull().default(0),
    sourceCellRange: text("source_cell_range"),
  },
  (table) => [
    index("procedure_troubleshooting_entries_node_id_idx").on(table.nodeId),
  ]
);
