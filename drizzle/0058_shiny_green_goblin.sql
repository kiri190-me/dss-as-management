CREATE TABLE "notification_kind_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind_key" text NOT NULL,
	"is_enabled" boolean NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_role_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind_key" text NOT NULL,
	"role" "role_code" NOT NULL,
	"receives" boolean NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_kind_settings" ADD CONSTRAINT "notification_kind_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_role_settings" ADD CONSTRAINT "notification_role_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_kind_settings_kind_unique" ON "notification_kind_settings" USING btree ("kind_key");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_role_settings_kind_role_unique" ON "notification_role_settings" USING btree ("kind_key","role");