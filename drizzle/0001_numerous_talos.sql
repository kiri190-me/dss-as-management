CREATE TABLE "repair_case_intake_sequences" (
	"year_month" text PRIMARY KEY NOT NULL,
	"last_sequence" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repair_case_intake_sequences_year_month_format" CHECK ("repair_case_intake_sequences"."year_month" ~ '^[0-9]{2}(0[1-9]|1[0-2])$'),
	CONSTRAINT "repair_case_intake_sequences_last_sequence_range" CHECK ("repair_case_intake_sequences"."last_sequence" BETWEEN 0 AND 99)
);
--> statement-breakpoint
-- Migration data initialization (not application seed data): backfills the
-- allocator from existing valid repair_cases.intake_number values so the
-- next allocation continues the sequence instead of restarting at 01.
-- Read-only against repair_cases; writes only to repair_case_intake_sequences.
INSERT INTO "repair_case_intake_sequences" ("year_month", "last_sequence")
SELECT
  substring(intake_number from 2 for 4) AS year_month,
  MAX(substring(intake_number from 6 for 2)::int) AS last_sequence
FROM "repair_cases"
WHERE intake_number ~ '^D[0-9]{2}(0[1-9]|1[0-2])[0-9]{2}$'
GROUP BY substring(intake_number from 2 for 4)
ON CONFLICT ("year_month") DO UPDATE
SET last_sequence = GREATEST("repair_case_intake_sequences"."last_sequence", excluded."last_sequence"),
    updated_at = now();
