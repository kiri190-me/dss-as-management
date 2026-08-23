ALTER TABLE "procedure_templates" ADD COLUMN "is_deleted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "procedure_templates" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "procedure_templates" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "procedure_templates" ADD COLUMN "delete_reason" text;--> statement-breakpoint
ALTER TABLE "procedure_templates" ADD CONSTRAINT "procedure_templates_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "procedure_templates_not_deleted_idx" ON "procedure_templates" USING btree ("is_deleted") WHERE is_deleted = false;