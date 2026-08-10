-- Phase 5C-5A — procedure_templates.category foundation.
--
-- 1) New enum + column on procedure_templates, backfilled with an explicit,
--    approved per-code mapping (never inferred from slug/name/equipment_type/
--    node count) for the exact 4 real templates that exist today, then set
--    NOT NULL. If any row's category is still NULL after the four explicit
--    UPDATEs below — i.e. an unexpected 5th template exists — the final
--    "SET NOT NULL" step fails naturally and the whole migration aborts;
--    no separate guard statement is needed for this.
-- 2) A CHECK tying category to the pre-existing is_reference_only flag so
--    the only two ever-valid pairs going forward are enforced at the DB
--    level, not just by application code.
-- 3) An immutable template_category snapshot on procedure_case_executions,
--    backfilled relationally (JOIN to procedure_templates), never a
--    hardcoded literal — safe even if this database already has execution
--    rows, though the current dev DB has 0.
-- 4) Replaces the old "one active execution per case" index (which applied
--    to every template) with a FULL_SERVICE-scoped partial unique index —
--    TECHNICAL_TASK rows are entirely unaffected by it, and REFERENCE rows
--    can never reach this table at all (existing isReferenceOnly check in
--    startProcedureExecution, reinforced by the CHECK added in step 5).
-- 5) A row-local CHECK (no cross-table reference) closing the "a REFERENCE
--    template can never gain an execution row" invariant at the DB level
--    too, as pure defense-in-depth alongside the application check.
-- 6) Three new procedure_template_edit_action_type enum values
--    (CREATE_NODE/DELETE_NODE/DELETE_EDGE) — schema/typing foundation only
--    for Phase 5C-5B's node/edge CRUD mutations. Nothing in this migration
--    writes a history row using these values.

CREATE TYPE "public"."procedure_template_category" AS ENUM('FULL_SERVICE', 'TECHNICAL_TASK', 'REFERENCE');--> statement-breakpoint

ALTER TYPE "public"."procedure_template_edit_action_type" ADD VALUE 'CREATE_NODE';--> statement-breakpoint
ALTER TYPE "public"."procedure_template_edit_action_type" ADD VALUE 'DELETE_NODE';--> statement-breakpoint
ALTER TYPE "public"."procedure_template_edit_action_type" ADD VALUE 'DELETE_EDGE';--> statement-breakpoint

-- ---- procedure_templates.category: add nullable, explicit backfill, enforce NOT NULL ----

ALTER TABLE "procedure_templates" ADD COLUMN "category" "procedure_template_category";--> statement-breakpoint

UPDATE "procedure_templates" SET "category" = 'FULL_SERVICE' WHERE "code" = 'rfg-full-lifecycle';--> statement-breakpoint
UPDATE "procedure_templates" SET "category" = 'FULL_SERVICE' WHERE "code" = 'mb-full-lifecycle';--> statement-breakpoint
UPDATE "procedure_templates" SET "category" = 'REFERENCE' WHERE "code" = 'main-page-index';--> statement-breakpoint
UPDATE "procedure_templates" SET "category" = 'REFERENCE' WHERE "code" = 'qc-common-operations';--> statement-breakpoint

ALTER TABLE "procedure_templates" ALTER COLUMN "category" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "procedure_templates" ADD CONSTRAINT "procedure_templates_category_reference_only_consistency" CHECK ((category = 'REFERENCE' AND is_reference_only = true) OR (category <> 'REFERENCE' AND is_reference_only = false));--> statement-breakpoint

-- ---- procedure_case_executions.template_category: add nullable, relational backfill from the referenced template, enforce NOT NULL ----

ALTER TABLE "procedure_case_executions" ADD COLUMN "template_category" "procedure_template_category";--> statement-breakpoint

UPDATE "procedure_case_executions" AS "pce"
SET "template_category" = "pt"."category"
FROM "procedure_templates" AS "pt"
WHERE "pt"."id" = "pce"."procedure_template_id";--> statement-breakpoint

ALTER TABLE "procedure_case_executions" ALTER COLUMN "template_category" SET NOT NULL;--> statement-breakpoint

-- ---- replace the old case-wide uniqueness with a FULL_SERVICE-scoped one ----

DROP INDEX "procedure_case_executions_one_active_per_case";--> statement-breakpoint

CREATE UNIQUE INDEX "procedure_case_executions_one_active_full_service_per_case" ON "procedure_case_executions" USING btree ("repair_case_id") WHERE is_deleted = false and template_category = 'FULL_SERVICE';--> statement-breakpoint

ALTER TABLE "procedure_case_executions" ADD CONSTRAINT "procedure_case_executions_no_reference_execution" CHECK (template_category <> 'REFERENCE');
