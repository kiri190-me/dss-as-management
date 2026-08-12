-- Hand-edited (Phase 5C-5C): drizzle-kit's generated SQL was unsafe against
-- the live, populated procedure_template_edit_history table (11 legacy rows
-- on mb-full-lifecycle) in two ways:
--   1. `ADD COLUMN change_group_id uuid NOT NULL` with no default would
--      error immediately ("column contains null values") against existing
--      rows.
--   2. `ADD COLUMN sequence_number bigint NOT NULL GENERATED ALWAYS AS
--      IDENTITY` in one step lets Postgres auto-backfill identity values for
--      existing rows in unspecified/physical order, not the required
--      deterministic created_at-then-id order.
-- Rewritten below as the approved 14-step semantic sequence (A-N):
-- nullable-add -> deterministic backfill -> NOT NULL -> identity conversion,
-- keeping every other drizzle-kit-generated statement (enum creation, plain
-- nullable columns, CHECK, indexes, enum value append) unchanged. The
-- resulting live schema shape is identical to what drizzle-kit generated
-- (same column types/identity config/names), so this migration stays
-- consistent with drizzle/meta/0018_snapshot.json and future `drizzle-kit
-- generate` runs will see no diff.

-- A. New origin enum type.
CREATE TYPE "public"."procedure_template_edit_history_origin" AS ENUM('USER_EDIT', 'UNDO', 'REDO', 'RESTORE');--> statement-breakpoint

-- B. change_group_id added nullable first.
ALTER TABLE "procedure_template_edit_history" ADD COLUMN "change_group_id" uuid;--> statement-breakpoint

-- C. Legacy backfill: each existing row gets its own singleton UUID. No
-- historical compound grouping is reconstructed — acceptable because
-- FULL_SERVICE history stays read-only display and is never fed through the
-- Undo/Redo/Restore fold (verified: 0 real TECHNICAL_TASK history rows
-- exist).
UPDATE "procedure_template_edit_history" SET "change_group_id" = gen_random_uuid() WHERE "change_group_id" IS NULL;--> statement-breakpoint

-- D. Enforce NOT NULL now that every row has a value.
ALTER TABLE "procedure_template_edit_history" ALTER COLUMN "change_group_id" SET NOT NULL;--> statement-breakpoint

-- E. sequence_number added as a plain nullable bigint first (no identity
-- yet) so backfill order is fully under our control.
ALTER TABLE "procedure_template_edit_history" ADD COLUMN "sequence_number" bigint;--> statement-breakpoint

-- F. Deterministic legacy ordering: created_at, with id as the explicit
-- tie-breaker for same-transaction/same-created_at() rows (Postgres now()
-- is transaction-scoped, so compound-group inserts can tie on created_at).
WITH "ordered" AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "created_at" ASC, "id" ASC) AS "rn"
  FROM "procedure_template_edit_history"
)
UPDATE "procedure_template_edit_history" AS "t"
SET "sequence_number" = "ordered"."rn"
FROM "ordered"
WHERE "t"."id" = "ordered"."id";--> statement-breakpoint

-- G. Enforce NOT NULL now that every row has a deterministic value.
ALTER TABLE "procedure_template_edit_history" ALTER COLUMN "sequence_number" SET NOT NULL;--> statement-breakpoint

-- H. Convert to identity for all future inserts (Postgres auto-names the
-- owned sequence "procedure_template_edit_history_sequence_number_seq",
-- matching drizzle/meta/0018_snapshot.json), then advance the sequence's
-- live position to the backfilled MAX(sequence_number) dynamically — never
-- a hardcoded row count, correct regardless of how many legacy rows exist
-- (including zero). Without this, the next INSERT would restart at 1 and
-- collide with the backfilled rows, violating the new UNIQUE index below.
ALTER TABLE "procedure_template_edit_history" ALTER COLUMN "sequence_number" ADD GENERATED ALWAYS AS IDENTITY;--> statement-breakpoint
-- Explicit 3-arg setval (value, is_called) instead of the 2-arg form: the
-- 2-arg form is equivalent to is_called=true, and Postgres setval() enforces
-- the sequence's MINVALUE/MAXVALUE bounds even under is_called=true. Default
-- identity MINVALUE is 1, so on an empty table COALESCE(MAX(...),0)=0 would
-- pass 0 to setval and raise "value 0 is out of bounds for sequence ...
-- (1..9223372036854775807)". GREATEST(...,1) keeps the passed value >= 1 in
-- all cases, and is_called is chosen explicitly per case:
--   populated -> setval(seq, MAX, true)  -> next nextval() = MAX + 1
--   empty     -> setval(seq, 1,   false) -> next nextval() = 1 (unadvanced)
SELECT setval(
  pg_get_serial_sequence('procedure_template_edit_history', 'sequence_number'),
  GREATEST((SELECT COALESCE(MAX("sequence_number"), 1) FROM "procedure_template_edit_history"), 1),
  (SELECT COUNT(*) > 0 FROM "procedure_template_edit_history")
);--> statement-breakpoint

-- I. origin — inline default backfills existing rows in the same statement
-- (safe: constant default, no ordering concern).
ALTER TABLE "procedure_template_edit_history" ADD COLUMN "origin" "procedure_template_edit_history_origin" DEFAULT 'USER_EDIT' NOT NULL;--> statement-breakpoint

-- J. source_group_id / restore_target_group_id — nullable, no backfill concern.
ALTER TABLE "procedure_template_edit_history" ADD COLUMN "source_group_id" uuid;--> statement-breakpoint
ALTER TABLE "procedure_template_edit_history" ADD COLUMN "restore_target_group_id" uuid;--> statement-breakpoint

-- K. Origin-consistency invariant — every existing row already satisfies
-- this (origin='USER_EDIT', source_group_id/restore_target_group_id both
-- NULL from steps I/J), so this validates immediately.
ALTER TABLE "procedure_template_edit_history" ADD CONSTRAINT "procedure_template_edit_history_origin_consistency" CHECK (("procedure_template_edit_history"."origin" = 'USER_EDIT' AND "procedure_template_edit_history"."source_group_id" IS NULL AND "procedure_template_edit_history"."restore_target_group_id" IS NULL)
        OR ("procedure_template_edit_history"."origin" IN ('UNDO', 'REDO') AND "procedure_template_edit_history"."source_group_id" IS NOT NULL AND "procedure_template_edit_history"."restore_target_group_id" IS NULL)
        OR ("procedure_template_edit_history"."origin" = 'RESTORE' AND "procedure_template_edit_history"."source_group_id" IS NULL AND "procedure_template_edit_history"."restore_target_group_id" IS NOT NULL));--> statement-breakpoint

-- L. Structural uniqueness guarantee for sequence_number (identity alone
-- does not create a UNIQUE constraint).
CREATE UNIQUE INDEX "procedure_template_edit_history_sequence_number_unique" ON "procedure_template_edit_history" USING btree ("sequence_number");--> statement-breakpoint

-- M. Serving index for the per-template fold/history query.
CREATE INDEX "procedure_template_edit_history_template_sequence_idx" ON "procedure_template_edit_history" USING btree ("procedure_template_id","sequence_number");--> statement-breakpoint

-- N. New action type for technical-template rename auditing.
ALTER TYPE "public"."procedure_template_edit_action_type" ADD VALUE 'UPDATE_TEMPLATE_METADATA';
