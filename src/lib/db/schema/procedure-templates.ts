import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Detailed technical procedure templates (Phase 2 of the repair-center
 * workflow digitization — see the Phase 1 report). Deliberately named
 * "procedure_templates", not "workflow_templates": the latter already exists
 * (workflow.ts) and is the existing high-level repair-case status machine
 * (intake/inspection/repair/shipment/approvals/locking). These two systems
 * are separate layers by design (Phase 1 report §17) — nothing here
 * references repair_cases, and nothing in the high-level workflow tables
 * references this file.
 */
export const procedureTemplateStatusEnum = pgEnum("procedure_template_status", [
  "DRAFT",
  "PUBLISHED",
  "ARCHIVED",
]);

export const procedureTemplateSourceTypeEnum = pgEnum("procedure_template_source_type", [
  "MANUAL",
  "EXCEL_IMPORT",
]);

// Only the two equipment families found in the source workbook (Phase 1
// report). Not reused from workflowTypeEnum (MATCHER/PAID_GENERATOR/
// WARRANTY_GENERATOR) — that enum encodes billing/product distinctions for
// the high-level workflow, not the equipment family a technical procedure
// applies to.
export const procedureEquipmentTypeEnum = pgEnum("procedure_equipment_type", [
  "RFG",
  "MB",
]);

/**
 * Versioning model (Phase 1 report §10, ratified by this task's brief):
 * publishing a template freezes its node/edge rows permanently — a new
 * version is always a fresh row here (never an in-place edit of a published
 * row), linked back via supersedes_template_id so the version chain is
 * queryable without relying on `code` + `version` alone. A DRAFT may be
 * freely edited; a PUBLISHED or ARCHIVED row's nodes/edges are enforced
 * read-only by the mutation layer (procedure-templates.ts), not just by
 * convention.
 *
 * source_file_hash (sha256 of the uploaded .xlsx bytes) is what makes the
 * importer idempotent for a given source file — see
 * scripts/import-procedure-templates.ts.
 */
export const procedureTemplates = pgTable(
  "procedure_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    equipmentType: procedureEquipmentTypeEnum("equipment_type").notNull(),
    description: text("description"),
    status: procedureTemplateStatusEnum("status").notNull().default("DRAFT"),
    // Increments only on publish (Phase 1 report §10) — never bumped by a
    // plain draft edit, matching workflow_versions.version_number's
    // integer-per-published-row precedent elsewhere in this schema.
    version: integer("version").notNull().default(1),
    sourceType: procedureTemplateSourceTypeEnum("source_type").notNull(),
    sourceFileName: text("source_file_name"),
    sourceFileHash: text("source_file_hash"),
    // Self-referencing version chain — the published row this DRAFT was
    // cloned from when editing a PUBLISHED template (Phase 1 report §10).
    // Null for a template's very first version.
    supersedesTemplateId: uuid("supersedes_template_id").references(
      (): AnyPgColumn => procedureTemplates.id,
      { onDelete: "restrict" }
    ),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    publishedByUserId: uuid("published_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    archivedByUserId: uuid("archived_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    // "code" identifies a template lineage (e.g. "rfg-safety-inspection")
    // across versions, so it is unique per *version row*, not globally —
    // the (code, version) pair is the real identity; see the version-chain
    // comment above for why version itself lives on this row rather than a
    // separate join table.
    uniqueIndex("procedure_templates_code_version_unique").on(
      table.code,
      table.version
    ),
  ]
);
