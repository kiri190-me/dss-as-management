CREATE TYPE "public"."idempotency_key_status" AS ENUM('PROCESSING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TABLE "repair_case_idempotency_keys" (
	"idempotency_key" uuid PRIMARY KEY NOT NULL,
	"requester_user_id" uuid NOT NULL,
	"status" "idempotency_key_status" DEFAULT 'PROCESSING' NOT NULL,
	"repair_case_id" uuid,
	"response_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "repair_case_idempotency_keys_succeeded_has_repair_case" CHECK (status <> 'SUCCEEDED' OR repair_case_id IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "repair_case_idempotency_keys" ADD CONSTRAINT "repair_case_idempotency_keys_requester_user_id_users_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_idempotency_keys" ADD CONSTRAINT "repair_case_idempotency_keys_repair_case_id_repair_cases_id_fk" FOREIGN KEY ("repair_case_id") REFERENCES "public"."repair_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repair_case_idempotency_keys_requester_user_id_idx" ON "repair_case_idempotency_keys" USING btree ("requester_user_id");--> statement-breakpoint
CREATE INDEX "repair_case_idempotency_keys_expires_at_idx" ON "repair_case_idempotency_keys" USING btree ("expires_at");