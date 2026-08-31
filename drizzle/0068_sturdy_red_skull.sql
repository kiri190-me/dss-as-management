CREATE TABLE "part_overhaul_unit_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_id" uuid NOT NULL,
	"unit_price" numeric(15, 2) NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "part_overhaul_unit_prices_not_negative" CHECK ("part_overhaul_unit_prices"."unit_price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "part_overhaul_unit_prices" ADD CONSTRAINT "part_overhaul_unit_prices_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_overhaul_unit_prices" ADD CONSTRAINT "part_overhaul_unit_prices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "part_overhaul_unit_prices_part_unique" ON "part_overhaul_unit_prices" USING btree ("part_id");