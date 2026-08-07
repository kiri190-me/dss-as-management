import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { procedureTemplates } from "./procedure-templates";
import { procedureTemplateNodes } from "./procedure-template-nodes";

/**
 * DEFAULT/NORMAL are both "no NG" outcomes — DEFAULT is the unlabeled
 * default-continue edge found on almost every decision node in the source
 * workbook (Phase 1 report §5: normal is implicit, never spelled out as a
 * drawn "정상" label), NORMAL is reserved for the rare case where the source
 * *does* draw an explicit positive label. LOOP_BACK is distinct from RETRY:
 * RETRY is a same-node/nearby re-measurement step ("...탈거 후 재측정"),
 * LOOP_BACK is a jump to an earlier node/stage entirely (the two verified
 * RFG cross-stage loop-backs — aging-test failure back to stage 4, and the
 * shipment-prep staleness check back to stage 4).
 */
export const procedureBranchTypeEnum = pgEnum("procedure_template_branch_type", [
  "DEFAULT",
  "NORMAL",
  "NG",
  "YES",
  "NO",
  "RETRY",
  "LOOP_BACK",
  "CUSTOM",
]);

/**
 * from_node_id/to_node_id may point at nodes anywhere in the same template
 * — including a different source worksheet/stage, which is exactly how the
 * two verified RFG loop-backs are represented (Phase 1 report §2): a single
 * RFG template spans multiple source sheets, and a LOOP_BACK edge from a
 * node imported off (RFG) (11)출하 준비 to the START node imported off
 * (RFG) (4)기본 정전 검사 is an ordinary row in this table.
 *
 * Immutable once the owning template is PUBLISHED/ARCHIVED, same
 * enforcement point as procedure_template_nodes.
 */
export const procedureTemplateEdges = pgTable(
  "procedure_template_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    procedureTemplateId: uuid("procedure_template_id")
      .notNull()
      .references(() => procedureTemplates.id, { onDelete: "restrict" }),
    fromNodeId: uuid("from_node_id")
      .notNull()
      .references(() => procedureTemplateNodes.id, { onDelete: "restrict" }),
    toNodeId: uuid("to_node_id")
      .notNull()
      .references(() => procedureTemplateNodes.id, { onDelete: "restrict" }),
    branchType: procedureBranchTypeEnum("branch_type").notNull(),
    branchLabel: text("branch_label"),
    // Structured for non-boolean branch conditions found in the workbook
    // (Phase 1 report §2) — e.g. the shipment-prep staleness check:
    // {"kind":"date_diff_gt","field":"last_power_on_test_at","days":30}.
    // Null for a plain DEFAULT/NG/YES/NO edge.
    conditionDefinition: jsonb("condition_definition"),
    sortOrder: integer("sort_order").notNull().default(0),
    sourceConnectorId: text("source_connector_id"),
    // Phase 4A editor — the exact parent-version edge row this one was
    // cloned from by createNewDraftVersion (null for an edge created
    // directly by the editor's "add connection" feature). Edges get a
    // fresh UUID on every clone (unlike nodes, which keep a stable
    // node_code across versions), so without this column a retargeted edge
    // is indistinguishable from "deleted + newly added" when comparing a
    // DRAFT against its parent. onDelete:"restrict" matches every other
    // edge/node FK in this table — Phase 4A never deletes an edge row.
    clonedFromEdgeId: uuid("cloned_from_edge_id").references((): AnyPgColumn => procedureTemplateEdges.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    index("procedure_template_edges_template_id_idx").on(
      table.procedureTemplateId
    ),
    index("procedure_template_edges_from_node_id_idx").on(table.fromNodeId),
    index("procedure_template_edges_to_node_id_idx").on(table.toNodeId),
  ]
);
