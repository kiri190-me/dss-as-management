import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { procedureTemplates } from "./procedure-templates";
import { users } from "./users";

export const procedureValidationSeverityEnum = pgEnum("procedure_validation_severity", [
  "INFO",
  "WARNING",
  "ERROR",
]);

/**
 * issue_type is deliberately a plain text column, not a Postgres enum — the
 * task's own list is introduced with "such as", i.e. non-exhaustive, and
 * this taxonomy is expected to grow as later phases import more of the
 * workbook's sheets. It is still a closed, typed vocabulary at the
 * application layer (PROCEDURE_VALIDATION_ISSUE_TYPES in
 * src/lib/domain/procedure-template-types.ts) — a Postgres enum
 * would need a migration for every newly discovered ambiguity category,
 * which is exactly the friction this column is designed to avoid.
 *
 * Append-only from the importer's perspective: an import run only ever
 * inserts new issue rows. `resolved_at`/`resolved_by_user_id`/
 * `resolution_note` are the only columns a human ever updates, when a
 * reviewer works through the queue — the row itself (what was found, on
 * which sheet) is never rewritten.
 *
 * Publish-gating (this task's rule: "Templates containing unresolved ERROR
 * issues must not be publishable") is enforced by the mutation layer
 * re-querying `severity = 'ERROR' AND resolved_at IS NULL` for the template
 * inside the publish transaction — see procedure-templates.ts mutations.
 */
export const procedureTemplateValidationIssues = pgTable(
  "procedure_template_validation_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    procedureTemplateId: uuid("procedure_template_id")
      .notNull()
      .references(() => procedureTemplates.id, { onDelete: "restrict" }),
    severity: procedureValidationSeverityEnum("severity").notNull(),
    issueType: text("issue_type").notNull(),
    message: text("message").notNull(),
    sourceWorksheet: text("source_worksheet"),
    sourceReference: text("source_reference"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("procedure_template_validation_issues_template_id_idx").on(
      table.procedureTemplateId
    ),
    // Speeds up the publish-gate's "any unresolved ERROR for this template"
    // check — the query it serves filters on exactly these three columns.
    index("procedure_template_validation_issues_unresolved_idx").on(
      table.procedureTemplateId,
      table.severity,
      table.resolvedAt
    ),
  ]
);
