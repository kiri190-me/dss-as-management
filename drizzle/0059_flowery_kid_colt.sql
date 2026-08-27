CREATE TABLE "part_minimum_quantities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_id" uuid NOT NULL,
	"owner" "stock_owner" NOT NULL,
	"minimum_quantity" integer NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "part_minimum_quantities_not_negative" CHECK ("part_minimum_quantities"."minimum_quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "part_minimum_quantities" ADD CONSTRAINT "part_minimum_quantities_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_minimum_quantities" ADD CONSTRAINT "part_minimum_quantities_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "part_minimum_quantities_part_owner_unique" ON "part_minimum_quantities" USING btree ("part_id","owner");