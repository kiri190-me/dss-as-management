import { index, integer, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { procedureTemplates } from "./procedure-templates";

/**
 * Closed 4-value set — every cell/hyperlink kind found in "Main page" and
 * "QC" (Phase 2.5) reduces deterministically to one of these:
 *  - NAV_LINK: a hyperlink whose location resolves to another worksheet in
 *    this workbook (e.g. Main page's stage links).
 *  - EXTERNAL_FILE_LINK: a hyperlink (or UNC-style path text in QC) that
 *    points outside the workbook (a network file share, a folder).
 *  - CROSS_REFERENCE_ID: a bare numeric cell not covered by a hyperlink —
 *    these do not resolve to anything else in this workbook (verified by
 *    inspection), so each also raises an ORPHAN_REFERENCE_ITEM validation
 *    issue rather than being silently imported as if it meant something.
 *  - TEXT_NOTE: any other non-empty descriptive cell text.
 */
export const procedureReferenceItemTypeEnum = pgEnum("procedure_reference_item_type", [
  "NAV_LINK",
  "EXTERNAL_FILE_LINK",
  "CROSS_REFERENCE_ID",
  "TEXT_NOTE",
]);

/**
 * Child rows of a reference-only procedure_template (is_reference_only =
 * true — see procedure-templates.ts) — deliberately keyed on
 * procedure_template_id directly, not on a procedure_template_node, because
 * these two templates ("Main page", "QC") have zero executable nodes by
 * design (Phase 2.5 task brief: "Do not duplicate its boxes as executable
 * technical nodes when they only link to detailed sheets"). This table is
 * the entire content of a reference-only template.
 */
export const procedureReferenceItems = pgTable(
  "procedure_reference_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    procedureTemplateId: uuid("procedure_template_id")
      .notNull()
      .references(() => procedureTemplates.id, { onDelete: "restrict" }),
    itemType: procedureReferenceItemTypeEnum("item_type").notNull(),
    label: text("label").notNull(),
    sourceWorksheet: text("source_worksheet").notNull(),
    sourceCellRange: text("source_cell_range"),
    hyperlinkTarget: text("hyperlink_target"),
    crossReferenceNumber: text("cross_reference_number"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    index("procedure_reference_items_template_id_idx").on(table.procedureTemplateId),
  ]
);
