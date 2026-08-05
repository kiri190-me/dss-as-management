CREATE TYPE "public"."shipment_delegation_status" AS ENUM('ACTIVE', 'REVOKED');--> statement-breakpoint
CREATE TABLE "shipment_approval_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"representative_user_id" uuid NOT NULL,
	"delegate_user_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "shipment_delegation_status" DEFAULT 'ACTIVE' NOT NULL,
	"assigned_by_user_id" uuid NOT NULL,
	"revoked_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_approval_delegations_different_users" CHECK (representative_user_id <> delegate_user_id),
	CONSTRAINT "shipment_approval_delegations_valid_range" CHECK (ends_at > starts_at),
	CONSTRAINT "shipment_approval_delegations_revocation_metadata" CHECK (
        (status = 'ACTIVE' AND revoked_by_user_id IS NULL AND revoked_at IS NULL)
        OR
        (status = 'REVOKED' AND revoked_by_user_id IS NOT NULL AND revoked_at IS NOT NULL)
      )
);
--> statement-breakpoint
CREATE TABLE "representative_change_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_user_id" uuid NOT NULL,
	"previous_value" boolean NOT NULL,
	"new_value" boolean NOT NULL,
	"changed_by_user_id" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shipment_approval_delegations" ADD CONSTRAINT "shipment_approval_delegations_representative_user_id_users_id_fk" FOREIGN KEY ("representative_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_approval_delegations" ADD CONSTRAINT "shipment_approval_delegations_delegate_user_id_users_id_fk" FOREIGN KEY ("delegate_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_approval_delegations" ADD CONSTRAINT "shipment_approval_delegations_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_approval_delegations" ADD CONSTRAINT "shipment_approval_delegations_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "representative_change_history" ADD CONSTRAINT "representative_change_history_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "representative_change_history" ADD CONSTRAINT "representative_change_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shipment_approval_delegations_representative_id_idx" ON "shipment_approval_delegations" USING btree ("representative_user_id");--> statement-breakpoint
CREATE INDEX "shipment_approval_delegations_delegate_id_idx" ON "shipment_approval_delegations" USING btree ("delegate_user_id");--> statement-breakpoint
CREATE INDEX "shipment_approval_delegations_status_period_idx" ON "shipment_approval_delegations" USING btree ("status","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "representative_change_history_target_user_id_idx" ON "representative_change_history" USING btree ("target_user_id");