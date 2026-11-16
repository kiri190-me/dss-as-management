CREATE TABLE "portal_approval_delegations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"delegator_user_id" uuid NOT NULL,
	"delegate_user_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"revoked_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_approval_delegations_valid_range" CHECK (ends_at > starts_at),
	CONSTRAINT "portal_approval_delegations_different_users" CHECK (delegate_user_id <> delegator_user_id)
);
--> statement-breakpoint
ALTER TABLE "portal_approval_delegations" ADD CONSTRAINT "portal_approval_delegations_delegator_user_id_users_id_fk" FOREIGN KEY ("delegator_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_approval_delegations" ADD CONSTRAINT "portal_approval_delegations_delegate_user_id_users_id_fk" FOREIGN KEY ("delegate_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_approval_delegations_delegate_active_idx" ON "portal_approval_delegations" USING btree ("delegate_user_id","revoked_at","ends_at");