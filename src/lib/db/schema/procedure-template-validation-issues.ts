import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { procedureTemplates } from "./procedure-templates";
import { users } from "./users";

export const procedureValidationSeverityEnum = pgEnum("procedure_validation_severity", [
  "INFO",
  "WARNING",
  "ERROR",
]);

/**
 * Phase 3A: the fine-grained outcome of a human review, distinct from the
 * plain "resolved or not" that `resolved_at` nullity used to encode alone.
 * This — not `resolved_at` — is what the publish gate checks: DEFERRED
 * still blocks publication (a human looked at it and explicitly could not
 * resolve it yet), while RESOLVED_WITH_GRAPH_CHANGE and RESOLVED_NO_CHANGE
 * both clear it. `resolved_at`/`resolved_by_user_id`/`resolution_note` are
 * still set for all three non-UNRESOLVED outcomes (they answer "when/who/
 * why"); this enum answers "did anything change, and is it still blocking."
 */
export const procedureValidationResolutionStatusEnum = pgEnum("procedure_validation_resolution_status", [
  "UNRESOLVED",
  "RESOLVED_WITH_GRAPH_CHANGE",
  "RESOLVED_NO_CHANGE",
  "DEFERRED",
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
 * re-querying `severity = 'ERROR' AND resolution_status IN ('UNRESOLVED',
 * 'DEFERRED')` for the template inside the publish transaction — see
 * procedure-templates.ts mutations.
 *
 * raw_evidence (Phase 3A) is a nullable structured (JSON, never binary)
 * snapshot of the workbook geometry behind a DANGLING_CONNECTOR/
 * MISSING_SOURCE_NODE/MISSING_OUTGOING_PATH issue — connector id/stCxnId/
 * endCxnId/from/to plus a ranked candidate-shape list — computed once at
 * import time by extract-shape-graph.ts using the same proximity logic it
 * already uses for label matching. This exists so the validation-resolution
 * UI can show a "raw connector inspector" and ranked candidates without the
 * running server ever needing filesystem access to the original .xlsx
 * (which it never has in a real deployment — only source_file_name/
 * source_file_hash are stored, not a path). Null for issue types with no
 * geometric grounding (e.g. ORPHAN_REFERENCE_ITEM, FORMULA_ERROR).
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
    rawEvidence: jsonb("raw_evidence"),
    resolutionStatus: procedureValidationResolutionStatusEnum("resolution_status")
      .notNull()
      .default("UNRESOLVED"),
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
    // Speeds up the publish-gate's "any unresolved-or-deferred ERROR for
    // this template" check — the query it serves filters on exactly these
    // three columns.
    index("procedure_template_validation_issues_unresolved_idx").on(
      table.procedureTemplateId,
      table.severity,
      table.resolutionStatus
    ),
  ]
);
