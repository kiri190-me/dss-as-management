import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { procedureTemplates } from "./procedure-templates";

/**
 * Closed 9-value set per this task's brief. CHECKLIST is the single
 * container node a large cell-anchored inspection form (e.g. (MB) 외관 및
 * 내부 검사) imports into — its sub-sections/items live in
 * procedure_checklist_sections/items, not as separate nodes.
 * TROUBLESHOOTING plays the same container role for a symptom matrix (e.g.
 * (MB) 수리) — see procedure_troubleshooting_entries. Escalation-to-
 * manufacturer nodes (Phase 1 report §2) are represented as an ordinary
 * CORRECTIVE_ACTION node — a distinct ESCALATION type was considered and
 * deliberately dropped to keep this enum matching exactly what this task
 * specified.
 */
export const procedureNodeTypeEnum = pgEnum("procedure_template_node_type", [
  "START",
  "TASK",
  "INSPECTION",
  "DECISION",
  "CORRECTIVE_ACTION",
  "CHECKLIST",
  "TROUBLESHOOTING",
  "DOCUMENT_REFERENCE",
  "END",
]);

/**
 * Immutable once the owning template is PUBLISHED/ARCHIVED — enforced by
 * the mutation layer (procedure-templates.ts), which re-checks the owning
 * template's status inside the same transaction before allowing any write
 * here, never trusting a UI-only guard.
 *
 * source_worksheet/source_shape_id/source_cell_range preserve exactly where
 * this node came from in the original workbook (this task's traceability
 * requirement) — populated for EXCEL_IMPORT templates, left null for
 * MANUAL ones.
 */
export const procedureTemplateNodes = pgTable(
  "procedure_template_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    procedureTemplateId: uuid("procedure_template_id")
      .notNull()
      .references(() => procedureTemplates.id, { onDelete: "restrict" }),
    // Stable within the template, independent of the DB id — e.g.
    // "sheet03-shape14". Uniqueness enforced below; the importer detects and
    // reports a collision as a "duplicate node code" validation issue
    // *before* attempting the insert (see the importer), so this index is a
    // defense-in-depth backstop, not the primary detection path.
    nodeCode: text("node_code").notNull(),
    nodeType: procedureNodeTypeEnum("node_type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    objective: text("objective"),
    preparation: text("preparation"),
    toolsAndEquipment: text("tools_and_equipment"),
    safetyCaution: text("safety_caution"),
    instructions: text("instructions"),
    expectedNormalResult: text("expected_normal_result"),
    ngSymptoms: text("ng_symptoms"),
    recommendedCorrectiveAction: text("recommended_corrective_action"),
    acceptanceCriteria: text("acceptance_criteria"),
    workerMayAddNextTask: boolean("worker_may_add_next_task")
      .notNull()
      .default(true),
    positionX: doublePrecision("position_x").notNull().default(0),
    positionY: doublePrecision("position_y").notNull().default(0),
    // Phase 4A editor — 사용자 배치 (user layout) override, entirely separate
    // from position_x/position_y so the original source-imported (or
    // parent-version-cloned) coordinates are never overwritten. Null means
    // "never repositioned by a reviewer yet"; a node with a null override
    // always falls back to position_x/position_y for rendering. Only ever
    // written by the editor's explicit "저장" (save layout) action — never
    // on every pointer movement, and never backfilled for existing nodes.
    userPositionX: doublePrecision("user_position_x"),
    userPositionY: doublePrecision("user_position_y"),
    sortOrder: integer("sort_order").notNull().default(0),
    sourceWorksheet: text("source_worksheet"),
    sourceShapeId: text("source_shape_id"),
    sourceCellRange: text("source_cell_range"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("procedure_template_nodes_template_code_unique").on(
      table.procedureTemplateId,
      table.nodeCode
    ),
    index("procedure_template_nodes_template_id_idx").on(
      table.procedureTemplateId
    ),
  ]
);
