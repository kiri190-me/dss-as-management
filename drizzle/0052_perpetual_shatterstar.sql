CREATE TABLE "domestic_order_due_dates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domestic_order_id" uuid NOT NULL,
	"due_date" date NOT NULL,
	"note" text,
	"display_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domestic_order_due_dates" ADD CONSTRAINT "domestic_order_due_dates_domestic_order_id_domestic_orders_id_fk" FOREIGN KEY ("domestic_order_id") REFERENCES "public"."domestic_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "domestic_order_due_dates_order_id_idx" ON "domestic_order_due_dates" USING btree ("domestic_order_id");