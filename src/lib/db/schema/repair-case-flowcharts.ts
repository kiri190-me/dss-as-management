import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { repairCases } from "./repair-cases";
import { users } from "./users";

/**
 * Phase 5C-6A — a repair case's own engineer-authored diagnostic/work
 * flowcharts ("what did the engineer actually inspect, conclude, and do on
 * THIS specific case?"). Deliberately independent of procedure_templates:
 * this table, repair_case_flowchart_nodes/edges, and
 * repair_case_flowchart_edit_history own their data completely separately
 * from the procedure-template graph-editor tables — editing a case
 * flowchart must never be able to reach a TECHNICAL_TASK/FULL_SERVICE
 * template row. The Graph Editor Core (GraphCanvas + graph-editor-core lib)
 * is reused at the UI/algorithm level in a later checkpoint; no storage is
 * shared here.
 *
 * One repair case may own multiple flowcharts (e.g. "초기 진단", "RF 출력
 * 없음 진단", "최종 원인 분석") — repairCaseId is a plain FK, not unique.
 *
 * Soft-delete only applies at this table's level (whole-flowchart
 * lifecycle) — see repair-case-flowchart-nodes.ts/-edges.ts for why
 * individual nodes/edges are hard-deleted instead.
 */
export const repairCaseFlowcharts = pgTable(
  "repair_case_flowcharts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repairCaseId: uuid("repair_case_id")
      .notNull()
      .references(() => repairCases.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // Last mutator — distinct from createdBy since a case's flowchart may be
    // edited by more than one assigned engineer over time.
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Optimistic-concurrency token for node/edge mutations, same convention
    // as procedure_templates.updated_at + touchTemplate: every node/edge
    // write under this flowchart must bump this column in the same
    // transaction (implemented in a later checkpoint's mutation layer).
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Soft-delete four-column convention (DATABASE_DESIGN.md #8), same as
    // customers/end_users. A soft-deleted flowchart's nodes/edges/history
    // rows are never touched by this — they remain exactly as they were.
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "restrict" }),
    deleteReason: text("delete_reason"),
  },
  (table) => [
    index("repair_case_flowcharts_repair_case_id_idx").on(table.repairCaseId),
    index("repair_case_flowcharts_repair_case_id_not_deleted_idx")
      .on(table.repairCaseId)
      .where(sql`is_deleted = false`),
  ]
);
