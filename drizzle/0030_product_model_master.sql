-- Product Model Master (canonical model-level identity), approved after a
-- two-stage audit: a TEST-data orphan cleanup, then a canonicalization
-- review of the 9 real distinct products.model_name values. Approved
-- mapping is pure identity — every existing distinct model_name becomes
-- exactly one product_models row, no merges, D1-MODEL/MBK200-JS2/
-- TEST-MODEL-A all explicitly preserved regardless of their ambiguous
-- (non-seed) origin.
--
-- kind is deliberately NEVER derived/backfilled from repair_cases'
-- workflow_type — the canonicalization audit found a real same-physical-
-- unit conflict (TG-350's one unit was serviced once as WARRANTY_GENERATOR
-- and once as MATCHER), proving workflow_type is not a reliable per-model
-- hardware fact in the current data. kind starts NULL for every row here
-- and is only ever set later by an authorized user through a real
-- model-master edit action (not part of this migration).
--
-- Backfill order: structure (type, table, its own FK/indexes, the new
-- products.product_model_id column and FK) is created first, exactly as
-- migration 0029 (end_user_contacts) did — the data backfill runs last,
-- against a fully-formed schema. products.model_name itself is completely
-- untouched by this migration.

CREATE TYPE "public"."product_model_kind" AS ENUM('GENERATOR', 'MATCHER');--> statement-breakpoint
CREATE TABLE "product_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_name" text NOT NULL,
	"kind" "product_model_kind",
	"manufacturer" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "product_model_id" uuid;--> statement-breakpoint
ALTER TABLE "product_models" ADD CONSTRAINT "product_models_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_models_not_deleted_idx" ON "product_models" USING btree ("is_deleted") WHERE is_deleted = false;--> statement-breakpoint
CREATE UNIQUE INDEX "product_models_normalized_name_unique" ON "product_models" USING btree (lower(regexp_replace(btrim("model_name"), '\s+', ' ', 'g'))) WHERE is_deleted = false;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_product_model_id_product_models_id_fk" FOREIGN KEY ("product_model_id") REFERENCES "public"."product_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- Backfill: one product_models row per DISTINCT exact products.model_name
-- (no normalization, no merging).
INSERT INTO "product_models" ("model_name")
SELECT DISTINCT "model_name" FROM "products";--> statement-breakpoint

-- Backfill: link every existing products row to its matching master by
-- exact model_name equality only.
UPDATE "products" p
SET "product_model_id" = pm."id"
FROM "product_models" pm
WHERE pm."model_name" = p."model_name";
