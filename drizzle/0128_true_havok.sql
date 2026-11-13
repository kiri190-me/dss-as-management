CREATE TABLE "badge_visibility_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"badge_key" text NOT NULL,
	"place_key" text NOT NULL,
	"is_visible" boolean NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "badge_visibility_settings" ADD CONSTRAINT "badge_visibility_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "badge_visibility_settings_badge_place_unique" ON "badge_visibility_settings" USING btree ("badge_key","place_key");