CREATE TYPE "public"."permission_level" AS ENUM('NONE', 'READ', 'WRITE', 'MANAGE');--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" "role_code" NOT NULL,
	"area_key" text NOT NULL,
	"level" "permission_level" NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_role_area_unique" ON "role_permissions" USING btree ("role","area_key");