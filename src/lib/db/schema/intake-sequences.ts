import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Monthly intake-number allocator (Stage G-3 Batch 1). One row per YYMM
 * bucket. `last_sequence` is incremented via a single atomic
 * `INSERT ... ON CONFLICT (year_month) DO UPDATE ... WHERE last_sequence < 99
 * RETURNING last_sequence` statement in the future mutation module — the
 * ON CONFLICT DO UPDATE clause is itself the row-level serialization
 * mechanism, so no explicit `SELECT ... FOR UPDATE` is used, and no
 * `SELECT MAX(...)`-then-INSERT race is possible.
 *
 * The bucket key is derived from the repair case's validated `receivedAt`
 * date (never from browser time) — matches the existing local-demo
 * intake-number semantics exactly (D + YY + MM + 2-digit monthly sequence).
 *
 * Deliberately minimal per this batch's approved schema: no UUID PK (the
 * YYMM string IS the natural key), no soft-delete columns, no
 * created_by/updated_by, no FK (this table has no relationship to any
 * other table — it is a pure counter, not a business entity).
 */
export const repairCaseIntakeSequences = pgTable(
  "repair_case_intake_sequences",
  {
    yearMonth: text("year_month").primaryKey(),
    lastSequence: integer("last_sequence").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "repair_case_intake_sequences_year_month_format",
      sql`${table.yearMonth} ~ '^[0-9]{2}(0[1-9]|1[0-2])$'`
    ),
    check(
      "repair_case_intake_sequences_last_sequence_range",
      sql`${table.lastSequence} BETWEEN 0 AND 99`
    ),
  ]
);
