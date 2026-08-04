import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

// Current three workflow types (types.ts WORKFLOW_TYPE_CODES).
export const workflowTypeEnum = pgEnum("workflow_type", [
  "MATCHER",
  "PAID_GENERATOR",
  "WARRANTY_GENERATOR",
]);

export const workflowVersionStatusEnum = pgEnum("workflow_version_status", [
  "DRAFT",
  "PUBLISHED",
  "ARCHIVED",
]);

// Stable identifier for a workflow type. No workflow editor UI in Gate 4 —
// this table only carries the fixed type code/name.
export const workflowTemplates = pgTable(
  "workflow_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: workflowTypeEnum("code").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("workflow_templates_code_unique").on(table.code)]
);

/**
 * A published version's set of steps (existence/order/name) is immutable
 * (DATABASE_DESIGN.md #13). Versions/steps intentionally do not use the
 * soft-delete four-column convention — history that references a version or
 * step must never be soft- or hard-deleted; lifecycle is controlled only via
 * `status` (this table) and `workflow_steps.is_active`.
 */
export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowTemplateId: uuid("workflow_template_id")
      .notNull()
      .references(() => workflowTemplates.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    status: workflowVersionStatusEnum("status").notNull().default("DRAFT"),
    // Exactly one PUBLISHED + is_current row per template is enforced by the
    // partial unique index below (new intake cases are assigned this row).
    isCurrent: boolean("is_current").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("workflow_versions_template_version_unique").on(
      table.workflowTemplateId,
      table.versionNumber
    ),
    uniqueIndex("workflow_versions_current_per_template_unique")
      .on(table.workflowTemplateId)
      .where(sql`status = 'PUBLISHED' AND is_current = true`),
  ]
);

export const workflowSteps = pgTable(
  "workflow_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowVersionId: uuid("workflow_version_id")
      .notNull()
      .references(() => workflowVersions.id, { onDelete: "restrict" }),
    stepOrder: integer("step_order").notNull(),
    // Stable key (e.g. "product_intake") — matched against, never parsed
    // from the human-readable label.
    key: text("key").notNull(),
    label: text("label").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("workflow_steps_version_order_unique").on(
      table.workflowVersionId,
      table.stepOrder
    ),
    uniqueIndex("workflow_steps_version_key_unique").on(
      table.workflowVersionId,
      table.key
    ),
  ]
);

// Admin-managed master list (9 defaults, DATABASE_DESIGN.md #13). Not a
// fixed Postgres enum because admins may add/deactivate entries; "삭제"
// (delete) is intentionally never one of the codes.
export const exceptionStatuses = pgTable(
  "exception_statuses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    label: text("label").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("exception_statuses_code_unique").on(table.code)]
);
