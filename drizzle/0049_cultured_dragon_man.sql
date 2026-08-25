ALTER TABLE "domestic_orders" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "domestic_orders" ADD COLUMN "completed_by" uuid;--> statement-breakpoint
ALTER TABLE "domestic_orders" ADD CONSTRAINT "domestic_orders_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;