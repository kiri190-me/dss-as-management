CREATE TYPE "public"."audit_log_action_type" AS ENUM('LOGIN', 'CREATE', 'UPDATE', 'SOFT_DELETE', 'RESTORE', 'STATUS_CHANGE', 'FILE_UPLOAD', 'FILE_DOWNLOAD', 'FILE_DELETE', 'EXCEL_IMPORT', 'EXCEL_EXPORT', 'APPROVE', 'APPROVAL_CANCEL', 'ACCOUNT_LOCK', 'ACCOUNT_DEACTIVATE', 'PURGE');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action_type" "audit_log_action_type" NOT NULL,
	"target_entity" text NOT NULL,
	"target_record_id" uuid NOT NULL,
	"previous_value" jsonb,
	"new_value" jsonb,
	"session_id" text,
	"source_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_target_entity_target_record_id_idx" ON "audit_logs" USING btree ("target_entity","target_record_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");