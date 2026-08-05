import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { procedureTemplateNodes } from "./procedure-template-nodes";

/**
 * Large cell-anchored inspection-form sheets (e.g. (MB) 외관 및 내부 검사,
 * 16 sub-procedures across 1,439 rows — Phase 1 report §3) import as one
 * CHECKLIST-type procedure_template_node, with each of the form's
 * hyperlink-anchored sections becoming one row here.
 */
export const procedureChecklistSections = pgTable(
  "procedure_checklist_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => procedureTemplateNodes.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    sourceWorksheet: text("source_worksheet"),
    sourceCellRange: text("source_cell_range"),
  },
  (table) => [index("procedure_checklist_sections_node_id_idx").on(table.nodeId)]
);

/**
 * measurement_type is a free-form label (e.g. "PRESSURE", "VOLTAGE",
 * "RESISTANCE", "TEXT") rather than a closed enum — the workbook's
 * measurement vocabulary (Phase 1 report §3: withstand-voltage tests,
 * insulation-resistance tests, pressure/flow-rate tests, capacitance
 * measurements) is large and likely to grow as more sheets are imported in
 * a later phase; a Postgres enum would need a migration for every new kind
 * found. min_value/max_value use `numeric` (not float) so exact thresholds
 * like 0.505 MPa or the 0.4242 withstand-voltage multiplier survive without
 * floating-point drift.
 */
export const procedureChecklistItems = pgTable(
  "procedure_checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => procedureChecklistSections.id, { onDelete: "restrict" }),
    itemCode: text("item_code").notNull(),
    title: text("title").notNull(),
    instructions: text("instructions"),
    measurementType: text("measurement_type"),
    measurementUnit: text("measurement_unit"),
    minValue: numeric("min_value"),
    maxValue: numeric("max_value"),
    expectedText: text("expected_text"),
    acceptanceRule: text("acceptance_rule"),
    required: boolean("required").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    sourceCellRange: text("source_cell_range"),
  },
  (table) => [index("procedure_checklist_items_section_id_idx").on(table.sectionId)]
);
